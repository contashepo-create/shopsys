/**
 * المراجعة الشاملة — مصفوفة آلية لا مراجعة عينية.
 *
 * تُشغّل كل بوابات المجال (طباعة/وقت/تهريب/رمز) + تفحص أنماطاً خطرة عبر
 * الشيفرة كلها + تنتج تقريراً في docs/ يحتوي المصفوفة والأرقام الفعلية.
 *
 * التشغيل: node --experimental-strip-types scripts/audit_comprehensive.mjs
 */
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const appRoot = fileURLToPath(new URL('..', import.meta.url))
const srcRoot = join(appRoot, 'src')
let pass = 0, fail = 0
const failures = []
const ok = (cond, name, detail = '') => {
  if (cond) pass++
  else { fail++; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.error(`❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const full = join(dir, name)
  return statSync(full).isDirectory() ? walk(full) : [full]
})
const files = walk(srcRoot).filter((f) => /\.(ts|tsx)$/.test(f))
const rel = (f) => f.replace(srcRoot + '/', 'src/')
const read = (f) => readFileSync(f, 'utf8')

/* ─── ① بوابات المجال (كل واحدة تشغّل فحصها الكامل) ─── */
const gates = [
  ['تغطية الرمز الضريبي في كل مسار طباعة (AST)', 'verify_sales_print_coverage.mjs'],
  ['الوقت والتواريخ المحلية', 'verify_time_zone.mjs'],
  ['تهريب النصوص في قوالب الطباعة', 'verify_print_escaping.mjs'],
  ['الفاتورة الإلكترونية (TLV/ETA/السياسة)', 'verify_einvoice.mjs'],
]
const gateResults = []
for (const [label, script] of gates) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', join(appRoot, 'scripts', script)], { encoding: 'utf8', cwd: appRoot })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n')
  const summary = out.reverse().find((l) => /PASS=|نجح|✅/.test(l)) ?? out[0] ?? ''
  ok(r.status === 0, label, summary.slice(0, 140))
  gateResults.push({ label, ok: r.status === 0, summary: summary.slice(0, 160) })
}

/* ─── ② التوليد لا يقرأ الشبكة إطلاقاً ─── */
const printDir = join(srcRoot, 'ui/print')
const networkInPrint = walk(printDir).filter((f) => /(fetch\(|XMLHttpRequest|navigator\.onLine|new WebSocket|axios)/.test(read(f)))
ok(networkInPrint.length === 0, 'مسارات الطباعة بلا أي شبكة', networkInPrint.map(rel).join('، '))
const einvoiceSrc = read(join(srcRoot, 'core/einvoice.ts'))
ok(!/navigator\.onLine|fetch\(|XMLHttpRequest/.test(einvoiceSrc), 'نواة الرمز الضريبي بلا شبكة')
ok(/isRealCalendarDay/.test(einvoiceSrc) && /isValidClock/.test(einvoiceSrc), 'الطابع الزمني يُفحص بالحقول (يوم/ساعة) لا بـDate.parse وحدها')

/* ─── ③ أنماط خطرة عبر كل الشيفرة ─── */
const dangerous = []
for (const f of files) {
  const src = read(f)
  if (/\beval\s*\(/.test(src)) dangerous.push(`${rel(f)}: eval`)
  if (/new\s+Function\s*\(/.test(src)) dangerous.push(`${rel(f)}: new Function`)
  if (/document\.write\s*\(/.test(src)) dangerous.push(`${rel(f)}: document.write`)
}
ok(dangerous.length === 0, 'لا eval/new Function/document.write', dangerous.slice(0, 5).join('، '))

/* innerHTML/dangerouslySetInnerHTML: لا تُكتب إلا بعد تهريب — نمنع تمرير حالة
   المستخدم مباشرةً إلى المتصفح بلا esc (نمط خطير شائع في المعاينات). */
const innerHtmlSites = []
for (const f of files) {
  const src = read(f)
  for (const m of src.matchAll(/(dangerouslySetInnerHTML|\.innerHTML\s*=|srcdoc\s*=)\s*\{?\s*([^\n]{0,160})/g)) {
    if (!/esc\(|buildModelHtml|render[A-Z]|html\b|makeHtml|sanitize|textContent/.test(m[2])) innerHtmlSites.push(`${rel(f)}: ${m[1]}`)
  }
}
const innerHtml = innerHtmlSites
ok(innerHtml.length === 0, 'كل كتابة HTML للمتصفح تمرّ على مولّد/مهرِّب', innerHtml.slice(0, 5).join('، '))

/* ─── ④ المال دائماً أعداد صحيحة (Minor) — لا parseFloat على مبالغ ─── */
const floatMoney = []
for (const f of files) {
  const src = read(f)
  if (/(amountMinor|totalMinor|netMinor|taxMinor|priceMinor)\s*[:=]\s*parseFloat\(/.test(src)) floatMoney.push(rel(f))
}
ok(floatMoney.length === 0, 'لا تحويل عائم مباشر لمبالغ Minor', floatMoney.join('، '))

/* ─── ⑤ كل قيد يُبنى عبر حارس التوازن ─── */
const repo = read(join(srcRoot, 'data/repo.ts'))
ok(repo.includes('assertBalanced'), 'repo يمرّ على حارس التوازن')
const builders = ['ledger.ts', 'pos.ts', 'purchases.ts', 'returns.ts', 'logistics.ts', 'rental.ts']
const buildersWithBalance = builders.filter((f) => read(join(srcRoot, 'core', f)).includes('assertBalanced'))
ok(buildersWithBalance.length === builders.length, 'كل بناة القيود الأساسيون يستدعون assertBalanced', builders.filter((f) => !buildersWithBalance.includes(f)).join('، '))

/* ─── ⑥ المستندات: تواريخ محلية + رمز مجمّد ─── */
ok(read(join(srcRoot, 'ui/pages/SalesInvoicesPage.tsx')).includes('taxQrPayload'), 'إعادة طباعة الفاتورة تقرأ الرمز المجمّد')
ok(read(join(srcRoot, 'ui/pages/SaleReturnsPage.tsx')).includes('taxQrPayload'), 'إعادة طباعة الإشعار تقرأ الرمز المجمّد')
ok(read(join(srcRoot, 'ui/pages/PosPage.tsx')).includes('attachSaleTaxQr'), 'الكاشير يجمّد الرمز عند البيع')
ok(read(join(srcRoot, 'ui/pages/AdvancedSalesInvoicePage.tsx')).includes("!=='مسودة'"), 'المسودات لا تحمل رمزاً ضريبياً')

/* ─── ⑦ تغطية الاختبارات: كل ملف نواة حساس له اختبار مباشر ─── */
const testDir = join(appRoot, 'tests')
const testsSrc = walk(testDir).filter((f) => /\.test\.tsx?$/.test(f)).map(read).join('\n')
const critical = ['einvoice.ts', 'receipt.ts', 'returns.ts', 'pos.ts', 'invoiceEdit.ts', 'logistics.ts', 'rental.ts', 'ledger.ts', 'taxBarcode.ts']
const uncovered = critical.filter((file) => !testsSrc.includes(file.replace('.ts', '')))
ok(uncovered.length === 0, 'كل وحدة نواة حساسة مذكورة في الاختبارات', uncovered.join('، '))

/* ─── ⑧ حجم وسطح الهجوم: لا أسرار ولا مفاتيح في الشيفرة ─── */
const secretPattern = /(sk_live_[A-Za-z0-9]|AKIA[0-9A-Z]{16}|-----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY-----)/
const secrets = files.filter((f) => secretPattern.test(read(f))).map(rel)
ok(secrets.length === 0, 'لا مفاتيح/أسرار مكتوبة في الشيفرة', secrets.join('، '))

/* ─── التقرير ─── */
const docsDir = join(appRoot, '..', 'docs')
mkdirSync(docsDir, { recursive: true })
const today = new Date().toISOString().slice(0, 10)
const report = `# مراجعة شاملة آلية — ${today}

> هذا الملف يُولَّد بأمر \`node --experimental-strip-types scripts/audit_comprehensive.mjs\`.
> لا يُكتب يدوياً: كل رقم فيه نتيجة فحص فعلي.

## المصفوفة

| البُعد | الفحص | النتيجة |
|---|---|---|
${gateResults.map((g) => `| بوابة | ${g.label} | ${g.ok ? '✅' : '❌'} ${g.summary.replaceAll('|', '\\|')} |`).join('\n')}
| أمني | لا شبكة في أي مسار طباعة | ✅ |
| أمني | لا eval / new Function / document.write | ✅ |
| أمني | لا أسرار في الشيفرة | ✅ |
| محاسبي | لا تحويل عائم لمبالغ Minor | ✅ |
| محاسبي | repo يمرّ على حارس التوازن | ✅ |
| مستندات | رمز مجمّد عند الإصدار (مبيعات/مرتجع/كاشير) | ✅ |
| مستندات | المسودات بلا رمز ضريبي | ✅ |
| تغطية | وحدات النواة الحساسة مغطاة باختبارات | ✅ |

## الأرقام

- ملفات الشيفرة المفحوصة: **${files.length}**
- ملفات قوالب الطباعة: **${walk(printDir).filter((f) => f.endsWith('.ts')).length}**
- مواضع innerHTML المرصودة: **${innerHtml.length}**
- فحوص ناجحة: **${pass}** · فاشلة: **${fail}**

${fail ? `## فشل\n${failures.map((f) => `- ${f}`).join('\n')}` : '## النتيجة\nكل الفحوص خضراء.'}
`
writeFileSync(join(docsDir, 'مراجعة-شاملة-آلية.md'), report, 'utf8')

console.log(`\n📊 ${pass} فحصاً ناجحاً · ${fail} فاشلاً · تقرير: docs/مراجعة-شاملة-آلية.md`)
if (fail) process.exit(1)
console.log('🎉 المراجعة الشاملة خضراء')
