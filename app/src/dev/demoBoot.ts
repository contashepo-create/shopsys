/**
 * تمهيد التنقل بين الأنشطة التجريبية (وضع التطوير فقط).
 *
 * يجب أن يُمسح المتجر المحفوظ *قبل* تحميل وحدات المتاجر وترطيبها، وإلا سبقت
 * كتابة غير متزامنة متأخرة عمليةَ المسح فعاد نشاط سابق واختلطت البيانات.
 * لذلك يُستورد هذا الملف أولاً في main.tsx ولا يستورد هو أي متجر.
 */
export const DEMO_WIPE_KEY = 'shopsys-demo-wipe'

if (import.meta.env.DEV && typeof localStorage !== 'undefined' && localStorage.getItem(DEMO_WIPE_KEY)) {
  localStorage.removeItem(DEMO_WIPE_KEY)
  localStorage.removeItem('shopsys-data')
  localStorage.removeItem('shopsys-app')
}
