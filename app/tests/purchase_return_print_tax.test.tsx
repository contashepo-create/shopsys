import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { draftFromCategory } from '../src/core/items.ts'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { PurchaseReturnsPage } from '../src/ui/pages/PurchaseReturnsPage.tsx'

const printer = vi.hoisted(() => vi.fn())
vi.mock('../src/ui/print/printDoc.ts', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/ui/print/printDoc.ts')>()), printModelWithTemplate: printer }))
const data = useRawDataStore.getState(), app = useAppStore.getState()
beforeEach(() => {
 const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'grocery' as const, vatPercent: 0, taxRegistrationStatus: 'registered' as const }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...data, currentUserId: null, activeBranchId: null, branches: [], suppliers: [{ id: 7, nameAr: 'مورد', phone: '', active: true }] as never, items: [{ ...draftFromCategory(undefined, 'TAX'), id: 1, nameAr: 'سلعة', costMinor: 3000, priceMinor: 5000, stockQty: 30 }], purchases: [], purchaseReturns: [], journal: [], warehouses: [{ id: 1, nameAr: 'رئيسي', isMain: true }] as never, batches: [], serials: [] })
 printer.mockClear()
})
afterEach(() => { cleanup(); useRawDataStore.setState(data); useAppStore.setState(app) })

it.each(['cash', 'debt'] as const)('يطبع قيمة المورد وضريبة المدخلات المعكوسة لاسترداد %s كما في القيد', refund => {
 const store = useRawDataStore.getState()
 const purchase = store.postPurchase({ supplierId: 7, date: '2026-01-01', lines: [{ itemId: 1, qty: 1, unitPriceMinor: 10000, warehouseId: 1 }], expenses: [], paidMinor: 0, inputVatMinor: 1400, notes: '' })
 const ret = store.postPurchaseReturn({ purchaseId: purchase.id, lineSpecs: [{ lineIndex: 0, qty: 1, warehouseId: 1 }], refund, treasury: '1101', reason: '' })
 render(<MemoryRouter><PurchaseReturnsPage /></MemoryRouter>)
 fireEvent.click(screen.getByTitle('طباعة إشعار المرتجع — حراري/A4/A5'))
 fireEvent.click(screen.getByRole('button', { name: /طباعة الآن/ }))
 const model = printer.mock.calls[0][0]
 expect(model).toMatchObject({ taxBaseMinor: 10000, taxMinor: 1400, totalMinor: 11400, paidMinor: refund === 'cash' ? 11400 : 0 })
 const entry = useRawDataStore.getState().journal.find(row => row.id === ret.journalEntryId)!
 expect(entry.lines.find(line => line.accountCode === (refund === 'cash' ? '1101' : '2101'))?.debit).toBe(model.totalMinor)
})
