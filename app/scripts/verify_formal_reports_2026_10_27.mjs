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
ok('تشخيص الدعم يميز 404 وفقد رد غير حاسم', /prior404/.test(read('core/support.ts')) && /قد تكون الرسالة وصلت/.test(read('core/support.ts')))
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
ok('دعم سطح المكتب: ناقل واحد بمهلة وإلغاء', /const doFetch = typeof chromiumFetch/.test(desktopMain) && /new AbortController\(\)/.test(desktopMain) && /clearTimeout\(timer\)/.test(desktopMain))
ok('كشف العميل يستثني الشيك الملغي كدفتر الذمم', /c\.status === 'cancelled'\) continue/.test(read('core/statements.ts')))

/* ⑦ الجولة السادسة: اكتمال التصدير + منع الحقن + سلامة السندات غير الموزّعة */
const formalView = read('ui/components/FormalReport.tsx')
ok('H1 — تصدير Excel يشمل الملخص/التسوية/البيانات/الملاحظات/الإجمالي',
  /add\('التقرير'/.test(formalView) && /الملخص المالي/.test(formalView) && /التسوية الختامية/.test(formalView) && /ملاحظات المراجعة/.test(formalView) && /— الإجمالي/.test(formalView))
ok('H2 — لا BOM مكرر في التصدير (toCsv يضيفه وحده)',
  !/new Blob\(\['\\ufeff' \+ csv\]/.test(formalView) && /new Blob\(\[csv\]/.test(formalView))
ok('H3 — التصدير يحفظ القيمة الثانوية', /cellText/.test(formalView) && /node\.sub/.test(formalView))
ok('H4 — السند غير الموزّع لا يُنسب للمشروع', /unattributedVouchers/.test(analyticalCore) && /if \(!v\.allocations\)/.test(analyticalCore) && /سندات قبض غير موزّعة/.test(analyticalCore))
ok('H5 — الصفوف المؤكدة تصل للطباعة', /rowClasses/.test(read('core/formalReport.ts')) && /SAFE_ROW_CLASSES/.test(reportPrint))
ok('H6 — الشعار واللون يُطبَّعان قبل الطباعة', /safeLogoUrl/.test(reportPrint) && /safeHexColor/.test(reportPrint) && /safeLogoUrl/.test(read('ui/print/printLabReport.ts')))
ok('H7 — مهرّب السمات escAttr يهرّب علامات التنصيص', /export function escAttr/.test(reportPrint) && /&quot;/.test(reportPrint) && /&#39;/.test(reportPrint) && /escAttr\(logoSrc\)/.test(reportPrint))
ok('بوابة التهريب تغطي نواة التقارير الرسمية', /reportPrint\.ts/.test(readFileSync(join(root, 'verify_print_escaping.mjs'), 'utf8')))
ok('اختبارات الجولة السادسة موجودة', existsSync(join(root, '..', 'tests', 'report_hardening_round6.test.tsx')))

/* ⑧ الجولة السابعة (2026-10-28): مراجعة سطر بسطر لكل تعديلات الجلسة */
const repo7 = read('data/repo.ts')
const view7 = read('ui/contracting/AnalyticalProjectReportView.tsx')
const core7 = read('core/analyticalProjectReport.ts')
const formalCore7 = read('core/formalReport.ts')
const formalView7 = read('ui/components/FormalReport.tsx')
const support7 = read('core/support.ts')
const printer7 = read('ui/print/printReceipt.ts')
const preview7 = read('ui/components/ThermalPreview.tsx')
ok('R7-1 — الدفتر الكامل متاح للتقارير (includeSettled)', /getOpenClientInvoices: \(customerId, includeSettled\)/.test(repo7) && /includeSettled \? open : open\.filter/.test(repo7))
ok('R7-2 — العارض يقرأ الدفتر الكامل ويُلغي الاستنتاج', /getOpenClientInvoices\(clientId, true\)/.test(view7) && /fullLedger: true/.test(view7) && /if \(args\.fullLedger\) continue/.test(core7))
ok('R7-3 — نسبة التحصيل بسقف 100٪ وتنبيه تحصيل زائد', /Math\.min\(100, Math\.round/.test(core7) && /تحصيل زائد/.test(core7))
ok('R7-4 — includeCheques=false لا يكسر اتساق التحصيلات', /excludedCheques/.test(core7) && /creditSettled - excludedCheques/.test(core7))
ok('R7-5 — تاريخ التقرير يحسب عند العرض ويُمرّر للنموذج', /const reportDay = todayLocalIso\(\)/.test(view7) && /period: `حتى \${reportDay}`/.test(view7))
ok('R7-6 — حقل signatures له أثر في الشاشة والطباعة', /\?\? model\.signatures \?\? reportPrint\.showSignatures/.test(formalView7) && /model\.signatures == null/.test(formalCore7))
ok('R7-7 — صف الإجمالي المطبوع يحفظ القيمة الثانوية', /totalRow: section\.totalRow\?\.map/.test(formalCore7) && /c\.sub \? `\$\{c\.value\}/.test(formalCore7))
ok('R7-8 — تصدير CSV بلا تصادم أسماء الأعمدة', /'البند': item/.test(formalView7) && /const col = \(i: number\)/.test(formalView7) && /\[\$\{si \+ 1\}\] ·/.test(formalView7))
ok('R7-9 — الترويسة لا تُكرّر الفترة', /!model\.subtitle\.includes\(model\.period\)/.test(formalView7))
ok('R7-10 — المعاينة تعيد البناء بأحدث نموذج', /buildHtmlRef/.test(formalView7) && /rebuild: \(\) => buildHtmlRef\.current\(\)/.test(formalView7))
ok('R7-11 — iframe المعاينة وiframe الطباعة محصّنان', (preview7.match(/sandbox="allow-same-origin"/g) ?? []).length >= 2 && /setAttribute\('sandbox', 'allow-same-origin allow-modals'\)/.test(printer7))
ok('R7-12 — صفحات المعاينة تهرّب HTML', /escHtml\(r\.description\)/.test(read('ui/pages/CoaPage.tsx')) && /escapePrintText\(v\.description\)/.test(read('ui/pages/VouchersPage.tsx')) && /esc\(employee\.nameAr\)/.test(read('ui/pages/HrPage.tsx')))
ok('R7-13 — مسبار الدعم يتجاوز حجب CORS', /mode: 'no-cors'/.test(support7) && /res\.type === 'opaque'/.test(support7))
ok('R7-14 — مضيف دعم مخصص لا تُرسل رسائله لخوادم عامة', /isKnownService/.test(support7) && /if \(!isKnownService\) return/.test(support7))
ok('R7-15 — الطباعة الصامتة لا تفتح معاينة', /const directPrint = Boolean\(options\?\.silent \|\| options\?\.printerName\)/.test(printer7))
const csvPages7 = ['CoaPage.tsx', 'VouchersPage.tsx', 'HrPage.tsx'].map((f) => read(`ui/pages/${f}`))
const csvSafe7 = csvPages7.every((src) => {
  return /toCsv\(/.test(src) && /setTimeout\(\(\) => URL\.revokeObjectURL/.test(src)
})
ok('R7-16 — تصادير الصفحات موحّد على toCsv مع تحرير مؤجّل', csvSafe7)
ok('R7-17 — بوابة التهريب تغطي قوالب HTML في الصفحات', /RAW_HTML_PAGES/.test(readFileSync(join(root, 'verify_print_escaping.mjs'), 'utf8')) && /printHtmlRegions/.test(readFileSync(join(root, 'verify_print_escaping.mjs'), 'utf8')))
ok('R7-18 — اختبارات الجولة السابعة موجودة', existsSync(join(root, '..', 'tests', 'report_hardening_round7.test.tsx')))

for (const c of checks) {
  if (c.ok) passed++
  else console.error(`✗ ${c.name}`)
}
console.log(`verify_formal_reports_2026_10_27: ${passed}/${checks.length} فحصاً`)
if (passed !== checks.length) process.exit(1)
