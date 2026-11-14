import { useState } from 'react'
import { useDataStore } from '../../data/repo.ts'
import { financialEntityBasis, type FinancialEntityProfile } from '../../core/financialEntities.ts'
import { Btn, inputCls, useToast } from '../components/ui.tsx'

/** إعداد وصفي فقط، لا ينتج ميزانية للكيان أو ينقل قيداً بين الفروع. */
export function FinancialEntitiesSettings() {
  const { branches, financialEntityProfiles: profiles, saveFinancialEntityProfile, removeFinancialEntityProfile } = useDataStore()
  const toast = useToast()
  const [draft, setDraft] = useState<FinancialEntityProfile | null>(null)
  const [basis, setBasis] = useState('')
  const [reason, setReason] = useState('')
  const start = (profile?: FinancialEntityProfile) => {
    setBasis(financialEntityBasis(profiles, branches))
    setDraft(profile ? { ...profile, branchIds: [...profile.branchIds] } : { id: '', nameAr: '', branchIds: [], framework: 'undetermined', externalAudit: 'undetermined' })
    setReason('')
  }
  const save = () => {
    if (!draft) return
    try {
      saveFinancialEntityProfile({ ...draft, id: draft.id || undefined }, basis, reason)
      setDraft(null)
      toast.show('حُفظ الإعداد الوصفي؛ راجع التوزيع والقوائم مع المختص')
    } catch (e) { toast.show(e instanceof Error ? e.message : 'تعذر الحفظ', 'error') }
  }
  const remove = () => {
    if (!draft?.id) return
    try {
      removeFinancialEntityProfile(draft.id, basis, reason)
      setDraft(null)
      toast.show('حُذف الإعداد الوصفي دون حذف قيود أو فروع')
    } catch (e) { toast.show(e instanceof Error ? e.message : 'تعذر الحذف', 'error') }
  }
  const frameworkLabel = (value: FinancialEntityProfile['framework']) => ({ undetermined: 'غير محدد', sme: 'المنشآت الصغيرة والمتوسطة', full: 'المعايير الدولية الكاملة' })[value]
  const auditLabel = (value: FinancialEntityProfile['externalAudit']) => ({ undetermined: 'غير محدد', required: 'مراجع خارجي مطلوب حسب مراجعة المختص', exempt: 'إعفاء حسب مراجعة المختص' })[value]
  return <section className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4 space-y-3" aria-label="إعداد كيانات القوائم">
    <h2 className="font-black">إعداد كيانات القوائم (للمالك)</h2>
    <p className="text-sm text-amber-700">إعداد وصفي للمراجعة فقط: لا يفصل الدفاتر أو يغير إسناد القيود، ولا ينتج قوائم للكيان أو توحيداً أو ملف إيداع. لا يُثبت اختيار الإطار أو الإعفاء أهلية المنشأة نظامياً. راجع المختص قبل الاعتماد.</p>
    {!branches.length && <p className="text-sm">وضع الفرع الواحد: لا توجد فروع مسجلة للربط. يمكن حفظ إعداد وصفي للمنشأة دون فروع؛ لا ينسب الإعداد القيود إليها.</p>}
    {branches.length > 0 && <p className="text-sm">يمكن ربط الفرع بكيان واحد أو تركه غير محدد. الربط الحالي ليس تاريخياً ولا يعيد توزيع الحركات السابقة.</p>}
    {!profiles.length && <p className="text-sm">لم تُحدد كيانات بعد؛ لا تفترض أن الفروع شركة واحدة أو كيانات مستقلة.</p>}
    <ul className="space-y-2">{profiles.map(profile => <li key={profile.id} className="border rounded-xl p-3 text-sm">
      <strong>{profile.nameAr}</strong> — الإطار: {frameworkLabel(profile.framework)} — المراجع: {auditLabel(profile.externalAudit)}
      <div>الفروع: {profile.branchIds.length ? profile.branchIds.map(id => branches.find(b => b.id === id)?.nameAr ?? `فرع مفقود #${id}`).join('، ') : 'لم تحدد'}</div>
      <button type="button" className="text-teal-600 underline" onClick={() => start(profile)}>تعديل الإعداد</button>
    </li>)}</ul>
    {!draft && <Btn onClick={() => start()}>إضافة إعداد كيان</Btn>}
    {draft && <div className="space-y-3 border rounded-xl p-3">
      <label className="block text-sm">اسم المنشأة أو الكيان<input className={inputCls} value={draft.nameAr} maxLength={200} onChange={e => setDraft({ ...draft, nameAr: e.target.value })} /></label>
      <label className="block text-sm">إطار إعداد القوائم<select className={inputCls} value={draft.framework} onChange={e => setDraft({ ...draft, framework: e.target.value as FinancialEntityProfile['framework'] })}><option value="undetermined">غير محدد</option><option value="sme">المنشآت الصغيرة والمتوسطة</option><option value="full">المعايير الدولية الكاملة</option></select></label>
      <label className="block text-sm">حالة المراجع حسب مراجعة المختص<select className={inputCls} value={draft.externalAudit} onChange={e => setDraft({ ...draft, externalAudit: e.target.value as FinancialEntityProfile['externalAudit'] })}><option value="undetermined">غير محدد</option><option value="required">مراجع خارجي مطلوب</option><option value="exempt">معفاة حسب مراجعة المختص</option></select></label>
      {branches.length > 0 && <fieldset><legend className="text-sm font-bold">الفروع المرتبطة</legend>{branches.map(branch => <label key={branch.id} className="block text-sm"><input type="checkbox" checked={draft.branchIds.includes(branch.id)} onChange={e => setDraft({ ...draft, branchIds: e.target.checked ? [...draft.branchIds, branch.id] : draft.branchIds.filter(id => id !== branch.id) })} /> {branch.nameAr}{!branch.active && ' (غير نشط)'}</label>)}</fieldset>}
      <label className="block text-sm">سبب الإعداد أو التعديل أو الحذف (يسجل في التدقيق)<input className={inputCls} value={reason} maxLength={500} onChange={e => setReason(e.target.value)} /></label>
      <div className="flex flex-wrap gap-2"><Btn onClick={save}>حفظ الإعداد</Btn>{draft.id && <button type="button" className="text-red-600 underline" onClick={remove}>حذف الإعداد الوصفي</button>}<button type="button" className="underline" onClick={() => setDraft(null)}>إلغاء</button></div>
    </div>}
  </section>
}
