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
  | 'installments' // الأقساط

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
    modules: ['pos', 'inventory', 'purchases', 'installments'],
    taxInclusiveDefault: true, defaultInvoiceTemplate: 'thermal',
  },
  {
    id: 'mobile', nameAr: 'موبايلات وصيانة', icon: '📱',
    description: 'سيريال/IMEI وضمان، وحدة صيانة كاملة',
    features: ['serial_warranty', 'variants'],
    modules: ['pos', 'inventory', 'purchases', 'maintenance', 'installments'],
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
 * تبديل وحدة عمل (تفعيل/إلغاء) — دالة خالصة:
 * تعيد قائمة الوحدات الجديدة، وتمنع إلغاء آخر وحدة عمل (لا تطبيق بلا أي وحدة).
 */
export function toggleModuleList(current: BusinessModule[], m: BusinessModule): BusinessModule[] {
  if (current.includes(m)) {
    const next = current.filter((x) => x !== m)
    // لا يجوز إطفاء كل شيء: يجب أن تبقى وحدة «عمل» واحدة على الأقل
    const workModules: BusinessModule[] = ['pos', 'maintenance', 'equipment_rental', 'logistics']
    if (!next.some((x) => workModules.includes(x))) {
      throw new Error('لا يمكن إلغاء آخر وحدة عمل — يجب أن تبقى وحدة واحدة على الأقل (كاشير أو صيانة أو إيجار أو لوجستيات)')
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
  installments: { nameAr: 'الأقساط', icon: '💳', desc: 'بيع بالتقسيط، جدولة الأقساط، تنبيهات الاستحقاق' },
}

/** ترتيب عرض الوحدات في شاشة الإعدادات */
export const ALL_MODULES: BusinessModule[] = ['pos', 'inventory', 'purchases', 'installments', 'maintenance', 'equipment_rental', 'logistics']
