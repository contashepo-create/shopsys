/**
 * التقطيع والفرز والتعبئة (جزارة 🥩 / تمور 🌴)
 * ============================================
 * خام واحد → نواتج متعددة بتوزيع التكلفة بالقيمة البيعية النسبية (المعيار
 * العالمي في برامج الجزارة والتعبئة)، مع فاقد موثق ونسبة تصافٍ لكل أمر،
 * وحقول توثيق سعودية (SFDA: بلد المنشأ/رقم المنشأة/شهادة الحلال/تاريخ الذبح
 * أو الجني/الموسم) — كلها اختيارية كبقية بيانات النظام.
 */
import { useMemo, useState } from 'react'
import { Plus, Scissors, Trash2, ShieldCheck } from 'lucide-react'
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
  const [overhead, setOverhead] = useState('')
  const [treasury, setTreasury] = useState('1101')
  const [notes, setNotes] = useState('')
  // توثيق SFDA
  const [origin, setOrigin] = useState('')
  const [facility, setFacility] = useState('')
  const [halal, setHalal] = useState('')
  const [prodDate, setProdDate] = useState('')
  const [season, setSeason] = useState('')

  const openNew = () => {
    setSourceId(''); setSourceQty(''); setSourceWarehouseId(String(mainWarehouseId)); setOutputWarehouseId(String(mainWarehouseId)); setOuts([{ itemId: '', qty: '' }]); setWaste('')
    setOverhead(''); setTreasury('1101'); setNotes('')
    setOrigin(isSA ? 'السعودية' : ''); setFacility(''); setHalal(''); setProdDate(''); setSeason('')
    setOpen(true)
  }

  const source = items.find((it) => String(it.id) === sourceId)
  const sourceAvailable = source && sourceWarehouseId ? warehouseStock.get(Number(sourceWarehouseId))?.get(source.id) ?? 0 : 0
  const parsedOuts = outs.filter((o) => o.itemId && Number(o.qty) > 0).map((o) => ({ itemId: Number(o.itemId), qty: Number(o.qty) }))
  const outQtySum = parsedOuts.reduce((a, o) => a + o.qty, 0)
  const srcQtyNum = Number(sourceQty) || 0
  const previewYield = srcQtyNum > 0 ? Math.round((outQtySum / srcQtyNum) * 1000) / 10 : 0
  const overheadMinor = overhead ? Math.round(Number(overhead) * 10 ** cur.decimals) : 0
  const totalCost = source ? Math.round(source.costMinor * srcQtyNum) + overheadMinor : 0
  const preview = useMemo(() => {
    if (!source || parsedOuts.length === 0 || !(srcQtyNum > 0)) return null
    try {
      return allocateProcessingCost(parsedOuts, totalCost, (id) => items.find((it) => it.id === id)?.priceMinor ?? 0)
    } catch { return null }
  }, [source, parsedOuts.map((o) => `${o.itemId}:${o.qty}`).join(','), totalCost]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = () => {
    try {
      const order = postProcessing({
        kind, sourceItemId: Number(sourceId), sourceQty: srcQtyNum, sourceWarehouseId: Number(sourceWarehouseId) || null, outputWarehouseId: Number(outputWarehouseId) || null, allowNegativeSource,
        outputs: parsedOuts, overheadMinor, treasury,
        wasteQty: waste ? Number(waste) : 0,
        compliance: { originCountry: origin.trim(), facilityNo: facility.trim(), halalCert: halal.trim(), productionDate: prodDate, season: season.trim() },
        notes: notes.trim(),
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

      {/* نافذة أمر التجهيز */}
      <Modal open={open} onClose={() => setOpen(false)} title={`${L.icon} ${L.nameAr}`} wide>
        <div className="space-y-3">
          <div className="grid md:grid-cols-4 gap-3">
            <Field label={`${L.sourceLabel} *`} hint="صنف الخام — تكلفته الحالية بالمتوسط المرجح ستدخل النواتج">
              <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className={inputCls}>
                <option value="">اختر…</option>
                {items.filter((it) => it.isActive).map((it) => <option key={it.id} value={it.id}>{it.nameAr} — إجمالي {it.stockQty ?? 0} {it.baseUnit}</option>)}
              </select>
            </Field>
            <Field label="مخزن صرف الخام *">
              <select value={sourceWarehouseId} onChange={(e) => setSourceWarehouseId(e.target.value)} className={inputCls}>
                <option value="">اختر المخزن</option>
                {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.nameAr}{source ? ` — متاح ${warehouseStock.get(warehouse.id)?.get(source.id) ?? 0}` : ''}</option>)}
              </select>
            </Field>
            <Field label="الكمية المستهلكة *" hint={source ? `متاح في المخزن: ${sourceAvailable} — تكلفة الوحدة ${fmt(source.costMinor)}` : undefined}>
              <input value={sourceQty} onChange={(e) => setSourceQty(e.target.value)} inputMode="decimal" className={inputCls} placeholder="مثال: 18.5" />
            </Field>
            <Field label="مخزن استلام النواتج *">
              <select value={outputWarehouseId} onChange={(e) => setOutputWarehouseId(e.target.value)} className={inputCls}>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.nameAr}</option>)}</select>
            </Field>
          </div>

          <Field label={`${L.outputLabel} *`} hint="كل جزء/درجة صنف مستقل بسعر بيعه — التوزيع بنسبة (السعر × الكمية)">
            <div className="space-y-2">
              {outs.map((o, i) => (
                <div key={i} className="flex gap-2">
                  <select value={o.itemId} onChange={(e) => setOuts(outs.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)))} className={`${inputCls} flex-1`}>
                    <option value="">الصنف الناتج…</option>
                    {items.filter((it) => it.isActive && String(it.id) !== sourceId).map((it) => <option key={it.id} value={it.id}>{it.nameAr} ({fmt(it.priceMinor)})</option>)}
                  </select>
                  <input value={o.qty} onChange={(e) => setOuts(outs.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} inputMode="decimal" placeholder="الكمية" className={`${inputCls} w-28`} />
                  <button onClick={() => setOuts(outs.filter((_, j) => j !== i))} className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-500/10"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
              <Btn variant="soft" onClick={() => setOuts([...outs, { itemId: '', qty: '' }])}><Plus className="w-4 h-4" /> ناتج آخر</Btn>
            </div>
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label={L.wasteLabel} hint="كمية موثقة فقط — لا تحمل تكلفة"><input value={waste} onChange={(e) => setWaste(e.target.value)} inputMode="decimal" className={inputCls} placeholder="0" /></Field>
            <Field label={`مصاريف تجهيز (${cur.symbol})`} hint="عمالة/كراتين — تدخل تكلفة النواتج"><input value={overhead} onChange={(e) => setOverhead(e.target.value)} inputMode="decimal" className={inputCls} placeholder="0" /></Field>
            {overheadMinor > 0 ? <Field label="مصدر المصاريف"><TreasuryPicker value={treasury} onChange={setTreasury} /></Field> : <div />}
          </div>

          {/* توثيق سعودي SFDA */}
          <div className={`rounded-xl border p-3 space-y-2 ${kind === 'butcher' ? 'border-red-600/20 bg-red-600/5' : 'border-yellow-700/25 bg-yellow-700/5'}`}>
            <div className="flex items-center gap-2 text-[12px] font-black"><ShieldCheck className="w-4 h-4 text-emerald-600" /> توثيق الجودة والحلال (SFDA) — اختياري</div>
            <div className="grid grid-cols-3 gap-2">
              <Field label="بلد المنشأ"><input value={origin} onChange={(e) => setOrigin(e.target.value)} className={inputCls} placeholder={kind === 'butcher' ? 'السعودية / الصومال…' : 'السعودية / القصيم…'} /></Field>
              <Field label={kind === 'butcher' ? 'رقم المسلخ / المنشأة' : 'رقم منشأة التعبئة'}><input value={facility} onChange={(e) => setFacility(e.target.value)} className={inputCls} /></Field>
              <Field label={L.dateLabel}><input type="date" value={prodDate} onChange={(e) => setProdDate(e.target.value)} className={inputCls} /></Field>
              {kind === 'butcher'
                ? <Field label="شهادة الحلال (للمستورد)"><input value={halal} onChange={(e) => setHalal(e.target.value)} className={inputCls} placeholder="رقم/جهة الشهادة" /></Field>
                : <Field label="الموسم"><input value={season} onChange={(e) => setSeason(e.target.value)} className={inputCls} placeholder="موسم 1447هـ" /></Field>}
            </div>
          </div>

          {/* معاينة التوزيع الحية */}
          {preview && (
            <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3 space-y-1 text-[12px]">
              <div className="font-black text-emerald-700 dark:text-emerald-300">
                معاينة: تكلفة كلية {fmt(totalCost)} — تصافي {previewYield}٪
                {srcQtyNum > 0 && outQtySum > srcQtyNum && <span className="text-rose-600"> ⚠️ النواتج أكبر من الخام!</span>}
              </div>
              {preview.map((o) => (
                <div key={o.itemId} className="flex justify-between">
                  <span>{nameOf(o.itemId)} × {o.qty}</span>
                  <span className="tabular-nums font-bold">{fmt(o.allocatedCostMinor)} — الوحدة {fmt(o.unitCostMinor)}</span>
                </div>
              ))}
            </div>
          )}

          <label className="flex items-center gap-2 text-xs font-bold rounded-xl border p-3"><input type="checkbox" checked={allowNegativeSource} onChange={(e) => { setAllowNegativeSource(e.target.checked); localStorage.setItem('shopsys:manufacturing:allow-negative-stock', String(e.target.checked)) }} /> السماح بصرف الخام برصيد سالب</label>
          <Field label="ملاحظات"><input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} /></Field>
          <Btn onClick={run} shortcut="F9" className="w-full" disabled={!sourceId || !sourceWarehouseId || !outputWarehouseId || !(srcQtyNum > 0) || parsedOuts.length === 0}>ترحيل أمر التجهيز</Btn>
        </div>
      </Modal>
    </div>
  )
}
