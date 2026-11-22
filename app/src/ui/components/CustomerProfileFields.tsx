import { CUSTOMER_TYPES, currentDocumentContact, documentContactLabel, type CustomerContactEvent, type CustomerProfile, type CustomerType } from '../../core/customerProfile.ts'
import { Field, inputCls } from './ui.tsx'

export function CustomerProfileFields({ profile, onChange }: { profile: CustomerProfile; onChange: (profile: CustomerProfile) => void }) {
  return <>
    <Field label="نوع العميل"><select aria-label="نوع العميل" className={inputCls} value={profile.customerType ?? ''} onChange={e => onChange({ ...profile, customerType: (e.target.value || undefined) as CustomerType | undefined })}><option value="">غير محدد</option>{CUSTOMER_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select></Field>
    <Field label="اسم مسؤول التواصل"><input aria-label="اسم مسؤول التواصل" className={inputCls} value={profile.contactPerson ?? ''} onChange={e => onChange({ ...profile, contactPerson: e.target.value })} /></Field>
    <Field label="صفة مسؤول التواصل"><input aria-label="صفة مسؤول التواصل" className={inputCls} value={profile.contactRole ?? ''} onChange={e => onChange({ ...profile, contactRole: e.target.value })} /></Field>
    <Field label="هاتف مسؤول التواصل"><input aria-label="هاتف مسؤول التواصل" className={inputCls} dir="ltr" value={profile.contactPhone ?? ''} onChange={e => onChange({ ...profile, contactPhone: e.target.value })} /></Field>
    <Field label="بريد مسؤول التواصل"><input aria-label="بريد مسؤول التواصل" className={inputCls} type="email" dir="ltr" value={profile.contactEmail ?? ''} onChange={e => onChange({ ...profile, contactEmail: e.target.value })} /></Field>
  </>
}

/** بيانات حالية من بطاقة العميل، وليست لقطة تاريخية للمستند. */
export function CustomerProfileSummary({ profile }: { profile?: CustomerProfile }) {
  if (!profile) return null
  const type = CUSTOMER_TYPES.find(option => option.value === profile.customerType)?.label ?? 'غير محدد'
  return <span data-customer-profile-summary>بيانات العميل الحالية: {type} · مسؤول التواصل: {profile.contactPerson || 'غير محدد'}{profile.contactRole ? ` (${profile.contactRole})` : ''}{profile.contactPhone ? ` · ${profile.contactPhone}` : ''}{profile.contactEmail ? ` · ${profile.contactEmail}` : ''}</span>
}

/** لقطة محفوظة عند الربط؛ لا تُستبدل ببطاقة العميل الحالية في السجلات القديمة. */
export function DocumentContactSummary({ history, customerId }: { history?: CustomerContactEvent[]; customerId: number | null }) {
  const contact = currentDocumentContact(history, customerId)
  return <span data-document-contact-summary>{documentContactLabel(contact)}{contact && ` · اسم العميل عند الربط: ${contact.customerName || 'غير محدد'} · سجّلها: ${contact.capturedBy}`}
    {Array.isArray(history) && history.length > 1 && <span> · الروابط السابقة: {history.slice(0, -1).map((event, i) => {
      const previous = currentDocumentContact([event], event?.customerId ?? null)
      return <span key={i}>{i > 0 && ' ؛ '}{documentContactLabel(previous)}{previous?.customerName ? ` — ${previous.customerName}` : ''}</span>
    })}</span>}
  </span>
}
