import { QuickSelect } from '../components/KeyboardPickers.tsx'
/**
 * التسويات الشاملة (جولة مراجعة الموبايلات — نمط mobileshop):
 * مطابقة الدفاتر بالواقع: عدّ نقدية الخزائن، ومطابقة أرصدة العملاء والموردين —
 * كل فرق يضرب قائمة الدخل عبر 5112 إجبارياً (لا عجز «يتبخر» بتعديل صامت).
 */
import { useMemo, useState } from 'react'
import { Scale, PiggyBank, Users, Truck, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { customerStatement, customerUnitDocs, supplierStatement, statementBalance } from '../../core/statements.ts'
import { Btn, Field, inputCls, useToast, EmptyState } from '../components/ui.tsx'
import { useSupervisorApproval } from '../components/SupervisorPinDialog.tsx'

type Section = 'treasury' | 'customer' | 'supplier'

const SECTIONS: { id: Section; nameAr: string; icon: typeof Scale; hint: string }[] = [
  { id: 'treasury', nameAr: 'الخزائن والبنوك', icon: PiggyBank, hint: 'عُدّ النقدية الفعلية بالدرج/الحساب — العجز مصروف والزيادة تخفيض مصروف، ولا يُقبل عدّ سالب' },
  { id: 'customer', nameAr: 'العملاء', icon: Users, hint: 'الرصيد المتفق عليه بعد مطابقة الكشف مع العميل — إعدام دين أو خصم اتفاق يوثق هنا بقيده' },
  { id: 'supplier', nameAr: 'الموردون', icon: Truck, hint: 'الرصيد المتفق عليه مع المورد — فرق مكتشف لصالحه يزيد الدائن ويضرب المصروف' },
]

export function SettlementsPage() {
  const store = useDataStore()
  const { treasuries, customers, suppliers, journal, settlements, applySettlement } = store
  const { setup } = useAppStore()
  const toast = useToast()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)

  const [section, setSection] = useState<Section>('treasury')
  const [refId, setRefId] = useState<string>('')
  const [actual, setActual] = useState('')
  const [reason, setReason] = useState('')
  const meta = SECTIONS.find((s) => s.id === section)!

  const options = useMemo(() => {
    if (section === 'treasury') return treasuries.map((t) => ({ id: String(t.code), nameAr: `${t.kind === 'cash' ? '💰' : '🏦'} ${t.nameAr}` }))
    if (section === 'customer') return customers.map((c) => ({ id: String(c.id), nameAr: c.nameAr }))
    return suppliers.map((s) => ({ id: String(s.id), nameAr: s.nameAr }))
  }, [section, treasuries, customers, suppliers])

  /** الرصيد الدفتري الحالي — نفس مصادر شاشات الكشوف والخزائن (لا حساب موازٍ) */
  const bookMinor = useMemo(() => {
    if (!refId) return null
    if (section === 'treasury') {
      let b = 0
      for (const e of journal) for (const l of e.lines) if (l.accountCode === refId) b += l.debit - l.credit
      return b
    }
    const pid = Number(refId)
    if (section === 'customer') {
      return statementBalance(customerStatement({
        customerId: pid,
        openingMinor: store.openingBalances[`customer:${pid}`] ?? 0,
        sales: store.sales, saleReturns: store.saleReturns, allSales: store.sales,
        extraDocs: customerUnitDocs({ customerId: pid, trips: store.trips, tickets: store.tickets, rentals: store.rentalContracts, clinicVisits: store.clinicVisits, clinicCollections: store.clinicCollections, linkedPatientIds: store.clinicPatients.filter((p) => p.linkedCustomerId === pid).map((p) => p.id), labOrders: store.labOrders, linkedLabPatientIds: store.labPatients.filter((p) => p.linkedCustomerId === pid).map((p) => p.id), walletOps: store.walletOps, projectExtracts: store.projectExtracts, linkedProjectIds: store.projects.filter((p) => p.clientId === pid).map((p) => p.id), installmentPlans: store.installmentPlans, laundryOrders: store.laundryOrders, cars: store.cars, consignmentCars: store.consignmentCars }),
        vouchers: [
          ...store.vouchers,
          ...store.clientSettlements.map((st) => ({ voucherNumber: st.settlementNumber, kind: 'receipt', date: st.date, partyKind: 'customer', partyId: st.customerId, amountMinor: st.amountMinor })),
        ],
        cheques: store.cheques,
        adjustments: settlements.filter((st) => st.section === 'customer' && Number(st.refId) === pid).map((st) => ({
          docLabel: `تسوية ${st.settlementNumber}`, date: st.date.slice(0, 10),
          debitMinor: st.varianceMinor > 0 ? st.varianceMinor : 0,
          creditMinor: st.varianceMinor < 0 ? -st.varianceMinor : 0,
        })),
      }))
    }
    return statementBalance(supplierStatement({
      supplierId: pid,
      openingMinor: store.openingBalances[`supplier:${pid}`] ?? 0,
      purchases: store.purchases, purchaseReturns: store.purchaseReturns, allPurchases: store.purchases,
      vouchers: store.vouchers, cheques: store.cheques,
      adjustments: settlements.filter((st) => st.section === 'supplier' && Number(st.refId) === pid).map((st) => ({
        docLabel: `تسوية ${st.settlementNumber}`, date: st.date.slice(0, 10),
        debitMinor: st.varianceMinor < 0 ? -st.varianceMinor : 0,
        creditMinor: st.varianceMinor > 0 ? st.varianceMinor : 0,
      })),
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, refId, journal, settlements, store.sales, store.purchases, store.vouchers, store.cheques, store.openingBalances, store.clientSettlements])

  const actualMinor = actual.trim() === '' ? null : (() => { try { return toMinor(actual, cur.decimals) } catch { return null } })()
  const variance = bookMinor != null && actualMinor != null ? actualMinor - bookMinor : null

  // التسويات تضرب حساب 5112 مباشرة — عملية حساسة تتطلب اعتماد مشرف (inv.adjust)
  const approval = useSupervisorApproval('inv.adjust')
  const submit = () => {
    if (!refId || actualMinor == null) return
    approval.request((approvedBy) => {
    try {
      const doc = applySettlement({ section, refId: section === 'treasury' ? refId : Number(refId), actualMinor, reason, approvedBy })
      toast.show(
        doc.varianceMinor === 0
          ? `مطابقة تامة ✓ وُثقت ${doc.settlementNumber} بلا قيد (لا فرق)`
          : `رُحّلت ${doc.settlementNumber}: فرق ${fmt(Math.abs(doc.varianceMinor))} ${cur.symbol} ضرب حساب فروق التسويات 5112`,
      )
      setActual(''); setReason('')
    } catch (e) { toast.show((e as Error).message, 'error') }
    })
  }

  return (
    <div className="space-y-4">
      <p className="anim-up text-[12px] text-slate-400 max-w-2xl leading-relaxed">
        <Scale size={14} className="inline -mt-0.5 ml-1" />
        طابق الدفاتر بالواقع دورياً: أي فرق <b>يُرحّل لقائمة الدخل</b> عبر حساب «فروق التسويات 5112» —
        لا يوجد تعديل رصيد صامت يجعل عجزاً يختفي بلا أثر. جرد المخزون له شاشته الخاصة (الجرد).
      </p>

      <div className="anim-up flex gap-1.5 flex-wrap">
        {SECTIONS.map((s) => {
          const Icon = s.icon
          return (
            <button key={s.id} onClick={() => { setSection(s.id); setRefId(''); setActual(''); setReason('') }}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[12px] font-bold border-2 transition-all duration-200 ${
                section === s.id ? 'border-brand-500/60 bg-brand-500/10 text-brand-600' : 'border-slate-200 dark:border-slate-700 text-slate-400 hover:border-slate-300'
              }`}>
              <Icon size={14} /> {s.nameAr}
            </button>
          )
        })}
      </div>
      <p className="text-[11.5px] text-slate-400">{meta.hint}</p>

      <div className="anim-up grid lg:grid-cols-2 gap-4">
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5 space-y-3">
          <Field label={meta.nameAr}>
            <QuickSelect value={refId} onChange={(e) => { setRefId(e.target.value); setActual('') }} className={inputCls}>
              <option value="">— اختر —</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.nameAr}</option>)}
            </QuickSelect>
          </Field>
          {refId && bookMinor != null && (
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 px-4 py-3 flex items-center justify-between">
              <span className="text-[11.5px] text-slate-400 font-bold">الرصيد الدفتري الآن</span>
              <span className="font-black text-slate-700 dark:text-slate-200" dir="ltr">{fmt(bookMinor)} {cur.symbol}</span>
            </div>
          )}
          <Field label={`الرصيد الفعلي المعدود/المتفق عليه (${cur.symbol})`} hint={section === 'treasury' ? 'عدّ النقدية بالدرج — لا يُقبل سالب' : 'الرصيد النهائي بعد المطابقة مع الطرف'}>
            <input value={actual} onChange={(e) => setActual(e.target.value)} className={inputCls} dir="ltr" placeholder="0" />
          </Field>
          {variance != null && (
            <div className={`rounded-xl px-4 py-3 flex items-center justify-between ${variance === 0 ? 'bg-emerald-500/10' : 'bg-amber-500/10'}`}>
              <span className="text-[11.5px] font-bold flex items-center gap-1.5">
                {variance === 0 ? <CheckCircle2 size={14} className="text-emerald-600" /> : <AlertTriangle size={14} className="text-amber-600" />}
                {variance === 0 ? 'مطابقة تامة — لا قيد' : variance > 0 ? 'زيادة عن الدفاتر' : 'عجز عن الدفاتر'}
              </span>
              <span className={`font-black ${variance === 0 ? 'text-emerald-600' : 'text-amber-600'}`} dir="ltr">{fmt(Math.abs(variance))} {cur.symbol}</span>
            </div>
          )}
          <Field label="سبب التسوية" hint="إلزامي — يظهر في القيد وسجل المراجعة">
            <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} placeholder="مثال: جرد نهاية الشهر / اتفاق مع العميل على خصم…" />
          </Field>
          <Btn onClick={submit} shortcut="F9" disabled={!refId || actualMinor == null || !reason.trim()} className="w-full">ترحيل التسوية</Btn>
        </div>

        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 text-[12px] font-black text-slate-500">سجل التسويات</div>
          {settlements.length === 0 ? (
            <EmptyState icon="⚖️" title="لا تسويات بعد" sub="كل تسوية تُوثق بمستند SET-#### وقيدها إن وُجد فرق" />
          ) : (
            <table className="w-full text-[11.5px]">
              <thead>
                <tr className="text-right text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                  <th className="px-3 py-2">المستند</th>
                  <th className="px-3 py-2">الجهة</th>
                  <th className="px-3 py-2">الدفتري</th>
                  <th className="px-3 py-2">الفعلي</th>
                  <th className="px-3 py-2">الفرق</th>
                </tr>
              </thead>
              <tbody>
                {[...settlements].reverse().slice(0, 50).map((st) => (
                  <tr key={st.id} className="border-b border-slate-50 dark:border-slate-800/50">
                    <td className="px-3 py-2">
                      <div className="font-bold text-slate-700 dark:text-slate-200">{st.settlementNumber}</div>
                      <div className="text-[9.5px] text-slate-400">{st.date.slice(0, 10)} — {st.reason}</div>
                    </td>
                    <td className="px-3 py-2 font-bold text-slate-500">{st.refNameAr}</td>
                    <td className="px-3 py-2 font-mono" dir="ltr">{fmt(st.bookMinor)}</td>
                    <td className="px-3 py-2 font-mono" dir="ltr">{fmt(st.actualMinor)}</td>
                    <td className={`px-3 py-2 font-mono font-bold ${st.varianceMinor === 0 ? 'text-emerald-600' : st.varianceMinor > 0 ? 'text-sky-600' : 'text-rose-500'}`} dir="ltr">
                      {st.varianceMinor > 0 ? '+' : ''}{fmt(st.varianceMinor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {approval.dialog}
    </div>
  )
}
