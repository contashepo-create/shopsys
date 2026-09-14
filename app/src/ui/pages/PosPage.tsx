/**
 * شاشة البيع (الكاشير) — قلب المنتج ⭐ (المرحلة 2)
 * - بحث فوري + مسح باركود (Enter) + شبكة أصناف باللمس
 * - كاش/آجل، خصم سطر وخصم فاتورة، تعليق واستكمال فواتير
 * - كل فاتورة تولّد قيداً محاسبياً متوازناً تلقائياً (القرار 9)
 */
import { useMemo, useRef, useState, useEffect } from 'react'
import { Banknote, UserRound, Trash2, PauseCircle, PlayCircle, ShoppingCart, CheckCircle2, ScanBarcode, Printer } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import { computeTotals, type CartLine } from '../../core/pos.ts'
import { parseScaleBarcode, matchScaleItem } from '../../core/barcode.ts'
import { currentOpenShift } from '../../core/shifts.ts'
import { buildReceiptModel } from '../../core/receipt.ts'
import { renderReceiptHtml, printHtml } from '../print/printReceipt.ts'
import { Btn, Modal, inputCls, useToast } from '../components/ui.tsx'

interface HeldCart { id: number; label: string; lines: CartLine[]; discount: number }

export function PosPage() {
  const { items, customers, shifts, postSale } = useDataStore()
  const openShift = currentOpenShift(shifts)
  const { setup, receipt, autoPrintAfterSale } = useAppStore()
  const toast = useToast()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)

  const [query, setQuery] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [invoiceDiscount, setInvoiceDiscount] = useState(0)
  const [held, setHeld] = useState<HeldCart[]>([])
  const [payOpen, setPayOpen] = useState(false)
  const [payment, setPayment] = useState<'cash' | 'credit'>('cash')
  const [customerId, setCustomerId] = useState<number | null>(null)
  const [lastInvoice, setLastInvoice] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // التركيز الدائم على البحث — سلوك كاشير حقيقي (القارئ يكتب ثم Enter)
  useEffect(() => { searchRef.current?.focus() }, [cart.length])

  // F9 = فتح الدفع مباشرة (الاختصار المكتوب على الزر يعمل فعلاً)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F9') {
        e.preventDefault()
        if (cart.length) setPayOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cart.length])

  const sellable = useMemo(() => items.filter((it) => it.isActive), [items])

  const filtered = useMemo(() => {
    const q = query.trim()
    if (!q) return sellable.slice(0, 24)
    return sellable.filter((it) => it.nameAr.includes(q) || it.sku.includes(q) || it.barcodes.some((b) => b.includes(q))).slice(0, 24)
  }, [sellable, query])

  const addToCart = (itemId: number, weightQty?: number) => {
    const it = items.find((x) => x.id === itemId)
    if (!it) return
    // حماية من خطأ «السعر صفر»: لا صنف بلا سعر بيع يدخل السلة بصمت
    if (it.priceMinor <= 0) {
      toast.show(`«${it.nameAr}» بلا سعر بيع! حدّد سعره من المخزون ← الأصناف أولاً`, 'error')
      return
    }
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.itemId === itemId)
      if (idx >= 0 && !weightQty) {
        return prev.map((l, i) => (i === idx ? { ...l, qty: l.qty + (l.soldByWeight ? 0.5 : 1) } : l))
      }
      if (idx >= 0 && weightQty) {
        // مسح ميزان لصنف موجود: أضف الوزن الجديد للكمية
        return prev.map((l, i) => (i === idx ? { ...l, qty: Math.round((l.qty + weightQty) * 1000) / 1000 } : l))
      }
      return [...prev, {
        itemId: it.id, nameAr: it.nameAr,
        qty: weightQty ?? (it.soldByWeight ? 0.5 : 1),
        unitPriceMinor: it.priceMinor, unitCostMinor: it.costMinor,
        discountPercent: 0, soldByWeight: it.soldByWeight,
      }]
    })
  }

  /**
   * مسح باركود (Enter):
   * 1) باركود ميزان (22XXXXXWWWWW) → يضيف الصنف بوزنه من الملصق مباشرة
   * 2) باركود عادي مطابق → إضافة فورية
   * 3) نتيجة بحث وحيدة → إضافة
   */
  const onSearchEnter = () => {
    const q = query.trim()
    if (!q) return
    // باركود ميزان؟ (طلب المالك: بائع الأجبان يزن ويطبع، والكاشير يمسح)
    const scale = parseScaleBarcode(q)
    if (scale) {
      const it = matchScaleItem(scale.itemCode, sellable)
      if (it) {
        addToCart(it.id, scale.weightKg)
        toast.show(`⚖️ ${it.nameAr} — ${scale.weightKg} كجم من باركود الميزان`)
        setQuery('')
        return
      }
      toast.show(`باركود ميزان لصنف غير معروف (كود ${scale.itemCode})`, 'error')
      setQuery('')
      return
    }
    const exact = sellable.find((it) => it.barcodes.includes(q) || it.sku === q)
    if (exact) {
      addToCart(exact.id)
      setQuery('')
      return
    }
    if (filtered.length === 1) {
      addToCart(filtered[0].id)
      setQuery('')
    }
  }

  const totals = useMemo(() => {
    try {
      if (!cart.length) return null
      return computeTotals(cart, invoiceDiscount, setup.vatPercent, setup.taxInclusive)
    } catch { return null }
  }, [cart, invoiceDiscount, setup.vatPercent, setup.taxInclusive])

  /** طباعة إيصال فاتورة (المرحلة 5) */
  const printSale = (sale: { invoiceNumber: string; date: string; lines: CartLine[]; totals: ReturnType<typeof computeTotals>; payment: 'cash' | 'credit'; customerId: number | null }) => {
    const model = buildReceiptModel({
      invoiceNumber: sale.invoiceNumber,
      dateIso: sale.date,
      lines: sale.lines,
      totals: sale.totals,
      payment: sale.payment,
      customerName: sale.customerId ? customers.find((c) => c.id === sale.customerId)?.nameAr ?? null : null,
      taxPercent: setup.vatPercent,
      taxInclusive: setup.taxInclusive,
      settings: receipt,
    })
    printHtml(renderReceiptHtml(model, cur, receipt.paperWidth))
  }

  const [lastSale, setLastSale] = useState<Parameters<typeof printSale>[0] | null>(null)

  const finishSale = () => {
    if (!cart.length) return
    try {
      const sale = postSale({
        lines: cart,
        customerId: payment === 'credit' ? customerId : null,
        payment,
        invoiceDiscountPercent: invoiceDiscount,
        taxPercent: setup.vatPercent,
        taxInclusive: setup.taxInclusive,
      })
      setLastInvoice(sale.invoiceNumber)
      setLastSale(sale)
      setCart([])
      setInvoiceDiscount(0)
      setPayOpen(false)
      setPayment('cash')
      setCustomerId(null)
      toast.show(`تمت الفاتورة ${sale.invoiceNumber} — القيد المحاسبي تولّد تلقائياً ✓`)
      if (autoPrintAfterSale) printSale(sale)
    } catch (e) {
      toast.show((e as Error).message, 'error')
    }
  }

  const holdCart = () => {
    if (!cart.length) return
    setHeld((h) => [...h, { id: Date.now(), label: `فاتورة معلقة ${h.length + 1}`, lines: cart, discount: invoiceDiscount }])
    setCart([])
    setInvoiceDiscount(0)
    toast.show('عُلّقت الفاتورة — استكملها من الزر الأصفر')
  }

  const resumeCart = (hc: HeldCart) => {
    if (cart.length) { toast.show('أفرغ السلة الحالية أو علّقها أولاً', 'error'); return }
    setCart(hc.lines)
    setInvoiceDiscount(hc.discount)
    setHeld((h) => h.filter((x) => x.id !== hc.id))
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 h-[calc(100vh-8.5rem)]">
      {/* ═══ يمين: الأصناف والبحث ═══ */}
      <div className="lg:col-span-3 flex flex-col gap-3 min-h-0">
        <div className="anim-up relative">
          <ScanBarcode size={17} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-brand-500" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSearchEnter()}
            placeholder="امسح الباركود أو ابحث بالاسم… (Enter يضيف فوراً)"
            className={`${inputCls} pr-10 py-3 text-base border-brand-300 dark:border-brand-700 shadow-sm`}
          />
        </div>

        {/* الفواتير المعلقة */}
        {held.length > 0 && (
          <div className="anim-pop flex gap-2 flex-wrap">
            {held.map((hc) => (
              <button
                key={hc.id}
                onClick={() => resumeCart(hc)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 text-xs font-bold hover:scale-105 transition-transform duration-200"
              >
                <PlayCircle size={13} /> {hc.label} ({hc.lines.length} أصناف)
              </button>
            ))}
          </div>
        )}

        {/* شبكة الأصناف */}
        <div className="flex-1 overflow-y-auto rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-3">
          {sellable.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8">
              <div className="text-4xl mb-2">📦</div>
              <div className="font-bold text-slate-600 dark:text-slate-300">لا أصناف للبيع بعد</div>
              <div className="text-xs text-slate-400 mt-1">أضف أصنافك من المخزون ← الأصناف، واشترِ بضاعة من المشتريات ليعمل الكاشير بتكلفة حقيقية</div>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
              {filtered.map((it, i) => {
                const out = (it.stockQty ?? 0) <= 0
                return (
                  <button
                    key={it.id}
                    onClick={() => addToCart(it.id)}
                    style={{ animationDelay: `${i * 20}ms` }}
                    className={`anim-in group text-right p-3 rounded-xl border-2 transition-all duration-200 hover:scale-[1.03] hover:shadow-lg active:scale-95 ${
                      out
                        ? 'border-rose-200 dark:border-rose-900/40 opacity-70'
                        : 'border-slate-100 dark:border-slate-800 hover:border-emerald-400/60'
                    }`}
                  >
                    <div className="font-bold text-[13px] text-slate-800 dark:text-white leading-tight line-clamp-2">{it.nameAr}</div>
                    <div className="flex items-center justify-between mt-2">
                      <span className="font-black text-emerald-600 dark:text-emerald-400 text-sm">{fmt(it.priceMinor)}</span>
                      <span className={`text-[10px] font-bold ${out ? 'text-rose-500' : 'text-slate-400'}`}>
                        {out ? 'نفد' : `${it.stockQty ?? 0} ${it.baseUnit}`}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ═══ يسار: السلة ═══ */}
      <div className="lg:col-span-2 flex flex-col rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden anim-up" style={{ animationDelay: '80ms' }}>
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <span className="font-extrabold text-slate-800 dark:text-white flex items-center gap-2">
            <ShoppingCart size={17} className="text-emerald-500" /> السلة ({cart.length})
            {openShift ? (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-bold">وردية #{openShift.id}</span>
            ) : (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-400/10 text-slate-400 font-bold" title="الفواتير ستُسجل خارج وردية — افتحها من المبيعات ← الورديات">بلا وردية</span>
            )}
          </span>
          <div className="flex gap-1.5">
            <button onClick={holdCart} disabled={!cart.length} title="تعليق الفاتورة" className="p-2 rounded-lg text-amber-500 hover:bg-amber-500/10 disabled:opacity-30 transition-all duration-200 hover:scale-110">
              <PauseCircle size={17} />
            </button>
            <button onClick={() => { setCart([]); setInvoiceDiscount(0) }} disabled={!cart.length} title="إفراغ السلة" className="p-2 rounded-lg text-rose-500 hover:bg-rose-500/10 disabled:opacity-30 transition-all duration-200 hover:scale-110">
              <Trash2 size={17} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-[16rem]">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-300 dark:text-slate-600 p-6">
              <ShoppingCart size={44} className="mb-3 opacity-40" />
              <span className="text-sm font-bold">السلة فارغة</span>
              <span className="text-xs mt-1">امسح باركوداً أو اضغط صنفاً من الشبكة</span>
              {lastInvoice && (
                <span className="mt-4 text-[11px] px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-600 font-bold flex items-center gap-1.5">
                  <CheckCircle2 size={12} /> آخر فاتورة: {lastInvoice}
                  {lastSale && (
                    <button
                      onClick={() => { printSale(lastSale); toast.show('أُرسل الإيصال للطباعة 🖨️') }}
                      title="طباعة الإيصال"
                      className="mr-1 p-1 rounded-md hover:bg-emerald-500/15 transition-colors"
                    >
                      <Printer size={13} />
                    </button>
                  )}
                </span>
              )}
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {/* رأس أعمدة السلة */}
              <div className="grid grid-cols-[1fr_7.5rem_4.5rem_6rem_2rem] gap-2 items-center px-4 py-2 text-[10px] font-bold text-slate-400 bg-slate-50/80 dark:bg-slate-900/40 sticky top-0 z-10">
                <span>الصنف</span>
                <span className="text-center">الكمية</span>
                <span className="text-center">خصم ٪</span>
                <span className="text-left">الإجمالي</span>
                <span></span>
              </div>
              {cart.map((l, i) => (
                <div key={i} className="anim-pop grid grid-cols-[1fr_7.5rem_4.5rem_6rem_2rem] gap-2 items-center px-4 py-3 hover:bg-emerald-500/[0.03] transition-colors duration-150">
                  {/* الصنف: الاسم + سعر الوحدة */}
                  <div className="min-w-0">
                    <div className="font-bold text-[13px] text-slate-800 dark:text-white truncate leading-snug">
                      {l.soldByWeight && <span className="ml-1">⚖️</span>}{l.nameAr}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {fmt(l.unitPriceMinor)} {cur.symbol} / {l.soldByWeight ? 'كجم' : 'وحدة'}
                    </div>
                  </div>
                  {/* الكمية */}
                  <div className="flex items-center justify-center rounded-xl border-2 border-slate-200 dark:border-slate-700 overflow-hidden h-9">
                    <button
                      onClick={() => setCart((c) => c.map((x, j) => (j === i ? { ...x, qty: Math.max(l.soldByWeight ? 0.1 : 1, Math.round((x.qty - (l.soldByWeight ? 0.25 : 1)) * 1000) / 1000) } : x)))}
                      className="w-8 h-full text-slate-500 font-bold hover:bg-rose-500/10 hover:text-rose-500 transition-colors"
                    >−</button>
                    <input
                      value={l.qty}
                      onChange={(e) => {
                        const v = Number(e.target.value)
                        if (v > 0) setCart((c) => c.map((x, j) => (j === i ? { ...x, qty: v } : x)))
                      }}
                      className="w-full h-full text-center text-[13px] font-black bg-transparent text-slate-800 dark:text-white outline-none"
                    />
                    <button
                      onClick={() => setCart((c) => c.map((x, j) => (j === i ? { ...x, qty: Math.round((x.qty + (l.soldByWeight ? 0.25 : 1)) * 1000) / 1000 } : x)))}
                      className="w-8 h-full text-slate-500 font-bold hover:bg-emerald-500/10 hover:text-emerald-600 transition-colors"
                    >+</button>
                  </div>
                  {/* خصم السطر */}
                  <input
                    value={l.discountPercent || ''}
                    onChange={(e) => {
                      const v = Math.min(100, Math.max(0, Number(e.target.value) || 0))
                      setCart((c) => c.map((x, j) => (j === i ? { ...x, discountPercent: v } : x)))
                    }}
                    placeholder="—"
                    className="h-9 rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-transparent text-center text-[13px] font-bold text-rose-500 outline-none focus:border-rose-400 transition-colors"
                  />
                  {/* إجمالي السطر */}
                  <div className="text-left">
                    <div className="font-black text-[14px] text-slate-800 dark:text-white">
                      {fmt(Math.round(l.unitPriceMinor * l.qty * (1 - l.discountPercent / 100)))}
                    </div>
                    {l.discountPercent > 0 && (
                      <div className="text-[10px] text-rose-400 line-through">{fmt(Math.round(l.unitPriceMinor * l.qty))}</div>
                    )}
                  </div>
                  {/* حذف */}
                  <button onClick={() => setCart((c) => c.filter((_, j) => j !== i))} className="text-slate-300 hover:text-rose-500 hover:scale-125 transition-all duration-200 justify-self-center">
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* الإجماليات */}
        <div className="border-t border-slate-100 dark:border-slate-800 p-4 space-y-2 bg-slate-50/50 dark:bg-slate-900/30">
          <div className="flex items-center justify-between text-[12px] text-slate-500">
            <span>خصم فاتورة ٪</span>
            <input
              value={invoiceDiscount || ''}
              onChange={(e) => setInvoiceDiscount(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
              placeholder="0"
              className="w-16 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent text-center outline-none focus:border-brand-400"
            />
          </div>
          {totals && (
            <>
              {totals.discountMinor > 0 && (
                <div className="flex justify-between text-[12px] text-rose-500"><span>الخصومات</span><span>-{fmt(totals.discountMinor)}</span></div>
              )}
              {setup.vatPercent > 0 && (
                <div className="flex justify-between text-[12px] text-slate-400">
                  <span>الضريبة {setup.vatPercent}٪ {setup.taxInclusive ? '(مشمولة)' : '(مضافة)'}</span>
                  <span>{fmt(totals.taxMinor)}</span>
                </div>
              )}
              <div className="flex justify-between items-center pt-1">
                <span className="font-bold text-slate-600 dark:text-slate-300">الإجمالي</span>
                <span className="font-black text-2xl text-emerald-600 dark:text-emerald-400">{fmt(totals.totalMinor)} <span className="text-xs">{cur.symbol}</span></span>
              </div>
            </>
          )}
          <button
            onClick={() => setPayOpen(true)}
            disabled={!totals}
            className="w-full py-3.5 rounded-2xl font-black text-white bg-gradient-to-l from-emerald-600 to-teal-500 shadow-lg shadow-emerald-500/30 transition-all duration-200 hover:scale-[1.02] hover:shadow-xl active:scale-95 disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-2"
          >
            <Banknote size={19} /> الدفع (F9)
          </button>
        </div>
      </div>

      {/* مودال الدفع */}
      <Modal open={payOpen} onClose={() => setPayOpen(false)} title="إتمام الفاتورة">
        {totals && (
          <div className="space-y-5">
            <div className="text-center p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/20">
              <div className="text-[12px] text-slate-400">المبلغ المستحق</div>
              <div className="font-black text-3xl text-emerald-600 dark:text-emerald-400 mt-1">{fmt(totals.totalMinor)} {cur.symbol}</div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setPayment('cash')}
                className={`p-4 rounded-2xl border-2 font-bold transition-all duration-200 hover:scale-[1.02] ${payment === 'cash' ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}
              >
                <Banknote size={22} className="mx-auto mb-1" /> كاش
              </button>
              <button
                onClick={() => setPayment('credit')}
                disabled={customers.length === 0}
                className={`p-4 rounded-2xl border-2 font-bold transition-all duration-200 hover:scale-[1.02] disabled:opacity-40 ${payment === 'credit' ? 'border-violet-500/60 bg-violet-500/10 text-violet-700 dark:text-violet-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}
              >
                <UserRound size={22} className="mx-auto mb-1" /> آجل {customers.length === 0 && '(أضف عملاء)'}
              </button>
            </div>
            {payment === 'credit' && (
              <select value={customerId ?? 0} onChange={(e) => setCustomerId(Number(e.target.value) || null)} className={inputCls}>
                <option value={0}>اختر العميل…</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
              </select>
            )}
            <div className="text-[11px] text-slate-400 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 leading-relaxed">
              📒 سيتولد القيد تلقائياً: <b>{payment === 'cash' ? 'الخزينة' : 'العملاء'}</b> {fmt(totals.totalMinor)} / المبيعات {fmt(totals.taxBaseMinor)}
              {totals.taxMinor > 0 && <> / ض.ق.م {fmt(totals.taxMinor)}</>}
              {totals.cogsMinor > 0 && <> + تكلفة مبيعات {fmt(totals.cogsMinor)} / المخزون</>}
            </div>
            <Btn onClick={finishSale} disabled={payment === 'credit' && !customerId} className="w-full py-3.5">
              ✅ تأكيد وطباعة
            </Btn>
          </div>
        )}
      </Modal>
    </div>
  )
}
