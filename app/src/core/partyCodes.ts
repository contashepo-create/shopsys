/**
 * أكواد الأطراف (طلب المالك): كود ثابت لكل عميل/مريض/مورد/موظف في كل الأنشطة —
 * بحث أسرع وأدق من الاسم (تشابه الأسماء) أو الهاتف (يتغير).
 * الكود مشتق من المعرف الرقمي الثابت ⇒ فريد دائماً، لا يتغير أبداً،
 * ولا يحتاج ترحيلاً — كل السجلات القديمة تحصل على كودها فوراً.
 */

export type PartyCodePrefix =
  | 'CUS' // عميل
  | 'SUP' // مورد
  | 'EMP' // موظف
  | 'PAT' // مريض عيادة
  | 'LPT' // مريض معمل تحاليل

export const PARTY_CODE_LABELS: Record<PartyCodePrefix, string> = {
  CUS: 'كود العميل',
  SUP: 'كود المورد',
  EMP: 'كود الموظف',
  PAT: 'كود المريض',
  LPT: 'كود المريض',
}

/** الكود القياسي: CUS-0001 / PAT-0042 — يتمدد تلقائياً بعد 9999 */
export function partyCode(prefix: PartyCodePrefix, id: number): string {
  if (!Number.isInteger(id) || id <= 0) return `${prefix}-0000`
  return `${prefix}-${String(id).padStart(4, '0')}`
}

/**
 * مطابقة بحث ذكية بالكود:
 * «PAT-0042» كامل ✓ — «pat-42» بلا أصفار ✓ — «0042» أو «42» أرقام فقط ✓
 * — «PAT42» بلا شرطة ✓. الأرقام المجردة تطابق المعرف مباشرة (أسرع إدخال).
 */
export function matchesPartyCode(query: string, prefix: PartyCodePrefix, id: number): boolean {
  const q = query.trim().toUpperCase().replace(/\s+/g, '')
  if (!q) return false
  // أرقام فقط: تطابق المعرف (42 ⇒ id 42) أو الكود المحشو (0042)
  if (/^\d+$/.test(q)) return Number(q) === id
  // بادئة + أرقام (بشرطة أو بدونها)
  const m = /^([A-Z]{2,3})-?(\d+)$/.exec(q)
  if (m) return m[1] === prefix && Number(m[2]) === id
  // بادئة فقط أو جزء من الكود الكامل
  return partyCode(prefix, id).includes(q)
}

/** فلتر موحد للقوائم: يطابق الاسم أو الهاتف أو الكود */
export function partySearchFilter<T extends { id: number; nameAr: string; phone: string }>(
  list: readonly T[],
  query: string,
  prefix: PartyCodePrefix,
): T[] {
  const q = query.trim()
  if (!q) return [...list]
  return list.filter((p) => p.nameAr.includes(q) || (p.phone && p.phone.includes(q)) || matchesPartyCode(q, prefix, p.id))
}
