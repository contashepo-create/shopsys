import type { AppUser } from './audit.ts'
import type { PaymentTerminal } from './paymentTerminals.ts'

/** ترشيح مركزي لكل واجهات الأنشطة؛ الأمان النهائي يظل مفروضاً داخل Repository. */
export function eligiblePaymentTerminals(
  terminals: PaymentTerminal[],
  user: Pick<AppUser, 'roleId' | 'paymentTerminalAccess'> | undefined,
  operation: 'charge' | 'refund' | 'void' | 'settle' | 'view_totals',
  branchId?: string,
): PaymentTerminal[] {
  return terminals.filter((terminal) => {
    if (terminal.status !== 'active' || (branchId && terminal.branchId !== branchId)) return false
    if (!user || user.roleId === 'owner' || !user.paymentTerminalAccess) return true
    return user.paymentTerminalAccess.grants.some((grant) => grant.terminalId === terminal.id && grant.operations.includes(operation))
  })
}
