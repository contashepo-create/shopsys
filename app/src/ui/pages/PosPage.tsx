/**
 * شاشة البيع (الكاشير) — قلب المنتج ⭐ (المرحلة 2)
 * - بحث فوري + مسح باركود (Enter) + شبكة أصناف باللمس
 * - كاش/آجل، خصم سطر وخصم فاتورة، تعليق واستكمال فواتير
 * - كل فاتورة تولّد قيداً محاسبياً متوازناً تلقائياً (القرار 9)
 */
import { useMemo, useRef, useState, useEffect } from 'react'
import { Banknote, UserRound, Trash2, PauseCircle, PlayCircle, ShoppingCart, CheckCircle2, ScanBarcode, Printer, Settings2, Gift, CreditCard } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import { computeTotals, CreditLimitError, type CartLine } from '../../core/pos.ts'
import { PriceFloorError } from '../../core/items.ts'
import { parseScaleBarcodeUniversal, scalePriceToMinor, matchScaleItem } from '../../core/barcode.ts'
import { availableSerials, findBySerial, warrantyLookup } from '../../core/serials.ts'
import { effectiveVatPercent, sameIngredientAlternatives, itemMatchesPartQuery, type Item } from '../../core/items.ts'
import { hasVariantStock, variantLabel, variantKey } from '../../core/variants.ts'
import { promotionActiveOn, promotionSavingsMinor } from '../../core/promotions.ts'
import { ExpiredStockError } from '../../core/batches.ts'
import { currentOpenShift } from '../../core/shifts.ts'
import { buildReceiptModel, INVOICE_TEMPLATE_OPTIONS, A4_STYLES, type InvoiceTemplate } from '../../core/receipt.ts'
import { renderReceiptHtml, printHtml } from '../print/printReceipt.ts'
import { renderInvoiceA4Html } from '../print/printInvoiceA4.ts'
import { maybeZatcaQr } from '../print/zatcaQr.ts'
import { evaluateLicense, hasFeature } from '../../core/license.ts'
import { Btn, Modal, Field, inputCls, useToast } from '../components/ui.tsx'
import { useSupervisorApproval } from '../components/SupervisorPinDialog.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'
import { toMinor } from '../../core/money.ts'

interface HeldCart { id: number; label: string; lines: CartLine[]; discount: number }

/**
 * تثبيت الفواتير المعلقة (مراجعة المبيعات — نمط Square/Lightspeed):
 * الفاتورة المعلقة تنجو من إغلاق التطبيق وتحديث الصفحة — كاشير علّق سلة
 * لعميل نسي محفظته ثم انقطع التيار: يجدها كما تركها عند العودة.
 */
const HELD_KEY = 'shopsys-held-carts'
function loadHeldCarts(): HeldCart[] {
  try {
    const raw = localStorage.getItem(HELD_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}
function saveHeldCarts(held: HeldCart[]) {
  try {
    if (held.length === 0) localStorage.removeItem(HELD_KEY)
    else localStorage.setItem(HELD_KEY, JSON.stringify(held))
  } catch { /* تخزين ممتلئ — التعليق يبقى في الذاكرة فقط */ }
}

export function PosPage() {
  const { items, customers, shifts, serials, postSale, openShift: openShiftAction, priceLists, getEffectivePrice, variantStocks, warehouses, branches, appUsers, currentUserId, promotions, getPromotionCartLines, paymentTerminals } = useDataStore()
  const openShift = currentOpenShift(shifts)
  const { setup, receipt, autoPrintAfterSale, einvoice, activatedPayload, trialStartedAt, lastSeenAt, scaleRules, updateReceipt, setAutoPrint } = useAppStore()
  const toast = useToast()
  const country = setup.countryCode ? getCountry(setup.countryCode) : null
  const cur = country?.currency || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const countryVatPercent = country?.vatPercent ?? setup.vatPercent
  const mainWarehouseId = warehouses.find((w) => w.isMain)?.id ?? warehouses[0]?.id ?? null
  const defaultSaleWarehouseId = setup.defaultWarehouseId ?? mainWarehouseId
  const itemVatPercent = (itemId: number) => effectiveVatPercent(items.find((x) => x.id === itemId) ?? { vatOverride: null }, countryVatPercent)
  const fmt = (m: number) => formatMinor(m, cur, false)

  const [query, setQuery] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  // كتابة الكمية العشرية بحرية («.25» لربع كيلو): مسودة نصية لكل سطر أثناء الكتابة،
  // تُرحَّل للسلة عند كل حرف صالح وتُنظَّف عند مغادرة الحقل (بلاغ المالك — نفس نمط الاستبدال الوزني)
  const [qtyDrafts, setQtyDrafts] = useState<Record<number, string>>({})
  const [invoiceDiscount, setInvoiceDiscount] = useState(0)
  const [held, setHeldRaw] = useState<HeldCart[]>(loadHeldCarts)
  // كل تغيير في المعلقة يُثبَّت فوراً (نمط Square: parked sales تنجو من الإغلاق)
  const setHeld = (updater: HeldCart[] | ((prev: HeldCart[]) => HeldCart[])) => {
    setHeldRaw((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      saveHeldCarts(next)
      return next
    })
  }
  const [payOpen, setPayOpen] = useState(false)
  // فتح وردية من الكاشير مباشرة (سياسة «لا بيع بلا وردية» — نمط Toast/Square)
  const [shiftOpenModal, setShiftOpenModal] = useState(false)
  const [shiftOpeningCash, setShiftOpeningCash] = useState('')
  const [payment, setPayment] = useState<'cash' | 'credit' | 'terminal'>('cash')
  const [paymentTerminalId, setPaymentTerminalId] = useState('')
  const [terminalReference, setTerminalReference] = useState('')
  const [terminalCardLast4, setTerminalCardLast4] = useState('')
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
      if (e.key === 'F2') { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); return }
      if (e.key === 'Escape') { setPayOpen(false); setQuickPrintOpen(false); searchRef.current?.focus(); return }
      if (e.key === 'F8' || e.key === 'F9') {
        e.preventDefault()
        if (!cart.length) return
        // F8 تحصيل نقدي سريع، وF9 فتح الدفع مع احترام سياسة الورديات
        const st = useAppStore.getState().setup
        if (st.requireOpenShiftForSales && !currentOpenShift(useDataStore.getState().shifts)) { setShiftOpenModal(true); return }
        if (e.key === 'F8') setPayment('cash')
        setPayOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cart.length])

  const sellable = useMemo(() => items.filter((it) => it.isActive), [items])

  const filtered = useMemo(() => {
    const q = query.trim()
    if (!q) return sellable.slice(0, 24)
    // بحث موحد: اسم/SKU/باركود + أرقام OEM والتوافق (جولة قطع الغيار)
    return sellable.filter((it) => it.nameAr.includes(q) || it.sku.includes(q) || it.barcodes.some((b) => b.includes(q)) || itemMatchesPartQuery(it, q)).slice(0, 24)
  }, [sellable, query])

  // نافذة اختيار السيريال/IMEI (نمط موبايل شوب: البيع بالقطعة المعيّنة)
  const [serialPickItem, setSerialPickItem] = useState<number | null>(null)
  // اقتراح بدائل الدواء النافد (نفس المادة الفعالة) — نمط ShelfLifePro
  const [altSuggest, setAltSuggest] = useState<{ forItem: Item; alternatives: Item[] } | null>(null)
  const [variantPickItem, setVariantPickItem] = useState<number | null>(null)
  const addVariantToCart = (itemId: number, color: string, size: string) => {
    const it = items.find((x) => x.id === itemId)
    if (!it) return
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.itemId === itemId && (l.variantColor ?? '') === color && (l.variantSize ?? '') === size)
      if (idx >= 0) return prev.map((l, i) => (i === idx ? { ...l, qty: l.qty + 1 } : l))
      return [...prev, {
        itemId: it.id, nameAr: `${it.nameAr} (${variantLabel(color, size)})`, qty: 1,
        unitPriceMinor: getEffectivePrice(it.id, activePriceListId), unitCostMinor: it.costMinor, vatPercentOverride: effectiveVatPercent(it, countryVatPercent),
        discountPercent: 0, soldByWeight: false, variantColor: color, variantSize: size,
      }]
    })
    setVariantPickItem(null)
    toast.show(`🎨 ${it.nameAr} — ${variantLabel(color, size)}`)
  }

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
        unitPriceMinor: it.priceMinor, unitCostMinor: it.costMinor, vatPercentOverride: effectiveVatPercent(it, countryVatPercent),
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
    // الصيدلية (نمط ShelfLifePro): الدواء النافد يقترح بدائله بنفس المادة الفعالة فوراً
    if (!it.isService && (it.stockQty ?? 0) <= 0 && (it.activeIngredient ?? '').trim()) {
      const alts = sameIngredientAlternatives(it, items)
      if (alts.length > 0) {
        setAltSuggest({ forItem: it, alternatives: alts })
        return
      }
    }
    // صنف يتتبع السيريال وله قطع مسيرلة متاحة ⇒ اختيار القطعة المعيّنة أولاً
    if (it.trackSerial && availableSerials(serials, it.id).length > 0) {
      setSerialPickItem(it.id)
      return
    }
    // صنف موزع على تركيبات لون×مقاس ⇒ اختيار التركيبة أولاً (نمط استشاري)
    if (hasVariantStock(variantStocks, it.id)) {
      setVariantPickItem(it.id)
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
        unitPriceMinor: getEffectivePrice(it.id, activePriceListId), unitCostMinor: it.costMinor, vatPercentOverride: effectiveVatPercent(it, countryVatPercent),
        discountPercent: 0, soldByWeight: it.soldByWeight,
      }]
    })
  }

  /** تبديل وحدة سطر (صيدلية: قطعة/شريط/علبة) — يعيد التسعير والتكلفة بمعامل الوحدة */
  const setLineUnit = (lineIdx: number, unitName: string) => {
    setCart((prev) => prev.map((l, i) => {
      if (i !== lineIdx) return l
      const it = items.find((x) => x.id === l.itemId)
      if (!it) return l
      const basePrice = getEffectivePrice(it.id, activePriceListId)
      if (unitName === it.baseUnit) {
        return { ...l, nameAr: it.nameAr, unitPriceMinor: basePrice, unitCostMinor: it.costMinor, vatPercentOverride: effectiveVatPercent(it, countryVatPercent), unitFactor: undefined, unitLabel: undefined }
      }
      const u = it.extraUnits.find((x) => x.nameAr === unitName)
      if (!u) return l
      return {
        ...l,
        nameAr: `${it.nameAr} (${u.nameAr})`,
        unitPriceMinor: u.priceMinor ?? Math.round(basePrice * u.factor),
        unitCostMinor: Math.round(it.costMinor * u.factor), vatPercentOverride: effectiveVatPercent(it, countryVatPercent),
        unitFactor: u.factor,
        unitLabel: u.nameAr,
      }
    }))
  }

  /** إضافة صنف بوحدة أكبر مباشرة (مسح باركود الشريط/العلبة) */
  const addUnitToCart = (itemId: number, unitName: string) => {
    const it = items.find((x) => x.id === itemId)
    const u = it?.extraUnits.find((x) => x.nameAr === unitName)
    if (!it || !u) return
    const basePrice = getEffectivePrice(it.id, activePriceListId)
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.itemId === itemId && l.unitLabel === unitName)
      if (idx >= 0) return prev.map((l, i) => (i === idx ? { ...l, qty: l.qty + 1 } : l))
      return [...prev, {
        itemId: it.id, nameAr: `${it.nameAr} (${u.nameAr})`, qty: 1,
        unitPriceMinor: u.priceMinor ?? Math.round(basePrice * u.factor),
        unitCostMinor: Math.round(it.costMinor * u.factor), vatPercentOverride: effectiveVatPercent(it, countryVatPercent),
        discountPercent: 0, soldByWeight: false, unitFactor: u.factor, unitLabel: u.nameAr,
      }]
    })
    toast.show(`📦 ${it.nameAr} — ${u.nameAr} (${u.factor} ${it.baseUnit})`)
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
    // باركود ميزان؟ (عالمي — يجرب كل قواعد التفكيك الممكّنة بالترتيب: وزن أو سعر)
    const scale = parseScaleBarcodeUniversal(q, scaleRules)
    if (scale) {
      const it = matchScaleItem(scale.itemCode, sellable)
      if (it) {
        if (scale.weightKg != null) {
          // قاعدة وزن: الكمية = الوزن والسعر من بطاقة الصنف
          addToCart(it.id, scale.weightKg)
          toast.show(`⚖️ ${it.nameAr} — ${scale.weightKg} كجم من باركود الميزان`)
        } else {
          // قاعدة سعر: الميزان طبع السعر الإجمالي — نشتق الوزن = السعر ÷ سعر الكيلو
          const priceMinor = scalePriceToMinor(scale.priceRaw ?? 0, scale.rule.valueDecimals, cur.decimals)
          const perKg = getEffectivePrice(it.id, activePriceListId)
          if (perKg <= 0) {
            toast.show(`«${it.nameAr}» بلا سعر بيع للكيلو — حدّده أولاً لتفكيك باركود السعر`, 'error')
          } else {
            const weightKg = Math.round((priceMinor / perKg) * 1000) / 1000
            if (weightKg <= 0) {
              toast.show('باركود سعر بقيمة أصغر من أن تكوّن وزناً — راجع كسور القاعدة', 'error')
            } else {
              addToCart(it.id, weightKg)
              toast.show(`⚖️ ${it.nameAr} — ${fmt(priceMinor)} ${cur.symbol} ≈ ${weightKg} كجم من باركود الميزان`)
            }
          }
        }
        setQuery('')
        return
      }
      toast.show(`باركود ميزان لصنف غير معروف (كود ${scale.itemCode}) — راجع قائمة PLU في إعدادات الميزان`, 'error')
      setQuery('')
      return
    }
    // باركود وحدة أكبر (شريط/علبة — جولة الصيدلية)؟ يضيف السطر بوحدته وسعره
    for (const it of sellable) {
      const u = it.extraUnits.find((x) => x.barcode === q)
      if (u) {
        addUnitToCart(it.id, u.nameAr)
        setQuery('')
        return
      }
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
      return computeTotals(cart, invoiceDiscount, countryVatPercent, setup.taxInclusive)
    } catch { return null }
  }, [cart, invoiceDiscount, countryVatPercent, setup.taxInclusive])

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
  const printSale = async (sale: { invoiceNumber: string; refCode?: string; date: string; lines: CartLine[]; totals: ReturnType<typeof computeTotals>; payment: 'cash' | 'credit'; customerId: number | null; paidMinor?: number }) => {
    const licState = evaluateLicense({ activatedPayload, trialStartedAt, lastSeenAt, today: new Date().toISOString() })
    const qrDataUrl = await maybeZatcaQr({
      featureActive: einvoice.enabled === true && hasFeature(licState, 'einvoice_sa'),
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
      paidMinor: sale.paidMinor, // الدفع المجزأ: يطبع المدفوع/المتبقي (بلاغ المالك)
      customerName: sale.customerId ? customers.find((c) => c.id === sale.customerId)?.nameAr ?? null : null,
      taxPercent: countryVatPercent,
      taxInclusive: setup.taxInclusive,
      settings: receipt,
    })
    if (qrDataUrl) model.qrDataUrl = qrDataUrl
    // القالب من شريط الكاشير (تجاوز مؤقت) — حراري أو A4 أو A5؛ الإعدادات الدائمة لا تُمس
    printHtml(
      posTemplate === 'thermal'
        ? renderReceiptHtml(model, cur, receipt)
        : renderInvoiceA4Html(model, cur, receipt, posTemplate === 'a5' ? 'a5' : 'a4'),
    )
  }

  const [lastSale, setLastSale] = useState<Parameters<typeof printSale>[0] | null>(null)

  /* شريط اختيار قالب الطباعة (طلب المالك): حراري/A4/A5 حصري — تجاوز مؤقت لهذه الجلسة فقط،
     لا يكتب شيئاً في إعدادات الطباعة الدائمة، ومتاح للكاشير بلا أي صلاحية إضافية.
     يبدأ على القالب الدائم من الإعدادات (حراري افتراضاً)؛ للفاتورة الطارئة يكفي ضغط
     A4/A5 قبل التحصيل ثم العودة بضغطة واحدة. */
  const [posTemplate, setPosTemplate] = useState<InvoiceTemplate>(receipt.defaultTemplate)
  const [quickPrintOpen, setQuickPrintOpen] = useState(false)

  // تجاوز بيع منتهي الصلاحية بموافقة المدير (القرار 8) — يُسجَّل اسمه على الفاتورة
  /* مخزن البيع أعلى الفاتورة — لا اختيار مبهم: يبدأ بالمخزن الافتراضي أو الرئيسي */
  const [saleWarehouseId, setSaleWarehouseId] = useState<number | null>(defaultSaleWarehouseId)
  const activeUser = appUsers.find((user) => user.id === currentUserId)
  const saleBranchId = branches.find((branch) => branch.warehouseId === (saleWarehouseId ?? defaultSaleWarehouseId))?.id
  const activePaymentTerminals = paymentTerminals.filter((terminal) => {
    if (terminal.status !== 'active') return false
    if (saleBranchId != null && terminal.branchId !== String(saleBranchId)) return false
    if (!activeUser || activeUser.roleId === 'owner' || !activeUser.paymentTerminalAccess) return true
    return activeUser.paymentTerminalAccess.grants.some((grant) => grant.terminalId === terminal.id && grant.operations.includes('charge'))
  })
  const [expiredBlock, setExpiredBlock] = useState<string[] | null>(null)
  // ترقية القرار 8 لنمط POS العالمي: تجاوز الصلاحية برقم مشرف سري موثق
  // (لا مجرد كتابة اسم) — المالك/المخول بـsales.expiry.override يمر مباشرة
  const expiryApproval = useSupervisorApproval('sales.expiry.override')
  // حارس حد الائتمان (نمط SAP B1): بيع آجل يتجاوز حد العميل ⇒ حوار اعتماد مدير
  const creditApproval = useSupervisorApproval('sales.credit.override')
  // أرضية السعر (DEXEF/الأمين): البيع تحت الحد الأدنى للصنف باعتماد مدير فقط
  const priceFloorApproval = useSupervisorApproval('sales.price.edit')
  // نحفظ اعتماد الصلاحية المرافق — فاتورة فيها التجاوزان معاً لا تفقد الأول عند اعتماد الثاني
  const [creditBlock, setCreditBlock] = useState<{ message: string; expiryOverrideBy?: string } | null>(null)
  // الخصومات (سطر/فاتورة): كاشير بلا sales.discount.grant يفتح القفل برقم مشرف
  // مرة واحدة لكل سلة (نمط Square: passcode لكل خصم مقيد) — يُسجل المعتمد
  const discountApproval = useSupervisorApproval('sales.discount.grant')
  const [discountUnlockedBy, setDiscountUnlockedBy] = useState<string | null>(null)
  const discountLocked = discountApproval.willAskPin && discountUnlockedBy === null
  const unlockDiscount = () => discountApproval.request((approvedBy) => {
    setDiscountUnlockedBy(approvedBy ?? 'المشرف')
    toast.show(`فُتحت الخصومات لهذه السلة — اعتمدها «${approvedBy ?? 'المشرف'}» ✓`)
  })

  const finishSale = (expiryOverrideBy?: string, creditLimitOverrideBy?: string, priceFloorOverrideBy?: string) => {
    if (!cart.length) return
    try {
      // مجزأ فعلاً (جزء نقدي + جزء آجل) أو آجل بالكامل ⇒ عميل إلزامي
      const isSplitOrCredit = payment === 'credit' || (payment === 'cash' && creditRemainder > 0)
      const selectedTerminal = payment === 'terminal' ? activePaymentTerminals.find((row) => row.id === paymentTerminalId) : null
      if (payment === 'terminal' && !selectedTerminal) throw new Error('اختر ماكينة دفع نشطة')
      if (payment === 'terminal' && !terminalReference.trim()) throw new Error('أدخل رقم مرجع إيصال ماكينة الدفع')
      if (terminalCardLast4 && !/^\d{4}$/.test(terminalCardLast4)) throw new Error('آخر أربعة أرقام يجب أن تكون 4 أرقام')
      const sale = postSale({
        lines: cart,
        customerId: isSplitOrCredit ? customerId : null,
        payment: payment === 'credit' || (payment === 'cash' && creditRemainder > 0) ? 'credit' : 'cash',
        invoiceDiscountPercent: invoiceDiscount,
        taxPercent: countryVatPercent,
        taxInclusive: setup.taxInclusive,
        treasury: selectedTerminal?.settlementAccountCode ?? treasury,
        paidMinor: payment === 'credit' ? 0 : payment === 'terminal' ? (totals?.totalMinor ?? 0) : paidCashMinor,
        expiryOverrideBy: expiryOverrideBy ?? null,
        creditLimitOverrideBy: creditLimitOverrideBy ?? null,
        priceFloorOverrideBy: priceFloorOverrideBy ?? null,
        allowNegativeStock: setup.allowNegativeStock, // من الإعدادات العامة (طلب المالك)
        warehouseId: saleWarehouseId, // الأمر 8: المخزن المختار أعلى الفاتورة
        ...(selectedTerminal ? { terminalPayment: { terminalId: selectedTerminal.id, providerReference: terminalReference.trim(), ...(terminalCardLast4 ? { cardLast4: terminalCardLast4 } : {}) } } : {}),
      })
      setLastInvoice(sale.invoiceNumber)
      setLastSale(sale)
      setCart([]); setQtyDrafts({})
      setDiscountUnlockedBy(null)
      setInvoiceDiscount(0)
      setPayOpen(false)
      setPayment('cash')
      setPaymentTerminalId(''); setTerminalReference(''); setTerminalCardLast4('')
      setCustomerId(null)
      setPaidCash('')
      setExpiredBlock(null)
      toast.show(`تمت الفاتورة ${sale.invoiceNumber} — القيد المحاسبي تولّد تلقائياً ✓`)
      if (autoPrintAfterSale) printSale(sale)
    } catch (e) {
      // بيع يمس كمية منتهية: حوار موافقة المدير بدل رسالة الخطأ (القرار 8)
      if (e instanceof ExpiredStockError) {
        setExpiredBlock(e.itemNames)
        return
      }
      // تجاوز حد الائتمان: حوار اعتماد مدير بدل الرسالة (نمط SAP B1)
      if (e instanceof CreditLimitError) {
        setCreditBlock({ message: e.message, expiryOverrideBy })
        return
      }
      // بيع تحت الحد الأدنى للسعر (نمط DEXEF/الأمين): اعتماد مدير موثق
      if (e instanceof PriceFloorError) {
        priceFloorApproval.request((approvedBy) => finishSale(expiryOverrideBy, creditLimitOverrideBy, approvedBy ?? 'المشرف'))
        return
      }
      toast.show((e as Error).message, 'error')
    }
  }


  /* العروض/الباقات (سد فجوة السوق): زر 🎁 يضيف مكونات الباقة كسطور عادية */

  const [promoPickOpen, setPromoPickOpen] = useState(false)

  const livePromotions = useMemo(() => {

    const now = new Date().toISOString()

    return promotions.filter((p) => promotionActiveOn(p, now))

  }, [promotions])

  const addPromotionToCart = (promotionId: number) => {

    try {

      const lines = getPromotionCartLines(promotionId, 1)

      setCart((prev) => [...prev, ...lines])

      setPromoPickOpen(false)

      const promo = promotions.find((p) => p.id === promotionId)

      toast.show(`🎁 أُضيفت باقة «${promo?.nameAr ?? ''}» للسلة`)

    } catch (e) { toast.show((e as Error).message, 'error') }

  }

  const holdCart = () => {
    if (!cart.length) return
    setHeld((h) => [...h, { id: Date.now(), label: `فاتورة معلقة ${h.length + 1}`, lines: cart, discount: invoiceDiscount }])
    setCart([]); setQtyDrafts({})
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
    <div className="pos-workspace flex flex-col gap-2 h-[calc(100vh-6.5rem)]">
      {/* ═══ يمين: الأصناف والبحث ═══ */}
      <div className="flex flex-col gap-2 shrink-0">
        <div className="anim-up relative">
          <ScanBarcode size={17} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-brand-500" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSearchEnter()}
            placeholder="F2 بحث · امسح الباركود أو اكتب الاسم · Enter إضافة · F8 نقدي · F9 دفع"
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

        <div className="text-[10px] text-slate-400 px-1">اكتب اسم الصنف أو امسح الباركود ثم اضغط Enter — لا توجد بطاقات تشغل مساحة الفاتورة.</div>
      </div>

      {/* ═══ يسار: السلة ═══ */}
      <div className="flex-1 min-h-0 flex flex-col rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden anim-up" style={{ animationDelay: '80ms' }}>
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <span className="font-extrabold text-slate-800 dark:text-white flex items-center gap-2">
            <ShoppingCart size={17} className="text-emerald-500" /> السلة ({cart.length})
            {openShift ? (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-bold">وردية #{openShift.id}</span>
            ) : (
              <button
                onClick={() => setShiftOpenModal(true)}
                title={setup.requireOpenShiftForSales ? 'البيع موقوف حتى تُفتح وردية — اضغط لفتحها الآن' : 'الفواتير ستُسجل خارج وردية — اضغط لفتح وردية'}
                className={`text-[10px] px-2 py-0.5 rounded-full font-bold transition-all hover:scale-105 ${setup.requireOpenShiftForSales ? 'bg-rose-500/10 text-rose-600 border border-rose-500/30 animate-pulse' : 'bg-slate-400/10 text-slate-400'}`}
              >
                {setup.requireOpenShiftForSales ? '⛔ افتح وردية أولاً' : 'بلا وردية — فتح؟'}
              </button>
            )}
          </span>
          <div className="flex gap-1.5 items-center">
            {warehouses.length > 1 && (
              <select
                value={saleWarehouseId ?? defaultSaleWarehouseId ?? ''}
                onChange={(e) => setSaleWarehouseId(e.target.value === '' ? defaultSaleWarehouseId : Number(e.target.value))}
                title="المخزن الذي تُصرف منه هذه الفاتورة (الأمر 8)"
                className="text-[11px] font-bold rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-2 py-1.5 max-w-[8.5rem]"
              >
                {warehouses.map((w) => <option key={w.id} value={w.id}>🏬 {w.nameAr}{w.isMain ? ' (الرئيسي)' : ''}</option>)}
              </select>
            )}
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
            {livePromotions.length > 0 && (
              <button onClick={() => setPromoPickOpen(true)} title="إضافة عرض/باقة للسلة" className="p-2 rounded-lg text-pink-500 hover:bg-pink-500/10 transition-all duration-200 hover:scale-110">
                <Gift size={17} />
              </button>
            )}
            <button onClick={holdCart} disabled={!cart.length} title="تعليق الفاتورة" className="p-2 rounded-lg text-amber-500 hover:bg-amber-500/10 disabled:opacity-30 transition-all duration-200 hover:scale-110">
              <PauseCircle size={17} />
            </button>
            <button onClick={() => { setCart([]); setQtyDrafts({}); setInvoiceDiscount(0) }} disabled={!cart.length} title="إفراغ السلة" className="p-2 rounded-lg text-rose-500 hover:bg-rose-500/10 disabled:opacity-30 transition-all duration-200 hover:scale-110">
              <Trash2 size={17} />
            </button>
          </div>
        </div>
        {/* خيارات الطباعة مخفية وتظهر فقط عند طلب تغيير القالب */}
        <div className="px-4 py-1.5 border-b border-slate-100 dark:border-slate-800 flex justify-end">
          <details className="relative group">
            <summary className="list-none cursor-pointer inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
              <Printer size={12}/> {INVOICE_TEMPLATE_OPTIONS.find(t=>t.id===posTemplate)?.label ?? 'قالب الطباعة'}
            </summary>
            <div className="absolute left-0 top-full z-30 mt-1 w-48 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-card-dark p-1.5 shadow-xl">
              {INVOICE_TEMPLATE_OPTIONS.map(t=><button key={t.id} onClick={(e)=>{setPosTemplate(t.id);(e.currentTarget.closest('details') as HTMLDetailsElement)?.removeAttribute('open')}} className={`w-full text-right px-2 py-1.5 rounded-lg text-[11px] ${posTemplate===t.id?'bg-emerald-500/10 text-emerald-600 font-bold':'hover:bg-slate-100 dark:hover:bg-slate-800'}`}>{t.label}<span className="block text-[9px] text-slate-400">{t.sub}</span></button>)}
              <button onClick={()=>setQuickPrintOpen(true)} className="w-full text-right px-2 py-1.5 mt-1 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-500"><Settings2 size={11} className="inline ml-1"/>إعدادات إضافية</button>
            </div>
          </details>
        </div>

        {/* min-h-0 (لا 16rem): القيمة الإجبارية كانت تدفع شريط الدفع خارج الإطار المقصوص فيختفي الزر (بلاغ المالك) */}
        <div className="flex-1 overflow-y-auto min-h-0">
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
              <div className="grid grid-cols-[1fr_7.3rem_3.7rem_4.2rem_5.8rem_2rem] gap-2 items-center px-4 py-2 text-[10px] font-bold text-slate-400 bg-slate-50/80 dark:bg-slate-900/40 sticky top-0 z-10">
                <span>الصنف</span>
                <span className="text-center">الكمية</span>
                <span className="text-center" title="النسبة الفعلية لكل سطر: نسبة البلد تلقائياً أو استثناء الصنف إن كان معفى">ضريبة</span>
                <span className="text-center">خصم ٪</span>
                <span className="text-left">الإجمالي</span>
                <span></span>
              </div>
              {cart.map((l, i) => (
                <div key={i} className="anim-pop grid grid-cols-[1fr_7.3rem_3.7rem_4.2rem_5.8rem_2rem] gap-2 items-center px-4 py-3 hover:bg-emerald-500/[0.03] transition-colors duration-150">
                  {/* الصنف: الاسم + سعر الوحدة */}
                  <div className="min-w-0">
                    <div className="font-bold text-[13px] text-slate-800 dark:text-white truncate leading-snug">
                      {l.soldByWeight && <span className="ml-1">⚖️</span>}{l.nameAr}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1.5">
                      <span>{fmt(l.unitPriceMinor)} {cur.symbol} / {l.soldByWeight ? 'كجم' : (l.unitLabel ?? 'وحدة')}</span>
                      {/* منتقي الوحدة (صيدلية: قطعة/شريط/علبة) — يظهر فقط لصنف متعدد الوحدات بلا سيريالات */}
                      {(() => {
                        const it = items.find((x) => x.id === l.itemId)
                        if (!it || it.extraUnits.length === 0 || (l.serials && l.serials.length > 0)) return null
                        return (
                          <select
                            value={l.unitLabel ?? it.baseUnit}
                            onChange={(e) => setLineUnit(i, e.target.value)}
                            className="text-[10px] font-bold rounded-md border border-slate-200 dark:border-slate-700 bg-transparent px-1 py-0.5 text-fuchsia-600 outline-none"
                          >
                            <option value={it.baseUnit}>{it.baseUnit}</option>
                            {it.extraUnits.map((u) => <option key={u.nameAr} value={u.nameAr}>{u.nameAr} ×{u.factor}</option>)}
                          </select>
                        )
                      })()}
                    </div>
                    {/* مخزن السطر: عدم وجود قيمة صريحة يعني وراثة مخزن رأس الفاتورة. */}
                    {warehouses.length > 1 && (
                      <select
                        value={l.warehouseId ?? ''}
                        onChange={(e) => setCart((current) => current.map((line, index) => (
                          index === i ? { ...line, warehouseId: e.target.value === '' ? null : Number(e.target.value) } : line
                        )))}
                        title="اختر مخزناً لهذا السطر، أو اتركه يتبع مخزن الفاتورة"
                        className="mt-1 text-[10px] font-bold rounded-md border border-amber-200 dark:border-amber-800 bg-amber-500/[0.06] px-1.5 py-0.5 text-amber-700 dark:text-amber-300 outline-none max-w-full"
                      >
                        <option value="">🏬 مخزن الفاتورة — {warehouses.find((w) => w.id === (saleWarehouseId ?? defaultSaleWarehouseId))?.nameAr ?? 'الرئيسي'}</option>
                        {warehouses.map((warehouse) => (
                          <option key={warehouse.id} value={warehouse.id}>{warehouse.nameAr}{warehouse.isMain ? ' (الرئيسي)' : ''}</option>
                        ))}
                      </select>
                    )}
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
                      onClick={() => { setQtyDrafts((d) => { const n = { ...d }; delete n[i]; return n }); setCart((c) => c.map((x, j) => (j === i ? { ...x, qty: Math.max(l.soldByWeight ? 0.1 : 1, Math.round((x.qty - (l.soldByWeight ? 0.25 : 1)) * 1000) / 1000) } : x))) }}
                      className="w-8 h-full text-slate-500 font-bold hover:bg-rose-500/10 hover:text-rose-500 transition-colors"
                    >−</button>
                    <input
                      value={qtyDrafts[i] ?? String(l.qty)}
                      inputMode="decimal"
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace('٫', '.').replace(',', '.')
                        // نقبل أثناء الكتابة: فارغ، «.», «0.», «2.» … حتى يكمل المستخدم الكسر
                        if (!/^\d*\.?\d*$/.test(raw)) return
                        setQtyDrafts((d) => ({ ...d, [i]: raw }))
                        const v = Number(raw)
                        if (raw !== '' && Number.isFinite(v) && v > 0) setCart((c) => c.map((x, j) => (j === i ? { ...x, qty: v } : x)))
                      }}
                      onBlur={() => setQtyDrafts((d) => { const n = { ...d }; delete n[i]; return n })}
                      onFocus={(e) => e.target.select()}
                      className="w-full h-full text-center text-[13px] font-black bg-transparent text-slate-800 dark:text-white outline-none"
                    />
                    <button
                      onClick={() => { setQtyDrafts((d) => { const n = { ...d }; delete n[i]; return n }); setCart((c) => c.map((x, j) => (j === i ? { ...x, qty: Math.round((x.qty + (l.soldByWeight ? 0.25 : 1)) * 1000) / 1000 } : x))) }}
                      className="w-8 h-full text-slate-500 font-bold hover:bg-emerald-500/10 hover:text-emerald-600 transition-colors"
                    >+</button>
                  </div>
                  )}
                  {/* ضريبة السطر — تلقائية من بلد المنشأة أو استثناء الصنف (معفى/نسبة خاصة) */}
                  <div
                    title={`نسبة الضريبة لهذا السطر: ${l.vatPercentOverride ?? itemVatPercent(l.itemId)}٪ — ${country?.nameAr ?? 'حسب بلد المنشأة'}`}
                    className="h-9 rounded-xl border-2 border-sky-200 dark:border-sky-800/70 bg-sky-500/[0.06] text-center flex items-center justify-center text-[11px] font-black text-sky-700 dark:text-sky-300"
                  >
                    {(l.vatPercentOverride ?? itemVatPercent(l.itemId)) > 0 ? `${l.vatPercentOverride ?? itemVatPercent(l.itemId)}٪` : 'معفى'}
                  </div>
                  {/* خصم السطر */}
                  <input
                    value={l.discountPercent || ''}
                    readOnly={discountLocked}
                    onClick={() => { if (discountLocked) unlockDiscount() }}
                    onChange={(e) => {
                      if (discountLocked) return
                      const v = Math.min(100, Math.max(0, Number(e.target.value) || 0))
                      setCart((c) => c.map((x, j) => (j === i ? { ...x, discountPercent: v } : x)))
                    }}
                    placeholder={discountLocked ? '🔐' : '—'}
                    title={discountLocked ? 'الخصم يتطلب اعتماد مشرف — اضغط لإدخال الرقم السري' : undefined}
                    className="h-9 rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-transparent text-center text-[13px] font-bold text-rose-500 outline-none focus:border-rose-400 transition-colors"
                  />
                  {/* إجمالي السطر */}
                  <div className="text-left">
                    <div className="font-black text-[12px] text-slate-800 dark:text-white">
                      {fmt(Math.round(l.unitPriceMinor * l.qty * (1 - l.discountPercent / 100)))}
                    </div>
                    {l.discountPercent > 0 && (
                      <div className="text-[10px] text-rose-400 line-through">{fmt(Math.round(l.unitPriceMinor * l.qty))}</div>
                    )}
                  </div>
                  {/* حذف */}
                  <button onClick={() => { setQtyDrafts({}); setCart((c) => c.filter((_, j) => j !== i)) }} className="text-slate-300 hover:text-rose-500 hover:scale-125 transition-all duration-200 justify-self-center">
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
              readOnly={discountLocked}
              onClick={() => { if (discountLocked) unlockDiscount() }}
              onChange={(e) => { if (!discountLocked) setInvoiceDiscount(Math.min(100, Math.max(0, Number(e.target.value) || 0))) }}
              placeholder={discountLocked ? '🔐' : '0'}
              title={discountLocked ? 'الخصم يتطلب اعتماد مشرف — اضغط لإدخال الرقم السري' : undefined}
              className="w-16 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent text-center outline-none focus:border-brand-400"
            />
          </div>
          {totals && (
            <>
              {totals.discountMinor > 0 && (
                <div className="flex justify-between text-[12px] text-rose-500"><span>الخصومات</span><span>-{fmt(totals.discountMinor)}</span></div>
              )}
              {totals.taxMinor > 0 && (
                <div className="flex justify-between text-[12px] text-slate-400">
                  <span>إجمالي ضريبة السطور {setup.taxInclusive ? '(مشمولة)' : '(مضافة)'} — النسبة تظهر بجانب كل بند</span>
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
            onClick={() => {
              // سياسة الورديات: وجّه لفتح الوردية بدل مودال الدفع (رسالة قبل الرفض)
              if (setup.requireOpenShiftForSales && !openShift) { setShiftOpenModal(true); return }
              setPayOpen(true)
            }}
            disabled={!totals}
            className="w-full py-3.5 rounded-2xl font-black text-white bg-gradient-to-l from-emerald-600 to-teal-500 shadow-lg shadow-emerald-500/30 transition-all duration-200 hover:scale-[1.02] hover:shadow-xl active:scale-95 disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center gap-2"
          >
            <Banknote size={19} /> الدفع (F9)
          </button>
        </div>
      </div>

      {/* مودال فتح الوردية من الكاشير (سياسة «لا بيع بلا وردية») */}
      <Modal open={shiftOpenModal} onClose={() => setShiftOpenModal(false)} title="فتح وردية">
        <div className="space-y-4">
          <p className="text-[12px] text-slate-500 leading-relaxed">
            عُدّ النقدية الموجودة في الدرج الآن وسجّلها كعهدة افتتاحية — عند الإقفال يقارن النظام
            المعدود بالمتوقع ويُظهر العجز أو الزيادة (النمط العالمي في إدارة الأدراج).
          </p>
          <Field label="العهدة الافتتاحية (نقدية الدرج)" hint="اكتب 0 لو الدرج فارغ">
            <input
              autoFocus
              inputMode="decimal"
              value={shiftOpeningCash}
              onChange={(e) => setShiftOpeningCash(e.target.value)}
              placeholder="0"
              autoComplete="off"
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent outline-none focus:border-emerald-400 text-left"
              dir="ltr"
            />
          </Field>
          <button
            onClick={() => {
              try {
                const activeName = appUsers.find((u) => u.id === currentUserId)?.nameAr ?? (setup.ownerName || 'المالك')
                const sh = openShiftAction(activeName, toMinor(shiftOpeningCash || '0', cur.decimals))
                toast.show(`فُتحت الوردية #${sh.id} — كل فاتورة من الآن تُحسب عليها ✓`)
                setShiftOpenModal(false)
                setShiftOpeningCash('')
              } catch (e) { toast.show((e as Error).message, 'error') }
            }}
            className="w-full py-3 rounded-2xl font-black text-white bg-gradient-to-l from-emerald-600 to-teal-500 shadow-lg shadow-emerald-500/25 transition-all hover:scale-[1.01] active:scale-95"
          >
            فتح الوردية الآن
          </button>
        </div>
      </Modal>

      {/* مودال الدفع */}
      <Modal open={payOpen} onClose={() => setPayOpen(false)} title="إتمام الفاتورة">
        {totals && (
          <div className="space-y-5">
            <div className="text-center p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/20">
              <div className="text-[12px] text-slate-400">المبلغ المستحق</div>
              <div className="font-black text-3xl text-emerald-600 dark:text-emerald-400 mt-1">{fmt(totals.totalMinor)} {cur.symbol}</div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => { setPayment('cash'); if (totals) setPaidCash(String(totals.totalMinor / 10 ** cur.decimals)) }}
                className={`p-4 rounded-2xl border-2 font-bold transition-all duration-200 hover:scale-[1.02] ${payment === 'cash' ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}
              >
                <Banknote size={22} className="mx-auto mb-1" /> نقدي / مجزأ
              </button>
              <button onClick={() => { setPayment('terminal'); setPaidCash('0'); setPaymentTerminalId((current) => current || activePaymentTerminals[0]?.id || '') }} disabled={!activePaymentTerminals.length} className={`p-4 rounded-2xl border-2 font-bold transition-all ${payment === 'terminal' ? 'border-sky-500 bg-sky-500/10 text-sky-700' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}><CreditCard size={22} className="mx-auto mb-1"/>بطاقة</button>
              <button
                onClick={() => { setPayment('credit'); setPaidCash('0') }}
                disabled={customers.length === 0}
                className={`p-4 rounded-2xl border-2 font-bold transition-all duration-200 hover:scale-[1.02] disabled:opacity-40 ${payment === 'credit' ? 'border-violet-500/60 bg-violet-500/10 text-violet-700 dark:text-violet-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}
              >
                <UserRound size={22} className="mx-auto mb-1" /> آجل بالكامل {customers.length === 0 && '(أضف عملاء)'}
              </button>
            </div>

            {payment === 'terminal' && <div className="space-y-3"><div><div className="text-[11px] font-bold mb-1">ماكينة الدفع</div><select className={inputCls} value={paymentTerminalId} onChange={(e) => setPaymentTerminalId(e.target.value)}><option value="">اختر الماكينة</option>{activePaymentTerminals.map((row) => <option key={row.id} value={row.id}>{row.nameAr} · {row.code}</option>)}</select></div><div className="grid grid-cols-2 gap-2"><div><div className="text-[11px] font-bold mb-1">مرجع إيصال الماكينة *</div><input className={inputCls} value={terminalReference} onChange={(e) => setTerminalReference(e.target.value)} placeholder="رقم العملية"/></div><div><div className="text-[11px] font-bold mb-1">آخر 4 أرقام (اختياري)</div><input className={inputCls} inputMode="numeric" maxLength={4} value={terminalCardLast4} onChange={(e) => setTerminalCardLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="1234"/></div></div><p className="text-[10px] text-slate-400">لا يُخزن رقم البطاقة الكامل أو CVV.</p></div>}

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
                  <TreasuryPicker value={treasury} onChange={setTreasury} operation="receipt" />
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
              {totals.taxMinor > 0 && <> / ض.ق.م من سطور الفاتورة {fmt(totals.taxMinor)}</>}
              {totals.cogsMinor > 0 && <> + تكلفة مبيعات {fmt(totals.cogsMinor)} / المخزون</>}
            </div>
            <Btn onClick={() => finishSale()} disabled={(payment === 'credit' || creditRemainder > 0) && !customerId} className="w-full py-3.5">
              ✅ تأكيد وطباعة
            </Btn>
          </div>
        )}
      </Modal>

      {/* حظر بيع منتهي الصلاحية — تجاوز بموافقة المدير (القرار 8) */}
      <Modal open={!!expiredBlock} onClose={() => setExpiredBlock(null)} title="⛔ أصناف منتهية الصلاحية">
        {expiredBlock && (
          <div className="space-y-4">
            <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/25 text-[12.5px] leading-relaxed text-rose-700 dark:text-rose-400">
              البيع سيصرف كميات <b>منتهية الصلاحية</b> من:
              <ul className="mt-1.5 space-y-0.5">
                {expiredBlock.map((n, i) => <li key={i}>• <b>{n}</b></li>)}
              </ul>
            </div>
            <p className="text-[12px] text-slate-500 leading-relaxed">
              البيع محظور افتراضياً. للمتابعة يلزم <b>اعتماد مدير</b> — {expiryApproval.willAskPin
                ? 'سيُطلب رقم المشرف/المالك السري، ويُسجَّل اسم المعتمد على الفاتورة وفي سجل التدقيق (القرار 8).'
                : 'حسابك مخول بالتجاوز — يُسجَّل اسمك على الفاتورة وفي سجل التدقيق (القرار 8).'}
            </p>
            <div className="flex gap-2 justify-end">
              <Btn variant="ghost" onClick={() => setExpiredBlock(null)}>إلغاء البيع</Btn>
              <Btn onClick={() => expiryApproval.request((approvedBy) => finishSale(approvedBy ?? (appUsers.find((u) => u.id === currentUserId)?.nameAr ?? 'المالك')))}>
                ⚠️ اعتماد المدير والمتابعة
              </Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* اختيار القطعة بسيريالها/IMEI — نمط موبايل شوب (البيع بالقطعة المعيّنة) */}
      {/* اختيار تركيبة لون×مقاس (ملابس) */}
      <Modal open={variantPickItem !== null} onClose={() => setVariantPickItem(null)} title="🎨 اختر اللون والمقاس">
        {variantPickItem !== null && (() => {
          const it = items.find((x) => x.id === variantPickItem)
          // المتاح لكل تركيبة بعد خصم ما في السلة
          const inCart = new Map<string, number>()
          for (const l of cart) {
            if (l.itemId !== variantPickItem) continue
            const k = variantKey(l.variantColor ?? '', l.variantSize ?? '')
            inCart.set(k, (inCart.get(k) ?? 0) + l.qty)
          }
          const combos = variantStocks
            .filter((v) => v.itemId === variantPickItem)
            .map((v) => ({ ...v, avail: Math.round((v.qty - (inCart.get(variantKey(v.color, v.size)) ?? 0)) * 1000) / 1000 }))
            .sort((a, b) => (a.color + a.size).localeCompare(b.color + b.size, 'ar'))
          return (
            <div className="space-y-3">
              <div className="text-[13px] font-bold text-slate-700 dark:text-slate-200">{it?.nameAr}</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-72 overflow-y-auto">
                {combos.map((v) => (
                  <button
                    key={variantKey(v.color, v.size)}
                    onClick={() => v.avail > 0 && addVariantToCart(variantPickItem, v.color, v.size)}
                    disabled={v.avail <= 0}
                    className={`p-3 rounded-xl border-2 text-center transition-all duration-150 ${v.avail > 0 ? 'border-slate-200 dark:border-slate-700 hover:border-violet-400/70 hover:bg-violet-500/5' : 'border-dashed border-slate-200 dark:border-slate-700 opacity-40 cursor-not-allowed'}`}
                  >
                    <div className="font-black text-[13px]">{variantLabel(v.color, v.size)}</div>
                    <div className={`text-[11px] font-bold ${v.avail > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{v.avail > 0 ? `متاح ${v.avail}` : 'نفد'}</div>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-400">تُخصم الكمية من رصيد التركيبة ومن إجمالي الصنف معاً — والمرتجع يعيدها للتركيبة نفسها.</p>
            </div>
          )
        })()}
      </Modal>

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
      {/* تجاوز حد ائتمان العميل — اعتماد مدير موثق (مراجعة المبيعات) */}
      {/* بدائل الدواء النافد بنفس المادة الفعالة (نمط ShelfLifePro salt-equivalent finder) */}
      <Modal open={!!altSuggest} onClose={() => setAltSuggest(null)} title={altSuggest ? `🧪 «${altSuggest.forItem.nameAr}» نافد — البدائل المتوفرة` : ''}>
        {altSuggest && (
          <div className="space-y-3">
            <div className="text-[12px] text-slate-500">
              نفس المادة الفعالة: <b className="text-lime-600" dir="ltr">{altSuggest.forItem.activeIngredient}</b> — مرتبة بالأرخص
            </div>
            <div className="space-y-2">
              {altSuggest.alternatives.map((alt) => (
                <button
                  key={alt.id}
                  onClick={() => { const id = alt.id; setAltSuggest(null); addToCart(id) }}
                  className="w-full flex items-center justify-between p-3 rounded-xl border-2 border-slate-200 dark:border-slate-700 hover:border-lime-500/60 hover:bg-lime-500/5 transition-all text-right"
                >
                  <span>
                    <span className="font-bold text-slate-800 dark:text-white block">{alt.nameAr}</span>
                    <span className="text-[11px] text-slate-400">متوفر: {alt.stockQty} {alt.baseUnit}</span>
                  </span>
                  <span className="font-black text-emerald-600">{formatMinor(alt.priceMinor, cur, false)} {cur.symbol}</span>
                </button>
              ))}
            </div>
            <div className="flex justify-end">
              <Btn variant="ghost" onClick={() => setAltSuggest(null)}>إغلاق</Btn>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!creditBlock} onClose={() => setCreditBlock(null)} title="⛔ تجاوز حد الائتمان">
        {creditBlock && (
          <div className="space-y-4">
            <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-[12.5px] leading-relaxed text-amber-700 dark:text-amber-400">
              {creditBlock.message}
            </div>
            <p className="text-[12px] text-slate-500 leading-relaxed">
              البيع الآجل فوق حد العميل محظور افتراضياً. للمتابعة يلزم <b>اعتماد مدير</b> — {creditApproval.willAskPin
                ? 'سيُطلب رقم المشرف/المالك السري، ويُسجَّل اسم المعتمد على الفاتورة وفي سجل التدقيق.'
                : 'حسابك مخول بالتجاوز — يُسجَّل اسمك على الفاتورة وفي سجل التدقيق.'}
            </p>
            <div className="flex gap-2 justify-end">
              <Btn variant="ghost" onClick={() => setCreditBlock(null)}>إلغاء البيع</Btn>
              <Btn onClick={() => { const keptExpiry = creditBlock.expiryOverrideBy; setCreditBlock(null); creditApproval.request((approvedBy) => finishSale(keptExpiry, approvedBy ?? (appUsers.find((u) => u.id === currentUserId)?.nameAr ?? 'المالك'))) }}>
                ⚠️ اعتماد المدير والمتابعة
              </Btn>
            </div>
          </div>
        )}
      </Modal>
      {/* خيارات طباعة سريعة (طلب المالك): مودال مختصر بجانب شريط القالب — يعدّل أهم إعدادات
          الطباعة فوراً بلا مغادرة الكاشير؛ لكل الخيارات الكاملة يبقى قسم «إعدادات الطباعة» */}
      <Modal open={quickPrintOpen} onClose={() => setQuickPrintOpen(false)} title="🖨️ خيارات طباعة سريعة">
        <div className="space-y-4">
          <div className="rounded-xl bg-sky-500/5 border border-sky-500/20 p-3 text-[11px] text-slate-500 leading-relaxed">
            هذه اختصارات لأهم الخيارات — التعديل هنا يُحفَظ في إعدادات الطباعة نفسها.
            أما شريط «حراري / A4 / A5» في الكاشير فهو تجاوز مؤقت للفاتورة الحالية ولا يغيّر شيئاً دائماً.
          </div>
          <Field label="الطباعة التلقائية بعد التحصيل" hint="يُطبع الإيصال فور إتمام كل فاتورة بلا ضغطة إضافية">
            <button
              onClick={() => setAutoPrint(!autoPrintAfterSale)}
              className={`w-full p-3 rounded-xl border-2 font-bold text-sm transition-all ${autoPrintAfterSale ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}
            >
              {autoPrintAfterSale ? '✅ مفعّلة — كل فاتورة تُطبع فوراً' : '⭕ متوقفة — الطباعة يدوياً من زر الطابعة'}
            </button>
          </Field>
          <Field label="عرض ورق الإيصال الحراري">
            <div className="grid grid-cols-2 gap-2">
              {(['80', '58'] as const).map((w) => (
                <button
                  key={w}
                  onClick={() => updateReceipt({ paperWidth: w })}
                  className={`p-2.5 rounded-xl border-2 font-bold text-sm transition-all ${receipt.paperWidth === w ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}
                >{w} مم</button>
              ))}
            </div>
          </Field>
          <Field label="نمط فاتورة A4 / A5">
            <div className="grid grid-cols-3 gap-1.5">
              {A4_STYLES.map((st) => (
                <button
                  key={st.id}
                  onClick={() => updateReceipt({ a4Style: st.id })}
                  className={`p-2 rounded-xl border-2 font-bold text-[11px] transition-all ${receipt.a4Style === st.id ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}
                >{st.nameAr}</button>
              ))}
            </div>
          </Field>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-slate-400">كل الخيارات (شعار، علامة مائية، إظهار/إخفاء…) في قسم إعدادات الطباعة</span>
            <Btn variant="ghost" onClick={() => setQuickPrintOpen(false)}>تم ✓</Btn>
          </div>
        </div>
      </Modal>
      {expiryApproval.dialog}
      {discountApproval.dialog}
      {creditApproval.dialog}
      {priceFloorApproval.dialog}

      {/* حوار اختيار عرض/باقة (سد فجوة السوق): اختيار واحد يضيف كل مكونات الباقة للسلة */}
      <Modal open={promoPickOpen} onClose={() => setPromoPickOpen(false)} title="🎁 العروض السارية اليوم">
        <div className="space-y-1.5 max-h-[24rem] overflow-y-auto">
          {livePromotions.length === 0 && <div className="text-[12px] text-slate-400 text-center py-6">لا عروض سارية اليوم</div>}
          {livePromotions.map((p) => {
            const savings = promotionSavingsMinor(p, items)
            return (
              <button
                key={p.id}
                onClick={() => addPromotionToCart(p.id)}
                className="w-full text-right flex items-center gap-2 text-[12.5px] bg-slate-50 dark:bg-slate-800/50 hover:bg-pink-500/10 rounded-xl px-3 py-2.5 transition-colors"
              >
                <span className="flex-1">
                  <span className="font-black block">🎁 {p.nameAr}</span>
                  <span className="text-[10.5px] text-slate-400">
                    {p.components.map((c) => `${c.qty} × ${items.find((it) => it.id === c.itemId)?.nameAr ?? '؟'}`).join(' + ')}
                  </span>
                </span>
                <span className="text-left">
                  <b className="text-pink-600 block">{fmt(p.bundlePriceMinor)}</b>
                  {savings > 0 && <span className="text-emerald-600 text-[10px] font-bold">وفر {fmt(savings)}</span>}
                </span>
              </button>
            )
          })}
        </div>
      </Modal>
    </div>
  )
}
