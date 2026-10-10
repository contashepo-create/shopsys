/**
 * الإطفاء السحابي يصل الشاشة المفتوحة فوراً — لا عند إعادة التشغيل فقط.
 *
 * الخلل الذي يمنعه هذا الاختبار: حالة الترخيص كانت تُحسب داخل useMemo بمعتمديات لا تشمل
 * أعلام الجهاز، فيبقى الميزة ظاهرة بعد وصول الإطفاء حتى تُعاد تهيئة الصفحة.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'

const { useAppStore } = await import('../src/stores/app.store.ts')
const { TelegramPage } = await import('../src/ui/pages/TelegramPage.tsx')
const { ToastHost } = await import('../src/ui/components/ui.tsx')
const { setActiveDeviceFlags } = await import('../src/core/featureFlags.ts')

const today = new Date().toISOString().slice(0, 10)
const payload = {
  v: 1 as const, deviceId: 'DEV-1', customer: 'محل', plan: 'pro' as const,
  features: ['telegram_bot' as const], issuedAt: today, expiresAt: null,
}

afterEach(() => {
  cleanup()
  setActiveDeviceFlags(null)
  useAppStore.setState({ deviceFlags: null })
})

describe('إطفاء الميزة من المتجر يصل الصفحة المفتوحة', () => {
  it('بوت التليجرام: ممنوح ⇒ الصفحة مفتوحة، ثم إطفاء سحابي ⇒ شاشة القفل فوراً', async () => {
    useAppStore.setState({ activatedPayload: payload, trialStartedAt: today, lastSeenAt: today, deviceFlags: null })
    render(<MemoryRouter><TelegramPage /><ToastHost /></MemoryRouter>)
    expect(screen.queryByText('بوت التليجرام ميزة مرخّصة')).toBeNull()

    act(() => {
      useAppStore.getState().setCloudData({ flags: { disabledFeatures: ['telegram_bot'], noteAr: 'متأخر في السداد', updatedAt: today } })
    })
    expect(await screen.findByText('بوت التليجرام ميزة مرخّصة')).toBeTruthy()
  })
})
