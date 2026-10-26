/**
 * موضع شارة الفرع في الرأس — القرار المعتمد من المالك (2026-10-22):
 *  - وضع الشريط الجانبي (موسّعاً أو مطوياً): تظهر **فوق اسم المستخدم** في الرأس.
 *  - وضع القوائم العلوي: تعرضها MenuBar أعلى هذا الموضع، فلا تتكرر في الرأس.
 * (الشريط الجانبي الموسّع يعرض نسخة ثانية أعلى قائمته — سلوك معتمد.)
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Header } from '../src/ui/layout/Header.tsx'
import { useAppStore } from '../src/stores/app.store.ts'
import { useRawDataStore } from '../src/data/repo.ts'

import type { Branch } from '../src/core/branches.ts'
const branch = (over: Partial<Branch> = {}): Branch => ({
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

const renderHeader = () =>
  render(<MemoryRouter><Header title="الرئيسية" /></MemoryRouter>)

beforeEach(() => setup('sidebar'))

describe('موضع شارة الفرع في الرأس', () => {
  it('وضع الشريط الجانبي: الشارة فوق اسم المستخدم مع اسم الفرع', () => {
    const { container } = renderHeader()
    const badge = container.querySelector('[data-branch-badge="header"]')
    expect(badge).toBeTruthy()
    expect(badge?.textContent).toContain('فرع المنصورة')
    expect(screen.getByText('محمود علي')).toBeTruthy()
  })

  it('وضع القوائم العلوي: الشارة في الرأس وفق موضعها المعتمد', () => {
    setup('topbar')
    const { container } = renderHeader()
    const badge = container.querySelector('[data-branch-badge="header"]')
    expect(badge).toBeTruthy()
    expect(badge?.textContent).toContain('فرع المنصورة')
  })

  it('موظف مقيَّد بفرع: الشارة مقفولة بلا مبدّل', () => {
    useRawDataStore.setState({
      appUsers: [{ id: 3, nameAr: 'محمود علي', roleId: 'cashier', pinHash: '0'.repeat(64), active: true, branchId: 2 }],
      currentUserId: 3,
      activeBranchId: 2,
    })
    const { container } = renderHeader()
    const badge = container.querySelector('[data-branch-badge="header"]')
    expect(badge).toBeTruthy()
    expect(container.querySelector('[data-branch-badge="header"] select')).toBeNull()
  })
})
