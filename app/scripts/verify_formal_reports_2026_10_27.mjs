/**
 * بوابة «التقارير الرسمية + إصلاحات 2026-10-27».
 * تحرس أربع ثوابت لا يجوز كسرها:
 *  ① ربط الشيكات الواردة بذمم المستخلصات داخل getOpenClientInvoices.
 *  ② إبقاء تبويبات المسار مركّبة عبر Activity + Routes location.
 *  ③ مكوّن التقرير الرسمي (التصميم ③) ونموذجه الخالص موجودان ومستخدمان.
 *  ④ كل تقرير موحّد يفتح معاينة طباعة قبل الطباعة (لا iframe فوري).
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const src = join(root, '..', 'src')
const read = (p) => readFileSync(join(src, p), 'utf8')
let passed = 0
const checks = []
const ok = (name, condition) => { checks.push({ name, ok: !!condition }) }

/* ① إصلاح الشيك */
ok('ملف نواة chequeDues موجود', existsSync(join(src, 'core/chequeDues.ts')))
const chequeCore = existsSync(join(src, 'core/chequeDues.ts')) ? read('core/chequeDues.ts') : ''
ok('النواة تستثني الشيك المرتد والملغي', /chequeSettlesCustomerDues/.test(chequeCore) && /bounced/.test(chequeCore) && /cancelled/.test(chequeCore))
ok('النواة توزّع FIFO وتحترم المحصَّل سابقاً', /allocateChequeDues/.test(chequeCore) && /settledMinor/.test(chequeCore) && /localeCompare/.test(chequeCore))
const repo = read('data/repo.ts')
ok('repo يستورد allocateChequeDues', /from '\.\.\/core\/chequeDues\.ts'/.test(repo))
ok('getOpenClientInvoices يضيف توزيعات الشيكات لخريطة settled', /allocateChequeDues\(state\.cheques, customerId, open\)/.test(repo) && /settled\.set\(a\.docKey/.test(repo))
ok('اختبارات تكامل الشيك موجودة', existsSync(join(root, '..', 'tests', 'cheque_project_dues.test.ts')))

/* ② إصلاح التابات */
const app = read('App.tsx')
ok('App يستعمل Activity', /import \{[^}]*Activity[^}]*\} from 'react'/.test(app))
ok('TabRoutes يُبقي التابات مركّبة', /function TabRoutes\(\)/.test(app) && /mode=\{tab\.path === current \? 'visible' : 'hidden'\}/.test(app))
ok('كل تاب يأخذ location الخاص به', /function parseTabLocation/.test(app) && /<Routes location=\{location\}>/.test(app))
ok('APP_ROUTES عنصر ثابت لا يُعاد بناؤه', /const APP_ROUTES = \(/.test(app))
ok('النافذة الواحدة بلا تبويبات تعرض شجرة واحدة', /if \(!enabled \|\| pathTabs\.length === 0\) return <RouteTreeForPath \/>/.test(app))
ok('اختبارات بقاء حالة التاب موجودة', existsSync(join(root, '..', 'tests', 'tab_state_preservation.test.tsx')))

/* ③ التقرير الرسمي بالتصميم ③ */
ok('نواة formalReport موجودة', existsSync(join(src, 'core/formalReport.ts')))
ok('نواة analyticalProjectReport موجودة', existsSync(join(src, 'core/analyticalProjectReport.ts')))
ok('مكوّن FormalReport موجود', existsSync(join(src, 'ui/components/FormalReport.tsx')))
ok('عارض المشروع التحليلي موجود', existsSync(join(src, 'ui/contracting/AnalyticalProjectReportView.tsx')))
const analytical = read('core/analyticalProjectReport.ts')
ok('عمود الرصيد التراكمي للمصروفات', /الرصيد التراكمي/.test(analytical))
ok('عمود المتبقي بعد كل تحصيل', /المتبقي بعد التحصيل/.test(analytical))
ok('تسوية ختامية بالمعادلة', /equation:/.test(analytical) && /صافي نتيجة المشروع/.test(analytical))
ok('الشيكات الواردة ضمن التحصيلات', /شيك وارد/.test(analytical) && /includeCheques/.test(analytical))
const contractingPage = read('ui/pages/ContractingReportsPage.tsx')
ok('تبويب التقرير الرسمي مضاف للواجهة', /'formal', 'التقرير الرسمي ③'/.test(contractingPage) && /AnalyticalProjectReportView/.test(contractingPage))
ok('اختبارات النموذج التحليلي موجودة', existsSync(join(root, '..', 'tests', 'analytical_project_report.test.ts')))

/* ④ معاينة الطباعة لكل التقارير */
const printReceipt = read('ui/print/printReceipt.ts')
ok('printHtml يدعم خيار preview', /preview\?: PrintHtmlPreview/.test(printReceipt))
ok('التقارير الموحّدة تُفتح معاينة تلقائياً عبر rp-body', /class=\\?"rp-body\\?"/.test(printReceipt) && /isUnifiedReport/.test(printReceipt))
ok('زر الطباعة داخل المعاينة لا يفتح معاينة ثانية', /fromPreview/.test(printReceipt) && /fromPreview: true/.test(read('ui/components/ThermalPreview.tsx')))
ok('مكون FormalReport يفتح openPrintPreview', /openPrintPreview/.test(read('ui/components/FormalReport.tsx')))
const statements = read('ui/pages/StatementsPage.tsx')
ok('كشف الحساب يفتح معاينة', /preview: \{ title/.test(statements))
const statementPrint = read('ui/print/printStatement.ts')
ok('كروت كشف الحساب استُبدلت بجدول', !/class="cards"/.test(statementPrint) && /الرصيد الحالي/.test(statementPrint) && /<table/.test(statementPrint))
ok('صفحة الكشف بلا بطاقة رصيد', !/anim-pop rounded-2xl border-2/.test(statements))

/* ⑤ مراجعة 2026-10-27: سلامة الأرقام، وتعميم المعاينة على الكشوف المستقلة */
const analyticalCore = read('core/analyticalProjectReport.ts')
const analyticalView = read('ui/contracting/AnalyticalProjectReportView.tsx')
ok('نواة buildExtractSettledMap تمنع تكرار التحصيل', /export function buildExtractSettledMap/.test(analyticalCore) && /openKeys\.has\(key\)/.test(analyticalCore))
ok('العارض يستخدم النواة ولا يجمع التوزيعات يدوياً', /buildExtractSettledMap\(\{/.test(analyticalView) && !/openInvoiceSettled\.set\(a\.docKey/.test(analyticalView))
ok('سطور التحصيل محصورة في مستخلصات المشروع', /extractKeys\.has\(a\.docKey\)/.test(analyticalCore))
ok('القيمة الثانوية تصل للطباعة', /c\.sub \? `\$\{c\.value\}/.test(read('core/formalReport.ts')))
ok('كروت دفتر الصنف استُبدلت بجدول', !/class="cards"/.test(read('ui/print/printItemLedger.ts')) && /class="summary"/.test(read('ui/print/printItemLedger.ts')))
const standaloneReports = [
  ['ui/pages/CoaPage.tsx', 'كشف حركة الحساب'],
  ['ui/pages/HrPage.tsx', 'كشف الحضور'],
  ['ui/pages/VouchersPage.tsx', 'سجل السندات'],
  ['ui/pages/ItemsPage.tsx', 'كارت الصنف'],
  ['ui/pages/ScaleSettingsPage.tsx', 'قائمة PLU'],
]
for (const [file, label] of standaloneReports) ok(`معاينة قبل طباعة ${label}`, /preview: \{ title/.test(read(file)))
ok('تشخيص الدعم يحفظ رد الخادم الصريح', /serverFailure/.test(read('core/support.ts')) && /const decisive = last\.status !== 0 \? last : serverFailure/.test(read('core/support.ts')))
ok('تبويب العرض لا يفكّك أشجار المسار', /<Activity mode=\{viewActiveTab \? 'hidden' : 'visible'\}>/.test(app) && /<TabRoutes \/>/.test(app))
ok('اختبار بقاء الحالة عند فتح تبويب عرض موجود', /فتح تبويب عرض لا يفكّك/.test(readFileSync(join(root, '..', 'tests', 'tab_state_preservation.test.tsx'), 'utf8')))

/* ⑥ المراجعة الأدق 2026-10-27: العيوب المحاسبية الأربعة + المعاينة الحية */
ok('A — الشيكات مقيّدة بنصيب المشروع الفعلي', /chequeAttributedMinor/.test(analyticalCore) && /chequeAttributedMinor/.test(analyticalView) && /attributedLeft/.test(analyticalCore))
ok('A — سطر خارج النطاق لا يُحسب ولا يُعدّ شيكاً مرتداً', /excludedReason/.test(analyticalCore) && /out-of-scope/.test(analyticalCore) && /خارج نطاق هذا المشروع/.test(analyticalCore))
ok('B — استنتاج السداد مشروط بدليل', /hasSettlementEvidence/.test(analyticalCore) && /hasSettlementEvidence/.test(analyticalView) && /const evidence = explicit > 0 \|\| args\.hasSettlementEvidence === true/.test(analyticalCore))
ok('B — مفاتيح المستخلصات الآجلة فقط تُمرَّر لخريطة الذمم', /creditExtractDocKeys/.test(analyticalView))
ok('C — استرداد الدفعة المقدمة مقيّد ولا يُحصَّل مرتين', /capRecovery/.test(analyticalCore) && /netCash/.test(analyticalCore))
ok('G — التسوية الختامية معادلتان مستقلتان', /بداية مستقلة/.test(analyticalCore) && /معادلتان مستقلتان/.test(analyticalCore))
ok('اختبارات المراجعة الأدق موجودة', existsSync(join(root, '..', 'tests', 'analytical_project_report_deep_audit.test.ts')) && existsSync(join(root, '..', 'tests', 'report_print_live_preview.test.tsx')))
const reportPrint = read('core/reportPrint.ts')
ok('سطور الترويسة تصل للطباعة', /headerLines\?: readonly string\[\]/.test(reportPrint) && /extraHeaderLines/.test(reportPrint) && /headerLines/.test(read('core/formalReport.ts')))
ok('الشعار/المُعِدّ يُوحَّدان بين الشاشة والطباعة', /logoDataUrl/.test(analyticalCore) && /logoDataUrl/.test(read('ui/components/FormalReport.tsx')) && /printedBy/.test(analyticalView))
ok('حقن CSS يعتمد على DOM لا متغيّر وحدة', !/styleInjected/.test(read('ui/components/FormalReport.tsx')) && /querySelector\('style\[data-formal-report-css\]'\)/.test(read('ui/components/FormalReport.tsx')))
ok('المعاينة الحية: rebuild عام لكل الأغلمة', /rebuildReportShellHtml/.test(reportPrint) && /rebuildReportShellHtml/.test(printReceipt) && /freshReportPrintSettings/.test(printReceipt))
ok('المعاينة الحية: تراقب reportPrint أيضاً', /reportPrintRef/.test(read('ui/components/ThermalPreview.tsx')) && /registerReportPrintSettingsProvider/.test(read('stores/app.store.ts')))
ok('المعاينة الحية: FormalReport يقرأ الإعدادات وقت الاستدعاء', /const live = useAppStore\.getState\(\)/.test(read('ui/components/FormalReport.tsx')))
const desktopMain = readFileSync(join(root, '..', 'desktop', 'main.ts'), 'utf8')
ok('دعم سطح المكتب: إشارة إلغاء مستقلة لكل محاولة', /for \(const doFetch of attempts\) \{[\s\S]{0,500}new AbortController\(\)/.test(desktopMain) && /clearTimeout\(timer\)/.test(desktopMain))
ok('كشف العميل يستثني الشيك الملغي كدفتر الذمم', /c\.status === 'cancelled'\) continue/.test(read('core/statements.ts')))

for (const c of checks) {
  if (c.ok) passed++
  else console.error(`✗ ${c.name}`)
}
console.log(`verify_formal_reports_2026_10_27: ${passed}/${checks.length} فحصاً`)
if (passed !== checks.length) process.exit(1)
