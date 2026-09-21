/**
 * مسميات الأقسام حسب النشاط — نواة خالصة (أمر المالك):
 * «دقق في مسمى كل قسم ومسمى كل بند حسب النشاط — لا يظهر مسمى بند
 * في نشاط آخر لا علاقة له به»
 *
 * التطبيق يعرض نفس الشاشة لكن باسم بلغة صاحب النشاط نفسه:
 * الجزار يرى «الزبائن» والمقاول يرى «العملاء (أصحاب الأعمال)» ومحل
 * الأجهزة يرى «العملاء والضمانات»… إلخ. غير المذكور يبقى بالاسم العام.
 */

/** مفتاح المسمى: navId بصيغة section.child أو section وحده */
export type LabelKey =
  | 'sales' // قسم المبيعات
  | 'sales.pos' // شاشة البيع
  | 'sales.invoices'
  | 'inventory' // قسم المخزون
  | 'inventory.items' // الأصناف
  | 'parties.customers' // العملاء
  | 'purchases.suppliers' // الموردون
  | 'inventory.recipes' // الوصفات والإنتاج

/** مسميات نشاط واحد — ما لم يُذكر يُعرض الاسم العام */
export type ActivityLabels = Partial<Record<LabelKey, string>>

export const ACTIVITY_LABELS: Record<string, ActivityLabels> = {
  restaurant: {
    'inventory.items': 'الأصناف والخامات',
    'inventory.recipes': 'وصفات الأطباق والإنتاج',
    'parties.customers': 'الزبائن',
  },
  grocery: { 'parties.customers': 'الزبائن' },
  butcher: {
    'parties.customers': 'الزبائن',
    'inventory.items': 'الأصناف واللحوم',
  },
  bakery: {
    'inventory.recipes': 'وصفات الإنتاج اليومي',
    'parties.customers': 'الزبائن',
  },
  herbalist: {
    'inventory.recipes': 'الخلطات والتجهيز',
    'parties.customers': 'الزبائن',
  },
  salon: {
    'inventory.items': 'الخدمات والمنتجات',
    'parties.customers': 'الزبائن',
  },
  pharmacy: { 'inventory.items': 'الأدوية والأصناف' },
  manufacturing: {
    'sales.pos': 'إنشاء فاتورة بيع',
    'inventory.items': 'الخامات والمنتجات',
    'inventory.recipes': 'وصفات التصنيع وأوامر الإنتاج',
    'sales.invoices': 'فواتير بيع المنتجات',
  },
  trading: {
    'sales.pos': 'إنشاء فاتورة بيع',
    'sales.invoices': 'فواتير البيع (جملة وقطاعي)',
    'parties.customers': 'العملاء وحدود الائتمان',
  },
  services: {
    'sales.pos': 'إنشاء فاتورة خدمات',
    'inventory.items': 'الخدمات المقدمة',
    'sales.invoices': 'فواتير الخدمات',
  },
  stationery: { 'parties.customers': 'الزبائن' },
  contracting: {
    'parties.customers': 'العملاء (أصحاب الأعمال)',
    'inventory.items': 'أصناف المواد',
    'purchases.suppliers': 'موردو المواد',
  },
  realestate: { 'parties.customers': 'المستأجرون والمشترون' },
  equipment_rental: { 'parties.customers': 'المستأجرون' },
  cars: { 'parties.customers': 'العملاء والمشترون' },
  logistics: { 'parties.customers': 'عملاء النقل' },
  lab: { 'parties.customers': 'جهات التعاقد' },
  clinic: { 'parties.customers': 'جهات التعاقد' },
  laundry: { 'parties.customers': 'الزبائن' },
  jewelry: { 'parties.customers': 'الزبائن' },
  household: { 'parties.customers': 'الزبائن' },
  building_materials: { 'parties.customers': 'العملاء والمقاولون' },
}

/** مسمى مفتاح لنشاط — أو الاسم الافتراضي الممرر */
export function labelFor(activityId: string | null, key: string, fallback: string): string {
  if (!activityId) return fallback
  const labels = ACTIVITY_LABELS[activityId]
  return (labels?.[key as LabelKey]) ?? fallback
}
