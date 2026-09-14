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
}

export const ACTIVITY_TEMPLATES: ActivityTemplate[] = [
  {
    id: 'grocery', nameAr: 'أغذية / سوبر ماركت', icon: '🛒',
    description: 'صلاحيات ودفعات، بيع بالوزن، وحدات متعددة',
    features: ['expiry_batches', 'weight_scale', 'multi_unit', 'price_lists'],
    modules: ['pos', 'installments'], taxInclusiveDefault: true,
  },
  {
    id: 'mobile', nameAr: 'موبايلات وصيانة', icon: '📱',
    description: 'سيريال/IMEI وضمان، وحدة صيانة كاملة',
    features: ['serial_warranty', 'variants'],
    modules: ['pos', 'maintenance', 'installments'], taxInclusiveDefault: true,
  },
  {
    id: 'clothing', nameAr: 'ملابس وأحذية', icon: '👕',
    description: 'ألوان ومقاسات، مخازن موسمية',
    features: ['variants', 'multi_unit', 'price_lists'],
    modules: ['pos', 'installments'], taxInclusiveDefault: true,
  },
  {
    id: 'pharmacy', nameAr: 'صيدلية', icon: '💊',
    description: 'صلاحية إلزامية، شريط/علبة',
    features: ['expiry_batches', 'multi_unit'],
    modules: ['pos'], taxInclusiveDefault: true,
  },
  {
    id: 'electronics', nameAr: 'أجهزة كهربائية', icon: '🔌',
    description: 'سيريال وضمان، أقساط',
    features: ['serial_warranty', 'multi_unit'],
    modules: ['pos', 'maintenance', 'installments'], taxInclusiveDefault: false,
  },
  {
    id: 'spare_parts', nameAr: 'قطع غيار', icon: '🔧',
    description: 'سيريال اختياري، وحدات متعددة',
    features: ['serial_warranty', 'multi_unit', 'price_lists'],
    modules: ['pos'], taxInclusiveDefault: false,
  },
  {
    id: 'equipment_rental', nameAr: 'إيجار معدات ثقيلة', icon: '🚜',
    description: 'حفارات ولوادر — عقود، عدّادات، ربحية كل معدة',
    features: ['multi_unit'],
    modules: ['equipment_rental', 'installments'], taxInclusiveDefault: false,
  },
  {
    id: 'logistics', nameAr: 'خدمات لوجستية ونقل', icon: '🚚',
    description: 'نقلات، أسطول وسائقون، مستخلصات',
    features: [],
    modules: ['logistics'], taxInclusiveDefault: false,
  },
  {
    id: 'general', nameAr: 'نشاط عام / آخر', icon: '🏪',
    description: 'قالب مرن — فعّل ما تحتاجه لاحقاً',
    features: ['multi_unit'],
    modules: ['pos', 'installments'], taxInclusiveDefault: true,
  },
]

export const FEATURE_LABELS: Record<ItemFeature, { nameAr: string; icon: string; desc: string }> = {
  expiry_batches: { nameAr: 'صلاحية ودفعات', icon: '📅', desc: 'تاريخ صلاحية، صرف FEFO، تنبيهات قرب الانتهاء' },
  serial_warranty: { nameAr: 'سيريال وضمان', icon: '🔢', desc: 'تتبع سيريال/IMEI لكل قطعة مع الضمان' },
  variants: { nameAr: 'ألوان ومقاسات', icon: '🎨', desc: 'متغيرات الصنف: لون، مقاس، خامة' },
  weight_scale: { nameAr: 'بيع بالوزن', icon: '⚖️', desc: 'أصناف موزونة وباركود ميزان' },
  multi_unit: { nameAr: 'وحدات متعددة', icon: '📦', desc: 'قطعة / علبة / كرتونة بمعاملات تحويل' },
  price_lists: { nameAr: 'قوائم أسعار', icon: '🏷️', desc: 'جملة / قطاعي / VIP' },
}

export const MODULE_LABELS: Record<BusinessModule, { nameAr: string; icon: string }> = {
  pos: { nameAr: 'الكاشير', icon: '🛒' },
  maintenance: { nameAr: 'الصيانة', icon: '🔧' },
  equipment_rental: { nameAr: 'إيجار المعدات', icon: '🚜' },
  logistics: { nameAr: 'اللوجستيات', icon: '🚚' },
  installments: { nameAr: 'الأقساط', icon: '💳' },
}
