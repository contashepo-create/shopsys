/**
 * خزائن العملات الأجنبية (§93 — طلب المالك):
 * «أريد تقريراً للعملات أعرف منه كم المبلغ الموجود من كل عملة ومكانه،
 * وتحويل من عملة لأخرى يسجَّل بمصاريف التحويل إن وجدت، وفارق العملة بين
 * وقت التحصيل ووقت التحويل يُقيَّد مصروفاً أو إيراداً حسب الفرق».
 *
 * التصميم المحاسبي:
 *   • الدفتر أحادي العملة: كل تحصيل أجنبي قُيّد بخزينته **بقيمته الدفترية
 *     يوم التحصيل** (سعر التحصيل)، والعملة الأجنبية نفسها ساق توثيقية
 *     تُبنى منها «أرصدة مذكرة» لكل (خزينة × عملة).
 *   • أرصدة المذكرة تُحتسب من تدفقات المستندات (بيع/شراء/سندات/تحويلات)
 *     بلا حالة جديدة قابلة للانفصال — مصدر حقيقة واحد.
 *   • متوسط سعر التكلفة (المُرجَّح) لكل رصيد = القيمة الدفترية ÷ الكمية.
 *   • التحويل fx→دفتر: تخفيض القيمة الدفترية للعملة بمتوسط تكلفتها،
 *     واستلام الصافي بعد المصاريف — والفرق (سعر التنفيذ − متوسط التكلفة)
 *     ربح 4117 أو خسارة 5119. شراء الدفتر→fx: تكلفة الشراء بلا أرباح.
 */
import { assertBalanced, type JournalLine } from './ledger.ts'
import { convertFxToBookMinor, type FxLeg } from './foreignCurrency.ts'

export const FX_CONVERSION_FEE_ACCOUNT = '5108' // مصروفات عمومية — مصاريف التحويل
export const FX_GAIN_ACCOUNT = '4117' // أرباح فروق عملة
export const FX_LOSS_ACCOUNT = '5119' // خسائر فروق عملة

/** النوع الغائب في السجلات القديمة هو تحويل العملات المعتاد. */
export type FxConversionKind = 'currency_conversion' | 'treasury_transfer'

/** مستند تحويل عملة — سجل دائم قابل للمراجعة من قيده */
export interface FxConversionDoc {
  id: number
  docNumber: string // FXC-0001
  /** تحويل نفس العملة بين خزينتين دون صرف أو فرق سعر. */
  kind?: FxConversionKind
  date: string
  fromCurrency: string
  fromDecimals: 0 | 2 | 3
  toCurrency: string
  toDecimals: 0 | 2 | 3
  fromTreasury: string
  toTreasury: string
  /** المبلغ المصروف من العملة الأولى بوحداتها الصغرى */
  fromAmountMinor: number
  /** المبلغ المستلم من العملة الثانية بوحداتها الصغرى */
  toAmountMinor: number
  /** سعر تنفيذ المصروف (دفتر لكل وحدة من عملة المصروف) */
  fromRatePpm: number
  /** سعر تنفيذ المستلم (دفتر لكل وحدة من عملة الاستلام) */
  toRatePpm: number
  /** متوسط تكلفة العملة المصروفة وقت التحويل (دفتر لكل وحدة) — 1e6 لعملة الدفتر */
  acquisitionRatePpm: number
  /** تكلفة العملة المصروفة الدقيقة في القيد؛ غائبة عن المستندات القديمة. */
  outBookValueMinor?: number
  /** مصاريف التحويل بعملة الدفتر */
  feeMinor: number
  /** ربح فرق العملة بعملة الدفتر (سعر التنفيذ أعلى من متوسط التكلفة) */
  gainMinor: number
  /** خسارة فرق العملة بعملة الدفتر */
  lossMinor: number
  journalEntryId: number
  /** قيد عكس مثبت لتحويل الخزائن الملغى؛ الأصل محفوظ. */
  reversalEntryId?: number | null
  notes?: string
  createdBy: string
  createdAt: string
}

/** تدفق مذكرة: دخول أو خروج عملة أجنبية من خزينة */
export interface FxFlow {
  date: string
  /** تسلسل التدفق (رقم القيد) — يضمن معالجة التدفقات بترتيب حدوثها الفعلي لا الأبجدي */
  seq: number
  treasury: string
  currency: string
  /** خانات العملة كما سُجلت في المستند الأصلي، لا حسب افتراض الشاشة. */
  decimals: 0 | 2 | 3
  amountMinor: number // موجب
  bookValueMinor: number // القيمة الدفترية المقابلة وقت التدفق
  kind: 'in' | 'out'
  ref: string
}

/** رصيد مذكرة لكل (خزينة × عملة) — بمتوسط تكلفة مرجّح */
export interface FxHolding {
  treasury: string
  currency: string
  decimals: 0 | 2 | 3
  amountMinor: number
  bookValueMinor: number
  /** متوسط سعر التكلفة (دفتر لكل وحدة عملة) × 1e6 — صفر عند عدم وجود رصيد */
  avgRatePpm: number
}

/** تكلفة كمية مصروفة بنسبة رصيدها، دون تقريب سعر المتوسط أولاً. */
export function proportionalFxCost(bookValueMinor: number, amountMinor: number, outAmountMinor: number): number {
  if (![bookValueMinor, amountMinor, outAmountMinor].every(Number.isSafeInteger) || bookValueMinor < 0 || amountMinor <= 0 || outAmountMinor < 0) throw new Error('رصيد العملة أو مبلغ الصرف غير صالح — يلزم المراجعة')
  const numerator = BigInt(bookValueMinor) * BigInt(Math.min(amountMinor, outAmountMinor))
  const denominator = BigInt(amountMinor)
  return Number((numerator + denominator / 2n) / denominator)
}

/** الاحتساب المرجّح: الخروج يخصم من القيمة الدفترية بنسبة متوسط التكلفة الحالي */
export function fxHoldingsFromFlows(flows: FxFlow[], bookDecimals: 0 | 2 | 3 = 2): FxHolding[] {
  const map = new Map<string, FxHolding & { _decimals: 0 | 2 | 3 }>()
  const sorted = [...flows].sort((a, b) => (a.seq === b.seq ? (a.date === b.date ? a.ref.localeCompare(b.ref) : a.date.localeCompare(b.date)) : a.seq - b.seq))
  for (const flow of sorted) {
    if (flow.amountMinor <= 0) continue
    const key = `${flow.treasury}|${flow.currency}`
    if (![0, 2, 3].includes(flow.decimals) || !Number.isSafeInteger(flow.amountMinor) || !Number.isSafeInteger(flow.bookValueMinor) || flow.bookValueMinor < 0) throw new Error(`بيانات حركة العملة ${flow.currency} غير صالحة — يلزم المراجعة`)
    const row = map.get(key) ?? { treasury: flow.treasury, currency: flow.currency, decimals: flow.decimals, amountMinor: 0, bookValueMinor: 0, avgRatePpm: 0, _decimals: flow.decimals }
    if (row._decimals !== flow.decimals) throw new Error(`خانات العملة ${flow.currency} متعارضة في الخزينة ${flow.treasury} — يلزم المراجعة`)
    if (flow.kind === 'in') {
      row.amountMinor += flow.amountMinor
      row.bookValueMinor += flow.bookValueMinor
      if (!Number.isSafeInteger(row.amountMinor) || !Number.isSafeInteger(row.bookValueMinor)) throw new Error('رصيد العملة خارج النطاق الآمن — يلزم المراجعة')
    } else {
      if (flow.amountMinor > row.amountMinor) throw new Error(`رصيد ${flow.currency} في الخزينة ${flow.treasury} غير مثبت قبل ${flow.ref} — يلزم مراجعة التدفقات`)
      /* الخروج بالمتوسط المرجّح: يحمل من القيمة الدفترية بالنسبة نفسها */
      const takeValue = row.amountMinor > 0 ? proportionalFxCost(row.bookValueMinor, row.amountMinor, flow.amountMinor) : 0
      row.amountMinor = Math.max(0, row.amountMinor - flow.amountMinor)
      row.bookValueMinor = Math.max(0, row.bookValueMinor - takeValue)
    }
    map.set(key, row)
  }
  return [...map.values()]
    .filter((row) => row.amountMinor > 0 || row.bookValueMinor > 0)
    .map(({ _decimals, ...row }) => {
      const numerator = BigInt(row.bookValueMinor) * 10n ** BigInt(_decimals) * 1_000_000n
      const denominator = BigInt(row.amountMinor) * 10n ** BigInt(bookDecimals)
      const rate = denominator > 0n ? Number((numerator + denominator / 2n) / denominator) : 0
      if (!Number.isSafeInteger(rate)) throw new Error('متوسط سعر العملة خارج النطاق الآمن — يلزم المراجعة')
      return { ...row, decimals: _decimals, avgRatePpm: rate }
    })
}

/** لا نغيّر القيود القديمة: نوقف التحويل الجديد إذا تعذر إثبات تكلفة تحويل سابق. */
export function fxConversionHistoryIssues(docs: FxConversionDoc[], flows: FxFlow[], bookCurrencyCode: string, bookDecimals: 0 | 2 | 3): string[] {
  const issues: string[] = []
  for (const doc of docs) {
    if (doc.reversalEntryId != null) continue
    if (doc.fromCurrency.toUpperCase() === bookCurrencyCode.toUpperCase()) continue
    const before = fxHoldingsFromFlows(flows.filter(flow => flow.seq < doc.journalEntryId), bookDecimals)
    const holding = before.find(row => row.treasury === doc.fromTreasury && row.currency.toUpperCase() === doc.fromCurrency.toUpperCase())
    const recordedCost = doc.outBookValueMinor ?? convertFxToBookMinor({ currencyCode: doc.fromCurrency, amountMinor: doc.fromAmountMinor, ratePpm: doc.acquisitionRatePpm, decimals: doc.fromDecimals }, bookDecimals)
    if (!holding || holding.decimals !== doc.fromDecimals || holding.amountMinor < doc.fromAmountMinor || holding.avgRatePpm !== doc.acquisitionRatePpm || recordedCost !== proportionalFxCost(holding.bookValueMinor, holding.amountMinor, doc.fromAmountMinor)) issues.push(doc.docNumber)
  }
  // سندات/مشتريات أجنبية سابقة تخرج بالسعر الاسمي من الخزينة، بينما
  // رصيد المذكرة ينقص بتكلفة الحيازة. لا نخمّن قيد فروقها بعد الترحيل.
  const conversionKeys = new Set(docs.map(doc => `${doc.journalEntryId}|${doc.docNumber}`))
  for (const flow of flows) {
    if (flow.kind !== 'out' || conversionKeys.has(`${flow.seq}|${flow.ref}`)) continue
    const before = fxHoldingsFromFlows(flows.filter(previous => previous.seq < flow.seq), bookDecimals)
    const holding = before.find(row => row.treasury === flow.treasury && row.currency.toUpperCase() === flow.currency.toUpperCase())
    if (!holding || holding.decimals !== flow.decimals || holding.amountMinor < flow.amountMinor || proportionalFxCost(holding.bookValueMinor, holding.amountMinor, flow.amountMinor) !== flow.bookValueMinor) issues.push(flow.ref)
  }
  return [...new Set(issues)]
}

export interface FxConversionInput {
  fromCurrency: string
  fromDecimals: 0 | 2 | 3
  toCurrency: string
  toDecimals: 0 | 2 | 3
  fromTreasury: string
  toTreasury: string
  fromAmountMinor: number
  fromRatePpm: number // 1e6 عندما تكون عملة المصروف هي عملة الدفتر
  toRatePpm: number // 1e6 عندما تكون عملة الاستلام هي عملة الدفتر
  feeMinor: number
  bookDecimals: 0 | 2 | 3
  bookCurrencyCode: string
  acquisitionRatePpm: number // متوسط تكلفة عملة المصروف (1e6 للدفتر) — يُمرَّر من المستودع
  acquisitionBookValueMinor?: number // التكلفة النسبية الدقيقة من الرصيد، قبل تقريب السعر
}

/** نتيجة التحويل المحسوبة — تُعرض معاينتها قبل الترحيل وتُخزَّن في المستند */
export function computeFxConversion(input: FxConversionInput): {
  grossBookMinor: number
  netBookMinor: number
  outBookValueMinor: number
  toAmountMinor: number
  gainMinor: number
  lossMinor: number
} {
  const fromIsBook = input.fromCurrency.toUpperCase() === input.bookCurrencyCode.toUpperCase()
  const toIsBook = input.toCurrency.toUpperCase() === input.bookCurrencyCode.toUpperCase()
  const outLeg: FxLeg = { currencyCode: input.fromCurrency, amountMinor: input.fromAmountMinor, ratePpm: fromIsBook ? 1_000_000 : input.fromRatePpm, decimals: input.fromDecimals }
  /* القيمة الدفترية للخروج: بمتوسط التكلفة (لا بسعر اليوم) — منه يُحتسب الفرق */
  const outBookValueMinor = !fromIsBook && input.acquisitionBookValueMinor != null
    ? input.acquisitionBookValueMinor
    : convertFxToBookMinor({ ...outLeg, ratePpm: fromIsBook ? 1_000_000 : input.acquisitionRatePpm }, input.bookDecimals)
  const grossBookMinor = convertFxToBookMinor(outLeg, input.bookDecimals)
  const netBookMinor = grossBookMinor - input.feeMinor
  /* المبلغ المستلم بعملة الاستلام: عكس التحويل للصافي بعد المصاريف */
  /* صيغة معكوسة لتحويل الصافي: fxMinor = netBook × 10^toDec × 1e6 ÷ (rate × 10^bookDec) */
  const toAmountMinor = toIsBook
    ? netBookMinor
    : Math.round((netBookMinor * (10 ** input.toDecimals) * 1_000_000) / (input.toRatePpm * (10 ** input.bookDecimals)))
  const diff = netBookMinor + input.feeMinor - outBookValueMinor
  return {
    grossBookMinor,
    netBookMinor,
    outBookValueMinor,
    toAmountMinor,
    gainMinor: diff > 0 ? diff : 0,
    lossMinor: diff < 0 ? -diff : 0,
  }
}

/** فحوص التحويل قبل أي كتابة — كلها رسائل عربية صريحة */
export function validateFxConversion(input: FxConversionInput, holdingAmountMinor: number | null): string[] {
  const errors: string[] = []
  const from = input.fromCurrency.trim().toUpperCase()
  const to = input.toCurrency.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) errors.push('رمزا العملتين يجب أن يكونا ثلاثة حروف (USD مثلاً)')
  if (from === to) errors.push('لا تحويل بين العملة ونفسها')
  if (!Number.isInteger(input.fromAmountMinor) || input.fromAmountMinor <= 0) errors.push('المبلغ المصروف يجب أن يكون أكبر من صفر')
  if (!Number.isInteger(input.feeMinor) || input.feeMinor < 0) errors.push('مصاريف التحويل لا تكون سالبة')
  const fromIsBook = from === input.bookCurrencyCode.toUpperCase()
  const toIsBook = to === input.bookCurrencyCode.toUpperCase()
  if (!fromIsBook && (!Number.isInteger(input.fromRatePpm) || input.fromRatePpm <= 0)) errors.push('سعر تنفيذ العملة المصروفة مطلوب وأكبر من صفر')
  if (!toIsBook && (!Number.isInteger(input.toRatePpm) || input.toRatePpm <= 0)) errors.push('سعر تنفيذ العملة المستلمة مطلوب وأكبر من صفر')
  if (!fromIsBook && !toIsBook && input.fromRatePpm <= 0 && input.toRatePpm <= 0) errors.push('سعرا التنفيذ مطلوبان لتحويل أجنبي بأجنبي')
  if (holdingAmountMinor != null && input.fromAmountMinor > holdingAmountMinor)
    errors.push(`رصيد ${from} في الخزينة المصروفة لا يكفي — المتاح ${holdingAmountMinor} بوحداتها الصغرى (راجع تقرير العملات)`)
  const computed = computeFxConversion(input)
  if (computed.netBookMinor <= 0) errors.push('المصاريف تبتلع كامل المبلغ — صافي التحويل صفر')
  if (computed.toAmountMinor <= 0) errors.push('المبلغ المستلم بعد المصاريف صفر')
  return errors
}

/** قيد التحويل المتوازن: استلام الصافي + المصاريف + فرق العملة ⇐ إخراج القيمة الدفترية */
export function buildFxConversionEntry(
  input: FxConversionInput,
  computed: ReturnType<typeof computeFxConversion>,
  label: string,
): JournalLine[] {
  const fromIsBook = input.fromCurrency.trim().toUpperCase() === input.bookCurrencyCode.toUpperCase()
  const toIsBook = input.toCurrency.trim().toUpperCase() === input.bookCurrencyCode.toUpperCase()
  const fromLabel = fromIsBook ? input.bookCurrencyCode.toUpperCase() : input.fromCurrency.toUpperCase()
  const toLabel = toIsBook ? input.bookCurrencyCode.toUpperCase() : input.toCurrency.toUpperCase()
  const lines: JournalLine[] = [
    { accountCode: input.toTreasury, debit: computed.netBookMinor, credit: 0, note: `استلام ${label} — ${toLabel}` },
  ]
  if (input.feeMinor > 0) {
    lines.push({ accountCode: FX_CONVERSION_FEE_ACCOUNT, debit: input.feeMinor, credit: 0, note: `مصاريف تحويل عملة ${label}` })
  }
  if (computed.lossMinor > 0) {
    lines.push({ accountCode: FX_LOSS_ACCOUNT, debit: computed.lossMinor, credit: 0, note: `خسارة فرق عملة — سعر التنفيذ أقل من متوسط تكلفة ${fromLabel}` })
  }
  lines.push({ accountCode: input.fromTreasury, debit: 0, credit: computed.outBookValueMinor, note: `إخراج ${fromLabel} بقيمته الدفترية (متوسط التكلفة) — ${label}` })
  if (computed.gainMinor > 0) {
    lines.push({ accountCode: FX_GAIN_ACCOUNT, debit: 0, credit: computed.gainMinor, note: `ربح فرق عملة — سعر التنفيذ أعلى من متوسط تكلفة ${fromLabel}` })
  }
  assertBalanced(lines)
  return lines
}

/** حركة مذكرة التحويل: خروج من عملة المصروف ودخول لعملة الاستلام (إن كانتا أجنبيتين) */
export function fxConversionFlows(doc: FxConversionDoc, bookCurrencyCode: string, bookDecimals: 0 | 2 | 3): FxFlow[] {
  if (doc.kind === 'treasury_transfer') {
    if (!/^[A-Z]{3}$/.test(doc.fromCurrency) || doc.fromCurrency === bookCurrencyCode.toUpperCase() || doc.toCurrency !== doc.fromCurrency || doc.fromTreasury === doc.toTreasury || doc.fromDecimals !== doc.toDecimals || doc.fromAmountMinor !== doc.toAmountMinor || !Number.isSafeInteger(doc.outBookValueMinor) || doc.outBookValueMinor! <= 0 || doc.feeMinor !== 0 || doc.gainMinor !== 0 || doc.lossMinor !== 0) throw new Error(`بيانات تحويل الخزائن ${doc.docNumber} غير مطابقة — يلزم المراجعة`)
    const common = { date: doc.date, seq: doc.journalEntryId, currency: doc.fromCurrency, decimals: doc.fromDecimals, amountMinor: doc.fromAmountMinor, bookValueMinor: doc.outBookValueMinor!, ref: doc.docNumber }
    return [{ ...common, treasury: doc.fromTreasury, kind: 'out' }, { ...common, treasury: doc.toTreasury, kind: 'in' }]
  }
  const flows: FxFlow[] = []
  const fromIsBook = doc.fromCurrency.toUpperCase() === bookCurrencyCode.toUpperCase()
  const toIsBook = doc.toCurrency.toUpperCase() === bookCurrencyCode.toUpperCase()
  if (!fromIsBook) {
    flows.push({ date: doc.date, seq: doc.journalEntryId, treasury: doc.fromTreasury, currency: doc.fromCurrency, decimals: doc.fromDecimals, amountMinor: doc.fromAmountMinor, bookValueMinor: doc.outBookValueMinor ?? computeFxConversion({
      fromCurrency: doc.fromCurrency, fromDecimals: doc.fromDecimals, toCurrency: doc.toCurrency, toDecimals: doc.toDecimals,
      fromTreasury: doc.fromTreasury, toTreasury: doc.toTreasury,
      fromAmountMinor: doc.fromAmountMinor, fromRatePpm: doc.fromRatePpm, toRatePpm: doc.toRatePpm,
      feeMinor: doc.feeMinor, bookDecimals, bookCurrencyCode, acquisitionRatePpm: doc.acquisitionRatePpm,
    }).outBookValueMinor, kind: 'out', ref: doc.docNumber })
  }
  if (!toIsBook) {
    flows.push({ date: doc.date, seq: doc.journalEntryId, treasury: doc.toTreasury, currency: doc.toCurrency, decimals: doc.toDecimals, amountMinor: doc.toAmountMinor, bookValueMinor: computeFxConversion({
      fromCurrency: doc.fromCurrency, fromDecimals: doc.fromDecimals, toCurrency: doc.toCurrency, toDecimals: doc.toDecimals,
      fromTreasury: doc.fromTreasury, toTreasury: doc.toTreasury,
      fromAmountMinor: doc.fromAmountMinor, fromRatePpm: doc.fromRatePpm, toRatePpm: doc.toRatePpm,
      feeMinor: doc.feeMinor, bookDecimals, bookCurrencyCode, acquisitionRatePpm: doc.acquisitionRatePpm,
    }).netBookMinor, kind: 'in', ref: doc.docNumber })
  }
  return flows
}
