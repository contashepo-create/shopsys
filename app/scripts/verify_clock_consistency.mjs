/**
 * بوابة اتساق الساعة: الحقل الواحد لا يُكتب بساعتين.
 *
 * العيب الذي أُنشئت لأجله (اكتُشف بكتابة اختبار سلوكي لجلست عمل الفني):
 * `startTicketWork` كان يختم `startedAt` بـ`new Date().toISOString()` (**UTC**) بينما
 * `stopTicketWork` يختم `endedAt` بـ`localIsoTimestamp()` (**محلي بإزاحة**) — طرفا الجلسة
 * نفسها على أساسين زمنيين، فتنقلب المقارنة النصية غرب غرينتش ويظهر زمن العمل سالباً.
 *
 * البوابة تصنع ثلاث طبقات:
 *  ① حصر: أي حقل يُكتب بالساعتين معاً (مخزون ديناميكي) — مجموعة مغلقة معلنة.
 *  ② سقف: عدد الكتابات بالساعة الثانية في الحقول المختلطة لا ينمو.
 *  ③ أزواج: كل زوج زمني (فتح/إغلاق، طلب/قرار) يجب أن يكون على ساعة واحدة.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { reporter } from './auditKit.mjs'

const R = reporter('اتساق الساعة في الحقول الزمنية')
const root = fileURLToPath(new URL('..', import.meta.url))
const repo = readFileSync(`${root}src/data/repo.ts`, 'utf8')

const UTC = 'new Date().toISOString()'
const LOCAL = 'localIsoTimestamp()'
const clockCount = (field, clock) => (repo.match(new RegExp(`${field}:\\s*${clock.replace(/[.()]/g, '\\$&')}`, 'g')) ?? []).length
const fields = [...new Set([...repo.matchAll(/(\w+):\s*(?:new Date\(\)\.toISOString\(\)|localIsoTimestamp\(\))/g)].map((m) => m[1]))]
const census = new Map(fields.map((field) => [field, { utc: clockCount(field, UTC), local: clockCount(field, LOCAL) }]))

const mixed = [...census.entries()].filter(([, value]) => value.utc > 0 && value.local > 0).map(([field]) => field).sort()
console.log(`  حقول زمنية مكتوبة: ${fields.length} · مختلطة الساعة: ${mixed.length} (${mixed.join('، ')})`)

/** الحقول المختلطة المعروفة اليوم — سقفها لا ينمو، وأي حقل جديد مختلط يُفشل البوابة. */
const DOCUMENTED_MIXED = new Map([
  ['at', { utc: 17, local: 7, reason: 'ختم أحداث (تدقيق/إشعارات/تاريخ حالات): التدقيق UTC وبعض المستندات محلي — يحتاج توحيداً تدريجياً' }],
  ['createdAt', { utc: 7, local: 3, reason: 'ختم إنشاء مستندات متفرقة: بعضها UTC وبعضها محلي — يحتاج توحيداً' }],
])
const undocumented = mixed.filter((field) => !DOCUMENTED_MIXED.has(field))
assert.deepEqual(undocumented, [], `حقول جديدة تُكتب بساعتين مختلفتين: ${undocumented.join('، ')}`)
for (const [field, ceiling] of DOCUMENTED_MIXED) {
  const actual = census.get(field) ?? { utc: 0, local: 0 }
  assert.ok(actual.utc <= ceiling.utc, `الكتابة بساعة UTC في «${field}» زادت إلى ${actual.utc} (السقف ${ceiling.utc})`)
  assert.ok(actual.local <= ceiling.local, `الكتابة بالساعة المحلية في «${field}» زادت إلى ${actual.local} (السقف ${ceiling.local})`)
}
R.ok(`${mixed.length} حقل مختلط موثق بسقف لا ينمو (${mixed.map((field) => `${field}: ${census.get(field).utc}UTC/${census.get(field).local}محلي`).join(' · ')})`)

/* ③ الأزواج: طرفا أي فترة زمنية على ساعة واحدة */
const PAIRS = [
  ['openedAt', 'closedAt'],
  ['requestedAt', 'decidedAt'],
  ['receivedAt', 'arrivedAt'],
]
for (const [start, end] of PAIRS) {
  const a = census.get(start)
  const b = census.get(end)
  if (!a || !b) continue
  const clockOf = (value) => (value.utc > 0 && value.local > 0 ? 'mixed' : value.utc > 0 ? 'utc' : 'local')
  assert.equal(clockOf(a), clockOf(b), `طرفا الزمن «${start}» و«${end}» على ساعتين مختلفتين (${clockOf(a)} ≠ ${clockOf(b)})`)
}
R.ok(`${PAIRS.length} زوجاً زمنياً متسق الساعة (فتح/إغلاق، طلب/قرار، استلام/وصول)`)

/* ④ حارس الانحدار على العيب المصلح: لا بداية جلسة عمل بساعة UTC */
assert.ok(!/startedAt:\s*new Date\(\)\.toISOString\(\)/.test(repo), 'جلسة عمل تبدأ بختم UTC — يجب استخدام الساعة المحلية')
const sessionsPair = /startedAt:\s*localIsoTimestamp\(\)/.test(repo)
assert.ok(sessionsPair, 'بداية جلسة العمل لم تعد تستخدم الساعة المحلية')
R.ok('جلسة عمل الفني: البداية والنهاية على الساعة المحلية نفسها (انحدار مصلح)')

R.done()
