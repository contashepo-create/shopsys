import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { bookingWhatsappLink, buildBookingReminderMessage } from '../src/core/booking.ts'
import { ticketWhatsappLink } from '../src/core/maintenance.ts'
import { laundryWhatsappLink } from '../src/core/laundry.ts'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { todayLocalIso } from '../src/core/time.ts'
import { BookingsPage } from '../src/ui/pages/BookingsPage.tsx'
import { MaintenancePage } from '../src/ui/pages/MaintenancePage.tsx'
import { LaundryPage } from '../src/ui/pages/LaundryPage.tsx'
import { ToastHost } from '../src/ui/components/ui.tsx'

const raw = useRawDataStore.getState()
const app = useAppStore.getState()
const open = vi.spyOn(window, 'open').mockImplementation(() => null)

beforeEach(() => {
  open.mockClear()
  const setup = { ...app.setup, completed: true, countryCode: 'SA' }
  useAppStore.setState({ setup, companySetup: setup })
  useRawDataStore.setState({ ...raw, currentUserId: null, activeBranchId: null, branches: [], bookings: [], tickets: [], laundryOrders: [] })
})
afterEach(() => { cleanup(); useRawDataStore.setState(raw); useAppStore.setState(app) })

describe.each([['الحجز', bookingWhatsappLink], ['الصيانة', ticketWhatsappLink], ['المغسلة', laundryWhatsappLink]])('%s — رقم العميل', (_label, link) => {
  it.each([
    ['٠٥٠١٢٣٤٥٦٧', 'SA', '966501234567'],
    ['0501234567', 'AE', '971501234567'],
    ['01012345678', 'EG', '201012345678'],
    ['+966 50 123 4567', null, '966501234567'],
    ['00971501234567', 'EG', '971501234567'],
  ])('يبني رابط %s مع %s', (phone, country, international) => {
    expect(link(phone, 'رسالة', country)).toBe(`https://wa.me/${international}?text=${encodeURIComponent('رسالة')}`)
  })
  it.each(['', '0501234567', 'غير رقم', '+12', '0000000000'])('يرفض الرقم المفقود أو الملتبس أو المعيب: %s', (phone) => {
    expect(() => link(phone, 'رسالة', null)).toThrow()
  })
  it('يرفض رقماً محلياً زائفاً حتى مع البلد', () => expect(() => link('0000000000', 'رسالة', 'SA')).toThrow())
})

it('رسالة الموعد تذكر التاريخ دون وصفه غداً عند اختيار يوم آخر', () => {
  expect(buildBookingReminderMessage({ customerName: 'عميل', serviceName: 'خدمة', date: '2026-12-31', time: '10:00' }, 'متجر')).not.toContain('غداً')
})

it('واجهة التذكير تفتح الرقم السعودي وترفض الرقم الملتبس عند غياب البلد', () => {
  const day = todayLocalIso()
  useRawDataStore.setState({ bookings: [{ id: 1, customerName: 'عميل', phone: '٠٥٠١٢٣٤٥٦٧', itemId: null, serviceName: 'خدمة', date: day, time: '10:00', durationMin: 30, status: 'scheduled', notes: '', createdAt: day }] })
  render(<MemoryRouter><BookingsPage /><ToastHost /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: /تذكيرات واتساب/ }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'اليوم' }))
  fireEvent.click(screen.getByRole('button', { name: /تذكير$/ }))
  expect(open).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/wa\.me\/966501234567\?text=/), '_blank', 'noopener')
  expect(screen.getByText(/لا تؤكد الإرسال/)).toBeTruthy()
  open.mockClear()
  act(() => useAppStore.setState({ setup: { ...useAppStore.getState().setup, countryCode: null } as never }))
  fireEvent.click(screen.getByRole('button', { name: /تذكير$/ }))
  expect(open).not.toHaveBeenCalled()
  expect(screen.getByText(/بلد رقم واتساب غير معروف/)).toBeTruthy()
})

it('الصيانة لا تسجّل محاولة محظورة ولا تدعي الإرسال عند فتح الرابط', () => {
  const t = useRawDataStore.getState().openTicket({ customerId: null, customerName: 'عميل صيانة', customerPhone: '0501234567', deviceName: 'جهاز', issue: 'عطل', estimateMinor: 0, notes: '' })
  render(<MemoryRouter><MaintenancePage /><ToastHost /></MemoryRouter>)
  const button = screen.getByTitle(/إبلاغ العميل بحالة الجهاز عبر واتساب/)
  fireEvent.click(button)
  expect(open).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/wa\.me\/966501234567\?text=/), '_blank', 'noopener')
  expect(useRawDataStore.getState().tickets.find(row => row.id === t.id)?.notifications ?? []).toHaveLength(0)
  open.mockClear()
  act(() => useAppStore.setState({ setup: { ...useAppStore.getState().setup, countryCode: null } as never }))
  fireEvent.click(button)
  expect(open).not.toHaveBeenCalled()
  expect(useRawDataStore.getState().tickets.find(row => row.id === t.id)?.notifications ?? []).toHaveLength(0)
  expect(screen.getByText(/بلد رقم واتساب غير معروف/)).toBeTruthy()
})

it('المغسلة لا تسجّل إرسالاً لمجرد محاولة فتح المحادثة', () => {
  const o = useRawDataStore.getState().openLaundryOrder({ customerId: null, customerName: 'عميل مغسلة', phone: '0501234567', promisedAt: '', lines: [{ desc: 'قميص', service: 'wash', qty: 1, unitPriceMinor: 1000 }], prepaidMinor: 0, notes: '' })
  render(<MemoryRouter><LaundryPage /><ToastHost /></MemoryRouter>)
  fireEvent.click(screen.getByText(o.orderNumber))
  const button = screen.getByRole('button', { name: /إبلاغ العميل واتساب/ })
  fireEvent.click(button)
  expect(open).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/wa\.me\/966501234567\?text=/), '_blank', 'noopener')
  expect(useRawDataStore.getState().laundryOrders.find(row => row.id === o.id)?.notifications ?? []).toHaveLength(0)
  open.mockClear()
  act(() => useAppStore.setState({ setup: { ...useAppStore.getState().setup, countryCode: null } as never }))
  fireEvent.click(button)
  expect(open).not.toHaveBeenCalled()
  expect(useRawDataStore.getState().laundryOrders.find(row => row.id === o.id)?.notifications ?? []).toHaveLength(0)
  expect(screen.getByText(/بلد رقم واتساب غير معروف/)).toBeTruthy()
})

it('تعذّر فتح النافذة يعرض الخطأ ولا يدعي نجاح الإرسال', async () => {
  const { openCustomerWhatsapp } = await import('../src/ui/components/openCustomerWhatsapp.ts')
  const toast = { show: vi.fn() }
  open.mockImplementationOnce(() => { throw new Error('تعذر فتح النافذة') })
  openCustomerWhatsapp(() => ticketWhatsappLink('+966501234567', 'رسالة'), toast)
  expect(toast.show).toHaveBeenCalledWith('تعذر فتح النافذة', 'error')
  expect(toast.show).not.toHaveBeenCalledWith(expect.stringMatching(/لا تؤكد الإرسال/))
})
