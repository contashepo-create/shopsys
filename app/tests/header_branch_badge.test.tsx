/**
 * موضع شارة الفرع في الرأس — قاعدة «شارة واحدة ظاهرة دائماً»:
 *  - وضع القوائم العلوي: الرأس لا يعرضها (تعرضها MenuBar فوق اسم المستخدم).
 *  - شريط جانبي موسّع: الرأس لا يعرضها (تعرضها Sidebar).
 *  - شريط جانبي مطوي: الرأس يعرضها وإلا اختفت الشارة من الشاشة.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Header } from '../src/ui/layout/Header.tsx'
import { useAppStore } from '../src/stores/app.store.ts'
import { useRawDataStore } from '../src/data/repo.ts'

const branch = (over: Record<string, unknown> = {}) => ({
  id: 2, nameAr: 'فرع المنصورة', isMain: false, warehouseId: 2, treasuryCode: '1102',
  active: true, customModulesMode: 'all', enabledModules: [], ...over,
})

const setup = (navigationMode: 'topbar' | 'sidebar') => {
  useAppStore.setState({ appearance: { ...useAppStore.getState().appearance, navigationMode } })
  useRawDataStore.setState({
    branches: [branch()],
    appUsers: [{ id: 3, nameAr: 'محمود علي', roleId: 'cashier', pinHash: '0'.repeat(64), active: true, branchId: 2 }],
    currentUserId: 3,
    activeBranchId: null,
  })
}

const renderHeader = (collapsed: boolean) =>
  render(<MemoryRouter><Header title="الرئيسية" sidebarCollapsed={collapsed} /></MemoryRouter>)

beforeEach(() => setup('sidebar'))

describe('موضع شارة الفرع في الرأس', () => {
  it('شريط جانبي مطوي: الشارة ظاهرة فوق اسم المستخدم مع اسم الفرع', () => {
    const { container } = renderHeader(true)
    const badge = container.querySelector('[data-branch-badge="header"]')
    expect(badge).toBeTruthy()
    expect(badge?.textContent).toContain('فرع المنصورة')
    expect(screen.getByText('محمود علي')).toBeTruthy()
  })

  it('شريط جانبي موسّع: لا تكرار في الرأس (الشارة في الشريط الجانبي)', () => {
    const { container } = renderHeader(false)
    expect(container.querySelector('[data-branch-badge="header"]')).toBeNull()
  })

  it('وضع القوائم العلوي: الرأس لا يعرضها (MenuBar يعرضها)', () => {
    setup('topbar')
    const { container } = renderHeader(true)
    expect(container.querySelector('[data-branch-badge="header"]')).toBeNull()
  })
})
