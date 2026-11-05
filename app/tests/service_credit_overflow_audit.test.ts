import { beforeEach, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const original = useDataStore.getState()
const app = useAppStore.getState()
beforeEach(() => {
  useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } })
  useDataStore.setState({ ...original, customers: [], projects: [], projectExtracts: [], trips: [], tickets: [], rentalContracts: [], journal: [], vouchers: [], clientSettlements: [], cheques: [], openingBalances: {} })
})

it('رصيد مرتجع نقلة مدفوعة يطفئ مستخلص العميل ولا يضيع بعد اختفاء ذمة النقلة', () => {
  const s = useDataStore.getState()
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل النقل', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = useDataStore.getState().customers.at(-1)!
  const trip = s.postTrip({ customerId: customer.id, vehicleId: null, driverId: null, notes: '', input: { fromLoc: 'أ', toLoc: 'ب', qty: 1, unitPriceMinor: 4000, vatPercent: 0, payment: 'cash', containerNumbers: [], expenses: [] } })
  const project = s.addProject({ nameAr: 'مشروع النقل', clientId: customer.id, clientName: customer.nameAr, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  const extract = s.addProjectExtract({ projectId: project.id, description: 'آجل', grossMinor: 10000, vatPercent: 0, payment: 'credit' })
  s.refundTrip({ tripId: trip.id, amountMinor: 4000, mode: 'customer_credit', reason: 'إشعار' })
  expect(s.getCustomerBalance(customer.id)).toBe(6000)
  const doc = s.getOpenClientInvoices(customer.id, true).find((d) => d.docKey === `extract:${extract.id}`)!
  expect(doc.settledMinor).toBe(4000)
  expect(doc.adjustmentAllocations?.[0].description).toContain('مرتجع خدمة')
})

it('رصيد مرتجع نقلة آجلة يطفئ مستندها أولاً ثم يوزع الفائض بعد سدادها', () => {
  const s = useDataStore.getState()
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل نقلة آجلة', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = useDataStore.getState().customers.at(-1)!
  const trip = s.postTrip({ customerId: customer.id, vehicleId: null, driverId: null, notes: '', input: { fromLoc: 'أ', toLoc: 'ب', qty: 1, unitPriceMinor: 4000, vatPercent: 0, payment: 'credit', containerNumbers: [], expenses: [] } })
  s.postVoucher({ kind: 'receipt', partyKind: 'customer', partyId: customer.id, treasury: '1101', counterAccountCode: '1104', amountMinor: 3000, description: 'سداد النقلة' })
  const project = s.addProject({ nameAr: 'مشروع النقل', clientId: customer.id, clientName: customer.nameAr, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  const extract = s.addProjectExtract({ projectId: project.id, description: 'آجل', grossMinor: 10000, vatPercent: 0, payment: 'credit' })
  s.refundTrip({ tripId: trip.id, amountMinor: 4000, mode: 'customer_credit', reason: 'إشعار' })
  const docs = s.getOpenClientInvoices(customer.id, true)
  expect(docs.find((d) => d.docKey === `trip:${trip.id}`)?.settledMinor).toBe(4000)
  expect(docs.find((d) => d.docKey === `extract:${extract.id}`)?.settledMinor).toBe(3000)
  expect(s.getCustomerBalance(customer.id)).toBe(7000)
})
