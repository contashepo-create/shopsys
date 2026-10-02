/**
 * بوابة مراجعة §85 — «الترخيص والأمان: النواة الكاملة» (جولة المالك السادسة على مصفوفة §70-هـ)
 * ─────────────────────────────────────────────────────────────────────────────
 * البوابات القائمة تغطي كل ملف بمفرده بقوة: verify_license (20: دورة Ed25519
 * حقيقية، الساعة المرجعة، التجربة، hasFeature) · verify_security (47: GCM،
 * الحلقة، أسباب القفل، activityMatches) · verify_backup (17) · verify_concurrency
 * (21) · verify_telegram (التوكن والإخفاء والرسائل) · verify_audit_support
 * (نواة auth ①②: حارس المحاولات، الرقم المؤقت، authRequired + support:
 * sanitizeText/buildSupportPayload/parseConversation) + اختبارا وحدة
 * (backup_roundtrip، support_auth). هذه الجولة تسد ما قِيس ناقصاً:
 *
 * ① حدود الباقات — الفجوة الوحيدة بلا أي تغطية (لا بوابة ولا اختبار):
 *    PLAN_LIMITS/effectiveLimits تُستدعى حياً من BranchesPage/LicensePage
 *    وتحدد ما يستطيع كل خطة فعله (مستخدمون/فروع/تعدد نسخ + زيادات البوت).
 * ② بصمة المفتاح والحرق: keyFingerprint (djb2 على جزء التوقيع) وisRevoked —
 *    آلية الإبطال السحابي (قرار 28) لم تُفحص قط.
 * ③ الصيغة القانونية مع الحقول الاختيارية الجديدة: extraModules/extraUsers —
 *    الترتيب الحتمي يضمن أن ترتيب الإصدار لا يغيّر التوقيع، وغياب الحقول
 *    الاختيارية يبقي مفاتيح الجيل الأول صحيحة (توافق موثق في المصدر).
 * ④ عيبا toCsv المكتشفان بالمسبار ومُصلحان (§85): كانت تأخذ العناوين من
 *    الصف الأول فقط فتُسقط حقول الصفوف اللاحقة بصمت (تصدير بيانات المستخدم
 *    من LockScreen/EmployeesPage)، وكانت تمر بادئات الصيغ (= + - @) خاماً
 *    فيُنفذها Excel عند الفتح (CSV injection بمدخلات مستخدم).
 * ⑤ ختام: مصدرية الإصلاح والقراءة.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_owner_license_security_family.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PLAN_LIMITS, effectiveLimits, keyFingerprint, isRevoked, canonicalPayload } from '../src/core/license.ts'
import { toCsv } from '../src/core/security.ts'

const here = fileURLToPath(new URL('.', import.meta.url))
const R = { n: 0, ok(msg) { this.n++; console.log('  ✓', msg) } }

// ——— ① حدود الباقات (الفجوة المؤكدة: بلا أي تغطية سابقة) ———
console.log('① حدود الباقات')
{
  // القيم التعاقدية للباقات (قرار المالك: الفرق = مستخدمون/فروع/تعدد نسخ)
  assert.deepEqual(PLAN_LIMITS.trial, { maxUsers: 1, maxBranches: 1, multiInstance: false })
  assert.deepEqual(PLAN_LIMITS.basic, { maxUsers: 1, maxBranches: 1, multiInstance: false })
  assert.deepEqual(PLAN_LIMITS.pro, { maxUsers: 5, maxBranches: 2, multiInstance: true })
  assert.deepEqual(PLAN_LIMITS.lifetime, { maxUsers: 10, maxBranches: 3, multiInstance: true })
  R.ok('أربع باقات بقيمها التعاقدية (تجربة/أساسي: 1 مستخدم فرع واحد، برو: 5/2، مدى الحياة: 10/3، وتعدد النسخ للعليا فقط)')

  // لا حمولة ⇒ حدود التجربة (أشدّ ما يمكن)
  assert.deepEqual(effectiveLimits(null), { maxUsers: 1, maxBranches: 1, multiInstance: false }, 'null ⇒ تجربة')
  R.ok('بلا مفتاح ⇒ حدود التجربة (لا يمكن أن يكون الافتراضي أوسع من التجربة)')

  // زيادات البوت فوق الحد
  const pro = { v: 1, deviceId: 'SHOP-AAAA-BBBB-CCCC', customer: 'بقالة النور', plan: 'pro', features: [], issuedAt: '2026-01-01', expiresAt: '2027-01-01', extraUsers: 3, extraBranches: 2 }
  assert.deepEqual(effectiveLimits(pro), { maxUsers: 8, maxBranches: 4, multiInstance: true }, 'pro + 3 مستخدمين + فرعين')
  R.ok('زيادات البوت (extraUsers/extraBranches) تضاف إلى حدود الباقة')

  // دفاع العمق: الزيادة السالبة/الصفرية/غير المعرّفة
  const poison = { ...pro, extraUsers: -99, extraBranches: -1 }
  assert.deepEqual(effectiveLimits(poison), { maxUsers: 5, maxBranches: 2, multiInstance: true }, 'سالب ⇒ يُقص إلى صفر')
  assert.equal(effectiveLimits({ ...pro, extraUsers: 0 }).maxUsers, 5, 'صفر ⇒ لا تغيير')
  assert.equal(effectiveLimits({ v: 1, deviceId: 'D', customer: 'C', plan: 'lifetime', features: [], issuedAt: '2026-01-01', expiresAt: null }).maxUsers, 10, 'بلا زيادات ⇒ حد الباقة')
  R.ok('زيادة سالبة (مفتاح مسروق معدَّل؟) تُقص بـ Math.max(0,…) — لا يمكن للزيادة أن تقلّص أو تنفجر')

  // تعدد النسخ ميزة الباقة فقط: لا يشترى بزيادة
  assert.equal(effectiveLimits({ ...pro, extraUsers: 99 }).multiInstance, true)
  assert.equal(effectiveLimits({ ...pro, plan: 'basic', extraBranches: 99 }).multiInstance, false, 'basic بـ99 فرعاً تبقى لا تعدد نسخ')
  R.ok('multiInstance يتبع الباقة حصراً — لا يشترى بزيادات البوت')
}

// ——— ② بصمة المفتاح والحرق (الإبطال السحابي — قرار 28) ———
console.log('② بصمة المفتاح والحرق')
{
  const key = 'SHOPSYS1.dGVzdA.dqTcvCH1vGWJxfSeofSAs0K5PALDsaw2'
  const fp = keyFingerprint(key)
  assert.match(fp, /^[0-9a-f]{8}$/, 'بصمة 8 خانات ست عشرية')
  assert.equal(keyFingerprint(key), fp, 'حتمية: نفس المفتاح ⇒ نفس البصمة')
  assert.equal(keyFingerprint(`  ${key}  `), fp, 'المسافات الحوافية تُتجاهل (نفس المفتاح من قائمة مبطنة بفراغات)')
  assert.notEqual(keyFingerprint('SHOPSYS1.dGVzdA.dqTcvCH1vGWJxfSeofSAs0K5PALDsaw3'), fp, 'محرف واحد في التوقيع ⇒ بصمة مختلفة (البصمة تتبع التوقيع لا الرأس)')
  assert.equal(keyFingerprint('مفتاح-مشوه-بلا-نقاط'), keyFingerprint('مفتاح-مشوه-بلا-نقاط'), 'مفتاح بلا نقاط ⇒ fallback للمفتاح كله بلا رمي')
  R.ok('keyFingerprint: djb2 على جزء التوقيع فقط، حتمية، تتجاهل الحواشي، لا ترمي على مشوه')

  assert.ok(isRevoked(key, [fp]), 'البصمة في قائمة الحرق ⇒ محروق')
  assert.ok(!isRevoked(key, ['deadbeef']), 'البصمة ليست في القائمة ⇒ سليم')
  assert.ok(isRevoked(` ${key} `, [fp]), 'فراغات حول المفتاح المحروق تُتجاهل (نفس القائمة تئده)')
  assert.ok(!isRevoked(key, []), 'قائمة فارغة ⇒ لا شيء محروق')
  R.ok('isRevoked: الحرق بالبصمة (لا المفتاح كاملاً) — قائمة الإبطال السحابية تعمل كما صُممت')
}

// ——— ③ الصيغة القانونية مع الحقول الاختيارية ———
console.log('③ الصيغة القانونية مع الحقول الاختيارية')
{
  const base = { v: 1, deviceId: 'SHOP-AAAA-BBBB-CCCC', customer: 'بقالة النور', plan: 'pro', features: ['telegram_bot', 'einvoice_eg'], issuedAt: '2026-01-01', expiresAt: '2027-01-01' }
  // ترتيب الميزات لا يغيّر الصيغة (مغطى في verify_license) — الجديد: extraModules وextraUsers
  assert.equal(
    canonicalPayload({ ...base, extraModules: ['صيانة', 'فروع'] }),
    canonicalPayload({ ...base, features: ['einvoice_eg', 'telegram_bot'], extraModules: ['فروع', 'صيانة'] }),
    'ترتيب الميزات والوحدات معاً لا يغيّر الصيغة',
  )
  R.ok('extraModules تُفرز مثل features — المفتاح لا يتغير بإعادة ترتيب الإصدار')

  const minimal = canonicalPayload(base)
  assert.ok(!minimal.includes('extraUsers') && !minimal.includes('extraBranches') && !minimal.includes('activityId') && !minimal.includes('extraModules'), 'الحقول الاختيارية الغائبة لا تدخل الصيغة')
  assert.ok(canonicalPayload({ ...base, extraUsers: 0 }).includes('"extraUsers":0'), 'extraUsers=0 موجودة صراحة (توقيع مختلف عن الغياب — المقصود)')
  R.ok('غياب الحقول الاختيارية يبقي صيغة الجيل الأول كما هي — التوافق الخلفي للتوقيعات موثق ومفحوص')

  const parsed = JSON.parse(canonicalPayload({ ...base, activityId: 'pharmacy', extraModules: ['ب', 'أ'] }))
  assert.equal(parsed.activityId, 'pharmacy')
  assert.deepEqual(parsed.extraModules, ['أ', 'ب'], 'الوحدات مفرزة داخل الصيغة نفسها')
  assert.equal(parsed.v, 1, 'إصدار الصيغة v=1')
  R.ok('الحمولة المحلولة تحمل كل ما وُقِّع — أي حقل اختياري موجود يوقَّع ويُتحقق (لا تلاعب بصمت)')
}

// ——— ④ عيبا toCsv المكتشفان بالمسبار ومُصلحان ———
console.log('④ toCsv: اتحاد المفاتيح + تحييد حقن الصيغ')
{
  // (أ) اتحاد المفاتيح: حقل يظهر أول مرة في صف لاحق لم يعد يُسقط بصمت
  const hetero = toCsv([
    { الصنف: 'شاي', الكمية: 3 },
    { الصنف: 'سكر', الكمية: 2, الهامش: 'سري' },
    { الصنف: 'أرز', الهامش: 'متأخر' }, // صف بلا «الكمية»
  ])
  const lines = hetero.slice(1).split('\n') // بلا BOM
  assert.equal(lines[0], 'الصنف,الكمية,الهامش', 'العناوين = اتحاد مفاتيح كل الصفوف بترتيب الظهور')
  assert.equal(lines[1], 'شاي,3,', 'الصف الأول: الحقل الجديد فارغ (undefined ⇒ فارغ كما كان)')
  assert.equal(lines[2], 'سكر,2,سري', 'حقل الصف الثاني يظهر')
  assert.equal(lines[3], 'أرز,,متأخر', 'الصف الثالث: الكمية الغائبة فارغة لا undefined')
  R.ok('① إصلاح §85-أ: لا حقل يُسقط بصمت — العناوين اتحاد كل الصفوف (كانت تؤخذ من الصف الأول فقط)')

  // (ب) حقن الصيغ: البادئات الخطرة تُسبق بـ' فتُعرض نصاً في Excel
  const injected = toCsv([{ الاسم: '=1+1', ب: '+HYPERLINK("http://evil")', ج: '@SUM(A1)', د: '\tTAB', هـ: '-2+3|cmd' }])
  const cells = injected.slice(1).split('\n')[1].split(',')
  assert.equal(cells[0], `'=1+1`, '= يُسبق')
  assert.ok(cells[1].includes(`'+HYPERLINK`), '+ يُسبق (داخل الاقتباس المزدوج — المحتوى سليم)')
  assert.equal(cells[2], `'@SUM(A1)`, '@ يُسبق')
  assert.ok(cells[3].startsWith(`'`), 'محرف الجدولة يُسبق')
  assert.ok(cells[4].startsWith(`'-2`), 'سالب يتبعه ما ليس رقماً (صيغة مقنّعة) يُسبق')
  R.ok('② إصلاح §85-ب: بادئات الصيغ (= + @ TAB و CR، وسالب غير رقمي) تُحيَّد — تصدير LockScreen/EmployeesPage يحمل مدخلات مستخدم')

  // (ج) السالب المشروع يبقى كما هو: الأرصدة والتقارير المالية لا تتشوه
  const money = toCsv([{ البيان: 'رصيد', المبلغ: -1250.5 }, { البيان: 'نسبة', المبلغ: '-2,500.75' }])
  assert.ok(money.includes('رصيد,-1250.5\n'), 'رقم سالب يمر حرفياً بلا تحييد (آخر عمود)')
  assert.ok(money.includes('"-2,500.75"'), 'سالب منسق بفواصل يمر (مقتبس للفاصلة، بلا بادئة \')')
  R.ok('الأرقام السالبة (ومنسقاتها) تمر كما هي — تحييد الحقن لا يلوث التقارير المالية')

  // (د) السلوك القديم الصحيح باقٍ: BOM، الفاصلة والاقتباس والسطر الجديد
  const legacy = toCsv([{ الاسم: 'جبنة, بيضاء', السعر: 130 }, { الاسم: `قال "أهلاً"`, السعر: 5 }])
  assert.equal(toCsv([]), '\uFEFF', 'فارغة ⇒ BOM فقط')
  assert.ok(legacy.startsWith('\uFEFF') && legacy.includes('"جبنة, بيضاء"') && legacy.includes('"قال ""أهلاً"""'), 'الهروب القديم (فاصلة/اقتباس مضاعف) سليم')
  R.ok('لا انكسار: كل فحوص verify_security القديمة لtoCsv ما زالت تمر بنفس المدخلات')
}

// ——— ⑤ ختام: مصدرية الإصلاح ———
console.log('⑤ مصدرية الإصلاح')
{
  const src = readFileSync(here + '../src/core/security.ts', 'utf8')
  assert.ok(src.includes('إصلاح §85') || src.includes('حقن الصيغ'), 'إصلاح toCsv موثق في مكانه (اتحاد المفاتيح + تحييد الحقن)')
  assert.ok(src.includes("Object.keys(rows[0])") === false, 'لم يبقَ أخذ العناوين من الصف الأول وحده')
  const license = readFileSync(here + '../src/core/license.ts', 'utf8')
  assert.ok(license.includes('Math.max(0, payload?.extraUsers ?? 0)'), 'قص الزيادات السالبة موثق في المصدر')
  R.ok('عيباه (إسقاط الحقول بصمت + حقن الصيغ) مُصلحان وموثقان في security.ts')
}

console.log(`\n✅ الترخيص والأمان — النواة الكاملة (§85): ${R.n} فحصاً ناجحاً`)
