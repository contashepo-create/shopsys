export interface DocumentApprovalRule {
  id: string
  minTotalMinor: number
  documentKinds: string[]
  requiredPermission: string
  approvalsRequired: number
}
export interface DocumentApproval { userId: number; userName: string; permission: string; approvedAt: string }

export function validateApprovalRules(rules: DocumentApprovalRule[]): string[] {
  const errors: string[] = []
  const ids = new Set<string>()
  for (const rule of rules) {
    if (!rule.id.trim() || ids.has(rule.id)) errors.push('معرف قاعدة الاعتماد فارغ أو مكرر')
    ids.add(rule.id)
    if (!Number.isInteger(rule.minTotalMinor) || rule.minTotalMinor < 0) errors.push(`حد قاعدة ${rule.id} غير صالح`)
    if (!rule.documentKinds.length) errors.push(`قاعدة ${rule.id} بلا أنواع مستندات`)
    if (!rule.requiredPermission.trim()) errors.push(`صلاحية قاعدة ${rule.id} مطلوبة`)
    if (!Number.isInteger(rule.approvalsRequired) || rule.approvalsRequired < 1 || rule.approvalsRequired > 5) errors.push(`عدد اعتمادات قاعدة ${rule.id} غير صالح`)
  }
  return errors
}

export function requiredApprovalRule(rules: DocumentApprovalRule[], kind: string, totalMinor: number): DocumentApprovalRule | null {
  return rules.filter((rule) => rule.documentKinds.includes(kind) && totalMinor >= rule.minTotalMinor)
    .sort((a, b) => b.minTotalMinor - a.minTotalMinor)[0] ?? null
}

export function approvalSatisfied(rule: DocumentApprovalRule | null, approvals: DocumentApproval[], creatorUserId: number | null): boolean {
  if (!rule) return true
  const distinct = new Set(approvals.filter((approval) => approval.permission === rule.requiredPermission && approval.userId !== creatorUserId).map((approval) => approval.userId))
  return distinct.size >= rule.approvalsRequired
}
