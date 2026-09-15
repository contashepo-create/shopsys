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
import { availableSerials, findBySerial, warrantyLookup } from '../../core/serials.ts'
import { ExpiredStockError } from '../../core/batches.ts'
import { currentOpenShift } from '../../core/shifts.ts'
import { buildReceiptModel } from '../../core/receipt.ts'
import { renderReceiptHtml, printHtml } from '../print/printReceipt.ts'
import { renderInvoiceA4Html } from '../print/printInvoiceA4.ts'
import { maybeZatcaQr } from '../print/zatcaQr.ts'
import { evaluateLicense, hasFeature } from '../../core/license.ts'
import { Btn, Modal, inputCls, useToast } from '../components/ui.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'
import { toMinor } from '../../core/money.ts'

interface HeldCart { id: number; label: string; lines: CartLine[]; discount: number }

export function PosPage() {
  const { items, customers, shifts, serials, postSale, priceLists, getEffectivePrice } = useDataStore()
  const openShift = currentOpenShift(shifts)
  const { setup, receipt, autoPrintAfterSale, einvoice, activatedPayload, trialStartedAt, lastSeenAt } = useAppStore()
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
  // قائمة أسعار العميل المختار (جملة/نصف جملة…) — تسعّر السلة تلقائياً
  const activePriceListId = useMemo(() => {
    if (customerId == null) return null
    const c = customers.find((x) => x.id === customerId)
    const listId = c?.priceListId ?? null
    if (listId == null) return null
    return priceLists.some((l) => l.id === listId && l.isActive) ? listId : null
  }, [customerId, customers, priceLists])
  const pickCustomer = (id: number | null) => {
    setCustomerId(id)
    // إعادة تسعير السطور غير المخصومة يدوياً حسب قائمة العميل الجديد
    const c = id == null ? null : customers.find((x) => x.id === id)
    const listId = c?.priceListId ?? null
    setCart((prev) => prev.map((l) => ({ ...l, unitPriceMinor: getEffectivePrice(l.itemId, listId) })))
  }
  // الدفع المجزأ (طلب المالك): المبلغ النقدي يتعبأ تلقائياً بالإجمالي ويقبل التعديل —
  // أقل من الإجمالي = الباقي آجل على العميل؛ 0 = آجل بالكامل
  const [paidCash, setPaidCash] = useState('')
  const [treasury, setTreasury] = useState('1101')
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

  // نافذة اختيار السيريال/IMEI (نمط موبايل شوب: البيع بالقطعة المعيّنة)
  const [serialPickItem, setSerialPickItem] = useState<number | null>(null)

  /** إضافة قطعة معيّنة بسيريالها — سطر السلة يحمل قائمة السيريالات وكميته = طولها */
  const addSerialUnit = (itemId: number, serial: string) => {
    const it = items.find((x) => x.id === itemId)
    if (!it) return
    if (it.priceMinor <= 0) {
      toast.show(`«${it.nameAr}» بلا سعر بيع! حدّد سعره من المخزون ← الأصناف أولاً`, 'error')
      return
    }
    const inCart = cart.some((l) => l.serials?.includes(serial))
    if (inCart) { toast.show(`القطعة ${serial} في السلة بالفعل`, 'error'); return }
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.itemId === itemId)
      if (idx >= 0) {
        return prev.map((l, i) =>
          i === idx ? { ...l, qty: l.qty + 1, serials: [...(l.serials ?? []), serial] } : l,
        )
      }
      return [...prev, {
        itemId: it.id, nameAr: it.nameAr, qty: 1,
        unitPriceMinor: it.priceMinor, unitCostMinor: it.costMinor,
        discountPercent: 0, soldByWeight: false, serials: [serial],
      }]
    })
    setSerialPickItem(null)
    toast.show(`🔢 ${it.nameAr} — ${serial}`)
  }

  const addToCart = (itemId: number, weightQty?: number) => {
    const it = items.find((x) => x.id === itemId)
    if (!it) return
    // حماية من خطأ «السعر صفر»: لا صنف بلا سعر بيع يدخل السلة بصمت
    if (it.priceMinor <= 0) {
      toast.show(`«${it.nameAr}» بلا سعر بيع! حدّد سعره من المخزون ← الأصناف أولاً`, 'error')
      return
    }
    // صنف يتتبع السيريال وله قطع مسيرلة متاحة ⇒ اختيار القطعة المعيّنة أولاً
    if (it.trackSerial && availableSerials(serials, it.id).length > 0) {
      setSerialPickItem(it.id)
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
        unitPriceMinor: getEffectivePrice(it.id, activePriceListId), unitCostMinor: it.costMinor,
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
    // مسح IMEI/سيريال مباشرة؟ (نمط موبايل شوب): متاح ⇒ يضيف القطعة نفسها،
    // مباع ⇒ يعرض حالة ضمانه بدل رسالة «غير موجود»
    const su = findBySerial(serials, q)
    if (su) {
      if (su.status === 'in_stock') {
        addSerialUnit(su.itemId, su.serial)
        setQuery('')
        return
      }
      const w = warrantyLookup(serials, q, new Date().toISOString())
      const itName = items.find((it) => it.id === su.itemId)?.nameAr ?? 'صنف'
      toast.show(
        w?.active
          ? `📱 ${itName} — مباع، الضمان سارٍ حتى ${w.warrantyUntil} (${w.daysLeft} يوماً)`
          : `📱 ${itName} — مباع، الضمان منتهٍ${w ? ` منذ ${w.warrantyUntil}` : ''}`,
        w?.active ? 'success' : 'error',
      )
      setQuery('')
      return
    }
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

  // عند فتح شاشة الدفع: المبلغ النقدي يتعبأ تلقائياً بالإجمالي (قابل للتعديل — طلب المالك)
  useEffect(() => {
    if (payOpen && totals) setPaidCash(String(totals.totalMinor / 10 ** cur.decimals))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payOpen])

  /** المدفوع نقداً بالوحدة الصغرى — مضبوط بين 0 والإجمالي */
  const paidCashMinor = useMemo(() => {
    if (!totals) return 0
    try {
      const m = toMinor(paidCash || '0', cur.decimals)
      return Math.max(0, Math.min(m, totals.totalMinor))
    } catch { return 0 }
  }, [paidCash, totals, cur.decimals])
  const creditRemainder = totals ? totals.totalMinor - paidCashMinor : 0

  /** طباعة إيصال فاتورة (المرحلة 5) — مع رمز QR زاتكا عند تفعيل الميزة (القرار 30) */
  const printSale = async (sale: { invoiceNumber: string; refCode?: string; date: string; lines: CartLine[]; totals: ReturnType<typeof computeTotals>; payment: 'cash' | 'credit'; customerId: number | null }) => {
    const licState = evaluateLicense({ activatedPayload, trialStartedAt, lastSeenAt, today: new Date().toISOString() })
    const qrDataUrl = await maybeZatcaQr({
      featureActive: hasFeature(licState, 'einvoice_sa'),
      printEnabled: einvoice.printZatcaQr,
      sellerName: setup.shopName,
      vatNumber: einvoice.taxNumber,
      dateIso: sale.date,
      totalMinor: sale.totals.totalMinor,
      taxMinor: sale.totals.taxMinor,
      decimals: cur.decimals,
    })
    const model = buildReceiptModel({
      invoiceNumber: sale.invoiceNumber,
      refCode: sale.refCode,
      dateIso: sale.date,
      lines: sale.lines,
      totals: sale.totals,
      payment: sale.payment,
      customerName: sale.customerId ? customers.find((c) => c.id === sale.customerId)?.nameAr ?? null : null,
      taxPercent: setup.vatPercent,
      taxInclusive: setup.taxInclusive,
      settings: receipt,
    })
    if (qrDataUrl) model.qrDataUrl = qrDataUrl
    // القالب الافتراضي من الإعدادات: حراري أو فاتورة A4 احترافية
    printHtml(
      receipt.defaultTemplate === 'a4'
        ? renderInvoiceA4Html(model, cur, receipt)
        : renderReceiptHtml(model, cur, receipt),
    )
  }

  const [lastSale, setLastSale] = useState<Parameters<typeof printSale>[0] | null>(null)

  // تجاوز بيع منتهي الصلاحية بموافقة المدير (القرار 8) — يُسجَّل اسمه على الفاتورة
  const [expiredBlock, setExpiredBlock] = useState<string[] | null>(null)
  const [overrideName, setOverrideName] = useState('')

  const finishSale = (expiryOverrideBy?: string) => {
    if (!cart.length) return
    try {
      // مجزأ فعلاً (جزء نقدي + جزء آجل) أو آجل بالكامل ⇒ عميل إلزامي
      const isSplitOrCredit = payment === 'credit' || creditRemainder > 0
      const sale = postSale({
        lines: cart,
        customerId: isSplitOrCredit ? customerId : null,
        payment: payment === 'cash' && creditRemainder > 0 ? 'credit' : payment,
        invoiceDiscountPercent: invoiceDiscount,
        taxPercent: setup.vatPercent,
        taxInclusive: setup.taxInclusive,
        treasury,
        paidMinor: payment === 'credit' ? 0 : paidCashMinor,
        expiryOverrideBy: expiryOverrideBy ?? null,
      })
      setLastInvoice(sale.invoiceNumber)
      setLastSale(sale)
      setCart([])
      setInvoiceDiscount(0)
      setPayOpen(false)
      setPayment('cash')
      setCustomerId(null)
      setPaidCash('')
      setExpiredBlock(null)
      setOverrideName('')
      toast.show(`تمت الفاتورة ${sale.invoiceNumber} — القيد المحاسبي تولّد تلقائياً ✓`)
      if (autoPrintAfterSale) printSale(sale)
    } catch (e) {
      // بيع يمس كمية منتهية: حوار موافقة المدير بدل رسالة الخطأ (القرار 8)
      if (e instanceof ExpiredStockError) {
        setExpiredBlock(e.itemNames)
        return
      }
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
          <div className="flex gap-1.5 items-center">
            {customers.some((c) => c.priceListId != null) && (
              <select
                value={customerId ?? 0}
                onChange={(e) => pickCustomer(Number(e.target.value) || null)}
                title="اختيار العميل يسعّر السلة بقائمته (جملة/نصف جملة)"
                className="text-[11px] font-bold rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-2 py-1.5 max-w-[9rem]"
              >
                <option value={0}>تجزئة (بلا عميل)</option>
                {customers.map((c) => {
                  const ln = c.priceListId != null ? priceLists.find((l) => l.id === c.priceListId && l.isActive)?.nameAr : null
                  return <option key={c.id} value={c.id}>{c.nameAr}{ln ? ` — ${ln}` : ''}</option>
                })}
              </select>
            )}
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
                    {/* سيريالات القطع المعيّنة — حذف السيريال يحذف قطعته من السلة */}
                    {l.serials && l.serials.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {l.serials.map((s) => (
                          <span key={s} className="anim-pop flex items-center gap-1 text-[9.5px] px-1.5 py-0.5 rounded-md bg-sky-500/10 text-sky-600 dark:text-sky-400 font-mono font-bold">
                            {s}
                            <button
                              onClick={() =>
                                setCart((c) =>
                                  c
                                    .map((x, j) =>
                                      j === i
                                        ? { ...x, qty: x.qty - 1, serials: (x.serials ?? []).filter((y) => y !== s) }
                                        : x,
                                    )
                                    .filter((x) => x.qty > 0),
                                )
                              }
                              className="text-rose-400 hover:text-rose-600 font-bold"
                            >×</button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* الكمية — أصناف السيريال كميتها بعدد قطعها المعيّنة (زر + يفتح اختيار قطعة) */}
                  {l.serials && l.serials.length > 0 ? (
                    <div className="flex items-center justify-center gap-1 h-9">
                      <span className="font-black text-[13px] text-slate-800 dark:text-white">{l.qty}</span>
                      <button
                        onClick={() => setSerialPickItem(l.itemId)}
                        title="إضافة قطعة أخرى بسيريالها"
                        className="w-7 h-7 rounded-lg border-2 border-sky-300 dark:border-sky-700 text-sky-500 font-bold hover:bg-sky-500/10 transition-colors"
                      >+</button>
                    </div>
                  ) : (
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
                  )}
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
                onClick={() => { setPayment('cash'); if (totals) setPaidCash(String(totals.totalMinor / 10 ** cur.decimals)) }}
                className={`p-4 rounded-2xl border-2 font-bold transition-all duration-200 hover:scale-[1.02] ${payment === 'cash' ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}
              >
                <Banknote size={22} className="mx-auto mb-1" /> نقدي / مجزأ
              </button>
              <button
                onClick={() => { setPayment('credit'); setPaidCash('0') }}
                disabled={customers.length === 0}
                className={`p-4 rounded-2xl border-2 font-bold transition-all duration-200 hover:scale-[1.02] disabled:opacity-40 ${payment === 'credit' ? 'border-violet-500/60 bg-violet-500/10 text-violet-700 dark:text-violet-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}
              >
                <UserRound size={22} className="mx-auto mb-1" /> آجل بالكامل {customers.length === 0 && '(أضف عملاء)'}
              </button>
            </div>

            {payment === 'cash' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1.5">المدفوع نقداً الآن</div>
                    <input
                      value={paidCash}
                      onChange={(e) => setPaidCash(e.target.value)}
                      type="number" min={0} dir="ltr"
                      className={`${inputCls} text-center font-black text-lg`}
                    />
                  </div>
                  <div>
                    <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1.5">الباقي آجل على العميل</div>
                    <div className={`px-3.5 py-2.5 rounded-xl border-2 text-center font-black text-lg ${creditRemainder > 0 ? 'border-violet-500/40 bg-violet-500/5 text-violet-600 dark:text-violet-300' : 'border-slate-200 dark:border-slate-700 text-slate-300'}`}>
                      {fmt(creditRemainder)}
                    </div>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1.5">إلى أي خزينة/بنك؟</div>
                  <TreasuryPicker value={treasury} onChange={setTreasury} />
                </div>
              </>
            )}

            {(payment === 'credit' || creditRemainder > 0) && (
              <select value={customerId ?? 0} onChange={(e) => pickCustomer(Number(e.target.value) || null)} className={inputCls}>
                <option value={0}>اختر العميل (إلزامي للجزء الآجل)…</option>
                {customers.map((c) => {
                  const ln = c.priceListId != null ? priceLists.find((l) => l.id === c.priceListId && l.isActive)?.nameAr : null
                  return <option key={c.id} value={c.id}>{c.nameAr}{ln ? ` — ${ln}` : ''}</option>
                })}
              </select>
            )}

            <div className="text-[11px] text-slate-400 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 leading-relaxed">
              📒 سيتولد القيد تلقائياً:
              {payment !== 'credit' && paidCashMinor > 0 && <> <b>الخزينة</b> {fmt(paidCashMinor)}</>}
              {(payment === 'credit' || creditRemainder > 0) && <> {payment !== 'credit' && paidCashMinor > 0 ? '+' : ''} <b>العملاء</b> {fmt(payment === 'credit' ? totals.totalMinor : creditRemainder)}</>}
              {' '}/ المبيعات {fmt(totals.taxBaseMinor)}
              {totals.taxMinor > 0 && <> / ض.ق.م {fmt(totals.taxMinor)}</>}
              {totals.cogsMinor > 0 && <> + تكلفة مبيعات {fmt(totals.cogsMinor)} / المخزون</>}
            </div>
            <Btn onClick={() => finishSale()} disabled={(payment === 'credit' || creditRemainder > 0) && !customerId} className="w-full py-3.5">
              ✅ تأكيد وطباعة
            </Btn>
          </div>
        )}
      </Modal>

      {/* حظر بيع منتهي الصلاحية — تجاوز بموافقة المدير (القرار 8) */}
      <Modal open={!!expiredBlock} onClose={() => { setExpiredBlock(null); setOverrideName('') }} title="⛔ أصناف منتهية الصلاحية">
        {expiredBlock && (
          <div className="space-y-4">
            <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/25 text-[12.5px] leading-relaxed text-rose-700 dark:text-rose-400">
              البيع سيصرف كميات <b>منتهية الصلاحية</b> من:
              <ul className="mt-1.5 space-y-0.5">
                {expiredBlock.map((n, i) => <li key={i}>• <b>{n}</b></li>)}
              </ul>
            </div>
            <p className="text-[12px] text-slate-500 leading-relaxed">
              البيع محظور افتراضياً. للمتابعة يلزم <b>اسم المدير الموافق</b> — يُسجَّل على الفاتورة
              ويظهر في سجل التدقيق (القرار 8).
            </p>
            <input
              value={overrideName}
              onChange={(e) => setOverrideName(e.target.value)}
              className={inputCls}
              placeholder="اسم المدير الموافق…"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <Btn variant="ghost" onClick={() => { setExpiredBlock(null); setOverrideName('') }}>إلغاء البيع</Btn>
              <Btn onClick={() => finishSale(overrideName.trim())} disabled={overrideName.trim().length < 2}>
                ⚠️ موافقة المدير والمتابعة
              </Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* اختيار القطعة بسيريالها/IMEI — نمط موبايل شوب (البيع بالقطعة المعيّنة) */}
      <Modal open={serialPickItem !== null} onClose={() => setSerialPickItem(null)} title="🔢 اختر القطعة (السيريال / IMEI)">
        {serialPickItem !== null && (() => {
          const it = items.find((x) => x.id === serialPickItem)
          const inCartSerials = new Set(cart.flatMap((l) => l.serials ?? []))
          const avail = availableSerials(serials, serialPickItem).filter((u) => !inCartSerials.has(u.serial))
          return (
            <div className="space-y-3">
              <div className="text-[13px] font-bold text-slate-700 dark:text-slate-200">
                {it?.nameAr} — <span className="text-slate-400 font-normal">{avail.length} قطعة متاحة</span>
              </div>
              {avail.length === 0 ? (
                <p className="text-[12px] text-slate-400 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                  كل القطع المسيرلة في السلة أو مباعة — سجّل قطعاً جديدة من فاتورة شراء.
                </p>
              ) : (
                <div className="max-h-72 overflow-y-auto space-y-1.5">
                  {avail.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => addSerialUnit(u.itemId, u.serial)}
                      className="w-full flex items-center justify-between p-3 rounded-xl border-2 border-slate-200 dark:border-slate-700 hover:border-sky-400/70 hover:bg-sky-500/5 transition-all duration-150 text-right"
                    >
                      <span className="font-mono font-bold text-[13px] text-slate-800 dark:text-white">{u.serial}</span>
                      <span className="text-[10.5px] text-slate-400">
                        {u.warrantyMonths > 0 ? `ضمان ${u.warrantyMonths} شهراً` : 'بلا ضمان'} · دخلت {u.receivedAt.slice(0, 10)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-slate-400">
                💡 يمكنك أيضاً مسح الـIMEI مباشرة في خانة البحث — يضيف القطعة فوراً، ولو كانت مباعة يعرض حالة ضمانها.
              </p>
            </div>
          )
        })()}
      </Modal>
    </div>
  )
}
