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
import { calendarDateIso } from './time.ts'
import type { Account, JournalEntry, SourceType } from './ledger.ts'
import { SOURCE_REFERENCE_COLLECTION_OPTIONS, SOURCE_REFERENCE_COLLECTIONS, SOURCE_TYPE_VALUES } from './sourceTypes.ts'

export interface FiscalYearLike {
  branchId?: number
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
  /** لا يُعفى من قفل الفترة إلا عكسٌ مطابق لقيد إقفال مفتوح الاعتماد */
  authorizedYearClosingReversalIds?: ReadonlySet<number>
  /** فهارس المصدر لأنواع SourceType ذات مجموعة مالكة مباشرة ومثبتة */
  sourceDocumentIndexes?: Partial<Record<SourceType, ReadonlyMap<number, number | null | undefined>>>
  /** فهارس المجموعات صراحةً للمصادر متعددة المستندات. */
  sourceCollectionIndexes?: Readonly<Record<string, ReadonlyMap<number, number | null | undefined>>>
  /** لا تفرض discriminator على القيود التاريخية؛ المجموعة مطلوبة للقيود الجديدة فقط. */
  requireSourceCollection?: boolean
}

/** أنواع مصادر يُسمح لها بالترحيل داخل سنة مقفلة (قيد الإقفال نفسه يقع في آخر يوم من السنة) */
const CLOSED_YEAR_EXEMPT: readonly SourceType[] = ['year_closing']
const VALID_SOURCE_TYPES: ReadonlySet<string> = new Set(SOURCE_TYPE_VALUES)
/** مصادر بلا مستند مستقل: قيد يدوي، افتتاح بلا كيان منفرد، وإهلاك دوري. */
const NULL_SOURCE_ID_ALLOWED: ReadonlySet<SourceType> = new Set(['manual', 'opening', 'depreciation'])

const isMoney = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n)

/** تاريخ YYYY-MM-DD موجود فعلاً في التقويم (ذهاباً وإياباً عبر محرك التواريخ) */
function isValidCalendarDate(iso: string): boolean {
  const d = new Date(`${iso}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && calendarDateIso(d) === iso
}

/** يفحص مرجعاً مباشراً مفهرساً؛ المصادر غير المباشرة تُوثق في سياسة مستقلة. */
export function validateSourceReference(
  entry: JournalEntry,
  indexes: Partial<Record<SourceType, ReadonlyMap<number, number | null | undefined>>> = {},
  collectionIndexes: Readonly<Record<string, ReadonlyMap<number, number | null | undefined>>> = {},
  requireCollection = false,
): string[] {
  const fixedCollection = (SOURCE_REFERENCE_COLLECTIONS as Partial<Record<SourceType, string>>)[entry.sourceType]
  const options = (SOURCE_REFERENCE_COLLECTION_OPTIONS as Partial<Record<SourceType, readonly string[]>>)[entry.sourceType]
  const selected = entry.sourceCollection
  if (selected && (options ? !options.includes(selected) : selected !== fixedCollection)) {
    return [`القيد (${entry.sourceType}): مجموعة المصدر «${selected}» غير مسموحة لهذا النوع`]
  }
  if (!selected && options && requireCollection && entry.sourceId != null) {
    return [`القيد (${entry.sourceType}): يجب تحديد مجموعة المستند لأن نوع المصدر متعدد المجموعات`]
  }
  if (fixedCollection && selected && selected !== fixedCollection) {
    return [`القيد (${entry.sourceType}): مجموعة المصدر يجب أن تكون «${fixedCollection}»`]
  }
  const index = selected
    ? collectionIndexes[selected] ?? (selected === fixedCollection ? indexes[entry.sourceType] : undefined)
    : indexes[entry.sourceType]
  if (!index || entry.sourceId == null) return []
  if (!index.has(entry.sourceId)) {
    return [`القيد (${entry.sourceType}): المستند المرتبط #${entry.sourceId} غير موجود في سجلات النظام${selected ? ` ضمن مجموعة «${selected}»` : fixedCollection ? ` ضمن مجموعة «${fixedCollection}»` : ''}`]
  }
  const sourceBranchId = index.get(entry.sourceId)
  if (entry.branchId != null && sourceBranchId != null && sourceBranchId !== entry.branchId) {
    return [`القيد (${entry.sourceType}): المستند المرتبط #${entry.sourceId} تابع لفرع آخر`]
  }
  return []
}

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
  let overflow = false
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
    // جمع آمن: تجاوز النطاق الآمن يفسد مقارنة التوازن بصمت (ث1) — يُرفض صراحة
    if (!overflow) {
      const nd = totalDebit + debit
      const nc = totalCredit + credit
      if (!Number.isSafeInteger(nd) || !Number.isSafeInteger(nc)) {
        overflow = true
        errors.push(`${tag}: مجموع مبالغ القيد خارج النطاق الآمن للأعداد الصحيحة`)
      } else { totalDebit = nd; totalCredit = nc }
    }
    if (debit !== 0 || credit !== 0) meaningful++
  }

  // ث1 — التوازن
  if (entry.memoOnly) {
    // قيد تذكاري (توثيق مستخلصات): أي سطر مالي عليه = تسرّب أثر دفتري
    // لمستند يجب أن يكون صامتاً — يُرفض فوراً
    if (lines.length > 0) errors.push(`${tag}: قيد تذكاري يحمل سطوراً مالية — التوثيق بلا أثر دفتري`)
  } else {
    if (totalDebit !== totalCredit) errors.push(`${tag}: غير متزن — مدين ${totalDebit} ودائن ${totalCredit}`)
    if (meaningful < 2) errors.push(`${tag}: يحتاج طرفين على الأقل`)
  }

  // ث3 — مصدر وتاريخ وسنة مفتوحة
  if (!entry.sourceType) errors.push(`${tag}: بلا نوع مصدر — كل قيد يتبع مستنداً`)
  else if (!VALID_SOURCE_TYPES.has(entry.sourceType)) errors.push(`${tag}: نوع مصدر غير معروف (${String(entry.sourceType)}) — راجع تعريف مصادر القيود`)
  if (entry.sourceId == null) {
    if (entry.sourceType && !NULL_SOURCE_ID_ALLOWED.has(entry.sourceType)) {
      errors.push(`${tag}: معرّف المصدر مطلوب لهذا النوع من القيود`)
    }
  } else if (!Number.isSafeInteger(entry.sourceId) || entry.sourceId <= 0) {
    errors.push(`${tag}: معرّف المصدر غير صالح — يجب أن يكون عدداً صحيحاً آمناً وموجباً`)
  }
  errors.push(...validateSourceReference(entry, ctx.sourceDocumentIndexes, ctx.sourceCollectionIndexes, ctx.requireSourceCollection))
  if (!entry.date || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
    errors.push(`${tag}: تاريخ غير صالح (${entry.date ?? 'فارغ'})`)
  } else if (!isValidCalendarDate(entry.date)) {
    // 2026-02-30 كان يجتاز الاختبار النصي ثم يتدحرج في محرك التواريخ إلى مارس —
    // تاريخ غير موجود تقويمياً يُرفض الآن قبل أن يفسد ترتيب الفترات (مراجعة §75)
    errors.push(`${tag}: تاريخ غير موجود في التقويم (${entry.date})`)
  } else if (!CLOSED_YEAR_EXEMPT.includes(entry.sourceType)) {
    const configuredYears = ctx.fiscalYears ?? []
    const scopedYears = configuredYears.filter((year) => entry.branchId == null ? year.branchId == null : year.branchId === entry.branchId)
    const closed = scopedYears.find((y) => y.status === 'closed' && entry.date >= y.startDate && entry.date <= y.endDate)
    const authorizedClosingReversal = entry.sourceType === 'reversal'
      && entry.reversesEntryId != null
      && entry.sourceId === entry.reversesEntryId
      && ctx.authorizedYearClosingReversalIds?.has(entry.reversesEntryId) === true
    if (closed && !authorizedClosingReversal) {
      errors.push(`التاريخ ${entry.date} داخل السنة المالية المقفلة «${closed.nameAr}»${entry.branchId != null ? ` للفرع #${entry.branchId}` : ''} — لا قيود في فترة مقفلة`)
    } else if (!CLOSED_YEAR_EXEMPT.includes(entry.sourceType) && !authorizedClosingReversal && configuredYears.length > 0 && !scopedYears.some((year) => year.status === 'open' && entry.date >= year.startDate && entry.date <= year.endDate)) {
      errors.push(`التاريخ ${entry.date} ليس ضمن سنة مالية مفتوحة${entry.branchId != null ? ` للفرع #${entry.branchId}` : ''} — افتح سنة هذا الفرع أو صحح التاريخ`)
    }
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
  const seenIds = new Set<number>()
  const nextIds = new Set(next.map((entry) => entry.id))

  // Append-only: a caller must not erase historical entries by replacing the array.
  for (const before of prev) {
    if (!nextIds.has(before.id)) errors.push(`حذف القيد #${before.entryNumber ?? before.id} ممنوع — التصحيح يكون بقيد عاكس`)
  }

  for (const entry of next) {
    if (seenIds.has(entry.id)) errors.push(`معرّف القيد ${entry.id} مكرر في دفتر اليومية`)
    else seenIds.add(entry.id)
    const before = prevById.get(entry.id)
    if (!before) {
      const closing = entry.sourceType === 'reversal' && entry.reversesEntryId != null
        ? prevById.get(entry.reversesEntryId)
        : undefined
      const exactClosingReversal = Boolean(
        closing
        && closing.sourceType === 'year_closing'
        && closing.reversedByEntryId == null
        && entry.sourceId === closing.id
        && entry.date === closing.date
        && entry.branchId === closing.branchId
        && entry.lines.length === closing.lines.length
        && entry.lines.every((line, index) => {
          const original = closing.lines[index]
          return line.accountCode === original.accountCode
            && line.debit === original.credit
            && line.credit === original.debit
            && line.costCenterId === original.costCenterId
            && line.partyKind === original.partyKind
            && line.partyId === original.partyId
            && line.relatedBranchId === original.relatedBranchId
        }),
      )
      const entryContext = exactClosingReversal && closing
        ? { ...ctx, authorizedYearClosingReversalIds: new Set([closing.id]) }
        : ctx
      errors.push(...validateEntry(entry, entryContext))
    } else {
      if (before.entryNumber !== entry.entryNumber) {
        errors.push(`تغيير رقم القيد #${before.entryNumber} إلى ${entry.entryNumber} ممنوع — أرقام القيود لا تتغير بعد الترحيل`)
      }
      if (before.lines !== entry.lines && JSON.stringify(before.lines) !== JSON.stringify(entry.lines)) {
        // ث9 — لا تعديل صامت: تصحيح القيد المُرحَّل يكون بقيد عاكس لا بتحرير سطوره
        errors.push(`تعديل صامت لسطور القيد #${entry.entryNumber ?? entry.id} ممنوع — التصحيح يكون بقيد عاكس`)
      }
      // ث9-ممتد (مراجعة §75): التاريخ والوصف والمصدر هوية القيد المرحّل — تحريك
      // التاريخ كان ينقل أثراً مالياً بين الفترات بصمت (يتجاوز قفل السنة المقفلة).
      // يُتسامح فقط مع تطبيع ISO الكامل إلى YYYY-MM-DD (يحدث داخل غلاف set).
      const beforeDate = before.date.length > 10 && /^\d{4}-\d{2}-\d{2}T/.test(before.date) ? before.date.slice(0, 10) : before.date
      if (beforeDate !== entry.date) errors.push(`تغيير تاريخ القيد #${entry.entryNumber ?? entry.id} ممنوع — القيد المرحّل لا يتحرك بين الفترات (التصحيح بقيد عاكس)`)
      if (before.description !== entry.description || before.sourceType !== entry.sourceType || before.sourceId !== entry.sourceId || before.sourceCollection !== entry.sourceCollection) {
        errors.push(`تغيير وصف أو مصدر القيد #${entry.entryNumber ?? entry.id} ممنوع — القيد المرحّل غير قابل للتعديل`)
      }
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
