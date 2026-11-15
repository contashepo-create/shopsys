import { afterEach, beforeEach, expect, it } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
const original = useRawDataStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => useRawDataStore.setState({ ...original, projects: [], boqItems: [], journal: [], branches: [], activeBranchId: null, currentUserId: null, customers: [], employees: [] }))
afterEach(() => useRawDataStore.setState(original))
const project = { nameAr: 'مشروع', clientName: '', contractValueMinor: 2000, retentionPercent: 0, startDate: '2026-01-01', notes: '', boqSections: [{ id: 'floor', nameAr: 'الدور الأول' }] }
const line = { code: '1', descriptionAr: 'دهانات', sectionId: 'floor', unit: 'م2', qty: 2, unitPriceMinor: 1000, estCostMinor: 0 }
it('المشروع والبنود في لقطة واحدة دون أي قيد', () => {
  const observed: [number, number][] = []
  const off = useRawDataStore.subscribe(state => observed.push([state.projects.length, state.boqItems.length]))
  try {
    const p = S().addProjectWithBoq(project, [line])
    expect(observed).toEqual([[1, 1]])
    expect(S().boqItems[0]).toMatchObject({ projectId: p.id, sectionId: 'floor', qty: 2 })
    expect(S().journal).toHaveLength(0)
  } finally { off() }
})
it('البند غير الصالح أو القسم المفقود أو مجموع العقد المخالف لا ينشئ مشروعاً جزئياً', () => {
  expect(() => S().addProjectWithBoq(project, [line, { ...line, estCostMinor: -1 }])).toThrow(/تكلفة/)
  expect(() => S().addProjectWithBoq(project, [{ ...line, sectionId: 'missing' }])).toThrow(/قسم/)
  expect(() => S().addProjectWithBoq({ ...project, contractValueMinor: 2001 }, [line])).toThrow(/قيمة العقد/)
  expect(S().projects).toHaveLength(0)
  expect(S().boqItems).toHaveLength(0)
})
