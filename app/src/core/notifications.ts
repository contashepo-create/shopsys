/**
 * نواة التنبيهات (إصلاح بلاغ المالك: الجرس كان شكلياً بلا استجابة) —
 * دالة خالصة تجمع التنبيهات الفعلية من البيانات:
 * صلاحيات على وشك الانتهاء/منتهية، أقساط متأخرة أو تستحق اليوم، شيكات تستحق قريباً.
 */
import { expiryAlerts, type StockBatch } from './batches.ts'
import { installmentStatus, type InstallmentItem } from './installments.ts'

export interface AppNotification {
  id: string
  icon: string // إيموجي
  title: string
  body: string
  severity: 'danger' | 'warn' | 'info'
  /** مسار الشاشة المرتبطة — الضغط على التنبيه يفتحها */
  route: string
}

export interface NotificationsInput {
  batches: StockBatch[]
  itemName: (itemId: number) => string
  installmentPlans: { id: number; planNumber: string; customerId: number; items: InstallmentItem[] }[]
  customerName: (id: number) => string
  cheques: { chequeNumber: string; direction: string; partyName: string; amountMinor: number; dueDate: string; status: string }[]
  fmt: (minor: number) => string
  todayIso: string // ISO كامل أو YYYY-MM-DD
}

export function collectNotifications(input: NotificationsInput): AppNotification[] {
  const out: AppNotification[] = []
  const day = input.todayIso.slice(0, 10)
  const dayMs = Date.parse(`${day}T00:00:00Z`)

  // 1) صلاحيات الدُفعات (منتهية أو خلال 30 يوماً)
  for (const a of expiryAlerts(input.batches, input.itemName, input.todayIso)) {
    out.push({
      id: `exp:${a.itemId}:${a.expiryDate}`,
      icon: a.status === 'expired' ? '🛑' : '⏳',
      title: a.status === 'expired' ? `صلاحية منتهية: ${a.nameAr}` : `صلاحية توشك: ${a.nameAr}`,
      body: a.status === 'expired'
        ? `كمية ${a.qty} انتهت صلاحيتها في ${a.expiryDate} — اعزلها أو أعدمها`
        : `كمية ${a.qty} تنتهي خلال ${a.daysLeft} يوماً (${a.expiryDate})`,
      severity: a.status === 'expired' ? 'danger' : 'warn',
      route: '/reports',
    })
  }

  // 2) أقساط متأخرة أو تستحق اليوم
  for (const p of input.installmentPlans) {
    for (const it of p.items) {
      const st = installmentStatus(it, day)
      if (st !== 'overdue' && st !== 'due_today') continue
      const remaining = it.amountMinor - it.paidMinor
      out.push({
        id: `ins:${p.id}:${it.seq}`,
        icon: st === 'overdue' ? '🔴' : '🟠',
        title: st === 'overdue' ? `قسط متأخر — ${input.customerName(p.customerId)}` : `قسط يستحق اليوم — ${input.customerName(p.customerId)}`,
        body: `${p.planNumber} قسط ${it.seq} · المتبقي ${input.fmt(remaining)} · استحقاق ${it.dueDate}`,
        severity: st === 'overdue' ? 'danger' : 'warn',
        route: '/parties/installments',
      })
    }
  }

  // 3) شيكات قائمة تستحق خلال 7 أيام أو تجاوزت الاستحقاق
  for (const c of input.cheques) {
    if (c.status !== 'pending' && c.status !== 'deposited') continue
    const daysLeft = Math.floor((Date.parse(`${c.dueDate}T00:00:00Z`) - dayMs) / 86_400_000)
    if (daysLeft > 7) continue
    const dirLabel = c.direction === 'incoming' ? 'وارد من' : 'صادر إلى'
    out.push({
      id: `chq:${c.chequeNumber}:${c.dueDate}`,
      icon: daysLeft < 0 ? '⚠️' : '🏦',
      title: daysLeft < 0 ? `شيك تجاوز استحقاقه` : `شيك يستحق ${daysLeft === 0 ? 'اليوم' : `خلال ${daysLeft} يوماً`}`,
      body: `${dirLabel} ${c.partyName} · ${input.fmt(c.amountMinor)} · ${c.dueDate}`,
      severity: daysLeft < 0 ? 'danger' : 'warn',
      route: '/accounting/cheques',
    })
  }

  // الأخطر أولاً
  const rank = { danger: 0, warn: 1, info: 2 } as const
  return out.sort((a, b) => rank[a.severity] - rank[b.severity])
}
