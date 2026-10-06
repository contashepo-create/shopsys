#!/usr/bin/env node
/**
 * بوابة جولة v1.0.7 — موافقة المالك على تنفيذ الاقتراحات (باستثناء النقل
 * إلى Cloudflare المؤجل لمرحلة أخيرة):
 *   ① تشفير قاعدة البيانات بمفتاح الجهاز (AES-256-GCM قبل SQLite).
 *   ② قفل النشاط: التغيير فقط بمفتاح SHOPSYS2 موقّع من الدعم الفني،
 *      بتقييد 30 يوماً بين تغييرين، ومفتاح التفعيل القديم يظل صالحاً.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const DIR = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(DIR, '..', p), 'utf8').replace(/\r\n/g, '\n')
let failed = 0
const failedNames = []
const check = (name, ok) => {
  console.log(`${ok ? '✓' : '✗'} ${name}`)
  if (!ok) { failed++; failedNames.push(name) }
}

/* ─── ① تشفير القاعدة بمفتاح الجهاز ─── */
const ps = read('src/data/persistentStorage.ts')
check('① تشفير AES-256-GCM للقطات (encryptSnapshotForDevice/decryptSnapshotForDevice)', ps.includes('encryptSnapshotForDevice') && ps.includes('decryptSnapshotForDevice'))
check('① صيغة enc:v1 مميزة عن اللقطات النصية القديمة (توافق رجعي)', ps.includes("const ENC_PREFIX = 'enc:v1:'") && ps.includes('isEncryptedSnapshot'))
check('① setItem يشفر قبل عبور IPC إلى SQLite', ps.includes('const storedPayload = key ? await encryptSnapshotForDevice(value, key) : value'))
check('① قراءة اللقطة المشفرة تفك بالذاكرة وترفض مفتاح جهاز آخر برسالة واضحة', ps.includes('منسوخة من جهاز آخر'))
const main = read('desktop/main.ts')
check('① main: مفتاح الجهاز يولَّد مرة في userData/device.key (32 بايت)', main.includes('ensureDeviceEncryptionKey') && main.includes("device.key"))
check('① main: IPC ‏device:getEncryptionKey مكشوف للpreload فقط', main.includes("ipcMain.handle('device:getEncryptionKey'"))
const preload = read('desktop/preload.ts')
check('① preload يكشف getEncryptionKey ضمن عقد القاعدة', preload.includes('getEncryptionKey'))

/* ─── ② قفل النشاط وتغييره بمفتاح موقّع ─── */
const lic = read('src/core/license.ts')
check('② مفتاح SHOPSYS2 موقّع (canonicalActivityChangePayload + verifyActivityChangeKey)', lic.includes('ACTIVITY_KEY_PREFIX') && lic.includes('verifyActivityChangeKey'))
check('② تقييد التغيير 30 يوماً (ACTIVITY_CHANGE_COOLDOWN_DAYS)', lic.includes('ACTIVITY_CHANGE_COOLDOWN_DAYS = 30'))
check('② activityMatches تقبل سجل الأنشطة المرخصة — مفتاح التفعيل القديم يظل صالحاً', lic.includes('licensedActivityHistory'))
const store = read('src/stores/app.store.ts')
check('② المتجر: applyActivityChangeKey يطبق القالب ويسجل التاريخ والتقييد', store.includes('applyActivityChangeKey') && store.includes('activityKeyHistory') && store.includes('lastActivityChangeAt'))
check('② التفعيل يثبّت بداية سجل الأنشطة المرخصة', store.includes('activityKeyHistory.length > 0'))
const gsp = read('src/ui/pages/GeneralSettingsPage.tsx')
check('② الإعدادات العامة: زر «تغيير النشاط بمفتاح الدعم» بنافذة إدخال', gsp.includes('تغيير النشاط بمفتاح الدعم') && gsp.includes('applyActivityChangeKey'))
check('② النشاط يظهر بتاريخ آخر تغيير وحد التقييد', gsp.includes('lastActivityChangeAt') && gsp.includes('كل 30 يوماً'))

/* ─── ③ أدوات المطوّر (بوت/CLI) ─── */
const botLib = read('../tools/devbot/src/licenseLib.js')
check('③ مركز المطوّر: issueActivityChangeKey بنفس صيغة العميل', botLib.includes('issueActivityChangeKey') && botLib.includes('canonicalActivityChangePayload'))
const worker = read('../tools/devbot/src/worker.js')
check('③ أمر البوت /مفتاح_نشاط (لوحة المطوّر) يولّد المفتاح لجهاز مشترك', worker.includes("'/مفتاح_نشاط'") && worker.includes('issueActivityChangeKey'))
const cli = readFileSync(join(DIR, '../..', 'tools/devbot/scripts/keygen-activity.mjs'), 'utf8')
check('③ أداة CLI محلية تعمل اليوم بلا نشر (keygen-activity.mjs)', cli.includes('issueActivityChangeKey') && cli.includes('DEV_PRIVATE_KEY_B64U'))

/* ─── ④ الاختبارات الدائمة ─── */
const encTest = read('tests/desktop_db_encryption.test.ts')
check('④ اختبار التشفير: دورة + مفتاح جهاز آخر مرفوض + IV عشوائي + توافق نصي', encTest.includes('otherDevice') && encTest.includes('IV عشوائي'))
const actTest = read('tests/activity_change_key.test.ts')
check('④ اختبار مفتاح النشاط: دورة كاملة + تقييد 30 + أمان الرفض', actTest.includes('activityKeyHistory') && actTest.includes('باقٍ') && actTest.includes('جهاز آخر'))
const compat = read('tests/devbot_license_compat.test.ts')
check('④ التوافق الذهبي: مفتاح نشاط البوت يمر بتحقق العميل', compat.includes('issueActivityChangeKey') && compat.includes('verifyActivityChangeKey'))

if (failed === 0) console.log('\nبوابة v1.0.7: ✓ كل فحوص الاقتراحين سليمة')
else {
  console.log(`\nبوابة v1.0.7: ✗ ${failed} فحص فاشل — الفاشلة: ${failedNames.join(' · ')}`)
  process.exit(1)
}
