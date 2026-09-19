/**
 * جدول البلدان العربية — ShopSys
 * يُختار البلد في معالج أول تشغيل فيضبط: العملة، الكسور العشرية، الضريبة.
 * كل القيم قابلة للتعديل لاحقاً من الإعدادات (وثيقة التصميم — قسم 5).
 */
import type { CurrencyConfig } from './money.ts'

export interface Country {
  code: string
  nameAr: string
  flag: string
  currency: CurrencyConfig
  vatPercent: number
  taxName: string
  /** مثال رقم هاتف محلي — يظهر placeholder في كل حقول الهاتف حسب بلد المنشأة (طلب المالك) */
  phoneExample: string
}

export const ARAB_COUNTRIES: Country[] = [
  { code: 'EG', nameAr: 'مصر', flag: '🇪🇬', currency: { code: 'EGP', symbol: 'ج.م', decimals: 2, name: 'جنيه مصري' }, vatPercent: 14, taxName: 'ضريبة القيمة المضافة' , phoneExample: '01012345678' },
  { code: 'SA', nameAr: 'السعودية', flag: '🇸🇦', currency: { code: 'SAR', symbol: 'ر.س', decimals: 2, name: 'ريال سعودي' }, vatPercent: 15, taxName: 'ضريبة القيمة المضافة' , phoneExample: '0501234567' },
  { code: 'AE', nameAr: 'الإمارات', flag: '🇦🇪', currency: { code: 'AED', symbol: 'د.إ', decimals: 2, name: 'درهم إماراتي' }, vatPercent: 5, taxName: 'ضريبة القيمة المضافة' , phoneExample: '0501234567' },
  { code: 'KW', nameAr: 'الكويت', flag: '🇰🇼', currency: { code: 'KWD', symbol: 'د.ك', decimals: 3, name: 'دينار كويتي' }, vatPercent: 0, taxName: '—' , phoneExample: '51234567' },
  { code: 'QA', nameAr: 'قطر', flag: '🇶🇦', currency: { code: 'QAR', symbol: 'ر.ق', decimals: 2, name: 'ريال قطري' }, vatPercent: 0, taxName: '—' , phoneExample: '33123456' },
  { code: 'BH', nameAr: 'البحرين', flag: '🇧🇭', currency: { code: 'BHD', symbol: 'د.ب', decimals: 3, name: 'دينار بحريني' }, vatPercent: 10, taxName: 'ضريبة القيمة المضافة' , phoneExample: '36123456' },
  { code: 'OM', nameAr: 'عُمان', flag: '🇴🇲', currency: { code: 'OMR', symbol: 'ر.ع', decimals: 3, name: 'ريال عماني' }, vatPercent: 5, taxName: 'ضريبة القيمة المضافة' , phoneExample: '91234567' },
  { code: 'JO', nameAr: 'الأردن', flag: '🇯🇴', currency: { code: 'JOD', symbol: 'د.أ', decimals: 3, name: 'دينار أردني' }, vatPercent: 16, taxName: 'الضريبة العامة على المبيعات' , phoneExample: '0791234567' },
  { code: 'IQ', nameAr: 'العراق', flag: '🇮🇶', currency: { code: 'IQD', symbol: 'د.ع', decimals: 0, name: 'دينار عراقي' }, vatPercent: 0, taxName: '—' , phoneExample: '07712345678' },
  { code: 'LY', nameAr: 'ليبيا', flag: '🇱🇾', currency: { code: 'LYD', symbol: 'د.ل', decimals: 3, name: 'دينار ليبي' }, vatPercent: 0, taxName: '—' , phoneExample: '0912345678' },
  { code: 'MA', nameAr: 'المغرب', flag: '🇲🇦', currency: { code: 'MAD', symbol: 'د.م', decimals: 2, name: 'درهم مغربي' }, vatPercent: 20, taxName: 'الضريبة على القيمة المضافة' , phoneExample: '0612345678' },
  { code: 'DZ', nameAr: 'الجزائر', flag: '🇩🇿', currency: { code: 'DZD', symbol: 'د.ج', decimals: 2, name: 'دينار جزائري' }, vatPercent: 19, taxName: 'الرسم على القيمة المضافة' , phoneExample: '0551234567' },
  { code: 'TN', nameAr: 'تونس', flag: '🇹🇳', currency: { code: 'TND', symbol: 'د.ت', decimals: 3, name: 'دينار تونسي' }, vatPercent: 19, taxName: 'الأداء على القيمة المضافة' , phoneExample: '20123456' },
  { code: 'SD', nameAr: 'السودان', flag: '🇸🇩', currency: { code: 'SDG', symbol: 'ج.س', decimals: 2, name: 'جنيه سوداني' }, vatPercent: 17, taxName: 'ضريبة القيمة المضافة' , phoneExample: '0912345678' },
  { code: 'YE', nameAr: 'اليمن', flag: '🇾🇪', currency: { code: 'YER', symbol: 'ر.ي', decimals: 0, name: 'ريال يمني' }, vatPercent: 5, taxName: 'الضريبة العامة على المبيعات' , phoneExample: '0771234567' },
  { code: 'LB', nameAr: 'لبنان', flag: '🇱🇧', currency: { code: 'LBP', symbol: 'ل.ل', decimals: 0, name: 'ليرة لبنانية' }, vatPercent: 11, taxName: 'الضريبة على القيمة المضافة' , phoneExample: '71123456' },
  { code: 'PS', nameAr: 'فلسطين', flag: '🇵🇸', currency: { code: 'ILS', symbol: '₪', decimals: 2, name: 'شيكل' }, vatPercent: 16, taxName: 'ضريبة القيمة المضافة' , phoneExample: '0599123456' },
  { code: 'SY', nameAr: 'سوريا', flag: '🇸🇾', currency: { code: 'SYP', symbol: 'ل.س', decimals: 0, name: 'ليرة سورية' }, vatPercent: 0, taxName: '—' , phoneExample: '0931234567' },
  { code: 'MR', nameAr: 'موريتانيا', flag: '🇲🇷', currency: { code: 'MRU', symbol: 'أ.م', decimals: 2, name: 'أوقية موريتانية' }, vatPercent: 16, taxName: 'ضريبة القيمة المضافة' , phoneExample: '22123456' },
]

export function getCountry(code: string): Country | undefined {
  return ARAB_COUNTRIES.find((c) => c.code === code)
}

/** placeholder هاتف حسب بلد الإعداد — يسقط على المثال المصري لو البلد غير معروف */
export function phonePlaceholder(countryCode: string): string {
  return getCountry(countryCode)?.phoneExample ?? '01012345678'
}
