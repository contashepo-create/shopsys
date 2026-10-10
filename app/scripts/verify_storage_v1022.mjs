/**
 * بوابة التخزين والنسخ الاحتياطي (v1.0.22) — فحوص بنيوية على الكود الحقيقي،
 * لأن Electron لا يعمل داخل بيئة الاختبار. المنطق الخالص مختبر في
 * tests/storage_policy_v1022.test.ts.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (rel) => readFileSync(join(root, rel), 'utf8')
const main = read('desktop/main.ts')
const preload = read('desktop/preload.ts')
const bridge = read('src/data/desktopBridge.ts')
const lock = read('src/ui/LockScreen.tsx')
const updater = read('src/ui/components/DesktopUpdater.tsx')
const about = read('src/ui/pages/AboutPage.tsx')

let failures = 0
const check = (name, cond) => {
  if (cond) console.log(`✓ ${name}`)
  else { failures++; console.log(`❌ ${name}`) }
}

check('النسخ الساعية: 24 نسخة كل ساعة (يوم واحد) — من storagePolicy', /hourly:\s*\{\s*keep:\s*24,\s*ms:\s*60 \* 60 \* 1000\s*\}/.test(read('desktop/storagePolicy.ts')))
check('النسخ الساعية تُكتب في المكان الافتراضي userData/backups دائماً', /join\(app\.getPath\('userData'\), 'backups', kind\)/.test(main))
check('rotateBackups يستقبل القاعدة صراحة', /async function rotateBackups\(target: ShopsysDatabase \| null = database\)/.test(main))
check('before-quit يمرّر القاعدة المغلقة للنسخة (إصلاح: كانت تُصفَّر فتخرج بلا نسخة)', /void rotateBackups\(closing\)/.test(main) && !/void rotateBackups\(\)\s*\n\s*\.catch/.test(main))
check('نسخة قبل التحديث تُؤخذ فور اكتمال التنزيل', /state\.status === 'downloaded'[\s\S]{0,400}backupBeforeUpdate\(state\.version\)/.test(main))
check('نسخة ما قبل التحديث في backups/pre-update', /join\(app\.getPath\('userData'\), 'backups', 'pre-update'\)/.test(main))
check('التثبيت ينتظر نسخة ما قبل التحديث ويرفض بلا نسخة', /await preUpdateBackup[\s\S]{0,300}throw new Error\('تعذّرت النسخة الاحتياطية قبل التحديث/.test(main))
check('التثبيت يعيد التشغيل تلقائياً (quitAndInstall(false, true))', /autoUpdater\.quitAndInstall\(false, true\)/.test(main))
check('مؤشر المكان المخصص يُرآى في المكان الافتراضي وبجوار القاعدة', /locationPointerMirrorsAt/.test(read('desktop/dbLocation.ts')) && /'backups', 'db-location\.json'/.test(read('desktop/dbLocation.ts')) && /writeDbLocationAt\(/.test(read('desktop/dbLocation.ts')))
check('استعادة المؤشر من المرآة عند فقدانه', /export function restoreLocationPointerAt/.test(read('desktop/dbLocation.ts')) && /restoreLocationPointerIfMissing\(\)\s*\n\s*await resolveMissingLocation/.test(main))
check('لا فتح صامت لقاعدة فارغة: مكان مفقود أو ملف اختفى ⇒ سؤال المستخدم', /resolveMissingLocation/.test(main) && /file-missing|folder-missing/.test(main))
check('خيار «المكان الافتراضي مؤقتاً» (الفارغ) أُزيل', !/المكان الافتراضي مؤقتاً/.test(main) && !/useDefaultDbForSession/.test(main))
check('اكتشاف البيانات السابقة عند أول تشغيل قبل أي معالج', /await offerExistingData\(\)/.test(main) && /Tahakom\\\\+shopsys\.db/.test(main))
check('القاعدة الحيّة المكتشفة تُعتمد في مكانها (لا نسخ)', /adoptExistingData[\s\S]{0,200}kind === 'live'/.test(main))
check('تاريخ فتح المكان المخصص يُسجَّل لكشف اختفاء الملف', /customDbOpenedAt: new Date\(\)\.toISOString\(\)/.test(main))
check('shieldDamagedDatabase يسترد من كل الأجيال (ساعي/قبل التحديث)', /join\(ud, 'backups', 'hourly'\)/.test(main) && /join\(ud, 'backups', 'pre-update'\)/.test(main))
check('فشل مفتاح الجهاز يُبلَّغ برسالة ولا يصمت', /تعذّر تهيئة مفتاح الجهاز/.test(main))
check('تصدير SQLite كامل بحوار حفظ (database:exportCopy)', /ipcMain\.handle\('database:exportCopy'/.test(main) && /raw\.backup\(result\.filePath\)/.test(main))
check('preload يعرض exportCopy', /exportCopy: \(\) => ipcRenderer\.invoke\('database:exportCopy'\)/.test(preload))
check('عقد الجسر يصف exportCopy', /exportCopy\(\): Promise/.test(bridge))
check('شاشة القفل تعرض Excel شاملاً وSQLite', /exportExcel/.test(lock) && /exportSqlite/.test(lock) && /قاعدة SQLite \(\.db\)/.test(lock))
check('زر التحديث يعالج الخطأ بدل unhandled', /setInstallError/.test(updater) && /await bridge\.install\(\)/.test(updater))
const keyRecoveryTs = read('desktop/keyRecovery.ts')
const keyStoreTs = read('desktop/deviceKeyStore.ts')
const desktopKeyUi = read('src/ui/components/DesktopKeyRecovery.tsx')
const backupPage = read('src/ui/pages/BackupPage.tsx')
const appTsx = read('src/App.tsx')
check('مفتاح الاسترداد: PBKDF2 بـ600000 تكرار + AES-256-GCM مع ترويسة مربوطة AAD', /KEY_RECOVERY_ITERATIONS = 600_000/.test(keyRecoveryTs) && /aes-256-gcm/.test(keyRecoveryTs) && /setAAD\(/.test(keyRecoveryTs))
check('مفتاح الاسترداد: تكرارات أقل من الحد مرفوضة (منع خفض القوة)', /KEY_RECOVERY_MIN_ITERATIONS/.test(keyRecoveryTs) && /iterations < KEY_RECOVERY_MIN_ITERATIONS/.test(keyRecoveryTs))
check('الاستيراد يحتفظ بالنسخة الحالية ولا يحذفها (replaced-)', /\.replaced-/.test(keyStoreTs) && /storeRecoveredDeviceKey/.test(keyStoreTs))
check('الاستيراد لا يكتب مفتاحاً صريحاً على القرص', !/storeRecoveredDeviceKey[\s\S]{0,900}writePlaintextKey/.test(keyStoreTs))
check('IPC مفتاح الاسترداد: status/export/import مسجلة في main', /keyRecovery:status/.test(main) && /keyRecovery:export/.test(main) && /keyRecovery:import/.test(main))
check('التصدير لا يكشف المفتاح الخام (يُغلَّف فقط)', /wrapDeviceKey\(deviceEncryptionKey, passphrase/.test(main) && !/device:getEncryptionKey[\s\S]{0,10}raw/.test(main))
check('الاستيراد يعيد التشغيل بعد النجاح', /app\.relaunch\(\); app\.exit\(0\)/.test(main))
check('preload يعرض keyRecovery فقط عبر contextBridge', /keyRecovery,\s*\}\)|notifications, keyRecovery \}/.test(preload))
check('الواجهة لا تستورد node:crypto ولا keyRecovery.ts (تبقى في العملية الرئيسية)', !/from ['"]node:crypto['"]|from ['"][^'"\n]*desktop\/keyRecovery/.test(desktopKeyUi + backupPage + appTsx))
check('شاشة الاسترداد تعرض استيراد مفتاح الاسترداد', /<DesktopKeyRecoveryImport \/>/.test(appTsx))
check('صفحة النسخ على سطح المكتب تستعمل مفتاح الاسترداد بدل سر المتصفح', /desktopKeyRecoveryBridge\(\) \? <DesktopKeyRecoveryCard/.test(backupPage))
check('شاشة البدء تظهر قبل فتح القاعدة وتُغلق عند ظهور الواجهة', /showSplash\(previousVersion/.test(main) && main.indexOf('showSplash(previousVersion') < main.indexOf('await openDatabase()') && /mainWindow\.once\('ready-to-show'/.test(main) && /closeSplash\(\)/.test(main))
check('النسخ الدوّارة ساعية فقط (يوم واحد) — لا يومي ولا أسبوعي', /ROTATION = \{\s*hourly: \{ keep: 24/.test(read('desktop/storagePolicy.ts')) && !/daily: \{ keep|weekly: \{ keep/.test(read('desktop/storagePolicy.ts')) && !/'daily'|'weekly'/.test(main))
check('شاشة البدء تُظهر تقدّماً فعلياً (نسبة + خطوة) ومهلة أمان', /setSplashProgress\(40, 'فتح قاعدة البيانات/.test(main) && /setTimeout\(\(\) => \{\s*closeSplash\(\)[\s\S]{0,200}?\}, 20_000\)/.test(main))
check('رسالة التحديث تظهر مرة واحدة بعد تغيّر الإصدار (last-run.json)', /writeLastRunVersion\(\)/.test(main) && /last-run\.json/.test(main))
check('مؤشر التحديث يصف النسخة الاحتياطية وفتح البيانات تلقائياً', /تُؤخذ نسخة احتياطية قبل التثبيت/.test(read('src/ui/components/DesktopUpdater.tsx')))
check('الحوار لا يدّعي تراجعاً تلقائياً', !/تراجع تلقائي واستعادة/.test(about))

console.log(failures ? `\n❌ فشلت ${failures} فحوص` : '\n✅ بوابة التخزين والنسخ v1.0.22 تعمل')
process.exit(failures ? 1 : 0)
