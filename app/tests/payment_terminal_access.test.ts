import { describe, expect, it } from 'vitest'
import { assertTerminalOperation, validateTerminalAccess, type PaymentTerminalAccess } from '../src/core/paymentTerminalAccess.ts'
const access: PaymentTerminalAccess = { defaultTerminalId: 't1', grants: [{ terminalId: 't1', operations: ['charge', 'refund'], maxAmountMinor: 10000 }] }
describe('صلاحيات ماكينة الدفع', () => {
 it('يسمح بالتحصيل ضمن الحد', () => expect(() => assertTerminalOperation(access, 't1', 'charge', 9000)).not.toThrow())
 it('يفصل صلاحية الرد عن الإلغاء', () => expect(() => assertTerminalOperation(access, 't1', 'void', 1)).toThrow('صلاحية'))
 it('يفرض الحد المالي', () => expect(() => assertTerminalOperation(access, 't1', 'refund', 10001)).toThrow('يتجاوز'))
 it('يرفض الافتراضي غير الممنوح والماكينة المحذوفة', () => expect(validateTerminalAccess({ defaultTerminalId: 't2', grants: access.grants.map((g) => ({ ...g, operations: [...g.operations] })) }, new Set(['t2']))).toHaveLength(2))
})
