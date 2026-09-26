import { PartyQuickPicker, QuickSelect } from '../components/KeyboardPickers.tsx'
/**
 * سندات القبض والصرف (المرحلة 4) —
 * قبض: نقدية داخلة (سداد عميل، إيراد آخر، رأس مال…)
 * صرف: نقدية خارجة (سداد مورد، مصروف، مسحوبات…)
 * كل سند يولّد قيده المتوازن فوراً ويظهر في اليومية.
 */
import { useMemo, useState } from 'react'
import { ArrowDownCircle, ArrowUpCircle, BookOpenText, CheckCircle2, Eye, FileSpreadsheet, FileText, Landmark, Paperclip, Pencil, Printer, ReceiptText, Save, Search, Stamp, WalletCards, X } from 'lucide-react'
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
import { customerStatement, supplierStatement, customerUnitDocs, statementBalance } from '../../core/statements.ts'
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
  const { vouchers, journal, treasuries, paymentTerminals, customers, suppliers, purchases, customAccounts, addCustomAccount, postVoucher, reverseVoucher, addLatePurchaseExpense, getOpenClientInvoices, getOpenSupplierInvoices, sales, saleReturns, cheques, purchaseReturns, clientSettlements, openingBalances, trips, tickets, rentalContracts , clinicVisits, clinicCollections, clinicPatients, labOrders, labPatients, walletOps, projectExtracts, projects, costCenters, installmentPlans, assets, getAssetDue, laundryOrders, cars, consignmentCars, vehicles } = useDataStore()
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
  const [voucherDate, setVoucherDate] = useState(new Date().toISOString().slice(0, 10))
  const [desc, setDesc] = useState('')
  const [quickAccountOpen, setQuickAccountOpen] = useState(false)
  const [quickAccountCode, setQuickAccountCode] = useState('')
  const [quickAccountName, setQuickAccountName] = useState('')
  const [partyId, setPartyId] = useState(0) // العميل (قبض 1104) أو المورد (صرف 2101) — يغذي كشف الحساب
  const [purchaseId, setPurchaseId] = useState(0) // فاتورة الشراء عند «مصروف على فاتورة شراء»
  const [expMethod, setExpMethod] = useState<'value' | 'qty'>('qty') // توزيع مصروف الفاتورة
  const [expPaidBy, setExpPaidBy] = useState<'treasury' | 'payable'>('treasury')
  const [expBeneficiary, setExpBeneficiary] = useState('')
  const [expPayableAccount, setExpPayableAccount] = useState('2117')
  const [vehicleId, setVehicleId] = useState<number | null>(null)
  const [costCenterId, setCostCenterId] = useState<number | null>(null)
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
        extraDocs: customerUnitDocs({ customerId: partyId, trips, tickets, rentals: rentalContracts, clinicVisits, clinicCollections, linkedPatientIds: clinicPatients.filter((p) => p.linkedCustomerId === partyId).map((p) => p.id), labOrders, linkedLabPatientIds: labPatients.filter((p) => p.linkedCustomerId === partyId).map((p) => p.id), walletOps, projectExtracts, linkedProjectIds: projects.filter((p) => p.clientId === partyId).map((p) => p.id), installmentPlans, laundryOrders, cars, consignmentCars }),
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
    }))
  }, [partyId, kind, sales, saleReturns, vouchers, cheques, purchases, purchaseReturns, clientSettlements, openingBalances, trips, tickets, rentalContracts, clinicVisits, clinicCollections, clinicPatients, labOrders, labPatients, walletOps, projectExtracts, projects, installmentPlans, laundryOrders, cars, consignmentCars])

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
  const partyInvoices = !needsParty || partyId <= 0
    ? []
    : kind === 'receipt' ? getOpenClientInvoices(partyId) : getOpenSupplierInvoices(partyId)
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
  const parsedAmountMinor = (() => { try { return toMinor(amount || '0', cur.decimals) } catch { return 0 } })()
  const selectedPartyName = needsParty && partyId > 0
    ? (kind === 'receipt' ? customers.find((customer) => customer.id === partyId)?.nameAr : suppliers.find((supplier) => supplier.id === partyId)?.nameAr) ?? ''
    : ''
  const saveDraft = () => {
    try {
      window.localStorage.setItem(`shopsys.voucher-draft.${kind}`, JSON.stringify({
        treasury, terminalPayment, counter, amount, voucherDate, desc, partyId, purchaseId, expMethod, expPaidBy,
        expBeneficiary, expPayableAccount, vehicleId, costCenterId, vehicleCostCategory, allocationDraft,
      }))
      toast.show(`حُفظت مسودة سند ${kind === 'receipt' ? 'القبض' : 'الصرف'} محلياً ✓`)
    } catch {
      toast.show('تعذر حفظ المسودة على هذا الجهاز', 'error')
    }
  }
  const printDraft = () => {
    const title = kind === 'receipt' ? 'سند قبض نقدية' : 'سند صرف نقدية'
    const amountText = parsedAmountMinor > 0 ? `${fmt(parsedAmountMinor)} ${cur.symbol}` : '—'
    printHtml(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${escapePrintText(title)}</title><style>body{font-family:Arial,sans-serif;color:#0f2042;padding:28px;max-width:760px;margin:auto}h1{border-bottom:3px solid #0f2042;padding-bottom:12px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:10px;background:#eff4ff;padding:14px;margin:16px 0}.amount{font-size:30px;font-weight:800;color:#0f2042;margin:22px 0}.label{color:#68738a;font-size:12px}.value{font-weight:700}p{line-height:1.8}</style></head><body><h1>${escapePrintText(title)}</h1><div class="meta"><div><div class="label">المنشأة</div><div class="value">${escapePrintText(setup.shopName || 'نظام الحسابات')}</div></div><div><div class="label">التاريخ</div><div class="value">${escapePrintText(voucherDate)}</div></div><div><div class="label">الطرف</div><div class="value">${escapePrintText(selectedPartyName || 'غير مرتبط بطرف')}</div></div><div><div class="label">الحساب المقابل</div><div class="value">${escapePrintText(counters.find((item) => item.code === counter)?.label ?? '—')}</div></div></div><div class="amount">${escapePrintText(amountText)}</div><p><b>البيان:</b> ${escapePrintText(desc || '—')}</p><p><b>الحالة:</b> مسودة قبل الترحيل</p></body></html>`)
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
        amountMinor: toMinor(amount || '0', cur.decimals),
        description: desc.trim(),
        date: voucherDate,
        partyKind: needsParty ? (kind === 'receipt' ? 'customer' : 'supplier') : null,
        partyId: needsParty ? partyId : null,
        allocations: manualAllocations,
        costCenterId: canLinkCostCenter ? costCenterId : null,
        vehicleId: canLinkVehicle ? vehicleId : null,
        vehicleCostCategory: canLinkVehicle && vehicleId != null ? vehicleCostCategory : undefined,
        terminalPayment: kind === 'receipt' && selectedTerminal ? { terminalId: selectedTerminal.id, providerReference: terminalPayment.providerReference.trim(), cardLast4: terminalPayment.cardLast4 || undefined } : undefined,
      })
      toast.show(`تم ${kind === 'receipt' ? 'سند القبض' : 'سند الصرف'} ${v.voucherNumber} — تولد قيده تلقائياً ✓`)
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
        <div className="overflow-hidden rounded-3xl bg-[#f8f9ff] text-[#0b1c30]" dir="rtl">
          <div className="flex items-center justify-between gap-4 bg-[#0f2042] px-5 py-4 text-white">
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
                <p className="mt-0.5 truncate text-[11px] text-[#d6e3ff]">{setup.shopName || 'نظام الحسابات'} · سند مرتبط آلياً باليومية وكشف الطرف</p>
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

          <div className="flex flex-wrap items-center justify-between gap-2 bg-[#eff4ff] px-5 py-2 text-[10px] text-[#45464e]">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
              <span className="flex items-center gap-1"><FileText size={14} className="text-[#009c6b]" /> المنشأة: <b className="text-[#0f2042]">{setup.shopName || 'غير محدد'}</b></span>
              {receipt.headerLines.filter((line) => line.trim()).slice(0, 1).map((line) => <span key={line}>{line}</span>)}
            </div>
            <span className="flex items-center gap-1 font-semibold text-[#0f2042]"><CheckCircle2 size={13} className="text-[#009c6b]" /> سيُنشأ القيد تلقائياً بعد الترحيل</span>
          </div>

          <div className="max-h-[calc(92vh-7rem)] space-y-4 overflow-y-auto px-5 py-4 sm:px-6">
            <div className="grid grid-cols-12 items-start gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-[#dce9ff]">
              <div className="col-span-12 space-y-2 lg:col-span-5">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-1 text-sm font-bold text-[#0f2042]">
                    {kind === 'receipt' ? <WalletCards size={16} className="text-[#3f5f92]" /> : <Landmark size={16} className="text-[#3f5f92]" />}
                    {needsParty ? kind === 'receipt' ? 'استلمنا من العميل' : 'يصرف إلى المورد' : kind === 'receipt' ? 'مصدر النقدية والحساب المقابل' : 'وجهة النقدية والحساب المقابل'}
                    {needsParty && <span className="text-rose-600">*</span>}
                  </label>
                  {needsParty && <span className="rounded bg-[#e5eeff] px-2 py-0.5 text-[10px] font-semibold text-[#254778]">بحث سريع [F3]</span>}
                </div>
                {needsParty ? (
                  <PartyQuickPicker parties={kind === 'receipt' ? customers : suppliers} value={partyId} onChange={(id) => { setPartyId(id); setAllocationDraft({}) }} cashLabel="اختر الطرف" label={kind === 'receipt' ? 'بحث العميل' : 'بحث المورد'} showCash={false} />
                ) : (
                  <div className="flex min-h-10 items-center gap-2 rounded-lg bg-[#eff4ff] px-3 text-sm text-[#45464e]">
                    <Search size={17} className="text-[#75777f]" />
                    <span>{counters.find((item) => item.code === counter)?.label ?? 'اختر الحساب المقابل من القائمة'}</span>
                  </div>
                )}
                <QuickSelect aria-label="الحساب المقابل" value={counter} onChange={(e) => { setCounter(e.target.value); setPartyId(0); setAllocationDraft({}) }} className="h-10 border-[#c5c6cf] bg-[#f8f9ff] text-sm">
                  <option value="">اختر الحساب المقابل…</option>
                  {counters.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                </QuickSelect>
                {needsParty && partyId > 0 && liveBalance !== null && (
                  <div className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-[11px] font-bold ${liveBalance > 0 ? 'bg-rose-50 text-rose-700' : liveBalance < 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-600'}`}>
                    <span>الرصيد القائم قبل السند</span>
                    <span>{liveBalance > 0 ? kind === 'receipt' ? `عليه ${fmt(liveBalance)}` : `مستحق له ${fmt(liveBalance)}` : liveBalance < 0 ? kind === 'receipt' ? `له عندك ${fmt(-liveBalance)}` : `لك عنده ${fmt(-liveBalance)}` : 'الرصيد صفر'} {cur.symbol}</span>
                  </div>
                )}
                {!needsParty && <button type="button" onClick={() => setQuickAccountOpen(!quickAccountOpen)} className="text-right text-[11px] font-bold text-[#3f5f92] hover:underline">+ إضافة بند {kind === 'payment' ? 'مصروف' : 'إيراد'} جديد</button>}
                {quickAccountOpen && <div className="grid grid-cols-[100px_1fr_auto] gap-2 rounded-lg bg-[#eff4ff] p-2"><input className="h-9 rounded border border-[#c5c6cf] bg-white px-2 text-xs" value={quickAccountCode} onChange={(e) => setQuickAccountCode(e.target.value)} placeholder={kind === 'payment' ? '51xx' : '41xx'} dir="ltr" /><input className="h-9 rounded border border-[#c5c6cf] bg-white px-2 text-xs" value={quickAccountName} onChange={(e) => setQuickAccountName(e.target.value)} placeholder="اسم البند" /><Btn onClick={addQuickAccount} disabled={!quickAccountCode.trim() || !quickAccountName.trim()}>إضافة</Btn></div>}
              </div>

              <div className="col-span-12 space-y-2 rounded-lg bg-[#eff4ff] p-3 lg:col-span-4">
                <div className="flex items-center justify-between text-sm font-bold text-[#0f2042]"><span>{kind === 'receipt' ? 'المبلغ الإجمالي المقبوض' : 'قيمة سند الصرف'}</span><span className="rounded bg-[#d6e3ff] px-2 py-0.5 text-[10px] text-[#254778]">{cur.code} · {cur.symbol}</span></div>
                <div className="flex items-baseline gap-2 rounded-lg bg-white px-3 py-2 shadow-inner ring-1 ring-[#dce9ff]">
                  <input data-voucher-amount="true" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="w-full bg-transparent text-left font-mono text-3xl font-bold tracking-tight text-[#0f2042] outline-none" dir="ltr" inputMode="decimal" autoFocus />
                  <span className="whitespace-nowrap text-sm font-bold text-[#45464e]">{cur.symbol}</span>
                </div>
                {parsedAmountMinor > 0 && <div className="flex items-start gap-1.5 rounded bg-[#dce9ff]/60 px-2 py-1.5 text-[10px] leading-5 text-[#254778]"><FileText size={14} className="mt-0.5 shrink-0" /><span>{amountInWords(parsedAmountMinor, cur)}</span></div>}
              </div>

              <div className="col-span-12 space-y-2 lg:col-span-3">
                <label className="block text-sm font-bold text-[#0f2042]">تاريخ السند</label>
                <input type="date" value={voucherDate} onChange={(e) => setVoucherDate(e.target.value)} className="h-10 w-full rounded-lg border border-[#c5c6cf] bg-white px-3 text-sm font-mono text-[#0f2042] outline-none focus:border-[#3f5f92]" />
                <div className="rounded-lg bg-[#e5eeff] px-3 py-2 text-[10px] text-[#45464e]">يُحفظ التاريخ في السند والقيد وكشف الحساب.</div>
              </div>
            </div>

            {!(isPurchaseExpense && expPaidBy === 'payable') && <section className="space-y-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-[#dce9ff]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-base font-bold text-[#0f2042]"><WalletCards size={19} className="text-[#3f5f92]" /> {kind === 'receipt' ? 'طريقة استلام الدفعة' : 'مصدر الصرف والحساب المالي'}</h3>
                <span className="text-[10px] text-[#75777f]">اختر الحساب الفعلي المستخدم في هذه العملية</span>
              </div>
              <div className="rounded-lg bg-[#eff4ff] p-3">
                {kind === 'receipt' ? <PaymentMethodPicker value={{ treasury, terminalPayment }} onChange={(value) => { setTreasury(value.treasury); setTerminalPayment(value.terminalPayment) }} operation="receipt" /> : <TreasuryPicker value={treasury} onChange={(c) => setTreasury(c as TreasuryAccount)} operation="payment" />}
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-[#45464e]">
                  <span className="rounded bg-white px-2 py-1">الحساب المختار: <b className="text-[#0f2042]">{nameOf(selectedTerminal?.settlementAccountCode ?? treasury)}</b></span>
                  {selectedTerminal && <span className="rounded bg-[#d6e3ff] px-2 py-1 text-[#254778]">مرجع الماكينة محفوظ مع السند</span>}
                </div>
              </div>
            </section>}

            {needsParty && partyId > 0 && partyInvoices.length > 0 && <section className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-[#dce9ff]">
              <div className="flex flex-wrap items-center justify-between gap-2 bg-[#dce9ff]/70 px-4 py-3">
                <h3 className="flex items-center gap-2 text-sm font-bold text-[#0f2042]"><ReceiptText size={18} className="text-[#3f5f92]" /> جدول تخصيص وتسوية {kind === 'receipt' ? 'فواتير البيع' : 'فواتير الشراء'}</h3>
                <button type="button" className="rounded bg-white px-3 py-1.5 text-[10px] font-bold text-[#3f5f92] hover:bg-[#f8f9ff]" onClick={() => setAllocationDraft(Object.fromEntries(partyInvoices.map((invoice) => [invoice.docKey, fmt(invoice.dueMinor - invoice.settledMinor).replaceAll(',', '')])))}>تسوية تلقائية FIFO</button>
              </div>
              <div className="max-h-64 overflow-auto">
                <table className="w-full min-w-[700px] border-collapse text-right text-[11px]">
                  <thead className="bg-[#eff4ff] text-[#45464e]"><tr><th className="px-3 py-2">إجراء</th><th className="px-3 py-2">المستند</th><th className="px-3 py-2">التاريخ</th><th className="px-3 py-2 text-left">الإجمالي</th><th className="px-3 py-2 text-left">المدفوع سابقاً</th><th className="px-3 py-2 text-left">المتبقي</th><th className="px-3 py-2 text-left">المبلغ في السند</th><th className="px-3 py-2 text-left">بعد السداد</th></tr></thead>
                  <tbody className="divide-y divide-[#dce9ff]">
                    {partyInvoices.map((invoice) => {
                      const remaining = invoice.dueMinor - invoice.settledMinor
                      const applied = parseAllocationAmount(allocationDraft[invoice.docKey] || '')
                      return <tr key={invoice.docKey} className="hover:bg-[#eff4ff]/70"><td className="px-3 py-2"><input type="checkbox" checked={applied > 0} onChange={(event) => setAllocationDraft((draft) => ({ ...draft, [invoice.docKey]: event.target.checked ? fmt(remaining).replaceAll(',', '') : '' }))} className="h-4 w-4 accent-[#0f2042]" /></td><td className="px-3 py-2 font-bold text-[#0f2042]">{invoice.docLabel}</td><td className="px-3 py-2 font-mono text-[#45464e]">{invoice.date.slice(0, 10)}</td><td className="px-3 py-2 text-left font-mono">{fmt(invoice.dueMinor + invoice.settledMinor)}</td><td className="px-3 py-2 text-left font-mono text-[#75777f]">{fmt(invoice.settledMinor)}</td><td className="px-3 py-2 text-left font-mono font-bold text-rose-600">{fmt(remaining)}</td><td className="bg-[#d6e3ff]/50 px-3 py-2 text-left"><input className="h-8 w-28 rounded border border-[#c5c6cf] bg-white px-2 text-left font-mono font-bold" value={allocationDraft[invoice.docKey] ?? ''} onChange={(event) => setAllocationDraft((draft) => ({ ...draft, [invoice.docKey]: event.target.value }))} placeholder="0" inputMode="decimal" /></td><td className="px-3 py-2 text-left font-mono font-bold text-[#009c6b]">{fmt(Math.max(0, remaining - applied))}</td></tr>
                    })}
                  </tbody>
                  <tfoot className="bg-[#e5eeff] font-bold text-[#0f2042]"><tr><td colSpan={3} className="px-3 py-2">إجمالي التخصيص</td><td className="px-3 py-2 text-left font-mono">{fmt(partyInvoices.reduce((sum, invoice) => sum + invoice.dueMinor + invoice.settledMinor, 0))}</td><td className="px-3 py-2 text-left font-mono">{fmt(partyInvoices.reduce((sum, invoice) => sum + invoice.settledMinor, 0))}</td><td className="px-3 py-2 text-left font-mono text-rose-600">{fmt(partyInvoices.reduce((sum, invoice) => sum + invoice.dueMinor - invoice.settledMinor, 0))}</td><td className="px-3 py-2 text-left font-mono text-[#0f2042]">{fmt(manualAllocatedMinor)}</td><td className="px-3 py-2" /></tr></tfoot>
                </table>
              </div>
              {hasManualAllocation && <div className={`px-4 py-2 text-[11px] font-bold ${manualAllocatedMinor > parsedAmountMinor ? 'text-rose-600' : 'text-[#254778]'}`}>الموزع الآن: {fmt(manualAllocatedMinor)} {cur.symbol} — المتبقي تحت الحساب: {fmt(Math.max(0, parsedAmountMinor - manualAllocatedMinor))} {cur.symbol}</div>}
            </section>}

            {kind === 'payment' && counter === '2101' && partyId > 0 && (() => {
              const supplierAssets = assets.map((a) => ({ a, due: getAssetDue(a.id) })).filter((x) => x.a.supplierId === partyId && x.due.remainingMinor > 0)
              if (supplierAssets.length === 0) return null
              return <section className="space-y-2 rounded-xl border border-[#c5c6cf] bg-white p-4"><h3 className="flex items-center gap-2 text-sm font-bold text-[#0f2042]"><Landmark size={17} className="text-[#3f5f92]" /> أقساط الأصول المستحقة لهذا المورد</h3>{supplierAssets.map(({ a, due }) => <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-[#eff4ff] px-3 py-2 text-[11px]"><span>{a.assetNumber} — {a.nameAr}</span><b>متبقٍ {fmt(due.remainingMinor)} {cur.symbol}{due.nextInstallment ? ` · قسط ${fmt(due.nextInstallment.amountMinor - due.nextInstallment.paidMinor)} يستحق ${due.nextInstallment.dueDate}` : ''}</b></div>)}</section>
            })()}

            {canLinkCostCenter && !canLinkVehicle && <Field label="مركز التكلفة العام (اختياري)"><QuickSelect value={costCenterId ?? ''} onChange={(e) => setCostCenterId(e.target.value ? Number(e.target.value) : null)} className="h-10 border-[#c5c6cf] bg-white"><option value="">بدون مركز عام</option>{costCenters.filter((center) => center.isActive).map((center) => <option key={center.id} value={center.id}>{center.code} — {center.nameAr}</option>)}</QuickSelect></Field>}
            {canLinkVehicle && <div className="grid gap-3 rounded-xl border border-[#c5c6cf] bg-white p-4 sm:grid-cols-3"><Field label="مركز التكلفة العام (اختياري)"><QuickSelect value={costCenterId ?? ''} onChange={(e) => setCostCenterId(e.target.value ? Number(e.target.value) : null)} className="h-10 border-[#c5c6cf] bg-white"><option value="">بدون مركز عام</option>{costCenters.filter((center) => center.isActive).map((center) => <option key={center.id} value={center.id}>{center.code} — {center.nameAr}</option>)}</QuickSelect></Field><Field label="مركز تكلفة المركبة (اختياري)"><QuickSelect value={vehicleId ?? ''} onChange={(e) => setVehicleId(e.target.value ? Number(e.target.value) : null)} className="h-10 border-[#c5c6cf] bg-white"><option value="">بدون مركبة</option>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.plateNumber} — {vehicle.vehicleType}</option>)}</QuickSelect></Field>{vehicleId != null && <Field label="نوع مصروف السيارة"><QuickSelect value={vehicleCostCategory} onChange={(e) => setVehicleCostCategory(e.target.value)} className="h-10 border-[#c5c6cf] bg-white">{VEHICLE_COST_CATEGORIES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</QuickSelect></Field>}</div>}

            {isPurchaseExpense && <section className="space-y-3 rounded-xl border border-[#c5c6cf] bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-bold text-[#0f2042]">مصروف مرتبط بفاتورة شراء</h3><div className="flex overflow-hidden rounded-lg border border-[#c5c6cf]">{([['treasury', 'مدفوع الآن'], ['payable', 'مستحق لاحقاً']] as const).map(([mode, label]) => <button key={mode} type="button" onClick={() => setExpPaidBy(mode)} className={`px-3 py-1.5 text-[11px] font-bold ${expPaidBy === mode ? 'bg-[#0f2042] text-white' : 'bg-white text-[#45464e]'}`}>{label}</button>)}</div></div>{expPaidBy === 'payable' && <div className="grid gap-3 sm:grid-cols-2"><Field label="الجهة المستحقة *"><input value={expBeneficiary} onChange={(e) => setExpBeneficiary(e.target.value)} className="h-10 w-full rounded-lg border border-[#c5c6cf] bg-white px-3 text-sm" placeholder="شركة النقل / الجمارك…" /></Field><Field label="حساب الاستحقاق"><QuickSelect value={expPayableAccount} onChange={(e) => setExpPayableAccount(e.target.value)} className="h-10 border-[#c5c6cf] bg-white"><option value="2117">مصاريف مستحقة (2117)</option></QuickSelect></Field></div>}<Field label="أي فاتورة شراء؟ *"><QuickSelect value={purchaseId} onChange={(e) => setPurchaseId(Number(e.target.value))} className="h-10 border-[#c5c6cf] bg-white"><option value={0}>اختر…</option>{[...purchases].reverse().slice(0, 50).map((p) => <option key={p.id} value={p.id}>{p.invoiceNumber} — {suppliers.find((s) => s.id === p.supplierId)?.nameAr ?? '—'} ({p.date})</option>)}</QuickSelect></Field><Field label="توزيع المصروف على الأصناف"><div className="flex overflow-hidden rounded-lg border border-[#c5c6cf] w-fit">{([['qty', 'بالكمية'], ['value', 'بالقيمة']] as const).map(([m, label]) => <button key={m} type="button" onClick={() => setExpMethod(m)} className={`px-4 py-2 text-[11px] font-bold ${expMethod === m ? 'bg-amber-500 text-white' : 'bg-white text-[#45464e]'}`}>{label}</button>)}</div></Field></section>}

            <section className="grid gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-[#dce9ff] lg:grid-cols-12">
              <div className="lg:col-span-8"><Field label="البيان / الشرح التفصيلي للسند"><textarea value={desc} onChange={(e) => setDesc(e.target.value)} className="min-h-20 w-full resize-y rounded-lg border border-[#c5c6cf] bg-[#f8f9ff] px-3 py-2 text-sm text-[#0b1c30] outline-none focus:border-[#3f5f92]" placeholder={kind === 'receipt' ? 'مثال: تحصيل دفعة من العميل…' : 'مثال: سداد الفاتورة أو المصروف…'} /></Field></div>
              <div className="flex items-end gap-2 text-[10px] text-[#45464e] lg:col-span-4"><Paperclip size={16} className="text-[#3f5f92]" /><span>البيان يُحفظ داخل السند ويظهر في اليومية والكشوف.</span></div>
            </section>

            <div className="grid gap-3 text-center text-[10px] sm:grid-cols-3">
              <div className="rounded-lg bg-white p-3 ring-1 ring-[#dce9ff]"><span className="block text-[#75777f]">المستفيد / الطرف</span><b className="mt-2 block text-sm text-[#0f2042]">{needsParty && partyId ? (kind === 'receipt' ? customers.find((customer) => customer.id === partyId)?.nameAr : suppliers.find((supplier) => supplier.id === partyId)?.nameAr) : 'غير مرتبط بطرف'}</b></div>
              <div className="rounded-lg bg-white p-3 ring-1 ring-[#dce9ff]"><span className="block text-[#75777f]">حالة الاعتماد</span><b className="mt-2 flex items-center justify-center gap-1 text-sm text-[#009c6b]"><CheckCircle2 size={15} /> جاهز للتحقق والترحيل</b></div>
              <div className="rounded-lg bg-white p-3 ring-1 ring-[#dce9ff]"><span className="block text-[#75777f]">ختم المستند</span><b className="mt-2 flex items-center justify-center gap-1 text-sm text-[#3f5f92]"><Stamp size={15} /> يُثبت مع القيد</b></div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#c5c6cf] bg-white px-5 py-3">
            <span className="text-[10px] text-[#75777f]">اضغط Esc للإلغاء · الترحيل ينشئ سنداً وقيداً متوازناً</span>
            <div className="flex items-center gap-2"><Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn></div>
          </div>
        </div>
      </Modal>

      <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} title="معاينة السند" wide>
        <div dir="rtl" className="space-y-4 rounded-2xl bg-[#f8f9ff] p-5 text-[#0b1c30] ring-1 ring-[#dce9ff]">
          <div className="flex items-start justify-between gap-3 border-b border-[#c5c6cf] pb-3">
            <div><p className="text-[11px] text-[#75777f]">{setup.shopName || 'نظام الحسابات'}</p><h3 className="mt-1 text-xl font-black">{kind === 'receipt' ? 'سند قبض نقدية' : 'سند دفع وصرف نقدية / بنكي'}</h3></div>
            <span className="rounded-lg bg-[#0f2042] px-3 py-1.5 text-xs font-bold text-white">{kind === 'receipt' ? 'RV' : 'PV'} — مسودة</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-white p-3 ring-1 ring-[#dce9ff]"><span className="block text-[11px] text-[#75777f]">التاريخ</span><b className="mt-1 block font-mono">{voucherDate}</b></div>
            <div className="rounded-lg bg-white p-3 ring-1 ring-[#dce9ff]"><span className="block text-[11px] text-[#75777f]">الطرف</span><b className="mt-1 block">{selectedPartyName || 'غير مرتبط بطرف'}</b></div>
          </div>
          <div className="rounded-xl bg-[#eff4ff] p-4 text-center"><span className="block text-xs text-[#45464e]">المبلغ</span><strong className="mt-1 block font-mono text-3xl text-[#0f2042]">{parsedAmountMinor > 0 ? fmt(parsedAmountMinor) : '0.00'} <small className="text-base">{cur.symbol}</small></strong>{parsedAmountMinor > 0 && <span className="mt-2 block text-[11px] text-[#254778]">{amountInWords(parsedAmountMinor, cur)}</span>}</div>
          <div className="grid gap-3 sm:grid-cols-2 text-xs"><div><span className="text-[#75777f]">الحساب المقابل</span><b className="mt-1 block">{counters.find((item) => item.code === counter)?.label ?? '—'}</b></div><div><span className="text-[#75777f]">البيان</span><b className="mt-1 block">{desc || '—'}</b></div></div>
          <div className="flex justify-end gap-2"><Btn variant="ghost" onClick={() => setPreviewOpen(false)}>إغلاق المعاينة</Btn></div>
        </div>
      </Modal>

      {/* عرض سند وقيده */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing ? `السند ${viewing.voucherNumber}` : ''}>
        {viewing && entry && (
          <div className="space-y-4">
            <div className="text-center p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50">
              <div className={`font-black text-2xl ${viewing.kind === 'receipt' ? 'text-emerald-600' : 'text-rose-500'}`}>
                {viewing.kind === 'receipt' ? '+' : '-'}{fmt(viewing.amountMinor)} {cur.symbol}
              </div>
              {viewing.description && <div className="text-[12px] text-slate-400 mt-1">{viewing.description}</div>}
              {viewing.allocations && <div className="text-[11px] text-indigo-600 mt-2">موزع على {viewing.allocations.length} مستنداً{(viewing.unallocatedMinor ?? 0) > 0 ? ` — تحت الحساب ${fmt(viewing.unallocatedMinor ?? 0)}` : ''}</div>}
            </div>
            {viewing.allocations && viewing.allocations.length > 0 && <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-3 text-[11px] space-y-1"><b>تفصيل توزيع السداد</b>{viewing.allocations.map((allocation) => <div key={allocation.docKey} className="flex justify-between gap-2"><span>{allocation.docLabel}</span><span className="font-bold">{fmt(allocation.appliedMinor)} {cur.symbol}</span></div>)}</div>}
            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.03] overflow-hidden">
              <div className="px-4 py-2.5 text-[12px] font-bold text-rose-600 dark:text-rose-400 border-b border-rose-500/10 flex items-center gap-1.5">
                <BookOpenText size={13} /> القيد المتولد #{entry.entryNumber}
              </div>
              <table className="w-full text-[12px]">
                <tbody>
                  {entry.lines.map((l, i) => (
                    <tr key={i} className="border-t border-rose-500/5">
                      <td className="px-4 py-1.5 text-slate-600 dark:text-slate-300">
                        {l.debit > 0 ? '' : '\u00A0\u00A0\u00A0\u00A0إلى '} {nameOf(l.accountCode)}
                      </td>
                      <td className="px-4 py-1.5 w-28 font-bold">{l.debit > 0 ? fmt(l.debit) : ''}</td>
                      <td className="px-4 py-1.5 w-28 font-bold text-slate-400">{l.credit > 0 ? fmt(l.credit) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between gap-2">
              {viewing.reversalEntryId ? <span className="text-[11px] font-bold text-amber-700 dark:text-amber-400">معكوس بقيد #{viewing.reversalEntryId} — لا يدخل في أرصدة الطرف</span> : <span className="text-[11px] text-slate-400">العكس ينشئ قيداً عاكساً ولا يحذف السند الأصلي.</span>}
              {!viewing.reversalEntryId && <Btn variant="danger" onClick={() => { setReverseTarget(viewing); setReverseReason('') }}>↩️ عكس السند</Btn>}
            </div>
          </div>
        )}
      </Modal>
      <Modal open={!!reverseTarget} onClose={() => setReverseTarget(null)} title={reverseTarget ? `عكس السند ${reverseTarget.voucherNumber}` : ''}>
        <div className="space-y-4">
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-[12px] text-amber-800 dark:text-amber-200">سيُنشأ قيد عاكس Append-only ويُستبعد السند من كشف الطرف والتخصيصات المفتوحة. لا يمكن التراجع عن العكس.</div>
          <Field label="سبب العكس *"><textarea value={reverseReason} onChange={(event) => setReverseReason(event.target.value)} className={inputCls} rows={3} placeholder="مثال: أُدخل السند على الطرف الخطأ…" /></Field>
          <div className="flex justify-end gap-2"><Btn variant="ghost" onClick={() => setReverseTarget(null)}>إلغاء</Btn><Btn variant="danger" onClick={confirmReverse} disabled={!reverseReason.trim()}>تأكيد العكس</Btn></div>
        </div>
      </Modal>
      {paymentApproval.dialog}
      {reverseApproval.dialog}
    </div>
  )
}
