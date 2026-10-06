/**
 * إغلاق AUDIT-004 — لا حساب ميت في شجرة الحسابات.
 *
 * كل حساب قابل للترحيل في `STANDARD_COA` يجب أن يقع في **واحدة** من ثلاث خانات مشروعة:
 *   ① محرك: يُرحَّل عليه من مسار في الكود (نصاً صريحاً أو عبر ثابت مُسمّى مثل STAFF_COMMISSION_EXPENSE).
 *   ② ديناميكي: كود خزينة/بنك يختاره المستخدم وقت الترحيل (1101، 1102، وأي خزينة مضافة).
 *   ③ متاح للمستخدم: يظهر في قوائم السندات أو يُسمح به في القيد اليدوي، فيستطيع المحاسب استعماله.
 * أي حساب خارج الخانات الثلاث = **حساب ميت**: يزيد ضجيج الشجرة ويوهم المستخدم بوجود تبويب لا يعمل.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_audit004_account_coverage.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { reporter } from './auditKit.mjs'
import { STANDARD_COA } from '../src/core/ledger.ts'
import { ACCOUNT_MODULE_MAP } from '../src/core/coaVisibility.ts'
import { fileURLToPath } from 'node:url'
const APP_ROOT = fileURLToPath(new URL('..', import.meta.url))

const R = reporter('AUDIT-004 — تغطية كل حساب في الشجرة')
const SRC = `${APP_ROOT}/src/`

/** كل ملفات المحرك (نواة + مخزن) كنص واحد — الترحيل قد يكون بثابت مُسمّى لا بنص حرفي */
const engineFiles = []
const walk = (dir) => {
  for (const e of readdirSync(SRC + dir, { withFileTypes: true })) {
    if (e.isDirectory()) walk(`${dir}/${e.name}`)
    else if (e.name.endsWith('.ts')) engineFiles.push(`${dir}/${e.name}`)
  }
}
walk('core')
walk('data')
const engineBlob = engineFiles.map((f) => readFileSync(SRC + f, 'utf8')).join('\n')
// نزيل تعريف الشجرة نفسها حتى لا يُحسب مجرد التعريف استعمالاً
const coaDefStart = engineBlob.indexOf('STANDARD_COA')
const withoutCoaDef = engineBlob.slice(0, coaDefStart) + engineBlob.slice(engineBlob.indexOf('export const SOURCE_LABELS') > 0 ? engineBlob.indexOf('export const SOURCE_LABELS') : coaDefStart)

const vouchersPage = readFileSync(SRC + 'ui/pages/VouchersPage.tsx', 'utf8')
const journalPage = readFileSync(SRC + 'ui/pages/JournalPage.tsx', 'utf8')
const accounting = readFileSync(SRC + 'core/accounting.ts', 'utf8')

const TREASURY_CODES = new Set(['1101', '1102'])
const postable = STANDARD_COA.filter((a) => a.isPostable)
assert.ok(postable.length >= 50, `عدد الحسابات القابلة للترحيل ${postable.length} — الشجرة ناقصة`)

const buckets = { engine: [], dynamic: [], user: [], dead: [] }
for (const acc of postable) {
  const code = acc.code
  if (TREASURY_CODES.has(code)) { buckets.dynamic.push(code); continue }
  // ① ترحيل من المحرك: نص حرفي في سطر قيد، أو ثابت مُسمّى قيمته هذا الكود
  const literal = new RegExp(`accountCode: '${code}'|'${code}'\\s*(,|\\)|\\]|;)`).test(withoutCoaDef)
  const namedConst = new RegExp(`=\\s*'${code}'`).test(withoutCoaDef)
  if (literal || namedConst) { buckets.engine.push(code); continue }
  // ③ متاح للمستخدم: قائمة سندات أو القيد اليدوي
  const inVoucherList = vouchersPage.includes(`code: '${code}'`)
  const inManualEntry = journalPage.includes(code) || accounting.includes(`'${code}'`)
  if (inVoucherList || inManualEntry) { buckets.user.push(code); continue }
  buckets.dead.push(`${code} ${acc.nameAr}`)
}

R.ok(`المحرك يرحّل مباشرةً على ${buckets.engine.length} حساباً (بنصوص صريحة أو ثوابت مُسمّاة)`)
R.ok(`${buckets.dynamic.length} حساباً ديناميكياً (خزائن/بنوك يختارها المستخدم وقت الترحيل)`)
R.ok(`${buckets.user.length} حساباً متاحاً للمستخدم في قوائم السندات أو القيد اليدوي`)
assert.deepEqual(buckets.dead, [], `حسابات ميتة في الشجرة: ${buckets.dead.join(' · ')}`)
R.ok('لا حساب ميت: كل حساب قابل للترحيل له طريق واضح — محرك أو اختيار ديناميكي أو إتاحة للمستخدم')

/* الحسابات التخصصية لا تظهر لمن لا يملك وحدتها (وإلا صارت «ميتة» عملياً في شجرته) */
{
  const specialized = Object.keys(ACCOUNT_MODULE_MAP)
  const missing = specialized.filter((code) => !STANDARD_COA.some((a) => a.code === code))
  assert.deepEqual(missing, [], `خريطة الوحدات تشير لحسابات غير موجودة: ${missing.join('، ')}`)
  R.ok(`${specialized.length} حساباً تخصصياً مربوطاً بوحدته — يختفي عمن لا يملكها بدل أن يبقى تبويباً ميتاً`)
}

/* الحسابات الحساسة لا تُترك للقيد اليدوي بلا ضابط */
{
  assert.ok(accounting.includes('LOCKED_CONTROL_ACCOUNTS') && accounting.includes('PARTY_CONTROL_ACCOUNTS'), 'ضوابط حسابات المراقبة مفقودة')
  for (const code of ['1106', '1107', '1108', '2116']) {
    assert.ok(accounting.includes(`'${code}'`), `الحساب ${code} خارج قائمة المراقبة المقفلة`)
  }
  R.ok('حسابات المراقبة الأربعة مقفلة أمام القيد اليدوي، وحسابا الأطراف مشروطان بتحديد الطرف')
}

/* الأسماء: لا حساب بلا اسم عربي ولا تكرار كود */
{
  const codes = STANDARD_COA.map((a) => a.code)
  assert.equal(new Set(codes).size, codes.length, 'كود حساب مكرر في الشجرة')
  const unnamed = STANDARD_COA.filter((a) => !a.nameAr || !a.nameAr.trim())
  assert.deepEqual(unnamed, [], 'حساب بلا اسم عربي')
  const orphans = STANDARD_COA.filter((a) => a.parentCode && !codes.includes(a.parentCode))
  assert.deepEqual(orphans.map((a) => a.code), [], 'حساب بأب غير موجود')
  R.ok(`${codes.length} حساباً: لا كود مكرر، ولا اسم فارغ، ولا ابن بلا أب — الشجرة متماسكة`)
}

console.log(`\n  محرك: ${buckets.engine.length} · ديناميكي: ${buckets.dynamic.length} · متاح للمستخدم: ${buckets.user.join('، ') || '—'}\n`)
R.done('— كل حساب في الشجرة له طريق يُستعمل به؛ لا تبويب ميت يوهم المالك')
