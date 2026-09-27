/**
 * دليل نشاطك (طلب المالك): «الشروحات تخص النشاط الحالي فقط، وشرح مفصل لكل قسم
 * داخله مع مثال لكل شيء — ولا تشرح نشاطاً داخل نشاط آخر».
 * هذه الاختبارات ترسم الصفحة فعلياً لثلاثة أنشطة مختلفة وتتحقق من العزل والتفصيل.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, fireEvent, cleanup, within } from '@testing-library/react'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
const { useAppStore } = await import('../src/stores/app.store.ts')
const { GuidesPage } = await import('../src/ui/pages/GuidesPage.tsx')
const { getActivity } = await import('../src/core/activities.ts')
const { ALL_SCREEN_GUIDES, screenGuideFor } = await import('../src/core/activityGuide.ts')
const { playbookFor } = await import('../src/core/activityPlaybook.ts')

function useActivity(activityId: string) {
  const tpl = getActivity(activityId)!
  const app = useAppStore.getState()
  useAppStore.setState({
    ...app,
    setup: { ...app.setup, completed: true, countryCode: 'EG', shopName: 'متجر', ownerName: 'مالك', activityId, modules: [...tpl.modules], features: [...tpl.features] },
  })
}

const renderGuides = () => render(<MemoryRouter><GuidesPage /></MemoryRouter>)
const screens = (c: HTMLElement) => [...c.querySelectorAll('[data-guide-screen]')].map((el) => el.getAttribute('data-guide-screen')!)

beforeEach(() => useActivity('feed_trade'))
afterEach(() => cleanup())

describe('دليل النشاط — العزل بين الأنشطة', () => {
  it('تاجر الأعلاف يرى أقسامه فقط: لا مقاولات ولا معمل ولا مغسلة', () => {
    const { container } = renderGuides()
    const paths = screens(container)
    expect(paths).toContain('/pos')
    expect(paths).toContain('/inventory/items')
    expect(paths).toContain('/purchases/invoices')
    expect(paths.some((p) => p.startsWith('/contracting'))).toBe(false)
    expect(paths.some((p) => p.startsWith('/lab'))).toBe(false)
    expect(paths.some((p) => p.startsWith('/laundry'))).toBe(false)
    expect(paths.some((p) => p.startsWith('/realestate'))).toBe(false)
    expect(container.textContent).not.toContain('المستخلص')
    expect(container.textContent).not.toContain('المريض')
  })

  it('المعمل يرى شاشاته الطبية ولا يرى شاشة البيع ولا المخزون', () => {
    useActivity('lab')
    const { container } = renderGuides()
    const paths = screens(container)
    expect(paths).toContain('/lab/orders')
    expect(paths).toContain('/lab/tests')
    expect(paths).not.toContain('/pos')
    expect(paths).not.toContain('/inventory/items')
    expect(container.textContent).not.toContain('الجرد')
  })

  it('المقاولات ترى المستخلصات ولا ترى الكاشير ولا عروض المبيعات', () => {
    useActivity('contracting')
    const { container } = renderGuides()
    const paths = screens(container)
    expect(paths).toContain('/contracting/projects')
    expect(paths).toContain('/contracting/boq')
    expect(paths).not.toContain('/pos')
    expect(paths).not.toContain('/sales/promotions')
  })

  it('خاصية غير مفعّلة تُخفي شاشتها: باركود الميزان للأعلاف لا للملابس', () => {
    const feed = renderGuides()
    expect(screens(feed.container)).toContain('/inventory/scale')
    cleanup()
    useActivity('clothing')
    const clothing = renderGuides()
    expect(screens(clothing.container)).not.toContain('/inventory/scale')
    expect(screens(clothing.container)).toContain('/inventory/items')
    cleanup()
    useActivity('mobile')
    const mobile = renderGuides()
    expect(screens(mobile.container)).toContain('/inventory/serials')
    expect(screens(mobile.container)).toContain('/maintenance/tickets')
  })
})

describe('دليل النشاط — تفصيل كل قسم', () => {
  it('فتح القسم يعرض الغرض والخطوات والمثال والأثر المحاسبي وزر فتح الشاشة', () => {
    const { container } = renderGuides()
    const card = container.querySelector('[data-guide-screen="/purchases/invoices"]') as HTMLElement
    expect(card).toBeTruthy()
    fireEvent.click(within(card).getByRole('button'))
    const text = card.textContent ?? ''
    expect(text).toContain('الغرض')
    expect(text).toContain('متى تستخدمه')
    expect(text).toContain('خطوات العمل')
    expect(text).toContain('مثال عملي من نشاطك')
    expect(text).toContain('الأثر المحاسبي والمخزني')
    expect(card.querySelector('[data-guide-example]')).toBeTruthy()
    expect(card.querySelector('[data-guide-open="/purchases/invoices"]')).toBeTruthy()
  })

  it('المثال يتكلم بلغة النشاط نفسه: الأعلاف بالشيكارة والملابس بالقطعة', () => {
    const { container } = renderGuides()
    const feedCard = container.querySelector('[data-guide-screen="/purchases/invoices"]') as HTMLElement
    fireEvent.click(within(feedCard).getByRole('button'))
    const feedExample = feedCard.querySelector('[data-guide-example]')!.textContent ?? ''
    expect(feedExample).toContain('علف بادئ 25 كجم')
    expect(feedExample).toContain('شيكارة')
    cleanup()

    useActivity('clothing')
    const c2 = renderGuides()
    const clothingCard = c2.container.querySelector('[data-guide-screen="/purchases/invoices"]') as HTMLElement
    fireEvent.click(within(clothingCard).getByRole('button'))
    const clothingExample = clothingCard.querySelector('[data-guide-example]')!.textContent ?? ''
    expect(clothingExample).toContain('قميص قطن رجالي')
    expect(clothingExample).not.toContain('شيكارة')
  })

  it('لا يبقى أي قالب {…} غير مستبدل في أي شرح معروض', () => {
    const { container } = renderGuides()
    const cards = [...container.querySelectorAll('[data-guide-screen]')] as HTMLElement[]
    for (const card of cards) fireEvent.click(within(card).getByRole('button'))
    expect(container.textContent).not.toMatch(/\{\w+\}/)
  })

  it('دورة العمل اليومية ونقاط التركيز تظهر لكل نشاط', () => {
    const { container } = renderGuides()
    const pb = container.querySelector('[data-guide-playbook]')!
    expect(pb.textContent).toContain('دورة عملك اليومية')
    expect(pb.textContent).toContain(playbookFor('feed_trade').dailyCycleAr[0])
    expect(pb.textContent).toContain('ركّز على هذه النقاط')
  })

  it('البحث يصفّي الأقسام ويعرض «لا نتائج» للكلمة غير الموجودة', () => {
    const { container } = renderGuides()
    const box = container.querySelector('[data-guide-search]') as HTMLInputElement
    const before = screens(container).length
    fireEvent.change(box, { target: { value: 'الجرد' } })
    const after = screens(container)
    expect(after.length).toBeLessThan(before)
    expect(after).toContain('/inventory/counting')
    fireEvent.change(box, { target: { value: 'كلمة-لا-توجد-إطلاقاً' } })
    expect(screens(container).length).toBe(0)
    expect(container.textContent).toContain('لا نتائج')
  })
})

describe('دليل النشاط — نواة المحتوى', () => {
  it('كل شرح فيه خطوات ومثال وأثر محاسبي', () => {
    for (const [path, g] of Object.entries(ALL_SCREEN_GUIDES)) {
      expect(g.stepsAr.length, path).toBeGreaterThanOrEqual(3)
      expect(g.exampleAr.length, path).toBeGreaterThanOrEqual(1)
      expect(g.effectAr.length, path).toBeGreaterThanOrEqual(1)
    }
    expect(Object.keys(ALL_SCREEN_GUIDES).length).toBeGreaterThanOrEqual(85)
  })

  it('screenGuideFor يملأ الأرقام من عيّنة النشاط ويعيد null لشاشة مجهولة', () => {
    const feed = screenGuideFor('/pos', 'feed_trade')!
    expect(feed.exampleAr.join(' ')).toContain('24,000')
    expect(screenGuideFor('/route/not-real', 'feed_trade')).toBeNull()
  })
})
