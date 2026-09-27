import { PartyQuickPicker, QuickSelect } from '../components/KeyboardPickers.tsx'
/**
 * التسويات الشاملة (جولة مراجعة الموبايلات — نمط mobileshop):
 * مطابقة الدفاتر بالواقع: عدّ نقدية الخزائن، ومطابقة أرصدة العملاء والموردين —
 * كل فرق يضرب قائمة الدخل عبر 5112 إجبارياً (لا عجز «يتبخر» بتعديل صامت).
 */
import { useMemo, useState } from 'react'
import { Scale, PiggyBank, Users, Truck, AlertTriangle, CheckCircle2, ArrowLeftRight, X } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { Btn, Field, inputCls, useToast, EmptyState, Modal } from '../components/ui.tsx'
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
  // مقاصة عميل/مورد (AUDIT-012): الطرف الواحد الذي هو عميل ومورد معاً
  const [offsetOpen, setOffsetOpen] = useState(false)
  const [offsetCustomer, setOffsetCustomer] = useState(0)
  const [offsetSupplier, setOffsetSupplier] = useState(0)
  const [offsetAmount, setOffsetAmount] = useState('')
  const [offsetNotes, setOffsetNotes] = useState('')
  const [refId, setRefId] = useState<string>('')
  const [actual, setActual] = useState('')
  const [reason, setReason] = useState('')
  const meta = SECTIONS.find((s) => s.id === section)!

  const options = useMemo(() => {
    if (section === 'treasury') return treasuries.map((t) => ({ id: String(t.code), nameAr: `${t.kind === 'cash' ? '💰' : '🏦'} ${t.nameAr}` }))
    if (section === 'customer') return customers.map((c) => ({ id: String(c.id), nameAr: c.nameAr }))
    return suppliers.map((s) => ({ id: String(s.id), nameAr: s.nameAr }))
  }, [section, treasuries, customers, suppliers])

  /**
   * الرصيد الدفتري الحالي — من دوال المتجر نفسها (AUDIT-013):
   * الصفحة كانت تعيد تركيب الكشف يدوياً فتختلف عن باقي الشاشات عند نقاط الولاء والمقاصات.
   */
  const bookMinor = useMemo(() => {
    if (!refId) return null
    if (section === 'treasury') {
      let b = 0
      for (const e of journal) for (const l of e.lines) if (l.accountCode === refId) b += l.debit - l.credit
      return b
    }
    const pid = Number(refId)
    return section === 'customer' ? store.getCustomerBalance(pid) : store.getSupplierBalance(pid)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, refId, journal, settlements, store.sales, store.purchases, store.vouchers, store.cheques, store.openingBalances, store.clientSettlements, store.partyOffsets, store.loyaltyRedemptions])

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

  // ——— مقاصة العميل/المورد ———
  const offsetCustomerBalance = offsetCustomer ? store.getCustomerBalance(offsetCustomer) : 0
  const offsetSupplierBalance = offsetSupplier ? store.getSupplierBalance(offsetSupplier) : 0
  const offsetCapMinor = Math.max(0, Math.min(offsetCustomerBalance, offsetSupplierBalance))
  const offsetAmountMinor = offsetAmount.trim() === '' ? null : (() => { try { return toMinor(offsetAmount, cur.decimals) } catch { return null } })()
  const offsetApproval = useSupervisorApproval('inv.adjust')
  const submitOffset = () => {
    if (!offsetCustomer || !offsetSupplier || !offsetAmountMinor) return
    offsetApproval.request(() => {
      try {
        const doc = store.postPartyOffset({ customerId: offsetCustomer, supplierId: offsetSupplier, amountMinor: offsetAmountMinor, notes: offsetNotes })
        toast.show(`رُحّلت المقاصة ${doc.offsetNumber}: خُفض دين العميل ومستحق المورد بـ${fmt(doc.amountMinor)} ${cur.symbol} بقيد واحد`)
        setOffsetAmount(''); setOffsetNotes(''); setOffsetOpen(false)
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
      <div className="anim-up flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11.5px] text-slate-400">{meta.hint}</p>
        <Btn variant="ghost" onClick={() => setOffsetOpen(true)}><ArrowLeftRight size={14} /> مقاصة عميل/مورد</Btn>
      </div>

      <div className="anim-up grid lg:grid-cols-2 gap-4">
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5 space-y-3">
          <Field label={meta.nameAr}>
            {section === 'treasury' ? <QuickSelect value={refId} onChange={(e) => { setRefId(e.target.value); setActual('') }} className={inputCls}>
              <option value="">— اختر الخزينة/البنك —</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.nameAr}</option>)}
            </QuickSelect> : <PartyQuickPicker parties={section === 'customer' ? customers : suppliers} value={refId ? Number(refId) : 0} onChange={(id) => { setRefId(id ? String(id) : ''); setActual('') }} cashLabel="— اختر —" label={section === 'customer' ? 'بحث العميل' : 'بحث المورد'} showCash={false} />}
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
      {/* مقاصة عميل/مورد — بلغة المستند نفسها (AUDIT-012 + المرحلة 6) */}
      <Modal open={offsetOpen} onClose={() => setOffsetOpen(false)} title="" wide bare>
        <div className="overflow-hidden rounded-3xl doc-sheet" dir="rtl">
          <div className="flex items-center justify-between gap-4 doc-head px-5 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/15"><ArrowLeftRight size={22} /></div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold">مقاصة عميل / مورد</h2>
                  <span className="text-[10px] uppercase tracking-wider doc-head-sub">Party Offset</span>
                  <span className="rounded bg-white/10 px-2 py-0.5 font-mono text-[11px]">OFS — جديد</span>
                </div>
                <p className="mt-0.5 truncate text-[11px] doc-head-sub">الطرف الذي يشتري منك ويبيع لك: بدل أن يدفع لك وتدفع له، تُخصم الأقل من الأكبر بقيد واحد</p>
              </div>
            </div>
            <button type="button" onClick={() => setOffsetOpen(false)} aria-label="إغلاق" className="rounded-lg p-2 text-white/70 transition hover:bg-rose-500 hover:text-white"><X size={18} /></button>
          </div>

          <div className="space-y-4 px-5 py-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2 rounded-xl doc-card doc-ring p-4">
                <Field label="العميل (المدين لنا)">
                  <PartyQuickPicker label="العميل" parties={customers} value={offsetCustomer} onChange={(id) => setOffsetCustomer(id)} cashLabel="— اختر العميل —" />
                </Field>
                <div className="flex items-center justify-between rounded-lg doc-tint px-3 py-2 text-[11px] font-bold doc-accent-deep">
                  <span>مديونية العميل الآن</span><span dir="ltr">{fmt(offsetCustomerBalance)} {cur.symbol}</span>
                </div>
              </div>
              <div className="space-y-2 rounded-xl doc-card doc-ring p-4">
                <Field label="المورد (الدائن علينا)">
                  <PartyQuickPicker label="المورد" parties={suppliers} value={offsetSupplier} onChange={(id) => setOffsetSupplier(id)} cashLabel="— اختر المورد —" />
                </Field>
                <div className="flex items-center justify-between rounded-lg doc-tint px-3 py-2 text-[11px] font-bold doc-accent-deep">
                  <span>مستحق المورد الآن</span><span dir="ltr">{fmt(offsetSupplierBalance)} {cur.symbol}</span>
                </div>
              </div>
            </div>

            <section className="space-y-2 rounded-xl doc-card doc-ring p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Field label={`قيمة المقاصة (${cur.symbol})`} hint={`أقصى مقاصة ممكنة: ${fmt(offsetCapMinor)} ${cur.symbol} — أقل الرصيدين`}>
                  <input value={offsetAmount} onChange={(e) => setOffsetAmount(e.target.value)} className={inputCls} dir="ltr" placeholder="0" />
                </Field>
                <Btn variant="ghost" onClick={() => setOffsetAmount(String(offsetCapMinor / 100))} disabled={offsetCapMinor <= 0}>استخدم الحد الأقصى</Btn>
              </div>
              {offsetAmountMinor != null && offsetAmountMinor > offsetCapMinor && (
                <div className="flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] font-bold text-amber-700">
                  <AlertTriangle size={14} /> المبلغ يتجاوز أقل الرصيدين — المقاصة لا تخلق رصيداً سالباً لأي طرف
                </div>
              )}
              <Field label="ملاحظات (اختياري)">
                <input value={offsetNotes} onChange={(e) => setOffsetNotes(e.target.value)} className={inputCls} placeholder="مثال: تسوية ربع سنوية باتفاق موقّع" />
              </Field>
            </section>

            <section className="rounded-xl doc-band p-4 text-[11.5px] leading-6 doc-ink">
              <b className="mb-1 block">القيد الذي سيُرحَّل</b>
              من ح/ الموردون (2101) بـ<b dir="ltr">{fmt(offsetAmountMinor ?? 0)} {cur.symbol}</b> — إلى ح/ العملاء (1104) بنفس القيمة.
              يظهر صفٌّ في كشف الطرفين، ولا تتأثر الخزينة بقرش (لا نقد يتحرك).
            </section>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 doc-footer px-5 py-3">
            <span className="text-[10px] doc-faint">المقاصة مستند OFS مستقل قابل للمراجعة — لا تعديل صامت على أي رصيد</span>
            <div className="flex items-center gap-2">
              <Btn variant="ghost" onClick={() => setOffsetOpen(false)}>إلغاء</Btn>
              <Btn onClick={submitOffset} disabled={!offsetCustomer || !offsetSupplier || !offsetAmountMinor || offsetAmountMinor > offsetCapMinor}>ترحيل المقاصة</Btn>
            </div>
          </div>
        </div>
      </Modal>
      {offsetApproval.dialog}
      {approval.dialog}
    </div>
  )
}
