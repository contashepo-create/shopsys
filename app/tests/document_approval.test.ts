import { describe, expect, it } from 'vitest'
import { approvalSatisfied, requiredApprovalRule, validateApprovalRules } from '../src/core/documentApproval.ts'
const rules = [
  { id: 'sale-manager', minTotalMinor: 100_000, documentKinds: ['sale'], requiredPermission: 'sales.approve', approvalsRequired: 1 },
  { id: 'sale-owner', minTotalMinor: 1_000_000, documentKinds: ['sale'], requiredPermission: 'sales.owner_approve', approvalsRequired: 2 },
]
describe('سياسة اعتماد المستند', () => {
  it('تختار أعلى قاعدة منطبقة', () => expect(requiredApprovalRule(rules, 'sale', 2_000_000)?.id).toBe('sale-owner'))
  it('لا تتطلب اعتماداً تحت الحدود', () => expect(requiredApprovalRule(rules, 'sale', 10)).toBeNull())
  it('تمنع منشئ المستند من اعتماد مستنده وتحسب مستخدمين متميزين', () => {
    const rule = rules[0]
    const approvals = [{ userId: 7, userName: 'المنشئ', permission: 'sales.approve', approvedAt: 'x' }, { userId: 8, userName: 'مدير', permission: 'sales.approve', approvedAt: 'x' }]
    expect(approvalSatisfied(rule, approvals, 7)).toBe(true)
    expect(approvalSatisfied(rule, approvals.slice(0, 1), 7)).toBe(false)
  })
  it('يرفض قواعد مكررة وعدد اعتماد غير صالح', () => expect(validateApprovalRules([rules[0], { ...rules[0], approvalsRequired: 0 }]).length).toBeGreaterThanOrEqual(2))
})
