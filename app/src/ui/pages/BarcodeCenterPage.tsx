import { QuickSelect } from '../components/KeyboardPickers.tsx'
/**
 * مركز الباركود والسيريال (طلب المالك — قسم مستقل احترافي كمحلات البيع):
 * - قالب ملصق يُضبط مرة (المقاس A4/رول، ما يظهر، سطر مخصص) ويسري على كل طباعة.
 * - ملصقات أصناف: بحث + تحديد كميات + معاينة + طباعة.
 * - ملصقات سيريال: السيريال كُتب مرة عند الشراء ويُطبع هنا تلقائياً ببياناته
 *   (اسم القطعة، الضمان، تاريخ الدخول) — بلا إعادة كتابة أبداً.
 */
import { useMemo, useState } from 'react'
import { Printer, Tags, ScanBarcode, Settings2, Search } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { LABEL_SIZES, validateLabelPrint, type ItemLabelData, type SerialLabelData } from '../../core/labels.ts'
import { renderItemLabelsHtml, renderSerialLabelsHtml } from '../print/printProLabels.ts'
import { printHtml } from '../print/printReceipt.ts'
import { normalizeSerial } from '../../core/serials.ts'
import { planInternalBarcodes } from '../../core/barcode.ts'
import { barcodeIssues, normalizeBarcode } from '../../core/items.ts'
import { Btn, Field, inputCls, useToast, EmptyState } from '../components/ui.tsx'

type Tab = 'items' | 'serials' | 'template'

export function BarcodeCenterPage() {
  const { items, serials, updateItem } = useDataStore()
  const { setup, labelSettings, updateLabelSettings, scaleRules } = useAppStore()
  const toast = useToast()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }

  const [tab, setTab] = useState<Tab>('items')

  /* ─── ملصقات الأصناف ─── */
  const [q, setQ] = useState('')
  const [counts, setCounts] = useState<Record<number, string>>({})
  // سقف عرض متزايد بدل قصّ صامت: مركز الباركود должен يعرض كل الأصناف عند الحاجة
  const [visibleRows, setVisibleRows] = useState(200)
  const activeItems = useMemo(() => {
    const query = q.trim()
    return items.filter((it) => it.isActive && (!query || it.nameAr.includes(query) || it.sku.includes(query) || it.barcodes.some((b) => b.includes(query))))
  }, [items, q])
  const totalItemLabels = useMemo(() => Object.values(counts).reduce((a, v) => a + (Number(v) || 0), 0), [counts])
  /* أصناف نشطة بلا أي باركود — لا يمكن مسحها ولا طباعة ملصق قابل للقراءة قبل التوليد */
  const missingBarcode = useMemo(
    () => items.filter((it) => it.isActive && !it.barcodes.some((b) => b.trim()) && !it.sku.trim()),
    [items],
  )
  const [bulkConfirm, setBulkConfirm] = useState(false)
  /* جودة بيانات الباركود: أكواد قديمة بأرقام عربية أو بخانة تحقق خاطئة لا تُمسح */
  const issues = useMemo(() => barcodeIssues(items), [items])
  const fixable = issues.filter((issue) => issue.kind === 'arabic')
  const fixArabicBarcodes = () => {
    let done = 0
    for (const itemId of new Set(fixable.map((issue) => issue.itemId))) {
      const it = items.find((row) => row.id === itemId)
      if (!it) continue
      try {
        updateItem(it.id, {
          barcodes: [...new Set(it.barcodes.map((code) => normalizeBarcode(code)).filter(Boolean))],
          ...(it.extraUnits.length
            ? { extraUnits: it.extraUnits.map((unit) => ({ ...unit, ...(unit.barcode ? { barcode: normalizeBarcode(unit.barcode) } : {}) })) }
            : {}),
        })
        done += 1
      } catch { /* تكرار بعد التطبيع — يُترك للمراجعة اليدوية */ }
    }
    toast.show(`صُحّحت باركودات ${done} صنفاً ✓ — راجع الأكواد المتبقية يدوياً`)
  }
  /** توليد دفعة أكواد داخلية (EAN-13 بادئة 2) للأصناف بلا باركود ولا كود — خطة واحدة قابلة للاختبار */
  const generateMissingBarcodes = () => {
    const plan = planInternalBarcodes(items, scaleRules)
    let done = 0
    try {
      for (const row of plan) {
        const it = items.find((x) => x.id === row.id)
        if (!it) continue
        updateItem(it.id, { barcodes: [...it.barcodes, row.code] })
        done += 1
      }
      toast.show(`تم توليد ${done} باركوداً داخلياً ✓ — اطبع ملصقاتها من الجدول`)
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'تعذّر توليد الباركود', 'error')
    } finally {
      setBulkConfirm(false)
    }
  }

  const printItemLabels = () => {
    const list: ItemLabelData[] = []
    for (const [idStr, cntStr] of Object.entries(counts)) {
      const cnt = Number(cntStr) || 0
      if (cnt <= 0) continue
      const it = items.find((x) => x.id === Number(idStr))
      if (!it) continue
      list.push({ nameAr: it.nameAr, barcode: it.barcodes.find(Boolean) || it.sku || String(it.id), sku: it.sku, priceMinor: it.priceMinor, count: Math.min(cnt, 5000) })
    }
    const errors = validateLabelPrint(list.reduce((a, l) => a + l.count, 0))
    if (errors.length) { toast.show(errors.join(' — '), 'error'); return }
    printHtml(renderItemLabelsHtml(setup.shopName || 'تَحَكَّم', list, labelSettings, cur))
  }

  /* ─── ملصقات السيريال — تُكتب مرة وتظهر تلقائياً ─── */
  const [sq, setSq] = useState('')
  const [selectedSerials, setSelectedSerials] = useState<Set<number>>(new Set())
  const inStock = useMemo(() => {
    const query = normalizeSerial(sq)
    return serials
      .filter((u) => u.status === 'in_stock')
      .filter((u) => !query || u.serial.includes(query) || (items.find((it) => it.id === u.itemId)?.nameAr ?? '').includes(sq.trim()))
      .slice(0, 300)
  }, [serials, items, sq])

  const toggleSerial = (id: number) => {
    setSelectedSerials((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const printSerialLabels = () => {
    const list: SerialLabelData[] = serials
      .filter((u) => selectedSerials.has(u.id))
      .map((u) => ({
        serial: u.serial,
        itemNameAr: items.find((it) => it.id === u.itemId)?.nameAr ?? '—',
        warrantyMonths: u.warrantyMonths || (items.find((it) => it.id === u.itemId)?.warrantyMonths ?? 0),
        receivedAt: u.receivedAt,
      }))
    const errors = validateLabelPrint(list.length)
    if (errors.length) { toast.show(errors.join(' — '), 'error'); return }
    printHtml(renderSerialLabelsHtml(setup.shopName || 'تَحَكَّم', list, labelSettings))
  }

  const tabBtn = (id: Tab, icon: React.ReactNode, label: string) => (
    <button
      onClick={() => setTab(id)}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-bold transition-all ${
        tab === id ? 'bg-brand-600 text-white shadow-md' : 'bg-white dark:bg-card-dark text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:border-brand-400'
      }`}
    >
      {icon} {label}
    </button>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {tabBtn('items', <Tags size={15} />, 'ملصقات الأصناف')}
        {tabBtn('serials', <ScanBarcode size={15} />, 'ملصقات السيريال')}
        {tabBtn('template', <Settings2 size={15} />, 'قالب الملصق (يُضبط مرة)')}
      </div>

      {/* ─── جودة بيانات الباركود ─── */}
      {tab === 'items' && issues.length > 0 && (
        <div className="anim-up rounded-2xl border border-amber-400/40 bg-amber-500/5 p-4 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[12.5px] font-black text-amber-700 dark:text-amber-300">
              ⚠️ فحص جودة الباركود: {issues.length} ملاحظة على {new Set(issues.map((i) => i.itemId)).size} صنفاً
            </h2>
            {fixable.length > 0 && (
              <Btn variant="soft" onClick={fixArabicBarcodes}>تصحيح الأرقام العربية ({fixable.length})</Btn>
            )}
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            «غير مطبَّع» = أرقام عربية/فارسية أو محارف غير مرئية محفوظة قبل التحديث — لا يقرأها الماسح أبداً.
            «خانة تحقق» = رقم منقول خطأً من الملصق؛ صحّحه من بطاقة الصنف بعد التأكد من العلبة.
          </p>
          <div className="max-h-40 overflow-y-auto">
            <table className="w-full text-[11.5px]">
              <tbody>
                {issues.slice(0, 100).map((issue, i) => (
                  <tr key={i} className="border-b border-amber-500/10">
                    <td className="py-1 px-2 font-bold text-slate-700 dark:text-slate-200">{issue.nameAr}{issue.unitName ? ` — ${issue.unitName}` : ''}</td>
                    <td className="py-1 px-2 font-mono text-slate-500" dir="ltr">{issue.code}</td>
                    <td className="py-1 px-2 text-amber-700 dark:text-amber-400">{issue.kind === 'arabic' ? 'غير مطبَّع' : 'خانة تحقق'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── ملصقات الأصناف ─── */}
      {tab === 'items' && (
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-52">
              <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث بالاسم / الكود / الباركود…" className={`${inputCls} !pr-9`} />
            </div>
            <span className="text-[12px] text-slate-400 font-bold">إجمالي الملصقات: {totalItemLabels}</span>
            <Btn onClick={printItemLabels} disabled={totalItemLabels <= 0}>
              <Printer size={15} /> طباعة
            </Btn>
            <Btn variant="soft" onClick={() => setBulkConfirm(true)} disabled={missingBarcode.length === 0} title="EAN-13 بادئته 2 وخانة تحقق صحيحة — يتخطى المسجّل وقواعد الميزان">
              <Tags size={15} /> توليد باركود ({missingBarcode.length})
            </Btn>
          </div>
          {bulkConfirm && (
            <div className="rounded-xl border border-amber-400/40 bg-amber-500/5 p-3 text-[12px] space-y-2">
              <p className="font-bold text-amber-700 dark:text-amber-300">
                سيُضاف باركود داخلي لـ{missingBarcode.length} صنفاً بلا باركود ولا كود — بادئة 200 (نطاق الاستخدام داخل المتجر) وخانة تحقق سليمة.
              </p>
              <p className="text-slate-500">لا يتأثر أي صنف له باركود مسجّل، ولن يُولَّد كود يفسّره الميزان كملصق وزن.</p>
              <div className="flex gap-2">
                <Btn onClick={generateMissingBarcodes}>تأكيد التوليد</Btn>
                <Btn variant="ghost" onClick={() => setBulkConfirm(false)}>إلغاء</Btn>
              </div>
            </div>
          )}
          {activeItems.length === 0 ? (
            <EmptyState icon="🏷️" title="لا أصناف مطابقة" sub="أضف أصنافاً من شاشة الأصناف أو عدّل البحث" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-right text-slate-400 border-b border-slate-100 dark:border-slate-800">
                    <th className="py-2 px-2">الصنف</th>
                    <th className="py-2 px-2">الباركود</th>
                    <th className="py-2 px-2">السعر</th>
                    <th className="py-2 px-2 w-28">عدد الملصقات</th>
                  </tr>
                </thead>
                <tbody>
                  {activeItems.slice(0, visibleRows).map((it) => (
                    <tr key={it.id} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-1.5 px-2 font-bold text-slate-700 dark:text-slate-200">{it.nameAr}</td>
                      <td className="py-1.5 px-2 font-mono text-slate-500" dir="ltr">{it.barcodes.find(Boolean) || it.sku || it.id}</td>
                      <td className="py-1.5 px-2 text-slate-500">{(it.priceMinor / 10 ** cur.decimals).toLocaleString('ar-EG')} {cur.symbol}</td>
                      <td className="py-1.5 px-2">
                        <input
                          type="number" inputMode="decimal" step="any" min={0} max={5000}
                          value={counts[it.id] ?? ''}
                          onChange={(e) => setCounts((c) => ({ ...c, [it.id]: e.target.value }))}
                          placeholder="0"
                          className={`${inputCls} !py-1.5 text-center`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {activeItems.length > visibleRows && (
                <div className="flex items-center justify-between gap-3 pt-2">
                  <span className="text-[11.5px] text-slate-400">
                    يُعرض {visibleRows} من {activeItems.length} صنفاً
                  </span>
                  <button onClick={() => setVisibleRows((n) => n + 300)} className="text-[12px] font-bold text-brand-600 dark:text-brand-400 hover:underline">
                    عرض المزيد (+300)
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ─── ملصقات السيريال ─── */}
      {tab === 'serials' && (
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4 space-y-3">
          <p className="text-[11.5px] text-slate-400 leading-relaxed">
            💡 السيريال يُكتب <b>مرة واحدة</b> عند فاتورة الشراء (أو الإدخال اليدوي) ويظهر هنا تلقائياً
            ببياناته: اسم القطعة، الضمان، تاريخ الدخول — اختر القطع واطبع، بلا إعادة كتابة أبداً.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-52">
              <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={sq} onChange={(e) => setSq(e.target.value)} placeholder="ابحث بالسيريال / IMEI / اسم الصنف…" className={`${inputCls} !pr-9`} />
            </div>
            <button
              onClick={() => setSelectedSerials(new Set(inStock.map((u) => u.id)))}
              className="text-[12px] font-bold text-brand-600 dark:text-brand-400 hover:underline"
            >
              تحديد الكل ({inStock.length})
            </button>
            <button onClick={() => setSelectedSerials(new Set())} className="text-[12px] font-bold text-slate-400 hover:underline">
              إلغاء التحديد
            </button>
            <Btn onClick={printSerialLabels} disabled={selectedSerials.size === 0}>
              <Printer size={15} /> طباعة ({selectedSerials.size})
            </Btn>
          </div>
          {inStock.length === 0 ? (
            <EmptyState icon="🔢" title="لا سيريالات بالمخزون" sub="فعّل تتبع السيريال للصنف وأدخل السيريالات في فاتورة الشراء — تظهر هنا فوراً" />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {inStock.map((u) => {
                const it = items.find((x) => x.id === u.itemId)
                const selected = selectedSerials.has(u.id)
                return (
                  <button
                    key={u.id}
                    onClick={() => toggleSerial(u.id)}
                    className={`text-right p-3 rounded-xl border transition-all ${selected ? 'border-brand-500/60 bg-brand-500/10' : 'border-slate-100 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-600'}`}
                  >
                    <div className="font-mono text-[12.5px] font-bold text-slate-700 dark:text-slate-200" dir="ltr">{u.serial}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">{it?.nameAr ?? '—'}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-2">
                      {(u.warrantyMonths || it?.warrantyMonths || 0) > 0 && <span>🛡️ ضمان {u.warrantyMonths || it?.warrantyMonths} شهراً</span>}
                      <span>📥 {u.receivedAt.slice(0, 10)}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── قالب الملصق — يُضبط مرة ويسري على كل الطباعات ─── */}
      {tab === 'template' && (
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4 space-y-4 max-w-2xl">
          <Field label="مقاس الملصق">
            <QuickSelect value={labelSettings.sizeId} onChange={(e) => updateLabelSettings({ sizeId: e.target.value })} className={inputCls}>
              {LABEL_SIZES.map((s) => <option key={s.id} value={s.id}>{s.nameAr}</option>)}
            </QuickSelect>
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {([
              ['showShopName', 'اسم المحل أعلى الملصق'],
              ['showPrice', 'سعر البيع'],
              ['showCode', 'الرقم المقروء تحت الباركود'],
              ['showSku', 'كود الصنف (SKU)'],
              ['serialShowItemName', 'ملصق السيريال: اسم القطعة'],
              ['serialShowWarranty', 'ملصق السيريال: مدة الضمان'],
              ['serialShowDate', 'ملصق السيريال: تاريخ الدخول'],
            ] as const).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-slate-100 dark:border-slate-800 cursor-pointer hover:border-brand-400 transition-colors">
                <input
                  type="checkbox"
                  checked={labelSettings[key]}
                  onChange={(e) => updateLabelSettings({ [key]: e.target.checked })}
                  className="w-4 h-4 rounded accent-brand-600"
                />
                <span className="text-[12.5px] font-semibold text-slate-600 dark:text-slate-300">{label}</span>
              </label>
            ))}
          </div>
          <Field label="سطر مخصص أسفل كل ملصق (اختياري — هاتف المحل، سياسة الاستبدال…)" hint="يُحفظ مرة ويظهر في كل الطباعات القادمة تلقائياً">
            <input value={labelSettings.customLine} onChange={(e) => updateLabelSettings({ customLine: e.target.value.slice(0, 60) })} className={inputCls} placeholder="مثال: للاستبدال خلال 14 يوماً بالفاتورة — 01000000000" />
          </Field>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            🖨️ A4: اطبع على ورق لاصق مقسّم بنفس الشبكة (يُباع جاهزاً بكل المكتبات). الرول الحراري: كل ملصق صفحة
            بمقاس الرول نفسه — اختر الطابعة الحرارية من نافذة الطباعة وستخرج الملصقات متتابعة.
          </p>
        </div>
      )}
    </div>
  )
}
