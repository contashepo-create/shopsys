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

export const PERMISSIONS: PermissionDef[] = [
  // المبيعات
  { id: 'sales.pos.open', nameAr: 'فتح شاشة البيع', section: 'sales' },
  { id: 'sales.invoice.create', nameAr: 'إنشاء فاتورة بيع', section: 'sales' },
  { id: 'sales.price.edit', nameAr: 'تعديل سعر البيع في الفاتورة', section: 'sales', sensitive: true },
  { id: 'sales.discount.grant', nameAr: 'منح خصم', section: 'sales', sensitive: true },
  { id: 'sales.return.approve', nameAr: 'اعتماد مرتجع مبيعات', section: 'sales', sensitive: true },
  { id: 'sales.expiry.override', nameAr: 'تجاوز حظر بيع منتهي الصلاحية', section: 'sales', sensitive: true },
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
  { id: 'pur.return.create', nameAr: 'مرتجع مشتريات', section: 'purchases' },
  { id: 'pur.supplier.manage', nameAr: 'إدارة الموردين', section: 'purchases' },
  // العملاء والموظفون
  { id: 'party.customer.manage', nameAr: 'إدارة العملاء', section: 'parties' },
  { id: 'party.customer.statement', nameAr: 'كشف حساب عميل', section: 'parties' },
  { id: 'party.employee.manage', nameAr: 'إدارة الموظفين', section: 'parties', sensitive: true },
  { id: 'party.payroll', nameAr: 'الرواتب', section: 'parties', sensitive: true },
  // الحسابات العامة
  { id: 'acc.journal.view', nameAr: 'عرض اليومية العامة', section: 'accounting' },
  { id: 'acc.journal.manual', nameAr: 'قيد يدوي', section: 'accounting', sensitive: true },
  { id: 'acc.journal.reverse', nameAr: 'عكس قيد', section: 'accounting', sensitive: true },
  { id: 'acc.coa.manage', nameAr: 'إدارة شجرة الحسابات', section: 'accounting', sensitive: true },
  { id: 'acc.vouchers', nameAr: 'سندات قبض وصرف', section: 'accounting' },
  { id: 'acc.fiscal.close', nameAr: 'إقفال السنة المالية', section: 'accounting', sensitive: true },
  // التقارير
  { id: 'rep.sales', nameAr: 'تقارير المبيعات', section: 'reports' },
  { id: 'rep.profit', nameAr: 'تقارير الربحية', section: 'reports', sensitive: true },
  { id: 'rep.financial', nameAr: 'القوائم المالية', section: 'reports', sensitive: true },
  // الإعدادات
  { id: 'set.general', nameAr: 'الإعدادات العامة', section: 'settings', sensitive: true },
  { id: 'set.users', nameAr: 'المستخدمون والصلاحيات', section: 'settings', sensitive: true },
  { id: 'set.backup', nameAr: 'النسخ الاحتياطي', section: 'settings', sensitive: true },
  { id: 'set.audit.view', nameAr: 'عرض سجل التدقيق', section: 'settings', sensitive: true },
]

export interface Role {
  id: string
  nameAr: string
  isSystem: boolean // أدوار النظام الجاهزة
  isOwner?: boolean // دور المالك المحمي بنيوياً
  permissions: string[] // معرّفات الصلاحيات
}

const ALL = PERMISSIONS.map((p) => p.id)

/** الأدوار الجاهزة (وثيقة التصميم — القرار 12) */
export const DEFAULT_ROLES: Role[] = [
  { id: 'owner', nameAr: 'المالك', isSystem: true, isOwner: true, permissions: ALL },
  {
    id: 'cashier', nameAr: 'كاشير', isSystem: true,
    permissions: ['sales.pos.open', 'sales.invoice.create', 'sales.shift.close', 'inv.view'],
  },
  {
    id: 'senior_seller', nameAr: 'بائع أول', isSystem: true,
    permissions: [
      'sales.pos.open', 'sales.invoice.create', 'sales.discount.grant', 'sales.shift.close',
      'inv.view', 'inv.item.manage', 'inv.count', 'party.customer.manage', 'party.customer.statement',
    ],
  },
  {
    id: 'branch_manager', nameAr: 'مدير فرع', isSystem: true,
    permissions: [
      'sales.pos.open', 'sales.invoice.create', 'sales.price.edit', 'sales.discount.grant',
      'sales.return.approve', 'sales.expiry.override', 'sales.shift.close',
      'inv.view', 'inv.cost.view', 'inv.item.manage', 'inv.adjust', 'inv.transfer', 'inv.count',
      'pur.invoice.create', 'pur.return.create', 'pur.supplier.manage',
      'party.customer.manage', 'party.customer.statement',
      'rep.sales', 'rep.profit', 'acc.vouchers',
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
