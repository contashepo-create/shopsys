import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'

vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
const { useDataStore } = await import('../src/data/repo.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { todayLocalIso } = await import('../src/core/time.ts')
const { BookingsPage } = await import('../src/ui/pages/BookingsPage.tsx')
const { ToastHost } = await import('../src/ui/components/ui.tsx')

const day = todayLocalIso()
const fixtures = [
  { id: 81001, customerName: 'عميل أول', phone: '', itemId: null, serviceName: 'قص شعر', date: day, time: '10:00', durationMin: 30, status: 'scheduled' as const, notes: '', createdAt: '2026-10-25T08:00:00.000Z' },
  { id: 81002, customerName: 'عميل ثان', phone: '', itemId: null, serviceName: 'صبغة', date: day, time: '12:00', durationMin: 30, status: 'scheduled' as const, notes: '', createdAt: '2026-10-25T08:00:00.000Z' },
]

beforeEach(() => {
  useDataStore.setState({ bookings: fixtures })
  const app = useAppStore.getState()
  useAppStore.setState({ ...app, setup: { ...app.setup, activityId: 'salon', modules: [...new Set([...app.setup.modules, 'booking'])] } })
})
afterEach(() => cleanup())

describe('تأكيد التداخل في الحجوزات من الواجهة', () => {
  it('لا يحفظ موعداً جديداً متداخلاً قبل نقرة موافقة ثانية', () => {
    render(<MemoryRouter><BookingsPage /><ToastHost /></MemoryRouter>)
    const before = useDataStore.getState().bookings.length
    fireEvent.click(screen.getByRole('button', { name: /حجز موعد/ }))
    fireEvent.change(screen.getByPlaceholderText('مثال: أحمد محمود'), { target: { value: 'عميل جديد' } })
    fireEvent.click(screen.getByRole('button', { name: /متابعة رغم التداخل/ }))

    expect(useDataStore.getState().bookings).toHaveLength(before)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /حجز/ }))
    expect(useDataStore.getState().bookings).toHaveLength(before + 1)
    expect(useDataStore.getState().bookings.at(-1)?.customerName).toBe('عميل جديد')
  })

  it('لا يحفظ تعديلاً متداخلاً قبل نقرة موافقة ثانية', () => {
    render(<MemoryRouter><BookingsPage /><ToastHost /></MemoryRouter>)
    const row = screen.getByText('عميل أول').closest('.flex.flex-wrap.items-center.gap-3')
    expect(row).not.toBeNull()
    const editButton = within(row as HTMLElement).getAllByRole('button').find((button) => button.querySelector('svg.lucide-pencil'))
    expect(editButton).toBeDefined()
    fireEvent.click(editButton!)

    const timeInput = document.querySelector('input[type="time"]') as HTMLInputElement
    fireEvent.change(timeInput, { target: { value: '12:15' } })
    fireEvent.click(screen.getByRole('button', { name: /متابعة رغم التداخل/ }))

    expect(useDataStore.getState().bookings.find((booking) => booking.id === 81001)?.time).toBe('10:00')
    fireEvent.click(screen.getByRole('button', { name: /حفظ التعديل/ }))
    expect(useDataStore.getState().bookings.find((booking) => booking.id === 81001)?.time).toBe('12:15')
  })
})
