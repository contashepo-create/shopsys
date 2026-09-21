/**
 * 🔒 سد فئتين من الأخطاء إلى الأبد (فحص ساكن على الكود كله):
 *
 * فئة هـ — كود حساب مستخدم غير معرف في شجرة الحسابات:
 *   كل ليترال 4 أرقام (1xxx-5xxx) في سياق محاسبي يجب أن يوجد في STANDARD_COA،
 *   وإلا ظهر في التقارير حساباً شبحاً بلا اسم.
 *
 * فئة و — دالة تعيد بناء مصفوفة حالة محلياً ثم تنسى تمريرها إلى set():
 *   نمط `let X = state.field` ثم `X = ...` دون أن يظهر field داخل set({...})
 *   يعني ضياع التحديث بصمت (الدفتر المساعد يتجمد والعام يتحرك).
 *
 * تشغيل: node scripts/verify_static_categories.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const walk = (dir) => {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.tsx?$/.test(name)) out.push(p)
  }
  return out
}
const files = walk(join(root, 'src'))
let fail = 0

/* ═══ فئة هـ: أكواد الحسابات ═══ */
const ledger = readFileSync(join(root, 'src/core/ledger.ts'), 'utf8')
const coa = new Set([...ledger.matchAll(/code:\s*'(\d{4})'/g)].map((m) => m[1]))
if (coa.size < 50) { console.error(`✗ STANDARD_COA غير مقروءة (${coa.size} كوداً فقط)`); process.exit(1) }

const ctxRe = /accountCode|account|treasury|Account|bal\(|rootOf|code|COA|debit|credit|Entry\(|counter/
let checkedCodes = 0
const unknown = new Map()
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(/'([1-5]\d{3})'/g)) {
    const ctx = src.slice(Math.max(0, m.index - 60), m.index + m[0].length + 20)
    if (!ctxRe.test(ctx)) continue
    checkedCodes++
    if (!coa.has(m[1])) {
      const key = m[1]
      if (!unknown.has(key)) unknown.set(key, new Set())
      unknown.get(key).add(f.slice(root.length + 1))
    }
  }
}
if (unknown.size) {
  fail++
  for (const [c, fs] of unknown) console.error(`✗ فئة هـ: كود ${c} غير معرف في COA — ${[...fs].slice(0, 3).join('، ')}`)
} else {
  console.log(`✓ فئة هـ: ${checkedCodes} استخداماً لأكواد حسابات كلها معرفة في COA (${coa.size} كوداً)`)
}

/* ═══ فئة و: مصفوفة معدلة منسية عن set() ═══ */
const repoLines = readFileSync(join(root, 'src/data/repo.ts'), 'utf8').split('\n')
const starts = []
repoLines.forEach((l, i) => {
  const m = l.match(/^ {6}(\w+): (\(|async \()/)
  if (m) starts.push([i, m[1]])
})
// استثناءات مراجَعة يدوياً: متغير مفرد (نتيجة find) لا مصفوفة — لا يمرر إلى set
const singularWhitelist = new Set(['postTrip:custodyFile'])
let flagged = []
for (let k = 0; k < starts.length; k++) {
  const [start, name] = starts[k]
  const end = k + 1 < starts.length ? starts[k + 1][0] : repoLines.length
  const body = repoLines.slice(start, end).join('\n')
  const reassigned = []
  for (const m of body.matchAll(/let (\w+)(?::[^=\n]+)? = (?:state|get\(\))\.(\w+)/g)) {
    const [, v, field] = m
    if (new RegExp(`\\n\\s+${v} = `).test(body)) reassigned.push([v, field])
  }
  if (!reassigned.length) continue
  const setBlocks = body.match(/set\(\{[\s\S]*?\}\)/g)
  if (!setBlocks) continue
  const settxt = setBlocks.join(' ')
  for (const [v, field] of reassigned) {
    if (singularWhitelist.has(`${name}:${v}`)) continue
    if (!new RegExp(`\\b${field}\\s*[:,}]`).test(settxt)) flagged.push(`${name}: عدّل ${v} (=${field}) ولم يمرره إلى set()`)
  }
}
if (flagged.length) {
  fail++
  for (const f of flagged) console.error(`✗ فئة و: ${f}`)
} else {
  console.log(`✓ فئة و: ${starts.length} إجراء — كل مصفوفة أعيد بناؤها محلياً ممررة إلى set()`)
}

if (fail) process.exit(1)
console.log('\n✅ الفئتان هـ وو مسدودتان بفحص ساكن دائم')
