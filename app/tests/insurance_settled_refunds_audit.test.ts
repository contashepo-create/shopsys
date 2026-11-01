import { beforeEach, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { buildBackup, parseBackup } from '../src/core/backup.ts'
import { assertJournalSnapshotSafe } from '../src/core/ledgerSnapshotGuard.ts'
import { secureStorage, flushSecureStorageWrites } from '../src/data/secureStorage.ts'

const initial = useRawDataStore.getState()
const app = useAppStore.getState()
beforeEach(() => {
  useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } })
  useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, customers: [], clinicPatients: [], clinicVisits: [], labPatients: [], labOrders: [], labTests: [], insuranceProviders: [], insuranceClaims: [], journal: [], paymentTerminalTransactions: [] })
})

it('رد زيارة بعد تحصيل مجمع ينشئ التزاماً للجهة لا يصرفه حتى تأكيد عملية صرف منفصلة', () => {
  const s = useDataStore.getState()
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل مؤمن', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = useDataStore.getState().customers.at(-1)!
  const patient = s.addClinicPatient({ nameAr: 'مريض', phone: '', gender: 'male', birthDate: '', medicalHistory: '', notes: '', linkedCustomerId: customer.id })
  const provider = s.addInsuranceProvider({ nameAr: 'تأمين', coveragePercent: 70 })
  const visit = s.registerInsuredVisit({ patientId: patient.id, providerId: provider.id, kind: 'checkup', complaint: '', diagnosis: '', treatment: '', feeMinor: 10000, vatPercent: 0 })
  const other = s.registerInsuredVisit({ patientId: patient.id, providerId: provider.id, kind: 'checkup', complaint: '', diagnosis: '', treatment: '', feeMinor: 2000, vatPercent: 0 })
  s.settleInsuranceClaims(provider.id)
  const before = useDataStore.getState()
  const claim = before.insuranceClaims.find(c => c.sourceId === visit.id)!
  const untouched = before.insuranceClaims.find(c => c.sourceId === other.id)!
  const settlement = before.journal.find(e => e.id === claim.settlementEntryId)!
  expect(settlement.lines.find(l => l.accountCode === '1110')?.credit).toBe(8400)
  const updated = s.refundClinicVisit({ visitId: visit.id, amountMinor: 4000, mode: 'patient_credit', reason: 'رد' })
  const refund = useDataStore.getState().journal.find(e => e.id === updated.refunds?.at(-1)?.journalEntryId)!
  expect(refund.lines.find(l => l.accountCode === '2117')?.credit).toBe(2800)
  expect(refund.lines.find(l => l.accountCode === '1104')?.credit).toBe(1200)
  expect(refund.lines.some(l => l.accountCode === '1101')).toBe(false)
  expect(useDataStore.getState().journal.find(e => e.id === settlement.id)).toEqual(settlement)
  expect(useDataStore.getState().insuranceClaims.find(c => c.id === untouched.id)).toEqual(untouched)
  expect(s.getCustomerBalance(customer.id)).toBe(-1200)
  expect(s.getInsuranceRefundBalance(claim.id)).toBe(2800)
  const count = useDataStore.getState().journal.length
  expect(() => s.payInsuranceRefund({ claimId: claim.id, amountMinor: 2801, treasury: '1101', reason: 'زيادة' })).toThrow(/المتبقي/)
  expect(useDataStore.getState().journal).toHaveLength(count)
  s.payInsuranceRefund({ claimId: claim.id, amountMinor: 1000, treasury: '1101', reason: 'تحويل فعلي' })
  expect(s.getInsuranceRefundBalance(claim.id)).toBe(1800)
  const payment = useDataStore.getState().journal.at(-1)!
  expect(payment.lines.find(l => l.accountCode === '2117')?.debit).toBe(1000)
  expect(payment.lines.find(l => l.accountCode === '1101')?.credit).toBe(1000)
  expect(() => s.reverseEntry(payment.id, 'عكس')).toThrow()
})

it('يرفض رد مطالبة محصلة عندما لا يطابق قيد التحصيل المجمع السجلات دون تغييرها', () => {
  const s = useDataStore.getState()
  const patient = s.addClinicPatient({ nameAr: 'مريض', phone: '', gender: 'male', birthDate: '', medicalHistory: '', notes: '' })
  const provider = s.addInsuranceProvider({ nameAr: 'تأمين', coveragePercent: 70 })
  const visit = s.registerInsuredVisit({ patientId: patient.id, providerId: provider.id, kind: 'checkup', complaint: '', diagnosis: '', treatment: '', feeMinor: 10000, vatPercent: 0 })
  s.settleInsuranceClaims(provider.id)
  const claim = useRawDataStore.getState().insuranceClaims[0]
  useRawDataStore.setState({ journal: useRawDataStore.getState().journal.filter(e => e.id !== claim.settlementEntryId) })
  const before = useRawDataStore.getState()
  expect(() => s.refundClinicVisit({ visitId: visit.id, amountMinor: 1000, mode: 'cash', reason: 'رد' })).toThrow(/مراجعة/)
  expect(useRawDataStore.getState().journal).toEqual(before.journal)
  expect(useRawDataStore.getState().clinicVisits).toEqual(before.clinicVisits)
  expect(useRawDataStore.getState().insuranceClaims).toEqual(before.insuranceClaims)
})

it('ردود المعمل قبل التحصيل وبعده تحافظ على التقريب وتفصل المطالبة عن الالتزام', () => {
  const s = useDataStore.getState()
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل معمل', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = useDataStore.getState().customers.at(-1)!
  const patient = s.addLabPatient({ nameAr: 'مريض معمل', phone: '', gender: 'male', birthDate: '', notes: '', linkedCustomerId: customer.id })
  const test = s.addLabTest({ code: 'A', nameAr: 'تحليل', category: '', sampleType: '', unit: '', priceMinor: 100, costMinor: 0, refRanges: [] })
  const provider = s.addInsuranceProvider({ nameAr: 'تغطية', coveragePercent: 33 })
  const order = s.registerInsuredLabOrder({ patientId: patient.id, referrerId: null, testIds: [test.id], providerId: provider.id, vatPercent: 0 })
  for (let i = 0; i < 20; i++) s.refundLabOrder({ orderId: order.id, amountMinor: 1, mode: 'customer_credit', reason: 'أجزاء قبل التحصيل' })
  expect(s.getClaimBalance(provider.id)).toBe(26)
  s.settleInsuranceClaims(provider.id)
  const claim = useDataStore.getState().insuranceClaims.find(c => c.sourceId === order.id)!
  for (let i = 0; i < 80; i++) s.refundLabOrder({ orderId: order.id, amountMinor: 1, mode: 'customer_credit', reason: 'أجزاء بعد التحصيل' })
  expect(s.getInsuranceRefundBalance(claim.id)).toBe(26)
  expect(s.getCustomerBalance(customer.id)).toBe(-67)
  expect(s.getClaimBalance(provider.id)).toBe(0)
  expect(useDataStore.getState().insuranceClaims.find(c => c.id === claim.id)).toMatchObject({ claimMinor: 26, reversedMinor: 7, settledRefundMinor: 26 })
})

it('لا يقبل قيد تحصيل مجمّع مقابل حساب ليس خزينة ولا يقبل المطالبات المكررة', () => {
  const s = useDataStore.getState()
  const patient = s.addClinicPatient({ nameAr: 'مريض', phone: '', gender: 'male', birthDate: '', medicalHistory: '', notes: '' })
  const provider = s.addInsuranceProvider({ nameAr: 'تأمين', coveragePercent: 70 })
  const visit = s.registerInsuredVisit({ patientId: patient.id, providerId: provider.id, kind: 'checkup', complaint: '', diagnosis: '', treatment: '', feeMinor: 10000, vatPercent: 0 })
  s.settleInsuranceClaims(provider.id)
  const saved = useRawDataStore.getState()
  const claim = saved.insuranceClaims[0]
  useRawDataStore.setState({ journal: saved.journal.map(e => e.id === claim.settlementEntryId ? { ...e, lines: e.lines.map(l => l.accountCode === '1101' ? { ...l, accountCode: '5101' } : l) } : e) })
  expect(() => s.refundClinicVisit({ visitId: visit.id, amountMinor: 1000, mode: 'cash', reason: 'رد' })).toThrow(/مراجعة/)
  useRawDataStore.setState({ journal: saved.journal, insuranceClaims: [...saved.insuranceClaims, { ...claim, id: claim.id + 1 }] })
  expect(() => s.refundClinicVisit({ visitId: visit.id, amountMinor: 1000, mode: 'cash', reason: 'رد' })).toThrow(/مكررة/)
})

it('يرفض الصرف بغير خزينة أو بلا سبب أو عند فقد قيد صرف سابق', () => {
  const s = useDataStore.getState()
  const patient = s.addClinicPatient({ nameAr: 'مريض', phone: '', gender: 'male', birthDate: '', medicalHistory: '', notes: '' })
  const provider = s.addInsuranceProvider({ nameAr: 'تأمين', coveragePercent: 70 })
  const visit = s.registerInsuredVisit({ patientId: patient.id, providerId: provider.id, kind: 'checkup', complaint: '', diagnosis: '', treatment: '', feeMinor: 10000, vatPercent: 0 })
  s.settleInsuranceClaims(provider.id)
  s.refundClinicVisit({ visitId: visit.id, amountMinor: 4000, mode: 'cash', reason: 'رد' })
  const claim = useDataStore.getState().insuranceClaims[0]
  const count = useDataStore.getState().journal.length
  expect(() => s.payInsuranceRefund({ claimId: claim.id, amountMinor: 500, treasury: '5101', reason: 'غير خزينة' })).toThrow(/الخزينة/)
  expect(() => s.payInsuranceRefund({ claimId: claim.id, amountMinor: 500, treasury: '1101', reason: ' ' })).toThrow(/سبب/)
  expect(useDataStore.getState().journal).toHaveLength(count)
  s.payInsuranceRefund({ claimId: claim.id, amountMinor: 500, treasury: '1101', reason: 'تحويل مؤكد' })
  const last = useDataStore.getState().journal.at(-1)!
  useRawDataStore.setState({ journal: useRawDataStore.getState().journal.filter(e => e.id !== last.id) })
  expect(() => s.getInsuranceRefundBalance(claim.id)).toThrow(/مراجعة/)
  expect(() => s.payInsuranceRefund({ claimId: claim.id, amountMinor: 100, treasury: '1101', reason: 'تحويل آخر' })).toThrow(/مراجعة/)
})

it('لا يغلق المطالبات بتحصيل وهمي على حساب ليس خزينة أو بقيد غير نقدي', () => {
  const s = useDataStore.getState()
  const patient = s.addClinicPatient({ nameAr: 'مريض', phone: '', gender: 'male', birthDate: '', medicalHistory: '', notes: '' })
  const provider = s.addInsuranceProvider({ nameAr: 'تأمين', coveragePercent: 70 })
  s.registerInsuredVisit({ patientId: patient.id, providerId: provider.id, kind: 'checkup', complaint: '', diagnosis: '', treatment: '', feeMinor: 10000, vatPercent: 0 })
  const before = useRawDataStore.getState()
  expect(() => s.settleInsuranceClaims(provider.id, '5101')).toThrow(/الخزينة|البنك/)
  expect(useRawDataStore.getState().journal).toEqual(before.journal)
  expect(useRawDataStore.getState().insuranceClaims).toEqual(before.insuranceClaims)
})

it('لا يجمع مطالبتين مكررتين لنفس الزيارة أو لنفس معرّف المطالبة', () => {
  const s = useDataStore.getState()
  const patient = s.addClinicPatient({ nameAr: 'مريض', phone: '', gender: 'male', birthDate: '', medicalHistory: '', notes: '' })
  const provider = s.addInsuranceProvider({ nameAr: 'تأمين', coveragePercent: 70 })
  s.registerInsuredVisit({ patientId: patient.id, providerId: provider.id, kind: 'checkup', complaint: '', diagnosis: '', treatment: '', feeMinor: 10000, vatPercent: 0 })
  const state = useRawDataStore.getState()
  const claim = state.insuranceClaims[0]
  useRawDataStore.setState({ insuranceClaims: [...state.insuranceClaims, { ...claim, id: claim.id + 1 }] })
  expect(() => s.settleInsuranceClaims(provider.id)).toThrow(/مراجعة/)
  expect(useRawDataStore.getState().journal).toEqual(state.journal)
})

it('لا تتجاوز عملية الصرف صلاحية خزينة الموظف ولا تغير حساباً مخصصاً قديماً', () => {
  const s = useDataStore.getState()
  s.addCustomAccount({ code: '2119', nameAr: 'حساب تاريخي', parentCode: '2' })
  const patient = s.addClinicPatient({ nameAr: 'مريض', phone: '', gender: 'male', birthDate: '', medicalHistory: '', notes: '' })
  const provider = s.addInsuranceProvider({ nameAr: 'تأمين', coveragePercent: 70 })
  const visit = s.registerInsuredVisit({ patientId: patient.id, providerId: provider.id, kind: 'checkup', complaint: '', diagnosis: '', treatment: '', feeMinor: 10000, vatPercent: 0 })
  s.settleInsuranceClaims(provider.id)
  s.refundClinicVisit({ visitId: visit.id, amountMinor: 4000, mode: 'cash', reason: 'رد' })
  const claim = useDataStore.getState().insuranceClaims[0]
  useRawDataStore.setState({ appUsers: [{ id: 55, nameAr: 'موظف', roleId: 'cashier', pinHash: '0'.repeat(64), active: true, treasuryAccess: { grants: [] } }], currentUserId: 55 })
  const before = useRawDataStore.getState()
  expect(() => s.payInsuranceRefund({ claimId: claim.id, amountMinor: 1000, treasury: '1101', reason: 'صرف' })).toThrow(/غير مسموح/)
  expect(useRawDataStore.getState().journal).toEqual(before.journal)
  expect(useRawDataStore.getState().customAccounts.find(a => a.code === '2119')?.nameAr).toBe('حساب تاريخي')
})

it('لا تُصرف مطالبة فرع آخر من الخزينة الحالية', () => {
  const s = useDataStore.getState()
  const patient = s.addClinicPatient({ nameAr: 'مريض', phone: '', gender: 'male', birthDate: '', medicalHistory: '', notes: '' })
  const provider = s.addInsuranceProvider({ nameAr: 'تأمين', coveragePercent: 70 })
  const visit = s.registerInsuredVisit({ patientId: patient.id, providerId: provider.id, kind: 'checkup', complaint: '', diagnosis: '', treatment: '', feeMinor: 10000, vatPercent: 0 })
  s.settleInsuranceClaims(provider.id)
  s.refundClinicVisit({ visitId: visit.id, amountMinor: 4000, mode: 'cash', reason: 'رد' })
  const state = useRawDataStore.getState()
  const claim = state.insuranceClaims[0]
  useRawDataStore.setState({
    branches: [{ id: 1, nameAr: 'الرئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }, { id: 2, nameAr: 'ثان', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }], activeBranchId: 1,
    clinicPatients: state.clinicPatients.map(p => ({ ...p, branchId: 2 })), clinicVisits: state.clinicVisits.map(v => ({ ...v, branchId: 2 })), insuranceProviders: state.insuranceProviders.map(p => ({ ...p, branchId: 2 })), insuranceClaims: state.insuranceClaims.map(c => ({ ...c, branchId: 2 })), journal: state.journal.map(e => ({ ...e, branchId: 2 })),
  })
  const before = useRawDataStore.getState()
  expect(() => useDataStore.getState().payInsuranceRefund({ claimId: claim.id, amountMinor: 1000, treasury: '1101', reason: 'رد' })).toThrow(/الفرع/)
  expect(useRawDataStore.getState().journal).toEqual(before.journal)
  expect(useRawDataStore.getState().insuranceClaims).toEqual(before.insuranceClaims)
})


it('تُحفظ التسوية والالتزام والدفعات عبر النسخة الاحتياطية وإعادة تحميل المتجر', async () => {
  const s = useDataStore.getState()
  const patient = s.addClinicPatient({ nameAr: 'مريض نسخة', phone: '', gender: 'male', birthDate: '', medicalHistory: '', notes: '' })
  const provider = s.addInsuranceProvider({ nameAr: 'تأمين نسخة', coveragePercent: 70 })
  const visit = s.registerInsuredVisit({ patientId: patient.id, providerId: provider.id, kind: 'checkup', complaint: '', diagnosis: '', treatment: '', feeMinor: 10000, vatPercent: 0 })
  s.settleInsuranceClaims(provider.id)
  s.refundClinicVisit({ visitId: visit.id, amountMinor: 4000, mode: 'cash', reason: 'رد' })
  const claim = useDataStore.getState().insuranceClaims[0]
  s.payInsuranceRefund({ claimId: claim.id, amountMinor: 1000, treasury: '1101', reason: 'تحويل مؤكد' })
  await flushSecureStorageWrites('shopsys-data')
  const stored = await secureStorage.getItem('shopsys-data')
  expect(stored).toBeTruthy()
  const backup = buildBackup({ appState: {}, storeState: JSON.parse(stored!), appDataVersion: 25, shopName: 'اختبار' })
  const restored = parseBackup(JSON.stringify(backup))
  const raw = (restored.data.store as { state: Record<string, unknown> }).state
  expect(() => assertJournalSnapshotSafe(raw)).not.toThrow()
  useRawDataStore.setState({ insuranceClaims: [], clinicVisits: [], journal: [] })
  await flushSecureStorageWrites('shopsys-data')
  await secureStorage.setItem('shopsys-data', JSON.stringify(restored.data.store))
  await useRawDataStore.persist.rehydrate()
  expect(useDataStore.getState().getInsuranceRefundBalance(claim.id)).toBe(1800)
  expect(useDataStore.getState().insuranceClaims.find(c => c.id === claim.id)?.refundPayments?.[0].amountMinor).toBe(1000)
})
