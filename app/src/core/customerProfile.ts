/** تصنيف وصفي للعميل، لا يحدد أهليته النظامية أو معالجته الضريبية. */
export const CUSTOMER_TYPES = [
  { value: 'individual', label: 'فرد' },
  { value: 'establishment', label: 'مؤسسة' },
  { value: 'company', label: 'شركة' },
  { value: 'government', label: 'جهة حكومية' },
  { value: 'nonprofit', label: 'جهة غير ربحية' },
  { value: 'other', label: 'نوع آخر' },
] as const
export type CustomerType = typeof CUSTOMER_TYPES[number]['value']
export interface CustomerProfile {
  customerType?: CustomerType
  contactPerson?: string
  contactRole?: string
  contactPhone?: string
  contactEmail?: string
}

/** لقطة عند ربط العميل، لا دليل على هوية الشخص أو صفته القانونية. */
export interface CustomerContactEvent {
  customerId: number | null
  capturedAt: string
  capturedBy: string
  customerName: string
  profile: CustomerProfile
}

export function captureCustomerContact(customer: (CustomerProfile & { id: number; nameAr: string }) | undefined, at: string, by: string): CustomerContactEvent {
  if (customer && (!Number.isSafeInteger(customer.id) || customer.id <= 0 || typeof customer.nameAr !== 'string')) throw new Error('بيانات العميل غير صالحة لتوثيق جهة التواصل')
  const profile = customer ? normalizeCustomerProfile({
    customerType: customer.customerType, contactPerson: customer.contactPerson, contactRole: customer.contactRole,
    contactPhone: customer.contactPhone, contactEmail: customer.contactEmail,
  }) : {}
  return { customerId: customer?.id ?? null, capturedAt: at, capturedBy: by, customerName: customer?.nameAr ?? '', profile }
}

/** لا نستنتج بيانات قديمة أو ننسب آخر لقطة لعميل مختلف. */
export function currentDocumentContact(history: readonly CustomerContactEvent[] | undefined, customerId: number | null): CustomerContactEvent | undefined {
  if (!Array.isArray(history) || !history.length) return undefined
  const last = history.at(-1)
  if (!last || last.customerId !== customerId || typeof last.customerName !== 'string' || typeof last.capturedAt !== 'string' || typeof last.capturedBy !== 'string' || !last.profile || typeof last.profile !== 'object' || Array.isArray(last.profile)) return undefined
  const profile = last.profile
  if (profile.customerType !== undefined && !CUSTOMER_TYPES.some(option => option.value === profile.customerType)) return undefined
  if (['contactPerson', 'contactRole', 'contactPhone', 'contactEmail'].some(key => { const value = (profile as Record<string, unknown>)[key]; return value !== undefined && typeof value !== 'string' })) return undefined
  return last
}

export function documentContactLabel(event: CustomerContactEvent | undefined): string {
  if (!event) return 'جهة التواصل التاريخية غير مسجلة'
  const profile = event.profile
  const type = CUSTOMER_TYPES.find(option => option.value === profile.customerType)?.label ?? 'غير محدد'
  return `بيانات التواصل عند الربط ${event.capturedAt}: ${type} · المسؤول: ${profile.contactPerson || 'غير محدد'}${profile.contactRole ? ` (${profile.contactRole})` : ''}${profile.contactPhone ? ` · ${profile.contactPhone}` : ''}${profile.contactEmail ? ` · ${profile.contactEmail}` : ''}`
}

/** فحص إدخال هذه البيانات عند الكتابة دون تخمين نوع السجلات القديمة. */
export function normalizeCustomerProfile<T extends Partial<CustomerProfile>>(input: T): T {
  const out = { ...input }
  if (input.customerType !== undefined && !CUSTOMER_TYPES.some(option => option.value === input.customerType)) throw new Error('نوع العميل غير صالح — اختر نوعاً من القائمة')
  for (const key of ['contactPerson', 'contactRole', 'contactPhone', 'contactEmail'] as const) {
    const value = input[key]
    if (value === undefined) continue
    if (typeof value !== 'string' || value.length > 200 || Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new Error('بيانات مسؤول تواصل العميل غير صالحة أو طويلة جداً')
    out[key] = value.trim() as T[typeof key]
  }
  if (out.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.contactEmail)) throw new Error('بريد مسؤول تواصل العميل غير صالح')
  return out
}

function sameSavedContact(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameSavedContact(v, b[i]))
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>
  const keys = Object.keys(x).filter(key => x[key] !== undefined).sort(), others = Object.keys(y).filter(key => y[key] !== undefined).sort()
  return keys.length === others.length && keys.every((key, i) => key === others[i] && sameSavedContact(x[key], y[key]))
}

/** حراسة سجلات التواصل للمستندات الباقية في لقطة واردة؛ لا تُثبت سلامة الحذف أو كامل اللقطة. */
export function assertContactHistoriesPreserved(current: Record<string, unknown>, incoming: Record<string, unknown>): void {
  for (const collection of ['projects', 'quotations']) {
    if (!Array.isArray(current[collection])) continue
    const hasHistory = (current[collection] as Record<string, unknown>[]).some(row => row && row.customerContactHistory !== undefined)
    if (!Array.isArray(incoming[collection])) {
      if (hasHistory) throw new Error('النسخة لا تحتوي قائمة مستندات لازمة لحماية سجل التواصل التاريخي — راجع البيانات')
      continue
    }
    const rows = incoming[collection] as Record<string, unknown>[]
    for (const old of current[collection] as Record<string, unknown>[]) {
      if (!old || old.customerContactHistory === undefined) continue
      if (!Array.isArray(old.customerContactHistory)) throw new Error('سجل التواصل المحلي تالف — راجع البيانات')
      const matches = rows.filter(row => row && row.id === old.id)
      if (matches.length > 1) throw new Error('المستند الوارد مكرر — راجع سجلات التواصل')
      if (!matches.length) continue // سلامة الحذف والروابط تفحصها حراسات أخرى
      const history = matches[0].customerContactHistory
      if (!Array.isArray(history) || history.length < old.customerContactHistory.length || !old.customerContactHistory.every((event, i) => sameSavedContact(event, history[i]))) throw new Error(`النسخة تسقط أو تغيّر سجل التواصل التاريخي للمستند #${String(old.id)} — راجع البيانات`)
    }
  }
}
