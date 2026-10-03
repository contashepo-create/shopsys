import { PartyQuickPicker, QuickSelect } from '../components/KeyboardPickers.tsx'
import { documentKindLabel } from '../../core/openPartyDocuments.ts'
import { COMMON_FX_CURRENCIES, convertFxToBookMinor, describeFxLeg, formatRate, parseRateToPpm, validateFxLeg, type FxLeg } from '../../core/foreignCurrency.ts'
/**
 * سندات القبض والصرف (المرحلة 4) —
 * قبض: نقدية داخلة (سداد عميل، إيراد آخر، رأس مال…)
 * صرف: نقدية خارجة (سداد مورد، مصروف، مسحوبات…)
 * كل سند يولّد قيده المتوازن فوراً ويظهر في اليومية.
 */
import { useMemo, useState } from 'react'
import { ArrowDownCircle, ArrowUpCircle, BookOpenText, CheckCircle2, Eye, FileSpreadsheet, FileText, Landmark, Paperclip, Pencil, Printer, ReceiptText, Save, Search, Stamp, Undo2, WalletCards, X } from 'lucide-react'
import { useDataStore, type Voucher } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { amountInWords } from '../print/printInvoiceA4.ts'
import type { TreasuryAccount } from '../../core/accounting.ts'
import { Btn, Modal, Field, inputCls, useToast, EmptyState } from '../components/ui.tsx'
import { useSupervisorApproval } from '../components/SupervisorPinDialog.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'
import { type TerminalPaymentDraft } from '../components/TerminalPaymentPicker.tsx'
import { PaymentMethodPicker } from '../components/PaymentMethodPicker.tsx'
import { ACCOUNT_NAMES } from './accountNames.ts'
import { customerStatement, supplierStatement, customerUnitDocs, supplierUnitDocs, statementBalance } from '../../core/statements.ts'
import { printHtml } from '../print/printReceipt.ts'
import { ACCOUNT_MODULE_MAP } from '../../core/coaVisibility.ts'

/** الحسابات المقابلة المتاحة لكل نوع سند — بلغة التاجر */
const RECEIPT_COUNTERS = [
  { code: '1104', label: 'سداد من عميل (تخفيض مديونيته)' },
  { code: '4103', label: 'إيراد خدمات' },
  { code: '3101', label: 'زيادة رأس المال' },
  { code: '4101', label: 'إيراد مبيعات (بدون فاتورة)' },
]
/** كود خاص: مصروف على فاتورة شراء — يوزَّع على أصنافها ويرفع تكلفتها (طلب المالك) */
const PURCHASE_EXPENSE_CODE = '__purchase_expense__'
const VEHICLE_COST_CATEGORIES = [
  ['maintenance', 'صيانة'],
  ['fuel', 'وقود'],
  ['parts', 'قطع غيار'],
  ['tolls', 'نولون/رسوم طريق'],
  ['other', 'أخرى'],
] as const
const PAYMENT_COUNTERS = [
  { code: '2101', label: 'سداد لمورد (تخفيض ديننا له)' },
  { code: PURCHASE_EXPENSE_CODE, label: 'مصروف على فاتورة شراء (نولون/جمارك… يرفع تكلفة أصنافها)' },
  { code: '5103', label: 'إيجار المحل' },
  { code: '5104', label: 'كهرباء ومياه' },
  // سداد مسير مرحّل «استحقاقاً» يصفّي 2104 — أما 5102 فلأجور يومية عارضة لم تدخل مسيراً
  { code: '2104', label: 'سداد رواتب مستحقة (مسير استحقاق سابق)' },
  { code: '2117', label: 'سداد مصروفات تصنيع مستحقة (تعبئة/تشغيل…)' },
  { code: '5102', label: 'أجور يومية عارضة جديدة (غير مثبتة سابقاً)' },
  { code: '5108', label: 'مصروفات عمومية' },
  { code: '3101', label: 'مسحوبات شخصية (تخفيض رأس المال)' },
]

const escapePrintText = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

export function VouchersPage() {
  const { vouchers, journal, treasuries, paymentTerminals, customers, suppliers, purchases, customAccounts, addCustomAccount, postVoucher, reverseVoucher, addLatePurchaseExpense, getOpenClientInvoices, getOpenSupplierInvoices, sales, saleReturns, cheques, purchaseReturns, clientSettlements, openingBalances, trips, tickets, rentalContracts , clinicVisits, clinicCollections, clinicPatients, labOrders, labPatients, walletOps, projectExtracts, projects, costCenters, installmentPlans, assets, getAssetDue, laundryOrders, cars, consignmentCars, carPurchaseInvoices, carPrepCosts, propertySales, projectCosts, vehicles , employees, getEmployeeBalance, getUnpaidPayrollSlips, payrollSlips } = useDataStore()
  const nameOf = (code: string) => treasuries.find((t) => t.code === code)?.nameAr ?? ACCOUNT_NAMES[code] ?? code
  const { setup, receipt } = useAppStore()
  const toast = useToast()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)

  const [open, setOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [kind, setKind] = useState<'receipt' | 'payment'>('receipt')
  const [treasury, setTreasury] = useState<TreasuryAccount>('1101')
  const [terminalPayment, setTerminalPayment] = useState<TerminalPaymentDraft>({ terminalId: '', providerReference: '', cardLast4: '' })
  const [counter, setCounter] = useState('')
  const [amount, setAmount] = useState('')
  /* العملة الثانية داخل السند: يُدخل المبلغ الأجنبي وسعر الصرف، والمرحَّل حاصل التحويل بعملة الدفتر */
  const [fxOn, setFxOn] = useState(false)
  const [fxCode, setFxCode] = useState('USD')
  const [fxAmount, setFxAmount] = useState('')
  const [fxRate, setFxRate] = useState('')
  const [voucherDate, setVoucherDate] = useState(new Date().toISOString().slice(0, 10))
  const [desc, setDesc] = useState('')
  const [quickAccountOpen, setQuickAccountOpen] = useState(false)
  const [quickAccountCode, setQuickAccountCode] = useState('')
  const [quickAccountName, setQuickAccountName] = useState('')
  const [employeePartyId, setEmployeePartyId] = useState(0)
  /* سداد قسائم رواتب محددة من السند (طلب المالك ㉘): كل قسيمة تُسدَّد باسمها
     فلا يختلط راتب موظف صُرف اليوم بآخر يُصرف غداً */
  const [settleSlipIds, setSettleSlipIds] = useState<number[]>([])
  const isPayrollSettlement = kind === 'payment' && counter === '2104'
  const unpaidSlips = useMemo(
    () => (isPayrollSettlement && employeePartyId ? getUnpaidPayrollSlips(employeePartyId) : []),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- vouchers/payrollSlips محفز بيانات متجر: الدالة ثابتة الهوية وتقرأهما داخلياً وإسقاطهما يجمّد القسائم
    [isPayrollSettlement, employeePartyId, getUnpaidPayrollSlips, vouchers, payrollSlips],
  )
  /* §97: تصفير القسائم المختارة عند تغير الطرف/النوع بنمط «التعديل أثناء التصيير»
     (كان أثراً يضع الحالة تزامنياً — تتالي تصييرات بلا داعٍ) */
  const partyKey = `${kind}|${counter}|${employeePartyId}`
  const [prevPartyKey, setPrevPartyKey] = useState('')
  if (prevPartyKey !== partyKey) { setPrevPartyKey(partyKey); setSettleSlipIds([]) }
  const toggleSlip = (id: number) =>
    setSettleSlipIds((ids) => (ids.includes(id) ? ids.filter((row) => row !== id) : [...ids, id]))
  const settledTotalMinor = unpaidSlips.filter((s) => settleSlipIds.includes(s.id)).reduce((sum, s) => sum + s.netMinor, 0)
  const selectAllSlips = () => {
    const ids = unpaidSlips.map((s) => s.id)
    setSettleSlipIds(ids)
    if (ids.length) setAmount(String(unpaidSlips.reduce((sum, s) => sum + s.netMinor, 0) / 10 ** cur.decimals))
  }
  const [partyId, setPartyId] = useState(0) // العميل (قبض 1104) أو المورد (صرف 2101) — يغذي كشف الحساب
  const [purchaseId, setPurchaseId] = useState(0) // فاتورة الشراء عند «مصروف على فاتورة شراء»
  const [expMethod, setExpMethod] = useState<'value' | 'qty'>('qty') // توزيع مصروف الفاتورة
  const [expPaidBy, setExpPaidBy] = useState<'treasury' | 'payable'>('treasury')
  const [expBeneficiary, setExpBeneficiary] = useState('')
  const [expPayableAccount, setExpPayableAccount] = useState('2117')
  const [vehicleId, setVehicleId] = useState<number | null>(null)
  const [costCenterId, setCostCenterId] = useState<number | null>(null)
  /* §95 (محاذاة pro-acc): ربط المشروع بالسند — إسناد تحليلي؛ الرصيد ينزل من الطرف أياً كان */
  const [voucherProjectId, setVoucherProjectId] = useState<number | null>(null)
  const [vehicleCostCategory, setVehicleCostCategory] = useState('maintenance')
  const [allocationDraft, setAllocationDraft] = useState<Record<string, string>>({})
  const [viewing, setViewing] = useState<Voucher | null>(null)
  const [reverseTarget, setReverseTarget] = useState<Voucher | null>(null)
  const [reverseReason, setReverseReason] = useState('')

  const entry = viewing ? journal.find((e) => e.id === viewing.journalEntryId) : null
  const reverseApproval = useSupervisorApproval('acc.journal.reverse')
  // ربط الشجرة المفتوحة بالسندات (طلب المالك): حساب إيراد مخصص يظهر في القبض،
  // وحساب مصروف مخصص يظهر في الصرف — ويُعالج بقيد سليم فور اختياره
  const counters = useMemo(() => {
    // فلترة حسب النشاط (أمر المالك): «إيراد مبيعات بدون فاتورة» لا يظهر لنشاط بلا بيع،
    // و«مصروف على فاتورة شراء» لا يظهر لنشاط بلا وحدة مشتريات
    const allowed = (code: string): boolean => {
      if (code === PURCHASE_EXPENSE_CODE) return setup.modules.includes('purchases')
      const req = ACCOUNT_MODULE_MAP[code]
      return !req || req.some((m) => setup.modules.includes(m))
    }
    if (kind === 'receipt') {
      return [
        ...RECEIPT_COUNTERS.filter((c) => allowed(c.code)),
        ...customAccounts.filter((a) => a.rootType === 'revenue').map((a) => ({ code: a.code, label: `${a.nameAr} (حساب مخصص)` })),
      ]
    }
    return [
      ...PAYMENT_COUNTERS.filter((c) => allowed(c.code)),
      ...customAccounts.filter((a) => a.rootType === 'expenses').map((a) => ({ code: a.code, label: `${a.nameAr} (حساب مخصص)` })),
    ]
  }, [kind, customAccounts, setup.modules])
  const [filterFrom,setFilterFrom]=useState(''),[filterTo,setFilterTo]=useState(''),[filterQuery,setFilterQuery]=useState('')
  const listed = useMemo(() => {const q=filterQuery.trim().toLowerCase();return [...vouchers].filter((v) => v.kind !== 'transfer'&&(!filterFrom||v.date.slice(0,10)>=filterFrom)&&(!filterTo||v.date.slice(0,10)<=filterTo)&&(!q||v.voucherNumber.toLowerCase().includes(q)||v.description.toLowerCase().includes(q))).reverse()}, [vouchers,filterFrom,filterTo,filterQuery])

  /** الرصيد الحي للطرف المختار (أمر التعديل: يظهر تحت العميل/المورد قبل الحفظ) */
  const liveBalance = useMemo(() => {
    if (!partyId) return null
    if (kind === 'receipt') {
      return statementBalance(customerStatement({
        customerId: partyId,
        openingMinor: openingBalances[`customer:${partyId}`] ?? 0,
        sales, saleReturns, allSales: sales,
        extraDocs: customerUnitDocs({ customerId: partyId, trips, tickets, rentals: rentalContracts, clinicVisits, clinicCollections, linkedPatientIds: clinicPatients.filter((p) => p.linkedCustomerId === partyId).map((p) => p.id), labOrders, linkedLabPatientIds: labPatients.filter((p) => p.linkedCustomerId === partyId).map((p) => p.id), walletOps, projectExtracts, linkedProjectIds: projects.filter((p) => p.clientId === partyId).map((p) => p.id), installmentPlans, laundryOrders, cars, consignmentCars, propertySales }),
        vouchers: [
          ...vouchers,
          ...clientSettlements.map((st) => ({ voucherNumber: st.settlementNumber, kind: 'receipt', date: st.date, partyKind: 'customer', partyId: st.customerId, amountMinor: st.amountMinor })),
        ],
        cheques,
      }))
    }
    return statementBalance(supplierStatement({
      supplierId: partyId,
      openingMinor: openingBalances[`supplier:${partyId}`] ?? 0,
      purchases, purchaseReturns, allPurchases: purchases, vouchers, cheques,
      extraDocs: supplierUnitDocs({ supplierId: partyId, cars, carPurchaseInvoices, carPrepCosts, projectCosts, carLabel: (carId) => { const car = cars.find((row) => row.id === carId); return car ? `${car.make} ${car.model} (${car.plateOrVin})` : `سيارة #${carId}` }, entryDate: (entryId) => journal.find((row) => row.id === entryId)?.date ?? '0000-00-00' }),
    }))
  }, [partyId, kind, sales, saleReturns, vouchers, cheques, purchases, purchaseReturns, clientSettlements, openingBalances, trips, tickets, rentalContracts, clinicVisits, clinicCollections, clinicPatients, labOrders, labPatients, walletOps, projectExtracts, projects, installmentPlans, laundryOrders, cars, consignmentCars, carPurchaseInvoices, carPrepCosts, propertySales, projectCosts, journal])

  const clearDraft = (voucherKind: 'receipt' | 'payment') => {
    try { window.localStorage.removeItem(`shopsys.voucher-draft.${voucherKind}`) } catch { /* التخزين المحلي اختياري */ }
  }

  const openNew = (k: 'receipt' | 'payment') => {
    setKind(k)
    setTreasury('1101')
    setTerminalPayment({ terminalId: '', providerReference: '', cardLast4: '' })
    setCounter('')
    setAmount('')
    setVoucherDate(new Date().toISOString().slice(0, 10))
    setDesc('')
    setPartyId(0)
    setPurchaseId(0)
    setExpMethod('qty')
    setExpPaidBy('treasury')
    setExpBeneficiary('')
    setExpPayableAccount('2117')
    setVehicleId(null)
    setCostCenterId(null)
    setVehicleCostCategory('maintenance')
    setAllocationDraft({})
    setPreviewOpen(false)
    try {
      const raw = window.localStorage.getItem(`shopsys.voucher-draft.${k}`)
      if (raw) {
        const draft = JSON.parse(raw) as Partial<{
          treasury: TreasuryAccount
          terminalPayment: TerminalPaymentDraft
          counter: string
          amount: string
          voucherDate: string
          desc: string
          partyId: number
          purchaseId: number
          expMethod: 'value' | 'qty'
          expPaidBy: 'treasury' | 'payable'
          expBeneficiary: string
          expPayableAccount: string
          vehicleId: number | null
          costCenterId: number | null
          voucherProjectId: number | null
          vehicleCostCategory: string
          allocationDraft: Record<string, string>
        }>
        setTreasury(draft.treasury ?? '1101')
        setTerminalPayment(draft.terminalPayment ?? { terminalId: '', providerReference: '', cardLast4: '' })
        setCounter(draft.counter ?? '')
        setAmount(draft.amount ?? '')
        setVoucherDate(draft.voucherDate ?? new Date().toISOString().slice(0, 10))
        setDesc(draft.desc ?? '')
        setPartyId(draft.partyId ?? 0)
        setPurchaseId(draft.purchaseId ?? 0)
        setExpMethod(draft.expMethod ?? 'qty')
        setExpPaidBy(draft.expPaidBy ?? 'treasury')
        setExpBeneficiary(draft.expBeneficiary ?? '')
        setExpPayableAccount(draft.expPayableAccount ?? '2117')
        setVehicleId(draft.vehicleId ?? null)
        setCostCenterId(draft.costCenterId ?? null)
        setVoucherProjectId(draft.voucherProjectId ?? null)
        setVehicleCostCategory(draft.vehicleCostCategory ?? 'maintenance')
        setAllocationDraft(draft.allocationDraft ?? {})
        toast.show('استُعيدت آخر مسودة لهذا النوع من السندات ✓')
      }
    } catch {
      clearDraft(k)
    }
    setOpen(true)
  }

  // سداد عميل (1104) في القبض أو سداد مورد (2101) في الصرف ⇒ نطلب تحديد الطرف
  const needsParty = (kind === 'receipt' && counter === '1104') || (kind === 'payment' && counter === '2101')
  /* الموظف طرف كامل (طلب المالك): سلفة/راتب في الصرف واسترداد في القبض
     تُسجَّل باسمه فتظهر في حسابه وكشفه مثل العميل تماماً. */
  const needsEmployee = counter === '1107' || (kind === 'payment' && counter === '2104')
  const employeeLabel = counter === '2104' ? 'الموظف صاحب الراتب' : kind === 'payment' ? 'الموظف المستلم للسلفة' : 'الموظف المسدِّد'
  const partyInvoices = !needsParty || partyId <= 0
    ? []
    : kind === 'receipt' ? getOpenClientInvoices(partyId) : getOpenSupplierInvoices(partyId)
  const employeeOptions = employees.filter((employee) => employee.active !== false)
  const parseAllocationAmount = (value: string) => {
    try { return toMinor(value.replaceAll(',', ''), cur.decimals) } catch { return 0 }
  }
  const hasManualAllocation = Object.values(allocationDraft).some((value) => value.trim() !== '')
  const manualAllocations = hasManualAllocation
    ? partyInvoices.flatMap((invoice) => {
        const amount = parseAllocationAmount(allocationDraft[invoice.docKey] || '')
        return Number.isInteger(amount) && amount > 0 ? [{ docKey: invoice.docKey, docLabel: invoice.docLabel, appliedMinor: amount }] : []
      })
    : undefined
  const manualAllocatedMinor = manualAllocations?.reduce((sum, allocation) => sum + allocation.appliedMinor, 0) ?? 0
  const isPurchaseExpense = kind === 'payment' && counter === PURCHASE_EXPENSE_CODE
  const isCustomExpense = kind === 'payment' && customAccounts.some((account) => account.code === counter && account.rootType === 'expenses')
  const selectedTerminal = terminalPayment.terminalId ? paymentTerminals.find((terminal) => terminal.id === terminalPayment.terminalId) : undefined
  // ربط السيارة خاص بمصروفات التشغيل/المصروفات المستحقة فقط، وليس بسداد
  // مورد أو راتب أو مسحوبات. مصروف فاتورة الشراء له حقله المستقل أدناه.
  const canLinkVehicle = kind === 'payment' && !isPurchaseExpense && (counter === '5108' || counter === '2117' || isCustomExpense)
  const canLinkCostCenter = kind === 'payment' && !isPurchaseExpense && (counter.startsWith('5') || isCustomExpense)
  const manualAmountMinor = (() => { try { return toMinor(amount || '0', cur.decimals) } catch { return 0 } })()
  /* ساق العملة الأجنبية: المبلغ بعملة الدفتر يُشتق من (المبلغ الأجنبي × سعر الصرف) فلا يختلف المعروض عن المرحَّل */
  const fxDecimals = (COMMON_FX_CURRENCIES.find((row) => row.code === fxCode)?.decimals ?? 2) as 0 | 2 | 3
  const fxLeg: FxLeg = {
    currencyCode: fxCode.trim().toUpperCase(),
    amountMinor: (() => { try { return toMinor(fxAmount || '0', fxDecimals) } catch { return 0 } })(),
    ratePpm: parseRateToPpm(fxRate),
    decimals: fxDecimals,
  }
  const fxErrors = fxOn ? validateFxLeg(fxLeg, cur.code) : []
  const fxBookMinor = fxOn && fxErrors.length === 0 ? convertFxToBookMinor(fxLeg, cur.decimals) : 0
  const parsedAmountMinor = fxOn ? fxBookMinor : manualAmountMinor
  const selectedPartyName = needsParty && partyId > 0
    ? (kind === 'receipt' ? customers.find((customer) => customer.id === partyId)?.nameAr : suppliers.find((supplier) => supplier.id === partyId)?.nameAr) ?? ''
    : ''
  const saveDraft = () => {
    try {
      window.localStorage.setItem(`shopsys.voucher-draft.${kind}`, JSON.stringify({
        treasury, terminalPayment, counter, amount, voucherDate, desc, partyId, purchaseId, expMethod, expPaidBy,
        expBeneficiary, expPayableAccount, vehicleId, costCenterId, vehicleCostCategory, allocationDraft, voucherProjectId,
      }))
      toast.show(`حُفظت مسودة سند ${kind === 'receipt' ? 'القبض' : 'الصرف'} محلياً ✓`)
    } catch {
      toast.show('تعذر حفظ المسودة على هذا الجهاز', 'error')
    }
  }
  const printDraft = () => {
    const title = kind === 'receipt' ? 'سند قبض نقدية' : 'سند صرف نقدية'
    const amountText = parsedAmountMinor > 0 ? `${fmt(parsedAmountMinor)} ${cur.symbol}` : '—'
    printHtml(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${escapePrintText(title)}</title><style>body{font-family:Arial,sans-serif;color:#0f172a;padding:28px;max-width:760px;margin:auto}h1{border-bottom:3px solid #0f172a;padding-bottom:12px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:10px;background:#f8fafc;padding:14px;margin:16px 0}.amount{font-size:30px;font-weight:800;color:#0f172a;margin:22px 0}.label{color:#64748b;font-size:12px}.value{font-weight:700}p{line-height:1.8}</style></head><body><h1>${escapePrintText(title)}</h1><div class="meta"><div><div class="label">المنشأة</div><div class="value">${escapePrintText(setup.shopName || 'نظام الحسابات')}</div></div><div><div class="label">التاريخ</div><div class="value">${escapePrintText(voucherDate)}</div></div><div><div class="label">الطرف</div><div class="value">${escapePrintText(selectedPartyName || 'غير مرتبط بطرف')}</div></div><div><div class="label">الحساب المقابل</div><div class="value">${escapePrintText(counters.find((item) => item.code === counter)?.label ?? '—')}</div></div></div><div class="amount">${escapePrintText(amountText)}</div><p><b>البيان:</b> ${escapePrintText(desc || '—')}</p><p><b>الحالة:</b> مسودة قبل الترحيل</p></body></html>`)
  }
  const focusVoucherForEdit = () => {
    document.querySelector<HTMLInputElement>('[data-voucher-amount]')?.focus()
    toast.show('النموذج مفتوح في وضع التعديل؛ راجع الحقول ثم رحّل السند')
  }

  // خروج النقدية (سند صرف) عملية حساسة — اعتماد مشرف؛ القبض إدخال أموال يمر مباشرة
  const paymentApproval = useSupervisorApproval('trs.payment.approve')
  const addQuickAccount = () => {
    try {
      const account = addCustomAccount({ code: quickAccountCode.trim(), nameAr: quickAccountName.trim(), parentCode: kind === 'payment' ? '5' : '4' })
      setCounter(account.code); setQuickAccountOpen(false); setQuickAccountCode(''); setQuickAccountName('')
      toast.show(`أُضيف الحساب «${account.nameAr}» إلى شجرة الحسابات واختير للسند ✓`)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }
  const save = () => {
    if (kind === 'payment' && !(isPurchaseExpense && expPaidBy === 'payable')) { paymentApproval.request(() => doSave()); return }
    doSave()
  }
  const confirmReverse = () => {
    if (!reverseTarget || !reverseReason.trim()) {
      toast.show('اكتب سبب العكس قبل الاعتماد', 'error')
      return
    }
    reverseApproval.request(() => {
      try {
        const reversed = reverseVoucher(reverseTarget.id, reverseReason.trim())
        setViewing(reversed)
        setReverseTarget(null)
        setReverseReason('')
        toast.show(`تم عكس السند ${reversed.voucherNumber} بقيد عاكس #${reversed.reversalEntryId} ✓`)
      } catch (e) {
        toast.show((e as Error).message, 'error')
      }
    })
  }
  const doSave = () => {
    try {
      if (needsEmployee && !employeePartyId) throw new Error('اختر الموظف صاحب الحركة')
      if (needsParty && !partyId) throw new Error(kind === 'receipt' ? 'اختر العميل الذي سدد' : 'اختر المورد المسدد له')
      // مصروف على فاتورة شراء: يذهب لمحرك Landed Cost لا لسند عادي —
      // يوزَّع على أصنافها ويرفع تكلفتها ويتولد قيده (دائن الخزينة المختارة)
      if (isPurchaseExpense) {
        if (!purchaseId) throw new Error('اختر فاتورة الشراء')
        if (!desc.trim()) throw new Error('اكتب بيان المصروف (نولون، جمارك…)')
        const updated = addLatePurchaseExpense({
          purchaseId,
          nameAr: desc.trim(),
          amountMinor: toMinor(amount || '0', cur.decimals),
          method: expMethod,
          paidBy: expPaidBy,
          payAccount: expPaidBy === 'treasury' ? treasury : null,
          beneficiaryName: expPaidBy === 'payable' ? expBeneficiary.trim() : null,
          payableAccountCode: expPaidBy === 'payable' ? expPayableAccount : null,
          costCenterId,
          vehicleId,
          category: vehicleId != null ? vehicleCostCategory : undefined,
          date: voucherDate,
        })
        toast.show(`سُجّل المصروف على الفاتورة ${updated.invoiceNumber} — توزع على أصنافها وتحدثت تكلفتها ✓`)
        clearDraft(kind)
        setOpen(false)
        return
      }
      const v = postVoucher({
        kind,
        treasury: selectedTerminal?.settlementAccountCode ?? treasury,
        counterAccountCode: counter,
        amountMinor: parsedAmountMinor,
        description: desc.trim(),
        date: voucherDate,
        fx: fxOn ? fxLeg : undefined,
        bookDecimals: cur.decimals,
        bookCurrencyCode: cur.code,
        partyKind: needsEmployee ? 'employee' : needsParty ? (kind === 'receipt' ? 'customer' : 'supplier') : null,
        partyId: needsEmployee ? (employeePartyId || null) : needsParty ? partyId : null,
        allocations: manualAllocations,
        costCenterId: canLinkCostCenter ? costCenterId : null,
        vehicleId: canLinkVehicle ? vehicleId : null,
        projectId: voucherProjectId,
        vehicleCostCategory: canLinkVehicle && vehicleId != null ? vehicleCostCategory : undefined,
        terminalPayment: kind === 'receipt' && selectedTerminal ? { terminalId: selectedTerminal.id, providerReference: terminalPayment.providerReference.trim(), cardLast4: terminalPayment.cardLast4 || undefined } : undefined,
        settleSlipIds: isPayrollSettlement && settleSlipIds.length ? settleSlipIds : undefined,
      })
      toast.show(`تم ${kind === 'receipt' ? 'سند القبض' : 'سند الصرف'} ${v.voucherNumber} — تولد قيده تلقائياً ✓${settleSlipIds.length ? ` · سُدِّدت ${settleSlipIds.length} قسيمة رواتب` : ''}`)
      clearDraft(kind)
      setOpen(false)
    } catch (e) {
      toast.show((e as Error).message, 'error')
    }
  }

  const exportVouchers = () => {
    const rows = [['الرقم','التاريخ','النوع','الخزينة','الحساب المقابل','البيان','المبلغ'],...listed.map(v=>[v.voucherNumber,v.date.slice(0,10),v.kind==='receipt'?'قبض':'صرف',v.treasury,nameOf(v.counterAccountCode),v.description,fmt(v.amountMinor)])]
    const csv='\ufeff'+rows.map(r=>r.map(x=>`"${String(x).replaceAll('"','""')}"`).join(',')).join('\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='vouchers.csv';a.click();URL.revokeObjectURL(url)
  }
  const printVouchers = () => printHtml(`<html dir="rtl"><head><meta charset="utf-8"><style>body{font-family:Arial;padding:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #bbb;padding:6px}</style></head><body><h2>سجل سندات القبض والصرف</h2><table><tr><th>الرقم</th><th>التاريخ</th><th>النوع</th><th>البيان</th><th>المبلغ</th></tr>${listed.map(v=>`<tr><td>${v.voucherNumber}</td><td>${v.date.slice(0,10)}</td><td>${v.kind==='receipt'?'قبض':'صرف'}</td><td>${v.description}</td><td>${fmt(v.amountMinor)}</td></tr>`).join('')}</table></body></html>`)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between anim-up flex-wrap gap-2">
        <div className="text-sm text-slate-500">كل سند يولّد قيداً متوازناً فوراً — لا نقدية تتحرك خارج الدفاتر</div>
        <div className="flex gap-2"><Btn variant="ghost" onClick={exportVouchers} disabled={!listed.length}><FileSpreadsheet size={14}/> Excel</Btn><Btn variant="ghost" onClick={printVouchers} disabled={!listed.length}><Printer size={14}/> طباعة</Btn>
          <Btn onClick={() => openNew('receipt')}><ArrowDownCircle size={15} /> سند قبض</Btn>
          <Btn variant="ghost" onClick={() => openNew('payment')} className="!text-rose-600 border-2 border-rose-500/30 hover:!bg-rose-500/5">
            <ArrowUpCircle size={15} /> سند صرف
          </Btn>
        </div>
      </div>

      <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-[11px] leading-6 text-slate-600 dark:text-slate-300">
        المصروف المضاف على فاتورة باختيار «مستحق لاحقاً» يثبت التكلفة والاستحقاق فقط ولا يُعد سند صرف حتى تخرج النقدية فعلياً. عند السداد من قسم الاستحقاقات يُنشأ سند صرف PV تلقائياً ويظهر هنا مرتبطاً بالفاتورة.
      </div>
      <div className="grid sm:grid-cols-3 gap-2 rounded-xl border p-2 bg-white dark:bg-card-dark">
        <input className={inputCls} value={filterQuery} onChange={(e) => setFilterQuery(e.target.value)} placeholder="بحث بالرقم أو البيان" />
        <input type="date" className={inputCls} value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
        <input type="date" className={inputCls} value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
      </div>

      {listed.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
          <EmptyState icon="🧾" title="لا سندات بعد" sub="سجّل قبض النقدية وصرفها من هنا: سداد عميل، سداد مورد، إيجار، كهرباء…" />
        </div>
      ) : (
        <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right text-[11px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <th className="px-4 py-3 font-bold">السند</th>
                <th className="px-4 py-3 font-bold">النوع</th>
                <th className="px-4 py-3 font-bold">الخزينة</th>
                <th className="px-4 py-3 font-bold">الحساب المقابل</th>
                <th className="px-4 py-3 font-bold">المبلغ</th>
                <th className="px-4 py-3 font-bold">القيد</th>
              </tr>
            </thead>
            <tbody>
              {listed.map((v, i) => (
                <tr
                  key={v.id}
                  style={{ animationDelay: `${i * 25}ms` }}
                  onClick={() => setViewing(v)}
                  className="anim-in border-b border-slate-50 dark:border-slate-800/50 hover:bg-rose-500/[0.02] transition-colors cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <div className="font-bold text-slate-800 dark:text-white">{v.voucherNumber}</div>
                    <div className="text-[11px] text-slate-400">{v.date.slice(0, 16).replace('T', ' ')}{v.description && ` · ${v.description}`}</div>
                    {v.purchaseExpensePayableId && <div className="text-[10px] font-bold text-violet-600">سداد استحقاق مصروف على فاتورة شراء</div>}
                    {v.reversalEntryId && <div className="text-[10px] font-bold text-amber-600">معكوس بقيد #{v.reversalEntryId}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${v.kind === 'receipt' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-600'}`}>
                      {v.kind === 'receipt' ? '⬇️ قبض' : '⬆️ صرف'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-[12px]">{nameOf(v.treasury)}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300 text-[12px]">{nameOf(v.counterAccountCode)}</td>
                  <td className={`px-4 py-3 font-black ${v.kind === 'receipt' ? 'text-emerald-600' : 'text-rose-500'}`}>
                    {v.kind === 'receipt' ? '+' : '-'}{fmt(v.amountMinor)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 font-bold flex items-center gap-1 w-fit">
                      <BookOpenText size={11} /> #{v.journalEntryId}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* سند جديد — نافذة تشغيلية واسعة مستوحاة من شاشة السند المرجعية */}
      <Modal open={open} onClose={() => setOpen(false)} title="" extraWide bare>
        <div className="overflow-hidden rounded-3xl doc-sheet" dir="rtl">
          <div className="flex items-center justify-between gap-4 doc-head px-5 py-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${kind === 'receipt' ? 'bg-emerald-400/20 text-emerald-200' : 'bg-rose-400/20 text-rose-200'}`}>
                {kind === 'receipt' ? <ArrowDownCircle size={24} /> : <ArrowUpCircle size={24} />}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold">{kind === 'receipt' ? 'سند قبض نقدية' : isPurchaseExpense && expPaidBy === 'payable' ? 'إثبات مصروف مستحق' : 'سند صرف نقدية'}</h2>
                  <span className="text-[10px] uppercase tracking-wider text-[#a9c7ff]">{kind === 'receipt' ? 'Receipt Voucher' : 'Payment Voucher'}</span>
                  <span className="rounded bg-white/10 px-2 py-0.5 font-mono text-[11px]">{kind === 'receipt' ? 'RV' : 'PV'} — جديد</span>
                </div>
                <p className="mt-0.5 truncate text-[11px] doc-head-sub">{setup.shopName || 'نظام الحسابات'} · سند مرتبط آلياً باليومية وكشف الطرف</p>
              </div>
            </div>
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
              <button type="button" onClick={printDraft} title="طباعة السند" aria-label="طباعة السند" className="flex items-center gap-1 rounded-lg px-2 py-2 text-[11px] text-white/75 transition hover:bg-white/10 hover:text-white"><Printer size={15} /><span className="hidden sm:inline">طباعة</span></button>
              <button type="button" onClick={() => setPreviewOpen(true)} title="معاينة السند" aria-label="معاينة السند" className="flex items-center gap-1 rounded-lg px-2 py-2 text-[11px] text-white/75 transition hover:bg-white/10 hover:text-white"><Eye size={15} /><span className="hidden sm:inline">معاينة</span></button>
              <button type="button" onClick={saveDraft} title="حفظ كمسودة" aria-label="حفظ كمسودة" className="flex items-center gap-1 rounded-lg px-2 py-2 text-[11px] text-white/75 transition hover:bg-white/10 hover:text-white"><Save size={15} /><span className="hidden sm:inline">حفظ مسودة</span></button>
              <button type="button" onClick={focusVoucherForEdit} title="تعديل السند" aria-label="تعديل السند" className="flex items-center gap-1 rounded-lg px-2 py-2 text-[11px] text-white/75 transition hover:bg-white/10 hover:text-white"><Pencil size={15} /><span className="hidden sm:inline">تعديل السند</span></button>
              <button type="button" onClick={save} disabled={!counter || !amount.trim() || (needsParty && !partyId) || (isPurchaseExpense && (!purchaseId || !desc.trim() || (expPaidBy === 'payable' && !expBeneficiary.trim())))} className="flex items-center gap-1.5 rounded-lg bg-[#6ffbbe] px-2.5 py-2 text-xs font-bold text-[#002113] shadow-sm transition hover:bg-[#4edea3] disabled:cursor-not-allowed disabled:opacity-50 sm:gap-2 sm:px-4">
                <CheckCircle2 size={16} /><span className="hidden sm:inline">حفظ وترحيل السند</span><span className="sm:hidden">ترحيل</span>
              </button>
              <button type="button" onClick={() => setOpen(false)} aria-label="إغلاق" className="rounded-lg p-2 text-white/70 transition hover:bg-rose-500 hover:text-white"><X size={20} /></button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 doc-meta px-5 py-2 text-[10px]">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
              <span className="flex items-center gap-1"><FileText size={14} className="doc-accent" /> المنشأة: <b className="doc-ink">{setup.shopName || 'غير محدد'}</b></span>
              {receipt.headerLines.filter((line) => line.trim()).slice(0, 1).map((line) => <span key={line}>{line}</span>)}
            </div>
            <span className="flex items-center gap-1 font-semibold doc-ink"><CheckCircle2 size={13} className="doc-accent" /> سيُنشأ القيد تلقائياً بعد الترحيل</span>
          </div>

          <div className="max-h-[calc(92vh-7rem)] space-y-4 overflow-y-auto px-5 py-4 sm:px-6">
            <div className="grid grid-cols-12 items-start gap-3 rounded-xl doc-card doc-ring p-4">
              <div className="col-span-12 space-y-2 lg:col-span-5">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-1 text-sm font-bold doc-ink">
                    {kind === 'receipt' ? <WalletCards size={16} className="doc-accent" /> : <Landmark size={16} className="doc-accent" />}
                    {needsParty ? kind === 'receipt' ? 'استلمنا من العميل' : 'يصرف إلى المورد' : kind === 'receipt' ? 'مصدر النقدية والحساب المقابل' : 'وجهة النقدية والحساب المقابل'}
                    {needsParty && <span className="text-rose-600">*</span>}
                  </label>
                  {needsParty && <span className="rounded doc-tint-strong px-2 py-0.5 text-[10px] font-semibold doc-accent-deep">بحث سريع [F3]</span>}
                </div>
                {needsParty ? (
                  <PartyQuickPicker parties={kind === 'receipt' ? customers : suppliers} value={partyId} onChange={(id) => { setPartyId(id); setAllocationDraft({}) }} cashLabel="اختر الطرف" label={kind === 'receipt' ? 'بحث العميل' : 'بحث المورد'} showCash={false} />
                ) : (
                  /* بلاغ المالك: جملة «اختر الحساب المقابل من القائمة» كانت نصاً ميتاً فوق القائمة.
                     صارت الخانة نفسها هي البحث: اكتب أول حرف من اسم الحساب أو كوده فتُفلتر القائمة فوراً. */
                  <div className="relative">
                    <Search size={16} className="pointer-events-none absolute right-2.5 top-1/2 z-10 -translate-y-1/2 doc-faint" />
                    <QuickSelect aria-label="بحث الحساب المقابل" value={counter} onChange={(e) => { setCounter(e.target.value); setPartyId(0); setAllocationDraft({}) }} className="h-10 w-full rounded-lg border doc-line doc-sheet pr-8 text-sm doc-ink outline-none focus:border-[color:var(--doc-accent)]">
                      <option value="">ابحث بالاسم أو الكود ثم Enter…</option>
                      {counters.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
                    </QuickSelect>
                  </div>
                )}
                {/* الموظف طرف كامل (طلب المالك): اختره فتُسجَّل الحركة في حسابه وكشفه */}
                {needsEmployee && (
                  <div className="space-y-1 rounded-lg doc-tint p-2" data-voucher-employee>
                    <label className="text-[11px] font-bold doc-ink">{employeeLabel} *</label>
                    <QuickSelect aria-label="موظف السند" className={inputCls} value={employeePartyId}
                      onChange={(event) => setEmployeePartyId(Number(event.target.value) || 0)}>
                      <option value={0}>اختر الموظف…</option>
                      {employeeOptions.map((employee) => <option key={employee.id} value={employee.id}>{employee.nameAr}{employee.jobTitle ? ` — ${employee.jobTitle}` : ''}</option>)}
                    </QuickSelect>
                    {employeePartyId > 0 && (
                      <div className="flex items-center justify-between text-[11px] font-bold">
                        <span>رصيده الحالي</span>
                        <b className={getEmployeeBalance(employeePartyId) < 0 ? 'text-rose-600' : 'text-emerald-600'} data-employee-balance>
                          {fmt(Math.abs(getEmployeeBalance(employeePartyId)))} {getEmployeeBalance(employeePartyId) < 0 ? '(عليه)' : '(له)'}
                        </b>
                      </div>
                    )}
                    {/* قسائم رواتب غير مصروفة (طلب المالك ㉘): سداد موجه بالاسم والشهر */}
                    {unpaidSlips.length > 0 && (
                      <div className="mt-1 space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2" data-unpaid-slips>
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-black text-amber-700 dark:text-amber-300">قسائم رواتب مستحقة لهذا الموظف</span>
                          <button type="button" className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[10.5px] font-bold text-amber-700 hover:bg-amber-500/25 dark:text-amber-300" onClick={selectAllSlips}>تسديد الكل</button>
                        </div>
                        {unpaidSlips.map((slip) => (
                          <label key={slip.id} className="flex cursor-pointer items-center justify-between gap-2 rounded-md bg-white/60 px-2 py-1 text-[11px] dark:bg-slate-800/60">
                            <span className="flex items-center gap-1.5">
                              <input type="checkbox" checked={settleSlipIds.includes(slip.id)} onChange={() => toggleSlip(slip.id)} className="size-3.5 accent-amber-600" />
                              <b className="font-mono">{slip.slipNumber}</b>
                              <span className="text-slate-500">{slip.month}</span>
                            </span>
                            <b className="font-mono">{fmt(slip.netMinor)} {cur.symbol}</b>
                          </label>
                        ))}
                        {settledTotalMinor > 0 && (
                          <div className="flex items-center justify-between border-t border-amber-500/20 pt-1 text-[11px] font-black text-amber-700 dark:text-amber-300">
                            <span>المحدد للتسديد</span>
                            <span className="font-mono">{fmt(settledTotalMinor)} {cur.symbol}</span>
                          </div>
                        )}
                        <p className="text-[10px] text-slate-500">اختر قسيمة فأكثر ثم اجعل مبلغ السند مساوياً لمجموعها (زر «تسديد الكل» يفعل ذلك) — تُوسم القسائم مصروفة باسم هذا السند.</p>
                      </div>
                    )}
                  </div>
                )}
                {!needsParty && (
                  <div className="flex items-center justify-between rounded-lg doc-tint px-3 py-1.5 text-[11px] font-bold doc-accent-deep">
                    <span>الحساب المختار</span>
                    <span>{counter ? `${counter} — ${counters.find((item) => item.code === counter)?.label ?? ''}` : 'لم يُحدد بعد'}</span>
                  </div>
                )}
                {needsParty && partyId > 0 && liveBalance !== null && (
                  <div className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-[11px] font-bold ${liveBalance > 0 ? 'bg-rose-50 text-rose-700' : liveBalance < 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-600'}`}>
                    <span>الرصيد القائم قبل السند</span>
                    <span>{liveBalance > 0 ? kind === 'receipt' ? `عليه ${fmt(liveBalance)}` : `مستحق له ${fmt(liveBalance)}` : liveBalance < 0 ? kind === 'receipt' ? `له عندك ${fmt(-liveBalance)}` : `لك عنده ${fmt(-liveBalance)}` : 'الرصيد صفر'} {cur.symbol}</span>
                  </div>
                )}
                {!needsParty && <button type="button" onClick={() => setQuickAccountOpen(!quickAccountOpen)} className="text-right text-[11px] font-bold doc-accent hover:underline">+ إضافة بند {kind === 'payment' ? 'مصروف' : 'إيراد'} جديد</button>}
                {quickAccountOpen && <div className="grid grid-cols-[100px_1fr_auto] gap-2 rounded-lg doc-tint p-2"><input className="h-9 rounded border doc-line doc-card px-2 text-xs" value={quickAccountCode} onChange={(e) => setQuickAccountCode(e.target.value)} placeholder={kind === 'payment' ? '51xx' : '41xx'} dir="ltr" /><input className="h-9 rounded border doc-line doc-card px-2 text-xs" value={quickAccountName} onChange={(e) => setQuickAccountName(e.target.value)} placeholder="اسم البند" /><Btn onClick={addQuickAccount} disabled={!quickAccountCode.trim() || !quickAccountName.trim()}>إضافة</Btn></div>}
              </div>

              <div className="col-span-12 space-y-2 rounded-lg doc-tint p-3 lg:col-span-4">
                <div className="flex items-center justify-between text-sm font-bold doc-ink"><span>{kind === 'receipt' ? 'المبلغ الإجمالي المقبوض' : 'قيمة سند الصرف'}</span><span className="rounded doc-band px-2 py-0.5 text-[10px] doc-accent-deep">{cur.code} · {cur.symbol}</span></div>
                <div className="flex items-baseline gap-2 rounded-lg doc-card px-3 py-2 shadow-inner doc-ring">
                  <input data-voucher-amount="true" value={fxOn ? (fxBookMinor ? (fxBookMinor / 10 ** cur.decimals).toFixed(cur.decimals) : '') : amount} onChange={(e) => setAmount(e.target.value)} readOnly={fxOn} title={fxOn ? 'المبلغ محسوب من العملة الأجنبية وسعر الصرف' : undefined} placeholder="0.00" className={`w-full bg-transparent text-left font-mono text-3xl font-bold tracking-tight doc-ink outline-none${fxOn ? ' opacity-80' : ''}`} dir="ltr" inputMode="decimal" autoFocus />
                  <span className="whitespace-nowrap text-sm font-bold doc-muted">{cur.symbol}</span>
                </div>

                {/* ── عملة ثانية داخل السند: الدفتر يبقى بعملته والمرحَّل حاصل التحويل ── */}
                <div className="space-y-2 rounded-lg doc-card doc-ring p-2.5" data-voucher-fx>
                  <label className="flex items-center gap-2 text-[11px] font-bold doc-ink">
                    <input type="checkbox" checked={fxOn} onChange={(event) => { setFxOn(event.target.checked); if (!event.target.checked) { setFxAmount(''); setFxRate('') } }} className="h-4 w-4 accent-[color:var(--doc-accent)]" />
                    {kind === 'receipt' ? 'التحصيل بعملة أجنبية' : 'السداد بعملة أجنبية'}
                  </label>
                  {fxOn && <>
                    <div className="grid grid-cols-3 gap-1.5">
                      <QuickSelect value={fxCode} onChange={(event) => setFxCode(event.target.value)} className="h-9 rounded border doc-line doc-card px-1.5 text-[11px] font-bold doc-ink" aria-label="عملة السند">
                        {COMMON_FX_CURRENCIES.filter((row) => row.code !== cur.code).map((row) => <option key={row.code} value={row.code}>{row.code} — {row.nameAr}</option>)}
                      </QuickSelect>
                      <input value={fxAmount} onChange={(event) => setFxAmount(event.target.value)} placeholder="المبلغ" aria-label="المبلغ بالعملة الأجنبية" className="h-9 rounded border doc-line doc-card px-2 text-left font-mono text-xs font-bold doc-ink" dir="ltr" inputMode="decimal" />
                      <input value={fxRate} onChange={(event) => setFxRate(event.target.value)} placeholder="سعر الصرف" aria-label="سعر صرف الوحدة بعملة الدفتر" className="h-9 rounded border doc-line doc-card px-2 text-left font-mono text-xs font-bold doc-ink" dir="ltr" inputMode="decimal" />
                    </div>
                    {fxErrors.length > 0
                      ? <div className="rounded doc-tint px-2 py-1.5 text-[10px] font-bold text-rose-600">{fxErrors.join(' — ')}</div>
                      : fxBookMinor > 0
                        ? <div className="rounded doc-band px-2 py-1.5 text-[10px] font-bold doc-accent-deep" dir="ltr">{describeFxLeg(fxLeg, fxBookMinor, cur.decimals)} {cur.code}</div>
                        : <div className="rounded doc-tint px-2 py-1.5 text-[10px] doc-muted">اكتب المبلغ الأجنبي وسعر صرف الوحدة ليُحسب المرحَّل بعملة الدفتر.</div>}
                    <p className="text-[9.5px] leading-4 doc-faint">الدفتر أحادي العملة: القيد يُرحَّل بـ{cur.code} بحاصل التحويل، ويُحفظ المبلغ الأجنبي وسعره على السند وفي وصف القيد للمراجعة. الذمة تنقص بالمحوَّل فقط.</p>
                  </>}
                </div>
                {parsedAmountMinor > 0 && <div className="flex items-start gap-1.5 rounded doc-band px-2 py-1.5 text-[10px] leading-5 doc-accent-deep"><FileText size={14} className="mt-0.5 shrink-0" /><span>{amountInWords(parsedAmountMinor, cur)}</span></div>}
              </div>

              <div className="col-span-12 space-y-2 lg:col-span-3">
                <label className="block text-sm font-bold doc-ink">تاريخ السند</label>
                <input type="date" value={voucherDate} onChange={(e) => setVoucherDate(e.target.value)} className="h-10 w-full rounded-lg border doc-line doc-card px-3 text-sm font-mono doc-ink outline-none focus:border-[color:var(--doc-accent)]" />
                <div className="rounded-lg doc-tint-strong px-3 py-2 text-[10px] doc-muted">يُحفظ التاريخ في السند والقيد وكشف الحساب.</div>
              </div>
            </div>

            {!(isPurchaseExpense && expPaidBy === 'payable') && <section className="space-y-3 rounded-xl doc-card doc-ring p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-base font-bold doc-ink"><WalletCards size={19} className="doc-accent" /> {kind === 'receipt' ? 'طريقة استلام الدفعة' : 'مصدر الصرف والحساب المالي'}</h3>
                <span className="text-[10px] doc-faint">اختر الحساب الفعلي المستخدم في هذه العملية</span>
              </div>
              <div className="rounded-lg doc-tint p-3">
                {kind === 'receipt' ? <PaymentMethodPicker value={{ treasury, terminalPayment }} onChange={(value) => { setTreasury(value.treasury); setTerminalPayment(value.terminalPayment) }} operation="receipt" /> : <TreasuryPicker value={treasury} onChange={(c) => setTreasury(c as TreasuryAccount)} operation="payment" />}
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] doc-muted">
                  <span className="rounded doc-card px-2 py-1">الحساب المختار: <b className="doc-ink">{nameOf(selectedTerminal?.settlementAccountCode ?? treasury)}</b></span>
                  {selectedTerminal && <span className="rounded doc-band px-2 py-1 doc-accent-deep">مرجع الماكينة محفوظ مع السند</span>}
                </div>
              </div>
            </section>}

            {needsParty && partyId > 0 && partyInvoices.length > 0 && <section className="overflow-hidden rounded-xl doc-card doc-ring">
              <div className="flex flex-wrap items-center justify-between gap-2 doc-band px-4 py-3">
                <h3 className="flex items-center gap-2 text-sm font-bold doc-ink"><ReceiptText size={18} className="doc-accent" /> جدول تخصيص وتسوية {kind === 'receipt' ? 'مستندات العميل' : 'مستندات الشراء'}</h3>
                <button type="button" className="rounded doc-card px-3 py-1.5 text-[10px] font-bold doc-accent hover:doc-sheet" onClick={() => setAllocationDraft(Object.fromEntries(partyInvoices.map((invoice) => [invoice.docKey, fmt(invoice.dueMinor - invoice.settledMinor).replaceAll(',', '')])))}>تسوية تلقائية FIFO</button>
              </div>
              <div className="max-h-64 overflow-auto">
                <table className="w-full min-w-[700px] border-collapse text-right text-[11px]">
                  <thead className="doc-tint doc-muted"><tr><th className="px-3 py-2">إجراء</th><th className="px-3 py-2">المستند</th><th className="px-3 py-2">التاريخ</th><th className="px-3 py-2 text-left">الإجمالي</th><th className="px-3 py-2 text-left">المدفوع سابقاً</th><th className="px-3 py-2 text-left">المتبقي</th><th className="px-3 py-2 text-left">المبلغ في السند</th><th className="px-3 py-2 text-left">بعد السداد</th></tr></thead>
                  <tbody className="divide-y doc-line">
                    {partyInvoices.map((invoice) => {
                      const remaining = invoice.dueMinor - invoice.settledMinor
                      const applied = parseAllocationAmount(allocationDraft[invoice.docKey] || '')
                      return <tr key={invoice.docKey} className="hover:opacity-90"><td className="px-3 py-2"><input type="checkbox" checked={applied > 0} onChange={(event) => setAllocationDraft((draft) => ({ ...draft, [invoice.docKey]: event.target.checked ? fmt(remaining).replaceAll(',', '') : '' }))} className="h-4 w-4 accent-[color:var(--doc-accent)]" /></td><td className="px-3 py-2 font-bold doc-ink">{invoice.docLabel}<span className="ms-1.5 rounded doc-tint px-1.5 py-0.5 text-[9.5px] font-bold doc-muted">{documentKindLabel(invoice.docKey)}</span></td><td className="px-3 py-2 font-mono doc-muted">{invoice.date.slice(0, 10)}</td><td className="px-3 py-2 text-left font-mono">{fmt(invoice.dueMinor + invoice.settledMinor)}</td><td className="px-3 py-2 text-left font-mono doc-faint">{fmt(invoice.settledMinor)}</td><td className="px-3 py-2 text-left font-mono font-bold text-rose-600">{fmt(remaining)}</td><td className="doc-band/50 px-3 py-2 text-left"><input className="h-8 w-28 rounded border doc-line doc-card px-2 text-left font-mono font-bold" value={allocationDraft[invoice.docKey] ?? ''} onChange={(event) => setAllocationDraft((draft) => ({ ...draft, [invoice.docKey]: event.target.value }))} placeholder="0" inputMode="decimal" /></td><td className="px-3 py-2 text-left font-mono font-bold doc-accent">{fmt(Math.max(0, remaining - applied))}</td></tr>
                    })}
                  </tbody>
                  <tfoot className="doc-tint-strong font-bold doc-ink"><tr><td colSpan={3} className="px-3 py-2">إجمالي التخصيص</td><td className="px-3 py-2 text-left font-mono">{fmt(partyInvoices.reduce((sum, invoice) => sum + invoice.dueMinor + invoice.settledMinor, 0))}</td><td className="px-3 py-2 text-left font-mono">{fmt(partyInvoices.reduce((sum, invoice) => sum + invoice.settledMinor, 0))}</td><td className="px-3 py-2 text-left font-mono text-rose-600">{fmt(partyInvoices.reduce((sum, invoice) => sum + invoice.dueMinor - invoice.settledMinor, 0))}</td><td className="px-3 py-2 text-left font-mono doc-ink">{fmt(manualAllocatedMinor)}</td><td className="px-3 py-2" /></tr></tfoot>
                </table>
              </div>
              {hasManualAllocation && <div className={`px-4 py-2 text-[11px] font-bold ${manualAllocatedMinor > parsedAmountMinor ? 'text-rose-600' : 'doc-accent-deep'}`}>الموزع الآن: {fmt(manualAllocatedMinor)} {cur.symbol} — المتبقي تحت الحساب: {fmt(Math.max(0, parsedAmountMinor - manualAllocatedMinor))} {cur.symbol}</div>}
            </section>}

            {kind === 'payment' && counter === '2101' && partyId > 0 && (() => {
              const supplierAssets = assets.map((a) => ({ a, due: getAssetDue(a.id) })).filter((x) => x.a.supplierId === partyId && x.due.remainingMinor > 0)
              if (supplierAssets.length === 0) return null
              return <section className="space-y-2 rounded-xl border doc-line doc-card p-4"><h3 className="flex items-center gap-2 text-sm font-bold doc-ink"><Landmark size={17} className="doc-accent" /> أقساط الأصول المستحقة لهذا المورد</h3>{supplierAssets.map(({ a, due }) => <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded doc-tint px-3 py-2 text-[11px]"><span>{a.assetNumber} — {a.nameAr}</span><b>متبقٍ {fmt(due.remainingMinor)} {cur.symbol}{due.nextInstallment ? ` · قسط ${fmt(due.nextInstallment.amountMinor - due.nextInstallment.paidMinor)} يستحق ${due.nextInstallment.dueDate}` : ''}</b></div>)}</section>
            })()}

            {/* §95 (محاذاة pro-acc): ربط المشروع بالسند — أثر تحليلي على ربحية المشروع وتحصيلاته، ورصيد الطرف ينزل دائماً */}
            {(kind === 'receipt' || kind === 'payment') && projects.length > 0 && <Field label="المشروع (اختياري — للربحية والتحصيلات)"><QuickSelect value={voucherProjectId ?? ''} onChange={(e) => setVoucherProjectId(e.target.value ? Number(e.target.value) : null)} className="h-10 doc-line doc-card" data-voucher-project><option value="">بدون مشروع</option>{projects.filter((p) => p.status === 'active').map((p) => <option key={p.id} value={p.id}>{p.code} — {p.nameAr}</option>)}</QuickSelect></Field>}
            {canLinkCostCenter && !canLinkVehicle && <Field label="مركز التكلفة العام (اختياري)"><QuickSelect value={costCenterId ?? ''} onChange={(e) => setCostCenterId(e.target.value ? Number(e.target.value) : null)} className="h-10 doc-line doc-card"><option value="">بدون مركز عام</option>{costCenters.filter((center) => center.isActive).map((center) => <option key={center.id} value={center.id}>{center.code} — {center.nameAr}</option>)}</QuickSelect></Field>}
            {canLinkVehicle && <div className="grid gap-3 rounded-xl border doc-line doc-card p-4 sm:grid-cols-3"><Field label="مركز التكلفة العام (اختياري)"><QuickSelect value={costCenterId ?? ''} onChange={(e) => setCostCenterId(e.target.value ? Number(e.target.value) : null)} className="h-10 doc-line doc-card"><option value="">بدون مركز عام</option>{costCenters.filter((center) => center.isActive).map((center) => <option key={center.id} value={center.id}>{center.code} — {center.nameAr}</option>)}</QuickSelect></Field><Field label="مركز تكلفة المركبة (اختياري)"><QuickSelect value={vehicleId ?? ''} onChange={(e) => setVehicleId(e.target.value ? Number(e.target.value) : null)} className="h-10 doc-line doc-card"><option value="">بدون مركبة</option>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.plateNumber} — {vehicle.vehicleType}</option>)}</QuickSelect></Field>{vehicleId != null && <Field label="نوع مصروف السيارة"><QuickSelect value={vehicleCostCategory} onChange={(e) => setVehicleCostCategory(e.target.value)} className="h-10 doc-line doc-card">{VEHICLE_COST_CATEGORIES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</QuickSelect></Field>}</div>}

            {isPurchaseExpense && <section className="space-y-3 rounded-xl border doc-line doc-card p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-bold doc-ink">مصروف مرتبط بفاتورة شراء</h3><div className="flex overflow-hidden rounded-lg border doc-line">{([['treasury', 'مدفوع الآن'], ['payable', 'مستحق لاحقاً']] as const).map(([mode, label]) => <button key={mode} type="button" onClick={() => setExpPaidBy(mode)} className={`px-3 py-1.5 text-[11px] font-bold ${expPaidBy === mode ? 'doc-head' : 'doc-card doc-muted'}`}>{label}</button>)}</div></div>{expPaidBy === 'payable' && <div className="grid gap-3 sm:grid-cols-2"><Field label="الجهة المستحقة *"><input value={expBeneficiary} onChange={(e) => setExpBeneficiary(e.target.value)} className="h-10 w-full rounded-lg border doc-line doc-card px-3 text-sm" placeholder="شركة النقل / الجمارك…" /></Field><Field label="حساب الاستحقاق"><QuickSelect value={expPayableAccount} onChange={(e) => setExpPayableAccount(e.target.value)} className="h-10 doc-line doc-card"><option value="2117">مصاريف مستحقة (2117)</option></QuickSelect></Field></div>}<Field label="أي فاتورة شراء؟ *"><QuickSelect value={purchaseId} onChange={(e) => setPurchaseId(Number(e.target.value))} className="h-10 doc-line doc-card"><option value={0}>اختر…</option>{[...purchases].reverse().slice(0, 50).map((p) => <option key={p.id} value={p.id}>{p.invoiceNumber} — {suppliers.find((s) => s.id === p.supplierId)?.nameAr ?? '—'} ({p.date})</option>)}</QuickSelect></Field><Field label="توزيع المصروف على الأصناف"><div className="flex overflow-hidden rounded-lg border doc-line w-fit">{([['qty', 'بالكمية'], ['value', 'بالقيمة']] as const).map(([m, label]) => <button key={m} type="button" onClick={() => setExpMethod(m)} className={`px-4 py-2 text-[11px] font-bold ${expMethod === m ? 'bg-amber-500 text-white' : 'doc-card doc-muted'}`}>{label}</button>)}</div></Field></section>}

            <section className="grid gap-3 rounded-xl doc-card doc-ring p-4 lg:grid-cols-12">
              <div className="lg:col-span-8"><Field label="البيان / الشرح التفصيلي للسند"><textarea value={desc} onChange={(e) => setDesc(e.target.value)} className="min-h-20 w-full resize-y rounded-lg border doc-line doc-sheet px-3 py-2 text-sm doc-ink outline-none focus:border-[color:var(--doc-accent)]" placeholder={kind === 'receipt' ? 'مثال: تحصيل دفعة من العميل…' : 'مثال: سداد الفاتورة أو المصروف…'} /></Field></div>
              <div className="flex items-end gap-2 text-[10px] doc-muted lg:col-span-4"><Paperclip size={16} className="doc-accent" /><span>البيان يُحفظ داخل السند ويظهر في اليومية والكشوف.</span></div>
            </section>

            <div className="grid gap-3 text-center text-[10px] sm:grid-cols-3">
              <div className="rounded-lg doc-card doc-ring p-3"><span className="block doc-faint">المستفيد / الطرف</span><b className="mt-2 block text-sm doc-ink">{needsParty && partyId ? (kind === 'receipt' ? customers.find((customer) => customer.id === partyId)?.nameAr : suppliers.find((supplier) => supplier.id === partyId)?.nameAr) : 'غير مرتبط بطرف'}</b></div>
              <div className="rounded-lg doc-card doc-ring p-3"><span className="block doc-faint">حالة الاعتماد</span><b className="mt-2 flex items-center justify-center gap-1 text-sm doc-accent"><CheckCircle2 size={15} /> جاهز للتحقق والترحيل</b></div>
              <div className="rounded-lg doc-card doc-ring p-3"><span className="block doc-faint">ختم المستند</span><b className="mt-2 flex items-center justify-center gap-1 text-sm doc-accent"><Stamp size={15} /> يُثبت مع القيد</b></div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 doc-footer px-5 py-3">
            <span className="text-[10px] doc-faint">اضغط Esc للإلغاء · الترحيل ينشئ سنداً وقيداً متوازناً</span>
            <div className="flex items-center gap-2"><Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn></div>
          </div>
        </div>
      </Modal>

      <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} title="معاينة السند" wide>
        <div dir="rtl" className="space-y-4 rounded-2xl doc-sheet p-5 doc-ink doc-ring">
          <div className="flex items-start justify-between gap-3 border-b doc-line pb-3">
            <div><p className="text-[11px] doc-faint">{setup.shopName || 'نظام الحسابات'}</p><h3 className="mt-1 text-xl font-black">{kind === 'receipt' ? 'سند قبض نقدية' : 'سند دفع وصرف نقدية / بنكي'}</h3></div>
            <span className="rounded-lg doc-head px-3 py-1.5 text-xs font-bold">{kind === 'receipt' ? 'RV' : 'PV'} — مسودة</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg doc-card doc-ring p-3"><span className="block text-[11px] doc-faint">التاريخ</span><b className="mt-1 block font-mono">{voucherDate}</b></div>
            <div className="rounded-lg doc-card doc-ring p-3"><span className="block text-[11px] doc-faint">الطرف</span><b className="mt-1 block">{selectedPartyName || 'غير مرتبط بطرف'}</b></div>
          </div>
          <div className="rounded-xl doc-tint p-4 text-center"><span className="block text-xs doc-muted">المبلغ</span><strong className="mt-1 block font-mono text-3xl doc-ink">{parsedAmountMinor > 0 ? fmt(parsedAmountMinor) : '0.00'} <small className="text-base">{cur.symbol}</small></strong>{parsedAmountMinor > 0 && <span className="mt-2 block text-[11px] doc-accent-deep">{amountInWords(parsedAmountMinor, cur)}</span>}</div>
          <div className="grid gap-3 sm:grid-cols-2 text-xs"><div><span className="doc-faint">الحساب المقابل</span><b className="mt-1 block">{counters.find((item) => item.code === counter)?.label ?? '—'}</b></div><div><span className="doc-faint">البيان</span><b className="mt-1 block">{desc || '—'}</b></div></div>
          <div className="flex justify-end gap-2"><Btn variant="ghost" onClick={() => setPreviewOpen(false)}>إغلاق المعاينة</Btn></div>
        </div>
      </Modal>

      {/* عرض سند وقيده */}
      {/* سند مرحّل — بنفس لغة المستند المعتمدة في الفواتير: ترويسة داكنة، شريط بيانات،
          أقسام بيضاء، توقيعات، ثم شريط إجراءات سفلي. (تدقيق المالك — المرحلة 6) */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title="" extraWide bare>
        {viewing && entry && (() => {
          const isReceipt = viewing.kind === 'receipt'
          const reversed = !!viewing.reversalEntryId
          const partyLabel = viewing.partyKind === 'customer'
            ? customers.find((x) => x.id === viewing.partyId)?.nameAr ?? 'عميل'
            : viewing.partyKind === 'supplier'
              ? suppliers.find((x) => x.id === viewing.partyId)?.nameAr ?? 'مورد'
              : nameOf(viewing.counterAccountCode)
          const totalDebit = entry.lines.reduce((sum, l) => sum + l.debit, 0)
          return (
            <div className="overflow-hidden rounded-3xl doc-sheet" dir="rtl">
              <div className="flex items-center justify-between gap-4 doc-head px-5 py-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${isReceipt ? 'bg-emerald-400/20 text-emerald-200' : 'bg-rose-400/20 text-rose-200'}`}>
                    {isReceipt ? <ArrowDownCircle size={24} /> : <ArrowUpCircle size={24} />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-bold">{isReceipt ? 'سند قبض نقدية' : 'سند صرف نقدية'}</h2>
                      <span className="text-[10px] uppercase tracking-wider text-[#a9c7ff]">{isReceipt ? 'Receipt Voucher' : 'Payment Voucher'}</span>
                      <span className="rounded bg-white/10 px-2 py-0.5 font-mono text-[11px]">{viewing.voucherNumber}</span>
                      <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${reversed ? 'bg-amber-400/20 text-amber-100' : 'bg-emerald-400/20 text-emerald-100'}`}>
                        {reversed ? 'معكوس — خارج الأرصدة' : 'مرحّل ومعتمد'}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] doc-head-sub">{setup.shopName || 'نظام الحسابات'} · قيد #{entry.entryNumber} · {entry.date}</p>
                  </div>
                </div>
                <button type="button" onClick={() => setViewing(null)} aria-label="إغلاق" className="rounded-lg p-2 text-white/70 transition hover:bg-rose-500 hover:text-white"><X size={18} /></button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 doc-meta px-5 py-2 text-[10px]">
                <span className="flex items-center gap-1"><FileText size={14} className="doc-accent" /> المنشأة: <b className="doc-ink">{setup.shopName || 'غير محدد'}</b></span>
                <span className="flex items-center gap-1"><CheckCircle2 size={13} className="doc-accent" /> حرّره: <b className="doc-ink">{entry.createdBy || '—'}</b></span>
              </div>

              <div className="max-h-[calc(92vh-9rem)] space-y-4 overflow-y-auto px-5 py-4 sm:px-6">
                <div className="grid gap-3 sm:grid-cols-12">
                  <div className="space-y-1 rounded-xl doc-card doc-ring p-4 sm:col-span-5">
                    <span className="text-[11px] doc-faint">{isReceipt ? 'استلمنا من' : 'صُرف إلى'}</span>
                    <b className="block text-base doc-ink">{partyLabel}</b>
                    <span className="block text-[11px] doc-muted">الحساب المقابل: {viewing.counterAccountCode} — {nameOf(viewing.counterAccountCode)}</span>
                  </div>
                  <div className="space-y-1 rounded-xl doc-tint p-4 doc-ring sm:col-span-4">
                    <span className="text-[11px] doc-muted">{isReceipt ? 'المبلغ المقبوض' : 'المبلغ المصروف'}</span>
                    <b className={`block font-mono text-2xl ${isReceipt ? 'text-emerald-700' : 'text-rose-600'}`}>{fmt(viewing.amountMinor)} {cur.symbol}</b>
                    <span className="block text-[10px] leading-5 doc-accent-deep">فقط {amountInWords(viewing.amountMinor, cur)} لا غير</span>
                    {viewing.fx && <span className="mt-1 block rounded doc-card px-2 py-1 text-[10px] font-bold doc-ink" dir="ltr" data-voucher-fx-view>
                      {(viewing.fx.amountMinor / 10 ** viewing.fx.decimals).toFixed(viewing.fx.decimals)} {viewing.fx.currencyCode} × {formatRate(viewing.fx.ratePpm)}
                    </span>}
                  </div>
                  <div className="space-y-1 rounded-xl doc-card doc-ring p-4 sm:col-span-3">
                    <span className="text-[11px] doc-faint">الخزينة / الحساب النقدي</span>
                    <b className="block text-sm doc-ink">{nameOf(viewing.treasury)}</b>
                    <span className="block text-[11px] doc-muted">تاريخ السند: {viewing.date?.slice(0, 10) ?? entry.date}</span>
                  </div>
                </div>

                {viewing.description && (
                  <section className="rounded-xl doc-card doc-ring p-4">
                    <h3 className="mb-1 flex items-center gap-2 text-sm font-bold doc-ink"><FileText size={16} className="doc-accent" /> البيان</h3>
                    <p className="text-[12px] leading-6 doc-muted">{viewing.description}</p>
                  </section>
                )}

                {viewing.allocations && viewing.allocations.length > 0 && (
                  <section className="overflow-hidden rounded-xl doc-card doc-ring">
                    <div className="flex flex-wrap items-center justify-between gap-2 doc-band px-4 py-3">
                      <h3 className="flex items-center gap-2 text-sm font-bold doc-ink"><ReceiptText size={18} className="doc-accent" /> توزيع السداد على المستندات</h3>
                      {(viewing.unallocatedMinor ?? 0) > 0 && <span className="rounded doc-card px-2 py-1 text-[10px] font-bold doc-accent-deep">تحت الحساب: {fmt(viewing.unallocatedMinor ?? 0)}</span>}
                    </div>
                    <table className="w-full border-collapse text-right text-[11px]">
                      <thead className="doc-tint doc-muted"><tr><th className="px-4 py-2">المستند</th><th className="px-4 py-2">المخصص</th></tr></thead>
                      <tbody className="divide-y doc-line">
                        {viewing.allocations.map((a, i) => (
                          <tr key={i}><td className="px-4 py-2 doc-ink">{a.docLabel || a.docKey}</td><td className="px-4 py-2 font-mono font-bold">{fmt(a.appliedMinor)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                )}

                <section className="overflow-hidden rounded-xl doc-card doc-ring">
                  <div className="flex items-center gap-2 doc-band px-4 py-3 text-sm font-bold doc-ink">
                    <BookOpenText size={18} className="doc-accent" /> القيد المحاسبي المتولد #{entry.entryNumber}
                  </div>
                  <table className="w-full border-collapse text-right text-[12px]">
                    <thead className="doc-tint text-[11px] doc-muted"><tr><th className="px-4 py-2">الحساب</th><th className="w-32 px-4 py-2">مدين</th><th className="w-32 px-4 py-2">دائن</th></tr></thead>
                    <tbody className="divide-y doc-line">
                      {entry.lines.map((l, i) => (
                        <tr key={i}>
                          <td className="px-4 py-2 doc-ink">{l.debit > 0 ? '' : '\u00A0\u00A0من / '}{nameOf(l.accountCode)} <span className="font-mono text-[10px] doc-faint">{l.accountCode}</span></td>
                          <td className="px-4 py-2 font-mono font-bold">{l.debit > 0 ? fmt(l.debit) : ''}</td>
                          <td className="px-4 py-2 font-mono font-bold doc-muted">{l.credit > 0 ? fmt(l.credit) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="doc-tint-strong font-bold doc-ink"><tr><td className="px-4 py-2">الإجمالي — القيد متوازن</td><td className="px-4 py-2 font-mono">{fmt(totalDebit)}</td><td className="px-4 py-2 font-mono">{fmt(totalDebit)}</td></tr></tfoot>
                  </table>
                </section>

                <div className="grid gap-3 text-center text-[10px] sm:grid-cols-3">
                  <div className="rounded-lg doc-card doc-ring p-4"><span className="block doc-faint">توقيع {isReceipt ? 'المستلم' : 'المستفيد'}</span><span className="mt-6 block border-t border-dashed doc-line pt-1 doc-muted">{partyLabel}</span></div>
                  <div className="rounded-lg doc-card doc-ring p-4"><span className="block doc-faint">أمين الخزينة</span><span className="mt-6 block border-t border-dashed doc-line pt-1 doc-muted">{entry.createdBy || '—'}</span></div>
                  <div className="rounded-lg doc-card doc-ring p-4"><span className="block doc-faint">الاعتماد</span><span className="mt-6 block border-t border-dashed doc-line pt-1 doc-muted">{reversed ? 'ملغى بقيد عاكس' : 'معتمد'}</span></div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 doc-footer px-5 py-3">
                <span className="text-[10px] doc-faint">
                  {reversed ? `معكوس بقيد #${viewing.reversalEntryId} — لا يدخل في أرصدة الطرف` : 'السند مرحّل — التصحيح يكون بقيد عاكس لا بالحذف'}
                </span>
                <div className="flex items-center gap-2">
                  {!reversed && <Btn variant="danger" onClick={() => { setReverseTarget(viewing); setReverseReason('') }}><Undo2 size={14} /> عكس السند</Btn>}
                  <Btn variant="ghost" onClick={() => setViewing(null)}>إغلاق</Btn>
                </div>
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* عكس سند مرحّل — نافذة قرار بنفس لغة المستند: سبب إلزامي وأثر معلن قبل التنفيذ */}
      <Modal open={!!reverseTarget} onClose={() => setReverseTarget(null)} title="" wide bare>
        {reverseTarget && (
          <div className="overflow-hidden rounded-3xl doc-sheet" dir="rtl">
            <div className="flex items-center justify-between gap-4 bg-[#7a2431] px-5 py-4 text-white">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/15"><Undo2 size={22} /></div>
                <div className="min-w-0">
                  <h2 className="text-lg font-bold">عكس السند {reverseTarget.voucherNumber}</h2>
                  <p className="mt-0.5 truncate text-[11px] text-white/80">{fmt(reverseTarget.amountMinor)} {cur.symbol} · {reverseTarget.kind === 'receipt' ? 'سند قبض' : 'سند صرف'}</p>
                </div>
              </div>
              <button type="button" onClick={() => setReverseTarget(null)} aria-label="إغلاق" className="rounded-lg p-2 text-white/70 transition hover:bg-rose-600 hover:text-white"><X size={18} /></button>
            </div>
            <div className="space-y-4 px-5 py-4">
              <section className="rounded-xl border border-amber-500/30 bg-amber-50 p-4 text-[12px] leading-6 text-amber-900">
                <b className="mb-1 block">ماذا سيحدث بالضبط؟</b>
                يُنشأ <b>قيد عاكس جديد</b> بنفس القيم وبالاتجاه المضاد (لا يُحذف شيء من الدفتر)، ويخرج السند من كشف حساب الطرف ومن أرصدة الخزينة، ويبقى الأصل والعكس ظاهرين في اليومية لأثر تدقيق كامل.
              </section>
              <section className="rounded-xl doc-card doc-ring p-4">
                <Field label="سبب العكس * (يُحفظ في القيد العاكس ويظهر للمراجع)">
                  <textarea value={reverseReason} onChange={(event) => setReverseReason(event.target.value)} className={inputCls} rows={3} placeholder="مثال: أُدخل السند على الطرف الخطأ — صُحِّح بسند جديد رقم…" />
                </Field>
              </section>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 doc-footer px-5 py-3">
              <span className="text-[10px] doc-faint">العكس عملية دائمة في الدفتر — لا يمكن التراجع عنها إلا بسند جديد</span>
              <div className="flex items-center gap-2">
                <Btn variant="ghost" onClick={() => setReverseTarget(null)}>إلغاء</Btn>
                <Btn variant="danger" onClick={confirmReverse} disabled={!reverseReason.trim()}>تأكيد العكس</Btn>
              </div>
            </div>
          </div>
        )}
      </Modal>
      {paymentApproval.dialog}
      {reverseApproval.dialog}
    </div>
  )
}
