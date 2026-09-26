import { describe, expect, it } from 'vitest'
import { eligiblePaymentTerminals } from '../src/core/paymentTerminalEligibility.ts'
import type { PaymentTerminal } from '../src/core/paymentTerminals.ts'

const terminals: PaymentTerminal[] = [
  { id: 'a', code: 'TERM-0001', nameAr: 'أ', providerName: 'P', terminalId: '1', merchantId: '', serialNumber: '', branchId: '1', settlementAccountCode: '1101', status: 'active' },
  { id: 'b', code: 'TERM-0002', nameAr: 'ب', providerName: 'P', terminalId: '2', merchantId: '', serialNumber: '', branchId: '2', settlementAccountCode: '1102', status: 'suspended' },
]
describe('ترشيح ماكينات الأنشطة', () => {
  it('يعرض للمالك النشط الموافق للفرع فقط', () => expect(eligiblePaymentTerminals(terminals, { roleId: 'owner' }, 'charge', '1').map((x) => x.id)).toEqual(['a']))
  it('يفرض صلاحية العملية على المستخدم', () => {
    const user = { roleId: 'cashier', paymentTerminalAccess: { grants: [{ terminalId: 'a', operations: ['refund' as const] }] } }
    expect(eligiblePaymentTerminals(terminals, user, 'charge')).toEqual([])
    expect(eligiblePaymentTerminals(terminals, user, 'refund').map((x) => x.id)).toEqual(['a'])
  })
})
