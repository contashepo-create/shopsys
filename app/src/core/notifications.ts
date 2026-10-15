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
  /** معدات تجاوزت صيانتها الوقائية (serviceStatus) — سد فجوة تقرير النشاط #8 Immediate #1 */
  overdueMaintenanceEquipment?: { id: number; nameAr: string; overdueHours: number }[]
  /** معدات اقترب/انتهى تأمينها أو فحصها الدوري — سد فجوة تقرير النشاط #8 Future #3 */
  complianceDueEquipment?: { equipmentId: number; equipmentName: string; kind: 'insurance' | 'inspection'; dueDate: string; daysLeft: number }[]
  /** مركبات اقتربت/انتهت رخصتها أو تأمينها — سد فجوة تقرير النشاط #9 Immediate #1 */
  complianceDueVehicles?: { vehicleId: number; vehiclePlate: string; kind: 'license' | 'insurance'; dueDate: string; daysLeft: number }[]
  /** مستحقات سائقين غير مسواة مجمعة — سد فجوة تقرير النشاط #9 Immediate #2 */
  unsettledDriverDues?: { driverId: number; driverName: string; totalMinor: number; tripCount: number }[]
  /** قيم تحاليل حرجة لم يُوثَّق إبلاغ الطبيب بها — سد فجوة تقرير النشاط #10 Immediate #3 (CAP/CLIA) */
  criticalLabResults?: { orderId: number; orderNumber: string; testNameAr: string; patientName: string; resultValue: string; unit: string }[]
  /** تذاكر صيانة/أوامر غسيل متجاوزة موعد التسليم الموعود */
  overduePromises?: { id: number; docNumber: string; what: string; kind: 'maintenance' | 'laundry'; promisedAt: string }[]
  /** خطابات ضمان مقاولات تقترب/تجاوزت الانتهاء — سد فجوة تقرير النشاط #11 Immediate #3 */
  complianceDueBonds?: { bondId: number; bondNumber: string; dueDate: string; daysLeft: number }[]
  /** بنود موازنة مشروعات تجاوزت الفعلي موازنتها — سد فجوة تقرير النشاط #11 Immediate #3 */
  projectBudgetOverruns?: { projectId: number; projectNameAr: string; kindAr: string; overrunMinor: number }[]
  /** طلبات اعتماد مقاولات معلّقة تجاوزت مهلة معقولة بلا قرار — سد فجوة تقرير النشاط #11 Immediate #3 */
  pendingApprovalsAging?: { requestId: number; subject: string; actionLabel: string; daysPending: number }[]
  /** مشروعات مقاولات تستحق/تقترب من استحقاق الإفراج عن محتجزها بعد فترة الضمان — سد فجوة تقرير النشاط #11 Future #1 */
  retentionDueProjects?: { projectId: number; projectNameAr: string; dueDate: string; daysLeft: number; remainingMinor: number }[]
  /** تنبيهات عقود إيجار العقارات (نمط سمات): انتهاء قريب أو قسط متأخر */
  leaseAlerts?: { leaseId: number; contractNumber: string; tenantName: string; kind: 'expiring' | 'overdue'; days: number; amountMinor: number }[]
  /** مواعيد عيادة اليوم ما زالت «محجوز» دون حسم — سد فجوة تقرير النشاط #12 (Immediate #3) */
  clinicAppointmentsToday?: { appointmentId: number; patientName: string; time: string; purpose: string }[]
  /** مرضى عيادة برصيد مستحق غير محصَّل تجاوز مدة معقولة — سد فجوة تقرير النشاط #12 (Immediate #3) */
  overduePatientBalances?: { patientId: number; patientName: string; balanceMinor: number; daysPending: number }[]
  /** سيارات معرض متقادمة بالمخزون 60 يوماً فأكثر بلا بيع — سد فجوة تقرير النشاط #13 (Gap 3) */
  agingCars?: { carId: number; label: string; daysInStock: number }[]
  /** بلاغات المشاكل الداخلية المفتوحة (مستخدم → مدير/محاسب) — طلب المالك */
  openIssues?: { id: number; title: string; reportedBy: string }[]
  /** طلبات استعادة كلمة السر المفتوحة — تظهر للمالك ليعيّن رقماً جديداً */
  openPinResets?: { id: number; nameAr: string }[]
  /**
   * تذكير قرب انتهاء الاشتراك (بند 5 من تدقيق 2026-10-08) — يُحسب محلياً من
   * الرخصة الموقّعة فيعمل أوفلاين. يُمرَّر جاهزاً (النواة في subscriptionReminder.ts)
   * كي يستفيد من آليات الجرس الموجودة بدل اختراع واجهة جديدة.
   */
  licenseReminder?: AppNotification | null
  fmt: (minor: number) => string
  todayIso: string // ISO كامل أو YYYY-MM-DD
}

export function collectNotifications(input: NotificationsInput): AppNotification[] {
  const out: AppNotification[] = []
  const day = input.todayIso.slice(0, 10)
  const dayMs = Date.parse(`${day}T00:00:00Z`)

  // 0) تذكير قرب انتهاء الاشتراك — يُحسب محلياً من الرخصة الموقّعة (يعمل أوفلاين)
  if (input.licenseReminder) out.push(input.licenseReminder)

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

  // 1.61) معدات تجاوزت موعد صيانتها الوقائية (سد فجوة تقرير النشاط #8 — Immediate #1)
  for (const e of input.overdueMaintenanceEquipment ?? []) {
    out.push({
      id: `eqsvc:${e.id}`,
      icon: '🔧',
      title: `صيانة متأخرة: ${e.nameAr}`,
      body: `تجاوزت ${e.overdueHours} ساعة عن موعد الصيانة الوقائية — سجّل الخدمة أو أجّل الخطة`,
      severity: 'danger',
      route: '/rental/equipment',
      perm: 'ops.activity.use',
    })
  }

  // 1.62) امتثال معدات: تأمين/فحص دوري يقترب أو انتهى (سد فجوة تقرير النشاط #8 — Future #3)
  for (const c of input.complianceDueEquipment ?? []) {
    const what = c.kind === 'insurance' ? 'تأمين' : 'فحص دوري'
    out.push({
      id: `eqcompl:${c.kind}:${c.equipmentId}`,
      icon: '📋',
      title: c.daysLeft < 0 ? `${what} منتهٍ: ${c.equipmentName}` : `${what} يقترب: ${c.equipmentName}`,
      body: c.daysLeft < 0
        ? `انتهى ${what} منذ ${-c.daysLeft} يوماً (${c.dueDate}) — جدّده قبل أي عقد جديد`
        : `${what} ينتهي خلال ${c.daysLeft} يوماً (${c.dueDate})`,
      severity: c.daysLeft < 0 ? 'danger' : 'warn',
      route: '/rental/equipment',
      perm: 'ops.activity.use',
    })
  }

  // 1.63) امتثال مركبات: رخصة/تأمين يقترب أو انتهى (سد فجوة تقرير النشاط #9 — Immediate #1)
  for (const c of input.complianceDueVehicles ?? []) {
    const what = c.kind === 'license' ? 'رخصة' : 'تأمين'
    out.push({
      id: `vehcompl:${c.kind}:${c.vehicleId}`,
      icon: '🪪',
      title: c.daysLeft < 0 ? `${what} منتهية: ${c.vehiclePlate}` : `${what} تقترب: ${c.vehiclePlate}`,
      body: c.daysLeft < 0
        ? `انتهت ${what} منذ ${-c.daysLeft} يوماً (${c.dueDate}) — جدّدها قبل أي نقلة جديدة`
        : `${what} تنتهي خلال ${c.daysLeft} يوماً (${c.dueDate})`,
      severity: c.daysLeft < 0 ? 'danger' : 'warn',
      route: '/logistics/fleet',
      perm: 'ops.activity.use',
    })
  }

  // 1.64) مستحقات سائقين غير مسواة مجمعة (سد فجوة تقرير النشاط #9 — Immediate #2)
  for (const d of input.unsettledDriverDues ?? []) {
    out.push({
      id: `drvdue:${d.driverId}`,
      icon: '💰',
      title: `مستحقات سائق غير مسواة: ${d.driverName}`,
      body: `${input.fmt(d.totalMinor)} عن ${d.tripCount} رحلة — سوِّها من شاشة النقلات أو اصرفها مع الراتب`,
      severity: 'warn',
      route: '/logistics/trips',
      perm: 'ops.activity.use',
    })
  }

  // 1.66) قيم تحاليل حرجة غير موثَّقة الإبلاغ (سد فجوة تقرير النشاط #10 — Immediate #3، معيار CAP/CLIA)
  for (const c of input.criticalLabResults ?? []) {
    out.push({
      id: `labcrit:${c.orderId}:${c.testNameAr}`,
      icon: '🚨',
      title: `قيمة حرجة بانتظار الإبلاغ: ${c.testNameAr}`,
      body: `${c.patientName} — ${c.resultValue} ${c.unit} (${c.orderNumber}) — وثّق إبلاغ الطبيب المعالج فوراً`,
      severity: 'danger',
      route: '/lab/orders',
      perm: 'ops.activity.use',
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

  // 1.71) خطابات ضمان مقاولات تقترب/تجاوزت الانتهاء (سد فجوة تقرير النشاط #11 — Immediate #3)
  for (const b of input.complianceDueBonds ?? []) {
    out.push({
      id: `bondcompl:${b.bondId}`,
      icon: '📜',
      title: b.daysLeft < 0 ? `خطاب ضمان منتهٍ: ${b.bondNumber}` : `خطاب ضمان يقترب: ${b.bondNumber}`,
      body: b.daysLeft < 0
        ? `انتهى منذ ${-b.daysLeft} يوماً (${b.dueDate}) — جدّده أو أفرج عنه فوراً`
        : `ينتهي خلال ${b.daysLeft} يوماً (${b.dueDate})`,
      severity: b.daysLeft < 0 ? 'danger' : 'warn',
      route: '/contracting/bonds',
      perm: 'ops.activity.use',
    })
  }

  // 1.72) بنود موازنة مشروعات تجاوزت الفعلي موازنتها (سد فجوة تقرير النشاط #11 — Immediate #3)
  for (const o of input.projectBudgetOverruns ?? []) {
    out.push({
      id: `prjbudget:${o.projectId}:${o.kindAr}`,
      icon: '📊',
      title: `تجاوز موازنة: ${o.projectNameAr}`,
      body: `بند «${o.kindAr}» تجاوز موازنته بمقدار ${input.fmt(o.overrunMinor)} — راجع أسعار التوريد أو عدّل الموازنة`,
      severity: 'danger',
      route: '/contracting/budget',
      perm: 'ops.activity.use',
    })
  }

  // 1.73) طلبات اعتماد مقاولات معلّقة تجاوزت مهلة معقولة (سد فجوة تقرير النشاط #11 — Immediate #3)
  for (const a of input.pendingApprovalsAging ?? []) {
    out.push({
      id: `apprage:${a.requestId}`,
      icon: '🕓',
      title: `طلب اعتماد معلّق: ${a.subject}`,
      body: `${a.actionLabel} بانتظار قرار منذ ${a.daysPending} يوماً — تابعه قبل تعطّل العمل عليه`,
      severity: a.daysPending >= 7 ? 'danger' : 'warn',
      route: '/contracting/approvals',
      perm: 'ops.activity.use',
    })
  }

  // 1.74) مشروعات تستحق/تقترب من استحقاق الإفراج عن المحتجز بعد فترة الضمان (سد فجوة تقرير النشاط #11 — Future #1)
  for (const r of input.retentionDueProjects ?? []) {
    out.push({
      id: `retdue:${r.projectId}`,
      icon: '🔓',
      title: r.daysLeft < 0 ? `محتجز مستحق الإفراج: ${r.projectNameAr}` : `محتجز يقترب استحقاقه: ${r.projectNameAr}`,
      body: r.daysLeft < 0
        ? `انتهت فترة الضمان منذ ${-r.daysLeft} يوماً (${r.dueDate}) — ${input.fmt(r.remainingMinor)} بانتظار الإفراج`
        : `فترة الضمان تنتهي خلال ${r.daysLeft} يوماً (${r.dueDate}) — ${input.fmt(r.remainingMinor)} محتجزة`,
      severity: r.daysLeft < 0 ? 'danger' : 'warn',
      route: '/contracting/projects',
      perm: 'ops.activity.use',
    })
  }

  // 1.75) مواعيد عيادة اليوم ما زالت «محجوز» دون حسم (سد فجوة تقرير النشاط #12 — Immediate #3)
  for (const a of input.clinicAppointmentsToday ?? []) {
    out.push({
      id: `clinicappt:${a.appointmentId}`,
      icon: '🗓️',
      title: `موعد اليوم لم يُحسم: ${a.patientName}`,
      body: `${a.time} — ${a.purpose || 'بلا وصف'} — راجع جدول اليوم وحدّث الحالة (حضر/تأجل/لم يحضر)`,
      severity: 'warn',
      route: '/clinic/appointments',
      perm: 'ops.activity.use',
    })
  }

  // 1.76) مرضى عيادة برصيد مستحق تجاوز مدة معقولة (سد فجوة تقرير النشاط #12 — Immediate #3)
  for (const o of input.overduePatientBalances ?? []) {
    out.push({
      id: `patbal:${o.patientId}`,
      icon: '💳',
      title: `رصيد مريض متأخر: ${o.patientName}`,
      body: `${input.fmt(o.balanceMinor)} مستحقة منذ ${o.daysPending} يوماً — تابع التحصيل`,
      severity: o.daysPending >= 14 ? 'danger' : 'warn',
      route: '/clinic/patients',
      perm: 'ops.activity.use',
    })
  }

  // 1.77) سيارات معرض متقادمة بالمخزون 60 يوماً فأكثر بلا بيع (سد فجوة تقرير النشاط #13 — Gap 3)
  for (const a of input.agingCars ?? []) {
    out.push({
      id: `caraging:${a.carId}`,
      icon: '🕰️',
      title: `سيارة متقادمة بالمعرض: ${a.label}`,
      body: `بالمعرض منذ ${a.daysInStock} يوماً بلا بيع — فكّر بتخفيض السعر أو عرضها بالجملة`,
      severity: a.daysInStock >= 90 ? 'danger' : 'warn',
      route: '/cars',
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
  // الحالات القائمة (غير النهائية): held/deposited للوارد، issued للصادر — راجع ChequeStatus في cheques.ts
  for (const c of input.cheques) {
    if (c.status !== 'held' && c.status !== 'deposited' && c.status !== 'issued') continue
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
