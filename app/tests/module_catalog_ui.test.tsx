/**
 * فجوات §6 المتبقية — فحص سلوكي (لا نصياً):
 *  · ف1: تبويب مبيعات لا يظهر لنشاط بلا كاشير وبلا مبيعات، ويُوسم «لا حركة بعد» عند الفراغ.
 *  · ف2: بطاقة «تقارير أقسامك المضافة» تُدعى من كتالوج الوحدات بمسارات حقيقية.
 *  · ف4: قوالب مصروف الوحدة تُضاف بضغطة واحدة إلى بنود المصروف.
 *  · ف5: ودجت الوحدة المطعَّمة يظهر في اللوحة ولو لم يكن نشاطه الأصلي.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'

vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { useDataStore } = await import('../src/data/repo.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { ReportsPage } = await import('../src/ui/pages/ReportsPage.tsx')
const { CostCentersPage } = await import('../src/ui/pages/CostCentersPage.tsx')
const { ActivityWidgets } = await import('../src/ui/components/ActivityWidgets.tsx')
const { ToastHost } = await import('../src/ui/components/ui.tsx')


/* عزل DOM بين الاختبارات: فشل اختبار لا يُسقط الذي بعده */
afterEach(() => cleanup())

const S = () => useDataStore.getState()

/** يضبط النشاط والوحدات المفعّلة — نفس ما تفعله شاشة الإعدادات عند تغيير النشاط */
function useActivity(activityId: string, modules: string[]) {
  const app = useAppStore.getState()
  useAppStore.setState({
    ...app,
    setup: {
      ...app.setup, completed: true, countryCode: 'EG', activityId, shopName: 'اختبار',
      ownerName: 'المالك', features: [], modules, accountingMode: 'full', vatPercent: 14,
    },
  })
}

beforeAll(() => {
  localStorage.clear()
  useActivity('realestate', ['inventory', 'purchases', 'realestate'])
  S().addCategory('بضائع', [])
  S().addItem({
    nameAr: 'مفك حراري', sku: 'TOL-1', barcodes: [], categoryId: S().categories[0]?.id ?? 0, baseUnit: 'قطعة',
    extraUnits: [], costMinor: 3000, stockQty: 1, priceMinor: 5000, minQty: 5, trackExpiry: false,
    trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true,
  })
})

const mount = (el: React.ReactElement) => render(<MemoryRouter>{el}<ToastHost /></MemoryRouter>)

describe('ف1 — تبويبات التقارير تتبع الوحدة والبيانات', () => {
  it('نشاط بلا كاشير (عقارات) لا يرى تبويب المبيعات، ويرى تبويبات النواة', () => {
    const view = mount(<ReportsPage />)
    expect(document.querySelector('[data-report-tab="sales"]'), 'تبويب المبيعات ظهر لنشاط بلا كاشير وبلا مبيعات').toBeNull()
    expect(document.querySelector('[data-report-tab="financial"]'), 'تبويب القوائم المالية غائب عن نشاط نواة').toBeTruthy()
    expect(document.querySelector('[data-report-tab="inventory"]'), 'تبويب المخزون غائب رغم وجود وحدة المخزون').toBeTruthy()
    cleanup()
    view.unmount()
  })

  it('التبويب الظاهر بلا حركة يُوسم «لا حركة بعد» بدل الفراغ', () => {
    const view = mount(<ReportsPage />)
    const partiesTab = document.querySelector('[data-report-tab="parties"]')!
    const chip = partiesTab.querySelector('[data-report-empty]')
    expect(chip, 'الوسم لا يظهر حين لا حركة').toBeTruthy()
    expect(chip!.textContent).toContain('لا حركة بعد')
    cleanup()
    view.unmount()
  })

  it('نشاط بكاشير يرى تبويب المبيعات', () => {
    useActivity('grocery', ['pos', 'inventory', 'purchases'])
    const view = mount(<ReportsPage />)
    expect(document.querySelector('[data-report-tab="sales"]'), 'نشاط بكاشير لا يرى تبويب المبيعات').toBeTruthy()
    cleanup()
    view.unmount()
  })
})

describe('ف2 — بطاقة تقارير أقسامك المضافة', () => {
  it('تجمع تقارير الوحدة المضافة بمسارات حقيقية', () => {
    useActivity('realestate', ['inventory', 'purchases', 'realestate'])
    const view = mount(<ReportsPage />)
    const card = document.querySelector('[data-report-module-card]')
    expect(card, 'البطاقة غائبة رغم وجود وحدة مضافة').toBeTruthy()
    const block = document.querySelector('[data-report-module="realestate"]')
    expect(block, 'تقارير العقارات غير مُدرجة').toBeTruthy()
    const links = [...block!.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(links).toContain('/realestate/leases')
    cleanup()
    view.unmount()
  })
})

describe('ف5 — ودجات الوحدات المضافة', () => {
  it('سوبرماركت طُعّمت بمغسلة يرى ودجت «أوامر غسيل مفتوحة»', () => {
    useActivity('grocery', ['pos', 'inventory', 'purchases', 'laundry'])
    const view = mount(<ActivityWidgets />)
    expect(document.body.textContent, 'ودجت المغسلة لا يظهر رغم تفعيل الوحدة').toContain('أوامر غسيل مفتوحة')
    cleanup()
    view.unmount()
  })

  it('نشاط بلا الوحدة لا يرى ودجتها', () => {
    useActivity('grocery', ['pos', 'inventory', 'purchases'])
    const view = mount(<ActivityWidgets />)
    expect(document.body.textContent, 'ودجت المغسلة ظهر بلا وحدة').not.toContain('أوامر غسيل مفتوحة')
    cleanup()
    view.unmount()
  })
})

describe('ف4 — قوالب مصروف الوحدة', () => {
  it('تظهر بضغطة واحدة داخل «بنود المصروف» وتُضاف فعلاً', () => {
    useActivity('grocery', ['pos', 'inventory', 'purchases', 'laundry'])
    const view = mount(<CostCentersPage />)
    fireEvent.click([...view.container.querySelectorAll('button')].find((b) => b.textContent?.startsWith('بنود المصروف'))!)
    const button = document.querySelector('[data-module-template="laundry"]') as HTMLButtonElement | null
    expect(button, 'قوالب الوحدة المضافة غير معروضة في الشاشة').toBeTruthy()
    const before = S().expenseTemplates.length
    fireEvent.click(button!)
    expect(S().expenseTemplates.length, 'الضغطة لم تُضف بنداً').toBe(before + 1)
    expect(S().expenseTemplates.at(-1)?.nameAr, 'البند المُضاف ليس قالب الوحدة').toContain('مواد تنظيف')
    cleanup()
    view.unmount()
  })
})
