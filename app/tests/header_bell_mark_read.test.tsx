/**
 * إثبات واجهي كامل لبلاغ المالك 2026-10-21: «إشعار ضبط الموازنة لا يختفي عند تعليمه كمقروء».
 * يرسم `Header` الحقيقي مع متجر البيانات: يُنشئ تنبيهاً حقيقياً (صنف تحت حد إعادة الطلب)،
 * يفتح الجرس، يعلّم التنبيه كمقروء بزر ✓، ثم يتحقق أن الشارة والتنبيه اختفيا فعلاً
 * وأن البيانات نفسها (readNotificationIds) ما زالت مبدوءة ببادئة النطاق كما هي.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'

vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { useDataStore } = await import('../src/data/repo.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { Header } = await import('../src/ui/layout/Header.tsx')
const { ToastHost } = await import('../src/ui/components/ui.tsx')

const S = () => useDataStore.getState()
const ui = () => render(<MemoryRouter><Header title="الرئيسية" /><ToastHost /></MemoryRouter>)
const bellButton = () => document.querySelector('button[title*="تنبيه"]') as HTMLButtonElement | null

describe('جرس التنبيهات — التعليم كمقروء يُزيل الإشعار فعلاً', () => {
  beforeEach(() => {
    localStorage.clear()
    useAppStore.getState().updateSetup({
      completed: true,
      countryCode: 'EG',
      activityId: 'general',
      shopName: 'محل الاختبار',
      ownerName: 'المالك',
      features: [],
      modules: [],
      accountingMode: 'simple',
      vatPercent: 14,
      allowNegativeTreasury: true,
    })
    useDataStore.setState({ items: [], categories: [], journal: [], treasuries: [], projects: [], projectBudgets: [], projectCosts: [], readNotificationIds: [] })
    S().addCategory?.({ nameAr: 'عام' })
    // صنف تحت حد إعادة الطلب ⇒ تنبيه «مخزون منخفض» حقيقي في الجرس
    S().addItem({
      nameAr: 'أرز 1كجم', categoryId: null, unit: 'كيس', priceMinor: 6000, costMinor: 4800,
      barcode: '', sku: '', isActive: true, trackExpiry: false, trackSerial: false, soldByWeight: false,
      isService: false, minSalePriceMinor: 0, stockQty: 0, minQty: 5,
    })
  })

  afterEach(cleanup)

  it('التنبيه يظهر غير مقروء، وبعد ✓ يصبح مقروءاً ولا يبقى في الشارة', async () => {
    ui()
    const bell = bellButton()
    expect(bell).not.toBeNull()
    expect(bell!.title).toContain('غير مقروء')

    fireEvent.click(bell!)
    const markButton = document.querySelector('button[title="تعليم كمقروء"]') as HTMLButtonElement
    expect(markButton).not.toBeNull()

    // الالتقاط قبل الضغط: عنوان التنبيه معروض في القائمة
    expect(document.body.textContent).toContain('مخزون منخفض')

    fireEvent.click(markButton)
    await waitFor(() => expect(document.body.textContent).not.toContain('مخزون منخفض'))
    expect(document.body.textContent).toContain('كل التنبيهات مقروءة')
    expect(document.body.textContent).toContain('في الأرشيف')
    // التخزين يحتفظ بالبادئة (عزل النطاقات وبث الشبكة المحلية)
    expect(S().readNotificationIds.some((id) => id.startsWith('notification-read:v1:'))).toBe(true)
    expect(S().scopedReadNotificationIds().some((id) => id.startsWith('low:'))).toBe(true)
  })

  it('«تعليم الكل كمقروء» يفرغ الشارة، و«إظهار المقروءة» يعيدها', async () => {
    ui()
    fireEvent.click(bellButton()!)
    const markAll = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('تعليم الكل كمقروء'))!
    fireEvent.click(markAll)
    await waitFor(() => expect(document.body.textContent).toContain('كل التنبيهات مقروءة'))
    expect(bellButton()!.title).toBe('لا تنبيهات جديدة')

    const restore = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('إظهار المقروءة'))!
    fireEvent.click(restore)
    await waitFor(() => expect(document.body.textContent).toContain('مخزون منخفض'))
    expect(bellButton()!.title).toContain('غير مقروء')
  })
})
