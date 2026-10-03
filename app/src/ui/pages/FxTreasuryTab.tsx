/**
 * تبويب «العملات» بمركز التقارير (§93 — طلب المالك):
 * «أريد تقريراً للعملات أعرف منه كم المبلغ الموجود من كل عملة ومكانه،
 * وتحويل من عملة لأخرى يسجل بمصاريف التحويل إن وجدت، مع فارق العملة
 * بين وقت التحصيل ووقت التحويل مصروفاً أو إيراداً حسب الفرق».
 *
 * ① أرصدة العملات الأجنبية بكل خزينة/بنك (المكان) — بالرصيد الفعلي
 *    ومتوسط سعر التكلفة والقيمة الدفترية والقيمة بسعر اليوم والفرق غير المحقق.
 * ② نافذة «تحويل عملة»: من عملة/خزينة إلى عملة/خزينة بسعر التنفيذ
 *    والمصاريف — بمعاينة حية للمستلم وفرق العملة قبل الترحيل.
 * ③ سجل تحويلات العملة + آخر التدفقات (من أين جاء الرصيد وإلى أين ذهب).
 */
import { useMemo, useState } from 'react'
import { Banknote, ArrowLeftRight, Printer, Coins } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { COMMON_FX_CURRENCIES, convertFxToBookMinor, formatRate, parseRateToPpm } from '../../core/foreignCurrency.ts'
import { computeFxConversion, validateFxConversion } from '../../core/fxTreasury.ts'
import { renderReportShell } from '../../core/reportPrint.ts'
import { printHtml } from '../print/printReceipt.ts'
import { Btn, Field, Modal, inputCls, useToast } from '../components/ui.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'

type BookCur = { code: string; symbol: string; decimals: 0 | 2 | 3; name: string }

const fxMetaOf = (code: string) => COMMON_FX_CURRENCIES.find((row) => row.code === code.toUpperCase())

export function FxTreasuryTab({ cur, companyName }: { cur: BookCur; companyName: string }) {
  const { getFxHoldings, getFxFlows, fxConversions, treasuries, convertFx } = useDataStore()
  const fxRates = useAppStore((s) => s.fxRates)
  const toast = useToast()
  const fmt = (m: number) => formatMinor(m, cur, false)
  const treasuryName = (code: string) => treasuries.find((t) => t.code === code)?.nameAr ?? code

  /* كل الأرقام مشتقة — تنعكس فوراً بعد أي مستند */
  const holdings = useMemo(() => getFxHoldings(), [getFxHoldings, fxConversions, fxConversions.length])
  const flows = useMemo(() => getFxFlows(), [getFxFlows, fxConversions, fxConversions.length])
  const recentFlows = useMemo(() => [...flows].sort((a, b) => b.seq - a.seq).slice(0, 30), [flows])

  /* بطاقات الملخص: إجمالي القيم الدفترية وسعر اليوم والفرق غير المحقق */
  const summary = useMemo(() => {
    let book = 0, today = 0, currencies = new Set<string>()
    for (const h of holdings) {
      if (h.currency.toUpperCase() === cur.code.toUpperCase()) continue
      currencies.add(h.currency)
      book += h.bookValueMinor
      const rate = fxRates[h.currency]?.ratePpm
      if (rate) today += convertFxToBookMinor({ currencyCode: h.currency, amountMinor: h.amountMinor, ratePpm: rate, decimals: h.decimals }, cur.decimals)
    }
    return { currencies: currencies.size, book, today, unrealized: today - book }
  }, [holdings, fxRates, cur.code, cur.decimals])

  /* ═══ نافذة تحويل العملة ═══ */
  const [convOpen, setConvOpen] = useState(false)
  const [fromCurrency, setFromCurrency] = useState(cur.code.toUpperCase())
  const [toCurrency, setToCurrency] = useState('USD')
  const [fromTreasury, setFromTreasury] = useState('1101')
  const [toTreasury, setToTreasury] = useState('1101')
  const [fromAmount, setFromAmount] = useState('')
  const [fromRate, setFromRate] = useState('')
  const [toRate, setToRate] = useState('')
  const [fee, setFee] = useState('')
  const [convDate, setConvDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [convNotes, setConvNotes] = useState('')

  const fromDecimals: 0 | 2 | 3 = fromCurrency === cur.code.toUpperCase() ? cur.decimals : (fxMetaOf(fromCurrency)?.decimals ?? 2)
  const toDecimals: 0 | 2 | 3 = toCurrency === cur.code.toUpperCase() ? cur.decimals : (fxMetaOf(toCurrency)?.decimals ?? 2)
  const fromIsBook = fromCurrency === cur.code.toUpperCase()
  const toIsBook = toCurrency === cur.code.toUpperCase()
  const fromHolding = holdings.find((h) => h.treasury === fromTreasury && h.currency === fromCurrency)
  const toHolding = holdings.find((h) => h.treasury === toTreasury && h.currency === toCurrency)

  const convInput = {
    fromCurrency, fromDecimals, toCurrency, toDecimals, fromTreasury, toTreasury,
    fromAmountMinor: (() => { try { return toMinor(fromAmount || '0', fromDecimals) } catch { return 0 } })(),
    fromRatePpm: fromIsBook ? 1_000_000 : parseRateToPpm(fromRate),
    toRatePpm: toIsBook ? 1_000_000 : parseRateToPpm(toRate),
    feeMinor: (() => { try { return toMinor(fee || '0', cur.decimals) } catch { return 0 } })(),
    bookDecimals: cur.decimals, bookCurrencyCode: cur.code,
    acquisitionRatePpm: fromIsBook ? 1_000_000 : (fromHolding?.avgRatePpm ?? 0),
  }
  const convErrors = validateFxConversion(convInput, fromIsBook ? null : (fromHolding?.amountMinor ?? 0))
  const convComputed = convErrors.length ? null : computeFxConversion(convInput)

  const openConversion = () => {
    setFromTreasury(treasuries[0]?.code ?? '1101')
    setToTreasury(treasuries[0]?.code ?? '1101')
    setFromAmount(''); setFee(''); setConvNotes('')
    setFromRate(fromHolding && fromHolding.avgRatePpm > 0 ? formatRate(fromHolding.avgRatePpm) : (fxRates[fromCurrency]?.ratePpm ? formatRate(fxRates[fromCurrency].ratePpm) : ''))
    setToRate(fxRates[toCurrency]?.ratePpm ? formatRate(fxRates[toCurrency].ratePpm) : '')
    setConvOpen(true)
  }

  const postConversion = () => {
    try {
      const doc = convertFx({
        fromCurrency, fromDecimals, toCurrency, toDecimals, fromTreasury, toTreasury,
        fromAmountMinor: convInput.fromAmountMinor,
        fromRatePpm: convInput.fromRatePpm, toRatePpm: convInput.toRatePpm,
        feeMinor: convInput.feeMinor, date: convDate || undefined, notes: convNotes.trim() || undefined,
      })
      toast.show(`حُوّلت العملة بمستند ${doc.docNumber} — قيد متوازن${doc.gainMinor > 0 ? ` · ربح فرق ${fmt(doc.gainMinor)}` : ''}${doc.lossMinor > 0 ? ` · خسارة فرق ${fmt(doc.lossMinor)}` : ''}${doc.feeMinor > 0 ? ` · مصاريف ${fmt(doc.feeMinor)}` : ''} ✓`)
      setConvOpen(false)
    } catch (error) { toast.show((error as Error).message, 'error') }
  }

  /* طباعة التقرير بقالب التقارير الرسمي */
  const printHoldings = () => {
    const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const rows = holdings.filter((h) => h.currency.toUpperCase() !== cur.code.toUpperCase()).map((h) => {
      const saved = fxRates[h.currency]?.ratePpm
      const today = saved ? convertFxToBookMinor({ currencyCode: h.currency, amountMinor: h.amountMinor, ratePpm: saved, decimals: h.decimals }, cur.decimals) : null
      return `<tr><td>${esc(h.currency)}</td><td>${esc(treasuryName(h.treasury))}</td><td class="num">${(h.amountMinor / 10 ** h.decimals).toFixed(h.decimals)}</td><td class="num">${formatRate(h.avgRatePpm)}</td><td class="num">${fmt(h.bookValueMinor)}</td><td class="num">${today == null ? '—' : fmt(today)}</td><td class="num">${today == null ? '—' : fmt(today - h.bookValueMinor)}</td></tr>`
    }).join('')
    const body = `<table><thead><tr><th>العملة</th><th>المكان (الخزينة/البنك)</th><th>الرصيد</th><th>متوسط التكلفة</th><th>القيمة الدفترية</th><th>بسعر اليوم</th><th>غير محقق</th></tr></thead><tbody>${rows}<tr class="total"><td colspan="4">إجمالي القيمة الدفترية</td><td class="num">${fmt(summary.book)}</td><td class="num">${fmt(summary.today)}</td><td class="num">${fmt(summary.unrealized)}</td></tr></tbody></table>`
    const { reportPrint, receipt } = useAppStore.getState()
    printHtml(renderReportShell({ title: 'تقرير العملات — الأرصدة وأماكنها', subtitle: `عملة الدفتر ${cur.code} · ${summary.currencies} عملة`, companyName, logoDataUrl: receipt.logoDataUrl, settings: reportPrint, bodyHtml: body }))
  }

  const card = 'rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-card-dark'

  return (
    <section className="anim-up space-y-3" data-fx-treasury-tab>
      {/* بطاقات الملخص */}
      <div className="grid gap-2 sm:grid-cols-4">
        <div className={`${card} p-4`}>
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400"><Coins size={13} /> عملات لديك أرصدة</div>
          <div className="font-black text-xl mt-1">{summary.currencies}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">موزعة على الخزائن والبنوك</div>
        </div>
        <div className={`${card} p-4`}>
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400"><Banknote size={13} /> القيمة الدفترية</div>
          <div className="font-black text-xl mt-1">{fmt(summary.book)} <span className="text-[11px] font-bold text-slate-400">{cur.code}</span></div>
          <div className="text-[10px] text-slate-400 mt-0.5">بمتوسط سعر التحصيل/الشراء</div>
        </div>
        <div className={`${card} p-4`}>
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400"><Banknote size={13} /> القيمة بسعر اليوم</div>
          <div className="font-black text-xl mt-1">{fmt(summary.today)} <span className="text-[11px] font-bold text-slate-400">{cur.code}</span></div>
          <div className="text-[10px] text-slate-400 mt-0.5">بأسعار الصرف المحفوظة</div>
        </div>
        <div className={`${card} p-4`}>
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400"><ArrowLeftRight size={13} /> الفرق غير المحقق</div>
          <div className={`font-black text-xl mt-1 ${summary.unrealized >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(summary.unrealized)} <span className="text-[11px] font-bold text-slate-400">{cur.code}</span></div>
          <div className="text-[10px] text-slate-400 mt-0.5">يتحقق فعلياً عند التحويل</div>
        </div>
      </div>

      {/* أرصدة العملات بالأماكن */}
      <div className={`${card} p-3`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-black">أرصدة العملات الأجنبية — أين ومَن كم</h3>
            <p className="text-[11px] text-slate-500">كل رصيد مشتق من مستنداته (تحصيلات المبيعات · سداد المشتريات · السندات · التحويلات) — بلا أرقام يدوية.</p>
          </div>
          <div className="flex gap-2">
            <Btn variant="soft" onClick={printHoldings} data-fx-print><span className="flex items-center gap-1.5"><Printer size={14} /> طباعة</span></Btn>
            <Btn onClick={openConversion} className="!bg-teal-600 hover:!bg-teal-500 !text-white font-black" data-fx-convert-open>
              <span className="flex items-center gap-1.5"><ArrowLeftRight size={15} /> تحويل عملة</span>
            </Btn>
          </div>
        </div>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-[12px]" data-fx-holdings>
            <thead className="text-[11px] font-black text-slate-500">
              <tr><th className="p-1.5 text-right">العملة</th><th className="p-1.5 text-right">المكان (الخزينة/البنك)</th><th className="p-1.5">الرصيد</th><th className="p-1.5">متوسط التكلفة</th><th className="p-1.5">القيمة الدفترية</th><th className="p-1.5">بسعر اليوم</th><th className="p-1.5">غير محقق</th></tr>
            </thead>
            <tbody>
              {holdings.filter((h) => h.currency.toUpperCase() !== cur.code.toUpperCase()).length === 0 && (
                <tr><td colSpan={7} className="p-4 text-center text-slate-400">لا أرصدة عملات أجنبية بعد — حصّل فاتورة بعملة أجنبية أو اشترِ عملة بضغطة «تحويل عملة».</td></tr>
              )}
              {holdings.filter((h) => h.currency.toUpperCase() !== cur.code.toUpperCase()).map((h) => {
                const saved = fxRates[h.currency]?.ratePpm
                const today = saved ? convertFxToBookMinor({ currencyCode: h.currency, amountMinor: h.amountMinor, ratePpm: saved, decimals: h.decimals }, cur.decimals) : null
                return (
                  <tr key={`${h.treasury}-${h.currency}`} className="border-t border-slate-100 dark:border-slate-800" data-fx-holding={h.currency}>
                    <td className="p-1.5 text-right font-black font-mono">{h.currency}</td>
                    <td className="p-1.5 text-right">{treasuryName(h.treasury)} <span className="font-mono text-[10px] text-slate-400">({h.treasury})</span></td>
                    <td className="p-1.5 text-center font-mono font-bold">{(h.amountMinor / 10 ** h.decimals).toFixed(h.decimals)}</td>
                    <td className="p-1.5 text-center font-mono" dir="ltr">{formatRate(h.avgRatePpm)}</td>
                    <td className="p-1.5 text-center font-mono">{fmt(h.bookValueMinor)}</td>
                    <td className="p-1.5 text-center font-mono">{today == null ? <span className="text-slate-400">لا سعر محفوظ</span> : fmt(today)}</td>
                    <td className={`p-1.5 text-center font-mono font-bold ${today == null ? 'text-slate-400' : today - h.bookValueMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{today == null ? '—' : fmt(today - h.bookValueMinor)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* سجل التحويلات */}
      <div className={`${card} p-3`}>
        <h3 className="text-sm font-black">سجل تحويلات العملة — المصاريف وفروق العملة المحققة</h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-[12px]" data-fx-conversions>
            <thead className="text-[11px] font-black text-slate-500">
              <tr><th className="p-1.5">المستند</th><th className="p-1.5">التاريخ</th><th className="p-1.5">التحويل</th><th className="p-1.5">المصاريف</th><th className="p-1.5">ربح فرق عملة</th><th className="p-1.5">خسارة فرق عملة</th><th className="p-1.5">القيد</th></tr>
            </thead>
            <tbody>
              {fxConversions.length === 0 && (
                <tr><td colSpan={7} className="p-4 text-center text-slate-400">لا تحويلات بعد — «تحويل عملة» يسجل مستنداً بقيد متوازن يجمع المصاريف وفرق العملة.</td></tr>
              )}
              {[...fxConversions].reverse().map((doc) => (
                <tr key={doc.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="p-1.5 text-center font-mono font-bold">{doc.docNumber}</td>
                  <td className="p-1.5 text-center font-mono">{doc.date}</td>
                  <td className="p-1.5 text-center font-mono" dir="ltr">{(doc.fromAmountMinor / 10 ** doc.fromDecimals).toFixed(doc.fromDecimals)} {doc.fromCurrency} → {(doc.toAmountMinor / 10 ** doc.toDecimals).toFixed(doc.toDecimals)} {doc.toCurrency}</td>
                  <td className="p-1.5 text-center font-mono">{doc.feeMinor > 0 ? fmt(doc.feeMinor) : '—'}</td>
                  <td className="p-1.5 text-center font-mono font-bold text-emerald-600">{doc.gainMinor > 0 ? fmt(doc.gainMinor) : '—'}</td>
                  <td className="p-1.5 text-center font-mono font-bold text-rose-600">{doc.lossMinor > 0 ? fmt(doc.lossMinor) : '—'}</td>
                  <td className="p-1.5 text-center font-mono text-slate-400">#{doc.journalEntryId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* آخر التدفقات: من أين جاء الرصيد */}
      <div className={`${card} p-3`}>
        <h3 className="text-sm font-black">آخر تدفقات العملات — مصدر كل رصيد</h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-[12px]" data-fx-flows>
            <thead className="text-[11px] font-black text-slate-500">
              <tr><th className="p-1.5">التاريخ</th><th className="p-1.5">المستند</th><th className="p-1.5">الحركة</th><th className="p-1.5">العملة</th><th className="p-1.5">المبلغ</th><th className="p-1.5">القيمة الدفترية</th><th className="p-1.5">المكان</th></tr>
            </thead>
            <tbody>
              {recentFlows.map((flow, index) => (
                <tr key={`${flow.seq}-${flow.ref}-${index}`} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="p-1.5 text-center font-mono">{flow.date}</td>
                  <td className="p-1.5 text-center font-mono">{flow.ref}</td>
                  <td className={`p-1.5 text-center font-bold ${flow.kind === 'in' ? 'text-emerald-600' : 'text-rose-600'}`}>{flow.kind === 'in' ? 'دخول' : 'خروج'}</td>
                  <td className="p-1.5 text-center font-mono font-black">{flow.currency}</td>
                  <td className="p-1.5 text-center font-mono">{(flow.amountMinor / 10 ** (fxMetaOf(flow.currency)?.decimals ?? 2)).toFixed(fxMetaOf(flow.currency)?.decimals ?? 2)}</td>
                  <td className="p-1.5 text-center font-mono">{fmt(flow.bookValueMinor)}</td>
                  <td className="p-1.5 text-center">{treasuryName(flow.treasury)}</td>
                </tr>
              ))}
              {recentFlows.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-slate-400">لا تدفقات عملات بعد.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* ═══ نافذة تحويل العملة ═══ */}
      <Modal open={convOpen} onClose={() => setConvOpen(false)} title="تحويل عملة" subtitle="سعر تنفيذ + مصاريف التحويل + فرق العملة عن متوسط التكلفة — قيد متوازن بمستند رسمي" data-fx-convert-modal>
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="من عملة">
              <select className={inputCls} value={fromCurrency} onChange={(e) => setFromCurrency(e.target.value)} aria-label="العملة المصروفة" data-fx-conv-from>
                <option value={cur.code.toUpperCase()}>{cur.code} — عملة الدفتر</option>
                {COMMON_FX_CURRENCIES.filter((row) => row.code !== cur.code.toUpperCase()).map((row) => <option key={row.code} value={row.code}>{row.code} — {row.nameAr}</option>)}
              </select>
            </Field>
            <Field label="الخزينة/البنك المصروفة منها">
              <TreasuryPicker value={fromTreasury} onChange={setFromTreasury} />
            </Field>
            <Field label={`المبلغ المصروف بالـ${fromCurrency}`}>
              <input className={inputCls + ' text-center font-mono font-bold'} value={fromAmount} onChange={(e) => setFromAmount(e.target.value)} inputMode="decimal" placeholder="0.00" dir="ltr" data-fx-conv-amount />
            </Field>
            {!fromIsBook && (
              <Field label={`سعر تنفيذ ${fromCurrency} (دفتر لكل وحدة)`} hint={fromHolding && fromHolding.avgRatePpm > 0 ? `متوسط تكلفتك ${formatRate(fromHolding.avgRatePpm)} — فارق السعر يُقيَّد ربحاً أو خسارة` : 'لا رصيد سابق — سيكون هذا سعر تكلفتك'}>
                <input className={inputCls + ' text-center font-mono font-bold'} value={fromRate} onChange={(e) => setFromRate(e.target.value)} inputMode="decimal" placeholder="0.00" dir="ltr" data-fx-conv-from-rate />
              </Field>
            )}
            <Field label="إلى عملة">
              <select className={inputCls} value={toCurrency} onChange={(e) => setToCurrency(e.target.value)} aria-label="العملة المستلمة" data-fx-conv-to>
                <option value={cur.code.toUpperCase()}>{cur.code} — عملة الدفتر</option>
                {COMMON_FX_CURRENCIES.filter((row) => row.code !== cur.code.toUpperCase()).map((row) => <option key={row.code} value={row.code}>{row.code} — {row.nameAr}</option>)}
              </select>
            </Field>
            <Field label="الخزينة/البنك المستلمة">
              <TreasuryPicker value={toTreasury} onChange={setToTreasury} />
            </Field>
            {!toIsBook && (
              <Field label={`سعر تنفيذ ${toCurrency} (دفتر لكل وحدة)`} hint={toHolding && toHolding.avgRatePpm > 0 ? `متوسط تكلفة رصيدك الحالي ${formatRate(toHolding.avgRatePpm)}` : fxRates[toCurrency]?.ratePpm ? `سعر اليوم المحفوظ ${formatRate(fxRates[toCurrency].ratePpm)}` : 'لا سعر محفوظ — اكتبه'}>
                <input className={inputCls + ' text-center font-mono font-bold'} value={toRate} onChange={(e) => setToRate(e.target.value)} inputMode="decimal" placeholder="0.00" dir="ltr" data-fx-conv-to-rate />
              </Field>
            )}
            <Field label={`مصاريف التحويل (${cur.code})`} hint="عمولة الصراف/البنك — مصروف عمومي 5108">
              <input className={inputCls + ' text-center font-mono font-bold'} value={fee} onChange={(e) => setFee(e.target.value)} inputMode="decimal" placeholder="0.00" dir="ltr" data-fx-conv-fee />
            </Field>
            <Field label="التاريخ">
              <input type="date" className={inputCls} value={convDate} onChange={(e) => setConvDate(e.target.value)} aria-label="تاريخ التحويل" />
            </Field>
            <Field label="ملاحظات">
              <input className={inputCls} value={convNotes} onChange={(e) => setConvNotes(e.target.value)} placeholder="جهة الصراف، سبب التحويل…" />
            </Field>
          </div>

          {/* المعاينة الحية قبل الترحيل */}
          <div className={`rounded-xl p-3 text-center ${convErrors.length ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300' : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'}`} data-fx-conv-preview>
            {convErrors.length
              ? <span className="text-[12px] font-black">{convErrors.join(' — ')}</span>
              : convComputed && (
                <>
                  <div className="text-[11px] font-bold opacity-80">ستستلم</div>
                  <div className="text-xl font-black tabular-nums" dir="ltr">{(convComputed.toAmountMinor / 10 ** toDecimals).toFixed(toDecimals)} {toCurrency}</div>
                  <div className="mt-1 flex flex-wrap justify-center gap-x-4 text-[11px] font-bold">
                    <span>القيمة الدفترية الخارجة: {fmt(convComputed.outBookValueMinor)}</span>
                    {convComputed.gainMinor > 0 && <span className="text-emerald-700 dark:text-emerald-300">ربح فرق عملة: {fmt(convComputed.gainMinor)} → 4117</span>}
                    {convComputed.lossMinor > 0 && <span className="text-rose-700 dark:text-rose-300">خسارة فرق عملة: {fmt(convComputed.lossMinor)} → 5119</span>}
                    {convComputed.gainMinor === 0 && convComputed.lossMinor === 0 && <span>لا فرق عملة (شراء بسعر التنفيذ)</span>}
                    {convInput.feeMinor > 0 && <span>مصاريف: {fmt(convInput.feeMinor)} → 5108</span>}
                  </div>
                </>
              )}
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Btn variant="ghost" onClick={() => setConvOpen(false)}>رجوع</Btn>
            <Btn onClick={postConversion} disabled={convErrors.length > 0} className="!bg-teal-600 hover:!bg-teal-500 !text-white font-black px-5" data-fx-conv-post>
              <span className="flex items-center gap-1.5"><ArrowLeftRight size={15} /> ترحيل التحويل بقيد متوازن</span>
            </Btn>
          </div>
        </div>
      </Modal>
    </section>
  )
}
