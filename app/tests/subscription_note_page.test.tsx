/**
 * F14: رسالة المطوّر تظهر للعميل في صفحة الترخيص — وهي الشاشة المتاحة حتى عند الإيقاف.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'

const { useAppStore } = await import('../src/stores/app.store.ts')
const { LicensePage } = await import('../src/ui/pages/LicensePage.tsx')
const { ToastHost } = await import('../src/ui/components/ui.tsx')

afterEach(() => {
  cleanup()
  useAppStore.setState({ cloudSubscriptionNote: '' })
})

describe('رسالة المطوّر في صفحة الترخيص', () => {
  it('تظهر عند وجودها وتختفي عند مسحها', () => {
    render(<MemoryRouter><LicensePage /><ToastHost /></MemoryRouter>)
    expect(screen.queryByText('رسالة من المطوّر')).toBeNull()

    act(() => {
      useAppStore.getState().setCloudData({ subscriptionNote: 'تم إيقاف الاشتراك — تواصل مع المطوّر' })
    })
    expect(screen.getByText('رسالة من المطوّر')).toBeTruthy()
    expect(screen.getByText('تم إيقاف الاشتراك — تواصل مع المطوّر')).toBeTruthy()

    act(() => {
      useAppStore.getState().setCloudData({ subscriptionNote: '' })
    })
    expect(screen.queryByText('رسالة من المطوّر')).toBeNull()
  })
})
