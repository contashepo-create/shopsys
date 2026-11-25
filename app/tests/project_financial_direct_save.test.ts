import { expect, it } from 'vitest'
import { newJournalEntries } from '../src/data/persistentStorage.ts'
const wrap = (state: object) => JSON.stringify({ state })
it('الحفظ المباشر لا يسقط أو يغير المقدمة أو تحصيل المحتجز أو الإشعار', () => {
 const extract = { id: 1, projectId: 1, journalEntryId: 3, totals: { dueMinor: 900 }, refundedMinor: 100, refundedTaxMinor: 0, quantityCreditVersion: 1, refunds: [{ journalEntryId: 4, amountMinor: 100, taxShareMinor: 0 }] }
 const advance = { id: 1, projectId: 1, journalEntryId: 1, amountMinor: 500, recoveredMinor: 0 }
 const release = { id: 1, projectId: 1, journalEntryId: 5, amountMinor: 50 }
 const before = { clientAdvances: [advance], projectExtracts: [extract], retentionReleases: [release], journal: [] }
 for (const after of [
  { ...before, clientAdvances: [] },
  { ...before, clientAdvances: [{ ...advance, amountMinor: 501 }] },
  { ...before, retentionReleases: [] },
  { ...before, retentionReleases: [{ ...release, amountMinor: 51 }] },
  { ...before, projectExtracts: [{ ...extract, refunds: [] }] },
 ]) expect(() => newJournalEntries(wrap(after), wrap(before))).toThrow()
 expect(() => newJournalEntries(wrap({ ...before, settings: { theme: 'dark' } }), wrap(before))).not.toThrow()
})
