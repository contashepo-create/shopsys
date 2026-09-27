/**
 * محرّك دليل النشاط: يجمع شروحات الشاشات كلها في خريطة واحدة مفهرسة بالمسار،
 * ويملأ أمثلتها بعيّنة النشاط الحالي، ويوفّر بحثاً نصياً داخل الشرح.
 * القاعدة الذهبية: الشرح يُطلب بمسار شاشة ظاهرة للمستخدم — فلا يظهر لنشاطٍ
 * شرحُ شاشةٍ لا يراها أصلاً (لا تداخل بين الأنشطة).
 */
import { SALES_GUIDES, INVENTORY_GUIDES, PURCHASE_PARTY_GUIDES, type ScreenGuide, type ScreenGuideMap } from './guideSections.ts'
import { MODULE_GUIDES } from './guideSectionsModules.ts'
import { ACCOUNTING_GUIDES, REPORT_GUIDES, SETTINGS_GUIDES } from './guideSectionsBack.ts'
import { fillSample, playbookFor, type ActivitySample } from './activityPlaybook.ts'

export type { ScreenGuide, ScreenGuideMap } from './guideSections.ts'

/** كل شروحات الشاشات — مفتاح كل شرح هو مسار الشاشة في التطبيق */
export const ALL_SCREEN_GUIDES: ScreenGuideMap = {
  ...SALES_GUIDES,
  ...INVENTORY_GUIDES,
  ...PURCHASE_PARTY_GUIDES,
  ...MODULE_GUIDES,
  ...ACCOUNTING_GUIDES,
  ...REPORT_GUIDES,
  ...SETTINGS_GUIDES,
}

/** شرح شاشة بعينها بعد ملء أمثلته بعيّنة النشاط */
export function screenGuideFor(path: string, activityId: string | null | undefined): ScreenGuide | null {
  const base = ALL_SCREEN_GUIDES[path]
  if (!base) return null
  const sample: ActivitySample = playbookFor(activityId).sample
  const fill = (t: string) => fillSample(t, sample)
  return {
    titleAr: base.titleAr,
    purposeAr: fill(base.purposeAr),
    whenAr: fill(base.whenAr),
    stepsAr: base.stepsAr.map(fill),
    exampleAr: base.exampleAr.map(fill),
    effectAr: base.effectAr.map(fill),
    mistakesAr: base.mistakesAr?.map(fill),
    tipsAr: base.tipsAr?.map(fill),
  }
}

/** كل نصوص الشرح في مصفوفة واحدة — للبحث */
export function guideText(guide: ScreenGuide): string {
  return [
    guide.titleAr,
    guide.purposeAr,
    guide.whenAr,
    ...guide.stepsAr,
    ...guide.exampleAr,
    ...guide.effectAr,
    ...(guide.mistakesAr ?? []),
    ...(guide.tipsAr ?? []),
  ].join(' ')
}

/** هل يطابق الشرح (أو عنوان الشاشة) كلمة البحث؟ */
export function guideMatches(guide: ScreenGuide | null, screenTitleAr: string, query: string): boolean {
  const q = query.trim()
  if (!q) return true
  if (screenTitleAr.includes(q)) return true
  return guide ? guideText(guide).includes(q) : false
}
