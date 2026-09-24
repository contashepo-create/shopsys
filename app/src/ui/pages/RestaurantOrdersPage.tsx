/**
 * أوامر المطعم (جولة مراجعة نشاط المطعم — نمط Foodics):
 * شبكة طاولات وأوامر مفتوحة: افتح أمراً (صالة/تيك أواي/دليفري) ← أضف الأصناف
 * ← أرسل بون المطبخ (بلا أسعار) ← عند المغادرة اقفل بفاتورة واحدة
 * (postSale يتولى الوصفات والمخزون والقيد) — قبل القفل لا شيء يلمس الدفاتر.
 */
import { useMemo, useState } from 'react'
import { UtensilsCrossed, Printer, XCircle, ReceiptText, Plus, Scissors } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { ORDER_TYPE_LABELS, orderSubtotalMinor, type RestaurantOrderType } from '../../core/restaurant.ts'
import type { CartLine } from '../../core/pos.ts'
import { renderKitchenTicketHtml } from '../print/printKitchen.ts'
import { printHtml } from '../print/printReceipt.ts'
import { Btn, Field, Modal, inputCls, useToast, EmptyState } from '../components/ui.tsx'

export function RestaurantOrdersPage() {
  const { restaurantOrders, items, treasuries, paymentTerminals, appUsers, currentUserId, openRestaurantOrder, setRestaurantOrderLines, cancelRestaurantOrder, settleRestaurantOrder, splitRestaurantOrder, getEffectivePrice } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)

  const open = restaurantOrders.filter((o) => o.status === 'open')
  const [newOpen, setNewOpen] = useState(false)
  const [nType, setNType] = useState<RestaurantOrderType>('dine_in')
  const [nTable, setNTable] = useState('')
  const [nDelivery, setNDelivery] = useState('')
  const [activeId, setActiveId] = useState<number | null>(null)
  const active = open.find((o) => o.id === activeId) ?? null

  const [itemQuery, setItemQuery] = useState('')
  const [settleFor, setSettleFor] = useState<number | null>(null)
  const [payTreasury, setPayTreasury] = useState('1101')
  const [terminalId, setTerminalId] = useState('')
  const [terminalReference, setTerminalReference] = useState('')
  const [cardLast4, setCardLast4] = useState('')
  const [svcPct, setSvcPct] = useState('')
  const [delFee, setDelFee] = useState('')
  const settleOrder = open.find((o) => o.id === settleFor) ?? null
  const activeUser = appUsers.find((user) => user.id === currentUserId)
  const availableTerminals = paymentTerminals.filter((terminal) => terminal.status === 'active' && (!activeUser || activeUser.roleId === 'owner' || !activeUser.paymentTerminalAccess || activeUser.paymentTerminalAccess.grants.some((grant) => grant.terminalId === terminal.id && grant.operations.includes('charge'))))

  /* تقسيم الفاتورة (فودكس/Toast): اختيار سطور تُفصل لأمر جديد يُفوتر مستقلاً */
  const [splitOpen, setSplitOpen] = useState(false)
  const [splitSel, setSplitSel] = useState<number[]>([])
  const doSplit = () => {
    if (!active) return
    try {
      const child = splitRestaurantOrder(active.id, splitSel)
      setSplitOpen(false); setSplitSel([])
      toast.show(`✂️ فُصلت ${child.lines.length} أصناف إلى ${child.orderNumber} — يُفوتر مستقلاً`)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const sellable = useMemo(() => {
    const q = itemQuery.trim()
    if (!q) return []
    return items.filter((it) => it.isActive && (it.nameAr.includes(q) || it.barcodes.includes(q))).slice(0, 8)
  }, [items, itemQuery])

  const create = () => {
    try {
      const o = openRestaurantOrder({ type: nType, tableName: nTable, deliveryInfo: nDelivery })
      setActiveId(o.id)
      setNewOpen(false)
      setNTable(''); setNDelivery('')
      toast.show(`فُتح ${o.orderNumber} ${ORDER_TYPE_LABELS[o.type].icon}`)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const addItem = (itemId: number) => {
    if (!active) return
    const it = items.find((x) => x.id === itemId)
    if (!it) return
    const lines: CartLine[] = (() => {
      const idx = active.lines.findIndex((l) => l.itemId === itemId)
      if (idx >= 0) return active.lines.map((l, i) => (i === idx ? { ...l, qty: l.qty + 1 } : l))
      return [...active.lines, { itemId, nameAr: it.nameAr, qty: 1, unitPriceMinor: getEffectivePrice(itemId, null), unitCostMinor: it.costMinor, discountPercent: 0, soldByWeight: false }]
    })()
    setRestaurantOrderLines(active.id, lines)
    setItemQuery('')
  }

  const setQty = (idx: number, qty: number) => {
    if (!active) return
    const lines = qty <= 0 ? active.lines.filter((_, i) => i !== idx) : active.lines.map((l, i) => (i === idx ? { ...l, qty } : l))
    setRestaurantOrderLines(active.id, lines)
  }

  const printKitchen = (o: typeof open[number]) => {
    printHtml(renderKitchenTicketHtml({
      shopName: setup.shopName || 'تَحَكَّم',
      orderNumber: o.orderNumber,
      typeLabel: ORDER_TYPE_LABELS[o.type].nameAr,
      tableName: o.tableName,
      notes: o.notes,
      lines: o.lines,
      dateIso: new Date().toISOString(),
    }))
  }

  const settle = () => {
    if (!settleOrder) return
    try {
      const terminal = availableTerminals.find((row) => row.id === terminalId)
      if (terminalId && !terminalReference.trim()) throw new Error('مرجع إيصال ماكينة الدفع مطلوب')
      const sale = settleRestaurantOrder({
        orderId: settleOrder.id,
        payment: 'cash',
        treasury: (terminal?.settlementAccountCode ?? payTreasury) as never,
        terminalPayment: terminal ? { terminalId: terminal.id, providerReference: terminalReference.trim(), cardLast4: cardLast4 || undefined } : undefined,
        serviceChargePercent: Number(svcPct) || 0,
        deliveryFeeMinor: delFee.trim() ? toMinor(delFee, cur.decimals) : 0,
        taxPercent: setup.vatPercent,
        taxInclusive: setup.taxInclusive,
      })
      toast.show(`قُفل ${settleOrder.orderNumber} بالفاتورة ${sale.invoiceNumber} — ${fmt(sale.totals.totalMinor)} ${cur.symbol} ✓`)
      setSettleFor(null)
      if (activeId === settleOrder.id) setActiveId(null)
      setSvcPct(''); setDelFee(''); setTerminalId(''); setTerminalReference(''); setCardLast4('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  return (
    <div className="space-y-4">
      <div className="anim-up flex items-center justify-between flex-wrap gap-3">
        <p className="text-[12px] text-slate-400 max-w-xl leading-relaxed">
          <UtensilsCrossed size={14} className="inline -mt-0.5 ml-1" />
          الطاولة تفتح أمراً يظل مفتوحاً طوال الجلسة، المطبخ يستلم بوناً <b>بلا أسعار</b>،
          وعند المغادرة يُقفل الأمر بفاتورة واحدة تتولى الوصفات والمخزون والقيد — قبلها لا شيء يلمس الدفاتر.
        </p>
        <Btn onClick={() => setNewOpen(true)}><Plus size={15} /> أمر جديد</Btn>
      </div>

      {/* شبكة الأوامر المفتوحة */}
      {open.length === 0 ? (
        <EmptyState icon="🍽️" title="لا أوامر مفتوحة" sub="افتح أمراً لطاولة أو تيك أواي أو دليفري" />
      ) : (
        <div className="anim-up grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {open.map((o) => (
            <button key={o.id} onClick={() => setActiveId(o.id)}
              className={`text-right rounded-2xl border-2 p-4 transition-all duration-200 ${activeId === o.id ? 'border-orange-500/70 bg-orange-500/10 shadow-lg shadow-orange-500/10' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-card-dark hover:border-orange-300'}`}>
              <div className="flex items-center justify-between">
                <span className="text-2xl">{ORDER_TYPE_LABELS[o.type].icon}</span>
                <span className="text-[10px] font-bold text-slate-400">{o.orderNumber}</span>
              </div>
              <div className="font-black text-[14px] text-slate-800 dark:text-white mt-1">
                {o.type === 'dine_in' ? `طاولة ${o.tableName}` : ORDER_TYPE_LABELS[o.type].nameAr}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">{o.lines.length} صنف — {fmt(orderSubtotalMinor(o.lines))} {cur.symbol}</div>
              <div className="text-[10px] text-slate-300 dark:text-slate-600 mt-0.5">منذ {new Date(o.openedAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</div>
            </button>
          ))}
        </div>
      )}

      {/* تفاصيل الأمر النشط */}
      {active && (
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-orange-200/60 dark:border-orange-900/40 p-5 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-black text-[14px] text-orange-600">{ORDER_TYPE_LABELS[active.type].icon} {active.orderNumber}{active.tableName ? ` — طاولة ${active.tableName}` : ''}</h3>
            <div className="flex gap-2">
              <Btn variant="soft" onClick={() => printKitchen(active)} disabled={active.lines.length === 0}><Printer size={14} /> بون المطبخ</Btn>
              <Btn variant="soft" onClick={() => { setSplitSel([]); setSplitOpen(true) }} disabled={active.lines.length < 2}><Scissors size={14} /> تقسيم</Btn>
              <Btn variant="soft" onClick={() => {
                const reason = window.prompt('سبب الإلغاء؟')
                if (reason?.trim()) { try { cancelRestaurantOrder(active.id, reason); setActiveId(null); toast.show('أُلغي الأمر') } catch (e) { toast.show((e as Error).message, 'error') } }
              }}><XCircle size={14} /> إلغاء</Btn>
              <Btn onClick={() => { setSettleFor(active.id); setPayTreasury(treasuries[0]?.code ?? '1101') }} disabled={active.lines.length === 0}><ReceiptText size={14} /> الفاتورة والدفع</Btn>
            </div>
          </div>
          <div className="relative">
            <input value={itemQuery} onChange={(e) => setItemQuery(e.target.value)} className={inputCls} placeholder="أضف صنفاً بالاسم أو الباركود…" />
            {sellable.length > 0 && (
              <div className="absolute z-10 inset-x-0 top-full mt-1 rounded-xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-700 shadow-xl overflow-hidden">
                {sellable.map((it) => (
                  <button key={it.id} onClick={() => addItem(it.id)} className="w-full flex justify-between px-4 py-2 text-[12px] hover:bg-orange-500/10 transition-colors">
                    <span className="font-bold">{it.nameAr}</span>
                    <span className="text-slate-400" dir="ltr">{fmt(getEffectivePrice(it.id, null))}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {active.lines.map((l, i) => (
            <div key={i} className="flex items-center gap-3 text-[12.5px]">
              <div className="flex-1 font-bold text-slate-700 dark:text-slate-200">{l.nameAr}</div>
              <div className="flex items-center rounded-xl border-2 border-slate-200 dark:border-slate-700 overflow-hidden h-8">
                <button onClick={() => setQty(i, l.qty - 1)} className="w-7 h-full text-slate-500 font-bold hover:bg-rose-500/10">−</button>
                <span className="w-9 text-center font-black">{l.qty}</span>
                <button onClick={() => setQty(i, l.qty + 1)} className="w-7 h-full text-slate-500 font-bold hover:bg-emerald-500/10">+</button>
              </div>
              <span className="w-24 text-left font-bold text-slate-500" dir="ltr">{fmt(Math.round(l.unitPriceMinor * l.qty))}</span>
            </div>
          ))}
          {active.lines.length > 0 && (
            <div className="rounded-xl bg-orange-500/5 px-4 py-2.5 flex justify-between text-[13px] font-black">
              <span className="text-slate-500">إجمالي الأصناف (قبل الرسوم والضريبة)</span>
              <span className="text-orange-600" dir="ltr">{fmt(orderSubtotalMinor(active.lines))} {cur.symbol}</span>
            </div>
          )}
        </div>
      )}

      {/* أمر جديد */}
      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="أمر جديد">
        <div className="flex gap-2">
          {(Object.keys(ORDER_TYPE_LABELS) as RestaurantOrderType[]).map((t) => (
            <button key={t} onClick={() => setNType(t)}
              className={`flex-1 py-3 rounded-xl border-2 text-[12.5px] font-bold transition-all ${nType === t ? 'border-orange-500/70 bg-orange-500/10 text-orange-600' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>
              <div className="text-xl">{ORDER_TYPE_LABELS[t].icon}</div>
              {ORDER_TYPE_LABELS[t].nameAr}
            </button>
          ))}
        </div>
        {nType === 'dine_in' && (
          <Field label="الطاولة"><input value={nTable} onChange={(e) => setNTable(e.target.value)} className={inputCls} placeholder="مثال: 5 أو تراس-2" autoFocus /></Field>
        )}
        {nType === 'delivery' && (
          <Field label="بيانات التوصيل" hint="اسم / هاتف / عنوان — تُطبع على البون"><input value={nDelivery} onChange={(e) => setNDelivery(e.target.value)} className={inputCls} autoFocus /></Field>
        )}
        <Btn onClick={create} className="w-full mt-2">فتح الأمر</Btn>
      </Modal>

      {/* القفل والدفع */}
      <Modal open={settleFor != null} onClose={() => setSettleFor(null)} title={`فاتورة ${settleOrder?.orderNumber ?? ''}`}>
        {settleOrder && (
          <div className="space-y-3">
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 px-4 py-3 flex justify-between text-[12.5px] font-bold">
              <span className="text-slate-400">الأصناف</span>
              <span dir="ltr">{fmt(orderSubtotalMinor(settleOrder.lines))} {cur.symbol}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="رسوم خدمة ٪ (صالة)"><input value={svcPct} onChange={(e) => setSvcPct(e.target.value)} className={inputCls} dir="ltr" placeholder="0" /></Field>
              {settleOrder.type === 'delivery' && (
                <Field label={`رسوم توصيل (${cur.symbol})`}><input value={delFee} onChange={(e) => setDelFee(e.target.value)} className={inputCls} dir="ltr" placeholder="0" /></Field>
              )}
              <Field label="طريقة التحصيل">
                <select value={terminalId} onChange={(e) => setTerminalId(e.target.value)} className={inputCls}>
                  <option value="">💰 نقدي/بنك</option>
                  {availableTerminals.map((terminal) => <option key={terminal.id} value={terminal.id}>💳 {terminal.nameAr}</option>)}
                </select>
              </Field>
              {!terminalId && <Field label="الخزينة المستلمة">
                <select value={payTreasury} onChange={(e) => setPayTreasury(e.target.value)} className={inputCls}>
                  {treasuries.map((t) => <option key={t.code} value={t.code}>{t.kind === 'cash' ? '💰' : '🏦'} {t.nameAr}</option>)}
                </select>
              </Field>}
              {terminalId && <><Field label="مرجع إيصال الماكينة *"><input value={terminalReference} onChange={(e) => setTerminalReference(e.target.value)} className={inputCls}/></Field><Field label="آخر 4 أرقام (اختياري)"><input value={cardLast4} onChange={(e) => setCardLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" maxLength={4} className={inputCls}/></Field></>}
            </div>
            <p className="text-[11px] text-slate-400">الضريبة والوصفات وخصم الخامات كلها عبر فاتورة الكاشير نفسها — قيد واحد متوازن.</p>
            <Btn onClick={settle} shortcut="F9" className="w-full">قفل الأمر وإصدار الفاتورة</Btn>
          </div>
        )}
      </Modal>

      {/* حوار تقسيم الحساب: اختر السطور المفصولة لأمر جديد يُفوتر مستقلاً */}
      <Modal open={splitOpen && !!active} onClose={() => setSplitOpen(false)} title="✂️ تقسيم الحساب">
        {active && (
          <div className="space-y-3">
            <p className="text-[11.5px] text-slate-400 leading-relaxed">
              اختر الأصناف التي يدفعها الطرف الآخر — تُفصل لأمر جديد مستقل يُقفل بفاتورته،
              والباقي يبقى على {active.type === 'dine_in' ? `طاولة ${active.tableName}` : 'الأمر الأصلي'}.
            </p>
            <div className="space-y-1.5 max-h-[20rem] overflow-y-auto">
              {active.lines.map((l, i) => (
                <label key={i} className="flex items-center gap-2 text-[12.5px] bg-slate-50 dark:bg-slate-800/50 rounded-xl px-3 py-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={splitSel.includes(i)}
                    onChange={(e) => setSplitSel((prev) => (e.target.checked ? [...prev, i] : prev.filter((x) => x !== i)))}
                    className="accent-orange-600"
                  />
                  <span className="font-bold flex-1">{l.nameAr}</span>
                  <span className="text-slate-400">× {l.qty}</span>
                  <span className="text-slate-500 font-bold w-20 text-left" dir="ltr">{fmt(Math.round(l.unitPriceMinor * l.qty))}</span>
                </label>
              ))}
            </div>
            <div className="flex items-center justify-between text-[12px] font-bold">
              <span className="text-slate-500">المفصول: {splitSel.length} من {active.lines.length}</span>
              <span className="text-orange-600">{fmt(active.lines.filter((_, i) => splitSel.includes(i)).reduce((s, l) => s + Math.round(l.unitPriceMinor * l.qty), 0))} {cur.symbol}</span>
            </div>
            <Btn onClick={doSplit} shortcut="F9" className="w-full" disabled={splitSel.length === 0 || splitSel.length === active.lines.length}>
              <Scissors size={14} /> فصل المحدد لفاتورة مستقلة
            </Btn>
          </div>
        )}
      </Modal>
    </div>
  )
}
