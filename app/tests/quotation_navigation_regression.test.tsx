import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { MenuBar } from '../src/ui/layout/MenuBar.tsx'
import { Sidebar } from '../src/ui/layout/Sidebar.tsx'
import { PermissionsPage } from '../src/ui/pages/PermissionsPage.tsx'

const originalData = useRawDataStore.getState()
const originalApp = useAppStore.getState()

beforeEach(() => {
  const setup = { ...originalApp.setup, activityId: 'contracting', modules: ['contracting', 'inventory', 'purchases'] as typeof originalApp.setup.modules }
  useAppStore.setState({ setup, companySetup: setup })
  useRawDataStore.setState({ ...originalData, branches: [], activeBranchId: null, currentUserId: null, roleOverrides: {}, branchRoleOverrides: {}, customRoles: [] })
})
afterEach(() => { cleanup(); useRawDataStore.setState(originalData); useAppStore.setState(originalApp) })

describe('استعادة الوصول لعروض الأسعار', () => {
  it('يظهر الرابط العام والرابط المعتاد داخل المقاولات في الشريط العلوي', () => {
    render(<MemoryRouter><MenuBar onSwitchToSidebar={() => {}} /></MemoryRouter>)
    expect(document.querySelector('[data-menubar-title="quotations"]')).toBeTruthy()
    fireEvent.click(document.querySelector('[data-menubar-title="contracting"]')!)
    const menu = document.querySelector('[data-menubar-menu="contracting"]') as HTMLElement
    expect(within(menu).getByRole('menuitem', { name: 'عروض الأسعار والمناقصات' }).getAttribute('href')).toBe('/contracting/quotations')
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
