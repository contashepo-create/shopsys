import { useState, type ComponentProps } from 'react'
import { EMPTY_EXTENDED, getEffectiveActiveBranch, useDataStore, useRawDataStore } from '../../data/repo.ts'
import { resolveBranchActivityId } from '../../core/branches.ts'
import { effectivePermissionsFor, rolesWithOverrides } from '../../core/permissions.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { PartyQuickPicker } from './KeyboardPickers.tsx'
import { Btn, Field, inputCls, Modal, useToast } from './ui.tsx'

function canManageCustomers() {
  const state = useDataStore.getState()
  const raw = useRawDataStore.getState()
  const user = state.appUsers.find(row => row.id === state.currentUserId) ?? null
  const app = useAppStore.getState()
  const activity = resolveBranchActivityId(getEffectiveActiveBranch(raw), (app.companySetup ?? app.setup).activityId)
  return (state.currentUserId == null || !!user?.active) && effectivePermissionsFor(user, rolesWithOverrides(state.roleOverrides, state.customRoles, activity)).has('party.customer.manage')
}

/** منتقي عميل مع إنشاء محلي فوق المستند، دون إغلاقه أو تغيير اختياره عند الإلغاء. */
export function CustomerQuickPicker(props: Omit<ComponentProps<typeof PartyQuickPicker>, 'onCreate'>) {
  // الاشتراك لتحديث الزر عند تغيير الصلاحيات أو الفرع أثناء فتح المستند.
  useDataStore()
  useAppStore()
  const [initialName, setInitialName] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [scope, setScope] = useState<{ userId: number | null; branchId: number | null } | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const toast = useToast()
  const canManage = canManageCustomers()
  const start = (query: string) => {
    if (!canManageCustomers()) { toast.show('تحتاج صلاحية إدارة العملاء', 'error'); return }
    const raw = useRawDataStore.getState()
    setScope({ userId: raw.currentUserId, branchId: getEffectiveActiveBranch(raw)?.id ?? null })
    setInitialName(query); setName(query); setPhone(''); setNotes(''); setConfirmDiscard(false)
  }
  const close = () => {
    if (name !== initialName || phone || notes) { setConfirmDiscard(true); return }
    setInitialName(null)
  }
  const save = () => {
    try {
      const raw = useRawDataStore.getState()
      if (!canManageCustomers()) throw new Error('تحتاج صلاحية إدارة العملاء')
      if (!scope || scope.userId !== raw.currentUserId || scope.branchId !== (getEffectiveActiveBranch(raw)?.id ?? null)) throw new Error('تغير المستخدم أو الفرع — أعد فتح إنشاء العميل')
      const nameAr = name.trim()
      if (!nameAr) throw new Error('اسم العميل مطلوب')
      const before = new Set(useDataStore.getState().customers.map(customer => customer.id))
      useDataStore.getState().addCustomer({ ...EMPTY_EXTENDED, nameAr, phone: phone.trim(), notes: notes.trim(), creditLimitMinor: 0, priceListId: null, active: true })
      const created = useDataStore.getState().customers.find(customer => !before.has(customer.id))
      if (!created) throw new Error('حُفظ العميل لكن تعذر اختياره؛ ابحث عنه بالاسم')
      setInitialName(null)
      props.onChange(created.id)
      toast.show(`أُضيف العميل «${created.nameAr}» واختير في المستند`)
    } catch (error) { toast.show((error as Error).message, 'error') }
  }
  return <>
    <PartyQuickPicker {...props} onCreate={canManage ? start : undefined} />
    <Modal open={initialName !== null} onClose={close} title="إضافة عميل سريعاً" subtitle="يُختار العميل بعد الحفظ؛ المستند يبقى مفتوحاً">
      <div className="space-y-3" data-quick-customer-create>
        <Field label="اسم العميل *"><input autoFocus className={inputCls} aria-label="اسم العميل الجديد" value={name} onChange={event => setName(event.target.value)} /></Field>
        <Field label="الهاتف"><input className={inputCls} aria-label="هاتف العميل الجديد" value={phone} onChange={event => setPhone(event.target.value)} /></Field>
        <Field label="ملاحظات"><input className={inputCls} aria-label="ملاحظات العميل الجديد" value={notes} onChange={event => setNotes(event.target.value)} /></Field>
        {confirmDiscard && <div role="alert" className="text-sm text-amber-700">تجاهل بيانات العميل غير المحفوظة؟ <button type="button" onClick={() => { setConfirmDiscard(false); setInitialName(null) }}>تجاهل</button> <button type="button" onClick={() => setConfirmDiscard(false)}>متابعة التعديل</button></div>}
        <div className="flex gap-2"><Btn variant="ghost" onClick={close}>إلغاء</Btn><Btn onClick={save}>حفظ واختيار</Btn></div>
      </div>
    </Modal>
  </>
}
