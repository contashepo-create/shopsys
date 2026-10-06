/**
 * المرحلة 3 (ب) — لكل نشاط طريق إيراد موثّق وتغطية اختبارية خاصة به.
 *
 * السؤال: هل كل نشاط من الـ29 يملك فعلاً مساراً محاسبياً يكسب به (قيد يمس حساب إيراد 4xxx)،
 * وهل هذا المسار مغطى ببوابة تحقق مخصصة له، أم أن نشاطاً ما «واجهة بلا محرك»؟
 *
 * المصدر: مصفوفة المحرك المولّدة (عمود الأنشطة) + ملفات البوابات + خريطة رؤية الحسابات.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_phase3_activity_revenue_map.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { reporter, ACTIVITY_IDS } from './auditKit.mjs'
import { ACTIVITY_TEMPLATES, effectiveModules } from '../src/core/activities.ts'
import { coaForModules } from '../src/core/coaVisibility.ts'
import { STANDARD_COA } from '../src/core/ledger.ts'

const R = reporter('المرحلة 3 (ب) — خريطة إيراد كل نشاط وتغطيته')
import { fileURLToPath } from 'node:url'
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const matrix = readFileSync(`${ROOT}/docs/مصفوفة_المحرك_المحاسبي.md`, 'utf8')
const gateFiles = readdirSync(`${ROOT}/app/scripts`).filter((f) => /^verify_.*\.mjs$/.test(f))
const gateBlob = gateFiles.map((f) => `${f}\n${readFileSync(`${ROOT}/app/scripts/${f}`, 'utf8')}`).join('\n')

// أسطر المصفوفة: | الدالة | المستند | نوع المصدر | مدين | دائن | يفوّض | الوحدات | عدد الأنشطة |
// عمود «الوحدات» يحمل أسماء الوحدات (inventory، pos…) مفصولة بفاصلة عربية، و«—» = مسار عام لكل نشاط.
const rows = matrix.split('\n').filter((l) => l.startsWith('| `'))
assert.ok(rows.length >= 200, `المصفوفة ناقصة (${rows.length} صفاً)`)
R.ok(`المصفوفة تحوي ${rows.length} مسار ترحيل صالحاً للتحليل`)

/** أنشطة الصف (العمود قبل الأخير) ونصّه الكامل */
const parsed = rows.map((line) => {
  const cells = line.split('|').map((x) => x.trim()).filter((x) => x !== '')
  const modCell = cells[cells.length - 2] ?? '—'
  const mods = modCell === '—' ? [] : modCell.split(/[،,]/).map((s) => s.trim()).filter(Boolean)
  return { all: line, mods, generic: mods.length === 0 }
})
const rowsFor = (activityMods) => parsed.filter((r) => r.generic || r.mods.some((m) => activityMods.includes(m)))

const REVENUE_RE = /4\d{3}/
const missingRevenue = []
const missingGate = []
const table = []

for (const activityId of ACTIVITY_IDS) {
  const tpl = ACTIVITY_TEMPLATES.find((t) => t.id === activityId)
  assert.ok(tpl, `القالب ${activityId} غير موجود`)
  const mods = effectiveModules(activityId, [])
  const visible = coaForModules(STANDARD_COA, mods)
  const revenueAccounts = visible.filter((a) => a.rootType === 'revenue' && a.isPostable)
  assert.ok(revenueAccounts.length > 0, `${activityId}: لا حساب إيراد مرئي في شجرته`)

  // مسارات هذا النشاط: ما يخص وحدة من وحداته + المسارات العامة
  const own = rowsFor(mods)
  const ownRevenue = own.filter((r) => REVENUE_RE.test(r.all))
  if (ownRevenue.length === 0) missingRevenue.push(activityId)

  // تغطية اختبارية: بوابة تذكر معرّف النشاط صراحة
  const gateHits = gateFiles.filter((f) => new RegExp(`'${activityId}'|"${activityId}"`).test(readFileSync(`${ROOT}/app/scripts/${f}`, 'utf8')))
  if (gateHits.length === 0) missingGate.push(activityId)
  table.push({ activityId, mods: mods.length, rev: revenueAccounts.length, paths: own.length, revPaths: ownRevenue.length, gates: gateHits.length })
}

assert.deepEqual(missingRevenue, [], `أنشطة بلا طريق إيراد موثّق: ${missingRevenue.join('، ')}`)
R.ok('كل نشاط من الـ29 له حساب إيراد مرئي ومسار ترحيل يوصله إليه — لا نشاط «واجهة بلا محرك»')
assert.deepEqual(missingGate, [], `أنشطة بلا بوابة تذكرها: ${missingGate.join('، ')}`)
R.ok(`كل نشاط مذكور صراحةً في بوابة تحقق واحدة على الأقل (${gateFiles.length} بوابة)`)

// الأنشطة المتخصصة: محركها الخاص يجب أن يظهر في المصفوفة بمسارات مستقلة عن الكاشير
// حساب الإيراد الجوهري لكل نشاط متخصص كما يثبته محركه فعلياً في المصفوفة
const SPECIALIZED = {
  contracting: '4107', // إيرادات مقاولات (مستخلصات)
  lab: '4106',         // إيرادات تحاليل
  clinic: '4108',      // إيرادات كشف وعلاج
  realestate: '4113',  // إيرادات إيجار عقارات
  logistics: '4105',   // إيرادات نقل ونقلات
  laundry: '4103',     // إيرادات صيانة وخدمات (أوامر الغسيل)
  equipment_rental: '4104', // إيرادات تأجير معدات
  cars: '4101',        // مبيعات (فاتورة بيع السيارة)
}
for (const [activityId, code] of Object.entries(SPECIALIZED)) {
  const mods = effectiveModules(activityId, [])
  const hit = rowsFor(mods).filter((r) => r.all.includes(code))
  assert.ok(hit.length > 0, `${activityId}: لا مسار ترحيل يثبت إيراده على ${code}`)
}
R.ok('الأنشطة الثمانية المتخصصة: كل واحد يثبت إيراده على حسابه الجوهري (4107/4106/4108/4113/4105/4103/4104/4101)')

// لا نشاط يتقاسم حساب إيراد متخصص مع نشاط لا يملك وحدته
for (const [code, expected] of Object.entries({ '4107': 'contracting', '4106': 'lab', '4108': 'clinic', '4113': 'realestate' })) {
  for (const activityId of ACTIVITY_IDS) {
    const mods = effectiveModules(activityId, [])
    const visible = coaForModules(STANDARD_COA, mods).map((a) => a.code)
    if (visible.includes(code)) assert.ok(mods.includes(expected), `${activityId} يرى ${code} بلا وحدة ${expected}`)
  }
}
R.ok('حسابات الإيراد المتخصصة لا تتسرب لأنشطة لا تملك وحداتها — لا خلط بين إيرادات الأنشطة')

// التغطية الاختبارية موثقة رقمياً
const weak = table.filter((t) => t.gates < 1)
assert.equal(weak.length, 0)
const lines = table.map((t) => `${t.activityId.padEnd(19)} وحدات ${String(t.mods).padStart(2)} · حسابات إيراد ${String(t.rev).padStart(2)} · مسارات ${String(t.paths).padStart(3)} (منها ${String(t.revPaths).padStart(2)} إيراد) · بوابات ${t.gates}`)
console.log('\n' + lines.join('\n') + '\n')
assert.ok(gateBlob.length > 0)
R.ok('جدول التغطية طُبع أعلاه: وحدات وحسابات إيراد ومسارات ترحيل وبوابات لكل نشاط')

R.done('— لا نشاط بلا طريق كسب موثّق، ولا حساب إيراد متخصص يتسرب لنشاط لا يملكه')
