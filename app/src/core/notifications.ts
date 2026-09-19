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
  /**
   * الصلاحية المطلوبة لرؤية هذا الإشعار (مراجعة المالك: «لماذا إشعارات المالك
   * تظهر لأي مستخدم؟») — null = للجميع. الجرس يفلتر بصلاحيات المستخدم النشط،
   * فالكاشير لا يرى شيكات ولا أقساطاً ولا طلبات استعادة كلمات السر.
   */
  perm: string | null
}

export interface NotificationsInput {
  batches: StockBatch[]
  itemName: (itemId: number) => string
  /** أصناف انخفض رصيدها لحد إعادة الطلب (فجوة عالمية — Lightspeed reorder alerts) */
  lowStockItems?: { id: number; nameAr: string; stockQty: number; minQty: number }[]
  installmentPlans: { id: number; planNumber: string; customerId: number; items: InstallmentItem[] }[]
  customerName: (id: number) => string
  cheques: { chequeNumber: string; direction: string; partyName: string; amountMinor: number; dueDate: string; status: string }[]
  /** عقود إيجار متجاوزة موعد الإرجاع (نمط Point of Rental: overdue return alerts) */
  overdueRentals?: { id: number; contractNumber: string; equipmentName: string; expectedEnd: string }[]
  /** تذاكر صيانة/أوامر غسيل متجاوزة موعد التسليم الموعود */
  overduePromises?: { id: number; docNumber: string; what: string; kind: 'maintenance' | 'laundry'; promisedAt: string }[]
  /** تنبيهات عقود إيجار العقارات (نمط سمات): انتهاء قريب أو قسط متأخر */
  leaseAlerts?: { leaseId: number; contractNumber: string; tenantName: string; kind: 'expiring' | 'overdue'; days: number; amountMinor: number }[]
  /** بلاغات المشاكل الداخلية المفتوحة (مستخدم → مدير/محاسب) — طلب المالك */
  openIssues?: { id: number; title: string; reportedBy: string }[]
  /** طلبات استعادة كلمة السر المفتوحة — تظهر للمالك ليعيّن رقماً جديداً */
  openPinResets?: { id: number; nameAr: string }[]
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
      // الوجهة المنطقية (مراجعة المالك): المنتهي → صفحة الهوالك (فيها زر إعدام فوري للمنتهي)،
      // والموشِك → تقارير المخزون حيث جدول تنبيهات الصلاحية FEFO الكامل
      route: a.status === 'expired' ? '/inventory/wastage' : '/reports',
      perm: 'inv.view', // من يرى المخزون يرى تنبيهات صلاحيته
    })
  }

  // 1.5) انخفاض مخزون تحت حد إعادة الطلب (Lightspeed/Square: reorder point alert)
  for (const it of input.lowStockItems ?? []) {
    out.push({
      id: `low:${it.id}`,
      icon: '📉',
      title: `مخزون منخفض: ${it.nameAr}`,
      body: `المتبقي ${it.stockQty} وحد إعادة الطلب ${it.minQty} — اطلب من المورد قبل النفاد`,
      severity: it.stockQty <= 0 ? 'danger' : 'warn',
      route: '/inventory/items',
      perm: 'inv.view',
    })
  }

  // 1.6) عقود إيجار متجاوزة موعد الإرجاع (Point of Rental: overdue alerts)
  for (const r of input.overdueRentals ?? []) {
    out.push({
      id: `rentover:${r.id}`,
      icon: '🚜',
      title: `إيجار متأخر: ${r.equipmentName}`,
      body: `العقد ${r.contractNumber} تجاوز موعد الإرجاع (${r.expectedEnd.slice(0, 10)}) — تابع العميل أو سوِّ التجاوز عند الإقفال`,
      severity: 'danger',
      route: '/rental/contracts',
      perm: 'ops.activity.use', // وحدات النشاط التشغيلية
    })
  }

  // 1.65) عقود إيجار عقارات: انتهاء قريب أو قسط متأخر (نمط سمات)
  for (const a of input.leaseAlerts ?? []) {
    out.push({
      id: `lease:${a.kind}:${a.leaseId}${a.kind === 'overdue' ? `:${a.amountMinor}` : ''}`,
      icon: a.kind === 'overdue' ? '⏰' : '📅',
      title: a.kind === 'overdue' ? `قسط إيجار متأخر: ${a.tenantName}` : `عقد يقارب الانتهاء: ${a.tenantName}`,
      body: a.kind === 'overdue'
        ? `${a.contractNumber} متأخر ${a.days} يوماً بمبلغ ${input.fmt(a.amountMinor)} — حصّله أو جدوله`
        : a.days < 0
          ? `${a.contractNumber} منتهٍ منذ ${-a.days} يوماً — جدد العقد أو أخلِ الوحدة`
          : `${a.contractNumber} ينتهي خلال ${a.days} يوماً — جهز التجديد أو الإخلاء`,
      severity: a.kind === 'overdue' ? 'danger' : 'warn',
      route: '/realestate/leases',
      perm: 'ops.activity.use',
    })
  }

  // 1.7) مواعيد تسليم موعودة متجاوزة (صيانة/مغسلة) — أهم التزام أمام العميل
  for (const t of input.overduePromises ?? []) {
    out.push({
      id: `promise:${t.kind}:${t.id}`,
      icon: '⏰',
      title: `موعد تسليم متجاوز: ${t.what}`,
      body: `${t.docNumber} وُعد العميل بتسليمه ${t.promisedAt.slice(0, 10)} — اتصل به أو أعد جدولته`,
      severity: 'warn',
      route: t.kind === 'maintenance' ? '/maintenance/tickets' : '/laundry/orders',
      perm: 'ops.activity.use',
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
        perm: 'party.customer.statement', // مالية العملاء — ليست للكاشير
      })
    }
  }

  // 2.5) بلاغات مشاكل داخلية مفتوحة — تظهر للمدير/المحاسب حتى تُحل
  for (const iss of input.openIssues ?? []) {
    out.push({
      id: `issue:${iss.id}`,
      icon: '📮',
      title: `بلاغ مشكلة: ${iss.title}`,
      body: `أبلغ عنها ${iss.reportedBy} — افتح البلاغات لمعالجتها وتوثيق الحل`,
      severity: 'warn',
      route: '/settings/issues',
      perm: 'set.users', // معالجة البلاغات شأن إداري
    })
  }

  // 2.7) طلبات استعادة كلمة السر — للمالك: موظف نسي رقمه وينتظر التعيين
  for (const r of input.openPinResets ?? []) {
    out.push({
      id: `pinreset:${r.id}`,
      icon: '🔑',
      title: `طلب استعادة رقم سري: ${r.nameAr}`,
      body: 'افتح شاشة الصلاحيات ← المستخدمون لتعيين رقم جديد له وإبلاغه به',
      severity: 'warn',
      route: '/settings/permissions',
      perm: 'set.users', // تعيين أرقام سرية = إدارة مستخدمين
    })
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
      perm: 'acc.vouchers', // مالية الشيكات — ليست للكاشير
    })
  }

  // الأخطر أولاً
  const rank = { danger: 0, warn: 1, info: 2 } as const
  return out.sort((a, b) => rank[a.severity] - rank[b.severity])
}

/**
 * فلترة الإشعارات بصلاحيات المستخدم النشط (مراجعة المالك):
 * الجرس يعرض فقط ما يستطيع صاحبه التصرف فيه — النمط العالمي
 * (Square/Toast: التنبيهات المالية للمدير، التشغيلية للجميع حسب الدور).
 */
export function visibleNotifications(all: readonly AppNotification[], perms: ReadonlySet<string>): AppNotification[] {
  return all.filter((n) => n.perm === null || perms.has(n.perm))
}
