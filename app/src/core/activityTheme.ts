/**
 * حزمة الهوية البصرية لكل نشاط (قرار المالك — نقاش بند 11):
 * لكل نشاط: لون + شخصية بطاقات (فاخر/نظيف/دافئ/صناعي) + أيقونات ترحيب +
 * نمط كاشير (شبكة صور للمطاعم، قائمة سريعة للبقالة، بطاقات تفصيلية للموبايل) +
 * ويدجات لوحة معلومات مخصصة (مواعيد اليوم للعيادة، الرحلات النشطة للوجستيات...).
 * نواة خالصة — الواجهات تقرأ منها فقط.
 */

/** شخصية البطاقات — تصبغ الحواف والظلال والخلفيات في كل التطبيق */
export type CardPersona =
  | 'fresh' // طازج ونظيف — بقالة/مغسلة: زوايا كبيرة وألوان مشبعة
  | 'tech' // تقني رشيق — موبايل/إلكترونيات: حواف حادة وتدرجات باردة
  | 'luxury' // فاخر داكن — مجوهرات/معارض سيارات: ذهبي على خلفيات عميقة
  | 'clinical' // طبي مطمئن — صيدلية/عيادة/معمل: أبيض ناصع ومساحات هادئة
  | 'warm' // دافئ شهي — مطاعم/كافيهات: برتقالي وكريمي
  | 'industrial' // صناعي متين — مقاولات/معدات/قطع غيار/لوجستيات: خطوط قوية
  | 'boutique' // أنيق عصري — ملابس: فوشيا وتباين جريء
  | 'butcher' // جزارة حِرفية — أحمر لحمي دافئ على خشب وستانلس: طزاجة وثقة
  | 'oasis' // واحة التمور — عنبري ونخلي: ذهب صحراوي وكرم عربي

/** نمط شاشة الكاشير */
export type PosLayout =
  | 'visual_grid' // شبكة بطاقات صور كبيرة — مطعم/كافيه/ملابس
  | 'fast_list' // قائمة كثيفة سريعة بتركيز باركود — بقالة/صيدلية
  | 'detail_cards' // بطاقات تفصيلية (سيريال/ضمان/موديل) — موبايل/إلكترونيات/قطع غيار

/** ويدجت لوحة معلومات تخصصية */
export type ActivityWidget =
  | 'today_appointments' // مواعيد اليوم — عيادة
  | 'active_trips' // رحلات نشطة — لوجستيات
  | 'open_tickets' // أذون صيانة مفتوحة — موبايل/إلكترونيات
  | 'open_rentals' // عقود إيجار سارية — معدات/سيارات
  | 'lab_pending' // تحاليل قيد التنفيذ — معمل
  | 'open_projects' // مشروعات جارية — مقاولات
  | 'kitchen_orders' // أوردرات المطبخ المفتوحة — مطعم
  | 'expiry_soon' // أصناف قرب انتهاء الصلاحية — بقالة/صيدلية
  | 'gold_position' // مركز الذهب (وزن المخزون) — مجوهرات
  | 'top_debtors' // أعلى المديونيات — عام
  | 'yield_today' // تصافي التقطيع/الفرز الأخير — جزارة وتمور

export interface ActivityTheme {
  persona: CardPersona
  posLayout: PosLayout
  /** أيقونات الترحيب في رأس لوحة المعلومات */
  heroEmoji: string
  /** جملة ترحيب بلغة النشاط نفسه */
  heroLineAr: string
  /** ويدجات اللوحة بترتيب الأهمية (أول 2-3 تُعرض) */
  widgets: ActivityWidget[]
}

export const ACTIVITY_THEMES: Record<string, ActivityTheme> = {
  grocery: { persona: 'fresh', posLayout: 'fast_list', heroEmoji: '🥬', heroLineAr: 'بضاعة طازجة وحساب مضبوط', widgets: ['expiry_soon', 'top_debtors'] },
  pharmacy: { persona: 'clinical', posLayout: 'fast_list', heroEmoji: '💊', heroLineAr: 'دواء سليم وصلاحية مراقبة', widgets: ['expiry_soon', 'top_debtors'] },
  mobile: { persona: 'tech', posLayout: 'detail_cards', heroEmoji: '📱', heroLineAr: 'أجهزة وصيانة وسيريالات مضبوطة', widgets: ['open_tickets', 'top_debtors'] },
  electronics: { persona: 'tech', posLayout: 'detail_cards', heroEmoji: '🔌', heroLineAr: 'أجهزة موثوقة وضمانات موثقة', widgets: ['open_tickets', 'top_debtors'] },
  spare_parts: { persona: 'industrial', posLayout: 'detail_cards', heroEmoji: '🔧', heroLineAr: 'القطعة الصح لكل موديل', widgets: ['top_debtors'] },
  clothing: { persona: 'boutique', posLayout: 'visual_grid', heroEmoji: '👗', heroLineAr: 'موضة ومقاسات وألوان تلمع', widgets: ['top_debtors'] },
  restaurant: { persona: 'warm', posLayout: 'visual_grid', heroEmoji: '🍽️', heroLineAr: 'أطباق شهية وأوردرات طايرة', widgets: ['kitchen_orders', 'top_debtors'] },
  jewelry: { persona: 'luxury', posLayout: 'detail_cards', heroEmoji: '💎', heroLineAr: 'ذهب موزون وعيارات مضبوطة', widgets: ['gold_position', 'top_debtors'] },
  cars: { persona: 'luxury', posLayout: 'detail_cards', heroEmoji: '🚘', heroLineAr: 'معرضك يلمع وصفقاتك موثقة', widgets: ['open_rentals', 'top_debtors'] },
  clinic: { persona: 'clinical', posLayout: 'fast_list', heroEmoji: '🩺', heroLineAr: 'مرضاك في أمان ومواعيدك منظمة', widgets: ['today_appointments', 'top_debtors'] },
  lab: { persona: 'clinical', posLayout: 'fast_list', heroEmoji: '🔬', heroLineAr: 'نتائج دقيقة وعمولات محسوبة', widgets: ['lab_pending', 'top_debtors'] },
  logistics: { persona: 'industrial', posLayout: 'fast_list', heroEmoji: '🚚', heroLineAr: 'رحلاتك ماشية وعهدك مظبوطة', widgets: ['active_trips', 'top_debtors'] },
  contracting: { persona: 'industrial', posLayout: 'fast_list', heroEmoji: '🏗️', heroLineAr: 'مشروعاتك بمستخلصات دقيقة', widgets: ['open_projects', 'top_debtors'] },
  equipment_rental: { persona: 'industrial', posLayout: 'detail_cards', heroEmoji: '🚜', heroLineAr: 'معداتك شغالة وعقودك سارية', widgets: ['open_rentals', 'top_debtors'] },
  laundry: { persona: 'fresh', posLayout: 'fast_list', heroEmoji: '🧺', heroLineAr: 'نظافة تلمع وتسليم في الميعاد', widgets: ['top_debtors'] },
  butcher: { persona: 'butcher', posLayout: 'fast_list', heroEmoji: '🥩', heroLineAr: 'ذبايح طازجة وميزان أمين وتصافي مضبوط', widgets: ['yield_today', 'expiry_soon', 'top_debtors'] },
  dates: { persona: 'oasis', posLayout: 'visual_grid', heroEmoji: '🌴', heroLineAr: 'خير النخيل مفروز ومعبأ بكرم عربي', widgets: ['yield_today', 'expiry_soon', 'top_debtors'] },
  salon: { persona: 'boutique', posLayout: 'visual_grid', heroEmoji: '💈', heroLineAr: 'زبونك يخرج أشيك مما دخل', widgets: ['top_debtors'] },
  bakery: { persona: 'warm', posLayout: 'visual_grid', heroEmoji: '🥐', heroLineAr: 'فرنك ولّاع وطلباتك سخنة', widgets: ['expiry_soon', 'top_debtors'] },
  realestate: { persona: 'industrial', posLayout: 'fast_list', heroEmoji: '🏘️', heroLineAr: 'عقاراتك مؤجرة وأقساطك في مواعيدها', widgets: ['top_debtors'] },
  trading: { persona: 'industrial', posLayout: 'fast_list', heroEmoji: '📦', heroLineAr: 'بضاعتك ماشية وذممك مضبوطة', widgets: ['top_debtors'] },
  manufacturing: { persona: 'industrial', posLayout: 'fast_list', heroEmoji: '🏭', heroLineAr: 'خطوط إنتاجك شغالة وتكلفتك محسوبة', widgets: ['top_debtors'] },
  services: { persona: 'clinical', posLayout: 'fast_list', heroEmoji: '🧾', heroLineAr: 'خدماتك موثقة وفواتيرك محصلة', widgets: ['top_debtors'] },
  stationery: { persona: 'fresh', posLayout: 'fast_list', heroEmoji: '📚', heroLineAr: 'مكتبتك عامرة وخدمة الطالب جاهزة', widgets: ['top_debtors'] },
  herbalist: { persona: 'oasis', posLayout: 'fast_list', heroEmoji: '🌿', heroLineAr: 'أعشابك موزونة وخلطاتك مضبوطة', widgets: ['expiry_soon', 'top_debtors'] },
  building_materials: { persona: 'industrial', posLayout: 'fast_list', heroEmoji: '🧱', heroLineAr: 'موادك بالطن والشيكارة وآجالك موثقة', widgets: ['top_debtors'] },
  household: { persona: 'fresh', posLayout: 'fast_list', heroEmoji: '🧴', heroLineAr: 'رفوفك مرتبة وبيعك سريع', widgets: ['expiry_soon', 'top_debtors'] },
  general: { persona: 'fresh', posLayout: 'fast_list', heroEmoji: '🏪', heroLineAr: 'تجارتك كلها تحت السيطرة', widgets: ['top_debtors'] },
}

/** هوية النشاط — نشاط مجهول ⇒ العام */
export function themeForActivity(activityId: string | null | undefined): ActivityTheme {
  return (activityId && ACTIVITY_THEMES[activityId]) || ACTIVITY_THEMES.general
}

/** أصناف CSS لكل شخصية — تُطبق على بطاقات لوحة المعلومات والحاويات الرئيسية */
export const PERSONA_STYLES: Record<CardPersona, {
  nameAr: string
  /** حاوية البطاقة البيضاء الاعتيادية */
  card: string
  /** رأس الترحيب في لوحة المعلومات */
  hero: string
  /** نص وصف الشخصية (لشاشة المظهر) */
  descAr: string
}> = {
  fresh: {
    nameAr: 'طازج ونظيف',
    card: 'rounded-3xl border-emerald-500/15 shadow-emerald-500/5',
    hero: 'from-emerald-500/15 via-teal-500/10 to-transparent border-emerald-500/20',
    descAr: 'زوايا كبيرة وألوان مشبعة تناسب الأغذية والخدمات اليومية',
  },
  tech: {
    nameAr: 'تقني رشيق',
    card: 'rounded-xl border-sky-500/15 shadow-sky-500/5',
    hero: 'from-sky-500/15 via-indigo-500/10 to-transparent border-sky-500/20',
    descAr: 'حواف مشدودة وتدرجات باردة للأجهزة والتقنية',
  },
  luxury: {
    nameAr: 'فاخر',
    card: 'rounded-2xl border-amber-400/25 shadow-amber-500/10',
    hero: 'from-amber-500/20 via-yellow-600/10 to-transparent border-amber-400/30',
    descAr: 'لمسات ذهبية وظلال عميقة للمجوهرات والمعارض',
  },
  clinical: {
    nameAr: 'طبي مطمئن',
    card: 'rounded-2xl border-cyan-500/15 shadow-cyan-500/5',
    hero: 'from-cyan-500/12 via-sky-500/8 to-transparent border-cyan-500/20',
    descAr: 'بياض ناصع ومساحات هادئة للعيادات والصيدليات',
  },
  warm: {
    nameAr: 'دافئ شهي',
    card: 'rounded-3xl border-orange-500/20 shadow-orange-500/8',
    hero: 'from-orange-500/18 via-amber-500/10 to-transparent border-orange-500/25',
    descAr: 'برتقالي وكريمي يفتح الشهية للمطاعم والكافيهات',
  },
  industrial: {
    nameAr: 'صناعي متين',
    card: 'rounded-xl border-slate-500/20 shadow-slate-500/5',
    hero: 'from-slate-500/15 via-zinc-500/8 to-transparent border-slate-500/25',
    descAr: 'خطوط قوية وحسم للمقاولات والمعدات والنقل',
  },
  boutique: {
    nameAr: 'أنيق عصري',
    card: 'rounded-3xl border-fuchsia-500/15 shadow-fuchsia-500/8',
    hero: 'from-fuchsia-500/15 via-pink-500/8 to-transparent border-fuchsia-500/25',
    descAr: 'تباين جريء وحيوية تناسب الأزياء',
  },
  butcher: {
    nameAr: 'جزارة حِرفية',
    card: 'rounded-2xl border-red-600/20 shadow-red-600/8',
    hero: 'from-red-600/18 via-rose-500/10 to-transparent border-red-600/25',
    descAr: 'أحمر لحمي دافئ يوحي بالطزاجة والحِرفة — للجزارات ومحلات اللحوم',
  },
  oasis: {
    nameAr: 'واحة التمور',
    card: 'rounded-2xl border-yellow-700/25 shadow-yellow-700/10',
    hero: 'from-yellow-700/20 via-amber-600/12 to-transparent border-yellow-700/30',
    descAr: 'عنبري صحراوي بكرم النخيل — لمحلات التمور والتعبئة',
  },
}

/** عناوين الويدجات — الواجهة تحسب الأرقام من المخزن */
export const WIDGET_LABELS: Record<ActivityWidget, { titleAr: string; icon: string; route: string; emptyAr: string }> = {
  today_appointments: { titleAr: 'مواعيد اليوم', icon: '📅', route: '/clinic/appointments', emptyAr: 'لا مواعيد اليوم' },
  active_trips: { titleAr: 'رحلات نشطة', icon: '🚚', route: '/logistics/trips', emptyAr: 'لا رحلات جارية' },
  open_tickets: { titleAr: 'أذون صيانة مفتوحة', icon: '🛠️', route: '/maintenance/tickets', emptyAr: 'لا أذون مفتوحة' },
  open_rentals: { titleAr: 'عقود إيجار سارية', icon: '📋', route: '/rental/contracts', emptyAr: 'لا عقود سارية' },
  lab_pending: { titleAr: 'تحاليل قيد التنفيذ', icon: '🧪', route: '/lab/orders', emptyAr: 'لا تحاليل معلقة' },
  open_projects: { titleAr: 'مشروعات جارية', icon: '🏗️', route: '/contracting/projects', emptyAr: 'لا مشروعات جارية' },
  kitchen_orders: { titleAr: 'أوردرات مفتوحة', icon: '🔥', route: '/sales/restaurant-orders', emptyAr: 'لا أوردرات مفتوحة' },
  expiry_soon: { titleAr: 'قرب انتهاء الصلاحية', icon: '⏳', route: '/inventory/items', emptyAr: 'لا أصناف قرب الانتهاء' },
  gold_position: { titleAr: 'مركز الذهب', icon: '⚖️', route: '/inventory/jewelry', emptyAr: 'لا مخزون ذهب' },
  top_debtors: { titleAr: 'أعلى المديونيات', icon: '💳', route: '/reports/statements', emptyAr: 'لا مديونيات — ممتاز' },
  yield_today: { titleAr: 'آخر تصافي تجهيز', icon: '⚖️', route: '/inventory/processing', emptyAr: 'لا أوامر تجهيز بعد' },
}
