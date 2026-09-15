/**
 * مركز التنبيهات الموحد (جولة المراجعة الختامية — النشاط العام):
 * يجمع كل ما يحتاج انتباه المالك في قائمة واحدة مرتبة بالأولوية،
 * كما بلوحات البرامج التجارية الرائدة (Easy Store: تنبيهات الاستحقاق):
 * نواقص مخزون، صلاحية قاربت/انتهت، أقساط متأخرة/تستحق قريباً،
 * شيكات تستحق قريباً، ديون عملاء تجاوزت حد الائتمان.
 * نواة خالصة — دوال قراءة فقط، لا قيود ولا حالة.
 */

export type AlertSeverity = 'danger' | 'warn'

export interface BusinessAlert {
  kind: 'low_stock' | 'expired' | 'expiring' | 'installment_overdue' | 'installment_soon' | 'cheque_due' | 'credit_limit'
  severity: AlertSeverity
  titleAr: string
  detailAr: string
  /** وجهة النقر داخل التطبيق (مسار HashRouter) */
  route: string
}

const daysBetween = (fromIso: string, toIso: string) =>
  Math.floor((Date.parse(toIso.slice(0, 10)) - Date.parse(fromIso.slice(0, 10))) / 86_400_000)

export function collectBusinessAlerts(args: {
  todayIso: string
  items: readonly { id: number; nameAr: string; stockQty: number; minQty: number; isActive: boolean }[]
  batches: readonly { itemId: number; expiryDate: string | null; qty: number }[]
  installmentAlerts: readonly { kind: 'overdue' | 'due_soon'; amountDueMinor: number; dueDate: string }[]
  cheques: readonly { chequeNumber: string; direction: string; status: string; dueDate: string; amountMinor: number; partyName: string }[]
  customers: readonly { id: number; nameAr: string; creditLimitMinor: number }[]
  customerBalances: (customerId: number) => number // مدين موجب = عليه
  fmt: (minor: number) => string
  /** أفق «قريباً» بالأيام (افتراضي 7 للشيكات، 30 للصلاحية) */
  chequeDays?: number
  expiryDays?: number
}): BusinessAlert[] {
  const out: BusinessAlert[] = []
  const { todayIso, fmt } = args
  const chequeDays = args.chequeDays ?? 7
  const expiryDays = args.expiryDays ?? 30

  // 1) نواقص المخزون
  const low = args.items.filter((it) => it.isActive && it.minQty > 0 && it.stockQty <= it.minQty)
  if (low.length) {
    out.push({
      kind: 'low_stock', severity: 'warn',
      titleAr: `${low.length} صنفاً عند/تحت حد الطلب`,
      detailAr: low.slice(0, 3).map((i) => i.nameAr).join('، ') + (low.length > 3 ? '…' : ''),
      route: '/inventory/items',
    })
  }

  // 2) الصلاحية: منتهٍ فعلاً (خطر) / يقارب (تحذير)
  const itemName = (id: number) => args.items.find((i) => i.id === id)?.nameAr ?? `#${id}`
  const withDate = args.batches.filter((b) => b.qty > 0 && b.expiryDate)
  const expired = withDate.filter((b) => daysBetween(todayIso, b.expiryDate!) < 0)
  const expiring = withDate.filter((b) => { const d = daysBetween(todayIso, b.expiryDate!); return d >= 0 && d <= expiryDays })
  if (expired.length) {
    out.push({
      kind: 'expired', severity: 'danger',
      titleAr: `${expired.length} دفعة منتهية الصلاحية بالمخزون`,
      detailAr: [...new Set(expired.map((b) => itemName(b.itemId)))].slice(0, 3).join('، '),
      route: '/inventory/items',
    })
  }
  if (expiring.length) {
    out.push({
      kind: 'expiring', severity: 'warn',
      titleAr: `${expiring.length} دفعة تنتهي خلال ${expiryDays} يوماً`,
      detailAr: [...new Set(expiring.map((b) => itemName(b.itemId)))].slice(0, 3).join('، '),
      route: '/inventory/items',
    })
  }

  // 3) الأقساط
  const insOver = args.installmentAlerts.filter((a) => a.kind === 'overdue')
  const insSoon = args.installmentAlerts.filter((a) => a.kind === 'due_soon')
  if (insOver.length) {
    out.push({
      kind: 'installment_overdue', severity: 'danger',
      titleAr: `${insOver.length} قسطاً متأخراً`,
      detailAr: `إجمالي المتأخر ${fmt(insOver.reduce((s, a) => s + a.amountDueMinor, 0))}`,
      route: '/parties/installments',
    })
  }
  if (insSoon.length) {
    out.push({
      kind: 'installment_soon', severity: 'warn',
      titleAr: `${insSoon.length} قسطاً يستحق قريباً`,
      detailAr: `إجمالي المطلوب ${fmt(insSoon.reduce((s, a) => s + a.amountDueMinor, 0))}`,
      route: '/parties/installments',
    })
  }

  // 4) شيكات قائمة تستحق خلال الأفق (وارد بمحفظة أو صادر محرر)
  const openStatuses = new Set(['held', 'deposited', 'issued'])
  const dueCheques = args.cheques.filter((c) => openStatuses.has(c.status) && daysBetween(todayIso, c.dueDate) <= chequeDays)
  if (dueCheques.length) {
    out.push({
      kind: 'cheque_due', severity: dueCheques.some((c) => daysBetween(todayIso, c.dueDate) < 0) ? 'danger' : 'warn',
      titleAr: `${dueCheques.length} شيكاً يستحق خلال ${chequeDays} أيام`,
      detailAr: dueCheques.slice(0, 2).map((c) => `${c.chequeNumber} (${c.partyName}) ${fmt(c.amountMinor)}`).join(' — '),
      route: '/accounting/cheques',
    })
  }

  // 5) عملاء تجاوزوا حد الائتمان
  const over = args.customers
    .filter((c) => c.creditLimitMinor > 0)
    .map((c) => ({ c, bal: args.customerBalances(c.id) }))
    .filter((x) => x.bal > x.c.creditLimitMinor)
  if (over.length) {
    out.push({
      kind: 'credit_limit', severity: 'danger',
      titleAr: `${over.length} عميلاً تجاوز حد الائتمان`,
      detailAr: over.slice(0, 3).map((x) => `${x.c.nameAr} (${fmt(x.bal)})`).join('، '),
      route: '/parties/customers',
    })
  }

  // خطر أولاً، ثم تحذير — مع ثبات ترتيب الأنواع داخل كل درجة
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'danger' ? -1 : 1))
}
