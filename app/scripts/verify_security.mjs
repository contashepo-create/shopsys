/**
 * فحص طبقة الحماية (القرار 28): تشفير + قفل + حرق مفاتيح + ربط النشاط + سحابة + نسخ ساعي
 * node --experimental-strip-types scripts/verify_security.mjs
 */
import {
  deriveKey, encryptText, decryptText, isEncrypted,
  isBackupDue, pushSnapshot, lockReasonFor, LOCK_REASON_LABELS, toCsv,
  HOURLY_BACKUP_KEEP,
} from '../src/core/security.ts'
import {
  activityMatches, keyFingerprint, isRevoked, canonicalPayload, b64uDecode,
  DEVELOPER_PUBLIC_KEY_B64U, evaluateLicense, PLAN_LIMITS, effectiveLimits,
} from '../src/core/license.ts'
import { parseAbout, parseRevocationList, FALLBACK_ABOUT, mergeRevocationLists } from '../src/core/cloud.ts'
import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++ } else { fail++; console.error(`❌ ${name}`) } }

/* ═══ التشفير AES-256-GCM ═══ */
const key = await deriveKey('SHOP-TEST-DEVICE-1234')
const secret = 'بيانات المحل السرية — فواتير وأرصدة {"a":1}'
const enc = await encryptText(secret, key)
ok(enc.startsWith('SSENC1.'), 'الشفرة تبدأ بالبادئة')
ok(isEncrypted(enc), 'isEncrypted يتعرف عليها')
ok(!isEncrypted(secret), 'النص العادي ليس شفرة')
ok(await decryptText(enc, key) === secret, 'فك التشفير يعيد الأصل بالضبط (عربي + JSON)')
const enc2 = await encryptText(secret, key)
ok(enc !== enc2, 'IV عشوائي: نفس النص ⇒ شفرتان مختلفتان')
ok(await decryptText(enc2, key) === secret, 'الشفرة الثانية تُفك أيضاً')
// مفتاح جهاز آخر لا يفك
const otherKey = await deriveKey('SHOP-OTHER-DEVICE-9999')
let failedDecrypt = false
try { await decryptText(enc, otherKey) } catch { failedDecrypt = true }
ok(failedDecrypt, 'قاعدة منسوخة لجهاز آخر لا تُفك (GCM يرفض)')
// عبث بالشفرة يكسر السلامة
let tampered = false
try { await decryptText(enc.slice(0, -4) + 'AAAA', key) } catch { tampered = true }
ok(tampered, 'أي تلاعب بالشفرة يُكشف')

/* ═══ النسخ الساعي ═══ */
ok(isBackupDue(null, '2026-09-14T10:00:00Z'), 'لا لقطات ⇒ مستحق فوراً')
ok(isBackupDue('2026-09-14T08:59:00Z', '2026-09-14T10:00:00Z'), 'مرت ساعة ⇒ مستحق')
ok(!isBackupDue('2026-09-14T09:30:00Z', '2026-09-14T10:00:00Z'), 'نصف ساعة فقط ⇒ غير مستحق')
let ring = []
for (let i = 0; i < 5; i++) ring = pushSnapshot(ring, { at: `T${i}`, checksum: '', data: '' })
ok(ring.length === HOURLY_BACKUP_KEEP, `الحلقة تحفظ ${HOURLY_BACKUP_KEEP} فقط`)
ok(ring[0].at === 'T4' && ring[2].at === 'T2', 'الأحدث أولاً والأقدم يسقط')

/* ═══ منطق القفل ═══ */
const today = '2026-09-14'
const mk = (payload) => evaluateLicense({ activatedPayload: payload, trialStartedAt: '2026-09-01', lastSeenAt: today, today })
ok(lockReasonFor(mk(null)) === null, 'تجربة سارية ⇒ لا قفل')
ok(lockReasonFor(evaluateLicense({ activatedPayload: null, trialStartedAt: '2026-08-01', lastSeenAt: today, today })) === 'trial_expired', 'تجربة منتهية ⇒ قفل')
const activePayload = { v: 1, deviceId: 'D', customer: 'c', plan: 'pro', features: [], issuedAt: '2026-09-01', expiresAt: '2026-12-01' }
ok(lockReasonFor(mk(activePayload)) === null, 'مفتاح سارٍ ⇒ لا قفل')
ok(lockReasonFor(mk({ ...activePayload, expiresAt: '2026-09-10' })) === 'expired', 'مفتاح منتهٍ ⇒ قفل expired')
ok(lockReasonFor(evaluateLicense({ activatedPayload: null, trialStartedAt: '2026-09-01', lastSeenAt: '2026-09-20', today })) === 'clock_tampered', 'ساعة مرجعة ⇒ قفل')
ok(lockReasonFor(mk(activePayload), { revoked: true }) === 'revoked', 'مفتاح محروق ⇒ قفل حتى لو سارٍ')
ok(lockReasonFor(mk(activePayload), { activityMismatch: true }) === 'activity_mismatch', 'نشاط مختلف ⇒ قفل')
/* ث9: العدد مشتق من اتحاد النوع في المصدر — رقم ثابت يُنسى مع كل سبب جديد */
const lockUnion = (readFileSync(new URL('../src/core/security.ts', import.meta.url), 'utf8')
  .match(/export type LockReason = ([^\n]+)/)?.[1] ?? '')
  .split('|').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean)
ok(lockUnion.length >= 6 && lockUnion.every((r) => LOCK_REASON_LABELS[r]?.title && LOCK_REASON_LABELS[r]?.desc), 'كل أسباب القفل لها نصوص')
ok(lockReasonFor(mk(activePayload), { unverifiable: true }) === 'license_unverifiable', 'تعذّر التحقق ⇒ سبب صادق لا حكم خاطئ')
ok(lockReasonFor(mk(activePayload), { revoked: true, unverifiable: true }) === 'revoked', 'الحرق أسبق من تعذّر التحقق')
/* ث8: اتحاد قائمتَي الإبطال من العاملين — null = أوفلاين فلا يمسّ المحفوظ */
ok(JSON.stringify(mergeRevocationLists(['1a2b3c4d'], ['1a2b3c4d', 'deadbeef'])) === '["1a2b3c4d","deadbeef"]', 'دمج القائمتين بلا تكرار')
ok(mergeRevocationLists(null, null) === null, 'تعذّر الجلب من الطرفين ⇒ null (لا مسح للمحفوظ)')
ok(isRevoked('SHOPSYS1.a.b', mergeRevocationLists(null, [keyFingerprint('SHOPSYS1.a.b')]) ?? []), 'حرق من العامل الثاني وحده نافذ')

/* ═══ ربط المفتاح بالنشاط ═══ */
ok(activityMatches({ ...activePayload, activityId: 'pharmacy' }, 'pharmacy'), 'نشاط مطابق يمر')
ok(!activityMatches({ ...activePayload, activityId: 'pharmacy' }, 'grocery'), 'نشاط مختلف يُرفض')
ok(!activityMatches({ ...activePayload, activityId: 'pharmacy' }, null), 'لا نشاط بعد ⇒ يُرفض')
ok(activityMatches(activePayload, 'grocery'), 'مفتاح قديم بلا ربط يعمل مع أي نشاط')
// activityId يدخل الصيغة القانونية الموقعة — التلاعب به يكسر التوقيع
const c1 = canonicalPayload({ ...activePayload, activityId: 'pharmacy' })
const c2 = canonicalPayload({ ...activePayload, activityId: 'grocery' })
const c3 = canonicalPayload(activePayload)
ok(c1 !== c2 && c1 !== c3, 'activityId جزء من التوقيع — لا يُبدل')
ok(c1.includes('pharmacy'), 'الصيغة القانونية تتضمن النشاط')

/* ═══ المفتاح العام ═══ */
ok(b64uDecode(DEVELOPER_PUBLIC_KEY_B64U).length === 32, 'المفتاح العام المضمّن صالح بطول Ed25519')

/* ═══ حرق المفاتيح ═══ */
const keyStr = 'SHOPSYS1.eyJ2IjoxfQ.c2lnbmF0dXJlLXNhbXBsZQ'
const fp = keyFingerprint(keyStr)
ok(/^[0-9a-f]{8}$/.test(fp), 'البصمة 8 خانات hex')
ok(keyFingerprint(keyStr) === fp, 'البصمة حتمية')
ok(isRevoked(keyStr, [fp]), 'مفتاح في القائمة = محروق')
ok(!isRevoked(keyStr, ['00000000']), 'مفتاح خارج القائمة يعمل')
ok(keyFingerprint('SHOPSYS1.eyJ2IjoxfQ.OTHER-SIG') !== fp, 'توقيع مختلف ⇒ بصمة مختلفة')

/* ═══ الباقات: تعدد المستخدمين مدفوع ═══ */
ok(PLAN_LIMITS.trial.maxUsers === 1 && PLAN_LIMITS.basic.maxUsers === 1, 'التجربة والأساسي مستخدم واحد (التعدد مدفوع)')
ok(PLAN_LIMITS.pro.maxUsers === 5 && PLAN_LIMITS.pro.multiInstance, 'الاحترافي 5 مستخدمين + تعدد نسخ')
ok(effectiveLimits({ ...activePayload, extraUsers: 3 }).maxUsers === 8, 'الزيادات المشتراة من البوت تُضاف')
ok(effectiveLimits(null).maxUsers === 1, 'بلا مفتاح = حدود التجربة')

/* ═══ السحابة (Cloudflare) ═══ */
/* معرّف تليجرام واقعي (≥ 4 محارف بعد نزع @) — القيمة القديمة '@dev' أقصر من
   الحد الأدنى القانوني لمعرّف تليجرام فتُرفض الآن بالتعقيم الصارم. */
const about = parseAbout({ title: 'نظامي', body: 'وصف', supportTelegram: '@dev_support', junk: 'x' })
/* بند 9 (تدقيق 2026-10-08): معرّف تليجرام يُوحَّد بلا «@» — العامل والعميل يعقّمانه
   بالعلاقة نفسها، والواجهة تضيف «@» للعرض فقط. فكان التوقع السابق '@dev' وهذا
   هو الشكل القانوني الجديد. والحقل junk يُتجاهل كما كان. */
ok(about.title === 'نظامي' && about.supportTelegram === 'dev_support', 'parseAbout ينقي ويقبل الصحيح (تليجرام بلا @)')
ok(about.junk === undefined, 'parseAbout يتجاهل الحقول غير المعروفة')
ok(parseAbout({ text: 'نص من بوت الترخيص' }).body === 'نص من بوت الترخيص', 'parseAbout يقبل نص «حول» من بوت الترخيص')
ok(parseAbout(null).title === FALLBACK_ABOUT.title, 'استجابة فاسدة ⇒ الاحتياطي')
ok(parseAbout({ title: 123 }).title === FALLBACK_ABOUT.title, 'نوع خاطئ ⇒ الاحتياطي')
const rl = parseRevocationList(['deadbeef', 'BAD', 123, 'cafe1234'])
ok(rl.length === 2 && rl.includes('deadbeef') && rl.includes('cafe1234'), 'قائمة الحرق: بصمات hex فقط')
ok(parseRevocationList({ text: '["deadbeef"]' }).includes('deadbeef'), 'قراءة استجابة بوت الترخيص القديمة')
ok(parseRevocationList('not-array').length === 0, 'قائمة فاسدة ⇒ فارغة')

/* ═══ تصدير CSV ═══ */
const csv = toCsv([{ الاسم: 'جبنة, بيضاء', السعر: 130 }, { الاسم: 'قال "أهلاً"', السعر: 5 }])
ok(csv.startsWith('\uFEFF'), 'BOM موجود (Excel عربي)')
ok(csv.includes('"جبنة, بيضاء"'), 'الفاصلة تُحاط بعلامات')
ok(csv.includes('"قال ""أهلاً"""'), 'علامات التنصيص تُهرَّب')
ok(toCsv([]) === '\uFEFF', 'صفوف فارغة ⇒ BOM فقط')

console.log(`PASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
console.log(`🎉 نجح فحص طبقة الحماية — ${pass} اختباراً`)
