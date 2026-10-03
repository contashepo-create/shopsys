/**
 * بوابة §95 — فواتير الأنشطة الخدمية (طلب المالك: «اريد اصدار فواتير ايضا في
 * اللوجيستيات وايضا في الايجار وايضا في النقل») — محاذاة pro-acc.
 *
 * أنشطة اللوجيستيات/النقل وإيجار المعدات والعقارات بلا وحدة «pos» فقسم المبيعات
 * العام مخفي عنها — هذه البوابة تثبت أن لكل منها مركز فواتير كاملاً:
 * مسار مربوط + مدخل ملاحة + زر فاتورة جديدة + مراجعة + طباعة + دليل شاشة.
 *
 * التشغيل: node --experimental-strip-types scripts/verify_activity_invoices.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0, fails = []
const ok = (name, cond) => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fails.push(name); console.log(`  ❌ ${name}`) } }
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

console.log('① مراكز فواتير الأنشطة الثلاثة: مسارات وملاحة وأزرار')
{
  const app = read('../src/App.tsx')
  const nav = read('../src/ui/navCatalog.tsx')
  const hub = read('../src/ui/pages/ActivityInvoicesHubs.tsx')
  const guides = read('../src/core/guideSectionsModules.ts')

  for (const [key, path, label] of [['logistics', '/logistics/invoices', 'اللوجيستيات والنقل'], ['rental', '/rental/invoices', 'إيجار المعدات'], ['realestate', '/realestate/invoices', 'العقارات']]) {
    ok(`مسار ${path} مربوط في التطبيق`, app.includes(`path="${path}"`))
    ok(`مدخل «فواتير البيع» في ملاحة ${label}`, nav.includes(`path: '${path}'`))
    ok(`دليل شاشة ${path} موجود (لا تنجح verify_activity_guides بدونه)`, guides.includes(`'${path}': {`))
  }

  ok('المركز العام: زر فاتورة جديدة واحد يفتح نافذة الفاتورة الكاملة حرة', hub.includes('data-activity-new-invoice') && hub.includes('openSalesInvoiceWindow()'))
  ok('مراجعة كل فاتورة بالقلم في نافذتها الكاملة', hub.includes('data-activity-invoice-review') && hub.includes('openSalesInvoiceWindow(s.id)'))
  ok('طباعة A4/A5/حراري من الجدول (نفس محرك الفواتير)', hub.includes("printInvoice(s, 'a5')") && hub.includes("printInvoice(s, 'a4')") && hub.includes("printInvoice(s, 'thermal')"))
  ok('الجدول يعرض كل الفواتير بالبحث والباقي على العميل', hub.includes('data-activity-invoices-table') && hub.includes('باقٍ على العملاء'))
  ok('أقسام الأنشطة الثلاثة تصنع مركزها من مكون واحد (سلوك موحد)', hub.includes('export function LogisticsInvoicesPage') && hub.includes('export function RentalInvoicesPage') && hub.includes('export function RealestateInvoicesPage'))
}

console.log('② العميل يتحمل رصيد الفاتورة — نفس قاعدة pro-acc (فحص مصدر)')
{
  const pos = read('../src/core/pos.ts')
  const hub = read('../src/ui/pages/ActivityInvoicesHubs.tsx')
  ok('فاتورة البيع: غير المسدد يقيَّد 1104 ذمم عملاء (يدخل كشف العميل)', pos.includes("customer: { accountCode: '1104'"))
  ok('المركز يعلن القاعدة: الباقي ذمم على العملاء بكشوفهم', hub.includes('ذمم دخلت كشوف الحساب'))
}

console.log('─'.repeat(60))
if (fails.length) { console.log(`❌ فشل ${fails.length} من ${pass + fails.length}:`); for (const f of fails) console.log(`   - ${f}`); process.exit(1) }
console.log(`✅ بوابة فواتير الأنشاط الخدمية §95: ${pass} فحصاً ناجحاً — لوجيستيات ونقل وإيجار معدات وعقارات بمراكز فوترة كاملة على نافذة الفاتورة الواحدة`)
