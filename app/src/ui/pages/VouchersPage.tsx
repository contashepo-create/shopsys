/**
 * سندات القبض والصرف (المرحلة 4) —
 * قبض: نقدية داخلة (سداد عميل، إيراد آخر، رأس مال…)
 * صرف: نقدية خارجة (سداد مورد، مصروف، مسحوبات…)
 * كل سند يولّد قيده المتوازن فوراً ويظهر في اليومية.
 */
import { useMemo, useState } from 'react'
import { ArrowDownCircle, ArrowUpCircle, BookOpenText } from 'lucide-react'
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
const PAYMENT_COUNTERS = [
  { code: '2101', label: 'سداد لمورد (تخفيض ديننا له)' },
  { code: PURCHASE_EXPENSE_CODE, label: 'مصروف على فاتورة شراء (نولون/جمارك… يرفع تكلفة أصنافها)' },
  { code: '5103', label: 'إيجار المحل' },
  { code: '5104', label: 'كهرباء ومياه' },
  // سداد مسير مرحّل «استحقاقاً» يصفّي 2104 — أما 5102 فلأجور يومية عارضة لم تدخل مسيراً
  { code: '2104', label: 'سداد رواتب مستحقة (مسير استحقاق سابق)' },
  { code: '5102', label: 'أجور يومية عارضة (بلا مسير)' },
  { code: '5108', label: 'مصروفات عمومية' },
  { code: '3101', label: 'مسحوبات شخصية (تخفيض رأس المال)' },
]

export function VouchersPage() {
  const { vouchers, journal, treasuries, customers, suppliers, purchases, customAccounts, postVoucher, addLatePurchaseExpense, sales, saleReturns, cheques, purchaseReturns, clientSettlements, openingBalances, trips, tickets, rentalContracts , clinicVisits, clinicCollections, clinicPatients, labOrders, labPatients, walletOps, projectExtracts, projects, installmentPlans, assets, getAssetDue, laundryOrders, cars, consignmentCars } = useDataStore()
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
  const [partyId, setPartyId] = useState(0) // العميل (قبض 1104) أو المورد (صرف 2101) — يغذي كشف الحساب
  const [purchaseId, setPurchaseId] = useState(0) // فاتورة الشراء عند «مصروف على فاتورة شراء»
  const [expMethod, setExpMethod] = useState<'value' | 'qty'>('qty') // توزيع مصروف الفاتورة
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
  const listed = useMemo(() => [...vouchers].filter((v) => v.kind !== 'transfer').reverse(), [vouchers])

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
    setOpen(true)
  }

  // سداد عميل (1104) في القبض أو سداد مورد (2101) في الصرف ⇒ نطلب تحديد الطرف
  const needsParty = (kind === 'receipt' && counter === '1104') || (kind === 'payment' && counter === '2101')
  const isPurchaseExpense = kind === 'payment' && counter === PURCHASE_EXPENSE_CODE

  // خروج النقدية (سند صرف) عملية حساسة — اعتماد مشرف؛ القبض إدخال أموال يمر مباشرة
  const paymentApproval = useSupervisorApproval('trs.payment.approve')
  const save = () => {
    if (kind === 'payment') { paymentApproval.request(() => doSave()); return }
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
          paidBy: 'treasury',
          payAccount: treasury,
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
      })
      toast.show(`تم ${kind === 'receipt' ? 'سند القبض' : 'سند الصرف'} ${v.voucherNumber} — تولد قيده تلقائياً ✓`)
      setOpen(false)
    } catch (e) {
      toast.show((e as Error).message, 'error')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between anim-up flex-wrap gap-2">
        <div className="text-sm text-slate-500">كل سند يولّد قيداً متوازناً فوراً — لا نقدية تتحرك خارج الدفاتر</div>
        <div className="flex gap-2">
          <Btn onClick={() => openNew('receipt')}><ArrowDownCircle size={15} /> سند قبض</Btn>
          <Btn variant="ghost" onClick={() => openNew('payment')} className="!text-rose-600 border-2 border-rose-500/30 hover:!bg-rose-500/5">
            <ArrowUpCircle size={15} /> سند صرف
          </Btn>
        </div>
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
      <Modal open={open} onClose={() => setOpen(false)} title={kind === 'receipt' ? '⬇️ سند قبض — نقدية داخلة' : '⬆️ سند صرف — نقدية خارجة'}>
        <div className="space-y-4">
          <Field label="إلى/من الخزينة أو البنك" hint="كل الخزائن والبنوك المسجلة — أضف المزيد من شاشة الخزائن">
            <TreasuryPicker value={treasury} onChange={(c) => setTreasury(c as TreasuryAccount)} />
          </Field>
          <Field label={kind === 'receipt' ? 'مصدر النقدية (الحساب المقابل)' : 'وجهة النقدية (الحساب المقابل)'}>
            <select value={counter} onChange={(e) => { setCounter(e.target.value); setPartyId(0) }} className={inputCls}>
              <option value="">اختر…</option>
              {counters.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </Field>
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
          {isPurchaseExpense && (
            <>
              <Field label="أي فاتورة شراء؟ *" hint="المصروف يوزَّع على أصنافها ويرفع تكلفتها بالمتوسط المرجح — لن يُضاف لدين المورد">
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
            <Btn onClick={save} disabled={!counter || !amount.trim() || (needsParty && !partyId) || (isPurchaseExpense && (!purchaseId || !desc.trim()))}>💾 حفظ السند</Btn>
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
