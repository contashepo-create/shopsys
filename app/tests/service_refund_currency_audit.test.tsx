import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ServiceRefundBox } from '../src/ui/components/ServiceRefundBox.tsx'
import { useAppStore } from '../src/stores/app.store.ts'
import { useRawDataStore } from '../src/data/repo.ts'

const app = useAppStore.getState()
const data = useRawDataStore.getState()
afterEach(() => { cleanup(); useAppStore.setState(app); useRawDataStore.setState(data) })
it.each([['KW', '١٫٢٣٤', 1234], ['IQ', '12', 12], ['EG', '12.34', 1234]] as const)('يستخدم كسور عملة %s ومدخلاتها في المرتجع الحر', (countryCode, amount, expected) => {
  useAppStore.setState({ ...app, setup: { ...app.setup, countryCode } })
  useRawDataStore.setState({ ...data, appUsers: [], currentUserId: null })
  const submit = vi.fn()
  render(<ServiceRefundBox grandMinor={100000} refundedMinor={0} currencySymbol="عملة" fmt={String} allowCredit={false} onSubmit={submit} />)
  fireEvent.change(screen.getByPlaceholderText('المبلغ المردود (شامل الضريبة)'), { target: { value: amount } })
  fireEvent.click(screen.getByRole('button', { name: /تنفيذ المرتجع/ }))
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: expected }))
})
