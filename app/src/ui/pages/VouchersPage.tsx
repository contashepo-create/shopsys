/**
 * سندات القبض والصرف (المرحلة 4) —
 * قبض: نقدية داخلة (سداد عميل، إيراد آخر، رأس مال…)
 * صرف: نقدية خارجة (سداد مورد، مصروف، مسحوبات…)
 * كل سند يولّد قيده المتوازن فوراً ويظهر في اليومية.
 */
import { useMemo, useState } from 'react'
import { ArrowDownCircle, ArrowUpCircle, BookOpenText, FileSpreadsheet, Printer } from 'lucide-react'
import { useDataStore, type Voucher } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import type { TreasuryAccount } from '../../core/accounting.ts'
import { Btn, Modal, Field, inputCls, useToast, EmptyState } from '../components/ui.tsx'
import { useSupervisorApproval } from '../components/SupervisorPinDialog.tsx'
import { TreasuryPicker } from '../components/TreasuryPicker.tsx'
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

export function VouchersPage() {
  const { vouchers, journal, treasuries, customers, suppliers, purchases, customAccounts, addCustomAccount, postVoucher, addLatePurchaseExpense, sales, saleReturns, cheques, purchaseReturns, clientSettlements, openingBalances, trips, tickets, rentalContracts , clinicVisits, clinicCollections, clinicPatients, labOrders, labPatients, walletOps, projectExtracts, projects, installmentPlans, assets, getAssetDue, laundryOrders, cars, consignmentCars, vehicles } = useDataStore()
  const nameOf = (code: string) => treasuries.find((t) => t.code === code)?.nameAr ?? ACCOUNT_NAMES[code] ?? code
  const { setup } = useAppStore()
  const toast = useToast()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)

  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<'receipt' | 'payment'>('receipt')
  const [treasury, setTreasury] = useState<TreasuryAccount>('1101')
  const [counter, setCounter] = useState('')
  const [amount, setAmount] = useState('')
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
  const [vehicleCostCategory, setVehicleCostCategory] = useState('maintenance')
  const [viewing, setViewing] = useState<Voucher | null>(null)

  const entry = viewing ? journal.find((e) => e.id === viewing.journalEntryId) : null
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

  const openNew = (k: 'receipt' | 'payment') => {
    setKind(k)
    setTreasury('1101')
    setCounter('')
    setAmount('')
    setDesc('')
    setPartyId(0)
    setPurchaseId(0)
    setExpMethod('qty')
    setExpPaidBy('treasury')
    setExpBeneficiary('')
    setExpPayableAccount('2117')
    setVehicleId(null)
    setVehicleCostCategory('maintenance')
    setOpen(true)
  }

  // سداد عميل (1104) في القبض أو سداد مورد (2101) في الصرف ⇒ نطلب تحديد الطرف
  const needsParty = (kind === 'receipt' && counter === '1104') || (kind === 'payment' && counter === '2101')
  const isPurchaseExpense = kind === 'payment' && counter === PURCHASE_EXPENSE_CODE
  const isCustomExpense = kind === 'payment' && customAccounts.some((account) => account.code === counter && account.rootType === 'expenses')
  // ربط السيارة خاص بمصروفات التشغيل/المصروفات المستحقة فقط، وليس بسداد
  // مورد أو راتب أو مسحوبات. مصروف فاتورة الشراء له حقله المستقل أدناه.
  const canLinkVehicle = kind === 'payment' && !isPurchaseExpense && (counter === '5108' || counter === '2117' || isCustomExpense)

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
          vehicleId,
          category: vehicleId != null ? vehicleCostCategory : undefined,
          date: new Date().toISOString().slice(0, 10),
        })
        toast.show(`سُجّل المصروف على الفاتورة ${updated.invoiceNumber} — توزع على أصنافها وتحدثت تكلفتها ✓`)
        setOpen(false)
        return
      }
      const v = postVoucher({
        kind,
        treasury,
        counterAccountCode: counter,
        amountMinor: toMinor(amount || '0', cur.decimals),
        description: desc.trim(),
        partyKind: needsParty ? (kind === 'receipt' ? 'customer' : 'supplier') : null,
        partyId: needsParty ? partyId : null,
        vehicleId: canLinkVehicle ? vehicleId : null,
        vehicleCostCategory: canLinkVehicle && vehicleId != null ? vehicleCostCategory : undefined,
      })
      toast.show(`تم ${kind === 'receipt' ? 'سند القبض' : 'سند الصرف'} ${v.voucherNumber} — تولد قيده تلقائياً ✓`)
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

      {/* سند جديد */}
      <Modal open={open} onClose={() => setOpen(false)} title={kind === 'receipt' ? '⬇️ سند قبض — نقدية داخلة' : isPurchaseExpense && expPaidBy === 'payable' ? '🧾 إثبات مصروف مستحق — بلا حركة خزينة' : '⬆️ سند صرف — نقدية خارجة'}>
        <div className="space-y-4">
          {!(isPurchaseExpense && expPaidBy === 'payable') && (
            <Field label="إلى/من الخزينة أو البنك" hint="كل الخزائن والبنوك المسجلة — أضف المزيد من شاشة الخزائن">
              <TreasuryPicker value={treasury} onChange={(c) => setTreasury(c as TreasuryAccount)} operation={kind} />
            </Field>
          )}
          <Field label={kind === 'receipt' ? 'مصدر النقدية (الحساب المقابل)' : 'وجهة النقدية (الحساب المقابل)'}>
            <select value={counter} onChange={(e) => { setCounter(e.target.value); setPartyId(0) }} className={inputCls}>
              <option value="">اختر…</option>
              {counters.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </Field>
          <button type="button" onClick={()=>setQuickAccountOpen(!quickAccountOpen)} className="text-[11px] font-bold text-brand-600 hover:underline">+ إضافة بند {kind==='payment'?'مصروف':'إيراد'} جديد</button>
          {quickAccountOpen&&<div className="grid grid-cols-[110px_1fr_auto] gap-2 rounded-xl border border-brand-500/20 bg-brand-500/5 p-2"><input className={inputCls} value={quickAccountCode} onChange={e=>setQuickAccountCode(e.target.value)} placeholder={kind==='payment'?'51xx':'41xx'} dir="ltr"/><input className={inputCls} value={quickAccountName} onChange={e=>setQuickAccountName(e.target.value)} placeholder="اسم البند"/><Btn onClick={addQuickAccount} disabled={!quickAccountCode.trim()||!quickAccountName.trim()}>إضافة</Btn></div>}
          {needsParty && (
            <Field label={kind === 'receipt' ? 'أي عميل؟ *' : 'أي مورد؟ *'} hint="يظهر السند في كشف حسابه">
              <select value={partyId} onChange={(e) => setPartyId(Number(e.target.value))} className={inputCls}>
                <option value={0}>اختر…</option>
                {(kind === 'receipt' ? customers : suppliers).map((p) => <option key={p.id} value={p.id}>{p.nameAr}</option>)}
              </select>
            </Field>
          )}
          {needsParty && partyId > 0 && liveBalance !== null && (
            <div className={`rounded-xl p-3 text-[12.5px] font-bold border ${liveBalance > 0 ? 'bg-rose-500/5 border-rose-500/20 text-rose-600' : liveBalance < 0 ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-600' : 'bg-slate-500/5 border-slate-500/20 text-slate-500'}`}>
              {kind === 'receipt'
                ? liveBalance > 0 ? `💳 الرصيد الحالي: عليه ${fmt(liveBalance)} ${cur.symbol}` : liveBalance < 0 ? `💳 الرصيد الحالي: له عندك ${fmt(-liveBalance)} ${cur.symbol}` : '💳 رصيده صفر — لا مديونية'
                : liveBalance > 0 ? `💳 الرصيد الحالي: مستحق له ${fmt(liveBalance)} ${cur.symbol}` : liveBalance < 0 ? `💳 الرصيد الحالي: لك عنده ${fmt(-liveBalance)} ${cur.symbol}` : '💳 رصيده صفر'}
            </div>
          )}
          {kind === 'payment' && counter === '2101' && partyId > 0 && (() => {
            // أقساط الأصول المشتراة آجلاً من هذا المورد — تظهر عند سند الصرف (طلب المالك)
            const supplierAssets = assets
              .map((a) => ({ a, due: getAssetDue(a.id) }))
              .filter((x) => x.a.supplierId === partyId && x.due.remainingMinor > 0)
            if (supplierAssets.length === 0) return null
            return (
              <div className="rounded-xl p-3 border border-amber-500/25 bg-amber-500/5 space-y-1.5">
                <div className="text-[11.5px] font-black text-amber-700 dark:text-amber-400">🏛️ أقساط أصول مستحقة لهذا المورد:</div>
                {supplierAssets.map(({ a, due }) => (
                  <div key={a.id} className="text-[11px] text-slate-600 dark:text-slate-300 flex items-center justify-between gap-2">
                    <span>{a.assetNumber} — {a.nameAr}</span>
                    <span className="font-bold">
                      متبقٍ {fmt(due.remainingMinor)} {cur.symbol}
                      {due.nextInstallment ? ` · قسط ${fmt(due.nextInstallment.amountMinor - due.nextInstallment.paidMinor)} يستحق ${due.nextInstallment.dueDate}` : ''}
                    </span>
                  </div>
                ))}
                <div className="text-[10px] text-slate-400">السداد الموصى به من ملف الأصل (الحسابات ← الأصول والإهلاك ← 📂 الملف) ليُحدَّث جدول الأقساط تلقائياً</div>
              </div>
            )
          })()}
          {canLinkVehicle && (
            <div className="grid sm:grid-cols-2 gap-2 rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/5 p-3">
              <Field label="مركز تكلفة المركبة (اختياري)" hint="يظهر فقط مع مصروفات التشغيل/المصروفات المستحقة، وليس مع سداد المورد أو الراتب">
                <select value={vehicleId ?? ''} onChange={(e) => setVehicleId(e.target.value ? Number(e.target.value) : null)} className={inputCls}>
                  <option value="">بدون مركبة</option>
                  {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.plateNumber} — {vehicle.vehicleType}</option>)}
                </select>
              </Field>
              {vehicleId != null && (
                <Field label="نوع مصروف السيارة">
                  <select value={vehicleCostCategory} onChange={(e) => setVehicleCostCategory(e.target.value)} className={inputCls}>
                    {VEHICLE_COST_CATEGORIES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                  </select>
                </Field>
              )}
            </div>
          )}
          {isPurchaseExpense && (
            <>
              <Field label="طريقة إثبات مصروف الفاتورة" hint="الإثبات كمستحق لا ينشئ حركة خزينة؛ يمكنك السداد لاحقاً من الاستحقاقات">
                <div className="flex rounded-xl overflow-hidden border-2 border-slate-200 dark:border-slate-700 w-fit">
                  {([['treasury', '💵 مدفوع الآن'], ['payable', '🧾 مستحق لاحقاً']] as const).map(([mode, label]) => (
                    <button key={mode} type="button" onClick={() => setExpPaidBy(mode)} className={`px-4 py-2 text-[11px] font-bold ${expPaidBy === mode ? 'bg-sky-500 text-white' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>{label}</button>
                  ))}
                </div>
              </Field>
              {expPaidBy === 'payable' && (
                <div className="grid sm:grid-cols-2 gap-2">
                  <Field label="الجهة المستحقة *"><input value={expBeneficiary} onChange={(e) => setExpBeneficiary(e.target.value)} className={inputCls} placeholder="شركة النقل / الجمارك…" /></Field>
                  <Field label="حساب الاستحقاق"><select value={expPayableAccount} onChange={(e) => setExpPayableAccount(e.target.value)} className={inputCls}><option value="2117">مصاريف مستحقة (2117)</option><option value="2101">الموردون (2101)</option></select></Field>
                </div>
              )}
              <div className="grid sm:grid-cols-2 gap-2">
                <Field label="مركز تكلفة السيارة (اختياري)" hint="سيظهر التحميل ضمن ربحية مركبة الأسطول؛ سيارات المعرض منفصلة">
                  <select value={vehicleId ?? ''} onChange={(e) => setVehicleId(e.target.value ? Number(e.target.value) : null)} className={inputCls}>
                    <option value="">بدون مركبة</option>
                    {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.plateNumber} — {vehicle.vehicleType}</option>)}
                  </select>
                </Field>
                {vehicleId != null && (
                  <Field label="نوع مصروف السيارة">
                    <select value={vehicleCostCategory} onChange={(e) => setVehicleCostCategory(e.target.value)} className={inputCls}>
                      {VEHICLE_COST_CATEGORIES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                    </select>
                  </Field>
                )}
              </div>
              <Field label="أي فاتورة شراء؟ *" hint="المصروف يوزَّع على أصنافها ويرفع تكلفتها بالمتوسط المرجح؛ اختر مدفوعاً أو مستحقاً بلا دفع فوري">
                <select value={purchaseId} onChange={(e) => setPurchaseId(Number(e.target.value))} className={inputCls}>
                  <option value={0}>اختر…</option>
                  {[...purchases].reverse().slice(0, 50).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.invoiceNumber} — {suppliers.find((s) => s.id === p.supplierId)?.nameAr ?? '—'} ({p.date})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="توزيع المصروف على الأصناف">
                <div className="flex rounded-xl overflow-hidden border-2 border-slate-200 dark:border-slate-700 w-fit">
                  {([['qty', 'بالكمية'], ['value', 'بالقيمة']] as const).map(([m, label]) => (
                    <button key={m} type="button" onClick={() => setExpMethod(m)}
                      className={`px-4 py-2 text-[11px] font-bold transition-colors ${expMethod === m ? 'bg-amber-500 text-white' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </Field>
            </>
          )}
          <Field label={`المبلغ (${cur.symbol})`}>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className={inputCls} dir="ltr" autoFocus />
          </Field>
          <Field label="البيان">
            <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="سداد فاتورة يناير…" className={inputCls} />
          </Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn onClick={save} shortcut="F9" disabled={!counter || !amount.trim() || (needsParty && !partyId) || (isPurchaseExpense && (!purchaseId || !desc.trim() || (expPaidBy === 'payable' && !expBeneficiary.trim())))}>💾 حفظ السند</Btn>
          </div>
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
            </div>
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
          </div>
        )}
      </Modal>
      {paymentApproval.dialog}
    </div>
  )
}
