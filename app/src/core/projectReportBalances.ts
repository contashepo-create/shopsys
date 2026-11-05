/** أرصدة مستخلصات المشاريع من دفتر العميل الكامل؛ المستند المغلق لا دين له. */
export function projectOpenBalances(
  projects: readonly { id: number; clientId: number | null }[],
  extracts: readonly { id: number; projectId: number; payment: 'cash' | 'credit'; totals: { dueMinor: number }; advanceRecoveryMinor?: number; refunds?: readonly { mode: string; amountMinor: number }[] }[],
  openInvoices: (clientId: number, includeSettled?: boolean) => readonly { docKey: string; dueMinor: number; settledMinor: number }[],
): Map<number, number> {
  const ledgers = new Map<number, Map<string, number>>()
  for (const p of projects) {
    if (p.clientId == null || ledgers.has(p.clientId)) continue
    ledgers.set(p.clientId, new Map(openInvoices(p.clientId, true).map((d) => [d.docKey, Math.max(0, d.dueMinor - d.settledMinor)])))
  }
  return new Map(projects.map((p) => {
    const total = extracts.filter((e) => e.projectId === p.id && e.payment === 'credit').reduce((sum, e) => {
      // المستند غير المرتبط بدفتر العميل ليس دليلاً على السداد.
      const creditRefund = (e.refunds ?? []).filter(r => r.mode === 'customer_credit').reduce((sum, r) => sum + r.amountMinor, 0)
      const fallback = Math.max(0, e.totals.dueMinor - Math.max(0, e.advanceRecoveryMinor ?? 0) - creditRefund)
      const remaining = p.clientId == null
        ? fallback
        : ledgers.get(p.clientId)?.get(`extract:${e.id}`) ?? fallback
      return sum + remaining
    }, 0)
    return [p.id, total]
  }))
}

/** تقرير العميل: رصيد الإشعار ليس تحصيلاً، والرد النقدي حركة خارجة. */
export function projectExtractSettlement(
  extract: { id: number; payment: 'cash' | 'credit'; totals: { dueMinor: number }; advanceRecoveryMinor?: number; refunds?: readonly { journalEntryId: number; mode: 'cash' | 'customer_credit'; amountMinor: number }[] },
  doc?: { settledMinor: number; adjustmentAllocations?: readonly { key: string; amountMinor: number }[] },
): { settled: number; remaining: number } {
  const cashRefund = (extract.refunds ?? []).filter(r => r.mode === 'cash').reduce((sum, r) => sum + r.amountMinor, 0)
  if (extract.payment === 'cash') return { settled: extract.totals.dueMinor - cashRefund, remaining: 0 }
  const recovery = Math.min(extract.totals.dueMinor, Math.max(0, extract.advanceRecoveryMinor ?? 0))
  const due = extract.totals.dueMinor - recovery
  const paid = Math.min(due, Math.max(0, doc?.settledMinor ?? 0))
  const ownKeys = new Set((extract.refunds ?? []).filter(r => r.mode === 'customer_credit').map(r => `extract-credit:${r.journalEntryId}`))
  const ownCredit = (doc?.adjustmentAllocations ?? []).filter(a => ownKeys.has(a.key)).reduce((sum, a) => sum + a.amountMinor, 0)
  return { settled: recovery + paid - ownCredit - cashRefund, remaining: due - paid }
}
