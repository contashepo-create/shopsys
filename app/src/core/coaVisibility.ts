/**
 * فلترة شجرة الحسابات حسب النشاط — نواة خالصة (أمر المالك):
 * ─────────────────────────────────────────────────────────
 * «حتى شجرة الحسابات لا تظهر فيها أسماء حسابات نشاط آخر لا يخص النشاط المختار»
 *
 * القاعدة: كل حساب تخصصي مربوط بوحدات العمل التي تحتاجه — يظهر فقط إن كانت
 * إحداها مفعلة للنشاط. الحسابات العامة (خزينة/عملاء/موردون/رواتب…) تظهر دائماً.
 *
 * صمام أمان (سلامة البيانات): حساب عليه حركة فعلية في اليومية يظل ظاهراً حتى
 * لو أُطفئت وحدته لاحقاً عبر مفتاح المطوّر — كي لا يختفي رصيد حي من الشجرة
 * والميزان وكشوف الحساب.
 *
 * المرجعية العالمية: QuickBooks وXero يبنيان الشجرة حسب نوع النشاط عند
 * الإنشاء (industry-specific chart of accounts) — نفس المبدأ هنا لكن حيّاً.
 */
import type { Account } from './ledger.ts'
import type { BusinessModule, ItemFeature } from './activities.ts'
import { INVOICE_FIRST_ACTIVITIES } from './activities.ts'

/**
 * حساب → وحدات العمل التي تخصه (يكفي واحدة مفعلة ليظهر).
 * الحساب غير المذكور هنا = عام يظهر لكل الأنشطة.
 */
export const ACCOUNT_MODULE_MAP: Record<string, BusinessModule[]> = {
  // مخزونية — تختفي للأنشطة بلا مخزون إطلاقاً (لوجستيات/معمل/عيادة/عقارات…)
  '1103': ['inventory'],
  '5101': ['inventory'],
  '5111': ['inventory'],
  '5114': ['inventory'],
  // مبيعات الكاشير والفواتير — أنشطة البيع فقط (معرض السيارات يقيد بيعه على 4101 أيضاً)
  '4101': ['pos', 'cars', 'jewelry'],
  '4102': ['pos'],
  '5115': ['pos'], // مصروف برنامج الولاء — نقاط الكاشير
  // مقاولات
  '1105': ['contracting'], // محتجزات ضمان أعمال
  '1109': ['contracting'], // هوامش خطابات الضمان
  '1111': ['contracting'], // دفعات مقدمة لمقاولي الباطن
  '2108': ['contracting'], // محتجزات مقاولي الباطن
  '2112': ['contracting'], // ضريبة استقطاع مقاولي الباطن
  '4107': ['contracting'], // إيرادات مقاولات
  '5110': ['contracting'], // تكاليف مشروعات
  // معمل التحاليل والعيادة
  '1110': ['lab', 'clinic'], // مطالبات جهات تأمين وتعاقد
  '2105': ['lab'], // عمولات أطباء مستحقة
  '4106': ['lab'], // إيرادات تحاليل طبية
  '5109': ['lab'], // عمولات أطباء محيلين
  '4108': ['clinic'], // إيرادات كشف وعلاج
  // عقارات
  '1113': ['realestate'], // عقارات مملوكة
  '2115': ['realestate'], // مستحق لملاك العقارات المدارة
  '4113': ['realestate'], // إيرادات إيجار عقارات
  '4114': ['realestate'], // سعي وعمولات إدارة أملاك
  '4115': ['realestate'], // إيرادات بيع عقارات
  '5116': ['realestate'], // تكلفة عقارات مباعة
  // تأجير معدات وسيارات
  '2103': ['equipment_rental', 'realestate', 'cars'], // تأمينات مستردة
  '4104': ['equipment_rental', 'cars'], // إيرادات إيجار معدات
  '5105': ['equipment_rental', 'cars'], // مصروفات تشغيل معدات
  // معرض سيارات
  '2110': ['cars'], // مستحق لملاك سيارات الأمانة
  '4109': ['cars'], // عمولات بيع بالأمانة
  // لوجستيات
  '2111': ['logistics'], // مستحقات سائقين
  '2113': ['logistics'], // مصروفات نقلات مستحقة
  '4105': ['logistics'], // إيرادات نقلات
  '5106': ['logistics'], // مصروفات نقلات
  // أقساط
  '4111': ['installments'], // أرباح تقسيط
  // خدمات وصيانة — أي وحدة تبيع خدمة (بما فيها كاشير أنشطة الخدمات كأصناف isService)
  '4103': ['maintenance', 'laundry', 'wallet_services', 'pos', 'clinic', 'lab', 'logistics'],
}

/**
 * تسمية الحساب حسب النشاط (أمر المالك): «مسمى كل بند حسب النشاط» —
 * نفس الكود المحاسبي لكن الاسم يواكب سياق النشاط المفعل.
 */
const NAME_OVERRIDES: Record<string, (modules: readonly BusinessModule[]) => string> = {
  '4103': (m) => (m.includes('maintenance') ? 'إيرادات صيانة وخدمات' : 'إيرادات خدمات'),
  '5103': (m) => (m.includes('pos') || m.includes('inventory') ? 'إيجار المحل' : 'إيجار المقر'),
  '1104': (m) => (m.includes('clinic') || m.includes('lab') ? 'العملاء والمرضى (المدينون)' : 'العملاء (المدينون)'),
}

/** أكواد الحسابات التي عليها حركة فعلية — صمام أمان الشجرة */
export function usedAccountCodes(journal: readonly { lines: readonly { accountCode: string }[] }[]): Set<string> {
  const s = new Set<string>()
  for (const e of journal) for (const l of e.lines) s.add(l.accountCode)
  return s
}

/**
 * الشجرة الظاهرة لنشاطٍ ما:
 * - حساب عام ⇒ يظهر دائماً
 * - حساب تخصصي ⇒ يظهر إن كانت إحدى وحداته مفعلة أو عليه حركة (صمام الأمان)
 * - الأسماء تُواءم مع النشاط (NAME_OVERRIDES)
 * - أب لا يملك أي ابن ظاهر (ولا هو ورقي مستخدم) يختفي معهم
 */
export function coaForModules(
  base: readonly Account[],
  modules: readonly BusinessModule[],
  usedCodes?: ReadonlySet<string>,
): Account[] {
  const visible = base.filter((a) => {
    const req = ACCOUNT_MODULE_MAP[a.code]
    if (!req) return true
    if (usedCodes?.has(a.code)) return true
    return req.some((m) => modules.includes(m))
  }).map((a) => {
    const ov = NAME_OVERRIDES[a.code]
    const name = ov ? ov(modules) : a.nameAr
    return name === a.nameAr ? a : { ...a, nameAr: name }
  })
  // إخفاء الآباء اليتامى: أب غير ورقي كل أبنائه اختفوا (مثل «12 الأصول الثابتة» يبقى لوجود 1201)
  const codes = new Set(visible.map((a) => a.code))
  return visible.filter((a) => {
    if (a.isPostable) return true
    return visible.some((c) => c.parentCode === a.code && codes.has(c.code))
  })
}

/* ─── حراسة المسارات حسب الوحدات (سد ثغرة الرابط المباشر) ───
 * القائمة الجانبية تخفي الشاشات غير المفعلة، لكن المسار المباشر كان يفتحها
 * لمن يملك الصلاحية — هذه الخريطة تسد الثغرة في حارس App.tsx نفسه.
 */
export interface ModuleRoute {
  prefix: string
  module?: BusinessModule
  feature?: ItemFeature
  /** حصر بنشاط بعينه (أوامر الطاولات للمطاعم فقط) */
  activities?: string[]
  /** حجب عن أنشطة بعينها (الكاشير عن أنشطة «الفاتورة أولاً») */
  hideForActivities?: readonly string[]
}

export const MODULE_ROUTES: ModuleRoute[] = [
  // /pos متاح أيضاً لأنشطة «الفاتورة أولاً» — هي شاشة إنشاء فواتيرهم (بمسمى مختلف)
  { prefix: '/pos', module: 'pos' },
  { prefix: '/sales/restaurant-orders', module: 'recipes', activities: ['restaurant'] },
  { prefix: '/sales/price-lists', module: 'pos', feature: 'price_lists' },
  { prefix: '/sales/exchange', module: 'pos', hideForActivities: INVOICE_FIRST_ACTIVITIES },
  { prefix: '/sales/shifts', module: 'pos', hideForActivities: INVOICE_FIRST_ACTIVITIES },
  { prefix: '/sales', module: 'pos' },
  { prefix: '/inventory/recipes', module: 'recipes' },
  { prefix: '/inventory/processing', module: 'processing' },
  { prefix: '/inventory/jewelry', module: 'jewelry' },
  { prefix: '/inventory/scale', module: 'inventory', feature: 'weight_scale' },
  { prefix: '/inventory/serials', module: 'inventory', feature: 'serial_warranty' },
  { prefix: '/inventory/barcode-center', module: 'pos' },
  { prefix: '/inventory', module: 'inventory' },
  { prefix: '/purchases', module: 'purchases' },
  { prefix: '/parties/installments', module: 'installments' },
  { prefix: '/maintenance', module: 'maintenance' },
  { prefix: '/laundry', module: 'laundry' },
  { prefix: '/wallets', module: 'wallet_services' },
  { prefix: '/rental', module: 'equipment_rental' },
  { prefix: '/realestate', module: 'realestate' },
  { prefix: '/logistics', module: 'logistics' },
  { prefix: '/lab', module: 'lab' },
  { prefix: '/contracting', module: 'contracting' },
  { prefix: '/clinic', module: 'clinic' },
  { prefix: '/cars', module: 'cars' },
]

/** هل هذا المسار مسموح لهذا النشاط (وحداته وخصائصه)؟ مطابقة بأطول بادئة */
export function pathAllowedForSetup(
  path: string,
  modules: readonly BusinessModule[],
  features: readonly ItemFeature[],
  activityId: string | null,
): boolean {
  const hit = MODULE_ROUTES
    .filter((r) => path === r.prefix || path.startsWith(r.prefix + '/'))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0]
  if (!hit) return true
  if (hit.module && !modules.includes(hit.module)) return false
  if (hit.feature && !features.includes(hit.feature)) return false
  if (hit.activities && !hit.activities.includes(activityId ?? '')) return false
  if (hit.hideForActivities && hit.hideForActivities.includes(activityId ?? '')) return false
  return true
}
