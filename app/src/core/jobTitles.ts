/**
 * المسميات الوظيفية حسب النشاط (طلب المالك: «الفئة الوظيفية يجب أن تتغير من
 * نشاط لآخر»). الصلاحيات تبقى موحّدة (أدوار النظام)، أما **المسمى الوظيفي**
 * فيقترَح من مجال النشاط: مطعم ⇒ شيف/ويتر · مقاولات ⇒ مهندس موقع/فني …
 *
 * القائمة اقتراحية لا إلزامية: يظل الحقل حراً يكتب فيه المستخدم ما يشاء.
 */
export const COMMON_JOB_TITLES = ['مدير', 'محاسب', 'أمين مخزن', 'كاشير', 'مندوب مبيعات', 'سائق', 'سائق معدة', 'مشغّل معدة', 'عامل نظافة', 'أمن']

export const JOB_TITLES_BY_ACTIVITY: Record<string, string[]> = {
  supermarket: ['كاشير', 'أمين مخزن', 'مشرف صالة', 'عامل رفوف', 'جزار', 'خباز'],
  restaurant: ['شيف', 'مساعد شيف', 'ويتر', 'كابتن صالة', 'عامل توصيل', 'مسؤول طلبات'],
  cafe: ['باريستا', 'ويتر', 'كاشير', 'مسؤول مناوبة'],
  pharmacy: ['صيدلي', 'مساعد صيدلي', 'كاشير', 'مسؤول مخزون أدوية'],
  clinic: ['طبيب', 'ممرض', 'فني أشعة', 'موظف استقبال', 'محاسب عيادة'],
  lab: ['فني مختبر', 'أخصائي تحاليل', 'مسؤول عينات', 'موظف استقبال'],
  contracting: ['مهندس موقع', 'مساعد مهندس', 'مراقب أعمال', 'سائق معدة', 'مشغّل معدة', 'سائق نقل ثقيل', 'فني صيانة معدات', 'فني كهرباء', 'فني سباكة', 'عامل بناء', 'مسؤول سلامة', 'مساح كميات'],
  realestate: ['مسؤول تأجير', 'مسوّق عقاري', 'مسؤول صيانة', 'محصّل إيجارات'],
  rental: ['سائق معدة', 'مشغّل معدة', 'سائق نقل ثقيل', 'مسؤول تأجير معدات', 'فني صيانة معدات'],
  equipment_rental: ['سائق معدة', 'مشغّل معدة', 'سائق نقل ثقيل', 'مسؤول تأجير معدات', 'فني صيانة معدات', 'مسؤول ساحة'],
  car_rental: ['سائق', 'مسؤول أسطول', 'موظف تسليم واستلام', 'فني فحص مركبات'],
  logistics: ['سائق', 'سائق نقل ثقيل', 'مسؤول شحنات', 'أمين مستودع', 'مسؤول تتبع'],
  cars: ['فني ميكانيكا', 'فني كهرباء سيارات', 'مسؤول قطع غيار', 'مثمّن سيارات', 'مندوب معرض'],
  maintenance: ['فني صيانة', 'فني تكييف', 'فني أجهزة', 'مسؤول أوامر شغل'],
  laundry: ['عامل غسيل', 'عامل كي', 'مسؤول استلام وتسليم', 'سائق توصيل'],
  feed: ['مسؤول إنتاج أعلاف', 'مشغّل خط', 'أمين مخزن خامات', 'فني جودة', 'مندوب مبيعات أعلاف'],
  clothing: ['بائع', 'مسؤول عرض وتنسيق', 'خياط تعديلات', 'أمين مخزن'],
  jewelry: ['صائغ', 'بائع مجوهرات', 'مثمّن ذهب', 'مسؤول خزنة'],
  factory: ['مشغّل خط إنتاج', 'فني صيانة', 'مراقب جودة', 'أمين مخزن خامات', 'مشرف إنتاج'],
  gym: ['مدرب', 'مسؤول استقبال', 'مسؤول اشتراكات'],
  salon: ['حلاق', 'كوافير', 'أخصائي تجميل', 'مسؤول حجوزات'],
}

/** المسميات المقترحة لنشاط + الوحدات المفعلة الإضافية (مثل المقاولات + تأجير المعدات) بلا تكرار */
export function jobTitlesFor(activityId: string | null | undefined, enabledModules?: string[]): string[] {
  const special = (activityId && JOB_TITLES_BY_ACTIVITY[activityId]) || []
  const moduleTitles: string[] = []
  if (enabledModules?.includes('equipment_rental')) moduleTitles.push(...(JOB_TITLES_BY_ACTIVITY.equipment_rental ?? []))
  if (enabledModules?.includes('contracting')) moduleTitles.push(...(JOB_TITLES_BY_ACTIVITY.contracting ?? []))
  if (enabledModules?.includes('logistics')) moduleTitles.push(...(JOB_TITLES_BY_ACTIVITY.logistics ?? []))
  if (enabledModules?.includes('real_estate')) moduleTitles.push(...(JOB_TITLES_BY_ACTIVITY.realestate ?? []))
  return [...new Set([...special, ...moduleTitles, ...COMMON_JOB_TITLES])]
}

/** هل الموظف مصنف كسائق أو مشغّل معدة؟ */
export function isDriverEmployee(emp: { jobTitle?: string; role?: string }): boolean {
  const jt = (emp.jobTitle ?? '').trim()
  return jt.includes('سائق') || jt.includes('مشغل') || jt.includes('مشغّل') || jt.includes('معدة')
}

/** تسمية حقل المسمى الوظيفي حسب النشاط (مقاولات ⇒ «الوظيفة في الموقع») */
export function jobTitleLabel(activityId: string | null | undefined): string {
  if (activityId === 'contracting') return 'الوظيفة في الموقع'
  if (activityId === 'restaurant' || activityId === 'cafe') return 'الوظيفة في المطبخ/الصالة'
  if (activityId === 'clinic' || activityId === 'lab') return 'التخصص الوظيفي'
  return 'المسمى الوظيفي'
}
