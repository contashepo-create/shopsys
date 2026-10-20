/**
 * قوالب الأنشطة ونظام الخصائص — ShopSys
 * (وثيقة التصميم — القرار 5 + القسم 6)
 * النشاط قالب افتراضي فقط: يضبط خصائص الأصناف ووحدات العمل الافتراضية،
 * وكل خاصية تبقى قابلة للتفعيل على مستوى القسم/الصنف لاحقاً.
 */

export type ItemFeature =
  | 'expiry_batches' // صلاحية + دفعات + FEFO
  | 'serial_warranty' // سيريال/IMEI + ضمان
  | 'variants' // لون/مقاس/خامة
  | 'weight_scale' // بيع بالوزن + باركود ميزان
  | 'multi_unit' // وحدات متعددة
  | 'price_lists' // قوائم أسعار

export type BusinessModule =
  | 'pos' // الكاشير
  | 'inventory' // المخزون والمخازن — وحدة نواة في كل الأنشطة (قطع غيار/مستهلكات/خامات)
  | 'purchases' // المشتريات والموردون
  | 'maintenance' // الصيانة
  | 'equipment_rental' // إيجار المعدات
  | 'logistics' // الخدمات اللوجستية
  | 'lab' // معامل التحاليل الطبية (القرار 26)
  | 'contracting' // محاسبة المقاولات (القرار 27)
  | 'clinic' // عيادات الأطباء وملفات المرضى (القرار 27)
  | 'cars' // معارض بيع وإيجار السيارات (القرار 27)
  | 'restaurant' // شاشات صالة المطعم (أوامر الطاولات/الصالة وتقاريرها) — مستقلة عن
                  // «recipes» المشتركة مع مخبز/مصنع/بقالة ليس لها شاشات طاولات
  | 'installments' // الأقساط
  | 'recipes' // الوصفات والتصنيع (مطاعم/مخابز)
  | 'jewelry' // الصاغة: سعر الجرام اليومي والمصنعية والكسر
  | 'wallet_services' // خدمات المحافظ والدفع الإلكتروني (نمط mobileshop): ربح = المحصَّل − المدفوع للمزوّد
  | 'laundry' // المغاسل: أوامر غسيل بقطع وخدمات وعربون (وحدة مستقلة — ليست صيانة)
  | 'booking' // المواعيد والحجوزات (سد الفجوة العالمية 1 — نمط Fresha/Booksy): صالون/معمل/مغسلة
  | 'processing' // التجهيز والتفكيك: ذبيحة→أجزاء (جزارة) أو محصول→درجات (تمور) بتوزيع تكلفة بالقيمة البيعية
  | 'realestate' // العقارات: إيجار وبيع وإدارة أملاك بسعي (خصوصاً السعودية — سند/الوسيط/سمات)

export interface ActivityTemplate {
  id: string
  nameAr: string
  icon: string
  description: string
  features: ItemFeature[]
  modules: BusinessModule[]
  /** الافتراضي لطريقة الضريبة: شامل أم مضاف (القرار 6) */
  taxInclusiveDefault: boolean
  /** قالب الفاتورة الافتراضي: حراري للبيع السريع، A4 للخدمات والعقود */
  defaultInvoiceTemplate: 'thermal' | 'a4'
}

/**
 * ─── سياسة النواة الموحّدة (أمر المالك، 2026-10-11) ───
 * «اجعل لكل الأنشطة مخزوناً ومشتريات وموردين، ولكن كل نشاط مبيعاته كما هي».
 *
 * السبب الهندسي: كل محركات القيود تحتاج أصنافاً ومخزناً وتكلفة (حتى لو «مستهلكات
 * تشغيل» أو «قطع غيار معدة» أو «مستلزمات معمل»)، وكل نشاط يشتري من موردين ولو
 * نادراً. إخفاء الوحدة كان يفتح ثقوباً: منح «كاشير» لنشاط بلا مخزون يعطيه شاشة
 * بيع بلا شاشة أصناف، ويرحّل على 1103/5101/5111 مخفية.
 *
 * ما لا يتغيّر: **أسلوب المبيعات يبقى كما هو لكل نشاط** — من لا يملك `pos` لا
 * كاشير له ولا ورديات ولا استبدال (يبيع بفواتيره أو بمحركه التخصصي)، وحسابات
 * إيراده تبقى حصرية لوحدته (`4106` للمعمل، `4107` للمقاولات، `4108` للعيادة…) —
 * فلا يظهر «إيراد مبيعات» لنشاط لا يبيع بالكاشير.
 *
 * لذلك: `inventory` و`purchases` تُضافان تلقائياً لكل قالب عبر `withCoreModules`
 * (قائمة صريحة واحدة، لا تكرار في 29 موضعاً)، وتبقى القوالب قابلة للإطفاء من
 * الإعدادات إن أراد صاحب النشاط تبسيط شاشته.
 */
const CORE_MODULES: readonly BusinessModule[] = ['inventory', 'purchases']

/** يضمن وجود وحدتَي النواة (مخزون + مشتريات/موردون) في أي قالب نشاط */
function withCoreModules(tpl: ActivityTemplate): ActivityTemplate {
  const missing = CORE_MODULES.filter((m) => !tpl.modules.includes(m))
  if (!missing.length) return tpl
  /* الإدراج في موضعه المعياري من ALL_MODULES_ORDER لا في النهاية: فترتيب الوحدات
     هو ترتيب الأقسام في الشاشة والإعدادات، ونفسه يُفحَص في بوابة اكتمال الأنشطة */
  const ordered = [...tpl.modules]
  for (const m of missing) {
    const canonical = ALL_MODULES_ORDER.indexOf(m)
    const at = ordered.findIndex((x) => ALL_MODULES_ORDER.indexOf(x) > canonical)
    if (at === -1) ordered.push(m)
    else ordered.splice(at, 0, m)
  }
  return { ...tpl, modules: ordered }
}

/** ترتيب الوحدات المعياري (يُستخدم للتطبيع والعرض) — القائمة الكاملة في نهاية الملف */
const ALL_MODULES_ORDER: readonly BusinessModule[] = [
  'pos', 'inventory', 'purchases', 'installments', 'recipes', 'restaurant', 'processing', 'jewelry',
  'maintenance', 'laundry', 'booking', 'equipment_rental', 'logistics', 'lab',
  'contracting', 'clinic', 'cars', 'wallet_services', 'realestate',
]

const ACTIVITY_TEMPLATE_SEED: ActivityTemplate[] = [
  {
    id: 'grocery', nameAr: 'أغذية / سوبر ماركت', icon: '🛒',
    description: 'صلاحيات ودفعات، بيع بالوزن، وحدات متعددة',
    features: ['expiry_batches', 'weight_scale', 'multi_unit', 'price_lists'],
    // مراجعة سطرية (طلب المالك): لا أقساط في بيع الأغذية — الوحدة تُفعَّل بالمفتاح لو احتاجها أحد
    // السوبر ماركت قد يضم مخبزاً/مطبخاً/تعبئة داخلية؛ الوحدة متاحة افتراضياً ويمكن تعطيلها.
    modules: ['pos', 'inventory', 'purchases', 'recipes'],
    taxInclusiveDefault: true, defaultInvoiceTemplate: 'thermal',
  },
  {
    id: 'feed_trade', nameAr: 'تجارة الأعلاف والحبوب', icon: '🌾',
    description: 'أعلاف وحبوب بالوزن والجوال والطن، تشغيلات وصلاحيات وقوائم أسعار جملة',
    features: ['expiry_batches', 'weight_scale', 'multi_unit', 'price_lists'],
    modules: ['pos', 'inventory', 'purchases', 'recipes'],
    taxInclusiveDefault: true, defaultInvoiceTemplate: 'a4',
  },
  {
    id: 'mobile', nameAr: 'موبايلات وصيانة', icon: '📱',
    description: 'سيريال/IMEI وضمان، وحدة صيانة كاملة',
    features: ['serial_warranty', 'variants'],
    modules: ['pos', 'inventory', 'purchases', 'maintenance', 'installments', 'wallet_services'],
    taxInclusiveDefault: true, defaultInvoiceTemplate: 'thermal',
  },
  {
    id: 'clothing', nameAr: 'ملابس وأحذية', icon: '👕',
    description: 'ألوان ومقاسات، مخازن موسمية',
    features: ['variants', 'multi_unit', 'price_lists'],
    modules: ['pos', 'inventory', 'purchases', 'installments'],
    taxInclusiveDefault: true, defaultInvoiceTemplate: 'thermal',
  },
  {
    id: 'pharmacy', nameAr: 'صيدلية', icon: '💊',
    description: 'صلاحية إلزامية، شريط/علبة',
    features: ['expiry_batches', 'multi_unit'],
    modules: ['pos', 'inventory', 'purchases'],
    taxInclusiveDefault: true, defaultInvoiceTemplate: 'thermal',
  },
  {
    id: 'electronics', nameAr: 'أجهزة كهربائية', icon: '🔌',
    description: 'سيريال وضمان، أقساط',
    features: ['serial_warranty', 'multi_unit'],
    // مراجعة سطرية (طلب المالك): خدمات المحافظ تخص محلات الموبايل لا معارض الأجهزة
    modules: ['pos', 'inventory', 'purchases', 'maintenance', 'installments'],
    taxInclusiveDefault: false, defaultInvoiceTemplate: 'a4',
  },
  {
    id: 'spare_parts', nameAr: 'قطع غيار', icon: '🔧',
    description: 'سيريال اختياري، وحدات متعددة',
    features: ['serial_warranty', 'multi_unit', 'price_lists'],
    modules: ['pos', 'inventory', 'purchases'],
    taxInclusiveDefault: false, defaultInvoiceTemplate: 'thermal',
  },
  {
    id: 'equipment_rental', nameAr: 'إيجار معدات ثقيلة', icon: '🚜',
    description: 'حفارات ولوادر — عقود، عدّادات، ربحية كل معدة، وقطع غيار ومستهلكات في المخزن',
    features: ['multi_unit'],
    modules: ['equipment_rental', 'installments'],
    taxInclusiveDefault: false, defaultInvoiceTemplate: 'a4',
  },
  {
    id: 'logistics', nameAr: 'خدمات لوجستية ونقل', icon: '🚚',
    description: 'نقلات، أسطول وسائقون، مستخلصات، وقطع غيار وسولار في المخزن (بلا كاشير افتراضياً)',
    features: [],
    modules: ['logistics'],
    taxInclusiveDefault: false, defaultInvoiceTemplate: 'a4',
  },
  {
    id: 'lab', nameAr: 'معمل تحاليل طبية', icon: '🔬',
    description: 'مرضى وفحوصات ونطاقات مرجعية، عمولات أطباء محيلين، ومستلزمات ومحاليل في المخزن (بلا كاشير)',
    features: [],
    modules: ['lab', 'booking'],
    taxInclusiveDefault: false, defaultInvoiceTemplate: 'a4',
  },
  {
    id: 'contracting', nameAr: 'مقاولات وإنشاءات', icon: '🏗️',
    description: 'مشروعات ومستخلصات ومحتجزات، تكاليف ببنود وربحية كل مشروع',
    features: [],
    // المخزون والمشتريات وحدتان أساسيتان للمقاولات (أمر المالك):
    // شراء مواد للمخزن (1103) ← إذن صرف لمشروع (5110/1103) — بدونهما
    // شاشة أذون الصرف تبقى بلا أصناف والدورة مقطوعة من أولها
    modules: ['contracting', 'inventory', 'purchases'],
    taxInclusiveDefault: false, defaultInvoiceTemplate: 'a4',
  },
  {
    id: 'clinic', nameAr: 'عيادة طبية', icon: '🩺',
    description: 'ملف لكل مريض، زيارات بملاحظات وقيمة، خطط علاج بجلسات ومواعيد',
    features: [],
    modules: ['clinic'],
    taxInclusiveDefault: false, defaultInvoiceTemplate: 'a4',
  },
  {
    id: 'cars', nameAr: 'معرض سيارات (بيع وإيجار)', icon: '🚗',
    description: 'كل سيارة بتكلفتها وربحيتها، تجهيزات ترسمل، والإيجار بعقود وعدّاد',
    features: [],
    modules: ['cars', 'equipment_rental', 'installments'],
    taxInclusiveDefault: false, defaultInvoiceTemplate: 'a4',
  },
  {
    id: 'restaurant', nameAr: 'مطعم / كافيه', icon: '🍽️',
    description: 'بيع سريع بالكاشير، وصفات أطباق تخصم الخامات آلياً، مشتريات يومية',
    features: ['expiry_batches', 'multi_unit', 'weight_scale'],
    modules: ['pos', 'inventory', 'purchases', 'recipes', 'restaurant'],
    taxInclusiveDefault: true, defaultInvoiceTemplate: 'thermal',
  },
  {
    id: 'jewelry', nameAr: 'ذهب ومجوهرات', icon: '💍',
    description: 'سعر جرام يومي بالعيار، مصنعية منفصلة، كسر، فواتير موثقة',
    features: ['weight_scale', 'price_lists', 'variants'],
    modules: ['pos', 'inventory', 'purchases', 'jewelry'],
    taxInclusiveDefault: false, defaultInvoiceTemplate: 'a4',
  },
  {
    id: 'laundry', nameAr: 'مغسلة ملابس', icon: '🧺',
    description: 'أوامر غسيل بقطع وخدمات (غسيل/كي/دراي كلين) وعربون: استلام ← تجهيز ← تسليم وتحصيل',
    features: [],
    modules: ['laundry', 'booking'],
    taxInclusiveDefault: true, defaultInvoiceTemplate: 'thermal',
  },
  {
    id: 'butcher', nameAr: 'جزارة ولحوم', icon: '🥩',
    description: 'تقطيع ذبائح لأجزاء بتكلفة موزونة، بيع بالوزن، توثيق حلال وSFDA',
    features: ['expiry_batches', 'weight_scale', 'multi_unit', 'price_lists'],
    modules: ['pos', 'inventory', 'purchases', 'processing'],
    taxInclusiveDefault: true, defaultInvoiceTemplate: 'thermal',
  },
  {
    id: 'dates', nameAr: 'تمور وتعبئة', icon: '🌴',
    description: 'فرز محصول لدرجات وعبوات، مواسم وسنوات جني، بيع بالوزن وقوائم أسعار',
    features: ['expiry_batches', 'weight_scale', 'multi_unit', 'price_lists'],
    modules: ['pos', 'inventory', 'purchases', 'processing'],
    taxInclusiveDefault: true, defaultInvoiceTemplate: 'thermal',
  },
  {
    // نشاط جديد (توسعة الشراكة): أكثر نشاط خدمي انتشاراً في السوق العربي —
    // بيع خدمات (حلاقة/صبغة/عناية) كأصناف isService + بيع منتجات عناية
    // من المخزون + مواعيد وعمولات موظفين. المرجع العالمي: Fresha / Booksy.
    id: 'salon', nameAr: 'صالون حلاقة وتجميل', icon: '💈',
    description: 'خدمات بلا مخزون + منتجات عناية، مواعيد وعمولات موظفين',
    features: ['price_lists'],
    modules: ['pos', 'inventory', 'purchases', 'booking'],
    taxInclusiveDefault: true, defaultInvoiceTemplate: 'thermal',
  },
  {
    // نشاط جديد (توسعة الشراكة): المخابز والحلويات — إنتاج مسبق بوصفات
    // (recipes موجودة) + بيع بالوزن والقطعة + صلاحيات قصيرة وهوالك يومية.
    // المرجع العالمي: FlexiBake / Cybake.
    id: 'bakery', nameAr: 'مخبز وحلويات', icon: '🥐',
    description: 'إنتاج بوصفات، بيع بالوزن والقطعة، صلاحيات قصيرة وهوالك يومية',
    features: ['expiry_batches', 'weight_scale', 'multi_unit', 'price_lists'],
    modules: ['pos', 'inventory', 'purchases', 'recipes'],
    taxInclusiveDefault: true, defaultInvoiceTemplate: 'thermal',
  },
  {
    id: 'realestate', nameAr: 'عقارات وإدارة أملاك', icon: '🏘️',
    description: 'عقارات ووحدات، عقود إيجار بأقساط وتأمين مسترد وتوثيق إيجار، سعي أملاك الغير، وبيع عقارات، ومستلزمات صيانة الوحدات في المخزن (بلا كاشير)',
    features: [],
    // سد فجوة النشاط #21: الوصف أعلاه يَعِد بمخزن مستلزمات صيانة فعلي —
    // inventory/purchases بلا pos (بلا كاشير بيع للجمهور)، بنفس نمط
    // contracting (#11) الذي يتتبع مواد المقاولة بلا كاشير أيضاً.
    modules: ['realestate', 'inventory', 'purchases'],
    taxInclusiveDefault: false, defaultInvoiceTemplate: 'a4',
  },
  {
    // نشاط جديد (طلب المالك): شركة تجارة — شراء من موردين وبيع لعملاء بالجملة
    // والتجزئة، آجل بحدود ائتمان، قوائم أسعار للفئات، فواتير A4 وعروض أسعار.
    // المرجع العالمي: SAP Business One (Wholesale) / QuickBooks Commerce / دفترة توزيع.
    id: 'trading', nameAr: 'تجارة وتوزيع (جملة وقطاعي)', icon: '📦',
    description: 'شراء من موردين وبيع جملة وقطاعي بآجال وحدود ائتمان وقوائم أسعار — بلا كاشير سريع افتراضياً',
    features: ['multi_unit', 'price_lists'],
    modules: ['pos', 'inventory', 'purchases', 'installments'],
    taxInclusiveDefault: false, defaultInvoiceTemplate: 'a4',
  },
  {
    // نشاط جديد (طلب المالك): مصنع/ورشة إنتاج — خامات تُشترى وتُصنَّع بوصفات
    // (recipes معممة) والمنتج التام يُباع؛ تكلفة الناتج = خامات + تشغيل.
    // المرجع العالمي: Katana MRP / MRPeasy / odoo Manufacturing.
    id: 'manufacturing', nameAr: 'مصنع / ورشة إنتاج', icon: '🏭',
    description: 'شراء خامات وتصنيع بوصفات (مكونات + تكلفة تشغيل) وبيع منتج تام بتكلفة حقيقية',
    features: ['expiry_batches', 'multi_unit', 'price_lists'],
    modules: ['inventory', 'purchases', 'recipes', 'pos'],
    taxInclusiveDefault: false, defaultInvoiceTemplate: 'a4',
  },
  {
    // نشاط جديد (طلب المالك): شركة خدمية — أصناف خدمات (isService) بلا كمية مخزنية
    // فواتير خدمات آجلة وعقود ومقبوضات. المرجع العالمي: FreshBooks / Zoho Invoice.
    id: 'services', nameAr: 'شركة خدمات', icon: '🧾',
    description: 'بيع خدمات بلا مخزون: فواتير آجلة ونقدية، عملاء بحدود ائتمان، مصروفات وأرباح لكل فترة',
    features: ['price_lists'],
    // inventory ضرورية: شاشة «الأصناف» فيها هي مكان تعريف الخدمات (isService) نفسها
    modules: ['pos', 'inventory', 'purchases'],
    taxInclusiveDefault: false, defaultInvoiceTemplate: 'a4',
  },
  {
    // نشاط جديد (طلب المالك): مكتبة وخدمة طالب — منتجات (أدوات مكتبية) + خدمات
    // (تصوير/طباعة/تغليف كأصناف isService) في كاشير واحد سريع.
    // منتشر جداً في مصر — المرجع: تجربة المكتبات المحلية + نمط Square hybrid.
    id: 'stationery', nameAr: 'مكتبة وخدمة طالب', icon: '📚',
    description: 'منتجات مكتبية + خدمات تصوير وطباعة وتغليف في كاشير واحد — بيع سريع بالقطعة',
    features: ['multi_unit', 'price_lists'],
    modules: ['pos', 'inventory', 'purchases'],
    taxInclusiveDefault: true, defaultInvoiceTemplate: 'thermal',
  },
  {
    // نشاط جديد: عطارة وبهارات — منتشر في مصر والسعودية؛ بيع بالوزن (فرط)
    // ووحدات متعددة وخلطات بوصفات، صلاحيات للأعشاب المعبأة.
    id: 'herbalist', nameAr: 'عطارة وبهارات', icon: '🌿',
    description: 'بيع بالوزن والفرط، خلطات بوصفات، وحدات متعددة وصلاحيات للمعبأ',
    features: ['weight_scale', 'expiry_batches', 'multi_unit', 'price_lists'],
    modules: ['pos', 'inventory', 'purchases', 'recipes'],
    taxInclusiveDefault: true, defaultInvoiceTemplate: 'thermal',
  },
  {
    // نشاط جديد: مواد بناء وحدايد وبويات — منتشر جداً في مصر والسعودية؛
    // بيع جملة وقطاعي بوحدات متعددة (طن/شيكارة/متر) وآجل واسع للمقاولين.
    id: 'building_materials', nameAr: 'مواد بناء وحدايد وبويات', icon: '🧱',
    description: 'وحدات متعددة (طن/شيكارة/متر)، آجل للمقاولين بحدود ائتمان، تسليم ونقل',
    features: ['multi_unit', 'price_lists'],
    modules: ['pos', 'inventory', 'purchases', 'installments'],
    taxInclusiveDefault: true, defaultInvoiceTemplate: 'a4',
  },
  {
    // نشاط جديد: منظفات وأدوات منزلية — منتشر في مصر؛ بيع قطاعي سريع
    // ووحدات متعددة (كرتونة/قطعة) مع صلاحيات لبعض الأصناف.
    id: 'household', nameAr: 'منظفات وأدوات منزلية', icon: '🧴',
    description: 'قطاعي سريع بالباركود، وحدات متعددة (كرتونة/قطعة)، صلاحيات لبعض الأصناف',
    features: ['multi_unit', 'expiry_batches', 'price_lists'],
    modules: ['pos', 'inventory', 'purchases'],
    taxInclusiveDefault: true, defaultInvoiceTemplate: 'thermal',
  },
  {
    id: 'general', nameAr: 'نشاط عام / آخر', icon: '🏪',
    description: 'قالب مرن — فعّل ما تحتاجه لاحقاً',
    features: ['multi_unit'],
    modules: ['pos', 'inventory', 'purchases', 'installments'],
    taxInclusiveDefault: true, defaultInvoiceTemplate: 'thermal',
  },
]

/** القوالب النهائية: كل نشاط بمخزونه ومشترياته ومورديه (سياسة النواة الموحّدة أعلاه) */
export const ACTIVITY_TEMPLATES: ActivityTemplate[] = ACTIVITY_TEMPLATE_SEED.map(withCoreModules)

/** قالب نشاط بالمعرف — أو undefined */
export function getActivity(id: string | null): ActivityTemplate | undefined {
  return ACTIVITY_TEMPLATES.find((a) => a.id === id)
}

/**
 * أنشطة «الفاتورة أولاً» (سد فجوة — أمر المالك «لا يظهر قسم لا يخص النشاط»):
 * وحدة pos مفعلة لهم لأجل فواتير المبيعات والمرتجعات، لكن أسلوب عملهم
 * فواتير A4 بآجال لا كاشير سريع — لذا شاشة الكاشير والورديات والاستبدال
 * تختفي عندهم، وسياسة «لا بيع بلا وردية» لا تسري عليهم (وإلا انسدت فواتيرهم
 * بوردية لا تظهر شاشتها أصلاً — مأزق حقيقي اكتُشف بالفحص).
 * المرجعية: SAP B1 وQuickBooks — بيع الجملة والخدمات بالفاتورة لا بجلسة كاشير.
 */
export const INVOICE_FIRST_ACTIVITIES: readonly string[] = ['trading', 'manufacturing', 'services']

/** هل هذا النشاط يبيع بالفاتورة لا بالكاشير؟ */
export function isInvoiceFirst(activityId: string | null): boolean {
  return activityId != null && INVOICE_FIRST_ACTIVITIES.includes(activityId)
}

/**
 * ─── تبعيات الوحدات (سد فجوة التدقيق 2026-10-11) ───
 * بعض الوحدات **يستحيل أن تعمل وحدها**: محركها يرحّل على حسابات وحدة أخرى أو
 * يفتح شاشات تشير إليها. منحها بلا تبعياتها كان يفتح «قسم ناقص»:
 *   • `pos` بلا `inventory` = كاشير بلا شاشة أصناف، ويُرحّل مخزوناً (1103)
 *     وتكلفة (5101) ومستهلكات (5114) على حسابات مخفية عن صاحبها.
 *   • `purchases` بلا `inventory` = فاتورة شراء بسطور أصناف لا مكان لتعريفها.
 *   • `recipes`/`processing`/`jewelry`/`maintenance`/`cars` = كلها تصرف/تستلم أصنافاً.
 * الدالة `withDependencies` تُغلق القائمة تلقائياً (وراثياً: تبعية التبعية)،
 * وتُستعمل في: حساب الوحدات المفعّلة، وقصّ الوحدات على الرخصة، وحراسة الإطفاء.
 */
export const MODULE_DEPENDENCIES: Partial<Record<BusinessModule, readonly BusinessModule[]>> = {
  pos: ['inventory'],
  purchases: ['inventory'],
  recipes: ['inventory'],
  processing: ['inventory'],
  jewelry: ['inventory'],
  maintenance: ['inventory'],
  cars: ['inventory'],
}

/** يُغلق مجموعة وحدات على تبعياتها (مع الحفاظ على ترتيب ALL_MODULES للعرض) */
export function withDependencies(modules: readonly BusinessModule[]): BusinessModule[] {
  const out = new Set<BusinessModule>(modules)
  let changed = true
  while (changed) {
    changed = false
    for (const m of [...out]) {
      for (const dep of MODULE_DEPENDENCIES[m] ?? []) {
        if (!out.has(dep)) { out.add(dep); changed = true }
      }
    }
  }
  const canonical = [...out].sort((a, b) => ALL_MODULES.indexOf(a) - ALL_MODULES.indexOf(b))
  // الوحدات المجهولة في ALL_MODULES (لا ينبغي) تُلحق بأمان في نهاية القائمة
  return canonical.length === out.size ? canonical : [...canonical, ...[...out].filter((m) => !ALL_MODULES.includes(m))]
}

/**
 * سياسة الأقسام (أمر المالك): الأقسام الظاهرة = افتراضيات النشاط فقط،
 * والقسم الإضافي لا يفعّله إلا المطوّر عبر مفتاح موقَّع (extraModules في الرخصة).
 * دالة خالصة: تتجاهل أي اسم وحدة غير معروف في المفتاح بأمان، وتُغلق التبعيات.
 */
export function effectiveModules(activityId: string | null, licensedExtra: readonly string[] | undefined): BusinessModule[] {
  const tpl = ACTIVITY_TEMPLATES.find((a) => a.id === activityId)
  const base: BusinessModule[] = tpl ? [...tpl.modules] : ['pos', 'inventory', 'purchases']
  for (const m of licensedExtra ?? []) {
    if ((ALL_MODULES as readonly string[]).includes(m) && !base.includes(m as BusinessModule)) base.push(m as BusinessModule)
  }
  return withDependencies(base)
}

/**
 * قصّ الوحدات المحفوظة على الممنوحة فعلياً (ث1 — تدقيق 2026-10-08):
 * `setup.modules` حالة محفوظة، فكتابتها يدوياً في التخزين كانت تفتح أقساماً
 * ممنوحة بمفتاح موقّع فقط. هذه الدالة **تحذف** ما لا سند له من الرخصة،
 * ولا تُعيد أبداً ما أطفأه المستخدم بنفسه (حقه في إخفاء قسم يحتفظ به).
 *
 * نشاط غير معروف (نسخة أقدم/أحدث من القالب) ⇒ لا قصّ: لا نخمّن على حساب
 * أقسام العميل المشروعة.
 */
export function clampModulesToLicense(args: {
  stored: readonly BusinessModule[]
  activityId: string | null
  licensedExtra: readonly string[] | undefined
}): BusinessModule[] {
  const known = ACTIVITY_TEMPLATES.some((a) => a.id === args.activityId)
  if (!known) return [...args.stored]
  const allowed = new Set<string>(effectiveModules(args.activityId, args.licensedExtra))
  return withDependencies(args.stored.filter((m) => allowed.has(m)))
}

/** وحدات «العمل» (المحرّك التخصصي الذي يقود النشاط) — بمعزل عن وحدات النواة */
export const WORK_MODULES: readonly BusinessModule[] = [
  'pos', 'maintenance', 'laundry', 'equipment_rental', 'logistics', 'lab',
  'contracting', 'clinic', 'cars', 'wallet_services', 'realestate',
]

/**
 * تبديل وحدة (تفعيل/إلغاء) — دالة خالصة: تعيد القائمة الجديدة مغلقةً على تبعياتها،
 * وترفض:
 *  · إلغاء وحدة **تحتاجها** وحدة أخرى مفعّلة (نص عربي يسمّي المانع).
 *  · إلغاء آخر وحدة عمل (يبقى التطبيق بلا أي محرك).
 */
export function toggleModuleList(current: BusinessModule[], m: BusinessModule): BusinessModule[] {
  if (current.includes(m)) {
    // إطفاء وحدة ما دامت وحدة **أخرى مفعّلة** تعتمد عليها مرفوض بنص عربي واضح
    // (مثال: لا يُطفأ المخزون والكاشير عامل — يبقى الكاشير بلا أصناف وتكلفة)
    const blocking = (ALL_MODULES as readonly BusinessModule[])
      .filter((x) => x !== m && current.includes(x))
      .filter((x) => (MODULE_DEPENDENCIES[x] ?? []).includes(m))
    if (blocking.length) {
      throw new Error(`لا يمكن إلغاء «${MODULE_LABELS[m].nameAr}» وهي يحتاجها: ${blocking.map((x) => MODULE_LABELS[x].nameAr).join('، ')} — أوقفها أولاً`)
    }
    const next = current.filter((x) => x !== m)
    // وحدة عمل واحدة على الأقل (invariant قائم لا يتغيّر)
    if (!next.some((x) => WORK_MODULES.includes(x))) {
      throw new Error('لا يمكن إلغاء آخر وحدة عمل — يجب أن تبقى وحدة عمل واحدة على الأقل')
    }
    return withDependencies(next)
  }
  return withDependencies([...current, m])
}

export const FEATURE_LABELS: Record<ItemFeature, { nameAr: string; icon: string; desc: string }> = {
  expiry_batches: { nameAr: 'صلاحية ودفعات', icon: '📅', desc: 'تاريخ صلاحية، صرف FEFO، تنبيهات قرب الانتهاء' },
  serial_warranty: { nameAr: 'سيريال وضمان', icon: '🔢', desc: 'تتبع سيريال/IMEI لكل قطعة مع الضمان' },
  variants: { nameAr: 'ألوان ومقاسات', icon: '🎨', desc: 'متغيرات الصنف: لون، مقاس، خامة' },
  weight_scale: { nameAr: 'بيع بالوزن', icon: '⚖️', desc: 'أصناف موزونة وباركود ميزان' },
  multi_unit: { nameAr: 'وحدات متعددة', icon: '📦', desc: 'قطعة / علبة / كرتونة بمعاملات تحويل' },
  price_lists: { nameAr: 'قوائم أسعار', icon: '🏷️', desc: 'جملة / قطاعي / VIP' },
}

export const MODULE_LABELS: Record<BusinessModule, { nameAr: string; icon: string; desc: string }> = {
  pos: { nameAr: 'الكاشير والمبيعات', icon: '🛒', desc: 'شاشة البيع، فواتير المبيعات، المرتجعات، الورديات' },
  inventory: { nameAr: 'المخزون والمخازن', icon: '📦', desc: 'الأصناف، المخازن، التحويلات، الجرد' },
  purchases: { nameAr: 'المشتريات والموردون', icon: '🚚', desc: 'فواتير الشراء، مرتجعاتها، الموردون، مصاريف الشحنات' },
  maintenance: { nameAr: 'الصيانة', icon: '🔧', desc: 'أوامر صيانة الأجهزة، قطع الغيار، التسليم' },
  equipment_rental: { nameAr: 'إيجار المعدات', icon: '🚜', desc: 'المعدات، عقود الإيجار، التأمينات المستردة' },
  logistics: { nameAr: 'اللوجستيات', icon: '🛣️', desc: 'النقلات، الأسطول والسائقون، ربحية كل نقلة' },
  lab: { nameAr: 'معمل التحاليل', icon: '🔬', desc: 'المرضى، الطلبات والنتائج، عمولات الأطباء المحيلين' },
  contracting: { nameAr: 'المقاولات', icon: '🏗️', desc: 'المشروعات، المستخلصات والمحتجزات، التكاليف والربحية' },
  clinic: { nameAr: 'العيادة', icon: '🩺', desc: 'ملفات المرضى، الزيارات والكشوفات، خطط العلاج والمواعيد' },
  cars: { nameAr: 'معرض السيارات', icon: '🚗', desc: 'سيارات بتكلفة وربحية لكل واحدة، تجهيزات ترسمل، بيع وإيجار' },
  installments: { nameAr: 'الأقساط', icon: '💳', desc: 'بيع بالتقسيط، جدولة الأقساط، تنبيهات الاستحقاق' },
  recipes: { nameAr: 'الوصفات والإنتاج', icon: '👨‍🍳', desc: 'وصفات الأطباق تخصم خاماتها عند البيع، وأوامر إنتاج للصوصات والعجائن' },
  restaurant: { nameAr: 'صالة المطعم', icon: '🍽️', desc: 'أوامر الطاولات والتيك أواي والدليفري، بون المطبخ، وتقارير أداء الصالة' },
  jewelry: { nameAr: 'الصاغة', icon: '💍', desc: 'سعر الجرام اليومي بالعيار، مصنعية منفصلة، وشراء وبيع الكسر FIFO' },
  wallet_services: { nameAr: 'خدمات المحافظ', icon: '📲', desc: 'تحويل رصيد ودفع إلكتروني وفواتير — الربح آلياً: المحصَّل − المدفوع للمزوّد' },
  laundry: { nameAr: 'المغسلة', icon: '🧺', desc: 'أوامر غسيل بقطع وخدمات وعربون — استلام وتجهيز وتسليم بقيود سليمة' },
  booking: { nameAr: 'المواعيد والحجوزات', icon: '📅', desc: 'حجز مواعيد العملاء بيوم ووقت ومدة وحالة — تحذير التداخل وإحصاءات اليوم (بلا قيود: الدفع عند البيع)' },
  processing: { nameAr: 'التجهيز والتفكيك', icon: '🔪', desc: 'ذبيحة → أجزاء أو محصول → درجات: توزيع التكلفة بالقيمة البيعية وفاقد موثق ونسب تصافٍ' },
  realestate: { nameAr: 'العقارات', icon: '🏘️', desc: 'عقارات ووحدات وعقود إيجار بأقساط وتأمينات، سعي إدارة أملاك الغير، وبيع العقارات المملوكة' },
}

/** ترتيب عرض الوحدات في شاشة الإعدادات */
export const ALL_MODULES: BusinessModule[] = ['pos', 'inventory', 'purchases', 'installments', 'recipes', 'restaurant', 'processing', 'jewelry', 'maintenance', 'laundry', 'booking', 'equipment_rental', 'logistics', 'lab', 'contracting', 'clinic', 'cars', 'wallet_services', 'realestate']

/* حراسة تحميل: القائمة أعلاه هي المرجع لترتيب الوحدات، وقائمة الترتيب المستخدمة
 * داخل `withCoreModules` يجب أن تطابقها حرفياً — وإلا اختلف ترتيب الشاشات.
 * الفحص هنا يفشل عند أول تحميل لا في الإنتاج بعد شهور. */
{
  const sameOrder = ALL_MODULES.length === ALL_MODULES_ORDER.length && ALL_MODULES.every((m, i) => m === ALL_MODULES_ORDER[i])
  if (!sameOrder) throw new Error('ترتيب ALL_MODULES لا يطابق ALL_MODULES_ORDER — صحّح القائمتين في activities.ts')
}
