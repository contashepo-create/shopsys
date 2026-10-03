/**
 * نافذة التحصيل/السداد بعملة أجنبية (§93 — طلب المالك):
 * «طريقة تقسيم الدفع والتحصيل بالعملة الأجنبية متداخلة للغاية في الفاتورة —
 * أريدها زراً أضغطه فيفتح نافذة منبثقة بكل الحقول حتى أحصل المبلغ، وعند
 * الحفظ يظهر المبلغ تلقائياً في التحصيل بالفاتورة».
 *
 * زر واحد في لوحة الدفع ⇐ هذه النافذة: العملة والمبلغ وسعر الصرف وسعر
 * اليوم المحفوظ والمعاينة الحية بحاصل التحويل بعملة الدفتر — والقيد يبقى
 * بعملة الدفتر كما هو. لا منطق ترحيل هنا؛ الترحيل من الفاتورة نفسها.
 */
import { useEffect, useState } from 'react'
import { Banknote, X } from 'lucide-react'
import { Btn, Field, Modal, inputCls } from './ui.tsx'
import { FxRatesManager } from './FxRatesManager.tsx'
import {
  COMMON_FX_CURRENCIES, convertFxToBookMinor, describeFxLeg, formatRate, parseRateToPpm,
  validateFxLeg, type FxLeg,
} from '../../core/foreignCurrency.ts'
import { fxLegWithDefaultRate, fxRateAgeLabel, type FxRatesMap } from '../../core/fxRates.ts'
import { formatMinor, toMinor } from '../../core/money.ts'

export interface FxCollectLegDraft { code: string; amount: string; rate: string }

export interface FxCollectModalProps {
  open: boolean
  onClose: () => void
  /** «التحصيل» في البيع أو «السداد» في الشراء */
  verb: string
  bookCurrency: { code: string; symbol: string; decimals: 0 | 2 | 3 }
  /** قيم المسودة الحالية — تُلتقط عند فتح النافذة فقط */
  leg: FxCollectLegDraft
  rates: FxRatesMap
  /** هل التحصيل الأجنبي مفعّل في الفاتورة الآن؟ (يعرض زر الإزالة) */
  active: boolean
  onApply: (leg: FxCollectLegDraft) => void
  onClear: () => void
}

export function FxCollectModal({ open, onClose, verb, bookCurrency, leg, rates, active, onApply, onClear }: FxCollectModalProps) {
  const [code, setCode] = useState(leg.code)
  const [amount, setAmount] = useState(leg.amount)
  const [rate, setRate] = useState(leg.rate)
  const [ratesOpen, setRatesOpen] = useState(false)

  /* تُلتقط قيم المسودة عند الفتح فقط — التعديل داخل النافذة لا يرتد للفاتورة قبل الحفظ */
  useEffect(() => {
    if (!open) return
    setCode(leg.code)
    setAmount(leg.amount)
    setRate(leg.rate)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const meta = COMMON_FX_CURRENCIES.find((row) => row.code === code) ?? COMMON_FX_CURRENCIES[0]
  const draft: FxLeg = fxLegWithDefaultRate({
    currencyCode: code,
    amountMinor: (() => { try { return toMinor(amount || '0', meta.decimals) } catch { return 0 } })(),
    ratePpm: parseRateToPpm(rate),
    decimals: meta.decimals,
  }, rates)
  const errors = validateFxLeg(draft, bookCurrency.code)
  const bookMinor = errors.length ? 0 : convertFxToBookMinor(draft, bookCurrency.decimals)
  const savedRate = rates[draft.currencyCode]

  const apply = () => {
    if (errors.length) return
    onApply({ code: draft.currencyCode, amount, rate: formatRate(draft.ratePpm) })
    onClose()
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title={`${verb} بعملة أجنبية`} subtitle={`نافذة واحدة لكل الحقول — والمبلغ يظهر تلقائياً في ${verb} بالفاتورة بعملة الدفتر ${bookCurrency.code}`} data-fx-collect-modal>
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="العملة الأجنبية">
              <select value={code} onChange={(e) => setCode(e.target.value)} className={inputCls} aria-label="العملة الأجنبية" data-fx-code="true">
                {COMMON_FX_CURRENCIES.filter((row) => row.code !== bookCurrency.code).map((row) => (
                  <option key={row.code} value={row.code}>{row.code} — {row.nameAr}</option>
                ))}
              </select>
            </Field>
            <Field label={`المبلغ بالـ${draft.currencyCode}`}>
              <input className={inputCls + ' text-center font-mono font-bold'} value={amount} onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal" placeholder="0.00" dir="ltr" aria-label={`المبلغ بالعملة الأجنبية`} data-fx-amount="true" />
            </Field>
            <Field label={`سعر الصرف مقابل ${bookCurrency.code}`} hint="كم وحدة من عملة الدفتر مقابل وحدة واحدة">
              <input className={inputCls + ' text-center font-mono font-bold'} value={rate} onChange={(e) => setRate(e.target.value)}
                inputMode="decimal" placeholder="0.00" dir="ltr" aria-label="سعر الصرف" data-fx-rate="true" />
            </Field>
          </div>

          <button type="button" className="invoice-doc-fx-today" data-fx-today onClick={() => setRatesOpen(true)}
            title="اضغط لفتح نافذة أسعار الصرف — مفلترة تلقائياً على هذه العملة">
            {savedRate
              ? <>سعر اليوم المحفوظ: <b dir="ltr">{formatRate(savedRate.ratePpm)}</b> {draft.currencyCode}→{bookCurrency.code} · {fxRateAgeLabel(savedRate)} · اضغط للتعديل</>
              : <>لا سعر محفوظ لـ{draft.currencyCode} — اضغط لتعيينه</>}
          </button>

          {/* المعاينة الحية: حاصل التحويل الذي سيتعبأ في التحصيل تلقائياً */}
          <div className={`rounded-xl p-3 text-center ${errors.length ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300' : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'}`} data-fx-preview="true">
            {errors.length
              ? <span className="text-[12px] font-black">{errors.join(' — ')}</span>
              : <>
                  <div className="text-[11px] font-bold opacity-80">سيظهر في {verb} بالفاتورة تلقائياً</div>
                  <div className="mt-0.5 text-xl font-black tabular-nums" dir="ltr">
                    {formatMinor(bookMinor, { code: bookCurrency.code, symbol: bookCurrency.symbol, decimals: bookCurrency.decimals, name: '' }, false)} {bookCurrency.code}
                  </div>
                  <div className="mt-0.5 text-[10.5px] font-bold opacity-75" dir="ltr">{describeFxLeg(draft, bookMinor, bookCurrency.decimals)}</div>
                </>}
          </div>

          <p className="text-[10.5px] leading-relaxed text-slate-500">
            القيد يبقى بعملة الدفتر {bookCurrency.code} — الذمة تنقص/تزيد بالمحوَّل. العملة الأجنبية تُرحَّل كساق توثيقية على المستند وتدخل رصيد الخزينة في «تقرير العملات».
          </p>

          <div className="flex flex-wrap items-center justify-between gap-2">
            {active
              ? <Btn variant="ghost" onClick={() => { onClear(); onClose() }} className="!text-rose-600" data-fx-clear>
                  <span className="flex items-center gap-1.5"><X size={14} /> إزالة {verb} الأجنبي</span>
                </Btn>
              : <span />}
            <div className="flex flex-wrap gap-2">
              <Btn variant="ghost" onClick={onClose}>رجوع</Btn>
              <Btn onClick={apply} disabled={errors.length > 0} className="!bg-teal-600 hover:!bg-teal-500 !text-white font-black px-5" data-fx-apply>
                <span className="flex items-center gap-1.5"><Banknote size={15} /> حفظ وتعبئة {verb} تلقائياً</span>
              </Btn>
            </div>
          </div>
        </div>
      </Modal>

      <Modal open={ratesOpen} onClose={() => setRatesOpen(false)} title={`سعر ${draft.currencyCode} مقابل ${bookCurrency.code} — تعديل بأسعار الصرف`} data-fx-rates-popup>
        <FxRatesManager focusCode={draft.currencyCode} onDone={() => setRatesOpen(false)} />
      </Modal>
    </>
  )
}
