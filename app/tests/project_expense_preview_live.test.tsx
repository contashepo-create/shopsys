import { afterEach, beforeEach, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ProjectExpensesPage } from '../src/ui/pages/ContractingPages.tsx'
import { usePrintPreview } from '../src/ui/components/printPreviewStore.ts'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
beforeEach(() => {
 useAppStore.setState({ ...app, setup: { ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting', modules: ['contracting'], allowNegativeTreasury: true } as never })
 useRawDataStore.setState({ ...original, currentUserId: null, branches: [], activeBranchId: null, projects: [], projectCosts: [], journal: [], suppliers: [], custodyFiles: [] } as never)
 const p = S().addProject({ nameAr: 'مشروع <العميل>', clientName: '', contractValueMinor: 100000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
 S().addProjectCost({ projectId: p.id, kind: 'materials', description: 'مواد <بناء>', amountMinor: 1000, payment: 'cash', treasury: '1101' })
})
afterEach(() => { cleanup(); usePrintPreview.getState().closePreview(); useRawDataStore.setState(original); useAppStore.setState(app) })
it('معاينة المصروف تطبع التفاصيل بأمان وتحدث البيانات أو تمنع الطباعة عند فقد المستند', () => {
 render(<MemoryRouter><ProjectExpensesPage /></MemoryRouter>)
 fireEvent.click(screen.getByTitle('معاينة تفاصيل البنود والقيد المحاسبي'))
 fireEvent.click(screen.getByText('معاينة وطباعة مستند المصروف'))
 let preview = usePrintPreview.getState()
 expect(preview.handle?.html).toContain('مواد &lt;بناء&gt;')
 expect(preview.handle?.html).toContain('مشروع &lt;العميل&gt;')
 expect(preview.handle?.html).toContain('القيد')
 act(() => { useRawDataStore.setState({ projectCosts: S().projectCosts.map(row => ({ ...row, description: 'محدث' })) }); usePrintPreview.getState().refresh() })
 preview = usePrintPreview.getState(); expect(preview.handle?.html).toContain('محدث')
 act(() => { useRawDataStore.setState({ projectCosts: [] }); usePrintPreview.getState().refresh() })
 expect(usePrintPreview.getState().rebuildError).toBe(true)
})
