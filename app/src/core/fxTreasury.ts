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

/** مستند تحويل عملة — سجل دائم قابل للمراجعة من قيده */
export interface FxConversionDoc {
  id: number
  docNumber: string // FXC-0001
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
  /** مصاريف التحويل بعملة الدفتر */
  feeMinor: number
  /** ربح فرق العملة بعملة الدفتر (سعر التنفيذ أعلى من متوسط التكلفة) */
  gainMinor: number
  /** خسارة فرق العملة بعملة الدفتر */
  lossMinor: number
  journalEntryId: number
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

/** الاحتساب المرجّح: الخروج يخصم من القيمة الدفترية بنسبة متوسط التكلفة الحالي */
export function fxHoldingsFromFlows(flows: FxFlow[]): FxHolding[] {
  const map = new Map<string, FxHolding & { _decimals: 0 | 2 | 3 }>()
  const sorted = [...flows].sort((a, b) => (a.seq === b.seq ? (a.date === b.date ? a.ref.localeCompare(b.ref) : a.date.localeCompare(b.date)) : a.seq - b.seq))
  for (const flow of sorted) {
    if (flow.amountMinor <= 0) continue
    const key = `${flow.treasury}|${flow.currency}`
    const row = map.get(key) ?? { treasury: flow.treasury, currency: flow.currency, decimals: 2 as 0 | 2 | 3, amountMinor: 0, bookValueMinor: 0, avgRatePpm: 0, _decimals: 2 as 0 | 2 | 3 }
    if (flow.kind === 'in') {
      row.amountMinor += flow.amountMinor
      row.bookValueMinor += flow.bookValueMinor
    } else {
      /* الخروج بالمتوسط المرجّح: يحمل من القيمة الدفترية بالنسبة نفسها */
      const avg = row.amountMinor > 0 ? row.bookValueMinor / row.amountMinor : 0
      const takeValue = Math.min(row.bookValueMinor, Math.round(flow.amountMinor * avg))
      row.amountMinor = Math.max(0, row.amountMinor - flow.amountMinor)
      row.bookValueMinor = Math.max(0, row.bookValueMinor - takeValue)
    }
    map.set(key, row)
  }
  return [...map.values()]
    .filter((row) => row.amountMinor > 0 || row.bookValueMinor > 0)
    .map(({ _decimals, ...row }) => ({ ...row, decimals: _decimals, avgRatePpm: row.amountMinor > 0 ? Math.round((row.bookValueMinor / row.amountMinor) * 1_000_000) : 0 }))
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
  const outBookValueMinor = convertFxToBookMinor(
    { ...outLeg, ratePpm: fromIsBook ? 1_000_000 : input.acquisitionRatePpm },
    input.bookDecimals,
  )
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
  const flows: FxFlow[] = []
  const fromIsBook = doc.fromCurrency.toUpperCase() === bookCurrencyCode.toUpperCase()
  const toIsBook = doc.toCurrency.toUpperCase() === bookCurrencyCode.toUpperCase()
  if (!fromIsBook) {
    flows.push({ date: doc.date, seq: doc.journalEntryId, treasury: doc.fromTreasury, currency: doc.fromCurrency, amountMinor: doc.fromAmountMinor, bookValueMinor: computeFxConversion({
      fromCurrency: doc.fromCurrency, fromDecimals: doc.fromDecimals, toCurrency: doc.toCurrency, toDecimals: doc.toDecimals,
      fromTreasury: doc.fromTreasury, toTreasury: doc.toTreasury,
      fromAmountMinor: doc.fromAmountMinor, fromRatePpm: doc.fromRatePpm, toRatePpm: doc.toRatePpm,
      feeMinor: doc.feeMinor, bookDecimals, bookCurrencyCode, acquisitionRatePpm: doc.acquisitionRatePpm,
    }).outBookValueMinor, kind: 'out', ref: doc.docNumber })
  }
  if (!toIsBook) {
    flows.push({ date: doc.date, seq: doc.journalEntryId, treasury: doc.toTreasury, currency: doc.toCurrency, amountMinor: doc.toAmountMinor, bookValueMinor: computeFxConversion({
      fromCurrency: doc.fromCurrency, fromDecimals: doc.fromDecimals, toCurrency: doc.toCurrency, toDecimals: doc.toDecimals,
      fromTreasury: doc.fromTreasury, toTreasury: doc.toTreasury,
      fromAmountMinor: doc.fromAmountMinor, fromRatePpm: doc.fromRatePpm, toRatePpm: doc.toRatePpm,
      feeMinor: doc.feeMinor, bookDecimals, bookCurrencyCode, acquisitionRatePpm: doc.acquisitionRatePpm,
    }).netBookMinor, kind: 'in', ref: doc.docNumber })
  }
  return flows
}
