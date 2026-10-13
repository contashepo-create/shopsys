/**
 * سجل تبويبات مركز التقارير (سدّ الفجوة ف1 في §6 من ملف الرؤية).
 *
 * كان التبويب يُرسم دائماً: نشاط بلا كاشير يفتح «المبيعات اليومية» على صفر،
 * ونشاط بلا مخزون يفتح «المخزون» على فراغ. الآن لكل تبويب شرطه:
 *  · `module`  → يظهر عند تفعيل الوحدة (أو عند وجود بيانات فعلية لها: نشاط
 *    «فاتورة أولاً» بلا كاشير قد يبيع فواتير، فالتبويب يظهر ببياناته لا يُحجب).
 *  · `always`  → تبويب نواة لكل الأنشطة (الذمم · المصروفات · القوائم · العملات).
 * وما دام التبويب ظاهراً بلا حركة في الفترة، يُوسم «لا حركة بعد» بدل صمت الفراغ
 * (البوابة `verify_reports_module_fit.mjs` تحرس التغطية لتسعة وعشرين نشاطاً).
 */
import type { BusinessModule } from './activities.ts'

export type ReportTabId = 'sales' | 'items' | 'parties' | 'inventory' | 'expenses' | 'financial' | 'currencies'

export interface ReportTabDef {
  id: ReportTabId
  labelAr: string
  /** يظهر عند تفعيل هذه الوحدة (أو عند وجود بيانات لها) */
  module?: BusinessModule
  /** تبويب نواة يظهر لكل نشاط */
  always?: boolean
  /** ما الذي يُعدّ «حركة» في التبويب — تُقرأ من المخزن في الشاشة */
  dataHintAr: string
}

export const REPORT_TABS: ReportTabDef[] = [
  { id: 'sales', labelAr: 'المبيعات اليومية', module: 'pos', dataHintAr: 'فواتير البيع في الفترة' },
  { id: 'items', labelAr: 'أفضل الأصناف', module: 'inventory', dataHintAr: 'أصناف مبيعة في الفترة' },
  { id: 'parties', labelAr: 'الذمم', always: true, dataHintAr: 'أرصدة عملاء أو موردين' },
  { id: 'inventory', labelAr: 'المخزون', module: 'inventory', dataHintAr: 'أصناف وحركة مخزون' },
  { id: 'expenses', labelAr: 'المصروفات', module: 'purchases', dataHintAr: 'مصروفات أو فواتير شراء في الفترة' },
  { id: 'financial', labelAr: 'القوائم المالية', always: true, dataHintAr: 'قيود دفتر الأستاذ' },
  { id: 'currencies', labelAr: 'العملات', always: true, dataHintAr: 'حسابات بعملات أجنبية' },
]

/**
 * التبويبات الظاهرة لنشاط ما:
 * @param modules وحدات النشاط المفعّلة (بعد النواة)
 * @param hasData دالة تقول: هل لهذا التبويب بيانات فعلية؟ (أيوجد ما يُعرض أصلاً)
 */
export function visibleReportTabs(modules: readonly BusinessModule[], hasData: (id: ReportTabId) => boolean): ReportTabDef[] {
  return REPORT_TABS.filter((tab) => tab.always === true || !tab.module || modules.includes(tab.module) || hasData(tab.id))
}
