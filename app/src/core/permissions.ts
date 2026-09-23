/**
 * نظام الصلاحيات — ShopSys
 * (وثيقة التصميم — القرارات 11 و12)
 * - دور "المالك" محجوز ومحمي: كل الصلاحيات، لا يُعدَّل ولا يُحذف.
 * - كل صلاحية قابلة للتفعيل بتشيك بوكس، مجمعة بأقسام.
 */

export interface PermissionDef {
  id: string
  nameAr: string
  section: string
  sensitive?: boolean // صلاحيات حساسة تُميَّز بصرياً
}

export const PERMISSION_SECTIONS: { id: string; nameAr: string; icon: string }[] = [
  { id: 'sales', nameAr: 'المبيعات والكاشير', icon: '🛒' },
  { id: 'inventory', nameAr: 'المخزون والأصناف', icon: '📦' },
  { id: 'purchases', nameAr: 'المشتريات والموردون', icon: '🚛' },
  { id: 'parties', nameAr: 'العملاء والموظفون', icon: '👥' },
  { id: 'accounting', nameAr: 'الحسابات العامة', icon: '📒' },
  { id: 'reports', nameAr: 'التقارير', icon: '📊' },
  { id: 'settings', nameAr: 'الإعدادات والنظام', icon: '⚙️' },
]

/* ─── فلترة الصلاحيات حسب وحدات النشاط (أمر المالك) ───
 * «الكاشير غير موجود في كل الأنشطة — لكل نشاط أدواره وصلاحياته»:
 * صلاحية مربوطة بوحدة عمل تختفي من شاشة الصلاحيات إن لم تكن الوحدة مفعلة.
 * الصلاحية غير المذكورة هنا عامة تظهر دائماً.
 */
export const PERMISSION_MODULE_MAP: Record<string, string[]> = {
  'sales.pos.open': ['pos'],
  'sales.invoice.create': ['pos'],
  'sales.price.edit': ['pos'],
  'sales.discount.grant': ['pos'],
  'sales.return.create': ['pos'],
  'sales.return.approve': ['pos'],
  'sales.expiry.override': ['pos'],
  'sales.credit.override': ['pos'],
  'sales.shift.close': ['pos'],
  'inv.view': ['inventory'],
  'inv.cost.view': ['inventory'],
  'inv.item.manage': ['inventory'],
  'inv.adjust': ['inventory'],
  'inv.transfer': ['inventory'],
  'inv.count': ['inventory'],
  'pur.invoice.create': ['purchases'],
  'pur.invoice.edit': ['purchases'],
  'pur.return.create': ['purchases'],
  'pur.supplier.manage': ['purchases'],
  // شاشات النشاط التخصصي — تظهر فقط إن وُجدت وحدة تخصصية واحدة على الأقل
  'ops.activity.use': [
    'maintenance', 'laundry', 'wallet_services', 'equipment_rental', 'logistics',
    'lab', 'contracting', 'clinic', 'cars', 'realestate', 'recipes', 'processing', 'jewelry', 'installments',
  ],
}

/** الصلاحيات الظاهرة لنشاطٍ وحداته modules — العامة + المرتبطة بوحدة مفعلة */
export function permissionsForModules(modules: readonly string[]): PermissionDef[] {
  return PERMISSIONS.filter((p) => {
    const req = PERMISSION_MODULE_MAP[p.id]
    return !req || req.some((m) => modules.includes(m))
  })
}

/** أقسام شاشة الصلاحيات الظاهرة — قسم بلا أي صلاحية ظاهرة يختفي كله */
export function permissionSectionsForModules(modules: readonly string[]): { id: string; nameAr: string; icon: string }[] {
  const visible = permissionsForModules(modules)
  return PERMISSION_SECTIONS.filter((s) => visible.some((p) => p.section === s.id))
}

export const PERMISSIONS: PermissionDef[] = [
  // المبيعات
  { id: 'sales.pos.open', nameAr: 'فتح شاشة البيع', section: 'sales' },
  { id: 'sales.invoice.create', nameAr: 'إنشاء فاتورة بيع', section: 'sales' },
  { id: 'sales.price.edit', nameAr: 'تعديل سعر البيع في الفاتورة', section: 'sales', sensitive: true },
  { id: 'sales.discount.grant', nameAr: 'منح خصم', section: 'sales', sensitive: true },
  { id: 'sales.return.create', nameAr: 'تسجيل مرتجع (بموافقة مشرف عند الحاجة)', section: 'sales' },
  { id: 'sales.return.approve', nameAr: 'اعتماد مرتجع دون رقم سري (مشرف/مالك)', section: 'sales', sensitive: true },
  { id: 'sales.expiry.override', nameAr: 'تجاوز حظر بيع منتهي الصلاحية', section: 'sales', sensitive: true },
  { id: 'sales.credit.override', nameAr: 'تجاوز حد ائتمان العميل (بيع آجل فوق الحد)', section: 'sales', sensitive: true },
  { id: 'sales.shift.close', nameAr: 'إقفال وردية', section: 'sales' },
  // المخزون
  { id: 'inv.view', nameAr: 'عرض الكميات', section: 'inventory' },
  { id: 'inv.cost.view', nameAr: 'رؤية سعر التكلفة', section: 'inventory', sensitive: true },
  { id: 'inv.item.manage', nameAr: 'إضافة وتعديل الأصناف', section: 'inventory' },
  { id: 'inv.adjust', nameAr: 'تسوية مخزنية', section: 'inventory', sensitive: true },
  { id: 'inv.transfer', nameAr: 'تحويل بين مخازن', section: 'inventory' },
  { id: 'inv.count', nameAr: 'جرد بالباركود', section: 'inventory' },
  // المشتريات
  { id: 'pur.invoice.create', nameAr: 'إنشاء فاتورة شراء', section: 'purchases' },
  { id: 'pur.invoice.edit', nameAr: 'تعديل فاتورة شراء مرحلة (عكس + إعادة ترحيل)', section: 'purchases', sensitive: true },
  { id: 'pur.return.create', nameAr: 'مرتجع مشتريات', section: 'purchases' },
  { id: 'pur.supplier.manage', nameAr: 'إدارة الموردين', section: 'purchases' },
  // العملاء والموظفون
  { id: 'party.customer.manage', nameAr: 'إدارة العملاء', section: 'parties' },
  { id: 'party.customer.statement', nameAr: 'كشف حساب عميل', section: 'parties' },
  { id: 'party.employee.manage', nameAr: 'إدارة الموظفين', section: 'parties', sensitive: true },
  { id: 'party.payroll', nameAr: 'الرواتب', section: 'parties', sensitive: true },
  // شاشات النشاط التخصصي
  { id: 'ops.activity.use', nameAr: 'شاشات النشاط التخصصي (صيانة/رحلات/معمل/عيادة...)', section: 'sales' },
  // الحسابات العامة
  { id: 'acc.journal.view', nameAr: 'عرض اليومية العامة', section: 'accounting' },
  { id: 'acc.journal.manual', nameAr: 'قيد يدوي', section: 'accounting', sensitive: true },
  { id: 'acc.journal.reverse', nameAr: 'عكس قيد', section: 'accounting', sensitive: true },
  { id: 'acc.coa.manage', nameAr: 'إدارة شجرة الحسابات', section: 'accounting', sensitive: true },
  { id: 'acc.vouchers', nameAr: 'سندات قبض وصرف', section: 'accounting' },
  { id: 'trs.payment.approve', nameAr: 'اعتماد خروج نقدية (سند صرف / تحويل خزائن / تسوية درج)', section: 'accounting', sensitive: true },
  { id: 'acc.fiscal.close', nameAr: 'إقفال السنة المالية', section: 'accounting', sensitive: true },
  // التقارير
  { id: 'rep.sales', nameAr: 'تقارير المبيعات', section: 'reports' },
  { id: 'rep.profit', nameAr: 'تقارير الربحية', section: 'reports', sensitive: true },
  { id: 'rep.financial', nameAr: 'القوائم المالية', section: 'reports', sensitive: true },
  // الإعدادات
  { id: 'set.general', nameAr: 'الإعدادات العامة', section: 'settings', sensitive: true },
  { id: 'set.branches', nameAr: 'إدارة الفروع ومقارنة أدائها (مالك/مدير عام)', section: 'settings', sensitive: true },
  { id: 'set.users', nameAr: 'المستخدمون والصلاحيات', section: 'settings', sensitive: true },
  { id: 'set.backup', nameAr: 'النسخ الاحتياطي', section: 'settings', sensitive: true },
  { id: 'set.audit.view', nameAr: 'عرض سجل التدقيق', section: 'settings', sensitive: true },
]

/* ─── فرض الصلاحيات (البند 4 — صفر تجاوز): خريطة مسار → صلاحية ─── */

/**
 * كل مسار في التطبيق مربوط بصلاحية — من لا يملكها لا يرى الشاشة في الشريط
 * الجانبي ولا يستطيع فتحها بالرابط مباشرة. null = متاح للجميع (حول/الدعم).
 * المطابقة بأطول بادئة (prefix) — المسارات التخصصية تُغطى بمجموعتها.
 */
export const ROUTE_PERMISSIONS: { prefix: string; perm: string | null }[] = [
  { prefix: '/pos', perm: 'sales.pos.open' },
  // نمط POS العالمي: الكاشير يفتح شاشة المرتجع ويجهزه، والتنفيذ يتطلب
  // رقم مشرف سرياً ما لم يملك sales.return.approve (حوار SupervisorPinDialog)
  { prefix: '/sales/returns', perm: 'sales.return.create' },
  { prefix: '/sales/exchange', perm: 'sales.return.create' },
  { prefix: '/sales/shifts', perm: 'sales.shift.close' },
  { prefix: '/sales/price-lists', perm: 'sales.price.edit' },
  // العروض/الباقات تسعير إداري مثل قوائم الأسعار — نفس صلاحية تعديل الأسعار
  { prefix: '/sales/promotions', perm: 'sales.price.edit' },
  { prefix: '/sales', perm: 'sales.invoice.create' },
  { prefix: '/inventory/transfers', perm: 'inv.transfer' },
  { prefix: '/inventory/counting', perm: 'inv.count' },
  { prefix: '/inventory/wastage', perm: 'inv.adjust' },
  { prefix: '/inventory/consumption', perm: 'inv.adjust' },
  { prefix: '/inventory/barcode-center', perm: 'inv.view' },
  { prefix: '/inventory/scale', perm: 'inv.item.manage' },
  { prefix: '/inventory', perm: 'inv.view' },
  { prefix: '/purchases/returns', perm: 'pur.return.create' },
  { prefix: '/purchases/suppliers', perm: 'pur.supplier.manage' },
  { prefix: '/purchases', perm: 'pur.invoice.create' },
  { prefix: '/parties/employees', perm: 'party.employee.manage' },
  { prefix: '/parties/payroll', perm: 'party.employee.manage' },
  { prefix: '/parties/employee-advances', perm: 'party.employee.manage' },
  { prefix: '/parties/employee-deductions', perm: 'party.employee.manage' },
  { prefix: '/parties/employee-commissions', perm: 'party.employee.manage' },
  { prefix: '/parties/custody', perm: 'party.employee.manage' },
  { prefix: '/parties', perm: 'party.customer.manage' },
  // شاشات النشاط التخصصي (صيانة/رحلات/معمل/عيادة/مقاولات/سيارات/محافظ/تأجير)
  { prefix: '/maintenance', perm: 'ops.activity.use' },
  { prefix: '/laundry', perm: 'ops.activity.use' },
  { prefix: '/wallets', perm: 'ops.activity.use' },
  { prefix: '/rental', perm: 'ops.activity.use' },
  { prefix: '/logistics', perm: 'ops.activity.use' },
  { prefix: '/lab', perm: 'ops.activity.use' },
  { prefix: '/contracting', perm: 'ops.activity.use' },
  { prefix: '/clinic', perm: 'ops.activity.use' },
  { prefix: '/cars', perm: 'ops.activity.use' },
  { prefix: '/realestate', perm: 'ops.activity.use' },
  { prefix: '/accounting/coa', perm: 'acc.coa.manage' },
  { prefix: '/accounting/opening-balances', perm: 'acc.coa.manage' },
  { prefix: '/accounting/assets', perm: 'acc.coa.manage' },
  { prefix: '/accounting/journal', perm: 'acc.journal.view' },
  { prefix: '/accounting/trial-balance', perm: 'acc.journal.view' },
  { prefix: '/accounting', perm: 'acc.vouchers' },
  { prefix: '/branches', perm: 'set.branches' },
  { prefix: '/reports/statements', perm: 'party.customer.statement' },
  { prefix: '/reports', perm: 'rep.sales' },
  { prefix: '/settings/permissions', perm: 'set.users' },
  { prefix: '/settings/audit', perm: 'set.audit.view' },
  { prefix: '/settings/backup', perm: 'set.backup' },
  { prefix: '/settings/sync', perm: 'set.backup' },
  { prefix: '/settings/profile', perm: null }, // «حسابي» — كل مستخدم يدير ملفه بنفسه
  { prefix: '/settings/about', perm: null }, // حول التطبيق — للجميع
  { prefix: '/settings/guides', perm: null }, // الشروحات — للجميع (تعليم كل مستخدم)
  { prefix: '/settings/support', perm: null }, // الدعم — للجميع
  { prefix: '/settings/issues', perm: null }, // الإبلاغ عن مشكلة — للجميع
  { prefix: '/settings', perm: 'set.general' },
  { prefix: '/', perm: null }, // لوحة المعلومات — للجميع
]

/** الصلاحية المطلوبة لمسار — مطابقة بأطول بادئة */
export function permissionForPath(path: string): string | null {
  const hit = ROUTE_PERMISSIONS
    .filter((r) => path === r.prefix || path.startsWith(r.prefix === '/' ? '/' : r.prefix + '/') || path.startsWith(r.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0]
  return hit ? hit.perm : null
}

/**
 * الصلاحيات الفعالة لمستخدم (البند 4 — لكل دور أو لكل موظف):
 * (صلاحيات الدور ∪ الممنوح فردياً) − المحجوب فردياً. المالك = الكل دائماً.
 * user=null هو المالك الافتراضي على الجهاز.
 */
/** وصف دور مخصص أنشأه المالك (نمط Square «Create permission set» / Toast custom jobs) */
export interface CustomRoleDef {
  id: string // custom_1, custom_2 …
  nameAr: string
}

/**
 * دمج تعديلات الأدوار المحفوظة مع الافتراضيات — دور المالك لا يتأثر أبداً.
 * customRoles (اختياري): أدوار أنشأها المالك بنفسه — صلاحياتها تعيش في overrides
 * بنفس آلية أدوار النظام، فكل مسارات التقييم (الدخول/القائمة/الاعتماد) تعمل تلقائياً.
 */
export function rolesWithOverrides(
  overrides: Record<string, string[]>,
  customRoles: readonly CustomRoleDef[] = [],
  activityId?: string | null,
): Role[] {
  const activityExtras = activityId ? (ACTIVITY_ROLES[activityId] ?? []) : []
  const base = [...DEFAULT_ROLES, ...activityExtras].map((r) => {
    if (r.isOwner) return r // محمي بنيوياً
    const o = overrides[r.id]
    return o ? { ...r, permissions: o } : r
  })
  const custom: Role[] = customRoles.map((c) => ({
    id: c.id, nameAr: c.nameAr, isSystem: false,
    permissions: overrides[c.id] ?? [],
  }))
  return [...base, ...custom]
}

/**
 * الأدوار المعروضة في شاشة الصلاحيات وقوائم الاختيار (أمر المالك):
 * دور مربوط بوحدة غير مفعلة (كاشير بلا pos) يختفي من العرض —
 * لكن تقييم صلاحيات مستخدم قديم معيّن عليه يظل يعمل (rolesWithOverrides كاملة).
 */
export function visibleRolesForModules(roles: readonly Role[], modules: readonly string[]): Role[] {
  return roles.filter((r) => !r.requiredModule || modules.includes(r.requiredModule))
}

export function effectivePermissionsFor(
  user: { roleId: string; extraPerms?: string[]; deniedPerms?: string[] } | null,
  roles: readonly Role[],
): Set<string> {
  if (user === null) return new Set(PERMISSIONS.map((p) => p.id)) // المالك الافتراضي
  const role = roles.find((r) => r.id === user.roleId)
  if (role?.isOwner) return new Set(PERMISSIONS.map((p) => p.id)) // دور المالك محمي — الكل
  const set = new Set(role?.permissions ?? [])
  for (const p of user.extraPerms ?? []) set.add(p)
  for (const p of user.deniedPerms ?? []) set.delete(p)
  return set
}

/** هل يستطيع فتح هذا المسار؟ */
export function canAccessPath(path: string, perms: Set<string>): boolean {
  const need = permissionForPath(path)
  return need === null || perms.has(need)
}

export interface Role {
  id: string
  nameAr: string
  isSystem: boolean // أدوار النظام الجاهزة
  isOwner?: boolean // دور المالك المحمي بنيوياً
  permissions: string[] // معرّفات الصلاحيات
  /** الدور يظهر فقط إن كانت هذه الوحدة مفعلة (كاشير بلا وحدة pos لا معنى له) */
  requiredModule?: string
}

const ALL = PERMISSIONS.map((p) => p.id)

/** الأدوار الجاهزة (وثيقة التصميم — القرار 12) */
export const DEFAULT_ROLES: Role[] = [
  { id: 'owner', nameAr: 'المالك', isSystem: true, isOwner: true, permissions: ALL },
  {
    id: 'cashier', nameAr: 'كاشير', isSystem: true, requiredModule: 'pos',
    // يفتح شاشة المرتجع ويجهزه — التنفيذ برقم مشرف سري (sales.return.approve ليست له)
    permissions: ['sales.pos.open', 'sales.invoice.create', 'sales.return.create', 'sales.shift.close', 'inv.view'],
  },
  {
    id: 'senior_seller', nameAr: 'بائع أول', isSystem: true, requiredModule: 'pos',
    permissions: [
      'sales.pos.open', 'sales.invoice.create', 'sales.discount.grant', 'sales.return.create', 'sales.shift.close',
      'inv.view', 'inv.item.manage', 'inv.count', 'party.customer.manage', 'party.customer.statement',
      'ops.activity.use',
    ],
  },
  {
    id: 'branch_manager', nameAr: 'مدير فرع', isSystem: true, requiredModule: 'pos',
    permissions: [
      'sales.pos.open', 'sales.invoice.create', 'sales.price.edit', 'sales.discount.grant',
      'sales.return.create', 'sales.return.approve', 'sales.expiry.override', 'sales.shift.close',
      'inv.view', 'inv.cost.view', 'inv.item.manage', 'inv.adjust', 'inv.transfer', 'inv.count',
      'pur.invoice.create', 'pur.return.create', 'pur.supplier.manage',
      'party.customer.manage', 'party.customer.statement',
      'rep.sales', 'rep.profit', 'acc.vouchers', 'ops.activity.use',
    ],
  },
  {
    id: 'accountant', nameAr: 'محاسب', isSystem: true,
    permissions: [
      'inv.view', 'inv.cost.view',
      'party.customer.statement', 'party.payroll',
      'acc.journal.view', 'acc.journal.manual', 'acc.journal.reverse', 'acc.coa.manage',
      'acc.vouchers', 'acc.fiscal.close',
      'rep.sales', 'rep.profit', 'rep.financial',
    ],
  },
]

/* ─── أدوار جاهزة حسب النشاط (طلب المالك) ───
 * «كاشير وبائع أول» لا يناسبان عيادة أو مقاولات — كل نشاط تخصصي يضيف
 * أدواره العالمية فوق الأدوار العامة (المالك/المحاسب يظلان مشتركين).
 * المرجعية: أدوار برامج المقاولات (مدير مشاريع/مهندس موقع)، العيادات
 * (طبيب/استقبال)، المعامل (فني/استقبال)، العقارات (مدير أملاك/وسيط)…
 */
export const ACTIVITY_ROLES: Record<string, Role[]> = {
  contracting: [
    {
      id: 'project_manager', nameAr: 'مدير مشاريع', isSystem: true,
      permissions: [
        'ops.activity.use', 'inv.view', 'inv.cost.view', 'inv.transfer', 'inv.count',
        'pur.invoice.create', 'pur.supplier.manage',
        'party.customer.manage', 'party.customer.statement',
        'rep.sales', 'rep.profit', 'acc.vouchers',
      ],
    },
    {
      id: 'site_engineer', nameAr: 'مهندس موقع', isSystem: true,
      permissions: ['ops.activity.use', 'inv.view', 'inv.count', 'inv.transfer'],
    },
  ],
  clinic: [
    {
      id: 'doctor', nameAr: 'طبيب', isSystem: true,
      permissions: ['ops.activity.use', 'party.customer.manage', 'party.customer.statement', 'rep.sales'],
    },
    {
      id: 'clinic_reception', nameAr: 'استقبال العيادة', isSystem: true,
      permissions: ['ops.activity.use', 'party.customer.manage', 'acc.vouchers'],
    },
  ],
  lab: [
    {
      // مراجعة العزل: كانت له inv.view لكن المعمل بلا وحدة مخزون أصلاً — صلاحية ميتة أزيلت
      id: 'lab_technician', nameAr: 'فني معمل', isSystem: true,
      permissions: ['ops.activity.use'],
    },
    {
      id: 'lab_reception', nameAr: 'استقبال المعمل', isSystem: true,
      permissions: ['ops.activity.use', 'party.customer.manage', 'acc.vouchers'],
    },
  ],
  realestate: [
    {
      id: 'property_manager', nameAr: 'مدير أملاك', isSystem: true,
      permissions: [
        'ops.activity.use', 'party.customer.manage', 'party.customer.statement',
        'acc.vouchers', 'rep.sales',
      ],
    },
    {
      id: 'realestate_agent', nameAr: 'وسيط عقاري', isSystem: true,
      permissions: ['ops.activity.use', 'party.customer.manage'],
    },
  ],
  logistics: [
    {
      id: 'fleet_coordinator', nameAr: 'منسق أسطول ورحلات', isSystem: true,
      permissions: ['ops.activity.use', 'party.customer.manage', 'party.customer.statement', 'acc.vouchers', 'rep.sales'],
    },
  ],
  cars: [
    {
      id: 'showroom_seller', nameAr: 'بائع معرض', isSystem: true,
      permissions: ['ops.activity.use', 'party.customer.manage', 'party.customer.statement', 'rep.sales'],
    },
  ],
  equipment_rental: [
    {
      id: 'rental_officer', nameAr: 'مسؤول تأجير', isSystem: true,
      permissions: ['ops.activity.use', 'party.customer.manage', 'party.customer.statement', 'acc.vouchers'],
    },
  ],
  laundry: [
    {
      id: 'laundry_operator', nameAr: 'موظف استلام وتسليم', isSystem: true,
      permissions: ['ops.activity.use', 'party.customer.manage'],
    },
  ],
  mobile: [
    {
      id: 'technician', nameAr: 'فني صيانة', isSystem: true,
      permissions: ['ops.activity.use', 'inv.view', 'party.customer.manage'],
    },
  ],
  restaurant: [
    {
      id: 'kitchen_manager', nameAr: 'مسؤول مطبخ وإنتاج', isSystem: true,
      permissions: ['ops.activity.use', 'inv.view', 'inv.count', 'inv.item.manage'],
    },
  ],
  // ─── أدوار الأنشطة المضافة (سد فجوة «لكل نشاط أدواره») ───
  pharmacy: [
    {
      // الصيدلي المسؤول — نمط برامج الصيدليات: يدير الأصناف والصلاحيات دون رؤية التكلفة
      id: 'pharmacist', nameAr: 'صيدلي', isSystem: true,
      permissions: ['sales.pos.open', 'sales.invoice.create', 'sales.return.create', 'sales.shift.close', 'inv.view', 'inv.item.manage', 'inv.count', 'party.customer.manage'],
    },
  ],
  butcher: [
    {
      id: 'butcher_master', nameAr: 'معلم جزارة (تقطيع وتجهيز)', isSystem: true,
      permissions: ['ops.activity.use', 'inv.view', 'inv.count', 'inv.item.manage'],
    },
  ],
  dates: [
    {
      id: 'sorting_supervisor', nameAr: 'مشرف فرز وتعبئة', isSystem: true,
      permissions: ['ops.activity.use', 'inv.view', 'inv.count', 'inv.item.manage'],
    },
  ],
  salon: [
    {
      // الحلاق/الخبيرة — يسجل خدماته فقط، الخصومات بموافقة
      id: 'stylist', nameAr: 'حلاق / خبيرة تجميل', isSystem: true,
      permissions: ['sales.pos.open', 'sales.invoice.create', 'party.customer.manage'],
    },
  ],
  bakery: [
    {
      id: 'baker', nameAr: 'خباز (إنتاج يومي)', isSystem: true,
      permissions: ['ops.activity.use', 'inv.view', 'inv.count', 'inv.item.manage'],
    },
  ],
  trading: [
    {
      // مندوب مبيعات الجملة — نمط SAP B1/دفترة توزيع: فواتير وعملاء وتحصيل، بلا أسعار خاصة
      id: 'sales_rep', nameAr: 'مندوب مبيعات', isSystem: true,
      permissions: ['sales.invoice.create', 'sales.return.create', 'inv.view', 'party.customer.manage', 'party.customer.statement', 'acc.vouchers'],
    },
    {
      id: 'warehouse_keeper', nameAr: 'أمين مخزن', isSystem: true,
      permissions: ['inv.view', 'inv.item.manage', 'inv.transfer', 'inv.count'],
    },
  ],
  manufacturing: [
    {
      // مسؤول الإنتاج — نمط Katana/MRPeasy: أوامر إنتاج وجرد بلا مبيعات
      id: 'production_manager', nameAr: 'مسؤول إنتاج', isSystem: true,
      permissions: ['ops.activity.use', 'inv.view', 'inv.cost.view', 'inv.item.manage', 'inv.count', 'inv.transfer'],
    },
    {
      id: 'warehouse_keeper', nameAr: 'أمين مخزن', isSystem: true,
      permissions: ['inv.view', 'inv.item.manage', 'inv.transfer', 'inv.count'],
    },
  ],
  services: [
    {
      // منسق خدمات — فواتير وعملاء ومقبوضات (نمط FreshBooks staff)
      id: 'service_coordinator', nameAr: 'منسق خدمات', isSystem: true,
      permissions: ['sales.invoice.create', 'party.customer.manage', 'party.customer.statement', 'acc.vouchers'],
    },
  ],
  building_materials: [
    {
      id: 'sales_rep', nameAr: 'مندوب مبيعات وتوصيل', isSystem: true,
      permissions: ['sales.invoice.create', 'sales.return.create', 'inv.view', 'party.customer.manage', 'party.customer.statement', 'acc.vouchers'],
    },
    {
      id: 'warehouse_keeper', nameAr: 'أمين مخزن', isSystem: true,
      permissions: ['inv.view', 'inv.item.manage', 'inv.transfer', 'inv.count'],
    },
  ],
  grocery: [
    {
      id: 'warehouse_keeper', nameAr: 'أمين مخزن', isSystem: true,
      permissions: ['inv.view', 'inv.item.manage', 'inv.transfer', 'inv.count'],
    },
  ],
  jewelry: [
    {
      // صايغ أول — يسعّر بحسب جرام اليوم لكن التكلفة والخصومات للمالك
      id: 'goldsmith', nameAr: 'صايغ أول', isSystem: true,
      permissions: ['sales.pos.open', 'sales.invoice.create', 'ops.activity.use', 'inv.view', 'party.customer.manage'],
    },
  ],
}
