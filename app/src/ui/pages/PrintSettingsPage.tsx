/**
 * إعدادات الطباعة (المرحلة 5) — تحكم كامل في الفاتورة:
 * القالب الافتراضي، أنماط A4 الأربعة (منقولة من logistics-web)، اللون الرئيسي،
 * شعار المحل، العلامة المائية، وإظهار/إخفاء كل عنصر — مع معاينة حية «حقيقية»
 * (iframe يعرض نفس HTML الذي سيُطبع حرفياً، فلا مفاجآت على الورق).
 */
import { useMemo, useRef } from 'react'
import { Printer, FileText, ImagePlus, Trash2, Stamp, Eye, Palette, ClipboardList } from 'lucide-react'
import { renderReportShell } from '../../core/reportPrint.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { buildReceiptModel, A4_STYLES, type PaperWidth, type InvoiceTemplate, type ReceiptSettings } from '../../core/receipt.ts'
import { renderReceiptHtml, printHtml } from '../print/printReceipt.ts'
import { renderInvoiceA4Html } from '../print/printInvoiceA4.ts'
import { computeTotals } from '../../core/pos.ts'
import { Btn, Field, inputCls, useToast } from '../components/ui.tsx'

/** فاتورة تجريبية للمعاينة والطباعة الاختبارية */
const SAMPLE_LINES = [
  { itemId: 1, nameAr: 'لبن كامل الدسم 1ل', qty: 2, unitPriceMinor: 3500, unitCostMinor: 2800, discountPercent: 0, soldByWeight: false },
  { itemId: 2, nameAr: 'جبنة رومي قديمة', qty: 0.75, unitPriceMinor: 26000, unitCostMinor: 21000, discountPercent: 5, soldByWeight: true },
  { itemId: 3, nameAr: 'مكرونة 400جم', qty: 3, unitPriceMinor: 1250, unitCostMinor: 950, discountPercent: 0, soldByWeight: false },
]

/** مفاتيح الإظهار/الإخفاء مع أسمائها ونطاقها */
const VISIBILITY_KEYS: { key: keyof ReceiptSettings; label: string; scope: 'الكل' | 'A4' }[] = [
  { key: 'showLogo', label: 'شعار المحل', scope: 'الكل' },
  { key: 'showHeaderLines', label: 'سطور الترويسة (عنوان/هاتف…)', scope: 'الكل' },
  { key: 'showDate', label: 'تاريخ الفاتورة', scope: 'الكل' },
  { key: 'showCustomer', label: 'اسم العميل', scope: 'الكل' },
  { key: 'showPayment', label: 'طريقة الدفع', scope: 'الكل' },
  { key: 'showItemCounts', label: 'عدد الأصناف والقطع', scope: 'الكل' },
  { key: 'showDiscount', label: 'الخصومات', scope: 'الكل' },
  { key: 'showTaxSummary', label: 'ملخص الضريبة', scope: 'الكل' },
  { key: 'showWords', label: 'المبلغ كتابةً (تفقيط)', scope: 'A4' },
  { key: 'showSignatures', label: 'خانتا التوقيع', scope: 'A4' },
  { key: 'showFooter', label: 'نص التذييل', scope: 'الكل' },
]

/** يقرأ صورة الشعار ويصغّرها إلى 256px كحد أقصى ثم يعيدها Data URL */
function readLogoFile(file: File, onDone: (dataUrl: string) => void, onError: () => void) {
  const reader = new FileReader()
  reader.onerror = onError
  reader.onload = () => {
    const img = new Image()
    img.onerror = onError
    img.onload = () => {
      const max = 256
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) return onError()
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      onDone(canvas.toDataURL('image/png'))
    }
    img.src = String(reader.result)
  }
  reader.readAsDataURL(file)
}

export function PrintSettingsPage() {
  const { setup, receipt, autoPrintAfterSale, updateReceipt, setAutoPrint, reportPrint, updateReportPrint } = useAppStore()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )

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

  // نفس HTML الذي سيخرج للطابعة — المعاينة صادقة 100٪
  const thermalHtml = useMemo(() => renderReceiptHtml(sampleModel, cur, receipt), [sampleModel, cur, receipt])
  const a4Html = useMemo(() => renderInvoiceA4Html(sampleModel, cur, receipt), [sampleModel, cur, receipt])

  const testPrint = () => {
    printHtml(thermalHtml)
    toast.show('أُرسل إيصال حراري تجريبي للطباعة 🖨️')
  }
  const testPrintA4 = () => {
    printHtml(a4Html)
    toast.show('أُرسلت فاتورة A4 تجريبية للطباعة 📄')
  }

  const pickLogo = (file: File | undefined) => {
    if (!file) return
    if (file.size > 2 * 1024 * 1024) return toast.show('حجم الشعار كبير — الحد 2 ميجابايت', 'error')
    readLogoFile(
      file,
      (dataUrl) => {
        updateReceipt({ logoDataUrl: dataUrl, showLogo: true })
        toast.show('تم حفظ الشعار وسيظهر على الفواتير ✅')
      },
      () => toast.show('تعذّرت قراءة ملف الصورة', 'error'),
    )
  }

  const headerText = receipt.headerLines.join('\n')
  const toggleCls =
    'flex items-center justify-between px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer hover:border-brand-400/50 transition-colors'

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
      {/* ─── عمود الإعدادات ─── */}
      <div className="anim-up space-y-4">
        {/* إعدادات طباعة التقارير — معممة على كل مطبوعات النظام (طلب المالك) */}
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <div className="font-extrabold text-slate-800 dark:text-white flex items-center gap-2">
            <ClipboardList size={17} className="text-violet-500" /> طباعة التقارير (كل الأقسام)
          </div>
          <p className="text-[11px] text-slate-400 -mt-2">تسري على كل مطبوعات التقارير: المالية، اليومية، كشوف الحساب، تقارير الأقسام — لا الفواتير فقط</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Field label="الورق">
              <select value={reportPrint.paper} onChange={(e) => updateReportPrint({ paper: e.target.value as 'A4' })} className={inputCls}>
                <option value="A4">A4</option><option value="A5">A5</option><option value="letter">Letter</option>
              </select>
            </Field>
            <Field label="الاتجاه">
              <select value={reportPrint.orientation} onChange={(e) => updateReportPrint({ orientation: e.target.value as 'portrait' })} className={inputCls}>
                <option value="portrait">طولي</option><option value="landscape">عرضي</option>
              </select>
            </Field>
            <Field label="حجم الخط (نقطة)">
              <input type="number" min={9} max={14} value={reportPrint.baseFontPt}
                onChange={(e) => updateReportPrint({ baseFontPt: Math.min(14, Math.max(9, Number(e.target.value) || 12)) })} className={inputCls} dir="ltr" />
            </Field>
            <Field label="لون العناوين">
              <input type="color" value={reportPrint.accentColor} onChange={(e) => updateReportPrint({ accentColor: e.target.value })} className="w-full h-10 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer bg-transparent" />
            </Field>
            <Field label="سطر ترويسة إضافي">
              <input value={reportPrint.headerLine} onChange={(e) => updateReportPrint({ headerLine: e.target.value })} className={inputCls} placeholder="عنوان — هاتف — سجل تجاري" />
            </Field>
            <Field label="نص التذييل">
              <input value={reportPrint.footerText} onChange={(e) => updateReportPrint({ footerText: e.target.value })} className={inputCls} placeholder="اختياري" />
            </Field>
            {/* خيارات الشعار والقالب الأوسع (طلب المالك) */}
            <Field label="نمط الترويسة">
              <select value={reportPrint.headerStyle ?? 'band'} onChange={(e) => updateReportPrint({ headerStyle: e.target.value as 'band' })} className={inputCls}>
                <option value="band">شريط ملون متدرج (الأجمل)</option>
                <option value="line">خط سفلي كلاسيكي</option>
              </select>
            </Field>
            <Field label={`ارتفاع الشعار: ${reportPrint.logoHeightMm ?? 18} مم`}>
              <input type="range" min={10} max={40} step={2} value={reportPrint.logoHeightMm ?? 18} onChange={(e) => updateReportPrint({ logoHeightMm: Number(e.target.value) })} className="w-full accent-violet-600" />
            </Field>
            <Field label="موضع الشعار">
              <select value={reportPrint.logoPosition ?? 'end'} onChange={(e) => updateReportPrint({ logoPosition: e.target.value as 'end' })} className={inputCls}>
                <option value="end">يسار الترويسة</option>
                <option value="start">يمين الترويسة</option>
                <option value="center">في المنتصف</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {([
              ['showCompanyName', 'اسم المنشأة في الترويسة'],
              ['showLogo', 'شعار المنشأة'],
              ['showPrintedAt', 'تاريخ ووقت الطباعة'],
              ['showPrintedBy', 'اسم المستخدم الطابع'],
              ['showSignatures', 'خانات توقيع رسمية (إعداد/مراجعة/اعتماد)'],
              ['zebra', 'تظليل الصفوف بالتناوب (قراءة أسهل)'],
            ] as const).map(([k, label]) => (
              <label key={k} className={toggleCls}>
                <span className="text-[12px] font-bold text-slate-600 dark:text-slate-300">{label}</span>
                <input type="checkbox" checked={reportPrint[k]} onChange={(e) => updateReportPrint({ [k]: e.target.checked })} className="accent-violet-600 w-4 h-4" />
              </label>
            ))}
          </div>
          {/* علامة مائية مستقلة للتقارير — منفصلة عن علامة الفاتورة (طلب المالك) */}
          <div className="rounded-xl border border-dashed border-violet-300 dark:border-violet-800 p-3 space-y-3">
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-[12px] font-bold text-slate-600 dark:text-slate-300">💧 علامة مائية على التقارير (مستقلة عن الفاتورة)</span>
              <input type="checkbox" checked={reportPrint.watermarkEnabled ?? false} onChange={(e) => updateReportPrint({ watermarkEnabled: e.target.checked })} className="w-4 h-4 accent-violet-600" />
            </label>
            {reportPrint.watermarkEnabled && (
              <>
                <input value={reportPrint.watermarkText ?? ''} onChange={(e) => updateReportPrint({ watermarkText: e.target.value })} className={inputCls} placeholder="سري — نسخة داخلية — مسودة…" />
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Field label={`الميل: ${reportPrint.watermarkRotation ?? -30}°`}>
                    <input type="range" min={-90} max={90} step={5} value={reportPrint.watermarkRotation ?? -30} onChange={(e) => updateReportPrint({ watermarkRotation: Number(e.target.value) })} className="w-full accent-violet-600" />
                  </Field>
                  <Field label={`الحجم: ${reportPrint.watermarkSizePt ?? 72}pt`}>
                    <input type="range" min={24} max={140} step={4} value={reportPrint.watermarkSizePt ?? 72} onChange={(e) => updateReportPrint({ watermarkSizePt: Number(e.target.value) })} className="w-full accent-violet-600" />
                  </Field>
                  <Field label={`الشفافية: ${reportPrint.watermarkOpacity ?? 8}٪`}>
                    <input type="range" min={3} max={30} step={1} value={reportPrint.watermarkOpacity ?? 8} onChange={(e) => updateReportPrint({ watermarkOpacity: Number(e.target.value) })} className="w-full accent-violet-600" />
                  </Field>
                  <Field label="اللون">
                    <input type="color" value={reportPrint.watermarkColor ?? '#64748b'} onChange={(e) => updateReportPrint({ watermarkColor: e.target.value })} className="w-full h-9 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer bg-transparent" />
                  </Field>
                </div>
              </>
            )}
          </div>
          <Btn variant="soft" onClick={() => {
            printHtml(renderReportShell({
              title: 'تقرير تجريبي', subtitle: `${setup.shopName || 'المنشأة'} — معاينة إعدادات طباعة التقارير`,
              companyName: setup.shopName || 'المنشأة', logoDataUrl: receipt.logoDataUrl, settings: reportPrint,
              bodyHtml: '<table><thead><tr><th>البند</th><th>القيمة</th></tr></thead><tbody><tr><td>سطر تجريبي أول</td><td class="num">1,000.00</td></tr><tr><td>سطر تجريبي ثانٍ</td><td class="num">2,500.00</td></tr></tbody><tfoot><tr><td>الإجمالي</td><td class="num">3,500.00</td></tr></tfoot></table>',
            }))
            toast.show('أُرسل تقرير تجريبي للطباعة 📄')
          }}><Printer size={14} /> طباعة تقرير تجريبي</Btn>
        </div>

        {/* القالب والنمط */}
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <div className="font-extrabold text-slate-800 dark:text-white flex items-center gap-2">
            <Printer size={17} className="text-slate-500" /> القالب والنمط
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

          <Field label="نمط فاتورة A4" hint="أربعة تصاميم احترافية — جرّبها وشاهد المعاينة تتغير فوراً">
            <div className="grid grid-cols-2 gap-2">
              {A4_STYLES.map((st) => (
                <button
                  key={st.id}
                  onClick={() => updateReceipt({ a4Style: st.id })}
                  className={`p-3 rounded-xl border-2 text-right transition-all ${receipt.a4Style === st.id ? 'border-brand-500/60 bg-brand-500/10' : 'border-slate-200 dark:border-slate-700'}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ background: st.accent }} />
                    <span className={`font-bold text-sm ${receipt.a4Style === st.id ? 'text-brand-700 dark:text-brand-300' : 'text-slate-500'}`}>{st.nameAr}</span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1">{st.desc}</div>
                </button>
              ))}
            </div>
          </Field>

          <Field label="اللون الرئيسي للفاتورة">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={receipt.accentColor}
                onChange={(e) => updateReceipt({ accentColor: e.target.value })}
                className="w-12 h-10 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer bg-transparent"
              />
              <div className="flex gap-1.5">
                {['#6366f1', '#2563eb', '#0d9488', '#7c3aed', '#e11d48', '#b45309', '#1e293b'].map((c) => (
                  <button
                    key={c}
                    onClick={() => updateReceipt({ accentColor: c })}
                    className={`w-7 h-7 rounded-full transition-transform hover:scale-110 ${receipt.accentColor === c ? 'ring-2 ring-offset-2 ring-brand-500 dark:ring-offset-card-dark' : ''}`}
                    style={{ background: c }}
                    title={c}
                  />
                ))}
              </div>
              <Palette size={15} className="text-slate-400 ms-auto" />
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
        </div>

        {/* الهوية: شعار + بيانات + علامة مائية */}
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <div className="font-extrabold text-slate-800 dark:text-white flex items-center gap-2">
            <Stamp size={17} className="text-slate-500" /> هوية المحل على الفاتورة
          </div>

          <Field label="شعار المحل / الشركة" hint="يظهر أعلى الفاتورة الحرارية وA4 — يُحفظ داخل النظام">
            <div className="flex items-center gap-3">
              {receipt.logoDataUrl ? (
                <img src={receipt.logoDataUrl} alt="الشعار" className="w-16 h-16 object-contain rounded-xl border border-slate-200 dark:border-slate-700 bg-white p-1" />
              ) : (
                <div className="w-16 h-16 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 flex items-center justify-center text-slate-300">
                  <ImagePlus size={22} />
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <Btn variant="ghost" className="border border-slate-200 dark:border-slate-700" onClick={() => fileRef.current?.click()}>
                  <ImagePlus size={14} /> {receipt.logoDataUrl ? 'تغيير الشعار' : 'رفع شعار'}
                </Btn>
                {receipt.logoDataUrl && (
                  <button onClick={() => updateReceipt({ logoDataUrl: '' })} className="text-[11px] text-rose-500 hover:text-rose-600 font-bold flex items-center gap-1">
                    <Trash2 size={11} /> إزالة الشعار
                  </button>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { pickLogo(e.target.files?.[0]); e.target.value = '' }} />
            </div>
          </Field>

          {/* تحكم كامل بالشعار على فاتورة A4 (طلب المالك): الموضع + الحجم + الشفافية */}
          {receipt.logoDataUrl && (
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 space-y-3">
              <div className="text-[11.5px] font-bold text-slate-500">تحكم الشعار على فاتورة A4</div>
              <Field label="موضع الشعار">
                <div className="grid grid-cols-3 gap-2">
                  {([['side', '⬅️ بجانب الاسم'], ['above', '⬆️ فوق الاسم'], ['center', '🎯 منتصف الرأس']] as const).map(([val, label]) => (
                    <button
                      key={val}
                      onClick={() => updateReceipt({ logoPosition: val })}
                      className={`px-2 py-2 rounded-xl text-[12px] font-bold border-2 transition-all ${
                        (receipt.logoPosition || 'side') === val ? 'border-brand-500/60 bg-brand-500/10 text-brand-700 dark:text-brand-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={`الحجم: ${receipt.logoSizeMm || 22} مم`}>
                  <input type="range" min={10} max={60} value={receipt.logoSizeMm || 22} onChange={(e) => updateReceipt({ logoSizeMm: Number(e.target.value) })} className="w-full accent-brand-600" />
                </Field>
                <Field label={`الشفافية: ${receipt.logoOpacity || 100}٪`}>
                  <input type="range" min={10} max={100} value={receipt.logoOpacity || 100} onChange={(e) => updateReceipt({ logoOpacity: Number(e.target.value) })} className="w-full accent-brand-600" />
                </Field>
              </div>
            </div>
          )}

          <Field label="اسم المحل على الفاتورة">
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

          <label className={toggleCls}>
            <div>
              <div className="text-sm font-bold text-slate-700 dark:text-slate-200">علامة مائية على فاتورة A4</div>
              <div className="text-[11px] text-slate-400">نص شفاف مائل خلف محتوى الفاتورة</div>
            </div>
            <input type="checkbox" checked={receipt.watermarkEnabled} onChange={(e) => updateReceipt({ watermarkEnabled: e.target.checked })} className="w-4 h-4 accent-brand-600" />
          </label>
          {receipt.watermarkEnabled && (
            <div className="space-y-3">
              <input
                value={receipt.watermarkText}
                onChange={(e) => updateReceipt({ watermarkText: e.target.value })}
                className={inputCls}
                placeholder="مثال: اسم المحل، أصل، مدفوعة…"
                maxLength={40}
              />
              {/* تحكم كامل بالعلامة المائية (طلب المالك): الميل + الحجم + الشفافية + اللون
                  — أُصلحت أيضاً مشكلة اختفائها خلف جدول الأصناف */}
              <div className="grid grid-cols-2 gap-3">
                <Field label={`الميل: ${receipt.watermarkRotation ?? -30}°`} hint="سالب = مائل يميناً">
                  <input type="range" min={-90} max={90} step={5} value={receipt.watermarkRotation ?? -30} onChange={(e) => updateReceipt({ watermarkRotation: Number(e.target.value) })} className="w-full accent-brand-600" />
                </Field>
                <Field label={`حجم الخط: ${receipt.watermarkSizePt || 72}pt`}>
                  <input type="range" min={24} max={140} step={4} value={receipt.watermarkSizePt || 72} onChange={(e) => updateReceipt({ watermarkSizePt: Number(e.target.value) })} className="w-full accent-brand-600" />
                </Field>
                <Field label={`الشفافية: ${receipt.watermarkOpacity || 8}٪`} hint="فوق 30٪ تطغى على المحتوى">
                  <input type="range" min={3} max={30} value={receipt.watermarkOpacity || 8} onChange={(e) => updateReceipt({ watermarkOpacity: Number(e.target.value) })} className="w-full accent-brand-600" />
                </Field>
                <Field label="اللون">
                  <input type="color" value={receipt.watermarkColor || '#64748b'} onChange={(e) => updateReceipt({ watermarkColor: e.target.value })} className="w-full h-9 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer" />
                </Field>
              </div>
            </div>
          )}
        </div>

        {/* عناصر الفاتورة إظهار/إخفاء */}
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5 space-y-3">
          <div className="font-extrabold text-slate-800 dark:text-white flex items-center gap-2">
            <Eye size={17} className="text-slate-500" /> عناصر الفاتورة — تحكم كامل
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {VISIBILITY_KEYS.map(({ key, label, scope }) => (
              <label key={key} className={toggleCls}>
                <span className="text-[12.5px] font-bold text-slate-700 dark:text-slate-200">
                  {label}
                  {scope === 'A4' && <span className="text-[9px] font-normal text-violet-500 ms-1">A4 فقط</span>}
                </span>
                <input
                  type="checkbox"
                  checked={Boolean(receipt[key])}
                  onChange={(e) => updateReceipt({ [key]: e.target.checked } as Partial<ReceiptSettings>)}
                  className="w-4 h-4 accent-brand-600 shrink-0"
                />
              </label>
            ))}
          </div>

          <label className={toggleCls}>
            <div>
              <div className="text-sm font-bold text-slate-700 dark:text-slate-200">طباعة تلقائية بعد كل بيع</div>
              <div className="text-[11px] text-slate-400">الفاتورة تخرج فور تأكيد الدفع في الكاشير بالقالب الافتراضي</div>
            </div>
            <input type="checkbox" checked={autoPrintAfterSale} onChange={(e) => setAutoPrint(e.target.checked)} className="w-4 h-4 accent-brand-600" />
          </label>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <Btn onClick={testPrint}><Printer size={15} /> تجربة الحراري</Btn>
            <Btn onClick={testPrintA4} variant="ghost" className="border-2 border-brand-500/30"><FileText size={15} /> تجربة A4</Btn>
          </div>
        </div>
      </div>

      {/* ─── عمود المعاينة الحية (نفس HTML المطبوع حرفياً) ─── */}
      <div className="anim-up space-y-4 xl:sticky xl:top-4 self-start" style={{ animationDelay: '80ms' }}>
        <div className="rounded-2xl bg-slate-100 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 p-5">
          <div className="text-[12px] font-bold text-slate-400 mb-3 flex items-center gap-1.5">
            <FileText size={13} /> معاينة فاتورة A4 — نمط «{A4_STYLES.find((s) => s.id === receipt.a4Style)?.nameAr}» (ما تراه هو ما يُطبع)
          </div>
          <div className="mx-auto overflow-hidden rounded-lg shadow-xl bg-white" style={{ width: 420, height: 594 }}>
            <iframe
              title="معاينة A4"
              srcDoc={a4Html}
              className="border-0 origin-top-left pointer-events-none"
              style={{ width: 794, height: 1123, transform: 'scale(0.529)', transformOrigin: 'top right' }}
            />
          </div>
        </div>

        <div className="rounded-2xl bg-slate-100 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 p-5">
          <div className="text-[12px] font-bold text-slate-400 mb-3 flex items-center gap-1.5">
            <Printer size={13} /> معاينة الإيصال الحراري ({receipt.paperWidth} مم)
          </div>
          <div className="mx-auto overflow-hidden rounded-lg shadow-xl bg-white" style={{ width: receipt.paperWidth === '80' ? 290 : 200, height: 420 }}>
            <iframe
              title="معاينة الإيصال"
              srcDoc={thermalHtml}
              className="border-0 pointer-events-none"
              style={{ width: receipt.paperWidth === '80' ? 290 : 200, height: 420 }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
