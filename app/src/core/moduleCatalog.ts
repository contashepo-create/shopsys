/**
 * كتالوج الوحدات المضافة — مصدر واحد يغذّي ثلاث واجهات (سدّ فجوات §6 في ملف
 * الرؤية `docs/رؤية_تكيّف_الأنشطة_الشاملة_2026-10-12.md`):
 *
 *  · **روابط تقارير الأقسام** → بطاقة «تقارير أقسامك» في مركز التقارير
 *    (كان تقرير الوحدة المضافة لا يُدعى من أي مكان في المركز).
 *  · **ودجات الوحدات** → لوحة اليوم: كان الويدجت حبيس نشاطه الأصلي، فمغسلة
 *    طُعّمت في سوبرماركت لا ترى «أوامر غسيل مفتوحة» في اللوحة.
 *  · **قوالب مصروف الوحدة** → بنود المصروف الجاهزة («مورد قطع غيار السيارات»
 *    مثلاً) تُضاف بضغطة واحدة في شاشة مراكز التكلفة.
 *
 * القاعدة واحدة للثلاث: ما دامت الوحدة مفعّلة يظهر ما يخصها، وبمجرد إطفائها يختفي
 * بلا بقايا — والحساب المستخدم في كل قالب موجود فعلاً في شجرة الحسابات.
 * البوابة `verify_module_catalog.mjs` تحرس اكتمال الجداول الثلاثة ومطابقتها
 * للوحدات الثمانية عشر وللمسارات الحقيقية في `navCatalog`.
 */
import type { BusinessModule } from './activities.ts'
import type { ActivityWidget } from './activityTheme.ts'

export interface ModuleReportLink { path: string; labelAr: string }
export interface ModuleReportCenter { labelAr: string; links: ModuleReportLink[] }
export interface ModuleExpenseTemplate { nameAr: string; accountCode: string }

/* ═══ ① روابط تقارير الأقسام ═══ */
export const MODULE_REPORT_LINKS: Record<BusinessModule, ModuleReportCenter> = {
  pos: { labelAr: 'المبيعات والورديات', links: [
    { path: '/pos', labelAr: 'شاشة الكاشير' },
    { path: '/sales/returns', labelAr: 'مرتجعات المبيعات' },
    { path: '/sales/shifts', labelAr: 'ورديات الكاشير' },
  ] },
  inventory: { labelAr: 'المخزون والأصناف', links: [
    { path: '/inventory/items', labelAr: 'الأصناف والأرصدة' },
    { path: '/inventory/counting', labelAr: 'الجرد' },
    { path: '/inventory/wastage', labelAr: 'الهالك والتوالف' },
    { path: '/inventory/serials', labelAr: 'السيريالات والضمانات' },
  ] },
  purchases: { labelAr: 'المشتريات والموردون', links: [
    { path: '/purchases/invoices', labelAr: 'فواتير الشراء' },
    { path: '/purchases/orders', labelAr: 'أوامر الشراء' },
    { path: '/purchases/suppliers', labelAr: 'الموردون وأرصدتهم' },
  ] },
  installments: { labelAr: 'الأقساط', links: [{ path: '/parties/installments', labelAr: 'جدول الأقساط والمتأخرات' }] },
  recipes: { labelAr: 'الوصفات والإنتاج', links: [
    { path: '/restaurant/reports', labelAr: 'مركز تقارير المطعم' },
    { path: '/inventory/recipes', labelAr: 'الوصفات والتكلفة' },
    { path: '/sales/restaurant-orders', labelAr: 'أوردرات المطبخ' },
  ] },
  processing: { labelAr: 'التجهيز والتفكيك', links: [
    { path: '/inventory/processing', labelAr: 'أوامر التجهيز والتصافي' },
    { path: '/inventory/wastage', labelAr: 'الفاقد الموثق' },
  ] },
  jewelry: { labelAr: 'الصاغة', links: [{ path: '/inventory/jewelry', labelAr: 'مركز الذهب والعيارات' }] },
  maintenance: { labelAr: 'الصيانة', links: [{ path: '/maintenance/tickets', labelAr: 'أذون الصيانة وحالتها' }] },
  laundry: { labelAr: 'المغسلة', links: [{ path: '/laundry/orders', labelAr: 'أوامر الغسيل والتسليم' }] },
  booking: { labelAr: 'المواعيد والحجوزات', links: [{ path: '/bookings', labelAr: 'حجوزات اليوم والقادمة' }] },
  equipment_rental: { labelAr: 'إيجار المعدات', links: [
    { path: '/rental/reports', labelAr: 'مركز تقارير الإيجار' },
    { path: '/rental/contracts', labelAr: 'عقود الإيجار والتأمينات' },
    { path: '/rental/invoices', labelAr: 'فواتير الإيجار' },
  ] },
  logistics: { labelAr: 'اللوجستيات', links: [
    { path: '/logistics/trips', labelAr: 'ربحية كل نقلة' },
    { path: '/logistics/fleet', labelAr: 'الأسطول والسائقون' },
    { path: '/logistics/invoices', labelAr: 'فواتير النقل' },
  ] },
  lab: { labelAr: 'معمل التحاليل', links: [
    { path: '/lab/orders', labelAr: 'الطلبات والنتائج' },
    { path: '/lab/referrers', labelAr: 'الأطباء المحيلون وعمولاتهم' },
    { path: '/lab/tests', labelAr: 'قائمة التحاليل وأسعارها' },
  ] },
  contracting: { labelAr: 'المقاولات', links: [
    { path: '/contracting/reports', labelAr: 'مركز تقارير المقاولات' },
    { path: '/contracting/evm', labelAr: 'القيمة المكتسبة (EVM)' },
    { path: '/contracting/budget', labelAr: 'الموازنة مقابل الفعلي' },
    { path: '/contracting/collections', labelAr: 'التحصيلات والمحتجزات' },
  ] },
  clinic: { labelAr: 'العيادة', links: [
    { path: '/clinic/appointments', labelAr: 'مواعيد اليوم' },
    { path: '/clinic/patients', labelAr: 'ملفات المرضى والزيارات' },
  ] },
  cars: { labelAr: 'معرض السيارات', links: [{ path: '/cars', labelAr: 'السيارات وتكلفة كل واحدة' }] },
  wallet_services: { labelAr: 'خدمات المحافظ', links: [{ path: '/wallets/ops', labelAr: 'عمليات المحافظ وربحها' }] },
  realestate: { labelAr: 'العقارات', links: [
    { path: '/realestate/leases', labelAr: 'عقود الإيجار والاستحقاقات' },
    { path: '/realestate/invoices', labelAr: 'فواتير الإيجار والتحصيل' },
    { path: '/realestate/properties', labelAr: 'العقارات والوحدات' },
  ] },
}

/* ═══ ② ودجات اللوحة لكل وحدة ═══ */
export const MODULE_WIDGETS: Record<BusinessModule, ActivityWidget[]> = {
  pos: ['top_debtors'],
  inventory: ['low_stock', 'expiry_soon'],
  purchases: ['po_waiting'],
  installments: ['upcoming_installments'],
  recipes: ['kitchen_orders'],
  processing: ['yield_today'],
  jewelry: ['gold_position'],
  maintenance: ['open_tickets'],
  laundry: ['laundry_orders'],
  booking: ['today_bookings'],
  equipment_rental: ['open_rentals'],
  logistics: ['active_trips'],
  lab: ['lab_pending'],
  contracting: ['open_projects'],
  clinic: ['today_appointments'],
  cars: ['open_rentals'],
  wallet_services: ['wallet_float'],
  realestate: ['rentals_expiring'],
}

/** وحدات بلا ويدجت — استثناء مصرَّح به بسببه؛ البوابة ترفض أي استثناء بلا نص */
export const MODULE_WIDGET_EXCEPTIONS: Partial<Record<BusinessModule, string>> = {}

/* ═══ ③ قوالب مصروف الوحدة (حسابها من الشجرة القياسية) ═══ */
export const MODULE_EXPENSE_TEMPLATES: Record<BusinessModule, ModuleExpenseTemplate[]> = {
  pos: [
    { nameAr: 'رسوم ماكينات الدفع (فيزا/محافظ)', accountCode: '5108' },
    { nameAr: 'مصروف برنامج الولاء', accountCode: '5115' },
  ],
  inventory: [
    { nameAr: 'هالك وتوالف مخزون', accountCode: '5111' },
    { nameAr: 'فروق تسويات وجرد المخزون', accountCode: '5112' },
  ],
  purchases: [{ nameAr: 'شحن ونقل مشتريات', accountCode: '5108' }],
  installments: [{ nameAr: 'عمولات بيع بالتقسيط للغير', accountCode: '5113' }],
  recipes: [{ nameAr: 'مستهلكات تشغيل المطبخ', accountCode: '5114' }],
  processing: [{ nameAr: 'فاقد التقطيع والفرز', accountCode: '5111' }],
  jewelry: [{ nameAr: 'مصنعية وسبك لدى الغير', accountCode: '5108' }],
  maintenance: [
    { nameAr: 'قطع غيار مستخدمة في الصيانة', accountCode: '5114' },
    { nameAr: 'ورشة إصلاح خارجية', accountCode: '5113' },
  ],
  laundry: [{ nameAr: 'مواد تنظيف ومستهلكات غسيل', accountCode: '5114' }],
  booking: [{ nameAr: 'عمولات حجز للغير', accountCode: '5113' }],
  equipment_rental: [{ nameAr: 'وقود وزيوت تشغيل المعدات', accountCode: '5105' }],
  logistics: [{ nameAr: 'سولار وطرق للنقلات', accountCode: '5106' }],
  lab: [
    { nameAr: 'عمولات أطباء محيلين', accountCode: '5109' },
    { nameAr: 'كيماويات ومستلزمات معمل', accountCode: '5114' },
  ],
  contracting: [{ nameAr: 'مواد ومقاولو باطن للمشروعات', accountCode: '5110' }],
  clinic: [{ nameAr: 'مستهلكات عيادة', accountCode: '5114' }],
  cars: [{ nameAr: 'تشغيل وتجهيز سيارة', accountCode: '5105' }],
  wallet_services: [{ nameAr: 'عمولات محافظ للغير', accountCode: '5113' }],
  realestate: [
    { nameAr: 'صيانة وإدارة عقارات', accountCode: '5108' },
    { nameAr: 'سعي عقاري مدفوع', accountCode: '5113' },
  ],
}

/** الوحدات مفعّلة بترتيبها القياسي (ALL_MODULES) — فلا يختلف ترتيب البطاقات */
export function widgetsForModules(modules: readonly BusinessModule[]): ActivityWidget[] {
  const out: ActivityWidget[] = []
  for (const module of modules) for (const widget of MODULE_WIDGETS[module] ?? []) if (!out.includes(widget)) out.push(widget)
  return out
}

export function reportCentersForModules(modules: readonly BusinessModule[]): { module: BusinessModule; center: ModuleReportCenter }[] {
  const out: { module: BusinessModule; center: ModuleReportCenter }[] = []
  for (const module of modules) { const center = MODULE_REPORT_LINKS[module]; if (center && center.links.length) out.push({ module, center }) }
  return out
}

export function expenseTemplatesForModules(modules: readonly BusinessModule[]): { module: BusinessModule; template: ModuleExpenseTemplate }[] {
  const out: { module: BusinessModule; template: ModuleExpenseTemplate }[] = []
  for (const module of modules) for (const template of MODULE_EXPENSE_TEMPLATES[module] ?? []) out.push({ module, template })
  return out
}
