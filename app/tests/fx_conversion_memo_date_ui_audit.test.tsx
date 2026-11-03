import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FxTreasuryTab } from '../src/ui/pages/FxTreasuryTab.tsx'
import { useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
afterEach(() => { cleanup(); useRawDataStore.setState(initial); useAppStore.setState(app) })
it('يصحح تاريخ تدفقي التحويل من التقرير بإثبات وإقرار دون تعديل اليومية', () => {
 useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true }, fxRates: {} })
 useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, appUsers: [], currentUserId: null, sales: [], purchases: [], vouchers: [], journal: [], fxConversions: [], items: [] })
 const s = useDataStore.getState(), dest = s.addTreasury('خزينة ثانية', 'cash'), fx = { currencyCode: 'USD', amountMinor: 200, ratePpm: 10000000, decimals: 2 as const }
 const receipt = s.postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '4101', amountMinor: 2000, description: 'قبض', fx, bookDecimals: 2, bookCurrencyCode: 'EGP' })
 s.repairExternalFx({ kind: 'voucher', id: receipt.id, fx, date: '2026-01-01', reason: 'إيصال', confirmed: true })
 const doc = s.transferFx({ currency: 'USD', decimals: 2, fromTreasury: '1101', toTreasury: dest.code, amountMinor: 100 }), before = useRawDataStore.getState()
 render(<FxTreasuryTab cur={{ code: 'EGP', symbol: 'ج.م', decimals: 2, name: 'جنيه' }} companyName="متجر" />)
 fireEvent.click(screen.getByText('مطابقة تاريخ مذكرة تحويل العملة'))
 fireEvent.change(screen.getByLabelText('تحويل العملة التاريخي'), { target: { value: String(doc.id) } })
 fireEvent.change(screen.getByLabelText('تاريخ تحويل العملة المثبت'), { target: { value: '2026-02-01' } })
 fireEvent.change(screen.getByLabelText('مرجع تاريخ تحويل العملة'), { target: { value: 'إيصال 42' } })
 fireEvent.click(screen.getByLabelText(/أؤكد مطابقة التاريخ لإيصال التحويل/))
 fireEvent.click(screen.getByRole('button', { name: /حفظ تاريخ مذكرة التحويل/ }))
 expect(s.getFxFlows().filter(row => row.seq === doc.journalEntryId).every(row => row.date === '2026-02-01')).toBe(true)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
