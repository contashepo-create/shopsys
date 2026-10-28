/** أرصدة مستخلصات المشاريع من دفتر العميل الكامل؛ المستند المغلق لا دين له. */
export function projectOpenBalances(
  projects: readonly { id: number; clientId: number | null }[],
  extracts: readonly { id: number; projectId: number; payment: 'cash' | 'credit'; totals: { dueMinor: number }; advanceRecoveryMinor?: number }[],
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
      const fallback = Math.max(0, e.totals.dueMinor - Math.max(0, e.advanceRecoveryMinor ?? 0))
      const remaining = p.clientId == null
        ? fallback
        : ledgers.get(p.clientId)?.get(`extract:${e.id}`) ?? fallback
      return sum + remaining
    }, 0)
    return [p.id, total]
  }))
}
