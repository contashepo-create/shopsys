import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { MenuBar } from '../src/ui/layout/MenuBar.tsx'
import { Sidebar } from '../src/ui/layout/Sidebar.tsx'
import { PermissionsPage } from '../src/ui/pages/PermissionsPage.tsx'
import { GuidesPage } from '../src/ui/pages/GuidesPage.tsx'
import { CommandPalette } from '../src/ui/components/CommandPalette.tsx'
import { QuotationsPage } from '../src/ui/pages/QuotationsPage.tsx'
import { usePrintPreview } from '../src/ui/components/printPreviewStore.ts'

const originalData = useRawDataStore.getState()
const originalApp = useAppStore.getState()

beforeEach(() => {
  const setup = { ...originalApp.setup, activityId: 'contracting', modules: ['contracting', 'inventory', 'purchases'] as typeof originalApp.setup.modules }
  useAppStore.setState({ setup, companySetup: setup })
  useRawDataStore.setState({ ...originalData, branches: [], activeBranchId: null, currentUserId: null, roleOverrides: {}, branchRoleOverrides: {}, customRoles: [] })
})
afterEach(() => { cleanup(); usePrintPreview.getState().closePreview(); useRawDataStore.setState(originalData); useAppStore.setState(originalApp) })

describe('استعادة الوصول لعروض الأسعار', () => {
  it('يظهر الرابط العام والرابط المعتاد داخل المقاولات في الشريط العلوي', () => {
    render(<MemoryRouter><MenuBar onSwitchToSidebar={() => {}} /></MemoryRouter>)
    expect(document.querySelector('[data-menubar-title="quotations"]')).toBeTruthy()
    fireEvent.click(document.querySelector('[data-menubar-title="contracting"]')!)
    const menu = document.querySelector('[data-menubar-menu="contracting"]') as HTMLElement
    expect(within(menu).getByRole('menuitem', { name: 'عروض الأسعار والمناقصات' }).getAttribute('href')).toBe('/contracting/quotations')
  })

  it('فتح رابط المقاولات يعرض العروض المحفوظة وتعمل معاينتها', () => {
    useRawDataStore.setState({ quotations: [{ id: 1, quoteNumber: 'QT-1', kind: 'quotation', clientName: 'عميل', clientId: null, titleAr: 'عرض محفوظ', date: '2026-11-05', validUntil: '2027-01-01', lines: [{ nameAr: 'خدمة', descriptionAr: 'تفاصيل العرض', qty: 1, unitAr: 'عدد', unitPriceMinor: 1000, estCostMinor: 0 }], status: 'draft', notes: '', projectId: null, winProbability: 50, bidBondMinor: 0 }] })
    render(<MemoryRouter><MenuBar onSwitchToSidebar={() => {}} /><Routes><Route path="/" element={<div>الرئيسية</div>} /><Route path="/contracting/quotations" element={<QuotationsPage />} /></Routes></MemoryRouter>)
    fireEvent.click(document.querySelector('[data-menubar-title="contracting"]')!)
    const menu = document.querySelector('[data-menubar-menu="contracting"]') as HTMLElement
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'عروض الأسعار والمناقصات' }))
    expect(screen.getByText(/QT-1 — عرض محفوظ/)).toBeTruthy()
    fireEvent.click(screen.getByTitle('معاينة عرض السعر'))
    expect(usePrintPreview.getState().handle?.html).toContain('تفاصيل العرض')
    expect(useRawDataStore.getState().quotations).toHaveLength(1)
  })

  it('يظهر داخل المقاولات أيضاً في الشريط الجانبي ويحترم منع الصلاحية', () => {
    useRawDataStore.setState({ currentUserId: 2, appUsers: [{ id: 2, nameAr: 'مهندس', roleId: 'project_manager', active: true, pinHash: '', extraPerms: ['sales.quotation.manage'] }] })
    const { rerender } = render(<MemoryRouter><Sidebar collapsed={false} onToggle={() => {}} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /المقاولات/ }))
    expect(screen.getByRole('link', { name: 'عروض الأسعار والمناقصات' }).getAttribute('href')).toBe('/contracting/quotations')
    useRawDataStore.setState({ appUsers: [{ id: 2, nameAr: 'مهندس', roleId: 'project_manager', active: true, pinHash: '', deniedPerms: ['sales.quotation.manage'] }] })
    rerender(<MemoryRouter><Sidebar collapsed={false} onToggle={() => {}} /></MemoryRouter>)
    expect(screen.queryByRole('link', { name: 'عروض الأسعار والمناقصات' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'عروض الأسعار' })).toBeNull()
  })

  it('لا يتكرر شرح الشاشة أو نتيجتها في لوحة الأوامر بسبب رابط المقاولات الإضافي', () => {
    const view = render(<MemoryRouter><GuidesPage /><CommandPalette /></MemoryRouter>)
    expect(view.container.querySelectorAll('[data-guide-screen="/contracting/quotations"]')).toHaveLength(1)
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    fireEvent.change(screen.getByLabelText('بحث لوحة الأوامر'), { target: { value: 'عروض الأسعار والمناقصات' } })
    expect(screen.getAllByRole('option', { name: /عروض الأسعار والمناقصات/ })).toHaveLength(1)
  })

  it('يمكن للمالك إتاحة العروض لدور محفوظ سابقاً دون منحها تلقائياً', () => {
    useRawDataStore.setState({ roleOverrides: { project_manager: ['ops.activity.use'] } })
    const view = render(<MemoryRouter><PermissionsPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /مدير مشاريع/ }))
    const checkbox = screen.getByLabelText('إدارة ومعاينة عروض الأسعار والمناقصات') as HTMLInputElement
    expect(checkbox.checked).toBe(false)
    fireEvent.click(checkbox)
    expect(useRawDataStore.getState().roleOverrides.project_manager).toContain('sales.quotation.manage')
    view.unmount()
    useRawDataStore.setState({ currentUserId: 2, appUsers: [{ id: 2, nameAr: 'مدير', roleId: 'project_manager', active: true, pinHash: '' }] })
    render(<MemoryRouter><MenuBar onSwitchToSidebar={() => {}} /></MemoryRouter>)
    expect(document.querySelector('[data-menubar-title="quotations"]')).toBeTruthy()
  })

  it('منح صلاحية دور في فرع لا يغير إعداد الفرع الآخر أو الصلاحية العامة', () => {
    useRawDataStore.setState({
      branches: [{ id: 1, nameAr: 'الرئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }, { id: 2, nameAr: 'الثاني', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }],
      activeBranchId: 1,
      roleOverrides: { project_manager: ['ops.activity.use'] },
      branchRoleOverrides: { 2: { project_manager: ['ops.activity.use'] } },
    })
    render(<MemoryRouter><PermissionsPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /مدير مشاريع/ }))
    fireEvent.click(screen.getByLabelText('إدارة ومعاينة عروض الأسعار والمناقصات'))
    const state = useRawDataStore.getState()
    expect(state.branchRoleOverrides[1].project_manager).toContain('sales.quotation.manage')
    expect(state.branchRoleOverrides[2].project_manager).not.toContain('sales.quotation.manage')
    expect(state.roleOverrides.project_manager).not.toContain('sales.quotation.manage')
  })

  it('يمكن منح الصلاحية للفئة المعروضة افتراضياً دون الحاجة لاختيارها مرة أخرى', () => {
    render(<MemoryRouter><PermissionsPage /></MemoryRouter>)
    const checkbox = screen.getByLabelText('إدارة ومعاينة عروض الأسعار والمناقصات') as HTMLInputElement
    expect(checkbox.checked).toBe(false)
    fireEvent.click(checkbox)
    expect(useRawDataStore.getState().roleOverrides.warehouse_keeper).toContain('sales.quotation.manage')
    fireEvent.click(checkbox)
    expect(useRawDataStore.getState().roleOverrides.warehouse_keeper).not.toContain('sales.quotation.manage')
  })
})
