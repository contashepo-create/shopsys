/**
 * إعدادات الطباعة (المرحلة 5) — مقاس الورق الحراري، ترويسة وتذييل الإيصال،
 * الطباعة التلقائية بعد كل بيع، ومعاينة حية + طباعة تجريبية.
 */
import { useMemo } from 'react'
import { Printer, Eye } from 'lucide-react'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { buildReceiptModel, type PaperWidth } from '../../core/receipt.ts'
import { renderReceiptHtml, printHtml } from '../print/printReceipt.ts'
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
    toast.show('أُرسل إيصال تجريبي للطباعة 🖨️')
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

          <Field label="مقاس ورق الطابعة">
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

          <Btn onClick={testPrint} className="w-full"><Printer size={15} /> طباعة إيصال تجريبي</Btn>
        </div>
      </div>

      {/* معاينة حية */}
      <div className="anim-up" style={{ animationDelay: '80ms' }}>
        <div className="rounded-2xl bg-slate-100 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 p-5">
          <div className="text-[12px] font-bold text-slate-400 mb-3 flex items-center gap-1.5"><Eye size={13} /> معاينة حية ({receipt.paperWidth} مم)</div>
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
