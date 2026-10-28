/**
 * نموذج «تقرير المشروع التحليلي» — التصميم ③ (طلب المالك 2026-10-27).
 * ───────────────────────────────────────────────────────────────
 * ترتيب الأقسام كما طلب المالك حرفياً:
 *   اسم المشروع وقيمته ← ما حُصِّل منه ← المتبقي من التحصيل
 *   ← كل المصروفات (برصيد تراكمي) ← كل التحصيلات (بالمتبقي بعد كل عملية)
 *   ← تسوية ختامية بالمعادلة.
 *
 * التحصيلات من **مصدر واحد**: clientSettlements + سندات القبض + الشيكات
 * الواردة النشطة + استرداد الدفعات المقدمة (مقاصة في المستخلص).
 * نواة خالصة: تُبنى من لقطة بيانات فقط، بلا React/DOM/متاجر.
 */
import type { Minor } from './money.ts'
import type { FormalReportModel, FormalReportRow, FormalReportSection } from './formalReport.ts'
import type { OpenInvoice } from './projectOps.ts'
import type { ChequeDuesLike } from './chequeDues.ts'

export interface AnalyticalProjectSource {
  project: { code: string; nameAr: string; clientName: string; status: string; startDate: string; contractValueMinor: Minor }
  /** أوامر التغيير المعتمدة */
  changeOrdersApprovedMinor?: Minor
  /** المستخلصات (القيمة قبل الضريبة، المحتجز، المستحق، التاريخ، الرقم، نقدي/آجل) */
  extracts: {
    extractNumber: string
    date: string
    grossMinor: Minor
    vatMinor?: Minor
    retentionMinor: Minor
    dueMinor: Minor
    payment: 'cash' | 'credit'
    advanceRecoveryMinor?: Minor
  }[]
  /** مصروفات المشروع (سطر لكل مستند) */
  expenses: {
    date: string
    docNumber: string
    description: string
    party?: string
    category?: string
    amountMinor: Minor
  }[]
  /** تحصيلات المستخلصات الآجلة من دفتر التوزيع (settledMinor لكل مستخلص) */
  openInvoiceSettled?: Map<string, number>
  /** سندات القبض على العميل — التوزيعات إن وُجدت تحصر السطر في مستخلصات هذا المشروع */
  vouchers?: { date: string; number: string; description?: string; amountMinor: Minor; reversed?: boolean; allocations?: readonly DocAllocation[] }[]
  /** تسويات العملاء (تحصيلات FIFO) */
  clientSettlements?: { date: string; number: string; amountMinor: Minor; allocations?: readonly DocAllocation[] }[]
  /** الشيكات الواردة — تُعرض بحالتها وتُحتسب Non-bounced فقط */
  cheques?: (ChequeDuesLike & { chequeNumber: string; bankName?: string; createdAt?: string; settledAt?: string | null })[]
  /**
   * إجمالي ما خُصم **فعلاً** من ذمم مستخلصات هذا المشروع عبر الشيكات الواردة.
   * الشيكات تُوزَّع FIFO على كل مستندات العميل (فواتير + مشاريع أخرى)، فلا يجوز
   * عرض قيمتها كلها كتحصيل لهذا المشروع. يُمرَّر من العارض = (إجمالي المسدَّد
   * على المستخلصات − توزيعات السندات/التسويات الصريحة). عند غيابه يبقى السلوك
   * القديم (كل الشيكات) للتوافق مع النماذج المبنية يدوياً.
   */
  chequeAttributedMinor?: Minor
  /** مفاتيح مستخلصات هذا المشروع (docKey = extract:<id>) */
  extractDocKeys?: string[]
  /** هل الشيكات تُحتسب ضمن التحصيلات؟ (افتراضياً نعم — مصدر واحد للحقيقة) */
  includeCheques?: boolean
  currencySymbol: string
  companyName: string
  period?: string
  printedBy?: string
  logoDataUrl?: string
  /** سطور الترويسة المعتمدة — تُمرَّر للطباعة والعرض معاً */
  headerLines?: string[]
  /** دالة تنسيق المبلغ (من money.formatMinor) */
  fmt: (m: Minor) => string
}

export interface ChequeCollectionRow {
  date: string
  number: string
  description: string
  method: string
  status: string
  amountMinor: Minor
  /** true = لا يُحتسب في الإجمالي (مرتد/ملغي أو خارج نطاق المشروع) */
  excluded?: boolean
  /** سبب الاستبعاد — يفرّق بين شيك مرتد (دين عاد) وشيك خارج نطاق المشروع (إيضاح فقط) */
  excludedReason?: 'bounced' | 'out-of-scope'
}

/** توزيع تحصيل على مستند (سند قبض/تسوية) — نفس شكل حقول data/repo.ts */
export interface DocAllocation { docKey: string; appliedMinor: Minor }

/**
 * بناء «ما خُصم فعلاً من ذمم مستخلصات المشروع» من مصدر واحد بلا تكرار
 * (مراجعة 2026-10-27: كانت الواجهة تجمع `getOpenClientInvoices().settledMinor`
 * — الذي يحتوي أصلاً توزيعات السندات والتسويات والشيكات — ثم تضيف توزيعات
 * السندات والتسويات مرة ثانية فيتضاعف المحصَّل ويصغر المتبقي خطأً).
 *
 * القاعدة: المستند المفتوح ⇒ `settledMinor` هو المرجع الوحيد (لا نضيف عليه
 * شيئاً). المستند غير المفتوح ⇒ سُدّد بالكامل؛ نقرأ توزيعاته الصريحة، فإن
 * وُجد `extractDues` (صافي الاستحقاق بعد المقاصة) نرفع القيمة إليه — لأن
 * الشيكات تُوزَّع FIFO داخل الدفتر بلا سجل توزيع صريح على المستخلص.
 */
export function buildExtractSettledMap(args: {
  extractDocKeys: readonly string[]
  /** نتيجة getOpenClientInvoices(clientId) — settledMinor يشمل كل التوزيعات */
  openInvoices: readonly { docKey: string; settledMinor: Minor }[]
  /** صافي استحقاق المستخلص الآجل بعد خصم استرداد الدفعة المقدمة — يُمرَّر فقط حين يتوفر دفتر العميل */
  extractDues?: ReadonlyMap<string, Minor>
  vouchers?: readonly { allocations?: readonly DocAllocation[] }[]
  clientSettlements?: readonly { allocations?: readonly DocAllocation[] }[]
  /**
   * دليل على وجود عملية سداد أصلاً (سند/تسوية/شيك للعميل). بدونه **لا** يُستنتج
   * أن مستنداً غائباً عن الدفتر المفتوح «مسدَّد بالكامل» — قد يكون غاب بسبب
   * تضارب ربط العميل لا بسبب السداد، فاستنتاج `due` عندها يخلق تحصيلاً وهمياً.
   */
  hasSettlementEvidence?: boolean
  /**
   * الدفتر **الكامل** (`getOpenClientInvoices(id, true)`): كل المستندات حاضرة
   * بما فيها المسدَّدة، فـ `settledMinor` هو الحقيقة الوحيدة. عندئذٍ **لا**
   * استنتاج إطلاقاً — المستخلص الغائب يعني «لا ذمة مرتبطة بهذا العميل»
   * (تضارب ربط/مستخلص نقدي) لا «سُدّد بالكامل». كان الاستنتاج بدليل سداد
   * على مستوى العميل يخلق تحصيلاً وهمياً حين يخصّ الشيك فاتورة أخرى.
   */
  fullLedger?: boolean
}): Map<string, Minor> {
  const keys = new Set(args.extractDocKeys)
  const out = new Map<string, Minor>()
  const openKeys = new Set<string>()
  for (const inv of args.openInvoices) {
    if (!keys.has(inv.docKey)) continue
    out.set(inv.docKey, inv.settledMinor)
    openKeys.add(inv.docKey)
  }
  /* توزيعات صريحة للمستندات التي سُدّدت بالكامل فغابت عن الدفتر المفتوح */
  const raw = new Map<string, Minor>()
  const collect = (rows?: readonly { allocations?: readonly DocAllocation[] }[]) => {
    for (const row of rows ?? []) for (const a of row.allocations ?? []) {
      if (!keys.has(a.docKey)) continue
      raw.set(a.docKey, (raw.get(a.docKey) ?? 0) + a.appliedMinor)
    }
  }
  collect(args.vouchers)
  collect(args.clientSettlements)
  for (const key of keys) {
    if (openKeys.has(key)) continue
    /* الدفتر الكامل ⇒ لا تخمين. الغياب هنا سببه تضارب ربط العميل أو
       مستخلص نقدي، وليس سداداً؛ استنتاج السداد كان يضيف تحصيلاً وهمياً. */
    if (args.fullLedger) continue
    const explicit = raw.get(key) ?? 0
    let settled = explicit
    const due = args.extractDues?.get(key) ?? 0
    /* الاستنتاج مشروط بدليل سداد: توزيع صريح على هذا المستند أو وجود
       سند/تسوية/شيك للعميل. بلا دليل نُبقي الصفرة ولا نخترع تحصيلاً. */
    const evidence = explicit > 0 || args.hasSettlementEvidence === true
    if (due > 0 && evidence) settled = Math.max(settled, due)
    if (settled > 0) out.set(key, settled)
  }
  return out
}

/**
 * يبني جدول التحصيلات مرتباً زمنياً مع المتبقي بعد كل عملية.
 * `collectedTarget` = إجمالي ما خُصم فعلاً من ذمم المستخلصات (المصدر الموثوق).
 */
export function buildCollectionRows(src: AnalyticalProjectSource): {
  rows: ChequeCollectionRow[]
  totalMinor: Minor
  running: Minor[]
  targetMinor: Minor
  /** سندات قبض قديمة بلا توزيعات — لا يمكن نسبها لمشروع بعينه */
  unattributedVouchers: number
  unattributedVoucherMinor: Minor
} {
  const extractKeys = new Set(src.extractDocKeys ?? [])
  const projectScoped = src.extractDocKeys != null
  const rows: ChequeCollectionRow[] = []
  let unattributedVouchers = 0
  let unattributedVoucherMinor = 0

  for (const v of src.vouchers ?? []) {
    if (v.reversed) continue
    /* سندات القبض قد تخص فواتير أخرى لنفس العميل؛ إن وُجدت التوزيعات نأخذ
       نصيب مستخلصات هذا المشروع وحدها فلا يظهر تحصيل غريب في «المتبقي».
       الجولة السادسة: السند القديم **بلا توزيعات** كان يُدرج بكامل قيمته في
       كل مشروع للعميل نفسه، مع أن دفتر الذمم لم يخصمه من أي مستخلص ⇒ تحصيل
       وهمي مكرّر. لا يجوز نسبه لمشروع بعينه؛ يُستثنى ويُذكر في الملاحظات. */
    let amount = v.amountMinor
    if (projectScoped) {
      if (!v.allocations) {
        unattributedVouchers += 1
        unattributedVoucherMinor += Math.max(0, v.amountMinor)
        continue
      }
      amount = v.allocations.filter((a) => extractKeys.has(a.docKey)).reduce((s, a) => s + a.appliedMinor, 0)
    }
    if (amount <= 0) continue
    rows.push({ date: v.date, number: v.number, description: v.description ?? 'سند قبض', method: 'نقدي / بنكي', status: 'محصّل', amountMinor: amount })
  }
  for (const st of src.clientSettlements ?? []) {
    /* تسوية بلا توزيع على مستخلصات المشروع ليست تحصيلاً له — كانت تُدرَج
       بكامل قيمتها فينسخ «المتبقي بعد كل تحصيل» بلا سبب (مراجعة 2026-10-27). */
    const amount = projectScoped
      ? (st.allocations ?? []).filter((a) => extractKeys.has(a.docKey)).reduce((s, a) => s + a.appliedMinor, 0)
      : st.amountMinor
    if (amount <= 0) continue
    rows.push({ date: st.date, number: st.number, description: 'تحصيل على مستخلصات', method: 'توزيع FIFO', status: 'محصّل', amountMinor: amount })
  }
  if (src.includeCheques !== false) {
    /* ترتيب الشيكات زميناً قبل توزيع السقف، حتى يُنسَب التحصيل للأقدم أولاً
       عند العرض — الدفتر يوزّع الإجمالي على المستندات الأقدم، ولا يربط شيكاً
       بعينه بمستند؛ لذلك نعرض النصيب على أقدم الأوراق توضيحاً لا ربطاً نهائياً. */
    const ordered = [...(src.cheques ?? [])].sort((a, b) =>
      (a.createdAt ?? a.settledAt ?? '').localeCompare(b.createdAt ?? b.settledAt ?? ''))
    let attributedLeft = src.chequeAttributedMinor ?? Number.POSITIVE_INFINITY
    const capped = src.chequeAttributedMinor != null
    for (const c of ordered) {
      if (c.direction !== 'incoming' || c.partyId == null) continue
      const bounced = c.status === 'bounced' || c.status === 'cancelled'
      let amount = c.amountMinor
      let scopeNote = ''
      if (!bounced && capped) {
        const taken = Math.max(0, Math.min(amount, attributedLeft))
        attributedLeft -= taken
        amount = taken
        if (taken === 0) scopeNote = ' — خارج نطاق هذا المشروع (وُزّع على مستندات أخرى)'
        else if (taken < c.amountMinor) scopeNote = ' — جزء مخصوم من ذمم هذا المشروع'
      }
      rows.push({
        date: (c.createdAt ?? c.settledAt ?? '').slice(0, 10),
        number: c.chequeNumber,
        description: `شيك وارد${c.bankName ? ` — ${c.bankName}` : ''}${scopeNote}`,
        method: 'ورقة قبض',
        status: bounced ? 'مرتد ✗' : amount === 0 ? 'خارج النطاق' : c.status === 'held' ? 'في الحافظة' : c.status === 'deposited' ? 'تحت التحصيل' : 'محصّل ✓',
        amountMinor: amount,
        excluded: bounced || amount === 0,
        excludedReason: bounced ? 'bounced' : amount === 0 ? 'out-of-scope' : undefined,
      })
    }
  }
  /* المقاصة مقيّدة بالمستحق (الحارس في core/contracting يمنع تجاوزها أصلاً). */
  const capRecovery = (e: (typeof src.extracts)[number]) => Math.min(e.dueMinor, Math.max(0, e.advanceRecoveryMinor ?? 0))
  /* استرداد الدفعة المقدمة (مقاصة داخل المستخلص) */
  for (const e of src.extracts) {
    const rec = capRecovery(e)
    if (rec <= 0) continue
    rows.push({ date: e.date, number: e.extractNumber, description: 'استرداد دفعة مقدمة من المستخلص', method: 'مقاصة 2109', status: 'مقاصة', amountMinor: rec })
  }
  /* المستخلصات النقدية: النقد المحصَّل فعلاً = المستحق − المقاصة.
     collection سابقاً كان يضيف dueMinor كاملاً **و** المقاصة ⇒ تضخّم التحصيل. */
  for (const e of src.extracts) {
    if (e.payment !== 'cash') continue
    const netCash = e.dueMinor - capRecovery(e)
    if (netCash <= 0) continue
    rows.push({
      date: e.date, number: e.extractNumber,
      description: capRecovery(e) > 0 ? 'مستخلص نقدي (بعد استرداد الدفعة المقدمة)' : 'مستخلص نقدي (محصّل وقت الاستخلاص)',
      method: 'نقدي', status: 'محصّل', amountMinor: netCash,
    })
  }

  rows.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number))

  /* الهدف = مجموع ما خُصم من ذمم المستخلصات + النقدي + المقاصة (مصدر واحد) */
  const creditSettled = [...(src.openInvoiceSettled ?? new Map<string, number>())]
    .filter(([k]) => !projectScoped || extractKeys.has(k))
    .reduce((s, [, v]) => s + v, 0)
  const cashExtracts = src.extracts.filter((e) => e.payment === 'cash').reduce((s, e) => s + (e.dueMinor - capRecovery(e)), 0)
  const recovered = src.extracts.reduce((s, e) => s + capRecovery(e), 0)
  /* includeCheques=false ⇒ سطور الشيكات مستبعدة، فيجب استبعاد نصيبها من
     `creditSettled` (الدفتر يحسبها ضمن المسدَّد) وإلا اختلف مجموع السطور
     عن الهدف وظهر «تنبيه مراجعة» كاذب وتضخّم المتبقي. */
  const excludedCheques = src.includeCheques === false
    ? Math.max(0, Math.min(creditSettled, src.chequeAttributedMinor ?? 0))
    : 0
  const targetMinor = creditSettled - excludedCheques + cashExtracts + recovered

  let remaining = src.extracts.reduce((s, e) => s + e.dueMinor, 0)
  const running: Minor[] = []
  for (const r of rows) {
    if (!r.excluded) remaining -= r.amountMinor
    running.push(Math.max(0, remaining))
  }
  const totalMinor = rows.filter((r) => !r.excluded).reduce((s, r) => s + r.amountMinor, 0)
  return { rows, totalMinor, running, targetMinor, unattributedVouchers, unattributedVoucherMinor }
}

/** يبني نموذج التقرير الرسمي الكامل (التصميم ③) */
export function buildAnalyticalProjectReport(src: AnalyticalProjectSource): FormalReportModel {
  const fmt = src.fmt
  const contractOriginal = src.project.contractValueMinor
  const contractEffective = contractOriginal + (src.changeOrdersApprovedMinor ?? 0)
  const extracted = src.extracts.reduce((s, e) => s + e.grossMinor, 0)
  const vat = src.extracts.reduce((s, e) => s + (e.vatMinor ?? 0), 0)
  const retention = src.extracts.reduce((s, e) => s + e.retentionMinor, 0)
  const dueTotal = src.extracts.reduce((s, e) => s + e.dueMinor, 0)

  const collections = buildCollectionRows(src)
  const collected = collections.targetMinor
  const overCollected = Math.max(0, collected - dueTotal)
  const remainingCollection = Math.max(0, dueTotal - collected)
  /* لا يجوز أن تتجاوز نسبة التحصيل 100٪ — التحصيل الزائد خلل في التوزيعات
     يُنبَّه عليه في الملاحظات بدل عرض رقم محاسبياً مستحيل. */
  const collectedPercent = dueTotal > 0 ? Math.min(100, Math.round((collected / dueTotal) * 1000) / 10) : 0

  /* ① المصروفات برصيد تراكمي */
  const expenses = [...src.expenses].sort((a, b) => a.date.localeCompare(b.date) || a.docNumber.localeCompare(b.docNumber))
  let cumulative = 0
  const expenseRows: FormalReportRow[] = expenses.map((e, i) => {
    cumulative += e.amountMinor
    return {
      cells: [
        String(i + 1), e.date.slice(0, 10), e.docNumber,
        { value: e.description, sub: e.party }, e.category ?? '—', fmt(e.amountMinor), fmt(cumulative),
      ],
    }
  })
  const totalExpenses = expenses.reduce((s, e) => s + e.amountMinor, 0)
  const expensesSection: FormalReportSection = {
    title: 'أولاً — المصروفات برصيد تراكمي',
    note: `${expenses.length} مستند`,
    headers: ['م', 'التاريخ', 'المستند', 'البيان', 'التصنيف', `المبلغ (${src.currencySymbol})`, `الرصيد التراكمي (${src.currencySymbol})`],
    numCols: [0, 1, 2, 5, 6],
    rows: expenseRows,
    totalRow: ['', '', '', 'إجمالي المصروفات', '', fmt(totalExpenses), fmt(totalExpenses)],
  }

  /* ② التحصيلات بالمتبقي بعد كل عملية */
  const collectionRows: FormalReportRow[] = collections.rows.map((r, i) => ({
    cells: [
      String(i + 1), r.date.slice(0, 10), r.number, r.description, r.method,
      { value: r.status, tone: r.excluded ? (r.excludedReason === 'bounced' ? 'negative' : 'muted') : 'positive' },
      r.excluded ? `(${fmt(r.amountMinor)})` : fmt(r.amountMinor),
      fmt(collections.running[i] ?? 0),
    ],
  }))
  const collectionsSection: FormalReportSection = {
    title: 'ثانياً — التحصيلات والمتبقي بعد كل عملية',
    note: `${collections.rows.filter((r) => !r.excluded).length} عملية`,
    headers: ['م', 'التاريخ', 'المستند', 'البيان', 'الوسيلة', 'الحالة', `المبلغ (${src.currencySymbol})`, `المتبقي بعد التحصيل (${src.currencySymbol})`],
    numCols: [0, 1, 2, 6, 7],
    rows: collectionRows,
    totalRow: ['', '', '', 'إجمالي التحصيلات', '', '', fmt(collected), fmt(remainingCollection)],
  }

  const notes: string[] = []
  const bouncedCount = collections.rows.filter((r) => r.excludedReason === 'bounced').length
  const outOfScopeCount = collections.rows.filter((r) => r.excludedReason === 'out-of-scope').length
  if (bouncedCount) notes.push(`الشيكات المرتدة (${bouncedCount}) معروضة للإيضاح بين قوسين ولا تُحتسب ضمن التحصيلات — دينها عاد للعميل.`)
  if (outOfScopeCount) notes.push(`شيكات خارج نطاق هذا المشروع (${outOfScopeCount}) معروضة بصفرة للإيضاح ولا تُحتسب ضمن تحصيلاته.`)
  if ((src.cheques ?? []).some((c) => c.direction === 'incoming' && c.status !== 'bounced' && c.status !== 'cancelled')) {
    notes.push('الشيكات الواردة مُدرَجة ضمن التحصيلات ومُخصومة من ذمم المستخلصات — مطابقة لكشف حساب العميل.')
  }
  if ((src.cheques ?? []).some((c) => c.direction === 'incoming' && (c.status === 'held' || c.status === 'deposited'))) {
    notes.push('الشيك في الحافظة أو تحت التحصيل يُخفض ذمة العميل، لكنه لا يعني دخول النقدية إلى البنك أو الخزينة بعد.')
  }
  if (src.chequeAttributedMinor != null && (src.cheques ?? []).some((c) => c.direction === 'incoming' && c.status !== 'bounced' && c.status !== 'cancelled')) {
    notes.push('توزيع نصيب المشروع على أرقام الشيكات في الجدول تقديري للعرض فقط؛ دفتر الذمم لا يحفظ ربط كل شيك بمستخلص معين.')
  }
  if (src.chequeAttributedMinor != null) {
    const totalActiveCheques = (src.cheques ?? [])
      .filter((c) => c.direction === 'incoming' && c.partyId != null && c.status !== 'bounced' && c.status !== 'cancelled')
      .reduce((s, c) => s + c.amountMinor, 0)
    if (totalActiveCheques > src.chequeAttributedMinor + 1) {
      notes.push(`الشيكات الواردة للعميل (${fmt(totalActiveCheques)}) تخص مستندات أخرى أيضاً؛ المُخصوم فعلاً من مستخلصات هذا المشروع ${fmt(src.chequeAttributedMinor)} فقط — والباقي معروض بصفرة «خارج النطاق» للإيضاح.`)
    }
  }
  if (collections.unattributedVouchers > 0) {
    notes.push(`سندات قبض غير موزّعة على مستندات (${collections.unattributedVouchers} بقيمة ${fmt(collections.unattributedVoucherMinor)}) لم تُحتسب ضمن تحصيلات هذا المشروع — راجع كشف حساب العميل لتوزيعها.`)
  }
  notes.push('التسوية الختامية معادلتان مستقلتان: ① المستحق − التحصيلات = المتبقي (ذمة العميل) · ② الإيراد المستخلص − المصروفات = نتيجة المشروع. لا تُطرح المصروفات من رصيد التحصيل.')
  if (overCollected > 1) {
    notes.push(`تنبيه مراجعة — تحصيل زائد: التحصيلات (${fmt(collected)}) تتجاوز صافي المستحق (${fmt(dueTotal)}) بـ ${fmt(overCollected)} — راجع توزيعات السندات/الشيكات على مستندات العميل.`)
  }
  if (Math.abs(collections.totalMinor - collected) > 1) {
    notes.push(`تنبيه مراجعة: مجموع سطور التحصيلات (${fmt(collections.totalMinor)}) يختلف عن المُخصوم من الذمم (${fmt(collected)}) — افحص التوزيعات.`)
  }

  return {
    title: 'تقرير متابعة مشروع',
    subtitle: `${src.project.nameAr} · ${src.project.code}${src.period ? ` · ${src.period}` : ''}`,
    period: src.period,
    companyName: src.companyName,
    printedBy: src.printedBy,
    logoDataUrl: src.logoDataUrl,
    headerLines: src.headerLines,
    meta: [
      { label: 'اسم المشروع', value: src.project.nameAr },
      { label: 'رمز المشروع', value: src.project.code },
      { label: 'العميل', value: src.project.clientName || '—' },
      { label: 'الحالة', value: src.project.status },
      { label: 'تاريخ البدء', value: src.project.startDate?.slice(0, 10) ?? '—' },
      { label: 'العملة', value: src.currencySymbol },
    ],
    indicators: [
      { label: 'قيمة العقد الأصلية', value: fmt(contractOriginal) },
      { label: 'أوامر التغيير المعتمدة', value: fmt(src.changeOrdersApprovedMinor ?? 0) },
      { label: 'قيمة العقد الفعلية', value: fmt(contractEffective), emphasis: true },
      { label: 'قيمة الأعمال المستخلصة', value: fmt(extracted) },
      { label: 'ض.ق.م محمّلة على العميل', value: fmt(vat) },
      { label: 'محتجز ضمان أعمال', value: fmt(retention) },
      { label: 'صافي المستحق على المستخلصات', value: fmt(dueTotal) },
      { label: 'إجمالي ما تم تحصيله', value: fmt(collected) },
      { label: 'المتبقي من التحصيل', value: fmt(remainingCollection), emphasis: true },
      { label: 'نسبة التحصيل', value: `${collectedPercent}٪` },
      { label: 'إجمالي المصروفات', value: fmt(totalExpenses) },
    ],
    sections: [expensesSection, collectionsSection],
    notes,
    equation: [
      { label: 'قيمة الأعمال المستخلصة', value: fmt(extracted) },
      { label: 'يُضاف: ض.ق.م محمّلة', value: fmt(vat) },
      { label: 'يُطرح: محتجز ضمان أعمال', value: `(${fmt(retention)})` },
      { label: 'صافي المستحق على المستخلصات', value: fmt(dueTotal), emphasis: true },
      { label: 'يُطرح: إجمالي التحصيلات (سندات + شيكات + مقاصات)', value: `(${fmt(collected)})` },
      { label: 'المتبقي من التحصيل — رصيد العميل المدين', value: fmt(remainingCollection), emphasis: true },
      /* بدء معادلة مستقلة: الإيراد − المصروفات. كان «يُطرح المصروفات» يأتي
         مباشرة بعد «المتبقي» فيوحي بخصمها من رصيد العميل، بينما القيمة
         المحسوبة كانت (الإيراد − المصروفات) — تناقض في التسوية الختامية. */
      { label: 'بداية مستقلة — قيمة الأعمال المستخلصة (إيراد المشروع)', value: fmt(extracted) },
      { label: 'يُطرح: إجمالي مصروفات المشروع', value: `(${fmt(totalExpenses)})` },
      { label: 'صافي نتيجة المشروع حتى تاريخه', value: fmt(extracted - totalExpenses), emphasis: true },
    ],
  }
}

/** للاستخدام في الواجهة: هل المستند مفتوح (متبقٍ > 0)؟ */
export function openRemaining(inv: Pick<OpenInvoice, 'dueMinor' | 'settledMinor'>): Minor {
  return Math.max(0, inv.dueMinor - inv.settledMinor)
}
