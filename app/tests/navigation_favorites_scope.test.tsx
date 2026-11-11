import { afterEach, beforeEach, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { MenuBar } from '../src/ui/layout/MenuBar.tsx'
import { Sidebar } from '../src/ui/layout/Sidebar.tsx'

const original = useRawDataStore.getState(), app = useAppStore.getState()
const branches = [1, 2].map(id => ({ id, nameAr: `فرع ${id}`, isMain: id === 1, active: true, warehouseId: id, treasuryCode: id === 1 ? '1101' : '1102' }))
beforeEach(() => {
 const setup = { ...app.setup, completed: true, activityId: 'contracting' as const, modules: ['contracting', 'inventory', 'purchases', 'pos'] as typeof app.setup.modules }
 useAppStore.setState({ setup, companySetup: setup })
 useRawDataStore.setState({ ...original, loggedOut: false, currentUserId: null, activeBranchId: 1, branches, userPrefs: {}, roleOverrides: {}, branchRoleOverrides: {}, customRoles: [], appUsers: [{ id: 5, nameAr: 'موظف', roleId: 'owner', active: true, pinHash: '' }] })
})
afterEach(() => { cleanup(); useRawDataStore.setState(original); useAppStore.setState(app) })
it('تنعزل مفضلة كل مستخدم وكل فرع وتظهر في الرئيسية بالشريطين', () => {
 const view = render(<MemoryRouter><MenuBar onSwitchToSidebar={() => {}} /></MemoryRouter>)
 fireEvent.click(document.querySelector('[data-menubar-title="contracting"]')!)
 fireEvent.click(screen.getByLabelText('إضافة عروض الأسعار والمناقصات إلى المفضلة'))
 fireEvent.click(document.querySelector('[data-menubar-title="dashboard"]')!)
 expect(within(document.querySelector('[data-menubar-menu="dashboard"]') as HTMLElement).getByRole('menuitem', { name: 'عروض الأسعار والمناقصات' })).toBeTruthy()
 act(() => { useRawDataStore.setState({ activeBranchId: 2 }) })
 expect(within(document.querySelector('[data-menubar-menu="dashboard"]') as HTMLElement).queryByRole('menuitem', { name: 'عروض الأسعار والمناقصات' })).toBeNull()
 act(() => { useRawDataStore.setState({ activeBranchId: 1, currentUserId: 5 }) })
 expect(within(document.querySelector('[data-menubar-menu="dashboard"]') as HTMLElement).queryByRole('menuitem', { name: 'عروض الأسعار والمناقصات' })).toBeNull()
 act(() => { useRawDataStore.setState({ currentUserId: null }) })
 expect(within(document.querySelector('[data-menubar-menu="dashboard"]') as HTMLElement).getByRole('menuitem', { name: 'عروض الأسعار والمناقصات' })).toBeTruthy()
 view.unmount()
 render(<MemoryRouter><Sidebar collapsed={false} onToggle={() => {}} /></MemoryRouter>)
 const main = screen.getByRole('button', { name: /الرئيسية/ }); expect(main).toBeTruthy()
 expect(screen.getAllByRole('link', { name: 'عروض الأسعار والمناقصات' })).toHaveLength(2)
})
it('لا تعرض المفضلة مساراً سحبت صلاحيته', () => {
 useRawDataStore.setState({ currentUserId: 5, userPrefs: { '5': { favoritePathsByBranch: { 'branch-1': ['/contracting/quotations'] } } }, appUsers: [{ id: 5, nameAr: 'موظف', roleId: 'cashier', active: true, branchId: 1, pinHash: '', deniedPerms: ['sales.quotation.manage'] }] })
 render(<MemoryRouter><MenuBar onSwitchToSidebar={() => {}} /></MemoryRouter>)
 fireEvent.click(document.querySelector('[data-menubar-title="dashboard"]')!)
 expect(within(document.querySelector('[data-menubar-menu="dashboard"]') as HTMLElement).queryByRole('menuitem', { name: 'عروض الأسعار والمناقصات' })).toBeNull()
})
it('رابط كل بند يتمدد وتبقى النجمة في نهاية صف القائمة العلوية والجانبية', () => {
 const view = render(<MemoryRouter><MenuBar onSwitchToSidebar={() => {}} /></MemoryRouter>)
 fireEvent.click(document.querySelector('[data-menubar-title="contracting"]')!)
 const menu = document.querySelector('[data-menubar-menu="contracting"]') as HTMLElement
 const links = within(menu).getAllByRole('menuitem')
 for (const link of links) { expect(link.className).toContain('flex-1'); expect(link.nextElementSibling?.className).toContain('shrink-0') }
 view.unmount()
 render(<MemoryRouter><Sidebar collapsed={false} onToggle={() => {}} /></MemoryRouter>)
 fireEvent.click(screen.getByRole('button', { name: 'المقاولات' }))
 const link = screen.getByRole('link', { name: 'عروض الأسعار والمناقصات' })
 expect(link.className).toContain('flex-1'); expect(link.nextElementSibling?.className).toContain('shrink-0')
})
