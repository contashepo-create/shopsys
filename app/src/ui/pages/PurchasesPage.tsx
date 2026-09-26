/**
 * فواتير الشراء — مع مصاريف الشراء الموزعة (Landed Cost)
 * (ملاحظة المالك المعتمدة):
 * - كل مصروف (نولون/جمارك/تأمين...) يوزَّع حسب القيمة أو الكمية — اختيار لكل مصروف
 * - الترحيل يحدّث تكلفة الأصناف بالمتوسط المرجح ويزيد المخزون
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Trash2, Receipt, TruckIcon, Eye, BookOpenText, Pencil, History, Printer, MoreHorizontal } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useDataStore, type PurchaseInvoice, type PurchaseExpense } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { computeLandedCosts } from '../../core/costing.ts'
import { effectiveVatPercent } from '../../core/items.ts'
import { resolveBusinessTax } from '../../core/taxRegistration.ts'
import { evaluateLicense, hasFeature } from '../../core/license.ts'
import { invoiceEditPolicy, electronicInvoiceLockActive } from '../../core/invoiceEdit.ts'
import { Btn, DecimalInput, Field, inputCls, Modal, useToast, EmptyState, useUnsavedChangesGuard, guardNavigation } from '../components/ui.tsx'
import { useSupervisorApproval } from '../components/SupervisorPinDialog.tsx'
import { PaySourcePicker, DEFAULT_PAY_SOURCE, type PaySourceValue } from '../components/PaySourcePicker.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'
import { ACCOUNT_NAMES } from './accountNames.ts'
import { buildSimpleDocModel } from '../../core/receipt.ts'
import { printModelWithTemplate } from '../print/printDoc.ts'
import { PrintTemplateModal } from '../components/PrintTemplateModal.tsx'
import { ItemQuickPicker, PartyQuickPicker, QuickSelect } from '../components/KeyboardPickers.tsx'
import { partyCode } from '../../core/partyCodes.ts'
import { PurchaseExpenseManager } from '../components/PurchaseExpenseManager.tsx'
import { PartyQuickEditModal } from '../components/PartyQuickEditModal.tsx'

/**
 * سطر شراء (تدقيق المالك — الشراء بالكرتونة):
 * unitName = '' يعني الوحدة الأساسية؛ اسم وحدة أكبر (كرتونة/علبة…) يعني أن
 * «الكمية» و«السعر» المدخلين بهذه الوحدة — وعند الترحيل يتحولان تلقائياً
 * للوحدة الأساسية (كمية×المعامل، السعر÷المعامل) فيبقى المخزون بالقطعة دائماً.
 */
interface DraftLine { itemId: number; qty: string; unitPrice: string; expiryDate: string; serialsRaw: string; unitName: string; vatPercent: number; warehouseId: number | null }
interface DraftExpense {
  nameAr: string
  amount: string
  method: 'value' | 'qty'
  // من دفع المصروف؟ (طلب المالك) — ليس إجبارياً على حساب المورد:
  paidBy: 'supplier' | 'treasury' | 'custody' | 'payable'
  payAccount: string // خزينة/بنك عند paidBy=treasury
  custodyFileId: number | null // ملف عهدة عند paidBy=custody
  beneficiaryName: string // الجهة عند paidBy=payable
  payableAccountCode: string // حساب الالتزام عند paidBy=payable
  accountCode: string // حساب المصروف
  costCenterId: number | null // مركز التكلفة العام
  vehicleId: number | null // مركز تكلفة مركبة الأسطول
  costTreatment?: 'inventory' | 'period'
  taxTreatment?: 'exempt' | 'exclusive' | 'inclusive'
  taxPercent?: number
}

const EXPENSE_PRESETS = ['نولون / نقل', 'جمارك', 'تأمين', 'شحن وتفريغ', 'تحميل وتنزيل', 'عمولة مشتريات', 'رسوم بنكية', 'أخرى']

export function PurchasesPage() {
  const { items, suppliers, purchases, purchaseExpensePayables, settlePurchaseExpensePayable, journal, projects, costCenters, expenseTemplates, addExpenseTemplate, treasuries, vehicles, custodyFiles, employees, warehouses, categories, advancedInvoiceDrafts, deleteAdvancedInvoiceDraft, addItem, postPurchase, addLatePurchaseExpense, editPurchase, getSupplierBalance } = useDataStore()
  const { setup, activatedPayload, trialStartedAt, lastSeenAt, receipt, einvoice } = useAppStore()
  const navigate = useNavigate()
  const goTo = (path: string) => { guardNavigation(() => navigate(path)) || navigate(path) }
  const [today] = useState(() => new Date().toISOString().slice(0, 10))

  // سياسة التعديل (طلب المالك): الفاتورة الإلكترونية مفعلة ⇒ لا تعديل — إشعار مدين على المورد
  const lic = useMemo(
    () => evaluateLicense({ activatedPayload, trialStartedAt, lastSeenAt, today: new Date().toISOString() }),
    [activatedPayload, trialStartedAt, lastSeenAt],
  )
  const einvoiceActive = electronicInvoiceLockActive({ licensed: hasFeature(lic, 'einvoice_sa') || hasFeature(lic, 'einvoice_eg'), enabled: einvoice.enabled === true, taxNumber: einvoice.taxNumber })
  const editPolicy = invoiceEditPolicy({ einvoiceActive })
  const openCustodyFiles = custodyFiles.filter((f) => f.status === 'open')
  const toast = useToast()
  const country = setup.countryCode ? getCountry(setup.countryCode) : null
  const cur = country?.currency || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const taxPolicy = resolveBusinessTax(setup.taxRegistrationStatus, setup.vatPercent)
  const countryVatPercent = country?.vatPercent ?? setup.vatPercent
  const effectiveCountryVatPercent = taxPolicy.effectivePercent === 0 ? 0 : countryVatPercent
  const mainWarehouseId = warehouses.find((w) => w.isMain)?.id ?? warehouses[0]?.id ?? null
  const defaultPurchaseWarehouseId = setup.defaultWarehouseId ?? mainWarehouseId
  const itemVatPercent = (itemId: number) => taxPolicy.effectivePercent === 0 ? 0 : effectiveVatPercent(items.find((x) => x.id === itemId) ?? { vatOverride: null }, effectiveCountryVatPercent)
  const makeDraftLine = (itemId: number = items[0]?.id ?? 0, patch: Partial<DraftLine> = {}): DraftLine => ({
    itemId, qty: '', unitPrice: '', expiryDate: '', serialsRaw: '', unitName: '', vatPercent: itemVatPercent(itemId), warehouseId: defaultPurchaseWarehouseId, ...patch,
  })
  const fmt = (m: number) => formatMinor(m, cur, false)
  const supplierLabel = (id: number) => id === 0 ? 'مورد نقدي' : suppliers.find((supplier) => supplier.id === id)?.nameAr ?? `مورد #${id}`
  const supplierPickerInfo = (party: { id: number; active?: boolean }) => {
    const balance = getSupplierBalance(party.id)
    return { code: partyCode('SUP', party.id), balance: `الرصيد ${fmt(Math.abs(balance))} ${cur.symbol} ${balance > 0 ? 'مستحق له' : balance < 0 ? 'لك عنده' : ''}` }
  }

  const purchaseWarehouseLabel = (p: PurchaseInvoice) => {
    if (p.warehouseId != null) return warehouses.find((w) => w.id === p.warehouseId)?.nameAr ?? '—'
    if (p.lines.some((l) => l.warehouseId != null)) return 'متعدد حسب السطور'
    return warehouses.find((w) => w.isMain)?.nameAr ?? warehouses[0]?.nameAr ?? '—'
  }

  const [open, setOpen] = useState(false)
  const [viewing, setViewing] = useState<PurchaseInvoice | null>(null)
  // طباعة فاتورة الشراء بقوالب الكاشير الثلاثة (طلب المالك)
  const [printTarget, setPrintTarget] = useState<PurchaseInvoice | null>(null)
  const [payableAmount, setPayableAmount] = useState('')
  const [payableTreasury, setPayableTreasury] = useState('1101')
  const settleExpensePayable = (id: number, remaining: number) => { try { const amount = payableAmount.trim() ? toMinor(payableAmount, cur.decimals) : remaining; settlePurchaseExpensePayable({ payableId: id, amountMinor: amount, treasury: payableTreasury, date: today }); setPayableAmount(''); toast.show('تم سداد الاستحقاق وإنشاء سند الصرف والقيد ✓') } catch (error) { toast.show((error as Error).message, 'error') } }

  /** نموذج طباعة فاتورة الشراء: سطور بسعر المورد + إبراز المصاريف المحملة */
  const printPurchase = (inv: PurchaseInvoice, template: Parameters<typeof printModelWithTemplate>[3]) => {
    const model = buildSimpleDocModel({
      docTitle: 'فاتورة شراء',
      invoiceNumber: inv.invoiceNumber,
      refCode: inv.refCode ?? '',
      dateIso: inv.date,
      partyLabel: supplierLabel(inv.supplierId),
      paymentLabel: inv.paidMinor >= (inv.supplierDueMinor ?? inv.grandTotalMinor) ? 'مدفوعة بالكامل' : inv.paidMinor > 0 ? 'مدفوعة جزئياً' : 'آجلة',
      rows: inv.lines.map((l) => ({
        nameAr: items.find((it) => it.id === l.itemId)?.nameAr ?? `صنف #${l.itemId}`,
        qty: l.qty,
        unitPriceMinor: l.unitPriceMinor,
        totalMinor: Math.round(l.unitPriceMinor * l.qty),
      })),
      totalMinor: inv.grandTotalMinor,
      paidMinor: inv.paidMinor,
      settings: receipt,
      extraFooter: [`${inv.supplierInvoiceNumber ? `فاتورة المورد ${inv.supplierInvoiceNumber}` : ''}${inv.purchaseOrderNumber ? ` · أمر شراء ${inv.purchaseOrderNumber}` : ''}${inv.dueDate ? ` · استحقاق ${inv.dueDate}` : ''}`, inv.expensesTotalMinor > 0 ? `بضاعة ${fmt(inv.goodsTotalMinor)} + مصاريف ${fmt(inv.expensesTotalMinor)}` : ''].filter(Boolean).join(' — ') || undefined,
    })
    printModelWithTemplate(model, cur, receipt, template)
    toast.show(`أُرسلت فاتورة الشراء ${inv.invoiceNumber} للطباعة 🖨️`)
  }
  const [supplierId, setSupplierId] = useState(0)
  const [partyEditorOpen, setPartyEditorOpen] = useState(false)
  const [lines, setLines] = useState<DraftLine[]>([])
  const firstItemRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const focusItem = () => { firstItemRef.current?.focus() }
    window.addEventListener('shopsys:focus-item', focusItem)
    return () => window.removeEventListener('shopsys:focus-item', focusItem)
  }, [])
  /* الأمر 6: إضافة صنف سريعة داخل فاتورة الشراء — بضاعة جديدة تصل مع المورد */
  const [quickOpen, setQuickOpen] = useState(false)
  const [qName, setQName] = useState('')
  const [qBarcode, setQBarcode] = useState('')
  const [qPrice, setQPrice] = useState('')
  const [qCat, setQCat] = useState('')
  const quickAdd = () => {
    if (!qName.trim()) { toast.show('اكتب اسم الصنف', 'error'); return }
    const catId = qCat ? Number(qCat) : categories[0]?.id
    if (catId == null) { toast.show('أضف قسماً أولاً من شاشة الأصناف', 'error'); return }
    addItem({
      nameAr: qName.trim(), sku: '', barcodes: qBarcode.trim() ? [qBarcode.trim()] : [], categoryId: catId,
      baseUnit: 'قطعة', extraUnits: [], costMinor: 0, stockQty: 0,
      priceMinor: qPrice.trim() ? toMinor(qPrice, cur.decimals) : 0, minQty: 0,
      trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false,
      variantColors: [], variantSizes: [], isActive: true,
    })
    const created = useDataStore.getState().items.at(-1)!
    setLines((l) => [...l, makeDraftLine(created.id)])
    setQuickOpen(false); setQName(''); setQBarcode(''); setQPrice(''); setQCat('')
    toast.show(`أُضيف «${created.nameAr}» وسطر له في الفاتورة — التكلفة ستتحدد من هذه الفاتورة ✓`)
  }
  const [expenses, setExpenses] = useState<DraftExpense[]>([])
  const managedExpenses: PurchaseExpense[] = expenses.map((expense) => ({ ...expense, amountMinor: toMinor(expense.amount || '0', cur.decimals) }))
  const setManagedExpenses = (next: PurchaseExpense[]) => setExpenses(next.map((expense) => ({
    nameAr: expense.nameAr,
    amount: expense.amountMinor ? String(expense.amountMinor / 10 ** cur.decimals) : '',
    method: expense.method,
    paidBy: expense.paidBy ?? 'payable',
    payAccount: expense.payAccount ?? '1101',
    custodyFileId: expense.custodyFileId ?? null,
    beneficiaryName: expense.beneficiaryName ?? '',
    payableAccountCode: expense.payableAccountCode ?? '2117',
    accountCode: expense.accountCode ?? '5108',
    costCenterId: expense.costCenterId ?? null,
    vehicleId: expense.vehicleId ?? null,
    costTreatment: expense.costTreatment,
    taxTreatment: expense.taxTreatment,
    taxPercent: expense.taxPercent,
  })))
  const [paid, setPaid] = useState('')
  // T1: ض.ق.م المدخلات تُحسب الآن من كل سطر حسب نسبة بلد المنشأة/استثناء الصنف — لا حقل عام على الفاتورة
  const [paySource, setPaySource] = useState<PaySourceValue>(DEFAULT_PAY_SOURCE)
  const [projectId, setProjectId] = useState('')
  /* الأمر 8: المخزن المستلم للبضاعة — الافتراضي من الإعدادات */
  const [warehouseId, setWarehouseId] = useState<number | null>(defaultPurchaseWarehouseId)
  const [notes, setNotes] = useState('')
  const [lineOptionsOpen, setLineOptionsOpen] = useState(false)
  const [lineOptions, setLineOptions] = useState({ expiry: false, serials: false })
  const [expensesOpen, setExpensesOpen] = useState(false)
  const lineWarehouseMode = warehouses.length > 1 && warehouseId == null
  const lineGridClass = lineWarehouseMode
    ? (lineOptions.expiry ? 'sm:grid-cols-[1fr_130px_100px_85px_115px_82px_130px_36px]' : 'sm:grid-cols-[1fr_130px_100px_85px_115px_82px_36px]')
    : (lineOptions.expiry ? 'sm:grid-cols-[1fr_110px_90px_120px_96px_140px_36px]' : 'sm:grid-cols-[1fr_110px_90px_120px_96px_36px]')
  // مصروف لاحق على فاتورة مرحّلة (طلب المالك — «يمكن لاحقاً تسجيل مصروفات أخرى»)
  const [lateName, setLateName] = useState('')
  const [lateAmount, setLateAmount] = useState('')
  const [lateMethod, setLateMethod] = useState<'value' | 'qty'>('qty')
  const [latePaidBy, setLatePaidBy] = useState<'supplier' | 'treasury' | 'custody' | 'payable'>('supplier')
  const [latePayableName, setLatePayableName] = useState('')
  const [latePayableAccount, setLatePayableAccount] = useState('2117')
  const [lateVehicleId, setLateVehicleId] = useState<number | null>(null)
  const [lateCostCenterId, setLateCostCenterId] = useState<number | null>(null)
  const [latePayAccount, setLatePayAccount] = useState('1101')
  const [lateCustodyId, setLateCustodyId] = useState<number | null>(null)

  /* ─── تعديل فاتورة شراء (عكس القيد + إعادة الترحيل — لا يفسد الدفتر) ─── */
  const [editing, setEditing] = useState<PurchaseInvoice | null>(null)
  const [editLines, setEditLines] = useState<{ itemId: number; qty: string; unitPrice: string }[]>([])
  const [selectedEditLine, setSelectedEditLine] = useState<number | null>(null)
  const [editPaid, setEditPaid] = useState('')
  const [editTreasury, setEditTreasury] = useState('1101')
  const [editSupplierInvoiceNumber, setEditSupplierInvoiceNumber] = useState('')
  const [editPurchaseOrderNumber, setEditPurchaseOrderNumber] = useState('')
  const [editDueDate, setEditDueDate] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editExpenses, setEditExpenses] = useState<PurchaseExpense[]>([])
  const [editReason, setEditReason] = useState('')
  const [editAddItemId, setEditAddItemId] = useState(0)

  // تعديل فاتورة الشراء المرحلة عملية حساسة (نفس نمط المبيعات) — اعتماد مشرف بصلاحية مستقلة
  const editApproval = useSupervisorApproval('pur.invoice.edit')
  const openEdit = (p: PurchaseInvoice) => editApproval.request(() => doOpenEdit(p))
  const doOpenEdit = (p: PurchaseInvoice) => {
    setEditing(p)
    setSelectedEditLine(null)
    setEditLines(p.lines.map((l) => ({ itemId: l.itemId, qty: String(l.qty), unitPrice: String(l.unitPriceMinor / 10 ** cur.decimals) })))
    setEditPaid(String(p.paidMinor / 10 ** cur.decimals))
    setEditTreasury(p.treasury ?? '1101')
    setEditSupplierInvoiceNumber(p.supplierInvoiceNumber ?? '')
    setEditPurchaseOrderNumber(p.purchaseOrderNumber ?? '')
    setEditDueDate(p.dueDate ?? '')
    setEditNotes(p.notes ?? '')
    setEditExpenses(p.expenses.map((expense) => ({ ...expense })))
    setEditReason('')
    setEditAddItemId(0)
  }
  const removeSelectedEditLine = () => {
    if (selectedEditLine == null || !editLines[selectedEditLine]) return
    setEditLines((current) => current.filter((_, index) => index !== selectedEditLine))
    setSelectedEditLine(null)
  }

  const editGoodsTotal = useMemo(
    () => editLines.reduce((sum, l) => sum + Math.round((Number(l.qty) || 0) * toMinor(l.unitPrice || '0', cur.decimals)), 0),
    [editLines, cur.decimals],
  )

  const editExpenseTotal = useMemo(() => editExpenses.filter((expense) => (expense.costTreatment ?? 'inventory') === 'inventory').reduce((sum, expense) => sum + expense.amountMinor, 0), [editExpenses])

  const saveInvoiceEdit = () => {
    if (!editing) return
    try {
      const updated = editPurchase({
        purchaseId: editing.id,
        lines: editLines.map((l) => ({ itemId: l.itemId, qty: Number(l.qty) || 0, unitPriceMinor: toMinor(l.unitPrice || '0', cur.decimals) })),
        expenses: editExpenses,
        paidMinor: toMinor(editPaid || '0', cur.decimals),
        treasury: editTreasury,
        supplierInvoiceNumber: editSupplierInvoiceNumber,
        purchaseOrderNumber: editPurchaseOrderNumber,
        dueDate: editDueDate,
        notes: editNotes,
        reason: editReason.trim(),
        einvoiceActive,
      })
      toast.show(`عُدلت ${updated.invoiceNumber} — عُكس قيدها القديم وأُعيد الترحيل بتكلفة صحيحة ✓`)
      setEditing(null)
    } catch (e) {
      toast.show((e as Error).message, 'error')
    }
  }

  const saveLateExpense = () => {
    if (!viewing) return
    try {
      const updated = addLatePurchaseExpense({
        purchaseId: viewing.id,
        nameAr: lateName.trim(),
        amountMinor: toMinor(lateAmount || '0', cur.decimals),
        method: lateMethod,
        paidBy: latePaidBy,
        payAccount: latePaidBy === 'treasury' ? latePayAccount : null,
        custodyFileId: latePaidBy === 'custody' ? lateCustodyId : null,
        beneficiaryName: latePaidBy === 'payable' ? latePayableName : null,
        payableAccountCode: latePaidBy === 'payable' ? latePayableAccount : null,
        costCenterId: lateCostCenterId,
        vehicleId: lateVehicleId,
        date: new Date().toISOString().slice(0, 10),
      })
      setViewing(updated)
      setLateName(''); setLateAmount(''); setLatePayableName(''); setLateVehicleId(null); setLateCostCenterId(null)
      toast.show('سُجّل المصروف — توزع على الأصناف وتحدثت تكلفتها وتولد قيده ✓')
    } catch (e) {
      toast.show((e as Error).message, 'error')
    }
  }

  const openNew = () => {
    setSupplierId(0)
    setLines([makeDraftLine()])
    setExpenses([])
    setPaid('')
    setPaySource(DEFAULT_PAY_SOURCE)
    setProjectId('')
    setWarehouseId(defaultPurchaseWarehouseId)
    setNotes('')
    setOpen(true)
  }

  /**
   * تحويل سطر مُدخل بوحدة أكبر إلى الوحدة الأساسية (تدقيق المالك):
   * «3 كرتونة × 240ج» ⇒ كمية 3×24=72 قطعة وسعر 240÷24=10ج للقطعة —
   * فيدخل المخزون بالقطعة والتكلفة صحيحة والبيع بالقطعة يعمل مباشرة.
   */
  const toBaseLine = (l: DraftLine) => {
    const it = items.find((x) => x.id === l.itemId)
    const u = l.unitName ? it?.extraUnits.find((x) => x.nameAr === l.unitName) : undefined
    const factor = u?.factor ?? 1
    const enteredQty = Number(l.qty)
    const enteredPriceMinor = toMinor(l.unitPrice || '0', cur.decimals)
    return {
      itemId: l.itemId,
      qty: Math.round(enteredQty * factor * 1000) / 1000,
      unitPriceMinor: factor > 1 ? Math.round(enteredPriceMinor / factor) : enteredPriceMinor,
    }
  }

  /** قيمة البضاعة والضريبة لكل سطر: نسبة البلد تُطبَّق تلقائياً على كل بند لا على الفاتورة ككل */
  const lineGoodsMinor = (l: DraftLine) => {
    try {
      const qty = Number(l.qty) || 0
      const unitPriceMinor = toMinor(l.unitPrice || '0', cur.decimals)
      return Math.round(qty * unitPriceMinor)
    } catch { return 0 }
  }
  const lineVatMinor = (l: DraftLine) => taxPolicy.effectivePercent === 0 ? 0 : Math.round((lineGoodsMinor(l) * Math.max(0, l.vatPercent || 0)) / 100)
  const inputVatMinor = useMemo(
    () => lines.filter((l) => l.itemId && Number(l.qty) > 0).reduce((sum, l) => sum + lineVatMinor(l), 0),
    [lines, cur.decimals],
  )

  /** مسح باركود لإضافة سطر: يجد الصنف بباركود القطعة أو باركود الوحدة الأكبر (كرتونة المصنع) */
  const [scanBuf, setScanBuf] = useState('')
  const scanIntoLines = () => {
    const q = scanBuf.trim()
    if (!q) return
    for (const it of items) {
      const u = it.extraUnits.find((x) => x.barcode === q)
      if (u) {
        // باركود كرتونة المصنع: سطر جاهز بوحدة الكرتونة — الكمية بالكرتونة والسعر سعرها
        setLines((arr) => [...arr, makeDraftLine(it.id, { qty: '1', unitName: u.nameAr })])
        toast.show(`📦 ${it.nameAr} — ${u.nameAr} (×${u.factor} ${it.baseUnit}) من باركود الوحدة`)
        setScanBuf('')
        return
      }
    }
    const exact = items.find((it) => it.barcodes.includes(q) || it.sku === q)
    if (exact) {
      setLines((arr) => [...arr, makeDraftLine(exact.id, { qty: '1' })])
      toast.show(`✓ ${exact.nameAr} أُضيف من الباركود`)
      setScanBuf('')
      return
    }
    toast.show(`لا صنف بالباركود «${q}» — أضفه أولاً (صنف جديد سريع) وسجّل الباركود عليه`, 'error')
    setScanBuf('')
  }

  /** معاينة حية للتوزيع أثناء الإدخال */
  const preview = useMemo(() => {
    try {
      const costLines = lines
        .filter((l) => l.itemId && Number(l.qty) > 0)
        .map(toBaseLine)
      if (!costLines.length) return null
      const exps = expenses
        .filter((e) => Number(e.amount) > 0)
        .map((e) => ({ nameAr: e.nameAr, amountMinor: toMinor(e.amount, cur.decimals), method: e.method, paidBy: e.paidBy, costTreatment: e.costTreatment ?? 'inventory' as const }))
      const landed = computeLandedCosts(costLines, exps.filter((e) => e.costTreatment === 'inventory'))
      const goods = landed.reduce((a, l) => a + Math.round(l.qty * l.unitPriceMinor), 0)
      const inventoryExps = exps.filter((e) => e.costTreatment === 'inventory')
      const periodExps = exps.filter((e) => e.costTreatment === 'period')
      const expTotal = inventoryExps.reduce((a, e) => a + e.amountMinor, 0)
      const expDirect = exps.filter((e) => e.paidBy !== 'supplier').reduce((a, e) => a + e.amountMinor, 0)
      const supplierPeriod = periodExps.filter((e) => e.paidBy === 'supplier').reduce((a, e) => a + e.amountMinor, 0)
      // المدفوع من خزينة/عهدة/استحقاق مستقل لا يظهر في رصيد المورد، حتى لو كان مصروف فترة.
      return { landed, goods, expTotal, periodTotal: periodExps.reduce((a, e) => a + e.amountMinor, 0), inputVat: inputVatMinor, grand: goods + expTotal, supplierDue: goods + inputVatMinor + expTotal - expDirect + supplierPeriod }
    } catch {
      return null
    }
  }, [lines, expenses, cur.decimals, inputVatMinor])

  const invoiceSignature = JSON.stringify({ supplierId, lines, expenses, paid, paySource, warehouseId, projectId, notes, taxPolicy: taxPolicy.effectivePercent })
  const unsaved = useUnsavedChangesGuard(invoiceSignature)
  useEffect(() => { if (open) unsaved.markClean() }, [open])

  const save = () => {
    if (!preview || supplierId < 0) return
    if (supplierId === 0 && toMinor(paid || '0', cur.decimals) !== preview.supplierDue) {
      toast.show(`الشراء النقدي يجب سداده بالكامل: ${fmt(preview.supplierDue)}`, 'error')
      return
    }
    try {
    // P2 (مراجعة المشتريات): المطابقة بالترتيب لا بالبحث — سطران بنفس الصنف والكمية
    // كانا يأخذان صلاحية/سيريالات السطر الأول معاً (computeLandedCosts يحفظ الترتيب)
    const enteredLines = lines.filter((l) => l.itemId && Number(l.qty) > 0)
    if (lineWarehouseMode && enteredLines.some((l) => l.warehouseId == null)) {
      toast.show('اختر مخزناً لكل سطر — لا يمكن ترحيل بضاعة على مخزن غير مختار', 'error')
      return
    }
    const inv = postPurchase({
      supplierId,
      date: new Date().toISOString().slice(0, 10),
      lines: preview.landed.map((l, i) => {
        const d = enteredLines[i]
        return {
          itemId: l.itemId,
          qty: l.qty,
          unitPriceMinor: l.unitPriceMinor,
          vatPercent: taxPolicy.effectivePercent === 0 ? 0 : (d?.vatPercent ?? 0),
          inputVatMinor: d ? lineVatMinor(d) : 0,
          warehouseId: lineWarehouseMode ? (d?.warehouseId ?? null) : undefined,
          expiryDate: d?.expiryDate || null,
          serialsRaw: d?.serialsRaw || undefined,
        }
      }),
      expenses: expenses
        .filter((e) => Number(e.amount) > 0)
        .map((e) => ({
          nameAr: e.nameAr.trim() || 'مصروف شراء',
          amountMinor: toMinor(e.amount, cur.decimals),
          method: e.method,
          paidBy: e.paidBy,
          payAccount: e.paidBy === 'treasury' ? e.payAccount : null,
          custodyFileId: e.paidBy === 'custody' ? e.custodyFileId : null,
          beneficiaryName: e.paidBy === 'payable' ? e.beneficiaryName.trim() : undefined,
          payableAccountCode: e.paidBy === 'payable' ? e.payableAccountCode : undefined,
          accountCode: e.accountCode,
          costCenterId: e.costCenterId,
          vehicleId: e.vehicleId,
          costTreatment: e.costTreatment,
          taxTreatment: taxPolicy.canRecoverInputTax ? (e.taxTreatment ?? 'exempt') : 'exempt',
          taxPercent: taxPolicy.canRecoverInputTax ? (e.taxPercent ?? 0) : 0,
        })),
      paidMinor: paid ? toMinor(paid, cur.decimals) : 0,
      treasury: paySource.kind === 'treasury' ? paySource.treasury : undefined,
      custodyFileId: paySource.kind === 'custody' ? paySource.custodyFileId : null,
      projectId: projectId ? Number(projectId) : null,
      warehouseId: lineWarehouseMode ? null : warehouseId, // مخزن الفاتورة أو null = تحديد بالسطر
      inputVatMinor,
      purchaseExpenseTaxRecoverable: taxPolicy.canRecoverInputTax,
      notes,
    })
    toast.show(`رُحّلت الفاتورة ${inv.invoiceNumber} — تحدثت تكلفة الأصناف بالمتوسط المرجح ✓`)
    unsaved.markClean()
    setOpen(false)
    } catch (e) {
      toast.show((e as Error).message, 'error')
    }
  }

  return (
    <div className="space-y-4">
      {advancedInvoiceDrafts.filter(d=>d.kind==='purchase').length>0&&<div className="rounded-2xl border border-amber-400/30 bg-amber-500/5 p-3 flex flex-wrap items-center justify-between gap-2"><div><b>مسودات مشتريات محفوظة: {advancedInvoiceDrafts.filter(d=>d.kind==='purchase').length}</b><div className="text-xs text-slate-500">يمكن استعادة أحدث مسودة من المحرر المتقدم دون أي أثر محاسبي</div></div><div className="flex gap-2"><Btn variant="ghost" onClick={()=>navigate('/purchases/invoices/new')}>الانتقال للمحرر</Btn><Btn variant="ghost" onClick={()=>{advancedInvoiceDrafts.filter(d=>d.kind==='purchase').forEach(d=>deleteAdvancedInvoiceDraft(d.id));toast.show('حُذفت مسودات المشتريات')}}>حذف الكل</Btn></div></div>}
      <div className="anim-up flex items-center justify-between">
        <div><p className="text-[12px] text-slate-400 max-w-lg leading-relaxed">
          💡 الترحيل يوزع مصاريف الشراء على الأصناف (حسب القيمة أو الكمية لكل مصروف) ثم يحدّث
          تكلفة كل صنف <b>بالمتوسط المرجح المتحرك</b> ويزيد رصيد المخزون.
        </p>
        {purchaseExpensePayables.some(p=>p.status!=='paid')&&<div className="text-[11px] font-bold text-violet-600 mt-1">استحقاقات جهات أخرى: {purchaseExpensePayables.filter(p=>p.status!=='paid').length} · متبقي {fmt(purchaseExpensePayables.filter(p=>p.status!=='paid').reduce((s,p)=>s+p.amountMinor-p.paidMinor,0))}</div>}</div>
        <div className="flex gap-2"><Btn variant="ghost" onClick={openNew} disabled={items.length === 0}><span className="flex items-center gap-1.5"><Plus size={15} /> إدخال سريع</span></Btn><Btn shortcut="F3" onClick={() => navigate('/purchases/invoices/new')} disabled={items.length === 0}><span className="flex items-center gap-1.5"><Plus size={15} /> فاتورة شراء</span></Btn></div>
      </div>

      {items.length === 0 && (
        <div className="anim-pop p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-[12px] font-bold text-amber-700 dark:text-amber-400">
          ⚠️ تحتاج أولاً: {items.length === 0 ? 'إضافة أصناف (المخزون ← الأصناف)' : ''}
        </div>
      )}

      {purchases.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
          <EmptyState icon="🚛" title="لا فواتير شراء بعد" sub="أول فاتورة شراء هي التي تبدأ حساب التكلفة الحقيقية لأصنافك" />
        </div>
      ) : (
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right text-[11px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <th className="px-4 py-3 font-bold">الفاتورة</th>
                <th className="px-4 py-3 font-bold">المورد</th>
                <th className="px-4 py-3 font-bold">البضاعة</th>
                <th className="px-4 py-3 font-bold">المصاريف</th>
                <th className="px-4 py-3 font-bold">الإجمالي</th>
                <th className="px-4 py-3 font-bold">المدفوع</th>
                <th className="px-4 py-3 font-bold">الاستحقاق</th>
                <th className="px-4 py-3 font-bold"></th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((p, i) => (
                <tr key={p.id} style={{ animationDelay: `${i * 30}ms` }} className="anim-in border-b border-slate-50 dark:border-slate-800/50 hover:bg-cyan-500/[0.04] transition-colors duration-150">
                  <td className="px-4 py-3">
                    <div className="font-bold text-slate-800 dark:text-white">{p.invoiceNumber}</div>
                    {p.refCode && <div className="text-[10px] font-mono text-sky-600 dark:text-sky-400" dir="ltr">{p.refCode}</div>}
                    {p.supplierInvoiceNumber&&<div className="text-[10px] text-violet-600">فاتورة المورد: {p.supplierInvoiceNumber}</div>}
                    {p.purchaseOrderNumber&&<div className="text-[10px] text-slate-500">أمر شراء: {p.purchaseOrderNumber}</div>}
                    <div className="text-[11px] text-slate-400">{p.date}</div>
                    {p.receiptStatus&&<div className={`text-[10px] font-bold ${p.receiptStatus==='partial'?'text-amber-600':p.receiptStatus==='received'?'text-emerald-600':'text-slate-500'}`}>{p.receiptStatus==='partial'?'استلام جزئي':p.receiptStatus==='received'?'مستلمة':'بانتظار الاستلام'}</div>}
                    {warehouses.length > 1 && (
                      <div className="text-[10.5px] text-slate-400">مخزن: {purchaseWarehouseLabel(p)}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{supplierLabel(p.supplierId)}</td>
                  <td className="px-4 py-3">{fmt(p.goodsTotalMinor)}</td>
                  <td className="px-4 py-3">
                    {p.expensesTotalMinor > 0
                      ? <span className="text-amber-600 dark:text-amber-400 font-bold">{fmt(p.expensesTotalMinor)}</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3 font-black text-slate-800 dark:text-white">{fmt(p.grandTotalMinor)}</td>
                  <td className="px-4 py-3">
                    <span className={p.paidMinor >= (p.supplierDueMinor ?? p.grandTotalMinor) ? 'text-emerald-600 font-bold' : 'text-rose-500 font-bold'}>
                      {fmt(p.paidMinor)}
                    </span>
                  </td>
                  <td className="px-4 py-3">{p.paidMinor >= (p.supplierDueMinor ?? p.grandTotalMinor) ? <span className="text-emerald-600 font-bold">مدفوعة</span> : p.dueDate ? <span className={p.dueDate < today ? 'text-rose-600 font-bold' : 'text-amber-600 font-bold'}>{p.dueDate < today ? 'متأخرة' : p.dueDate}</span> : <span className="text-slate-400">غير محدد</span>}</td>
                  <td className="px-4 py-3 text-left whitespace-nowrap">
                    {editPolicy.canEdit ? (
                      /* تعديل متاح — الفاتورة الإلكترونية غير مفعلة (سياسة المالك) */
                      <button onClick={() => openEdit(p)} title={editPolicy.reasonAr} className="p-2 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-500/10 transition-all duration-200 hover:scale-110">
                        <Pencil size={15} />
                      </button>
                    ) : (
                      <button onClick={() => navigate('/purchases/returns')} title="إشعار مدين على المورد — الفاتورة الإلكترونية مفعلة فلا تعديل؛ التصحيح بمرتجع شراء رسمي" className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 transition-all duration-200 hover:scale-110">
                        <Receipt size={15} />
                      </button>
                    )}
                    <button onClick={() => setViewing(p)} title="عرض الفاتورة وقيدها" className="p-2 rounded-lg text-slate-400 hover:text-cyan-600 hover:bg-cyan-500/10 transition-all duration-200 hover:scale-110">
                      <Eye size={15} />
                    </button>
                    <button onClick={() => setPrintTarget(p)} title="طباعة فاتورة الشراء — حراري/A4/A5" className="p-2 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-500/10 transition-all duration-200 hover:scale-110">
                      <Printer size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* مودال فاتورة جديدة */}
      <Modal open={open} onClose={() => unsaved.requestClose(() => setOpen(false))} title="فاتورة شراء جديدة" wide>
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="المورد (اختياري)">
              <div className="flex items-center gap-2"><div className="min-w-0 flex-1"><PartyQuickPicker
                parties={suppliers}
                value={supplierId}
                onChange={setSupplierId}
                cashLabel="مورد نقدي"
                label="بحث المورد — اكتب أول حرف ثم Enter"
                partyInfo={supplierPickerInfo}
                onConfirm={() => window.dispatchEvent(new Event('shopsys:focus-item'))}
                autoFocus
              /></div>{supplierId > 0 ? <button type="button" title="تعديل بيانات المورد" onClick={() => setPartyEditorOpen(true)} className="mt-0.5 rounded-lg border border-sky-300 p-2 text-sky-700 hover:bg-sky-50 dark:border-sky-800 dark:text-sky-300"><Pencil size={15}/></button> : null}</div>
            </Field>
          </div>
          {warehouses.length > 1 && (
            <Field label="مخزن الفاتورة" hint="اختر مخزناً واحداً للفاتورة كلها، أو «تحديد لكل سطر» إذا كانت البضاعة موزعة على أكثر من مخزن. لا يوجد مخزن مبهم.">
              <QuickSelect
                value={warehouseId == null ? 'line' : String(warehouseId)}
                onChange={(e) => setWarehouseId(e.target.value === 'line' ? null : Number(e.target.value))}
                className={inputCls}
              >
                {warehouses.map((w) => <option key={w.id} value={w.id}>🏬 {w.nameAr}{w.isMain ? ' (الرئيسي)' : ''}</option>)}
                <option value="line">↳ تحديد المخزن لكل سطر</option>
              </QuickSelect>
            </Field>
          )}
          {projects.some((p) => p.status === 'active') && (
            <Field label="ربط بمشروع مقاولات (اختياري)" hint="الفاتورة تدخل تكاليف المشروع وربحيته — ربحية المشروع تُحسب صافية من الضريبة: ض.ق.م المدخلات تُحسب تلقائياً من نسب السطور وتُعزل عن التكلفة">
              <QuickSelect value={projectId} onChange={(e) => setProjectId(e.target.value)} className={inputCls}>
                <option value="">— بلا مشروع —</option>
                {projects.filter((p) => p.status === 'active').map((p) => <option key={p.id} value={p.id}>{p.code} — {p.nameAr}</option>)}
              </QuickSelect>
            </Field>
          )}

          {/* السطور */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[12px] font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1.5"><Receipt size={14} /> أصناف الفاتورة</span>
              <div className="flex gap-1.5 items-center">
                <button
                  type="button"
                  onClick={() => setLineOptionsOpen((v) => !v)}
                  title="خيارات إضافية تظهر كخانات بجانب كل سطر عند تفعيلها"
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border-2 text-[11px] font-black transition-all hover:scale-[1.02] ${lineOptionsOpen || lineOptions.expiry || lineOptions.serials ? 'border-violet-500/50 bg-violet-500/10 text-violet-700 dark:text-violet-300' : 'border-slate-200 dark:border-slate-700 text-slate-400 hover:border-violet-400/50'}`}
                >
                  <MoreHorizontal size={15} /> خيارات أكثر
                  {(lineOptions.expiry || lineOptions.serials) && <span className="w-2 h-2 rounded-full bg-violet-500" />}
                </button>
                <Btn variant="ghost" onClick={() => setQuickOpen(true)}>⚡ صنف جديد سريع</Btn>
                <Btn variant="soft" onClick={() => setLines((l) => [...l, makeDraftLine()])}>+ سطر</Btn>
              </div>
            </div>
            {lineOptionsOpen && (
              <div className="anim-pop mb-3 rounded-2xl border border-violet-500/20 bg-violet-500/[0.06] p-3">
                <div className="text-[12px] font-black text-violet-700 dark:text-violet-300 mb-2">⚙️ خانات إضافية للسطور</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="flex items-start gap-2 rounded-xl bg-white/60 dark:bg-slate-900/40 border border-violet-500/10 p-2.5 cursor-pointer hover:border-violet-400 transition-colors">
                    <input type="checkbox" checked={lineOptions.expiry} onChange={(e) => setLineOptions((o) => ({ ...o, expiry: e.target.checked }))} className="mt-1 accent-violet-600" />
                    <span>
                      <b className="block text-[12px] text-slate-700 dark:text-slate-200">تاريخ الصلاحية لكل سطر</b>
                      <span className="text-[10.5px] text-slate-400">مخفي افتراضياً — فعّله فقط للأصناف ذات الصلاحية.</span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2 rounded-xl bg-white/60 dark:bg-slate-900/40 border border-violet-500/10 p-2.5 cursor-pointer hover:border-violet-400 transition-colors">
                    <input type="checkbox" checked={lineOptions.serials} onChange={(e) => setLineOptions((o) => ({ ...o, serials: e.target.checked }))} className="mt-1 accent-violet-600" />
                    <span>
                      <b className="block text-[12px] text-slate-700 dark:text-slate-200">سيريالات / IMEI للسطور</b>
                      <span className="text-[10.5px] text-slate-400">تظهر خانة السيريالات أسفل السطر عند الحاجة فقط.</span>
                    </span>
                  </label>
                </div>
              </div>
            )}
            {/* مسح باركود لإضافة سطر (تدقيق المالك): باركود القطعة أو باركود كرتونة المصنع */}
            <div className="mb-2">
              <input
                value={scanBuf}
                onChange={(e) => setScanBuf(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); scanIntoLines() } }}
                placeholder="🔍 امسح باركود الصنف أو باركود الكرتونة لإضافة سطر تلقائياً…"
                className={inputCls}
                dir="ltr"
              />
            </div>
            {/* رؤوس أعمدة واضحة — الضريبة بجانب كل بند، والصلاحية لا تظهر إلا من «خيارات أكثر» */}
            <div className={`hidden sm:grid ${lineGridClass} gap-2 px-1 pb-1 text-[10.5px] font-bold text-slate-400`}>
              <span>الصنف</span>{lineWarehouseMode && <span>المخزن</span>}<span>الوحدة</span><span>الكمية</span><span>سعر الوحدة ({cur.symbol})</span><span>ضريبة</span>{lineOptions.expiry && <span>الصلاحية</span>}<span />
            </div>
            <div className="space-y-2">
              {lines.map((l, i) => {
                const lineItem = items.find((it) => it.id === l.itemId)
                const lineUnit = l.unitName ? lineItem?.extraUnits.find((u) => u.nameAr === l.unitName) : undefined
                return (
                <div key={i} className="anim-in">
                <div className={`grid grid-cols-2 ${lineGridClass} gap-2 items-center`}>
                  <div className="col-span-2 sm:col-span-1">
                    <ItemQuickPicker
                      items={items}
                      inputElementRef={i === 0 ? firstItemRef : undefined}
                      listenForShortcut={i === 0}
                      onPick={(nextId) => setLines((arr) => arr.map((x, j) => (j === i ? { ...x, itemId: nextId, unitName: '', vatPercent: itemVatPercent(nextId) } : x)))}
                      onEdit={(id) => goTo(`/inventory/items?edit=${id}`)}
                      onMovement={(id) => goTo(`/inventory/items?card=${id}`)}
                      onPrices={(id) => goTo(`/sales/price-lists?item=${id}`)}
                      placeholder={lineItem?.nameAr ?? 'اكتب الصنف ثم اختر بالسهم + Enter أو مرتين'}
                    />
                  </div>
                  {lineWarehouseMode && (
                    <QuickSelect
                      value={l.warehouseId ?? ''}
                      onChange={(e) => setLines((arr) => arr.map((x, j) => (j === i ? { ...x, warehouseId: e.target.value ? Number(e.target.value) : null } : x)))}
                      className={inputCls}
                      title="المخزن الذي يستلم هذا السطر"
                    >
                      <option value="">— اختر مخزناً —</option>
                      {warehouses.map((w) => <option key={w.id} value={w.id}>{w.nameAr}{w.isMain ? ' (الرئيسي)' : ''}</option>)}
                    </QuickSelect>
                  )}
                  {/* وحدة الشراء (تدقيق المالك): أساسية أو كرتونة/علبة — الكمية والسعر بها والترحيل يفكها تلقائياً */}
                  {lineItem && lineItem.extraUnits.length > 0 ? (
                    <QuickSelect
                      value={l.unitName}
                      onChange={(e) => setLines((arr) => arr.map((x, j) => (j === i ? { ...x, unitName: e.target.value } : x)))}
                      className={inputCls}
                      title="وحدة الإدخال — الكمية والسعر بهذه الوحدة"
                    >
                      <option value="">{lineItem.baseUnit || 'أساسية'}</option>
                      {lineItem.extraUnits.map((u) => <option key={u.nameAr} value={u.nameAr}>{u.nameAr} ×{u.factor}</option>)}
                    </QuickSelect>
                  ) : (
                    <span className="hidden sm:block text-center text-[11px] text-slate-400">{lineItem?.baseUnit || '—'}</span>
                  )}
                  <input
                    value={l.qty}
                    onChange={(e) => setLines((arr) => arr.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
                    type="number" inputMode="decimal" step="any" min={0} placeholder={lineUnit ? `كم ${lineUnit.nameAr}؟` : 'الكمية'} className={inputCls}
                  />
                  <input
                    value={l.unitPrice}
                    onChange={(e) => setLines((arr) => arr.map((x, j) => (j === i ? { ...x, unitPrice: e.target.value } : x)))}
                    type="number" inputMode="decimal" step="any" min={0} placeholder={lineUnit ? `سعر ${lineUnit.nameAr}` : 'سعر الوحدة'} className={inputCls}
                  />
                  <div
                    title={`ضريبة هذا البند تلقائياً حسب البلد/استثناء الصنف: ${taxPolicy.effectivePercent === 0 ? 0 : l.vatPercent}٪`}
                    className="h-11 rounded-xl border-2 border-sky-200 dark:border-sky-800/70 bg-sky-500/[0.06] flex flex-col items-center justify-center text-center"
                  >
                    <span className="text-[12px] font-black text-sky-700 dark:text-sky-300">{taxPolicy.effectivePercent > 0 && l.vatPercent > 0 ? `${l.vatPercent}٪` : 'معفى'}</span>
                    <span className="text-[9px] text-sky-500/80">{fmt(lineVatMinor(l))}</span>
                  </div>
                  {lineOptions.expiry && (lineItem?.trackExpiry ? (
                    <input
                      value={l.expiryDate}
                      onChange={(e) => setLines((arr) => arr.map((x, j) => (j === i ? { ...x, expiryDate: e.target.value } : x)))}
                      type="date" title="تاريخ الصلاحية (FEFO)" className={inputCls} dir="ltr"
                    />
                  ) : <span className="hidden sm:flex h-11 items-center justify-center rounded-xl border-2 border-slate-100 dark:border-slate-800 text-slate-300 dark:text-slate-700 text-[11px]">لا يتتبع</span>)}
                  <button onClick={() => setLines((arr) => arr.filter((_, j) => j !== i))} className="p-2 text-slate-300 hover:text-rose-500 transition-colors justify-self-center">
                    <Trash2 size={15} />
                  </button>
                </div>
                {/* معاينة فك الوحدة (تدقيق المالك): «3 كرتونة ×24 = 72 قطعة بسعر 10ج للقطعة» */}
                {lineUnit && Number(l.qty) > 0 && (() => {
                  const entered = toMinor(l.unitPrice || '0', cur.decimals)
                  const perBase = Math.round(entered / lineUnit.factor)
                  const roundDiff = entered - perBase * lineUnit.factor // فرق تقريب القسمة لكل وحدة كبرى
                  return (
                    <p className="text-[10.5px] font-bold text-teal-600 dark:text-teal-400 mt-1 px-1">
                      ↳ {l.qty} {lineUnit.nameAr} × {lineUnit.factor} = {Math.round(Number(l.qty) * lineUnit.factor * 1000) / 1000} {lineItem?.baseUnit || 'وحدة'}
                      {entered > 0 && <> — تكلفة {lineItem?.baseUnit || 'الوحدة'} = {formatMinor(perBase, cur, false)} {cur.symbol}</>}
                      {roundDiff !== 0 && (
                        <span className="text-amber-600 dark:text-amber-400"> ⚠️ سعر الـ{lineUnit.nameAr} لا يقبل القسمة على {lineUnit.factor} — سيُسجل {formatMinor(perBase * lineUnit.factor, cur, false)} بدل {formatMinor(entered, cur, false)} (فرق {formatMinor(Math.abs(roundDiff), cur, false)})؛ عدّل السعر ليقبل القسمة إن أردت مطابقة تامة لفاتورة المورد</span>
                      )}
                    </p>
                  )
                })()}
                {/* سيريالات القطع (أصناف الموبايلات/الأجهزة) — عددها يجب أن يطابق الكمية */}
                {lineOptions.serials && lineItem?.trackSerial && (
                  <textarea
                    value={l.serialsRaw}
                    onChange={(e) => setLines((arr) => arr.map((x, j) => (j === i ? { ...x, serialsRaw: e.target.value } : x)))}
                    placeholder={`🔢 سيريالات/IMEI هذه القطع — سطر لكل سيريال أو مفصولة بفواصل (${l.qty || '؟'} سيريال مطلوب) — اتركها فارغة لتخطي التتبع`}
                    rows={2}
                    dir="ltr"
                    className={`${inputCls} mt-1.5 font-mono text-[12px]`}
                  />
                )}
                </div>
              )})}
            </div>
          </div>

          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><b className="text-[12px] text-amber-700 dark:text-amber-400">مصاريف الفاتورة</b><p className="text-[10.5px] text-slate-500">تُوزَّع على الأصناف أو تُسجل كمصروف فترة — التفاصيل داخل النافذة.</p></div>
              <Btn variant="soft" onClick={() => setExpensesOpen(true)}><Plus size={15}/> إضافة مصاريف {managedExpenses.length ? `(${managedExpenses.length})` : ''}</Btn>
            </div>
            {managedExpenses.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{managedExpenses.map((expense, index) => <span key={index} className="rounded-lg bg-white/70 px-2 py-1 text-[11px] dark:bg-slate-900/40">{expense.nameAr}: {fmt(expense.amountMinor)} {expense.paidBy === 'payable' ? '· مستحق' : ''}</span>)}</div>}
          </div>
          <Modal open={expensesOpen} onClose={() => setExpensesOpen(false)} title="تفاصيل مصاريف الشراء" wide>
            <PurchaseExpenseManager
              expenses={managedExpenses}
              onChange={setManagedExpenses}
              expenseTemplates={expenseTemplates}
              onAddTemplate={addExpenseTemplate}
              costCenters={costCenters}
              vehicles={vehicles}
              treasuries={treasuries}
              custodyFiles={custodyFiles}
              currencyDecimals={cur.decimals}
              taxPercent={taxPolicy.effectivePercent}
              taxEnabled={taxPolicy.canRecoverInputTax && effectiveCountryVatPercent > 0}
              defaultTreasury={paySource.kind === 'treasury' ? paySource.treasury : '1101'}
            />
            <div className="flex justify-end mt-3"><Btn onClick={() => setExpensesOpen(false)}>تم</Btn></div>
          </Modal>

          {/* معاينة التوزيع الحية */}
          {preview && (
            <div className="anim-pop rounded-2xl border border-emerald-500/25 bg-emerald-500/5 overflow-hidden">
              <div className="px-4 py-2.5 text-[12px] font-bold text-emerald-700 dark:text-emerald-400 border-b border-emerald-500/15">
                ✨ معاينة حية — التكلفة النهائية لكل وحدة بعد توزيع المصاريف:
              </div>
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-right text-[10px] text-slate-400">
                    <th className="px-4 py-2">الصنف</th>
                    <th className="px-4 py-2">كمية</th>
                    <th className="px-4 py-2">سعر الشراء</th>
                    <th className="px-4 py-2">نصيب المصاريف</th>
                    <th className="px-4 py-2">التكلفة النهائية/وحدة</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.landed.map((l, i) => (
                    <tr key={i} className="border-t border-emerald-500/10">
                      <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200"><span className="ml-2 font-mono text-[10px] text-slate-400" dir="ltr">{items.find((it) => it.id === l.itemId)?.sku || items.find((it) => it.id === l.itemId)?.barcodes?.[0] || l.itemId}</span>{items.find((it) => it.id === l.itemId)?.nameAr}</td>
                      <td className="px-4 py-2">{l.qty}</td>
                      <td className="px-4 py-2">{fmt(l.unitPriceMinor)}</td>
                      <td className="px-4 py-2 text-amber-600 dark:text-amber-400">{fmt(l.expenseShareMinor)}</td>
                      <td className="px-4 py-2 font-black text-emerald-700 dark:text-emerald-400">{fmt(l.landedUnitCostMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-4 py-2.5 flex flex-wrap gap-5 text-[12px] border-t border-emerald-500/15 bg-emerald-500/5">
                <span>البضاعة: <b>{fmt(preview.goods)}</b></span>
                <span>المصاريف: <b className="text-amber-600">{fmt(preview.expTotal)}</b></span>
                {preview.inputVat > 0 && <span>ض.ق.م السطور: <b className="text-sky-700 dark:text-sky-300">{fmt(preview.inputVat)}</b></span>}
                <span>الإجمالي قبل الضريبة: <b className="text-emerald-700 dark:text-emerald-400">{fmt(preview.grand)}</b></span>
                {preview.supplierDue !== preview.grand && (
                  <span>مستحق المورد فقط: <b className="text-sky-700 dark:text-sky-400">{fmt(preview.supplierDue)}</b> <span className="text-[10.5px] text-slate-400">(الباقي دفعتَه أنت مباشرة)</span></span>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-stretch">
            <div className="rounded-2xl border-2 border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-card-dark space-y-3">
              <div><b>الدفع والتحصيل</b><p className="text-xs text-slate-500">حدد المدفوع الآن، والباقي يُسجل على المورد.</p></div>
              <div className="grid sm:grid-cols-2 gap-3"><Field label={`المدفوع الآن (${cur.symbol})`}><input value={paid} onChange={(e) => setPaid(e.target.value)} type="number" inputMode="decimal" step="any" min={0} className={inputCls} placeholder="0" /></Field><Field label="مصدر الدفع"><PaySourcePicker value={paySource} onChange={setPaySource} /></Field></div>
              <div className="rounded-xl bg-slate-500/5 p-3 text-sm font-bold">المتبقي للمورد: <span className="text-brand-600">{preview ? fmt(preview.supplierDue - toMinor(paid || '0', cur.decimals)) : '—'} {cur.symbol}</span></div>
            </div>
            <div className="rounded-2xl border-2 border-brand-200 bg-brand-50/40 p-4 dark:border-brand-900/60 dark:bg-brand-950/20 space-y-2">
              <b>إجمالي الفاتورة</b>
              {preview ? <><div className="flex justify-between text-sm"><span>البضاعة والمصاريف</span><b>{fmt(preview.grand)} {cur.symbol}</b></div><div className="flex justify-between text-sm"><span>ضريبة المدخلات</span><b>{fmt(preview.inputVat)} {cur.symbol}</b></div><div className="border-t pt-2 flex justify-between font-black text-lg"><span>مستحق المورد</span><b>{fmt(preview.supplierDue)} {cur.symbol}</b></div></> : <div className="text-sm text-slate-400">أضف أصنافاً لعرض الإجمالي</div>}
            </div>
          </div>
          <Field label="ملاحظات"><input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} /></Field>

          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => unsaved.requestClose(() => setOpen(false))}>تراجع وإغلاق</Btn>
            <Btn onClick={save} shortcut="F9" disabled={!preview || supplierId < 0}>🚀 ترحيل الفاتورة</Btn>
          </div>
        </div>
      </Modal>

      {unsaved.prompt}
      <PartyQuickEditModal open={partyEditorOpen} target={supplierId > 0 && suppliers.find((supplier) => supplier.id === supplierId) ? { kind: 'supplier', party: suppliers.find((supplier) => supplier.id === supplierId)! } : null} currencyDecimals={cur.decimals} currencySymbol={cur.symbol} onClose={() => setPartyEditorOpen(false)} />

      {/* ⚡ إضافة صنف سريعة داخل الفاتورة (الأمر 6) — التكلفة تتحدد من الفاتورة نفسها */}
      <Modal open={quickOpen} onClose={() => setQuickOpen(false)} title="⚡ صنف جديد سريع">
        <div className="space-y-3">
          <Field label="اسم الصنف *"><input value={qName} onChange={(e) => setQName(e.target.value)} className={inputCls} autoFocus /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="الباركود (اختياري)"><input value={qBarcode} onChange={(e) => setQBarcode(e.target.value)} className={inputCls} dir="ltr" /></Field>
            <Field label={`سعر البيع (${cur.symbol})`}><input value={qPrice} onChange={(e) => setQPrice(e.target.value)} className={inputCls} dir="ltr" placeholder="0" /></Field>
          </div>
          <Field label="القسم" hint="بقية البيانات (وحدات/صلاحية/سيريال) تُستكمل لاحقاً من شاشة الأصناف">
            <QuickSelect value={qCat} onChange={(e) => setQCat(e.target.value)} className={inputCls}>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
            </QuickSelect>
          </Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setQuickOpen(false)}>إلغاء</Btn>
            <Btn onClick={quickAdd}>إضافة وإدراج سطر بالفاتورة</Btn>
          </div>
        </div>
      </Modal>

      {/* عرض فاتورة */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing ? `فاتورة ${viewing.invoiceNumber}${viewing.refCode ? ` — ${viewing.refCode}` : ''}` : ''} wide>
        {viewing && (
          <div className="space-y-4 text-sm">
            <div className="flex gap-4 text-[12px] text-slate-500">
              <span>📅 {viewing.date}</span>
              <span>🚛 {supplierLabel(viewing.supplierId)}</span>
            </div>
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-right text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                  <th className="px-3 py-2">الصنف</th>{warehouses.length > 1 && <th className="px-3 py-2">المخزن</th>}<th className="px-3 py-2">كمية</th><th className="px-3 py-2">سعر</th><th className="px-3 py-2">ضريبة</th>
                  <th className="px-3 py-2">نصيب مصاريف</th><th className="px-3 py-2">تكلفة نهائية</th>
                </tr>
              </thead>
              <tbody>
                {viewing.lines.map((l, i) => (
                  <tr key={i} className="border-b border-slate-50 dark:border-slate-800/50">
                    <td className="px-3 py-2 font-bold"><span className="ml-2 font-mono text-[10px] text-slate-400" dir="ltr">{items.find((it) => it.id === l.itemId)?.sku || items.find((it) => it.id === l.itemId)?.barcodes?.[0] || l.itemId}</span>{items.find((it) => it.id === l.itemId)?.nameAr ?? `#${l.itemId}`}</td>
                    {warehouses.length > 1 && <td className="px-3 py-2 text-slate-500">{warehouses.find((w) => w.id === (l.warehouseId ?? viewing.warehouseId ?? warehouses.find((ww) => ww.isMain)?.id))?.nameAr ?? '—'}</td>}
                    <td className="px-3 py-2">{l.qty}{l.orderedQty!=null&&<div className="text-[10px] text-slate-400">مطلوب {l.orderedQty}{(l.rejectedQty??0)>0?` · مرفوض ${l.rejectedQty}`:''}</div>}</td>
                    <td className="px-3 py-2">{fmt(l.unitPriceMinor)}</td>
                    <td className="px-3 py-2 text-sky-600 font-bold">{l.vatPercent != null ? (l.vatPercent > 0 ? `${l.vatPercent}٪ · ${fmt(l.inputVatMinor ?? 0)}` : 'معفى') : '—'}</td>
                    <td className="px-3 py-2 text-amber-600">{fmt(l.expenseShareMinor)}</td>
                    <td className="px-3 py-2 font-black text-emerald-600">{fmt(l.landedUnitCostMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {viewing.expenses.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {viewing.expenses.map((e, i) => (
                  <span key={i} className="text-[11px] px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 font-bold">
                    {e.nameAr}: {fmt(e.amountMinor)} ({e.method === 'qty' ? 'بالكمية' : 'بالقيمة'}
                    {(e.paidBy ?? 'supplier') === 'supplier' ? ' · على المورد' : (e.paidBy === 'custody' ? ' · من عهدة' : e.paidBy === 'payable' ? ` · مستحق لـ ${e.beneficiaryName ?? 'جهة'}` : ` · من ${treasuries.find((t) => t.code === e.payAccount)?.nameAr ?? 'خزينة'}`)}
                    {e.late ? ' · لاحق' : ''})
                  </span>
                ))}
              </div>
            )}
            {viewing.approvedBy&&<div className="text-xs font-bold text-violet-600">اعتماد المصروفات الحساسة: {viewing.approvedBy}</div>}
            {purchaseExpensePayables.filter(p=>p.purchaseId===viewing.id&&p.status!=='paid').map(payable=>{const remaining=payable.amountMinor-payable.paidMinor;return <div key={payable.id} className="p-3 rounded-xl border border-violet-400/30 bg-violet-500/5 grid md:grid-cols-4 gap-2 items-end"><div><b>{payable.beneficiaryName}</b><div className="text-xs text-slate-500">{payable.description} · متبقي {fmt(remaining)}</div></div><input className={inputCls} value={payableAmount} onChange={e=>setPayableAmount(e.target.value)} placeholder={`كامل ${fmt(remaining)}`}/><TreasuryPicker value={payableTreasury} onChange={setPayableTreasury}/><Btn onClick={()=>settleExpensePayable(payable.id,remaining)} shortcut="F9">سند صرف وإقفال</Btn></div>})}
            <div className="flex flex-wrap gap-5 font-bold">
              <span>البضاعة: {fmt(viewing.goodsTotalMinor)}</span>
              <span className="text-amber-600">المصاريف: {fmt(viewing.expensesTotalMinor)}</span>
              <span className="text-emerald-600">الإجمالي: {fmt(viewing.grandTotalMinor)}</span>
              {(viewing.inputVatMinor ?? 0) > 0 && (
                <span className="text-violet-600">ض.ق.م مدخلات: {fmt(viewing.inputVatMinor!)}</span>
              )}
              {(viewing.supplierDueMinor ?? viewing.grandTotalMinor) !== viewing.grandTotalMinor && (
                <span className="text-sky-600">مستحق المورد: {fmt(viewing.supplierDueMinor ?? viewing.grandTotalMinor)}</span>
              )}
            </div>

            {/* مصروف لاحق — وصلت فاتورة الشحن/الجمارك بعد الترحيل؟ (طلب المالك) */}
            <div className="p-3.5 rounded-2xl bg-amber-500/5 border border-amber-500/20 space-y-2.5">
              <div className="text-[12px] font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                <TruckIcon size={13} /> إضافة مصروف لاحق على هذه الفاتورة
                <span className="font-normal text-slate-400 text-[10.5px]">— يوزَّع على الأصناف ويرفع تكلفتها فوراً (ونصيب ما بيع يذهب لتكلفة المبيعات)</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-[1fr_130px_auto] gap-2 items-end">
                <Field label="نوع المصروف">
                  <QuickSelect value={lateName} onChange={(e) => {
                    const value = e.target.value
                    const template = expenseTemplates.find((row) => row.isActive && row.nameAr === value)
                    setLateName(value)
                    if (template) setLateMethod(template.landedCostAllocation === 'quantity' ? 'qty' : 'value')
                  }} className={inputCls}>
                    <option value="">ابحث عن قالب المصروف ثم Enter</option>
                    {expenseTemplates.filter((row) => row.isActive).map((row) => <option key={row.id} value={row.nameAr}>{row.code} — {row.nameAr}</option>)}
                    {EXPENSE_PRESETS.map((preset) => <option key={`preset-${preset}`} value={preset}>{preset} (اقتراح)</option>)}
                  </QuickSelect>
                </Field>
                <Field label={`المبلغ (${cur.symbol})`}>
                  <input value={lateAmount} onChange={(e) => setLateAmount(e.target.value)} type="number" inputMode="decimal" step="any" min={0} placeholder="0" className={inputCls} />
                </Field>
                <Field label="التوزيع">
                  <div className="flex rounded-xl overflow-hidden border-2 border-slate-200 dark:border-slate-700 w-fit">
                    {([['qty', 'بالكمية'], ['value', 'بالقيمة']] as const).map(([m, label]) => (
                      <button key={m} onClick={() => setLateMethod(m)}
                        className={`px-3.5 py-2 text-[11px] font-bold transition-colors ${lateMethod === m ? 'bg-amber-500 text-white' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold text-slate-500">من دفعه؟</span>
                <div className="flex rounded-xl overflow-hidden border-2 border-slate-200 dark:border-slate-700">
                  {([['supplier', '🚛 على حساب المورد'], ['treasury', '🏦 خزينة/بنك'], ['custody', '🤝 عهدة موظف'], ['payable', '🧾 مستحق لاحقاً']] as const).map(([m, label]) => (
                    <button key={m}
                      onClick={() => { setLatePaidBy(m); if (m === 'custody') setLateCustodyId(openCustodyFiles[0]?.id ?? null) }}
                      disabled={m === 'custody' && openCustodyFiles.length === 0}
                      className={`px-3 py-2 text-[11px] font-bold transition-colors disabled:opacity-40 ${latePaidBy === m ? 'bg-sky-500 text-white' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                {latePaidBy === 'treasury' && (
                  <TreasuryPicker value={latePayAccount} onChange={setLatePayAccount} operation="payment" compact />
                )}
                {latePaidBy === 'custody' && (
                  <QuickSelect value={lateCustodyId ?? ''} onChange={(e) => setLateCustodyId(e.target.value ? Number(e.target.value) : null)} className={`${inputCls} !w-auto min-w-52`}>
                    {openCustodyFiles.map((f) => (
                      <option key={f.id} value={f.id}>{f.fileNumber} — {employees.find((x) => x.id === f.employeeId)?.nameAr ?? '—'}</option>
                    ))}
                  </QuickSelect>
                )}
                {latePaidBy === 'payable' && (
                  <>
                    <input value={latePayableName} onChange={(e) => setLatePayableName(e.target.value)} className={`${inputCls} !w-auto min-w-48`} placeholder="اسم الجهة المستحقة" />
                    <QuickSelect value={latePayableAccount} onChange={(e) => setLatePayableAccount(e.target.value)} className={`${inputCls} !w-auto min-w-40`}>
                      <option value="2117">مصاريف مستحقة (2117)</option>

                    </QuickSelect>
                  </>
                )}
                <QuickSelect value={lateCostCenterId ?? ''} onChange={(e) => setLateCostCenterId(e.target.value ? Number(e.target.value) : null)} className={`${inputCls} !w-auto min-w-48`} title="مركز التكلفة العام">
                  <option value="">بدون مركز عام</option>
                  {costCenters.filter((center) => center.isActive).map((center) => <option key={center.id} value={center.id}>{center.code} — {center.nameAr}</option>)}
                </QuickSelect>
                <QuickSelect value={lateVehicleId ?? ''} onChange={(e) => setLateVehicleId(e.target.value ? Number(e.target.value) : null)} className={`${inputCls} !w-auto min-w-48`} title="مركز تكلفة السيارة">
                  <option value="">🚚 بدون مركز تكلفة مركبة</option>
                  {vehicles.map((v) => <option key={v.id} value={v.id}>🚚 {v.plateNumber} — {v.vehicleType}</option>)}
                </QuickSelect>
                <Btn variant="soft" onClick={saveLateExpense} shortcut="F9" disabled={!lateName.trim() || !(Number(lateAmount) > 0) || (latePaidBy === 'payable' && !latePayableName.trim())}>➕ تسجيل المصروف</Btn>
              </div>
            </div>

            {/* القيد المحاسبي المرتبط — الشفافية بالاتجاهين (القرار 9) */}
            {(() => {
              const entry = viewing.journalEntryId ? journal.find((e) => e.id === viewing.journalEntryId) : null
              return entry ? (
                <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.03] overflow-hidden">
                  <div className="px-4 py-2.5 text-[12px] font-bold text-rose-600 dark:text-rose-400 border-b border-rose-500/10 flex items-center gap-1.5">
                    <BookOpenText size={13} /> القيد المحاسبي المتولد #{entry.entryNumber}
                  </div>
                  <table className="w-full text-[12px]">
                    <tbody>
                      {entry.lines.map((l, i) => (
                        <tr key={i} className="border-t border-rose-500/5">
                          <td className="px-4 py-1.5 text-slate-600 dark:text-slate-300">
                            {l.debit > 0 ? '' : '\u00A0\u00A0\u00A0\u00A0إلى '} {ACCOUNT_NAMES[l.accountCode] ?? l.accountCode}
                          </td>
                          <td className="px-4 py-1.5 w-28 font-bold">{l.debit > 0 ? fmt(l.debit) : ''}</td>
                          <td className="px-4 py-1.5 w-28 font-bold text-slate-400">{l.credit > 0 ? fmt(l.credit) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null
            })()}

            {/* سجل تدقيق التعديلات — كل تعديل موثق بقيده العاكس */}
            {viewing.editHistory?.length ? (
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] p-4 space-y-1.5">
                <div className="text-[12px] font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                  <History size={13} /> سجل التعديلات ({viewing.editHistory.length})
                </div>
                {viewing.editHistory.map((h, i) => (
                  <div key={i} className="text-[11px] text-slate-500">
                    {h.at.slice(0, 16).replace('T', ' ')} — {h.reason || 'بلا سبب مذكور'} · عُكس القيد #{h.previousEntryId} بالقيد #{h.reversalEntryId}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </Modal>

      {/* ✏️ تعديل فاتورة شراء (سياسة المالك: فقط عندما تكون الفاتورة الإلكترونية غير مفعلة) */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing ? `✏️ تعديل ${editing.invoiceNumber}` : ''} wide>
        {editing && (
          <div className="space-y-4">
            <p className="text-[11.5px] text-slate-400 leading-relaxed p-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
              💡 {editPolicy.reasonAr} يُعكس القيد القديم ويُعاد الترحيل: يسترد المخزون تكلفته الصحيحة وتُعاد قيمة توزيع المصاريف على السطور الجديدة.
            </p>

            <div className="invoice-edit-lines-panel rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="invoice-edit-lines-toolbar flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50"><b className="text-xs">بنود الفاتورة</b><button type="button" aria-label="حذف السطر المحدد" title="اختر سطراً ثم اضغط لحذفه" disabled={selectedEditLine == null || !editLines[selectedEditLine]} onClick={removeSelectedEditLine} className="invoice-lines-delete inline-flex"><Trash2 size={14}/> حذف السطر</button></div>
              <table className="invoice-edit-lines-table w-full text-[13px]">
                <thead>
                  <tr className="text-right text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                    <th className="px-3 py-2">الصنف</th>
                    <th className="px-3 py-2 w-24">الكمية</th>
                    <th className="px-3 py-2 w-28">سعر الشراء ({cur.symbol})</th>
                    <th className="px-3 py-2 w-24">الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {editLines.map((l, i) => (
                    <tr key={i} aria-selected={selectedEditLine === i} onClick={() => setSelectedEditLine(i)} className={`border-b border-slate-50 dark:border-slate-800/50 ${selectedEditLine === i ? 'invoice-line-selected' : ''}`}>
                      <td className="px-3 py-2 font-bold"><span className="ml-2 font-mono text-[10px] text-slate-400" dir="ltr">{items.find((it) => it.id === l.itemId)?.sku || items.find((it) => it.id === l.itemId)?.barcodes?.[0] || l.itemId}</span>{items.find((it) => it.id === l.itemId)?.nameAr ?? '—'}</td>
                      <td className="px-3 py-2">
                        <input value={l.qty} onChange={(e) => setEditLines(editLines.map((x, xi) => (xi === i ? { ...x, qty: e.target.value } : x)))} className={inputCls + ' !py-1.5 !text-[12px]'} dir="ltr" />
                      </td>
                      <td className="px-3 py-2">
                        <input value={l.unitPrice} onChange={(e) => setEditLines(editLines.map((x, xi) => (xi === i ? { ...x, unitPrice: e.target.value } : x)))} className={inputCls + ' !py-1.5 !text-[12px]'} dir="ltr" />
                      </td>
                      <td className="px-3 py-2 font-bold text-emerald-600">{fmt(Math.round((Number(l.qty) || 0) * toMinor(l.unitPrice || '0', cur.decimals)))}</td>

                    </tr>
                  ))}
                </tbody>
              </table>
              {/* إضافة صنف للفاتورة المعدلة */}
              <div className="flex gap-2 p-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
                <div className="flex-1">
                  <ItemQuickPicker
                    items={items.filter((it) => it.isActive && !editLines.some((l) => l.itemId === it.id))}
                    onPick={setEditAddItemId}
onEdit={(id) => goTo(`/inventory/items?edit=${id}`)}
                        onMovement={(id) => goTo(`/inventory/items?card=${id}`)}
                        onPrices={(id) => goTo(`/sales/price-lists?item=${id}`)}
                    placeholder="اكتب صنفاً ثم اختر بالسهم + Enter أو مرتين"
                  />
                </div>
                <Btn
                  variant="ghost" className="border border-slate-200 dark:border-slate-700 !py-1.5"
                  disabled={!editAddItemId}
                  onClick={() => {
                    setEditLines([...editLines, { itemId: editAddItemId, qty: '1', unitPrice: '' }])
                    setEditAddItemId(0)
                  }}
                >
                  + إضافة
                </Btn>
              </div>
            </div>

            {editExpenses.length > 0 && (
              <div className="grid sm:grid-cols-2 gap-3 p-3 rounded-xl bg-slate-500/5 border border-slate-200 dark:border-slate-700">
                {editExpenses.map((expense, i) => (
                  <Field key={`${expense.nameAr}-${i}`} label={`${expense.nameAr} · ${expense.costTreatment === 'period' ? 'مصروف فترة' : 'تكلفة مخزون'}`} hint={expense.paidBy === 'supplier' ? 'على حساب المورد' : expense.paidBy === 'custody' ? 'من العهدة' : expense.paidBy === 'payable' ? `مستحق لـ ${expense.beneficiaryName ?? 'جهة'}` : 'مدفوع من الخزينة'}>
                    <DecimalInput min="0" value={expense.amountMinor / 10 ** cur.decimals} onValueChange={(value) => setEditExpenses(editExpenses.map((row, xi) => xi === i ? { ...row, amountMinor: toMinor(value, cur.decimals) } : row))} className={inputCls} dir="ltr" />
                    <QuickSelect aria-label="مركز التكلفة العام لمصروف الشراء" value={expense.costCenterId ?? ''} onChange={(e) => setEditExpenses(editExpenses.map((row, xi) => xi === i ? { ...row, costCenterId: e.target.value ? Number(e.target.value) : null } : row))} className={inputCls}><option value="">بدون مركز عام</option>{costCenters.filter((center) => center.isActive).map((center) => <option key={center.id} value={center.id}>{center.code} — {center.nameAr}</option>)}</QuickSelect>
                  </Field>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={`المدفوع للمورد (${cur.symbol})`} hint="الباقي يبقى ديناً على حساب المورد">
                <input value={editPaid} onChange={(e) => setEditPaid(e.target.value)} className={inputCls} dir="ltr" />
              </Field>
              <Field label="خزينة الدفع">
                <TreasuryPicker value={editTreasury} onChange={setEditTreasury} operation="payment" compact />
              </Field>
              <Field label="رقم فاتورة المورد"><input value={editSupplierInvoiceNumber} onChange={(e)=>setEditSupplierInvoiceNumber(e.target.value)} className={inputCls}/></Field>
              <Field label="رقم أمر الشراء"><input value={editPurchaseOrderNumber} onChange={(e)=>setEditPurchaseOrderNumber(e.target.value)} className={inputCls}/></Field>
              <Field label="تاريخ الاستحقاق"><input type="date" min={editing.date} value={editDueDate} onChange={(e)=>setEditDueDate(e.target.value)} className={inputCls}/></Field>
            </div>
            <Field label="ملاحظات داخلية"><textarea value={editNotes} onChange={(e)=>setEditNotes(e.target.value)} className={inputCls}/></Field>

            <Field label="سبب التعديل" hint="يُحفظ في سجل التدقيق ووصف القيد العاكس">
              <input value={editReason} onChange={(e) => setEditReason(e.target.value)} className={inputCls} placeholder="كمية خاطئة، سعر مورد مصحح…" />
            </Field>

            <div className="flex items-center justify-between p-3 rounded-2xl bg-emerald-500/5 border border-emerald-500/20">
              <div className="text-[12px] text-slate-500">
                بضاعة جديدة {fmt(editGoodsTotal)} + مصاريف {fmt(editExpenseTotal)} — كان الإجمالي {fmt(editing.grandTotalMinor)}
              </div>
              <div className="font-black text-xl text-emerald-600">{fmt(editGoodsTotal + editExpenseTotal)} {cur.symbol}</div>
            </div>

            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setEditing(null)}>إلغاء</Btn>
              <Btn onClick={saveInvoiceEdit} shortcut="F9" disabled={!editReason.trim() || !editLines.length || editLines.some((l) => !(Number(l.qty) > 0))}>💾 حفظ التعديل</Btn>
            </div>
          </div>
        )}
      </Modal>
      {editApproval.dialog}

      {/* اختيار قالب طباعة فاتورة الشراء (حراري/A4/A5) */}
      <PrintTemplateModal
        open={printTarget != null}
        onClose={() => setPrintTarget(null)}
        defaultTemplate={receipt.defaultTemplate}
        title="🖨️ طباعة فاتورة الشراء"
        onPrint={(t) => { if (printTarget) printPurchase(printTarget, t) }}
      />
    </div>
  )
}
