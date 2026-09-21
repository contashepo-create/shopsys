/**
 * التزامن وسلامة التسلسلات (أمر المالك — البند 4):
 * ① قفل «كاتب واحد» على مستوى الجهاز: تبويبان على نفس قاعدة البيانات المحلية
 *    يدمّران التسلسلات — التبويب الثاني يعمل قراءة فقط حتى يُغلق الأول.
 * ② كشف تكرار أرقام المستندات (لا رقم سند/فاتورة مكرر أبداً) — فحص دوري وذاتي.
 * ③ حسم تعارض المستندات المُنشأة أوفلاين بالطابع الزمني (الأحدث يبقى برقمه،
 *    والمكرر يُرقَّم من جديد بدل حذف أي حركة — لا ضياع بيانات أبداً).
 * نواة خالصة قابلة للفحص — التشغيل الفعلي في طبقة الواجهة/الإقلاع.
 */

/* ─── ① قفل الكاتب الواحد (بين التبويبات عبر localStorage) ─── */

export interface TabLockRecord {
  tabId: string
  heartbeatAt: number // Date.now() لآخر نبضة
}

/** النبضة كل 3 ثوانٍ، والقفل يعتبر ميتاً بعد 10 (تبويب أُغلق فجأة لا يعلّق النظام) */
export const TAB_HEARTBEAT_MS = 3000
export const TAB_LOCK_STALE_MS = 10000

export type TabLockDecision =
  | { kind: 'acquired' } // لا قفل أو قفلنا نحن — نكتب
  | { kind: 'takeover' } // قفل ميت (تبويب انهار) — نستولي بأمان
  | { kind: 'read_only'; holder: string } // تبويب آخر حي يكتب — نحن قراءة فقط

export function decideTabLock(existing: TabLockRecord | null, myTabId: string, now: number): TabLockDecision {
  if (!existing || existing.tabId === myTabId) return { kind: 'acquired' }
  if (now - existing.heartbeatAt > TAB_LOCK_STALE_MS) return { kind: 'takeover' }
  return { kind: 'read_only', holder: existing.tabId }
}

export function parseTabLock(raw: string | null): TabLockRecord | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as Record<string, unknown>
    if (typeof o.tabId !== 'string' || typeof o.heartbeatAt !== 'number') return null
    return { tabId: o.tabId, heartbeatAt: o.heartbeatAt }
  } catch {
    return null
  }
}

/* ─── ② كشف تكرار أرقام المستندات ─── */

export interface NumberedDoc {
  id: number
  number: string // S-0001 / RV-0002 / TR-0003 ...
  createdAt: string // ISO — للحسم الزمني
}

export interface DuplicateGroup {
  number: string
  /** المستندات المتصادمة مرتبة زمنياً — الأقدم أولاً (يحتفظ برقمه) */
  docs: NumberedDoc[]
}

/** فحص مجموعة مستندات من نفس النوع: أي رقم ظهر مرتين؟ */
export function findDuplicateNumbers(docs: readonly NumberedDoc[]): DuplicateGroup[] {
  const byNumber = new Map<string, NumberedDoc[]>()
  for (const d of docs) {
    const arr = byNumber.get(d.number) ?? []
    arr.push(d)
    byNumber.set(d.number, arr)
  }
  const groups: DuplicateGroup[] = []
  for (const [number, arr] of byNumber) {
    if (arr.length < 2) continue
    groups.push({ number, docs: [...arr].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id) })
  }
  return groups.sort((a, b) => a.number.localeCompare(b.number))
}

/* ─── ③ حسم التعارض بالطابع الزمني (أوفلاين) ─── */

export interface RenumberAction {
  docId: number
  oldNumber: string
  newNumber: string
}

/**
 * خطة إصلاح التكرارات: الأقدم زمنياً يحتفظ بالرقم (وصل للعميل مطبوعاً أولاً)،
 * وكل الأحدث تُرقَّم تسلسلياً بعد أكبر رقم مستخدم — لا حذف ولا مساس بالقيود.
 * prefix مثل 'S' وwidth عرض الحشو (0001).
 */
export function planRenumbering(docs: readonly NumberedDoc[], prefix: string, width = 4): RenumberAction[] {
  const groups = findDuplicateNumbers(docs)
  if (groups.length === 0) return []
  // أكبر رقم تسلسلي مستخدم فعلاً (نتجاوز أي فجوات للأمام — الأمان أولاً)
  let maxSeq = 0
  const re = new RegExp(`^${prefix}-(\\d+)$`)
  for (const d of docs) {
    const m = re.exec(d.number)
    if (m) maxSeq = Math.max(maxSeq, Number(m[1]))
  }
  const actions: RenumberAction[] = []
  for (const g of groups) {
    // الأول (الأقدم) يبقى — البقية تُرقَّم من جديد
    for (const dup of g.docs.slice(1)) {
      maxSeq += 1
      actions.push({ docId: dup.id, oldNumber: dup.number, newNumber: `${prefix}-${String(maxSeq).padStart(width, '0')}` })
    }
  }
  return actions
}

/** تطبيق الخطة على نسخة من المستندات (خالص — الطبقة العليا تحفظ الناتج) */
export function applyRenumbering<T extends { id: number }>(
  docs: readonly T[],
  actions: readonly RenumberAction[],
  setNumber: (doc: T, newNumber: string) => T,
): T[] {
  const byId = new Map(actions.map((a) => [a.docId, a]))
  return docs.map((d) => {
    const a = byId.get(d.id)
    return a ? setNumber(d, a.newNumber) : d
  })
}

/**
 * الحسم الزمني بين نسختين لنفس المستند (id واحد عُدّل على جهازين أوفلاين):
 * الأحدث updatedAt يفوز — والمتساوي زمنياً يُحسم بجهازٍ أصغر معرفاً (حتمية كاملة
 * كي يصل كل الأجهزة لنفس النتيجة بلا تنسيق).
 */
export function resolveByTimestamp<T extends { updatedAt: string; deviceId: string }>(a: T, b: T): T {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b
  return a.deviceId <= b.deviceId ? a : b
}
