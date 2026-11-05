import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { InsuranceProvidersSection } from '../src/ui/components/InsuranceProvidersSection.tsx'
import { useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'

const original = useRawDataStore.getState()
const app = useAppStore.getState()
afterEach(() => { cleanup(); useRawDataStore.setState(original); useAppStore.setState(app) })

it('يعرض الالتزام على المطالبة ويطلب مبلغاً ومرجعاً قبل تسجيل صرف فعلي جزئي', () => {
  useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } })
  useRawDataStore.setState({ ...original, branches: [], activeBranchId: null, appUsers: [], currentUserId: null, clinicPatients: [], clinicVisits: [], insuranceProviders: [], insuranceClaims: [], journal: [] })
  const s = useDataStore.getState()
  const patient = s.addClinicPatient({ nameAr: 'مريض', phone: '', gender: 'male', birthDate: '', medicalHistory: '', notes: '' })
  const provider = s.addInsuranceProvider({ nameAr: 'شركة', coveragePercent: 70 })
  const visit = s.registerInsuredVisit({ patientId: patient.id, providerId: provider.id, kind: 'checkup', complaint: '', diagnosis: '', treatment: '', feeMinor: 10000, vatPercent: 0 })
  s.settleInsuranceClaims(provider.id)
  s.refundClinicVisit({ visitId: visit.id, amountMinor: 4000, mode: 'cash', reason: 'مرتجع' })
  const claim = useDataStore.getState().insuranceClaims[0]
  render(<InsuranceProvidersSection />)
  expect(screen.getByText(/مستحق للجهة عن المطالبة/).textContent).toContain('28.00')
  const before = useDataStore.getState().journal.length
  fireEvent.click(screen.getByRole('button', { name: 'تسجيل صرف' }))
  const save = screen.getByRole('button', { name: /تأكيد تسجيل الصرف الفعلي/  }) as HTMLButtonElement
  expect(save.disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('المبلغ المصروف للجهة'), { target: { value: '10' } })
  expect(save.disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('سبب ومرجع صرف التأمين'), { target: { value: 'تحويل بنكي رقم 123' } })
  expect(save.disabled).toBe(false)
  expect(useDataStore.getState().journal).toHaveLength(before)
  fireEvent.click(save)
  expect(s.getInsuranceRefundBalance(claim.id)).toBe(1800)
  expect(screen.getByText(/مستحق للجهة عن المطالبة/).textContent).toContain('18.00')
})
