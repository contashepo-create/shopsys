/** Resolve a journal row's economic source through any chain of reversals. */
export interface JournalSourceLike {
  id?: number
  sourceType?: string
  reversesEntryId?: number | null
}

export function economicSourceResolver<T extends JournalSourceLike>(journal: readonly T[]): (entry: T) => string | undefined {
  const entriesById = new Map(journal.flatMap((row) => row.id == null ? [] : [[row.id, row] as const]))
  const resolvedById = new Map<number, string | undefined>()

  return (entry) => {
    if (entry.id != null && resolvedById.has(entry.id)) return resolvedById.get(entry.id)
    let current: JournalSourceLike = entry
    const path: number[] = []
    const visited = new Set<number>()
    while (current.sourceType === 'reversal' && current.reversesEntryId != null) {
      if (current.id != null) {
        const cached = resolvedById.get(current.id)
        if (cached !== undefined || resolvedById.has(current.id)) {
          current = { sourceType: cached }
          break
        }
        if (visited.has(current.id)) break
        visited.add(current.id)
        path.push(current.id)
      }
      const original = entriesById.get(current.reversesEntryId)
      if (!original) break
      current = original
    }
    const sourceType = current.sourceType
    for (const id of path) resolvedById.set(id, sourceType)
    if (entry.id != null) resolvedById.set(entry.id, sourceType)
    return sourceType
  }
}

export function economicSourceType<T extends JournalSourceLike>(entry: T, journal: readonly T[]): string | undefined {
  return economicSourceResolver(journal)(entry)
}
