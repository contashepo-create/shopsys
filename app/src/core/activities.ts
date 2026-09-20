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
  | 'inventory' // المخزون والمخازن (وجيستيكس/إيجار معدات لا يحتاجونه غالباً)
  | 'purchases' // المشتريات والموردون
  | 'maintenance' // الصيانة
  | 'equipment_rental' // إيجار المعدات
  | 'logistics' // الخدمات اللوجستية
  | 'lab' // معامل التحاليل الطبية (القرار 26)
  | 'contracting' // محاسبة المقاولات (القرار 27)
  | 'clinic' // عيادات الأطباء وملفات المرضى (القرار 27)
  | 'cars' // معارض بيع وإيجار السيارات (القرار 27)
  | 'installments' // الأقساط
  | 'recipes' // الوصفات والتصنيع (مطاعم/مخابز)
  | 'jewelry' // الصاغة: سعر الجرام اليومي والمصنعية والكسر
  | 'wallet_services' // خدمات المحافظ والدفع الإلكتروني (نمط mobileshop): ربح = المحصَّل − المدفوع للمزوّد
  | 'laundry' // المغاسل: أوامر غسيل بقطع وخدمات وعربون (وحدة مستقلة — ليست صيانة)
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

export const ACTIVITY_TEMPLATES: ActivityTemplate[] = [
  {
    id: 'grocery', nameAr: 'أغذية / سوبر ماركت', icon: '🛒',
    description: 'صلاحيات ودفعات، بيع بالوزن، وحدات متعددة',
    features: ['expiry_batches', 'weight_scale', 'multi_unit', 'price_lists'],
    // مراجعة سطرية (طلب المالك): لا أقساط في بيع الأغذية — الوحدة تُفعَّل بالمفتاح لو احتاجها أحد
    modules: ['pos', 'inventory', 'purchases'],
    taxInclusiveDefault: true, defaultInvoiceTemplate: 'thermal',
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
    description: 'حفارات ولوادر — عقود، عدّادات، ربحية كل معدة (بلا مخازن افتراضياً)',
    features: ['multi_unit'],
    modules: ['equipment_rental', 'installments'],
    taxInclusiveDefault: false, defaultInvoiceTemplate: 'a4',
  },
  {
    id: 'logistics', nameAr: 'خدمات لوجستية ونقل', icon: '🚚',
    description: 'نقلات، أسطول وسائقون، مستخلصات (بلا مخازن ولا كاشير افتراضياً)',
    features: [],
    modules: ['logistics'],
    taxInclusiveDefault: false, defaultInvoiceTemplate: 'a4',
  },
  {
    id: 'lab', nameAr: 'معمل تحاليل طبية', icon: '🔬',
    description: 'مرضى وفحوصات ونطاقات مرجعية، عمولات أطباء محيلين (بلا مخازن ولا كاشير)',
    features: [],
    modules: ['lab'],
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
    modules: ['pos', 'inventory', 'purchases', 'recipes'],
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
    modules: ['laundry'],
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
    // بيع خدمات (حلاقة/صبغة/عناية) كأصناف isService بلا مخزون + بيع منتجات عناية
    // من المخزون + مواعيد وعمولات موظفين. المرجع العالمي: Fresha / Booksy.
    id: 'salon', nameAr: 'صالون حلاقة وتجميل', icon: '💈',
    description: 'خدمات بلا مخزون + منتجات عناية، مواعيد وعمولات موظفين',
    features: ['price_lists'],
    modules: ['pos', 'inventory', 'purchases'],
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
    description: 'عقارات ووحدات، عقود إيجار بأقساط وتأمين مسترد وتوثيق إيجار، سعي أملاك الغير، وبيع عقارات (بلا مخازن ولا كاشير)',
    features: [],
    modules: ['realestate'],
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
    // نشاط جديد (طلب المالك): شركة خدمية — أصناف خدمات بلا مخزون (isService)
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
 * تبديل وحدة عمل (تفعيل/إلغاء) — دالة خالصة:
 * تعيد قائمة الوحدات الجديدة، وتمنع إلغاء آخر وحدة عمل (لا تطبيق بلا أي وحدة).
 */
/**
 * سياسة الأقسام (أمر المالك): الأقسام الظاهرة = افتراضيات النشاط فقط،
 * والقسم الإضافي لا يفعّله إلا المطوّر عبر مفتاح موقَّع (extraModules في الرخصة).
 * دالة خالصة: تتجاهل أي اسم وحدة غير معروف في المفتاح بأمان.
 */
export function effectiveModules(activityId: string | null, licensedExtra: readonly string[] | undefined): BusinessModule[] {
  const tpl = ACTIVITY_TEMPLATES.find((a) => a.id === activityId)
  const base: BusinessModule[] = tpl ? [...tpl.modules] : ['pos', 'inventory', 'purchases']
  for (const m of licensedExtra ?? []) {
    if ((ALL_MODULES as readonly string[]).includes(m) && !base.includes(m as BusinessModule)) base.push(m as BusinessModule)
  }
  return base
}

export function toggleModuleList(current: BusinessModule[], m: BusinessModule): BusinessModule[] {
  if (current.includes(m)) {
    const next = current.filter((x) => x !== m)
    // لا يجوز إطفاء كل شيء: يجب أن تبقى وحدة «عمل» واحدة على الأقل
    const workModules: BusinessModule[] = ['pos', 'maintenance', 'laundry', 'equipment_rental', 'logistics', 'lab', 'contracting', 'clinic', 'cars', 'wallet_services', 'realestate']
    if (!next.some((x) => workModules.includes(x))) {
      throw new Error('لا يمكن إلغاء آخر وحدة عمل — يجب أن تبقى وحدة عمل واحدة على الأقل')
    }
    return next
  }
  return [...current, m]
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
  jewelry: { nameAr: 'الصاغة', icon: '💍', desc: 'سعر الجرام اليومي بالعيار، مصنعية منفصلة، وشراء وبيع الكسر FIFO' },
  wallet_services: { nameAr: 'خدمات المحافظ', icon: '📲', desc: 'تحويل رصيد ودفع إلكتروني وفواتير — الربح آلياً: المحصَّل − المدفوع للمزوّد' },
  laundry: { nameAr: 'المغسلة', icon: '🧺', desc: 'أوامر غسيل بقطع وخدمات وعربون — استلام وتجهيز وتسليم بقيود سليمة' },
  processing: { nameAr: 'التجهيز والتفكيك', icon: '🔪', desc: 'ذبيحة → أجزاء أو محصول → درجات: توزيع التكلفة بالقيمة البيعية وفاقد موثق ونسب تصافٍ' },
  realestate: { nameAr: 'العقارات', icon: '🏘️', desc: 'عقارات ووحدات وعقود إيجار بأقساط وتأمينات، سعي إدارة أملاك الغير، وبيع العقارات المملوكة' },
}

/** ترتيب عرض الوحدات في شاشة الإعدادات */
export const ALL_MODULES: BusinessModule[] = ['pos', 'inventory', 'purchases', 'installments', 'recipes', 'processing', 'jewelry', 'maintenance', 'laundry', 'equipment_rental', 'logistics', 'lab', 'contracting', 'clinic', 'cars', 'wallet_services', 'realestate']
