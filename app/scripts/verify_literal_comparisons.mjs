/**
 * 🔤 فحص «حرف بحرف» — الفئة 1: كل مقارنة نص حرفي ضد كتالوج القيم الشرعية
 *
 * الدرس: خطأ الشيكات (فحص status === 'pending' وهي حالة غير موجودة) لم يكشفه
 * TypeScript لأن الحقل معلن `status: string` عاماً. هذا الفحص يسد الفئة كاملة:
 * 1) يستخرج كل union types النصية من core/data (كتالوج القيم الشرعية للحقول المعروفة)
 * 2) يمسح كل ملف .ts/.tsx في src ويلتقط كل مقارنة `.field === 'value'` أو !==
 * 3) أي قيمة مقارنة بحقل معروف (status/kind/direction/payment/mode/purpose/source/
 *    rateType/refund/condition) غير موجودة في أي union = فشل فوري
 *
 * تشغيل: node scripts/verify_literal_comparisons.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const s = statSync(p)
    if (s.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

const files = walk(join(root, 'src'))

// ── 1) كتالوج القيم الشرعية: كل union نصية معلنة في أي ملف ──
const legal = new Set()
const unionRe = /type\s+\w+\s*=\s*((?:\s*\|?\s*'[^']+'\s*(?:\/\/[^\n]*)?\n?)+)/g
const litRe = /'([^']+)'/g
let unionCount = 0
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(unionRe)) {
    unionCount++
    for (const lm of m[1].matchAll(litRe)) legal.add(lm[1])
  }
  // قيم من Record<XStatus, ...> ومصفوفات TRANSITIONS أيضاً
  for (const m of src.matchAll(/TRANSITIONS[^=]*=\s*\{([\s\S]*?)\n\}/g)) {
    for (const lm of m[1].matchAll(litRe)) legal.add(lm[1])
  }
}

// حقول الحالة التي نفحص مقارناتها (الفئة التي حدث فيها خطأ pending)
const WATCHED_FIELDS = ['status', 'kind', 'direction', 'payment', 'mode', 'source', 'condition', 'rateType', 'purpose', 'refund', 'meterType', 'karat', 'severity', 'docType', 'sourceType', 'partyKind', 'rootType', 'type']

// قيم شرعية إضافية معلنة كـ interface literal fields لا unions
// (تُجمع من تعريفات interface: `field: 'a' | 'b'`)
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(/\w+\??:\s*((?:'[^']+'\s*\|\s*)+'[^']+')/g)) {
    for (const lm of m[1].matchAll(litRe)) legal.add(lm[1])
  }
  // discriminated unions بكائنات: `| { kind: 'read_only'; ... }` — القيمة معلنة داخل الكائن
  for (const m of src.matchAll(/\{\s*kind:\s*'([^']+)'/g)) legal.add(m[1])
}
// أنواع MIME لفحوص File.type — ليست حقول حالة تجارية
legal.add('application/pdf')
for (const value of ['string', 'checkbox', 'radio', 'option']) legal.add(value)

// ── 2) مسح كل المقارنات ──
const compareRe = /\.(\w+)\s*[!=]==\s*'([^']+)'/g
const reverseCompareRe = /'([^']+)'\s*[!=]==\s*\w+\.(\w+)/g
const violations = []
let comparisons = 0
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  const lines = src.split('\n')
  const check = (field, value, idx) => {
    if (!WATCHED_FIELDS.includes(field)) return
    comparisons++
    if (!legal.has(value)) violations.push(`${f.replace(root + '/', '')}:${idx + 1} — .${field} === '${value}' (قيمة غير معلنة في أي union)`)
  }
  lines.forEach((line, idx) => {
    if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) return
    for (const m of line.matchAll(compareRe)) check(m[1], m[2], idx)
    for (const m of line.matchAll(reverseCompareRe)) check(m[2], m[1], idx)
  })
}

console.log(`\n🔤 فحص المقارنات الحرفية: ${files.length} ملفاً، ${unionCount} نوع union، ${legal.size} قيمة شرعية، ${comparisons} مقارنة مفحوصة`)
if (violations.length) {
  console.log(`\n❌ ${violations.length} مقارنة بقيمة غير شرعية:`)
  for (const v of violations) console.log('  ✗ ' + v)
  process.exit(1)
}
console.log('✅ كل مقارنات الحالة تستخدم قيماً معلنة — فئة «pending الوهمية» مسدودة بالكامل')
