import { afterEach, beforeEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SubcontractorsPage } from '../src/ui/pages/ContractingDepthPages.tsx'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { useToast } from '../src/ui/components/ui.tsx'

/**
 * شاشة توريد ضريبة الاستقطاع (2112) — كانت العملية جاهزة ومختبرة في النواة
 * (`remitWithholdingTax`) وبلا أي زر في الشاشة، فيبقى الالتزام معلقاً على الحساب.
 * الاختبار يثبت: عرض المستحق، ثم ترحيل سند صرف يصفّر 2112 ويسحب من الخزينة.
 */
const initial = useRawDataStore.getState()
const app = useAppStore.getState()

const entry = (id: number, lines: { accountCode: string; debit?: number; credit?: number }[]) => ({
  id, entryNumber: id, date: '2026-11-01', description: 'شهادة باطن', sourceType: 'sub_certificate' as const, sourceId: id,
  sourceCollection: 'subCertificates', lines: lines.map((line) => ({ accountCode: line.accountCode, debit: line.debit ?? 0, credit: line.credit ?? 0, note: '' })),
  createdBy: 'المالك', createdAt: '2026-11-01T10:00:00+03:00', reversedByEntryId: null, reversesEntryId: null,
})

beforeEach(() => {
  const setup = { ...app.setup, completed: true, countryCode: 'EG' as const, activityId: 'contracting' as const, requireOpenShiftForSales: false, vatPercent: 0, allowNegativeTreasury: true }
  useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
  useRawDataStore.setState({
    ...initial, currentUserId: null, activeBranchId: null, branches: [], employees: [], customers: [],
    subContracts: [], subCertificates: [], subPayments: [], vouchers: [],
    treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', openingBalanceMinor: 0, isDefault: true }] as never,
    journal: [entry(1, [{ accountCode: '5110', debit: 500_000 }, { accountCode: '2112', credit: 500_000 }])] as never,
  })
  useToast.setState({ msg: null, kind: 'success' })
})
afterEach(() => { cleanup(); useRawDataStore.setState(initial); useAppStore.setState(app) })

it('يعرض مستحق الاستقطاع ويورّده بسند صرف يصفّر 2112 ويسحب من الخزينة', async () => {
  render(<MemoryRouter><SubcontractorsPage /></MemoryRouter>)
  expect(screen.getByText(/ضريبة الاستقطاع المستحقة للمصلحة/)).toBeTruthy()
  expect(screen.getByText('5,000.00')).toBeTruthy()

  const button = screen.getByRole('button', { name: 'توريد للمصلحة' }) as HTMLButtonElement
  expect(button.disabled).toBe(false)
  fireEvent.click(button)

  await waitFor(() => expect(useRawDataStore.getState().vouchers).toHaveLength(1))
  const voucher = useRawDataStore.getState().vouchers[0]
  expect(voucher).toMatchObject({ kind: 'payment', counterAccountCode: '2112', amountMinor: 500_000, treasury: '1101' })
  const created = useRawDataStore.getState().journal.find((row) => row.id === voucher.journalEntryId)!
  expect(created.lines.reduce((sum, line) => sum + line.debit, 0)).toBe(created.lines.reduce((sum, line) => sum + line.credit, 0))
  const net = (code: string) => created.lines.filter((line) => line.accountCode === code).reduce((sum, line) => sum + line.debit - line.credit, 0)
  expect(net('2112')).toBe(500_000)
  expect(net('1101')).toBe(-500_000)
  expect(useToast.getState().msg).toContain('وُرّدت ضريبة الاستقطاع')
  await waitFor(() => expect((screen.getByRole('button', { name: 'توريد للمصلحة' }) as HTMLButtonElement).disabled).toBe(true))
})

it('لا يورّد شيئاً حين لا يوجد مستحق — الزر معطّل', () => {
  useRawDataStore.setState({ journal: [] as never })
  render(<MemoryRouter><SubcontractorsPage /></MemoryRouter>)
  expect((screen.getByRole('button', { name: 'توريد للمصلحة' }) as HTMLButtonElement).disabled).toBe(true)
  expect(useRawDataStore.getState().vouchers).toHaveLength(0)
})
