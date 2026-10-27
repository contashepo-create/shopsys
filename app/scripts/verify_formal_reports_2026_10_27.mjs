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

for (const c of checks) {
  if (c.ok) passed++
  else console.error(`✗ ${c.name}`)
}
console.log(`verify_formal_reports_2026_10_27: ${passed}/${checks.length} فحصاً`)
if (passed !== checks.length) process.exit(1)
