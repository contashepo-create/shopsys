import { useMemo, useState } from 'react'
import { useDataStore, type Customer, type Supplier } from '../../data/repo.ts'
import { partyCode } from '../../core/partyCodes.ts'
import { Btn, Field, inputCls, Modal, useToast } from './ui.tsx'

type Target =
  | { kind: 'customer'; party: Customer }
  | { kind: 'supplier'; party: Supplier }

type Props = {
  open: boolean
  target: Target | null
  currencyDecimals: number
  currencySymbol: string
  onClose: () => void
  onSaved?: () => void
}

type FormState = {
  nameAr: string
  phone: string
  email: string
  taxNumber: string
  commercialReg: string
  address: string
  city: string
  postalCode: string
  buildingNo: string
  nationalId: string
  notes: string
  active: boolean
  creditLimit: string
  priceListId: string
  contactPerson: string
  category: string
  paymentTermsDays: string
  bankName: string
  iban: string
}

const emptyForm: FormState = {
  nameAr: '', phone: '', email: '', taxNumber: '', commercialReg: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '', notes: '', active: true,
  creditLimit: '', priceListId: '', contactPerson: '', category: '', paymentTermsDays: '', bankName: '', iban: '',
}

function formFromTarget(target: Target | null, decimals: number): FormState {
  if (!target) return emptyForm
  const p = target.party
  return {
    nameAr: p.nameAr, phone: p.phone, email: p.email, taxNumber: p.taxNumber, commercialReg: p.commercialReg, address: p.address,
    city: p.city, postalCode: p.postalCode, buildingNo: p.buildingNo, nationalId: p.nationalId, notes: p.notes, active: p.active !== false,
    creditLimit: target.kind === 'customer' && (p as Customer).creditLimitMinor ? String((p as Customer).creditLimitMinor / 10 ** decimals) : '',
    priceListId: target.kind === 'customer' && (p as Customer).priceListId != null ? String((p as Customer).priceListId) : '',
    contactPerson: target.kind === 'supplier' ? (p as Supplier).contactPerson ?? '' : '', category: target.kind === 'supplier' ? (p as Supplier).category ?? '' : '',
    paymentTermsDays: target.kind === 'supplier' && (p as Supplier).paymentTermsDays != null ? String((p as Supplier).paymentTermsDays) : '',
    bankName: target.kind === 'supplier' ? (p as Supplier).bankName ?? '' : '', iban: target.kind === 'supplier' ? (p as Supplier).iban ?? '' : '',
  }
}

function PartyQuickEditModalForm({ open, target, currencyDecimals, currencySymbol, onClose, onSaved }: Props) {
  const toast = useToast()
  const { updateCustomer, updateSupplier, priceLists } = useDataStore()
  const initialForm = useMemo(() => formFromTarget(target, currencyDecimals), [target, currencyDecimals])
  const [form, setForm] = useState<FormState>(() => initialForm)
  const [initial, setInitial] = useState(() => JSON.stringify(initialForm))
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const dirty = useMemo(() => JSON.stringify(form) !== initial, [form, initial])
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((prev) => ({ ...prev, [key]: value }))
  const requestClose = () => { if (dirty) setConfirmDiscard(true); else onClose() }
  const save = () => {
    if (!target || !form.nameAr.trim()) { toast.show('اكتب اسم الطرف أولاً', 'error'); return }
    try {
      const common = {
        nameAr: form.nameAr.trim(), phone: form.phone.trim(), email: form.email.trim(), taxNumber: form.taxNumber.trim(), commercialReg: form.commercialReg.trim(),
        address: form.address.trim(), city: form.city.trim(), postalCode: form.postalCode.trim(), buildingNo: form.buildingNo.trim(), nationalId: form.nationalId.trim(), notes: form.notes.trim(), active: form.active,
      }
      if (target.kind === 'customer') {
        updateCustomer(target.party.id, { ...common, creditLimitMinor: Math.max(0, Math.round(Number(form.creditLimit || 0) * 10 ** currencyDecimals)), priceListId: form.priceListId ? Number(form.priceListId) : null })
        toast.show('تم تحديث بيانات العميل داخل الفاتورة ✓')
      } else {
        updateSupplier(target.party.id, { ...common, contactPerson: form.contactPerson.trim(), category: form.category.trim(), paymentTermsDays: Math.max(0, Math.round(Number(form.paymentTermsDays || 0))), bankName: form.bankName.trim(), iban: form.iban.trim() })
        toast.show('تم تحديث بيانات المورد داخل الفاتورة ✓')
      }
      setInitial(JSON.stringify(form)); setConfirmDiscard(false); onSaved?.(); onClose()
    } catch (error) { toast.show((error as Error).message, 'error') }
  }
  const code = target ? partyCode(target.kind === 'customer' ? 'CUS' : 'SUP', target.party.id) : ''

  return <>
    <Modal open={open} onClose={requestClose} title={target?.kind === 'customer' ? 'تعديل بيانات العميل سريعاً' : 'تعديل بيانات المورد سريعاً'} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-200 bg-brand-500/5 px-3 py-2 text-xs dark:border-brand-900/60">
          <div><b>{target?.party.nameAr}</b><span className="mx-2 font-mono text-slate-500" dir="ltr">{code}</span></div>
          <span className={form.active ? 'text-emerald-600' : 'text-rose-600'}>{form.active ? 'نشط' : 'موقوف'}</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="الاسم *"><input autoFocus className={inputCls} value={form.nameAr} onChange={(e) => set('nameAr', e.target.value)} /></Field>
          <Field label="الهاتف"><input className={inputCls} value={form.phone} onChange={(e) => set('phone', e.target.value)} dir="ltr" /></Field>
          <Field label="البريد الإلكتروني"><input className={inputCls} value={form.email} onChange={(e) => set('email', e.target.value)} dir="ltr" /></Field>
          <Field label="الرقم الضريبي"><input className={inputCls} value={form.taxNumber} onChange={(e) => set('taxNumber', e.target.value)} dir="ltr" /></Field>
          <Field label="السجل التجاري"><input className={inputCls} value={form.commercialReg} onChange={(e) => set('commercialReg', e.target.value)} dir="ltr" /></Field>
          <Field label="الهوية الوطنية"><input className={inputCls} value={form.nationalId} onChange={(e) => set('nationalId', e.target.value)} dir="ltr" /></Field>
          <Field label="العنوان"><input className={inputCls} value={form.address} onChange={(e) => set('address', e.target.value)} /></Field>
          <Field label="المدينة"><input className={inputCls} value={form.city} onChange={(e) => set('city', e.target.value)} /></Field>
          <Field label="الرمز البريدي"><input className={inputCls} value={form.postalCode} onChange={(e) => set('postalCode', e.target.value)} dir="ltr" /></Field>
          <Field label="رقم المبنى"><input className={inputCls} value={form.buildingNo} onChange={(e) => set('buildingNo', e.target.value)} dir="ltr" /></Field>
          {target?.kind === 'customer' ? <>
            <Field label={`حد الائتمان (${currencySymbol})`}><input className={inputCls} type="number" inputMode="decimal" step="any" min="0" value={form.creditLimit} onChange={(e) => set('creditLimit', e.target.value)} dir="ltr" /></Field>
            <Field label="قائمة الأسعار"><select className={inputCls} value={form.priceListId} onChange={(e) => set('priceListId', e.target.value)}><option value="">سعر قطاعي</option>{priceLists.filter((list) => list.isActive).map((list) => <option key={list.id} value={list.id}>{list.nameAr}</option>)}</select></Field>
          </> : <>
            <Field label="مسؤول التواصل"><input className={inputCls} value={form.contactPerson} onChange={(e) => set('contactPerson', e.target.value)} /></Field>
            <Field label="تصنيف المورد"><input className={inputCls} value={form.category} onChange={(e) => set('category', e.target.value)} /></Field>
            <Field label="شروط السداد بالأيام"><input className={inputCls} type="number" inputMode="decimal" step="any" min="0" value={form.paymentTermsDays} onChange={(e) => set('paymentTermsDays', e.target.value)} dir="ltr" /></Field>
            <Field label="اسم البنك"><input className={inputCls} value={form.bankName} onChange={(e) => set('bankName', e.target.value)} /></Field>
            <Field label="IBAN"><input className={inputCls} value={form.iban} onChange={(e) => set('iban', e.target.value)} dir="ltr" /></Field>
          </>}
        </div>
        <Field label="ملاحظات"><textarea className={`${inputCls} min-h-20`} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold dark:border-slate-700"><input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} /> الطرف نشط ويمكن اختياره في الفواتير</label>
        <div className="flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-800"><Btn variant="ghost" onClick={requestClose}>تراجع وإغلاق</Btn><Btn onClick={save}>حفظ بيانات الطرف</Btn></div>
      </div>
    </Modal>
    <Modal open={confirmDiscard} onClose={() => setConfirmDiscard(false)} title="لديك تعديلات غير محفوظة">
      <div className="space-y-4"><p className="text-sm leading-7 text-slate-600 dark:text-slate-300">سيتم فقد البيانات التي كتبتها إذا أغلقت النافذة الآن.</p><div className="flex justify-end gap-2"><Btn variant="ghost" onClick={() => setConfirmDiscard(false)}>متابعة التعديل</Btn><Btn variant="danger" onClick={() => { setConfirmDiscard(false); onClose() }}>تجاهل التعديلات</Btn></div></div>
    </Modal>
  </>
}


/** Remount the editable form when its external target changes, avoiding effect-driven resets. */
export function PartyQuickEditModal(props: Props) {
  const { open, target, currencyDecimals } = props
  const targetKey = open && target
    ? `${target.kind}:${target.party.id}:${target.party.nameAr}:${target.party.phone}:${currencyDecimals}`
    : 'closed'
  return <PartyQuickEditModalForm key={targetKey} {...props} />
}
