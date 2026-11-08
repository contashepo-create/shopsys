import { afterEach, beforeEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ProjectsPage } from '../src/ui/pages/ContractingPages.tsx'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { todayLocalIso } from '../src/core/time.ts'
import { effectiveContractValue } from '../src/core/contracting.ts'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 const setup = { ...app.setup, completed: true, activityId: 'contracting' as const, countryCode: 'EG', modules: ['contracting'] as never[] }
 useAppStore.setState({ setup, companySetup: setup })
 useRawDataStore.setState({ ...original, branches: [], activeBranchId: null, currentUserId: null, projects: [], boqItems: [], journal: [], projectExtracts: [], changeOrders: [], customers: [], employees: [] })
 S().addProject({ nameAr: 'مشروع', clientName: '', contractValueMinor: 10000, retentionPercent: 0, startDate: '2025-01-01', notes: '' })
})
afterEach(() => { cleanup(); useRawDataStore.setState(original); useAppStore.setState(app) })
it('يحفظ تاريخ المستند السابق مع وقت إنشاء واعتماد فعليين دون قيد أو تغيير كمية', () => {
 const p = S().projects[0], boq = S().addBoqItem({ projectId: p.id, code: '1', descriptionAr: 'عمل', unit: 'م', qty: 1000, unitPriceMinor: 10, estCostMinor: 0 })
 const before = Date.now()
 const order = S().addChangeOrder({ projectId: p.id, titleAr: 'زيادة', amountMinor: 2000, date: '2024-02-29' })
 expect(order.date).toBe('2024-02-29')
 expect(Date.parse(order.createdAt!)).toBeGreaterThanOrEqual(before - 1000)
 expect(order.approvedAt).toBeNull()
 expect(effectiveContractValue(p.contractValueMinor, S().changeOrders)).toBe(10000)
 S().setChangeOrderStatus(order.id, 'approved')
 expect(Date.parse(S().changeOrders[0].approvedAt!)).toBeGreaterThanOrEqual(before - 1000)
 expect(effectiveContractValue(p.contractValueMinor, S().changeOrders)).toBe(12000)
 expect(S().boqItems[0]).toEqual(boq)
 expect(S().journal).toHaveLength(0)
})
it('الافتراضي اليوم ويرفض التاريخ غير التقويمي دون إنشاء أمر', () => {
 const projectId = S().projects[0].id
 const order = S().addChangeOrder({ projectId, titleAr: 'تغيير', amountMinor: 1 })
 expect(order.date).toBe(todayLocalIso())
 expect(() => S().addChangeOrder({ projectId, titleAr: 'تغيير', amountMinor: 1, date: '2025-02-29' })).toThrow(/تاريخ/)
 expect(() => S().addChangeOrder({ projectId, titleAr: 'تغيير', amountMinor: 1, date: '' })).toThrow(/تاريخ/)
 expect(S().changeOrders).toHaveLength(1)
})
it('تعرض الواجهة تقويماً افتراضه اليوم ويحفظ اليوم المختار', () => {
 render(<MemoryRouter><ProjectsPage /></MemoryRouter>)
 fireEvent.click(screen.getByTitle('أمر تغيير على العقد'))
 const date = screen.getByLabelText('تاريخ أمر التغيير') as HTMLInputElement
 expect(date.type).toBe('date'); expect(date.value).toBe(todayLocalIso())
 fireEvent.change(date, { target: { value: '2025-02-27' } })
 fireEvent.change(screen.getByPlaceholderText('أعمال إضافية للواجهة…'), { target: { value: 'أعمال إضافية' } })
 const field = screen.getByText(/القيمة \(/).parentElement!
 fireEvent.change(field.querySelector('input')!, { target: { value: '20' } })
 fireEvent.click(screen.getByRole('button', { name: /إنشاء أمر التغيير/ }))
 expect(S().changeOrders[0].date).toBe('2025-02-27')
})
