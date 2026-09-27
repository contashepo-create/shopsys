/**
 * ledgerGuard.ts — الحارس المركزي لدفتر اليومية (المرحلة 1 من التدقيق المحاسبي).
 *
 * المشكلة التي يغلقها (AUDIT-002 وAUDIT-003 في AGENTS §3.6):
 * `repo.ts` فيه أكثر من مئة موضع يُنشئ قيداً، والتوازن كان مضموناً «بالبناء» في بُناة
 * `core/*` فقط، ولا شيء يمنع مساراً جديداً من كتابة قيد مختل مباشرة في الحالة؛ كما أن
 * قفل السنة المالية كان مفحوصاً في `postManualEntry` وحده.
 *
 * الحل: **بوابة واحدة لا يمر قيد إلا منها** — تُستدعى داخل غلاف `set` المركزي، فتفحص
 * كل قيد جديد قبل أي كتابة، وترمي نصاً عربياً يوقف العملية كلها (ث10: لا أثر جزئي).
 *
 * الثوابت المفروضة هنا: ث1 التوازن · ث2 نظافة السطر · ث3 مصدر ومستند وسنة مفتوحة ·
 * ث4 ترقيم بلا تكرار · ث9 لا تعديل صامت لقيد مُرحَّل.
 *
 * نواة خالصة بلا React وبلا استيراد من طبقة البيانات — قابلة للاختبار وحدها.
 */
import type { Account, JournalEntry, SourceType } from './ledger.ts'

export interface FiscalYearLike {
  nameAr: string
  startDate: string
  endDate: string
  status: 'open' | 'closed'
}

export interface LedgerGuardContext {
  /** شجرة الحسابات الفعلية: القياسية + الخزائن + الحسابات المخصصة */
  coa: readonly Account[]
  /** السنوات المالية — المقفلة منها تمنع أي قيد بتاريخ داخلها */
  fiscalYears?: readonly FiscalYearLike[]
}

/** أنواع مصادر يُسمح لها بالترحيل داخل سنة مقفلة (قيد الإقفال نفسه يقع في آخر يوم من السنة) */
const CLOSED_YEAR_EXEMPT: readonly SourceType[] = ['year_closing']

const isMoney = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n)

/**
 * توحيد تاريخ القيد على `YYYY-MM-DD`.
 * بعض المسارات كانت ترحّل تاريخاً بصيغة ISO كاملة (`2026-09-20T09:00:00.000Z`) فتختل
 * مقارنات الفترات وقفل السنة المالية (`…-12-31T23:00:00Z` يقع «خارج» السنة نصياً).
 * يعيد نفس المصفوفة إن لم يكن هناك ما يُطبَّع (بلا نسخ بلا داعٍ).
 */
export function normalizeJournalDates<T extends JournalEntry>(entries: readonly T[]): readonly T[] {
  let changed = false
  const out = entries.map((e) => {
    if (typeof e.date === 'string' && e.date.length > 10 && /^\d{4}-\d{2}-\d{2}T/.test(e.date)) {
      changed = true
      return { ...e, date: e.date.slice(0, 10) }
    }
    return e
  })
  return changed ? out : entries
}

/** يفحص قيداً واحداً ويعيد قائمة مخالفات عربية (فارغة = سليم) */
export function validateEntry(entry: JournalEntry, ctx: LedgerGuardContext): string[] {
  const errors: string[] = []
  const tag = `القيد #${entry.entryNumber ?? entry.id}${entry.sourceType ? ` (${entry.sourceType})` : ''}`
  const lines = entry.lines ?? []

  // ث2 — نظافة السطر
  const byCode = new Map(ctx.coa.map((a) => [a.code, a]))
  let totalDebit = 0
  let totalCredit = 0
  let meaningful = 0
  for (const line of lines) {
    const debit = line.debit
    const credit = line.credit
    if (!isMoney(debit) || !isMoney(credit)) {
      errors.push(`${tag}: مبلغ غير صحيح على الحساب ${line.accountCode} — كل المبالغ أعداد صحيحة بالوحدة الصغرى`)
      continue
    }
    if (debit < 0 || credit < 0) errors.push(`${tag}: مبلغ سالب على الحساب ${line.accountCode} — استخدم الطرف المقابل`)
    if (debit > 0 && credit > 0) errors.push(`${tag}: السطر ${line.accountCode} مدين ودائن معاً`)
    const acc = byCode.get(line.accountCode)
    if (!acc) errors.push(`${tag}: حساب غير موجود في شجرة الحسابات (${line.accountCode})`)
    else if (acc.isPostable === false) errors.push(`${tag}: «${acc.nameAr}» حساب تجميعي لا يقبل قيوداً مباشرة`)
    totalDebit += debit
    totalCredit += credit
    if (debit !== 0 || credit !== 0) meaningful++
  }

  // ث1 — التوازن
  if (totalDebit !== totalCredit) errors.push(`${tag}: غير متزن — مدين ${totalDebit} ودائن ${totalCredit}`)
  if (meaningful < 2) errors.push(`${tag}: يحتاج طرفين على الأقل`)

  // ث3 — مصدر وتاريخ وسنة مفتوحة
  if (!entry.sourceType) errors.push(`${tag}: بلا نوع مصدر — كل قيد يتبع مستنداً`)
  if (!entry.date || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
    errors.push(`${tag}: تاريخ غير صالح (${entry.date ?? 'فارغ'})`)
  } else if (!CLOSED_YEAR_EXEMPT.includes(entry.sourceType)) {
    const closed = (ctx.fiscalYears ?? []).find((y) => y.status === 'closed' && entry.date >= y.startDate && entry.date <= y.endDate)
    if (closed) errors.push(`التاريخ ${entry.date} داخل السنة المالية المقفلة «${closed.nameAr}» — لا قيود في فترة مقفلة`)
  }

  return errors
}

/**
 * الحارس المركزي: يفحص ما استجد على الدفتر قبل كتابته.
 * @param prev دفتر اليومية قبل التعديل
 * @param next دفتر اليومية المطلوب كتابته
 * @throws Error برسالة عربية جاهزة للعرض عند أي مخالفة
 */
export function assertJournalIntegrity(
  prev: readonly JournalEntry[],
  next: readonly JournalEntry[],
  ctx: LedgerGuardContext,
): void {
  if (prev === next) return
  const prevById = new Map(prev.map((e) => [e.id, e]))
  const errors: string[] = []
  const seenNumbers = new Map<number, number>()

  for (const entry of next) {
    const before = prevById.get(entry.id)
    if (!before) {
      errors.push(...validateEntry(entry, ctx))
    } else if (before.lines !== entry.lines && JSON.stringify(before.lines) !== JSON.stringify(entry.lines)) {
      // ث9 — لا تعديل صامت: تصحيح القيد المُرحَّل يكون بقيد عاكس لا بتحرير سطوره
      errors.push(`تعديل صامت لسطور القيد #${entry.entryNumber ?? entry.id} ممنوع — التصحيح يكون بقيد عاكس`)
    }
    // ث4 — لا تكرار في أرقام القيود
    const n = entry.entryNumber
    if (typeof n === 'number') {
      const count = (seenNumbers.get(n) ?? 0) + 1
      seenNumbers.set(n, count)
      if (count === 2) errors.push(`رقم القيد ${n} مكرر في دفتر اليومية`)
    }
  }

  if (errors.length) {
    throw new Error(`رُفض الترحيل — الدفتر يحمي نفسه: ${errors.join('؛ ')}`)
  }
}
