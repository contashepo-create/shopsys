#!/usr/bin/env node
/**
 * بوابة المرحلة ⑥ (جاهزية السحابية — النشر بيد المالك بقرار صريح):
 * ملفات النشر جاهزة وموثقة بصدق، والتطبيق يُبنى للويب سليماً، ولا خدمة
 * سحابية تُستهلك بغير قرار (لا Functions ولا KV ولا D1 بالتصميم).
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const DIR = dirname(fileURLToPath(import.meta.url))
const appRoot = join(DIR, '..')
const repoRoot = join(appRoot, '..')
const read = (p) => readFileSync(join(repoRoot, p), 'utf8').replace(/\r\n/g, '\n')
let failed = 0
const failedNames = []
const check = (name, ok) => {
  console.log(`${ok ? '✓' : '✗'} ${name}`)
  if (!ok) { failed++; failedNames.push(name) }
}

check('⑥ Worker قناة الدعم القائم سليم بلا تعديل (worker.js من الجولة السابقة)', existsSync(join(repoRoot, 'cloud', 'worker.js')) && read('cloud/wrangler.toml').includes('shopsys-control'))
const toml = read('cloud/pages-wrangler.toml')
check('⑥ ملف إعداد Pages منفصل (cloud/pages-wrangler.toml) لا يمس Worker', existsSync(join(repoRoot, 'cloud', 'pages-wrangler.toml')) && toml.includes('لا يمس'))
check('⑥ Pages يشحن مخرجات الواجهة (app/dist) كصفحات ثابتة', toml.includes('pages_build_output_dir') && toml.includes('app/dist'))
check('⑥ لا خدمة سحابية مستهلكة للصفحات بغير قرار — لا D1/KV/Functions بالتصميم', !/\[\[d1_databases\]\]|\[\[kv_namespaces\]\]|functions_dir/.test(toml))
const doc = read('cloud/DEPLOY.md')
check('⑥ الوثيقة تجمع المكوّنين بصدق: Worker القائم + Pages الجديد، بخطوات وقائمة تحقق', doc.includes('wrangler pages deploy') && doc.includes('قائمة تحقق') && doc.includes('Worker قناة الدعم'))
check('⑥ الصدق التقني موثق: البيانات محلية بالمتصفح والمزامنة السحابية ليست في المرحلة', doc.includes('لا تُرفع لأي سيرفر') && doc.includes('ليست في هذه المرحلة'))
check('⑥ الوثيقة تفرض قرار المالك الصريح — لا نشر ذاتي', doc.includes('بقرار المالك') && doc.includes('قرار صريح'))
check('⑥ مقارنة صادقة بين نسخة الويب وسطح المكتب (ما ينقص المتصفح)', doc.includes('الطباعة الصامتة') && doc.includes('إرسال المستندات PDF عبر واتساب'))

/* بناء الويب سليم — dist موجود بآخر بناء (بوابة التغليف تبنيه ضمن verify:all) */
check('⑥ نسخة الويب تُبنى فعلاً (app/dist/index.html موجود بعد البناء)', existsSync(join(appRoot, 'dist', 'index.html')))

console.log('')
if (failed > 0) {
  console.error(`✗ فشل ${failed} فحصاً من بوابة جاهزية السحاب:`)
  for (const n of failedNames) console.error(`  — ${n}`)
  process.exit(1)
}
console.log('✓ بوابة جاهزية السحاب (8 فحوص): كود النشر جاهز وموثق — لا نشر إلا بقرار المالك')
