/**
 * سجل ملاحظات الأطراف (طلب المالك)
 * ────────────────────────────────
 * الملاحظة التي تُكتب في ترويسة الفاتورة لا تضيع مع المستند: تُقيَّد في **سجل
 * ملاحظات الطرف** بتاريخها وكاتبها ومصدرها (رقم الفاتورة)، فتظهر في صفحة العميل
 * (كشف الحساب) وفي بروفايله داخل سجل العملاء.
 *
 * الوحدة نقيّة تماماً — بلا DOM وبلا متجر — ليغطيها الاختبار وحده.
 */

export type PartyNoteKind = 'customer' | 'supplier'

export interface PartyNote {
  id: string
  partyKind: PartyNoteKind
  partyId: number
  /** نص الملاحظة بعد التنظيف */
  text: string
  /** ISO — لحظة التسجيل */
  at: string
  /** من كتبها */
  userName: string
  /** مصدرها: رقم الفاتورة أو «بطاقة العميل» */
  source?: string
  /** ISO — لحظة آخر تعديل على النص (إن عُدّل) */
  editedAt?: string
  /** من عدّلها */
  editedBy?: string
}

/** أقصى طول للملاحظة الواحدة — سطر واضح لا مقال */
export const PARTY_NOTE_MAX = 400

/** تنظيف النص: مسافات مضغوطة وحدّ أقصى — بلا أسطر جديدة تكسر السجل */
export function normalizePartyNoteText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, PARTY_NOTE_MAX)
}

/** يبني ملاحظة صالحة أو يرمي خطأً عربياً — لا ملاحظة فارغة ولا طرف مجهول */
export function buildPartyNote(input: {
  partyKind: PartyNoteKind
  partyId: number
  text: string
  userName: string
  source?: string
  at?: string
  id?: string
}): PartyNote {
  const text = normalizePartyNoteText(input.text)
  if (!text) throw new Error('لا يمكن حفظ ملاحظة فارغة')
  if (!Number.isSafeInteger(input.partyId) || input.partyId <= 0) throw new Error('اختر طرفاً مسجَّلاً لحفظ الملاحظة في سجله')
  const at = input.at ?? new Date().toISOString()
  if (Number.isNaN(Date.parse(at))) throw new Error('تاريخ الملاحظة غير صالح')
  return {
    id: input.id ?? (globalThis.crypto?.randomUUID?.() ?? `note-${Date.parse(at)}-${input.partyId}`),
    partyKind: input.partyKind,
    partyId: input.partyId,
    text,
    at,
    userName: input.userName.trim() || 'المالك',
    ...(input.source?.trim() ? { source: input.source.trim() } : {}),
  }
}

/** ملاحظات طرف واحد — الأحدث أولاً كما يقرؤها البائع */
export function partyNotesFor(notes: readonly PartyNote[], kind: PartyNoteKind, partyId: number): PartyNote[] {
  // السجل مضاف بالترتيب؛ عند تساوي الطابع الزمني يفوز الأحدث إدخالاً — ترتيب مستقر لا عشوائي
  return notes
    .map((note, index) => ({ note, index }))
    .filter((row) => row.note.partyKind === kind && row.note.partyId === partyId)
    .sort((a, b) => (a.note.at === b.note.at ? b.index - a.index : (a.note.at < b.note.at ? 1 : -1)))
    .map((row) => row.note)
}

/** ختم عربي قصير للعرض: «٢٨/٠٩/٢٠٢٦ ١٤:٣٠» */
export function formatPartyNoteStamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const day = new Intl.DateTimeFormat('ar-EG', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)
  const time = new Intl.DateTimeFormat('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
  return `${day} ${time}`
}

/** سطر جاهز للعرض في السجل: «٢٨/٠٩/٢٠٢٦ ١٤:٣٠ · محمد عبده · INV-12 — النص» */
export function formatPartyNoteLine(note: PartyNote): string {
  return `${formatPartyNoteStamp(note.at)} · ${note.userName}${note.source ? ` · ${note.source}` : ''} — ${note.text}`
}
