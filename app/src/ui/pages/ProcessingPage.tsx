import { ItemQuickPicker, QuickSelect } from '../components/KeyboardPickers.tsx'
/**
 * التقطيع والفرز والتعبئة (جزارة 🥩 / تمور 🌴)
 * ============================================
 * خام واحد → نواتج متعددة بتوزيع التكلفة بالقيمة البيعية النسبية (المعيار
 * العالمي في برامج الجزارة والتعبئة)، مع فاقد موثق ونسبة تصافٍ لكل أمر،
 * وحقول توثيق سعودية (SFDA: بلد المنشأ/رقم المنشأة/شهادة الحلال/تاريخ الذبح
 * أو الجني/الموسم) — كلها اختيارية كبقية بيانات النظام.
 */
import { useMemo, useState } from 'react'
import { Plus, Scissors, Trash2, ShieldCheck, X, CheckCircle2, Boxes, Layers, Wallet, BookOpenText, ChevronDown, AlertTriangle } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import {
  allocateProcessingCost, processingYieldPercent, PROCESSING_KIND_LABELS,
  type ProcessingKind, type ProcessingOrder,
} from '../../core/processing.ts'
import { Modal, Field, Btn, EmptyState, inputCls, useToast } from '../components/ui.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'
import { buildWarehouseDocs, computeWarehouseStock } from '../../core/transfers.ts'

export function ProcessingPage() {
  const { items, warehouses, transfers, purchases, sales, saleReturns, purchaseReturns, productionOrders, processingOrders, postProcessing } = useDataStore()
  const { setup } = useAppStore()
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
  const toast = useToast()
  const fmt = (m: number) => formatMinor(m, cur, false)
  const nameOf = (id: number) => items.find((it) => it.id === id)?.nameAr ?? '؟'
  const warehouseStock = useMemo(() => computeWarehouseStock(items, warehouses, transfers, buildWarehouseDocs(purchases, sales, saleReturns, purchaseReturns, productionOrders, processingOrders)), [items, warehouses, transfers, purchases, sales, saleReturns, purchaseReturns, productionOrders, processingOrders])
  const mainWarehouseId = setup.defaultWarehouseId ?? warehouses.find((warehouse) => warehouse.isMain)?.id ?? warehouses[0]?.id ?? 0

  // نوع التجهيز من النشاط: التمور فرز، وكل ما عداها تقطيع (الجزارة الافتراضية)
  const kind: ProcessingKind = setup.activityId === 'dates' ? 'dates' : 'butcher'
  const L = PROCESSING_KIND_LABELS[kind]
  const isSA = setup.countryCode === 'SA'
  const accent = kind === 'butcher' ? 'text-red-600' : 'text-yellow-700 dark:text-yellow-500'

  /* نافذة أمر جديد */
  const [open, setOpen] = useState(false)
  const [sourceId, setSourceId] = useState('')
  const [sourceQty, setSourceQty] = useState('')
  const [sourceWarehouseId, setSourceWarehouseId] = useState(String(mainWarehouseId))
  const [outputWarehouseId, setOutputWarehouseId] = useState(String(mainWarehouseId))
  const [allowNegativeSource, setAllowNegativeSource] = useState(() => localStorage.getItem('shopsys:manufacturing:allow-negative-stock') === 'true')
  const [outs, setOuts] = useState<{ itemId: string; qty: string }[]>([{ itemId: '', qty: '' }])
  const [waste, setWaste] = useState('')
  /** مصاريف التشغيل ببنود مسماة (عمالة/كراتين/نقل) — تُجمع في overheadMinor وتفصيلها يُحفظ في الملاحظات */
  const [overheadLines, setOverheadLines] = useState<{ label: string; amount: string }[]>([{ label: '', amount: '' }])
  const [treasury, setTreasury] = useState('1101')
  const [notes, setNotes] = useState('')
  const [docsOpen, setDocsOpen] = useState(false)
  // توثيق SFDA
  const [origin, setOrigin] = useState('')
  const [facility, setFacility] = useState('')
  const [halal, setHalal] = useState('')
  const [prodDate, setProdDate] = useState('')
  const [season, setSeason] = useState('')

  const openNew = () => {
    setSourceId(''); setSourceQty(''); setSourceWarehouseId(String(mainWarehouseId)); setOutputWarehouseId(String(mainWarehouseId)); setOuts([{ itemId: '', qty: '' }]); setWaste('')
    setOverheadLines([{ label: '', amount: '' }]); setTreasury('1101'); setNotes(''); setDocsOpen(false)
    setOrigin(isSA ? 'السعودية' : ''); setFacility(''); setHalal(''); setProdDate(''); setSeason('')
    setOpen(true)
  }

  const source = items.find((it) => String(it.id) === sourceId)
  const sourceAvailable = source && sourceWarehouseId ? warehouseStock.get(Number(sourceWarehouseId))?.get(source.id) ?? 0 : 0
  const parsedOuts = outs.filter((o) => o.itemId && Number(o.qty) > 0).map((o) => ({ itemId: Number(o.itemId), qty: Number(o.qty) }))
  const outQtySum = parsedOuts.reduce((a, o) => a + o.qty, 0)
  const srcQtyNum = Number(sourceQty) || 0
  const previewYield = srcQtyNum > 0 ? Math.round((outQtySum / srcQtyNum) * 1000) / 10 : 0
  const overheadMinor = overheadLines.reduce((sum, line) => sum + Math.max(0, Math.round((Number(line.amount) || 0) * 10 ** cur.decimals)), 0)
  const overheadNote = overheadLines.filter((line) => Number(line.amount) > 0).map((line) => `${line.label.trim() || 'مصروف تجهيز'}: ${fmt(Math.round(Number(line.amount) * 10 ** cur.decimals))}`).join(' · ')
  const totalCost = source ? Math.round(source.costMinor * srcQtyNum) + overheadMinor : 0
  const preview = (() => {
    if (!source || parsedOuts.length === 0 || !(srcQtyNum > 0)) return null
    try {
      return allocateProcessingCost(parsedOuts, totalCost, (id) => items.find((it) => it.id === id)?.priceMinor ?? 0)
    } catch { return null }
  })()

  /** القيمة البيعية المتوقعة لكل النواتج — تقيس جدوى الأمر قبل ترحيله */
  const expectedSalesMinor = parsedOuts.reduce((sum, out) => sum + Math.round((items.find((item) => item.id === out.itemId)?.priceMinor ?? 0) * out.qty), 0)
  const canPost = !!sourceId && !!sourceWarehouseId && !!outputWarehouseId && srcQtyNum > 0 && parsedOuts.length > 0

  const run = () => {
    try {
      const order = postProcessing({
        kind, sourceItemId: Number(sourceId), sourceQty: srcQtyNum, sourceWarehouseId: Number(sourceWarehouseId) || null, outputWarehouseId: Number(outputWarehouseId) || null, allowNegativeSource,
        outputs: parsedOuts, overheadMinor, treasury,
        wasteQty: waste ? Number(waste) : 0,
        compliance: { originCountry: origin.trim(), facilityNo: facility.trim(), halalCert: halal.trim(), productionDate: prodDate, season: season.trim() },
        notes: [notes.trim(), overheadNote && `تفصيل المصاريف — ${overheadNote}`].filter(Boolean).join(' | '),
      })
      toast.show(`رُحّل ${order.orderNumber} — التصافي ${processingYieldPercent(order)}٪ ✅`)
      setOpen(false)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const stats = useMemo(() => {
    const totalOrders = processingOrders.length
    const avgYield = totalOrders > 0
      ? Math.round(processingOrders.reduce((a, o) => a + processingYieldPercent(o), 0) / totalOrders * 10) / 10
      : 0
    const totalWaste = processingOrders.reduce((a, o) => a + o.wasteQty, 0)
    return { totalOrders, avgYield, totalWaste }
  }, [processingOrders])

  return (
    <div className="space-y-4 anim-in" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-black flex items-center gap-2"><Scissors className={`w-6 h-6 ${accent}`} /> {L.icon} {kind === 'butcher' ? 'التقطيع والتفصيص' : 'الفرز والتدريج والتعبئة'}</h1>
          <p className="text-[12px] text-slate-500 mt-1">
            {kind === 'butcher'
              ? 'الذبيحة تتحول لأجزاء بأسعار مختلفة — التكلفة توزَّع بنسبة القيمة البيعية فالفخذ يتحمل أكثر من العظم، والفاقد موثق بلا تكلفة'
              : 'المحصول الخام يُفرز لدرجات وعبوات — السكري الفاخر يتحمل تكلفة أعلى من تمر التصنيع، وفاقد الفرز موثق بلا تكلفة'}
          </p>
        </div>
        <Btn onClick={openNew}><Plus className="w-4 h-4" /> {L.nameAr}</Btn>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'أوامر مرحلة', value: String(stats.totalOrders), color: accent },
          { label: 'متوسط التصافي', value: `${stats.avgYield}٪`, color: 'text-emerald-600' },
          { label: L.wasteLabel, value: String(Math.round(stats.totalWaste * 1000) / 1000), color: 'text-rose-600' },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-slate-200 dark:border-slate-700 p-3 text-center">
            <div className={`text-2xl font-black ${s.color}`}>{s.value}</div>
            <div className="text-[11px] font-bold text-slate-500">{s.label}</div>
          </div>
        ))}
      </div>

      {processingOrders.length === 0 ? (
        <EmptyState icon={L.icon} title="لا أوامر تجهيز بعد" sub={kind === 'butcher' ? 'سجل الذبيحة كصنف خام بالشراء، ثم قطّعها هنا لأجزائها البيعية' : 'سجل المحصول الخام بالشراء، ثم افرزه هنا لدرجاته وعبواته'} />
      ) : (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className={`px-4 py-2.5 font-black text-sm ${kind === 'butcher' ? 'bg-red-600/10 text-red-700 dark:text-red-300' : 'bg-yellow-700/10 text-yellow-800 dark:text-yellow-300'}`}>سجل أوامر التجهيز</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                  <th className="px-4 py-2 text-right">الأمر</th>
                  <th className="px-4 py-2 text-right">{L.sourceLabel}</th>
                  <th className="px-4 py-2 text-right">{L.outputLabel}</th>
                  <th className="px-4 py-2 text-right">التصافي</th>
                  <th className="px-4 py-2 text-right">التكلفة الكلية</th>
                  <th className="px-4 py-2 text-right">توثيق</th>
                  <th className="px-4 py-2 text-right">التاريخ</th>
                </tr>
              </thead>
              <tbody>
                {[...processingOrders].reverse().slice(0, 30).map((o: ProcessingOrder) => {
                  const y = processingYieldPercent(o)
                  const hasDocs = !!(o.compliance.originCountry || o.compliance.halalCert || o.compliance.facilityNo)
                  return (
                    <tr key={o.id} className="border-t border-slate-100 dark:border-slate-800 align-top">
                      <td className="px-4 py-2 font-black">{o.orderNumber}</td>
                      <td className="px-4 py-2">{nameOf(o.sourceItemId)} × {o.sourceQty}</td>
                      <td className="px-4 py-2 text-[12px]">
                        {o.outputs.map((out) => (
                          <div key={out.itemId} className="flex justify-between gap-3">
                            <span>{nameOf(out.itemId)} × {out.qty}</span>
                            <span className="tabular-nums text-slate-400">{fmt(out.allocatedCostMinor)}</span>
                          </div>
                        ))}
                        {o.wasteQty > 0 && <div className="text-rose-500">فاقد: {o.wasteQty}</div>}
                      </td>
                      <td className={`px-4 py-2 font-bold tabular-nums ${y >= 45 ? 'text-emerald-600' : 'text-amber-600'}`}>{y}٪</td>
                      <td className="px-4 py-2 font-bold tabular-nums">{fmt(o.sourceCostMinor + o.overheadMinor)}</td>
                      <td className="px-4 py-2">
                        {hasDocs && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-500/10 rounded-lg px-2 py-0.5" title={[o.compliance.originCountry && `المنشأ: ${o.compliance.originCountry}`, o.compliance.facilityNo && `منشأة: ${o.compliance.facilityNo}`, o.compliance.halalCert && `حلال: ${o.compliance.halalCert}`, o.compliance.productionDate && `${L.dateLabel}: ${o.compliance.productionDate}`, o.compliance.season].filter(Boolean).join(' — ')}>
                            <ShieldCheck className="w-3 h-3" /> SFDA
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-[11px] text-slate-400">{o.date.slice(0, 10)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* نافذة أمر التجهيز/التصنيع — أعيد بناؤها كشاشة تصنيع كاملة داخل نافذة (طلب المالك):
          رأس تشغيلي، خام ومخازن، جدول نواتج بتوزيع حي، فاقد ومصاريف ببنود، توثيق، وملخص وقيد */}
      <Modal open={open} onClose={() => setOpen(false)} title="" extraWide bare>
        <div dir="rtl" className="overflow-hidden rounded-3xl bg-[#f8f9ff] text-[#0b1c30] dark:bg-slate-900 dark:text-slate-100">
          {/* الرأس */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0f2042] px-5 py-3.5 text-white">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/10 text-xl">{L.icon}</span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold">أمر {L.nameAr}</h2>
                  <span className="text-[10px] uppercase tracking-wider text-[#a9c7ff]">Manufacturing Order</span>
                  <span className="rounded bg-white/10 px-2 py-0.5 font-mono text-[11px]">{kind === 'butcher' ? 'CUT' : 'PKG'} — جديد</span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-[#d6e3ff]">{setup.shopName || 'نظام الحسابات'} · خام واحد ← نواتج متعددة بتوزيع التكلفة بالقيمة البيعية</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={run} disabled={!canPost} className="flex items-center gap-1.5 rounded-lg bg-[#6ffbbe] px-4 py-2 text-xs font-bold text-[#002113] shadow-sm transition hover:bg-[#4edea3] disabled:cursor-not-allowed disabled:opacity-50">
                <CheckCircle2 size={16} /> ترحيل الأمر [F9]
              </button>
              <button type="button" onClick={() => setOpen(false)} aria-label="إغلاق" className="rounded-lg p-2 text-white/70 transition hover:bg-rose-500 hover:text-white"><X size={20} /></button>
            </div>
          </div>

          {/* شريط مؤشرات حي */}
          <div className="grid grid-cols-2 gap-px bg-[#dce9ff] text-center sm:grid-cols-5 dark:bg-slate-700">
            {[
              { label: 'تكلفة الخام', value: source ? fmt(Math.round(source.costMinor * srcQtyNum)) : '—' },
              { label: 'مصاريف التجهيز', value: fmt(overheadMinor) },
              { label: 'التكلفة الكلية', value: fmt(totalCost), strong: true },
              { label: 'نسبة التصافي', value: `${previewYield}٪`, tone: previewYield >= 45 ? 'text-[#009c6b]' : 'text-amber-600' },
              { label: L.wasteLabel, value: `${Number(waste) || 0}${srcQtyNum > 0 ? ` (${Math.round(((Number(waste) || 0) / srcQtyNum) * 1000) / 10}٪)` : ''}`, tone: 'text-rose-600' },
            ].map((card) => (
              <div key={card.label} className="bg-white px-3 py-2.5 dark:bg-slate-900">
                <div className={`font-mono text-[15px] font-black ${card.tone ?? (card.strong ? 'text-[#0f2042] dark:text-white' : 'text-[#254778] dark:text-slate-200')}`}>{card.value}</div>
                <div className="text-[10px] font-bold text-[#75777f]">{card.label}</div>
              </div>
            ))}
          </div>

          <div className="max-h-[calc(92vh-11rem)] space-y-3.5 overflow-y-auto px-5 py-4">
            {/* ① الخام والمخازن */}
            <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-[#dce9ff] dark:bg-slate-900/50 dark:ring-slate-700">
              <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-bold text-[#0f2042] dark:text-slate-100"><Boxes size={17} className="text-[#3f5f92]" /> ① الخام المستهلك والمخازن</h3>
                {source && <span className="rounded bg-[#eff4ff] px-2.5 py-1 text-[10.5px] font-bold text-[#254778] dark:bg-slate-800 dark:text-slate-300">متاح {sourceAvailable} · تكلفة الوحدة {fmt(source.costMinor)}</span>}
              </div>
              <div className="grid gap-2.5 md:grid-cols-4">
                <Field label={`${L.sourceLabel} *`} hint="ابحث بالاسم أو الباركود ثم Enter">
                  <ItemQuickPicker items={items.filter((item) => item.isActive)} onPick={(id) => setSourceId(String(id))} placeholder="ابحث عن الخام ثم Enter" />
                </Field>
                <Field label="مخزن صرف الخام *">
                  <QuickSelect value={sourceWarehouseId} onChange={(e) => setSourceWarehouseId(e.target.value)} className={inputCls}>
                    <option value="">اختر المخزن</option>
                    {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.nameAr}{source ? ` — متاح ${warehouseStock.get(warehouse.id)?.get(source.id) ?? 0}` : ''}</option>)}
                  </QuickSelect>
                </Field>
                <Field label="الكمية المستهلكة *" hint={source ? `يُصرف من المخزون بتكلفته المرجحة` : undefined}>
                  <input value={sourceQty} onChange={(e) => setSourceQty(e.target.value)} inputMode="decimal" className={inputCls} placeholder="مثال: 18.5" />
                </Field>
                <Field label="مخزن استلام النواتج *">
                  <QuickSelect value={outputWarehouseId} onChange={(e) => setOutputWarehouseId(e.target.value)} className={inputCls}>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.nameAr}</option>)}</QuickSelect>
                </Field>
              </div>
              {source && srcQtyNum > sourceAvailable && !allowNegativeSource && (
                <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-rose-500/10 px-3 py-2 text-[11px] font-bold text-rose-600"><AlertTriangle size={14} /> الكمية المطلوبة {srcQtyNum} أكبر من المتاح {sourceAvailable} في هذا المخزن — فعّل السماح بالسالب أو صحّح الكمية.</div>
              )}
            </section>

            {/* ② النواتج */}
            <section className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-[#dce9ff] dark:bg-slate-900/50 dark:ring-slate-700">
              <div className="flex flex-wrap items-center justify-between gap-2 bg-[#eff4ff] px-4 py-2.5 dark:bg-slate-800/60">
                <h3 className="flex items-center gap-2 text-sm font-bold text-[#0f2042] dark:text-slate-100"><Layers size={17} className="text-[#3f5f92]" /> ② {L.outputLabel} وتوزيع التكلفة</h3>
                <span className="text-[10px] text-[#75777f]">التوزيع بنسبة (سعر البيع × الكمية) — الباقي للأكبر قيمةً</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[42rem] text-[12px]">
                  <thead className="bg-[#f8f9ff] text-[10px] text-[#45464e] dark:bg-slate-800/40 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-2 text-right font-black">الصنف الناتج</th>
                      <th className="px-2 py-2 font-black">الكمية</th>
                      <th className="px-2 py-2 font-black">سعر البيع/وحدة</th>
                      <th className="px-2 py-2 font-black">القيمة البيعية</th>
                      <th className="px-2 py-2 font-black">نصيبه من التكلفة</th>
                      <th className="px-2 py-2 font-black">تكلفة الوحدة</th>
                      <th className="px-2 py-2 font-black">هامش الوحدة</th>
                      <th className="px-1 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {outs.map((o, i) => {
                      const outItem = items.find((item) => String(item.id) === o.itemId)
                      const qty = Number(o.qty) || 0
                      const salesValue = Math.round((outItem?.priceMinor ?? 0) * qty)
                      const costed = preview?.find((row) => row.itemId === Number(o.itemId))
                      const margin = outItem && costed ? outItem.priceMinor - costed.unitCostMinor : null
                      return (
                        <tr key={i} className={`border-t border-[#dce9ff] dark:border-slate-800 ${i % 2 ? 'bg-[#f8f9ff]/60 dark:bg-slate-800/20' : ''}`}>
                          <td className="min-w-[13rem] px-3 py-2">
                            {outItem
                              ? <div className="flex items-center justify-between gap-2"><b className="truncate text-[12px]">{outItem.nameAr}</b><button type="button" onClick={() => setOuts(outs.map((row, j) => (j === i ? { ...row, itemId: '' } : row)))} className="text-[10px] font-bold text-[#3f5f92] hover:underline">تغيير</button></div>
                              : <ItemQuickPicker items={items.filter((item) => item.isActive && String(item.id) !== sourceId)} onPick={(id) => setOuts(outs.map((row, j) => (j === i ? { ...row, itemId: String(id) } : row)))} placeholder="ابحث عن الناتج ثم Enter" />}
                          </td>
                          <td className="px-2 py-2 text-center"><input value={o.qty} onChange={(e) => setOuts(outs.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} inputMode="decimal" placeholder="0" aria-label="كمية الناتج" className="h-9 w-24 rounded-lg border border-[#c5c6cf] bg-transparent px-2 text-center font-mono font-bold outline-none focus:border-[#3f5f92] dark:border-slate-700" /></td>
                          <td className="px-2 py-2 text-center font-mono text-[#45464e] dark:text-slate-300">{outItem ? fmt(outItem.priceMinor) : '—'}</td>
                          <td className="px-2 py-2 text-center font-mono text-[#45464e] dark:text-slate-300">{salesValue ? fmt(salesValue) : '—'}</td>
                          <td className="px-2 py-2 text-center font-mono font-black text-[#0f2042] dark:text-slate-100">{costed ? fmt(costed.allocatedCostMinor) : '—'}</td>
                          <td className="px-2 py-2 text-center font-mono text-[#254778] dark:text-slate-300">{costed ? fmt(costed.unitCostMinor) : '—'}</td>
                          <td className={`px-2 py-2 text-center font-mono font-bold ${margin === null ? 'text-slate-400' : margin >= 0 ? 'text-[#009c6b]' : 'text-rose-600'}`}>{margin === null ? '—' : fmt(margin)}</td>
                          <td className="px-1 py-2"><button onClick={() => setOuts(outs.length === 1 ? [{ itemId: '', qty: '' }] : outs.filter((_, j) => j !== i))} aria-label="حذف الناتج" className="rounded p-1 text-slate-400 transition hover:text-rose-600"><Trash2 className="h-4 w-4" /></button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-[#dce9ff] bg-[#eff4ff] text-[11px] font-black dark:border-slate-700 dark:bg-slate-800/60">
                      <td className="px-3 py-2">الإجمالي ({parsedOuts.length} ناتج)</td>
                      <td className="px-2 py-2 text-center font-mono">{Math.round(outQtySum * 1000) / 1000}</td>
                      <td className="px-2 py-2" />
                      <td className="px-2 py-2 text-center font-mono">{fmt(expectedSalesMinor)}</td>
                      <td className="px-2 py-2 text-center font-mono">{fmt(preview ? preview.reduce((a, row) => a + row.allocatedCostMinor, 0) : 0)}</td>
                      <td className="px-2 py-2" />
                      <td className={`px-2 py-2 text-center font-mono ${expectedSalesMinor - totalCost >= 0 ? 'text-[#009c6b]' : 'text-rose-600'}`}>ربح {fmt(expectedSalesMinor - totalCost)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#dce9ff] px-4 py-2.5 dark:border-slate-800">
                <Btn variant="soft" onClick={() => setOuts([...outs, { itemId: '', qty: '' }])}><Plus className="h-4 w-4" /> ناتج آخر</Btn>
                {srcQtyNum > 0 && outQtySum > srcQtyNum && <span className="flex items-center gap-1.5 text-[11px] font-bold text-rose-600"><AlertTriangle size={14} /> مجموع النواتج ({outQtySum}) أكبر من الخام ({srcQtyNum}) — راجع الكميات</span>}
              </div>
            </section>

            {/* ③ الفاقد ومصاريف التشغيل */}
            <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-[#dce9ff] dark:bg-slate-900/50 dark:ring-slate-700">
              <h3 className="mb-2.5 flex items-center gap-2 text-sm font-bold text-[#0f2042] dark:text-slate-100"><Wallet size={17} className="text-[#3f5f92]" /> ③ الفاقد ومصاريف التشغيل</h3>
              <div className="grid gap-2.5 md:grid-cols-3">
                <Field label={L.wasteLabel} hint="كمية موثقة فقط — لا تحمل تكلفة"><input value={waste} onChange={(e) => setWaste(e.target.value)} inputMode="decimal" className={inputCls} placeholder="0" /></Field>
                <Field label="مصدر صرف المصاريف" hint={overheadMinor > 0 ? undefined : 'يُستخدم عند إدخال مصاريف'}>
                  <TreasuryPicker value={treasury} onChange={setTreasury} />
                </Field>
                <div className="self-end rounded-lg bg-[#eff4ff] px-3 py-2 text-[10.5px] text-[#254778] dark:bg-slate-800 dark:text-slate-300">
                  مصاريف التشغيل تدخل تكلفة النواتج وتُصرف من الخزينة المختارة لحظة الترحيل.
                </div>
              </div>
              <div className="mt-2.5 space-y-2">
                {overheadLines.map((line, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <input value={line.label} onChange={(e) => setOverheadLines(overheadLines.map((row, j) => (j === i ? { ...row, label: e.target.value } : row)))} placeholder="بند المصروف (عمالة، كراتين، نقل…)" aria-label="بند مصروف التجهيز" className={`${inputCls} min-w-[12rem] flex-1`} />
                    <input value={line.amount} onChange={(e) => setOverheadLines(overheadLines.map((row, j) => (j === i ? { ...row, amount: e.target.value } : row)))} inputMode="decimal" placeholder={`0 ${cur.symbol}`} aria-label="قيمة مصروف التجهيز" className={`${inputCls} w-32 text-center font-mono`} />
                    <button onClick={() => setOverheadLines(overheadLines.length === 1 ? [{ label: '', amount: '' }] : overheadLines.filter((_, j) => j !== i))} aria-label="حذف بند المصروف" className="rounded p-1.5 text-slate-400 transition hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Btn variant="soft" onClick={() => setOverheadLines([...overheadLines, { label: '', amount: '' }])}><Plus className="h-4 w-4" /> بند مصروف</Btn>
                  <span className="text-[11px] font-bold text-[#0f2042] dark:text-slate-200">إجمالي المصاريف: <span className="font-mono">{fmt(overheadMinor)}</span> {cur.symbol}</span>
                </div>
              </div>
            </section>

            {/* ④ التوثيق (SFDA) */}
            <section className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-[#dce9ff] dark:bg-slate-900/50 dark:ring-slate-700">
              <button type="button" onClick={() => setDocsOpen(!docsOpen)} className="flex w-full items-center gap-2 px-4 py-3 text-right">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                <span className="flex-1 text-sm font-bold text-[#0f2042] dark:text-slate-100">④ توثيق الجودة والحلال (SFDA) — اختياري</span>
                {[origin, facility, halal, prodDate, season].filter((value) => value.trim()).length > 0 && <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600">{[origin, facility, halal, prodDate, season].filter((value) => value.trim()).length} حقل مكتمل</span>}
                <ChevronDown size={16} className={`opacity-50 transition-transform ${docsOpen ? 'rotate-180' : ''}`} />
              </button>
              {docsOpen && (
                <div className="grid gap-2.5 border-t border-[#dce9ff] p-4 md:grid-cols-4 dark:border-slate-800">
                  <Field label="بلد المنشأ"><input value={origin} onChange={(e) => setOrigin(e.target.value)} className={inputCls} placeholder={kind === 'butcher' ? 'السعودية / الصومال…' : 'السعودية / القصيم…'} /></Field>
                  <Field label={kind === 'butcher' ? 'رقم المسلخ / المنشأة' : 'رقم منشأة التعبئة'}><input value={facility} onChange={(e) => setFacility(e.target.value)} className={inputCls} /></Field>
                  <Field label={L.dateLabel}><input type="date" value={prodDate} onChange={(e) => setProdDate(e.target.value)} className={inputCls} /></Field>
                  {kind === 'butcher'
                    ? <Field label="شهادة الحلال (للمستورد)"><input value={halal} onChange={(e) => setHalal(e.target.value)} className={inputCls} placeholder="رقم/جهة الشهادة" /></Field>
                    : <Field label="الموسم"><input value={season} onChange={(e) => setSeason(e.target.value)} className={inputCls} placeholder="موسم 1447هـ" /></Field>}
                </div>
              )}
            </section>

            {/* ⑤ الملاحظات والخيارات */}
            <section className="grid gap-2.5 rounded-xl bg-white p-4 shadow-sm ring-1 ring-[#dce9ff] md:grid-cols-2 dark:bg-slate-900/50 dark:ring-slate-700">
              <Field label="ملاحظات الأمر"><input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} placeholder="اختياري — يظهر في سجل الأوامر والقيد" /></Field>
              <label className="flex items-center gap-2 self-end rounded-lg border border-[#c5c6cf] px-3 py-2.5 text-[11.5px] font-bold dark:border-slate-700">
                <input type="checkbox" checked={allowNegativeSource} onChange={(e) => { setAllowNegativeSource(e.target.checked); localStorage.setItem('shopsys:manufacturing:allow-negative-stock', String(e.target.checked)) }} /> السماح بصرف الخام برصيد سالب
              </label>
            </section>
          </div>

          {/* التذييل: القيد المتوقع + الترحيل */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#c5c6cf] bg-white px-5 py-3 dark:border-slate-700 dark:bg-slate-900">
            <span className="flex items-center gap-1.5 text-[10.5px] text-[#45464e] dark:text-slate-400">
              <BookOpenText size={14} className="text-[#3f5f92]" /> القيد المتوقع: مدين <b className="text-[#0f2042] dark:text-slate-100">1103 مخزون (النواتج {fmt(totalCost)})</b> ← دائن <b className="text-[#0f2042] dark:text-slate-100">1103 مخزون (الخام){overheadMinor > 0 ? ' + الخزينة (المصاريف)' : ''}</b>
            </span>
            <div className="flex items-center gap-2">
              <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
              <Btn onClick={run} shortcut="F9" disabled={!canPost}>ترحيل أمر التجهيز</Btn>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}
