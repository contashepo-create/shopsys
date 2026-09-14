/**
 * إعدادات الطباعة (المرحلة 5) — مقاس الورق الحراري، ترويسة وتذييل الإيصال،
 * الطباعة التلقائية بعد كل بيع، ومعاينة حية + طباعة تجريبية.
 */
import { useMemo } from 'react'
import { Printer, Eye, FileText } from 'lucide-react'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { buildReceiptModel, type PaperWidth, type InvoiceTemplate } from '../../core/receipt.ts'
import { renderReceiptHtml, printHtml } from '../print/printReceipt.ts'
import { renderInvoiceA4Html, amountInWords } from '../print/printInvoiceA4.ts'
import { computeTotals } from '../../core/pos.ts'
import { Btn, Field, inputCls, useToast } from '../components/ui.tsx'

/** فاتورة تجريبية للمعاينة والطباعة الاختبارية */
const SAMPLE_LINES = [
  { itemId: 1, nameAr: 'لبن كامل الدسم 1ل', qty: 2, unitPriceMinor: 3500, unitCostMinor: 2800, discountPercent: 0, soldByWeight: false },
  { itemId: 2, nameAr: 'جبنة رومي قديمة', qty: 0.75, unitPriceMinor: 26000, unitCostMinor: 21000, discountPercent: 5, soldByWeight: true },
  { itemId: 3, nameAr: 'مكرونة 400جم', qty: 3, unitPriceMinor: 1250, unitCostMinor: 950, discountPercent: 0, soldByWeight: false },
]

export function PrintSettingsPage() {
  const { setup, receipt, autoPrintAfterSale, updateReceipt, setAutoPrint } = useAppStore()
  const toast = useToast()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }

  const sampleModel = useMemo(() => {
    const totals = computeTotals(SAMPLE_LINES, 0, setup.vatPercent, setup.taxInclusive)
    return buildReceiptModel({
      invoiceNumber: 'S-0001',
      dateIso: new Date().toISOString(),
      lines: SAMPLE_LINES,
      totals,
      payment: 'cash',
      customerName: null,
      taxPercent: setup.vatPercent,
      taxInclusive: setup.taxInclusive,
      settings: receipt,
    })
  }, [receipt, setup.vatPercent, setup.taxInclusive])

  const testPrint = () => {
    printHtml(renderReceiptHtml(sampleModel, cur, receipt.paperWidth))
    toast.show('أُرسل إيصال حراري تجريبي للطباعة 🖨️')
  }

  const testPrintA4 = () => {
    printHtml(renderInvoiceA4Html(sampleModel, cur))
    toast.show('أُرسلت فاتورة A4 تجريبية للطباعة 📄')
  }

  const headerText = receipt.headerLines.join('\n')

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* الإعدادات */}
      <div className="anim-up space-y-4">
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <div className="font-extrabold text-slate-800 dark:text-white flex items-center gap-2">
            <Printer size={17} className="text-slate-500" /> الإيصال الحراري
          </div>

          <Field label="القالب الافتراضي بعد البيع" hint="ما يُطبع من الكاشير — القالبان متاحان دائماً من فواتير المبيعات">
            <div className="grid grid-cols-2 gap-2">
              {([
                { id: 'thermal', label: '🖨️ إيصال حراري', sub: 'سريع لورق الرول' },
                { id: 'a4', label: '📄 فاتورة A4', sub: 'احترافية للشركات' },
              ] as { id: InvoiceTemplate; label: string; sub: string }[]).map((t) => (
                <button
                  key={t.id}
                  onClick={() => updateReceipt({ defaultTemplate: t.id })}
                  className={`p-3 rounded-xl border-2 font-bold text-sm transition-all ${receipt.defaultTemplate === t.id ? 'border-brand-500/60 bg-brand-500/10 text-brand-700 dark:text-brand-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}
                >
                  {t.label}
                  <div className="text-[10px] font-normal opacity-70 mt-0.5">{t.sub}</div>
                </button>
              ))}
            </div>
          </Field>

          <Field label="مقاس ورق الطابعة الحرارية">
            <div className="grid grid-cols-2 gap-2">
              {(['80', '58'] as PaperWidth[]).map((p) => (
                <button
                  key={p}
                  onClick={() => updateReceipt({ paperWidth: p })}
                  className={`p-3 rounded-xl border-2 font-bold text-sm transition-all ${receipt.paperWidth === p ? 'border-brand-500/60 bg-brand-500/10 text-brand-700 dark:text-brand-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}
                >
                  {p} مم {p === '80' ? '(الأشهر)' : '(صغير)'}
                </button>
              ))}
            </div>
          </Field>

          <Field label="اسم المحل على الإيصال">
            <input value={receipt.shopName} onChange={(e) => updateReceipt({ shopName: e.target.value })} className={inputCls} />
          </Field>

          <Field label="سطور الترويسة (سطر لكل معلومة)" hint="عنوان المحل، الهاتف، الرقم الضريبي…">
            <textarea
              value={headerText}
              onChange={(e) => updateReceipt({ headerLines: e.target.value.split('\n') })}
              rows={3}
              className={`${inputCls} resize-none`}
              placeholder={'شارع الجيش — المنصورة\nت: 0501234567'}
            />
          </Field>

          <Field label="نص التذييل">
            <input value={receipt.footerText} onChange={(e) => updateReceipt({ footerText: e.target.value })} className={inputCls} />
          </Field>

          <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer hover:border-brand-400/50 transition-colors">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">إظهار ملخص الضريبة على الإيصال</span>
            <input type="checkbox" checked={receipt.showTaxSummary} onChange={(e) => updateReceipt({ showTaxSummary: e.target.checked })} className="w-4 h-4 accent-brand-600" />
          </label>

          <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer hover:border-brand-400/50 transition-colors">
            <div>
              <div className="text-sm font-bold text-slate-700 dark:text-slate-200">طباعة تلقائية بعد كل بيع</div>
              <div className="text-[11px] text-slate-400">الإيصال يخرج فور تأكيد الدفع في الكاشير</div>
            </div>
            <input type="checkbox" checked={autoPrintAfterSale} onChange={(e) => setAutoPrint(e.target.checked)} className="w-4 h-4 accent-brand-600" />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <Btn onClick={testPrint}><Printer size={15} /> تجربة الحراري</Btn>
            <Btn onClick={testPrintA4} variant="ghost" className="border-2 border-brand-500/30"><FileText size={15} /> تجربة A4</Btn>
          </div>
        </div>
      </div>

      {/* معاينة حية */}
      <div className="anim-up space-y-4" style={{ animationDelay: '80ms' }}>
        {receipt.defaultTemplate === 'a4' && (
          <div className="rounded-2xl bg-slate-100 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 p-5">
            <div className="text-[12px] font-bold text-slate-400 mb-3 flex items-center gap-1.5"><FileText size={13} /> معاينة فاتورة A4 (مصغرة)</div>
            <div className="mx-auto bg-white text-black rounded-lg shadow-xl p-4" style={{ width: '340px', fontFamily: 'Cairo, sans-serif' }} dir="rtl">
              {/* شريط الترويسة */}
              <div className="rounded-lg text-white px-3 py-2.5 flex justify-between items-center" style={{ background: 'linear-gradient(90deg,#6366f1,#8b5cf6)' }}>
                <div>
                  <div className="font-black" style={{ fontSize: 13 }}>{sampleModel.shopName}</div>
                  {sampleModel.headerLines.map((l, i) => <div key={i} style={{ fontSize: 7, opacity: .9 }}>{l}</div>)}
                </div>
                <div className="text-left">
                  <div className="font-black" style={{ fontSize: 9 }}>فاتورة مبيعات</div>
                  <div className="rounded px-1.5 mt-0.5 font-bold" style={{ fontSize: 8, background: 'rgba(255,255,255,.2)' }}>{sampleModel.invoiceNumber}</div>
                </div>
              </div>
              {/* جدول مصغر */}
              <table className="w-full mt-2" style={{ fontSize: 8, borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: '#6366f1', color: '#fff' }}>
                  <th className="py-1 px-1">الصنف</th><th className="px-1">كمية</th><th className="px-1">سعر</th><th className="px-1">إجمالي</th>
                </tr></thead>
                <tbody>
                  {sampleModel.rows.map((r, i) => (
                    <tr key={i} style={{ background: i % 2 ? '#f8fafc' : '#fff', borderBottom: '1px solid #eef1f6' }}>
                      <td className="py-1 px-1 font-bold">{r.nameAr}</td>
                      <td className="px-1 text-center">{r.qtyLabel}</td>
                      <td className="px-1 text-center">{(r.unitPriceMinor / 10 ** cur.decimals).toFixed(cur.decimals)}</td>
                      <td className="px-1 text-center font-black">{(r.totalMinor / 10 ** cur.decimals).toFixed(cur.decimals)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex gap-2 mt-2 items-start">
                <div className="flex-1 rounded p-1.5" style={{ fontSize: 7, background: '#f5f7ff', border: '1px dashed #c7d2fe' }}>
                  <b style={{ color: '#6366f1' }}>المبلغ كتابةً:</b> {amountInWords(sampleModel.totalMinor, cur)}
                </div>
                <div className="rounded text-white px-2 py-1.5 font-black whitespace-nowrap" style={{ fontSize: 9, background: '#6366f1' }}>
                  {(sampleModel.totalMinor / 10 ** cur.decimals).toFixed(cur.decimals)} {cur.symbol}
                </div>
              </div>
            </div>
          </div>
        )}
        <div className="rounded-2xl bg-slate-100 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 p-5">
          <div className="text-[12px] font-bold text-slate-400 mb-3 flex items-center gap-1.5"><Eye size={13} /> معاينة الإيصال الحراري ({receipt.paperWidth} مم)</div>
          <div className="mx-auto bg-white text-black rounded-lg shadow-xl p-3" style={{ width: receipt.paperWidth === '80' ? '270px' : '190px', fontFamily: 'Cairo, sans-serif' }} dir="rtl">
            <div className="text-center font-black" style={{ fontSize: receipt.paperWidth === '80' ? 14 : 12 }}>{sampleModel.shopName}</div>
            {sampleModel.headerLines.map((l, i) => (
              <div key={i} className="text-center" style={{ fontSize: 9 }}>{l}</div>
            ))}
            <div className="border-t border-dashed border-black my-1.5" />
            <div className="flex justify-between" style={{ fontSize: 9 }}><span>فاتورة: <b>{sampleModel.invoiceNumber}</b></span><span>{sampleModel.dateLabel}</span></div>
            <div className="flex justify-between" style={{ fontSize: 9 }}><span>العميل: {sampleModel.customerName}</span><span>الدفع: {sampleModel.paymentLabel}</span></div>
            <div className="border-t border-dashed border-black my-1.5" />
            {sampleModel.rows.map((r, i) => (
              <div key={i} className="flex justify-between items-start py-0.5">
                <div>
                  <div className="font-bold" style={{ fontSize: 10 }}>{r.nameAr}{r.discountPercent > 0 && <span className="font-normal" style={{ fontSize: 8 }}> خصم {r.discountPercent}٪</span>}</div>
                  <div style={{ fontSize: 8, color: '#444' }}>{r.qtyLabel} × {(r.unitPriceMinor / 10 ** cur.decimals).toFixed(cur.decimals)}</div>
                </div>
                <div className="font-black whitespace-nowrap" style={{ fontSize: 10 }}>{(r.totalMinor / 10 ** cur.decimals).toFixed(cur.decimals)}</div>
              </div>
            ))}
            <div className="border-t border-dashed border-black my-1.5" />
            <div className="flex justify-between" style={{ fontSize: 9 }}><span>عدد الأصناف / القطع</span><span>{sampleModel.itemCount} / {sampleModel.totalQty}</span></div>
            {sampleModel.discountMinor > 0 && <div className="flex justify-between" style={{ fontSize: 9 }}><span>إجمالي الخصم</span><span>-{(sampleModel.discountMinor / 10 ** cur.decimals).toFixed(cur.decimals)}</span></div>}
            {sampleModel.taxLabel && <div className="flex justify-between" style={{ fontSize: 9 }}><span>{sampleModel.taxLabel}</span><span>{(sampleModel.taxMinor / 10 ** cur.decimals).toFixed(cur.decimals)}</span></div>}
            <div className="flex justify-between font-black mt-1" style={{ fontSize: receipt.paperWidth === '80' ? 14 : 12 }}>
              <span>الإجمالي</span><span>{(sampleModel.totalMinor / 10 ** cur.decimals).toFixed(cur.decimals)} {cur.symbol}</span>
            </div>
            <div className="border-t border-dashed border-black my-1.5" />
            <div className="text-center" style={{ fontSize: 9 }}>{sampleModel.footerText}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
