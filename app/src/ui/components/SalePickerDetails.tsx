import { useMemo } from 'react'
import { useDataStore } from '../../data/repo.ts'
import { recordedAverageSalePrice, latestPurchasePrice } from '../../core/salePickerMetrics.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import { effectivePermissionsFor, rolesWithOverrides } from '../../core/permissions.ts'
import { partyCode } from '../../core/partyCodes.ts'
import { useAppStore } from '../../stores/app.store.ts'

function useDetailContext() {
  const { setup } = useAppStore()
  const { appUsers, currentUserId, roleOverrides, customRoles } = useDataStore()
  const user = appUsers.find(row => row.id === currentUserId) ?? null
  const permissions = effectivePermissionsFor(user, rolesWithOverrides(roleOverrides, customRoles, setup.activityId))
  const known = currentUserId == null || !!user
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  return { cur, canViewCost: known && permissions.has('inv.cost.view'), canViewBalance: known && permissions.has('party.customer.statement') }
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <div className="sale-picker-detail-row"><dt>{label}</dt><dd>{value}</dd></div>
}

export function SaleItemDetails({ itemId }: { itemId: number | null }) {
  const { items, sales, purchases } = useDataStore()
  const { cur, canViewCost } = useDetailContext()
  const item = items.find(row => row.id === itemId)
  const average = useMemo(() => item ? recordedAverageSalePrice(item.id, sales) : null, [item, sales])
  const latest = useMemo(() => item && canViewCost ? latestPurchasePrice(item.id, purchases) : null, [item, purchases, canViewCost])
  const money = (value: number | null) => value == null ? 'لا توجد حركة' : formatMinor(value, cur)
  if (!item) return <p className="sale-picker-detail-empty">اضغط على صنف لعرض تفاصيله.</p>
  return <section aria-label="تفاصيل الصنف المحدد" data-sale-item-details>
    <b className="sale-picker-detail-title">{item.nameAr}</b><small className="sale-picker-detail-subtitle">{item.sku || `#${item.id}`}</small>
    <dl className="sale-picker-detail-list">
      <DetailRow label="الكمية المتاحة إجمالاً" value={item.isService ? 'خدمة بلا مخزون' : item.stockQty == null ? 'غير متاحة' : `${item.stockQty} ${item.baseUnit}`} />
      <DetailRow label="سعر البيع الحالي" value={money(item.priceMinor)} />
      <DetailRow label="متوسط سعر البيع المسجل" value={money(average)} />
      {canViewCost && <><DetailRow label="آخر سعر شراء" value={money(latest)} /><DetailRow label="متوسط التكلفة" value={money(item.costMinor ?? null)} /></>}
    </dl>
    <p className="sale-picker-detail-note">متوسط الأسعار المسجلة موزون بالكمية الأساسية، قبل الخصومات والمرتجعات؛ قد تشمل الأسعار الضريبة.</p>
  </section>
}

export function SaleCustomerDetails({ customerId }: { customerId: number | null }) {
  const { customers, getCustomerBalance } = useDataStore()
  const { cur, canViewBalance } = useDetailContext()
  const customer = customers.find(row => row.id === customerId)
  if (!customer) return <p className="sale-picker-detail-empty">اضغط على عميل لعرض بياناته.</p>
  const balance = canViewBalance ? getCustomerBalance(customer.id) : null
  return <section aria-label="تفاصيل العميل المحدد" data-sale-customer-details>
    <b className="sale-picker-detail-title">{customer.nameAr}</b><small className="sale-picker-detail-subtitle">{partyCode('CUS', customer.id)}</small>
    <dl className="sale-picker-detail-list">
      <DetailRow label="الهاتف" value={customer.phone || '—'} />
      <DetailRow label="الحالة" value={customer.active === false ? 'موقوف' : 'نشط'} />
      {canViewBalance && <><DetailRow label="الرصيد" value={balance === 0 ? 'متزن' : `${formatMinor(Math.abs(balance ?? 0), cur)} ${balance! > 0 ? 'عليه' : 'له'}`} /><DetailRow label="حد الائتمان" value={customer.creditLimitMinor > 0 ? formatMinor(customer.creditLimitMinor, cur) : 'بلا حد محدد'} /></>}
    </dl>
  </section>
}
