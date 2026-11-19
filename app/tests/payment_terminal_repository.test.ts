import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'

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

  it('يسجل سند القبض على الماكينة مع حركة charge ذرّية', () => {
    useDataStore.getState().addPaymentTerminal(terminal)
    const voucher = useDataStore.getState().postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '4103', amountMinor: 1000, description: 'تحصيل بطاقة', terminalPayment: { terminalId: terminal.id, providerReference: 'REF-VOUCHER-1' } })
    expect(voucher.kind).toBe('receipt')
    expect(useDataStore.getState().paymentTerminalTransactions[0]).toMatchObject({ terminalId: terminal.id, documentType: 'receipt_voucher', kind: 'charge', amountMinor: 1000 })
  })

  it('لا يحول سند الصرف إلى refund ماكينة بلا مستند أصلي', () => {
    useDataStore.getState().addPaymentTerminal(terminal)
    expect(() => useDataStore.getState().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '5108', amountMinor: 1000, description: 'صرف', terminalPayment: { terminalId: terminal.id, providerReference: 'REF-VOUCHER-2' } })).toThrow(/مخصصة لسندات القبض/)
  })

  // انحدار مُثبت: كان Repository يمرّر سجل التسوية كاملاً (معرّفه وتاريخه) إلى
  // مدقق يفحص كل قيمة كعدد صحيح، فيرمي «قيمة id في التسوية غير صالحة» دائماً؛
  // لم تكشفه اختبارات الوحدة لأنها تنادي الدالة بكائن أرقام نظيف فقط.
  it('يسوّي تحصيل البطاقة في قيد متزن ويحفظ الفرق', () => {
    // حساب التسوية المعلّق ليس خزينة: يقفل بالتحصيل ثم يُدان بالإيداع، فيمرّ عبره صافي سالب
    // مرحلي — الحارس يرصده فقط لأن الحسابين خزائن في هذا الاختبار، فنُفعّل السماح صراحةً.
    useAppStore.setState((s) => ({ ...s, setup: { ...s.setup, allowNegativeTreasury: true } }))
    useDataStore.setState({ treasuries: [
      { code: '1101', nameAr: 'الخزينة', kind: 'cash', openingBalanceMinor: 0, isDefault: true },
      { code: '1102', nameAr: 'البنك', kind: 'bank', openingBalanceMinor: 100000, isDefault: false },
    ] as never })
    const bankTerminal = { ...terminal, id: 'bank-terminal', code: 'TERM-1001', terminalId: 'T-1001', settlementAccountCode: '1102' }
    useDataStore.getState().addPaymentTerminal(bankTerminal)
    useDataStore.getState().recordPaymentTerminalTransaction({ ...transaction, terminalId: bankTerminal.id })
    useDataStore.getState().recordPaymentTerminalSettlement({
      id: 'single-settlement', terminalId: bankTerminal.id, transactionIds: [transaction.id],
      settledAt: '2026-09-26T00:00:00.000Z', grossMinor: 1000, feeMinor: 10, feeTaxMinor: 2,
      depositedMinor: 980, bankAccountCode: '1101', userId: 1,
    } as never)
    const settlement = useDataStore.getState().paymentTerminalSettlements[0]
    expect(settlement).toMatchObject({ grossMinor: 1000, depositedMinor: 980, differenceMinor: -8 })
    const entry = useDataStore.getState().journal.find((row) => row.id === settlement.journalEntryId)!
    expect(entry).toBeTruthy()
    expect(entry.lines.reduce((sum, line) => sum + line.debit, 0)).toBe(entry.lines.reduce((sum, line) => sum + line.credit, 0))
    const net = (code: string) => entry.lines.filter((line) => line.accountCode === code).reduce((sum, line) => sum + line.debit - line.credit, 0)
    expect(net('1101')).toBe(980)
    expect(net('5113')).toBe(12)
    expect(net('5112')).toBe(8)
    expect(net('1102')).toBe(-1000)
  })

  it('يرفض ماكينة بلا فرع عند وجود فروع فعلية', () => {
    useDataStore.setState({ branches: [{ id: 1, nameAr: 'الرئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }] })
    expect(() => useDataStore.getState().addPaymentTerminal(terminal)).toThrow(/فرع ماكينة الدفع/)
  })
})
