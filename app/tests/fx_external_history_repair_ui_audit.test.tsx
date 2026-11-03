import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FxTreasuryTab } from '../src/ui/pages/FxTreasuryTab.tsx'
import { useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const initial = useRawDataStore.getState(), app = useAppStore.getState()
afterEach(() => { cleanup(); useRawDataStore.setState(initial); useAppStore.setState(app) })
it('تظهر المطابقة رغم تعطل التقرير وتستعيد سند القبض بدليل صريح', () => {
 useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true }, fxRates: {} })
 useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, appUsers: [], currentUserId: null, sales: [], purchases: [], vouchers: [], journal: [], fxConversions: [], items: [] })
 const s = useDataStore.getState(), fx = { currencyCode: 'USD', amountMinor: 200, ratePpm: 10000000, decimals: 2 as const }
 const doc = s.postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '4101', amountMinor: 2000, description: 'قبض', fx, bookDecimals: 2, bookCurrencyCode: 'EGP' })
 useRawDataStore.setState(state => ({ vouchers: state.vouchers.map(row => ({ ...row, fx: { ...row.fx!, amountMinor: 999 } })) }))
 render(<FxTreasuryTab cur={{ code: 'EGP', symbol: 'ج.م', decimals: 2, name: 'جنيه' }} companyName="متجر" />)
 expect(screen.getByRole('alert').textContent).toContain('تعذر عرض تقرير العملات')
 fireEvent.click(screen.getByText('مطابقة عملة سند أو شراء تاريخي'))
 fireEvent.change(screen.getByLabelText('مستند العملة التاريخي'), { target: { value: String(doc.id) } })
 fireEvent.change(screen.getByLabelText('تاريخ مستند العملة المثبت'), { target: { value: doc.date.slice(0, 10) } })
 fireEvent.change(screen.getByLabelText('مبلغ المستند المثبت'), { target: { value: '2' } })
 fireEvent.change(screen.getByLabelText('سعر المستند المثبت'), { target: { value: '10' } })
 fireEvent.change(screen.getByLabelText('مرجع مستند العملة'), { target: { value: 'إيصال 123' } })
 fireEvent.click(screen.getByLabelText('تأكيد مستند العملة'))
 fireEvent.click(screen.getByRole('button', { name: /حفظ مطابقة المستند/ }))
 expect(screen.queryByRole('alert')).toBeNull()
 expect(s.getFxHoldings()[0].amountMinor).toBe(200)
})
