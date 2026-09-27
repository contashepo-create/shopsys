import { QuickSelect } from '../components/KeyboardPickers.tsx'
/**
 * الاستبدال (جولة مراجعة نشاط الملابس):
 * العميل يرجع قطعة (مقاس/لون) ويأخذ غيرها فوراً — عملية واحدة للكاشير:
 * اختر الفاتورة ← حدد المرتجع ← اختر الجديد ← الصافي يُعرض (يدفع/نرد/متكافئ)
 * والنظام يولد مرتجعاً + بيعاً كاملين مربوطين بمستند EXC-#### واحد.
 */
import { useMemo, useState } from 'react'
import { Repeat, Search, ArrowLeftRight, Trash2 } from 'lucide-react'
import { useDataStore, type SaleInvoice } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import { remainingByLine, type ReturnCondition, type ReturnLineSpec } from '../../core/returns.ts'
import { computeExchangeNet } from '../../core/exchange.ts'
import { hasVariantStock, variantLabel } from '../../core/variants.ts'
import { CreditLimitError, type CartLine } from '../../core/pos.ts'
import { Btn, Modal, inputCls, useToast, EmptyState } from '../components/ui.tsx'
import { useSupervisorApproval } from '../components/SupervisorPinDialog.tsx'

export function ExchangePage() {
  const { sales, saleReturns, items, customers, treasuries, variantStocks, exchanges, postExchange, getEffectivePrice } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const approval = useSupervisorApproval() // الاستبدال يتضمن مرتجعاً — موافقة مشرف
  // استبدال آجل بأغلى قد يتخطى حد ائتمان العميل — تجاوز باعتماد مدير (نفس نمط الكاشير)
  const creditApproval = useSupervisorApproval('sales.credit.override')
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)

  const [pickOpen, setPickOpen] = useState(false)
  const [pickQuery, setPickQuery] = useState('')
  const [sale, setSale] = useState<SaleInvoice | null>(null)
  /** بمفتاح «فهرس السطر» في الفاتورة (النمط العالمي) — كل سطر بسعره وحالته */
  const [retQtys, setRetQtys] = useState<Record<number, string>>({})
  const [retConds, setRetConds] = useState<Record<number, ReturnCondition>>({})
  const [newLines, setNewLines] = useState<CartLine[]>([])
  /** نص الكمية لكل سطر جديد — يقبل الكسور العشرية (وزن ⚖️) أثناء الكتابة */
  const [newQtyTexts, setNewQtyTexts] = useState<Record<number, string>>({})
  const [itemQuery, setItemQuery] = useState('')
  const [treasury, setTreasury] = useState('')
  const [notes, setNotes] = useState('')

  const remaining = useMemo(() => {
    if (!sale) return [] as number[]
    const prior = saleReturns.filter((r) => r.saleId === sale.id).flatMap((r) => r.lines)
    return remainingByLine(sale.lines, prior)
  }, [sale, saleReturns])

  const pickable = useMemo(() => {
    const q = pickQuery.trim()
    return [...sales].reverse().filter((s) => !q || s.invoiceNumber.includes(q) || (s.refCode ?? '').includes(q.toUpperCase())).slice(0, 20)
  }, [sales, pickQuery])

  const sellable = useMemo(() => {
    const q = itemQuery.trim()
    if (!q) return []
    return items.filter((it) => it.isActive && (it.nameAr.includes(q) || it.barcodes.includes(q) || it.sku === q)).slice(0, 8)
  }, [items, itemQuery])

  /** قيمة المرتجع بأسعار الفاتورة الأصلية (بعد خصم السطر) — تقريب للعرض فقط، الدقيق في القيد */
  const returnValue = useMemo(() => {
    if (!sale) return 0
    let v = 0
    sale.lines.forEach((l, idx) => {
      const q = Number(retQtys[idx] || 0)
      if (q > 0) v += Math.round(l.unitPriceMinor * q * (1 - l.discountPercent / 100))
    })
    return v
  }, [sale, retQtys])

  const newValue = newLines.reduce((a, l) => a + Math.round(l.unitPriceMinor * l.qty), 0)
  const preview = computeExchangeNet(returnValue, newValue)

  const addNewItem = (itemId: number, color = '', size = '') => {
    const it = items.find((x) => x.id === itemId)
    if (!it) return
    if (hasVariantStock(variantStocks, itemId) && !color && !size) {
      const variants = variantStocks.filter((v) => v.itemId === itemId && v.qty > 0)
      if (variants.length === 0) { toast.show('لا رصيد بأي تركيبة لهذا الصنف', 'error'); return }
      // أبسط مسار: خذ أول تركيبة متاحة كافتراضي والمستخدم يعدل من السطر
      color = variants[0].color; size = variants[0].size
    }
    setNewLines((prev) => {
      setNewQtyTexts((t) => ({ ...t, [prev.length]: '1' }))
      return [...prev, {
        itemId, nameAr: color || size ? `${it.nameAr} (${variantLabel(color, size)})` : it.nameAr,
        qty: 1, unitPriceMinor: getEffectivePrice(itemId, null), unitCostMinor: it.costMinor,
        discountPercent: 0, soldByWeight: it.soldByWeight, // ⚖️ الوزني يقبل كسوراً (كان false ثابتة)
        variantColor: color || undefined, variantSize: size || undefined,
      }]
    })
    setItemQuery('')
  }

  const submit = (creditLimitOverrideBy?: string) => {
    if (!sale) return
    approval.request((approvedBy) => {
    try {
      const specs: ReturnLineSpec[] = []
      for (const [idxStr, v] of Object.entries(retQtys)) {
        const q = Number(v)
        const idx = Number(idxStr)
        if (q > 0) specs.push({ lineIndex: idx, qty: q, condition: retConds[idx] ?? 'resellable' })
      }
      const doc = postExchange({
        originalSaleId: sale.id,
        returnLineSpecs: specs,
        newLines,
        treasury: (treasury || undefined) as never,
        notes,
        approvedBy,
        creditLimitOverrideBy: creditLimitOverrideBy ?? null,
      })
      toast.show(
        doc.netMinor === 0
          ? `استبدال متكافئ ✓ ${doc.exchangeNumber} — لا فرق نقدي`
          : doc.netMinor > 0
            ? `${doc.exchangeNumber}: العميل يدفع فرقاً ${fmt(doc.netMinor)} ${cur.symbol}`
            : `${doc.exchangeNumber}: يُرد للعميل ${fmt(-doc.netMinor)} ${cur.symbol}`,
      )
      setSale(null); setRetQtys({}); setRetConds({}); setNewLines([]); setNewQtyTexts({}); setNotes('')
    } catch (e) {
      // استبدال آجل بأغلى تخطى حد العميل: اللقطة استُرجعت في repo — اعرض اعتماد المدير
      if (e instanceof CreditLimitError) {
        creditApproval.request((creditBy) => submit(creditBy ?? 'المشرف'))
        return
      }
      toast.show((e as Error).message, 'error')
    }
    })
  }

  return (
    <div className="space-y-4">
      <p className="anim-up text-[12px] text-slate-400 max-w-2xl leading-relaxed">
        <Repeat size={14} className="inline -mt-0.5 ml-1" />
        مقاس لا يناسب؟ لون غير مطلوب؟ الاستبدال هنا عملية واحدة: مرتجع + بيع جديد بمستند
        <b> EXC</b> — الدفاتر تسجل العمليتين كاملتين (لا «قيد مختصر» يشوه المبيعات والمرتجعات)
        وحركة الخزينة الفعلية = الفرق فقط.
      </p>

      {!sale ? (
        <div className="anim-up">
          <Btn onClick={() => { setPickQuery(''); setPickOpen(true) }}><Search size={15} /> اختر الفاتورة الأصلية</Btn>
        </div>
      ) : (
        <div className="anim-up grid lg:grid-cols-2 gap-4">
          {/* المرتجع */}
          <div className="rounded-2xl bg-white dark:bg-card-dark border border-rose-200/60 dark:border-rose-900/40 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-black text-[13px] text-rose-500">① القطع المرتجعة — {sale.invoiceNumber}</h3>
              <button onClick={() => { setSale(null); setRetQtys({}); setRetConds({}); setNewLines([]); setNewQtyTexts({}) }} className="text-[11px] text-slate-400 hover:text-rose-500">تغيير الفاتورة</button>
            </div>
            {sale.lines.map((l, idx) => {
              const rem = remaining[idx] ?? 0
              const cond = retConds[idx] ?? 'resellable'
              return (
                <div key={idx} className="flex items-center gap-3 text-[12px]">
                  <div className="flex-1">
                    <div className="font-bold text-slate-700 dark:text-slate-200">{l.nameAr}</div>
                    <div className="text-[10px] text-slate-400">
                      {fmt(l.unitPriceMinor)}{l.discountPercent > 0 && ` −${l.discountPercent}٪`} — المتبقي القابل للإرجاع: {rem}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setRetConds((p) => ({ ...p, [idx]: 'resellable' }))}
                      disabled={rem <= 0}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-all disabled:opacity-30 ${cond === 'resellable' ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}
                    >✅ سليم</button>
                    <button
                      onClick={() => setRetConds((p) => ({ ...p, [idx]: 'damaged' }))}
                      disabled={rem <= 0}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-all disabled:opacity-30 ${cond === 'damaged' ? 'border-rose-500/50 bg-rose-500/10 text-rose-600' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}
                    >🗑️ تالف</button>
                  </div>
                  <input
                    value={retQtys[idx] ?? ''}
                    onChange={(e) => setRetQtys((p) => ({ ...p, [idx]: e.target.value.replace(/[^\d.]/g, '') }))}
                    inputMode="decimal" autoComplete="off"
                    title={l.soldByWeight ? 'صنف وزني ⚖️ — اكتب الوزن بكسور مثل 1.75' : 'الكمية المرتجعة'}
                    className={`${inputCls} !w-20 !py-1.5 text-center`} dir="ltr" placeholder="0" disabled={rem <= 0}
                  />
                </div>
              )
            })}
            <div className="rounded-xl bg-rose-500/5 px-4 py-2.5 flex justify-between text-[12px] font-bold">
              <span className="text-slate-400">قيمة المرتجع</span>
              <span className="text-rose-500" dir="ltr">{fmt(returnValue)} {cur.symbol}</span>
            </div>
          </div>

          {/* الجديد */}
          <div className="rounded-2xl bg-white dark:bg-card-dark border border-emerald-200/60 dark:border-emerald-900/40 p-5 space-y-3">
            <h3 className="font-black text-[13px] text-emerald-600">② القطع الجديدة</h3>
            <div className="relative">
              <input value={itemQuery} onChange={(e) => setItemQuery(e.target.value)} className={inputCls} placeholder="ابحث بالاسم أو الباركود…" />
              {sellable.length > 0 && (
                <div className="absolute z-10 inset-x-0 top-full mt-1 rounded-xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-700 shadow-xl overflow-hidden">
                  {sellable.map((it) => (
                    <button key={it.id} onClick={() => addNewItem(it.id)} className="w-full flex justify-between px-4 py-2 text-[12px] hover:bg-brand-500/10 transition-colors">
                      <span className="font-bold">{it.nameAr}</span>
                      <span className="text-slate-400" dir="ltr">{fmt(getEffectivePrice(it.id, null))}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {newLines.map((l, i) => (
              <div key={i} className="flex items-center gap-2 text-[12px]">
                <div className="flex-1 font-bold text-slate-700 dark:text-slate-200">{l.nameAr}</div>
                <input
                  value={newQtyTexts[i] ?? String(l.qty)}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^\d.]/g, '')
                    setNewQtyTexts((t) => ({ ...t, [i]: raw }))
                    const n = Number(raw)
                    if (Number.isFinite(n)) setNewLines((p) => p.map((x, j) => (j === i ? { ...x, qty: l.soldByWeight ? Math.round(n * 1000) / 1000 : Math.floor(n) } : x)))
                  }}
                  inputMode="decimal" autoComplete="off"
                  title={l.soldByWeight ? 'صنف وزني — يقبل كسوراً مثل 2.35' : 'كمية صحيحة'}
                  className={`${inputCls} !w-20 !py-1.5 text-center`} dir="ltr"
                />
                <span className="text-slate-400 w-20 text-left" dir="ltr">{fmt(Math.round(l.unitPriceMinor * l.qty))}</span>
                <button onClick={() => { setNewLines((p) => p.filter((_, j) => j !== i)); setNewQtyTexts((t) => { const out: Record<number, string> = {}; Object.entries(t).forEach(([k, v]) => { const ki = Number(k); if (ki < i) out[ki] = v; else if (ki > i) out[ki - 1] = v }); return out }) }} className="text-slate-300 hover:text-rose-500"><Trash2 size={14} /></button>
              </div>
            ))}
            <div className="rounded-xl bg-emerald-500/5 px-4 py-2.5 flex justify-between text-[12px] font-bold">
              <span className="text-slate-400">قيمة الجديد</span>
              <span className="text-emerald-600" dir="ltr">{fmt(newValue)} {cur.symbol}</span>
            </div>
          </div>

          {/* الصافي والترحيل */}
          <div className="lg:col-span-2 rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5 flex flex-wrap items-center gap-4">
            <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-[13px] ${preview.netMinor === 0 ? 'bg-slate-100 dark:bg-slate-800 text-slate-500' : preview.netMinor > 0 ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-500'}`}>
              <ArrowLeftRight size={15} />
              {preview.netMinor === 0 ? 'تبادل متكافئ — لا فرق' : preview.netMinor > 0 ? `العميل يدفع ${fmt(preview.netMinor)} ${cur.symbol}` : `نرد للعميل ${fmt(-preview.netMinor)} ${cur.symbol}`}
            </div>
            <QuickSelect value={treasury} onChange={(e) => setTreasury(e.target.value)} className={`${inputCls} !w-52`}>
              <option value="">خزينة الفاتورة الأصلية</option>
              {treasuries.map((t) => <option key={t.code} value={t.code}>{t.kind === 'cash' ? '💰' : '🏦'} {t.nameAr}</option>)}
            </QuickSelect>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={`${inputCls} flex-1 min-w-48`} placeholder="ملاحظات (اختياري)…" />
            <Btn onClick={submit} shortcut="F9" disabled={returnValue <= 0 || newLines.length === 0}>ترحيل الاستبدال</Btn>
          </div>
        </div>
      )}

      {/* سجل الاستبدالات */}
      <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 text-[12px] font-black text-slate-500">سجل الاستبدالات</div>
        {exchanges.length === 0 ? (
          <EmptyState icon="🔁" title="لا استبدالات بعد" sub="كل استبدال يوثق مرتجعه وبيعه الجديد مربوطين بمستند EXC واحد" />
        ) : (
          <table className="w-full text-[11.5px]">
            <thead>
              <tr className="text-right text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <th className="px-3 py-2">المستند</th>
                <th className="px-3 py-2">الفاتورة الأصلية</th>
                <th className="px-3 py-2">المرتجع</th>
                <th className="px-3 py-2">الجديد</th>
                <th className="px-3 py-2">الصافي</th>
              </tr>
            </thead>
            <tbody>
              {[...exchanges].reverse().slice(0, 50).map((x) => {
                const orig = sales.find((s) => s.id === x.originalSaleId)
                return (
                  <tr key={x.id} className="border-b border-slate-50 dark:border-slate-800/50">
                    <td className="px-3 py-2">
                      <div className="font-bold text-slate-700 dark:text-slate-200">{x.exchangeNumber}</div>
                      <div className="text-[9.5px] text-slate-400">{x.date.slice(0, 10)}{x.notes ? ` — ${x.notes}` : ''}</div>
                    </td>
                    <td className="px-3 py-2 text-slate-500 font-bold">{orig?.invoiceNumber ?? `#${x.originalSaleId}`}</td>
                    <td className="px-3 py-2 font-mono text-rose-500" dir="ltr">{fmt(x.returnValueMinor)}</td>
                    <td className="px-3 py-2 font-mono text-emerald-600" dir="ltr">{fmt(x.newValueMinor)}</td>
                    <td className={`px-3 py-2 font-mono font-bold ${x.netMinor === 0 ? 'text-slate-400' : x.netMinor > 0 ? 'text-emerald-600' : 'text-rose-500'}`} dir="ltr">
                      {x.netMinor > 0 ? '+' : ''}{fmt(x.netMinor)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={pickOpen} onClose={() => setPickOpen(false)} title="اختر الفاتورة الأصلية">
        <input value={pickQuery} onChange={(e) => setPickQuery(e.target.value)} className={inputCls} placeholder="رقم الفاتورة أو الكود المرجعي…" autoFocus />
        <div className="mt-3 space-y-1.5 max-h-80 overflow-auto">
          {pickable.map((s) => (
            <button key={s.id} onClick={() => { setSale(s); setRetQtys({}); setRetConds({}); setNewLines([]); setNewQtyTexts({}); setPickOpen(false) }}
              className="w-full flex justify-between items-center px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-brand-500/60 hover:bg-brand-500/5 transition-all text-[12px]">
              <span className="font-bold">{s.invoiceNumber} <span className="text-slate-400 font-normal">— {s.customerId ? customers.find((c) => c.id === s.customerId)?.nameAr : 'عميل نقدي'}</span></span>
              <span className="text-slate-400" dir="ltr">{fmt(s.totals.totalMinor)} {cur.symbol}</span>
            </button>
          ))}
        </div>
      </Modal>
      {approval.dialog}
      {creditApproval.dialog}
    </div>
  )
}
