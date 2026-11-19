/**
 * تمهيد التنقل بين الأنشطة التجريبية (وضع التطوير فقط).
 *
 * يجب أن يُمسح المتجر المحفوظ *قبل* تحميل وحدات المتاجر وترطيبها، وإلا سبقت
 * كتابة غير متزامنة متأخرة عمليةَ المسح فعاد نشاط سابق واختلطت البيانات.
 * لذلك يُستورد هذا الملف أولاً في main.tsx ولا يستورد هو أي متجر.
 */
export const DEMO_WIPE_KEY = 'shopsys-demo-wipe'

// `import.meta.env` موجود في Vite فقط (والـElectron يمرّ بـVite)؛ الحارس هنا يجعل
// الملف قابلاً للاستيراد من سكربتات الفحص في Node حيث لا يوجد import.meta.env إطلاقاً.
if (import.meta.env?.DEV && typeof localStorage !== 'undefined' && localStorage.getItem(DEMO_WIPE_KEY)) {
  localStorage.removeItem(DEMO_WIPE_KEY)
  localStorage.removeItem('shopsys-data')
  localStorage.removeItem('shopsys-app')
}
