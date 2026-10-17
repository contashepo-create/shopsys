/**
 * بوابة «زر فحص التحديث + شريط التنزيل» (طلب المالك: استرجاعهما كما كان):
 *   ① زر الفحص اليدوي موجود في «حول» ويفحص فوراً بلا انتظار الفحص الدوري.
 *   ② شريط التنزيل يعرض نسبة التقدم القادمة من العملية الرئيسية.
 *   ③ الفحص التلقائي في الخلفية يبقى كما هو (فاصل دوري + إعادة محاولة بعد الخطأ).
 *   ④ التحديث الصامت عند الإغلاق يبقى كما هو (flush → protect → backup → close → install → exit).
 *   ⑤ الفحص اليدوي لا يتجاوز الحُرّاس ولا يفتح مسار تثبيت مختصر.
 * تشغيل: node --experimental-strip-types scripts/verify_manual_update_ui.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decideManualCheck } from '../desktop/updateLifecycle.ts'

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const main = read('desktop/main.ts')
const preload = read('desktop/preload.ts')
const lifecycle = read('desktop/updateLifecycle.ts')
const component = read('src/ui/components/DesktopUpdater.tsx')
const about = read('src/ui/pages/AboutPage.tsx')
const bridge = read('src/data/desktopBridge.ts')

let pass = 0
const check = (title, condition) => { assert.ok(condition, title); pass++; console.log(`✓ ${title}`) }

console.log('— ① زر الفحص اليدوي —')
check('«حول» يركّب مكوّن التحديث اليدوي', about.includes('<DesktopUpdater />') && about.includes("import { DesktopUpdater }"))
check('المكوّن يعرض زر «فحص التحديثات»', component.includes('فحص التحديثات') && component.includes('bridge.check()'))
check('الزر يستدعي جسر الفحص ولا ينادي العملية الرئيسية مباشرة', component.includes('desktopUpdaterBridge()') && !component.includes("require('electron"))
check('المتصفح يحمل زر فحص مستقل عن electron-updater', about.includes('!isElectronRuntime()') && about.includes('fetchUpdateInfo()') && about.includes('decideUpdate(APP_VERSION, info)'))

console.log('— ② شريط التنزيل —')
check('المكوّن يعرض شريط تقدم التنزيل', component.includes('desktop-updater-progress') && component.includes('style={{ width:') && component.includes('percent'))
check('العملية الرئيسية ترسل الحالة إلى الواجهة', main.includes("mainWindow.webContents.send('updater:state', state)") && main.includes('updateDownloadPercent'))
check('preload يمرّر الحالة كمشترك قابل للإلغاء', preload.includes("ipcRenderer.on('updater:state', wrapped)") && preload.includes('removeListener'))

console.log('— ③ الفحص التلقائي الخلفي كما هو —')
check('الفحص الدوري قائم بفاصله', main.includes('UPDATE_CHECK_INTERVAL_MS') && main.includes('scheduleUpdateCheck(autoUpdater, UPDATE_CHECK_INTERVAL_MS)'))
check('إعادة المحاولة بعد خطأ الشبكة قائمة', main.includes('scheduleUpdateRetry(autoUpdater)') && main.includes('updateCheckInFlight') && lifecycle.includes('updateCheckRetryDelay'))
check('التنزيل التلقائي في الخلفية لم يتغير', main.includes('autoUpdater.autoDownload = true'))
check('الفحص اليدوي لا يلغي المؤقّت الدوري بل يعيد جدولته', main.includes('checkUpdatesManually') && main.includes('decideManualCheck') && /checkUpdatesManually[\s\S]{0,3000}scheduleUpdateCheck\(autoUpdater, UPDATE_CHECK_INTERVAL_MS\)/.test(main))

console.log('— ④ التحديث الصامت عند الإغلاق كما هو —')
check('مسار التثبيت الصامت لم يتغير', main.includes('installSilentUpdate') && main.includes('flush: flushRenderer') && main.includes('backupBeforeUpdate(downloadedUpdateVersion!)') && main.includes('requestSilentInstall(autoUpdater)'))
check('التثبيت لا يعتمد على quit مع app.exit', main.includes('autoUpdater.autoInstallOnAppQuit = false'))
const order = ['await deps.flush()', 'await deps.protect()', 'await deps.backup()', 'deps.close()', 'await deps.install()', 'deps.exit()'].map((step) => lifecycle.indexOf(step))
check('ترتيب الحُرّاس محفوظ: flush ثم protect ثم backup ثم close ثم install ثم exit', order.every((position, index) => position >= 0 && (index === 0 || position > order[index - 1])))

console.log('— ⑤ الفحص اليدوي لا يتجاوز الحُرّاس —')
check('قرار الفحص اليدوي نقي ومُختبر', lifecycle.includes('export function decideManualCheck') && typeof decideManualCheck === 'function')
check('لا فحص فوق فحص جارٍ أو تنزيل جارٍ أو تحديث جاهز', decideManualCheck({ packaged: true, inFlight: false, downloading: false, downloaded: false }).kind === 'check')
check('فحص جارٍ = لا فحص جديد', decideManualCheck({ packaged: true, inFlight: true, downloading: false, downloaded: false }).kind === 'in_flight')
check('تنزيل جارٍ = لا فحص جديد', decideManualCheck({ packaged: true, inFlight: false, downloading: true, downloaded: false }).kind === 'downloading')
check('تحديث جاهز = لا فحص جديد', decideManualCheck({ packaged: true, inFlight: false, downloading: false, downloaded: true }).kind === 'downloaded')
check('نسخة غير مثبَّتة = بلا فحص', decideManualCheck({ packaged: false, inFlight: false, downloading: false, downloaded: false }).kind === 'unavailable')
check('الفحص اليدوي يلتقط رفض checkForUpdates بلا rejection غير معالج', /checkUpdatesManually[\s\S]{0,2000}observeUpdateCheck\(/.test(main) && main.includes('reportUpdaterError(error)'))
check('التثبيت اليدوي يمر بنفس مسار الإغلاق المحمي', main.includes("ipcMain.handle('updater:install'") && main.includes('await shutdownApplication(true)'))
check('جسر الواجهة محدود بحالة وفحص وتثبيت واشتراك', preload.includes("exposeInMainWorld('shopsysUpdater'") && ['updater:state', 'updater:check', 'updater:install'].every((channel) => preload.includes(channel)))
check('عقد الجسر معلن في المصيّر (بلا any)', bridge.includes('export interface DesktopUpdaterBridge') && bridge.includes('export function desktopUpdaterBridge()'))

console.log(`\nPASS=${pass}`)
console.log('✅ بوابة زر فحص التحديث وشريط التنزيل تعمل')
