import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useDataStore } from '../src/data/repo.ts'

const original = useDataStore.getState()
const terminal = { id: 'single-terminal', code: 'TERM-1000', nameAr: 'ماكينة الفرع الواحد', providerName: 'مزود', branchId: '', settlementAccountCode: '1101', terminalId: 'T-1000', status: 'active' as const }
const transaction = { id: 'single-charge', idempotencyKey: 'single-charge-key', kind: 'charge' as const, terminalId: terminal.id, branchId: '', userId: 0, documentId: 'doc-1', amountMinor: 1000, providerReference: 'REF-1000', occurredAt: '2026-09-25T00:00:00.000Z' }

beforeEach(() => {
  useDataStore.setState({ ...original, branches: [], paymentTerminals: [], paymentTerminalTransactions: [], treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', openingBalanceMinor: 0, isDefault: true }] as never })
})
afterEach(() => useDataStore.setState(original))

describe('ماكينة الدفع في Repository', () => {
  it('يضيف ماكينة ويسجل عملية بلا فرع عند عدم تعريف الفروع', () => {
    useDataStore.getState().addPaymentTerminal(terminal)
    useDataStore.getState().recordPaymentTerminalTransaction(transaction)
    expect(useDataStore.getState().paymentTerminals[0].branchId).toBe('')
    expect(useDataStore.getState().paymentTerminalTransactions[0].branchId).toBe('')
  })

  it('يرفض ماكينة بلا فرع عند وجود فروع فعلية', () => {
    useDataStore.setState({ branches: [{ id: 1, nameAr: 'الرئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }] })
    expect(() => useDataStore.getState().addPaymentTerminal(terminal)).toThrow(/فرع ماكينة الدفع/)
  })
})
