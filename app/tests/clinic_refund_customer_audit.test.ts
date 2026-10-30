import { beforeEach, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'

const original = useDataStore.getState()
const app = useAppStore.getState()
beforeEach(() => {
  useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } })
  useDataStore.setState({ ...original, customers: [], clinicPatients: [], clinicVisits: [], clinicCollections: [], projects: [], projectExtracts: [], journal: [], insuranceClaims: [], vouchers: [], clientSettlements: [], cheques: [], openingBalances: {} })
})

it('مرتجع زيارة على الحساب يظهر في كشف العميل ويخفض مستخلصه دون مضاعفة', () => {
  const s = useDataStore.getState()
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل مريض', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = useDataStore.getState().customers.at(-1)!
  const patient = s.addClinicPatient({ nameAr: 'مريض', phone: '', gender: 'male', birthDate: '', medicalHistory: '', notes: '', linkedCustomerId: customer.id })
  const visit = s.addClinicVisit({ patientId: patient.id, kind: 'checkup', complaint: '', diagnosis: '', treatment: '', feeMinor: 4000, paidMinor: 4000, vatPercent: 0, planId: null })
  const project = s.addProject({ nameAr: 'مشروع', clientId: customer.id, clientName: customer.nameAr, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  const extract = s.addProjectExtract({ projectId: project.id, description: 'آجل', grossMinor: 10000, vatPercent: 0, payment: 'credit' })
  s.refundClinicVisit({ visitId: visit.id, amountMinor: 4000, mode: 'patient_credit', reason: 'إشعار' })
  expect(s.getPatientBalance(patient.id)).toBe(-4000)
  expect(s.getCustomerBalance(customer.id)).toBe(6000)
  const doc = s.getOpenClientInvoices(customer.id, true).find((row) => row.docKey === `extract:${extract.id}`)!
  expect(doc.settledMinor).toBe(4000)
  expect(doc.adjustmentAllocations?.[0].description).toContain('مرتجع زيارة')
})

it('يرفض رصيد مريض غير مرتبط بلا أي قيد جديد', () => {
  const s = useDataStore.getState()
  const patient = s.addClinicPatient({ nameAr: 'مريض غير مرتبط', phone: '', gender: 'male', birthDate: '', medicalHistory: '', notes: '' })
  const visit = s.addClinicVisit({ patientId: patient.id, kind: 'checkup', complaint: '', diagnosis: '', treatment: '', feeMinor: 4000, paidMinor: 4000, vatPercent: 0, planId: null })
  const count = useDataStore.getState().journal.length
  expect(() => s.refundClinicVisit({ visitId: visit.id, amountMinor: 1000, mode: 'patient_credit', reason: 'رد' })).toThrow(/اربط المريض/)
  expect(useDataStore.getState().journal).toHaveLength(count)
})


it('مرتجع مؤمن على الحساب يخفض مطالبة الجهة ورصيد المريض كلٌ بنصيبه', () => {
  const s = useDataStore.getState()
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل مؤمن', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = useDataStore.getState().customers.at(-1)!
  const patient = s.addClinicPatient({ nameAr: 'مريض', phone: '', gender: 'male', birthDate: '', medicalHistory: '', notes: '', linkedCustomerId: customer.id })
  const insurer = s.addInsuranceProvider({ nameAr: 'جهة', coveragePercent: 70 })
  const visit = s.registerInsuredVisit({ patientId: patient.id, providerId: insurer.id, kind: 'checkup', complaint: '', diagnosis: '', treatment: '', feeMinor: 10000, vatPercent: 0 })
  const project = s.addProject({ nameAr: 'مشروع', clientId: customer.id, clientName: customer.nameAr, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
  const extract = s.addProjectExtract({ projectId: project.id, description: 'آجل', grossMinor: 10000, vatPercent: 0, payment: 'credit' })
  const updated = s.refundClinicVisit({ visitId: visit.id, amountMinor: 4000, mode: 'patient_credit', reason: 'رد جزئي' })
  expect(updated.refunds?.[0].customerCreditMinor).toBe(1200)
  expect(s.getClaimBalance(insurer.id)).toBe(4200)
  expect(s.getPatientBalance(patient.id)).toBe(-1200)
  expect(s.getCustomerBalance(customer.id)).toBe(8800)
  expect(s.getOpenClientInvoices(customer.id, true).find(d => d.docKey === `extract:${extract.id}`)?.settledMinor).toBe(1200)
  const entry = useDataStore.getState().journal.find(e => e.id === updated.refunds?.[0].journalEntryId)!
  expect(entry.lines.find(l => l.accountCode === '1110')?.credit).toBe(2800)
  expect(entry.lines.find(l => l.accountCode === '1104')?.credit).toBe(1200)
})

it('مرتجع الزيارة المؤمنة النقدي لا يرد من الخزينة إلا حصة المريض ويرفض المطالبة المسددة', () => {
  const s = useDataStore.getState()
  const patient = s.addClinicPatient({ nameAr: 'مريض نقدي', phone: '', gender: 'male', birthDate: '', medicalHistory: '', notes: '' })
  const insurer = s.addInsuranceProvider({ nameAr: 'جهة نقدية', coveragePercent: 70 })
  const visit = s.registerInsuredVisit({ patientId: patient.id, providerId: insurer.id, kind: 'checkup', complaint: '', diagnosis: '', treatment: '', feeMinor: 10000, vatPercent: 0 })
  const updated = s.refundClinicVisit({ visitId: visit.id, amountMinor: 4000, mode: 'cash', treasury: '1101', reason: 'رد جزئي' })
  const entry = useDataStore.getState().journal.find(e => e.id === updated.refunds?.[0].journalEntryId)!
  expect(entry.lines.find(l => l.accountCode === '1101')?.credit).toBe(1200)
  expect(entry.lines.find(l => l.accountCode === '1110')?.credit).toBe(2800)
  s.settleInsuranceClaims(insurer.id)
  const before = useDataStore.getState().journal.length
  expect(() => s.refundClinicVisit({ visitId: visit.id, amountMinor: 1000, mode: 'cash', reason: 'مراجعة' })).toThrow(/محصلة بالفعل/)
  expect(useDataStore.getState().journal).toHaveLength(before)
})

it('رد ماكينة زيارة مؤمنة يرتبط بالزيارة لا برقم المريض ويعيد نصيب المريض فقط', () => {
  const s = useDataStore.getState()
  s.addClinicPatient({ nameAr: 'مريض أول', phone: '', gender: 'male', birthDate: '', medicalHistory: '', notes: '' })
  const patient = s.addClinicPatient({ nameAr: 'مريض ثان', phone: '', gender: 'male', birthDate: '', medicalHistory: '', notes: '' })
  const insurer = s.addInsuranceProvider({ nameAr: 'تأمين ماكينة', coveragePercent: 70 })
  s.addPaymentTerminal({ id: 'clinic-t', code: 'CL-1', nameAr: 'ماكينة', providerName: 'مزود', branchId: '', settlementAccountCode: '1101', terminalId: 'CL-1', status: 'active' })
  const visit = s.registerInsuredVisit({ patientId: patient.id, providerId: insurer.id, kind: 'checkup', complaint: '', diagnosis: '', treatment: '', feeMinor: 10000, vatPercent: 0, treasury: '1101', terminalPayment: { terminalId: 'clinic-t', providerReference: 'CHARGE-CL' } })
  expect(visit.id).not.toBe(patient.id)
  const charge = useDataStore.getState().paymentTerminalTransactions.find(t => t.providerReference === 'CHARGE-CL')!
  const updated = s.refundClinicVisit({ visitId: visit.id, amountMinor: 4000, mode: 'cash', treasury: '1101', reason: 'رد', terminalRefund: { originalTransactionId: charge.id, providerReference: 'REFUND-CL' } })
  const refund = useDataStore.getState().paymentTerminalTransactions.find(t => t.providerReference === 'REFUND-CL')!
  expect(refund.amountMinor).toBe(1200)
  expect(refund.originalTransactionId).toBe(charge.id)
  expect(updated.refundedMinor).toBe(4000)
  expect(s.getClaimBalance(insurer.id)).toBe(4200)
})

it('لا يخمن نصيب الجهة عند فقد مطالبة زيارة مؤمنة', () => {
  const s = useDataStore.getState()
  const patient = s.addClinicPatient({ nameAr: 'مريض', phone: '', gender: 'male', birthDate: '', medicalHistory: '', notes: '' })
  const insurer = s.addInsuranceProvider({ nameAr: 'جهة مفقودة', coveragePercent: 70 })
  const visit = s.registerInsuredVisit({ patientId: patient.id, providerId: insurer.id, kind: 'checkup', complaint: '', diagnosis: '', treatment: '', feeMinor: 10000, vatPercent: 0 })
  useDataStore.setState({ insuranceClaims: [] })
  const count = useDataStore.getState().journal.length
  expect(() => s.refundClinicVisit({ visitId: visit.id, amountMinor: 4000, mode: 'cash', reason: 'رد' })).toThrow(/مفقودة/)
  expect(useDataStore.getState().journal).toHaveLength(count)
})

it('مرتجعات صغيرة متكررة تستعيد مجموع نصيب الجهة ونصيب المريض بلا فقد التقريب', () => {
  const s = useDataStore.getState()
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل كسور', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = useDataStore.getState().customers.at(-1)!
  const patient = s.addClinicPatient({ nameAr: 'مريض كسور', phone: '', gender: 'male', birthDate: '', medicalHistory: '', notes: '', linkedCustomerId: customer.id })
  const insurer = s.addInsuranceProvider({ nameAr: 'جهة كسور', coveragePercent: 33 })
  const visit = s.registerInsuredVisit({ patientId: patient.id, providerId: insurer.id, kind: 'checkup', complaint: '', diagnosis: '', treatment: '', feeMinor: 100, vatPercent: 0 })
  for (let i = 0; i < 100; i++) s.refundClinicVisit({ visitId: visit.id, amountMinor: 1, mode: 'patient_credit', reason: 'جزء' })
  expect(s.getClaimBalance(insurer.id)).toBe(0)
  expect(s.getPatientBalance(patient.id)).toBe(-67)
  expect(s.getCustomerBalance(customer.id)).toBe(-67)
  const latest = useDataStore.getState().clinicVisits.find(v => v.id === visit.id)!
  expect(latest.refundedMinor).toBe(100)
  expect(latest.refunds?.reduce((sum, r) => sum + (r.customerCreditMinor ?? 0), 0)).toBe(67)
  expect(() => s.refundClinicVisit({ visitId: visit.id, amountMinor: 1, mode: 'patient_credit', reason: 'فائض' })).toThrow(/تتجاوز/)
})


it('لا يسمح بترحيل مرتجع زيارة تابعة لفرع آخر', () => {
  const s = useDataStore.getState()
  const patient = s.addClinicPatient({ nameAr: 'مريض فرع', phone: '', gender: 'male', birthDate: '', medicalHistory: '', notes: '' })
  const visit = s.addClinicVisit({ patientId: patient.id, kind: 'checkup', complaint: '', diagnosis: '', treatment: '', feeMinor: 4000, paidMinor: 4000, vatPercent: 0, planId: null })
  const state = useRawDataStore.getState()
  useRawDataStore.setState({ branches: [{ id: 1, nameAr: 'الرئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }, { id: 2, nameAr: 'ثان', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }], activeBranchId: 1, clinicPatients: state.clinicPatients.map(p => ({ ...p, branchId: 2 })), clinicVisits: state.clinicVisits.map(v => ({ ...v, branchId: 2 })) })
  const before = useRawDataStore.getState().journal.length
  expect(() => useDataStore.getState().refundClinicVisit({ visitId: visit.id, amountMinor: 1000, mode: 'cash', reason: 'عبر فرع' })).toThrow(/فرع آخر/)
  expect(useRawDataStore.getState().journal).toHaveLength(before)
  useRawDataStore.setState({ activeBranchId: null, branches: [] })
})
