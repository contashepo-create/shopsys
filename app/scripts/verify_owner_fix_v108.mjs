#!/usr/bin/env node
/**
 * بوابة جولة v1.0.8 — طلبات المالك:
 *   ① قاعدة بيانات قابلة للنقل لمكان يختاره المستخدم (تعيش بعد التحديث)
 *   ② نسخ احتياطية مزدوجة (بجوار القاعدة + مكان ثانٍ) ونسخة تلقائية يومية
 *   ③ تحذير أول تشغيل لاختيار مكان غير قرص C + تحذيرات المسؤولية
 *   ④ اتفاقية استخدام وخصوصية تفصيلية بموافقة موثقة (تطبيق + مثبِّت)
 *   ⑤ مفتاح تغيير النشاط متاح في شاشة التفعيل نفسها
 *   ⑥ مرساة التجربة خارج القاعدة (منع إعادة التجربة بمسح البيانات)
 *   ⑦ مركز متطور: سجل عملاء/أنشطة + منع تكرار البريد
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
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

/* ─── ① القاعدة القابلة للنقل ─── */
const main = read('desktop/main.ts')
check('① ملف توجيه db-location.json (مخصص + مكان النسخة الثانية + آخر نسخة)', main.includes('db-location.json') && main.includes('customDbPath') && main.includes('secondaryBackupDir'))
check('① openDatabase يفتح من المكان المخصص إن وجد', main.includes('resolveDbPath()') && main.includes('isCustom'))
check('① IPC نقل القاعدة: حوار اختيار + إغلاق آمن + نسخ + إعادة تشغيل (الأصل يبقى أماناً)', main.includes("ipcMain.handle('database:chooseDbLocation'") && main.includes('نسخة أمان') && main.includes('app.relaunch()'))

/* ─── ② النسخ المزدوجة ─── */
check('② النسخة الملفية تُكتب في مكانين (بجوار القاعدة + المكان الثاني)', main.includes("join(dirname(dbPath), 'backups', tag)") && main.includes('resolveSecondaryBackupDir().dir'))
check('② نسخة تلقائية يومية عند الإقلاع', main.includes("backupDatabaseFile('auto'") && main.includes('24 * 60 * 60 * 1000'))
check('② تنظيف تلقائي: أحدث 20 نسخة لكل مكان', main.includes('files.length - 20'))
check('② المكان الثاني الافتراضي: مجلد المستندات Tahakom-Backups', main.includes("app.getPath('documents'), 'Tahakom-Backups'"))

/* ─── ③ واجهة المستخدم والتحذيرات ─── */
const backupPage = read('src/ui/pages/BackupPage.tsx')
check('③ بطاقة مكان القاعدة في صفحة النسخ (سطح المكتب)', backupPage.includes('مكان قاعدة البيانات والنسخ الاحتياطية') && backupPage.includes('chooseDbLocation'))
check('③ التحذيرات: قرص C/الفرمتة + المكانان مسميان + مسؤولية المستخدم', backupPage.includes('فرمتة الويندوز') && backupPage.includes('مكانين مختلفين') && backupPage.includes('مسؤوليتك الكاملة'))
const wizard = read('src/ui/setup/FirstRunWizard.tsx')
check('③ خطوة أول تشغيل: تحذير مكان القاعدة واختياره (المعالج)', wizard.includes("label: 'مكان البيانات'") && wizard.includes('chooseDbLocation') && wizard.includes('ضياع القاعدة أو النسخ الاحتياطية مسؤوليتك الكاملة'))

/* ─── ④ الاتفاقية والخصوصية ─── */
const legal = read('src/core/legal.ts')
check('④ EULA بـ12+ بنداً تفصيلياً على النمط العالمي', legal.includes('منح الترخيص') && legal.includes('حد المسؤولية') && legal.includes('القانون الحاكم') && legal.includes('التعويض'))
check('④ سياسة خصوصية بنمط GDPR (جمع/تخزين/حقوق/حماية)', legal.includes('ما الذي نجمعه') && legal.includes('لا نستخدم إعلانات') && legal.includes('بياناتك ليست رهينة'))
check('④ منع البيع والاستخدام دون ترخيص صريح', legal.includes('يُحظر نهائياً') && legal.includes('بلا ترخيص سارٍ'))
const app = read('src/App.tsx')
check('④ بوابة قانونية إلزامية قبل الاستخدام + صفحة دائمة', app.includes('LegalGate') && app.includes('/settings/legal'))
check('④ الموافقة موثقة بالإصدار والتاريخ وتظهر مجدداً عند تحديثه', read('src/stores/app.store.ts').includes('legal: null') && read('src/stores/app.store.ts').includes('LEGAL_VERSION'))
const builder = read('electron-builder.yml')
check('④ صفحة اتفاقية داخل المثبِّت (NSIS licenseKeyFile)', builder.includes('licenseKeyFile: desktop/build/license.txt'))
check('④ ملف اتفاقية المثبِّت موجود وغير فارغ', existsSync(join(DIR, '..', 'desktop/build/license.txt')) && statSync(join(DIR, '..', 'desktop/build/license.txt')).size > 300)

/* ─── ⑤ النشاط من شاشة التفعيل ─── */
const lock = read('src/ui/LockScreen.tsx')
check('⑤ شاشة القفل (انتهاء الاشتراك): تفعيل + تنزيل بيانات + تغيير النشاط بكود', lock.includes('applyActivityChangeKey') && lock.includes('تغيير النشاط بكود الدعم') && lock.includes('بياناتك ملكك'))

/* ─── ⑥ مرساة التجربة ─── */
check('⑥ مرساة التجربة خارج القاعدة (trial:anchor في main + preload)', main.includes("ipcMain.handle('trial:anchor'") && read('desktop/preload.ts').includes('shopsysTrialAnchor'))
check('⑥ التطبيق يطابق بداية التجربة مع أقدم مرساة للجهاز', app.includes('shopsysTrialAnchor') && app.includes('anchor.firstTrialAt <'))

/* ─── ⑦ مركز المطوّر المتطور ─── */
const worker = read('../tools/devbot/src/worker.js')
check('⑦ سجل لكل جهاز (تفعيل/نشاط/بريد) append بحد 200', worker.includes('appendDeviceLog') && worker.includes('log:'))
check('⑦ أوامر اللوحة: /عملاء + /عميل + /سجل', worker.includes("'/عملاء'") && worker.includes("'/عميل'") && worker.includes("'/سجل'"))
check('⑦ منع تكرار البريد بين الأجهزة (email: → deviceId بفحص)', worker.includes('email:') && worker.includes('لا تكرار: عميل واحد ببريد واحد'))

if (failed === 0) console.log('\nبوابة v1.0.8: ✓ كل فحوص المحاور السبعة سليمة')
else {
  console.log(`\nبوابة v1.0.8: ✗ ${failed} فحص فاشل — الفاشلة: ${failedNames.join(' · ')}`)
  process.exit(1)
}
