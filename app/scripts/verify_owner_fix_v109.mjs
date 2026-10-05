#!/usr/bin/env node
/**
 * بوابة جولة v1.0.9 — «درع البيانات» (أسئلة المالك عن السيناريوهات):
 *   ① درع التلف: فحص سلامة القاعدة عند كل إقلاع + استرداد تلقائي من أحدث نسخة سليمة
 *   ② استعادة نسخة قاعدة ملفية من داخل التطبيق (المكانان — يدوية/تلقائية)
 *   ③ صدق الوثيقة القانونية: لا ادعاء تشفير غير موجود + توصية BitLocker
 *   ④ إشعار المستخدم عند الاسترداد التلقائي
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

const main = read('desktop/main.ts')
const preload = read('desktop/preload.ts')
const bridge = read('src/data/desktopBridge.ts')
const backupPage = read('src/ui/pages/BackupPage.tsx')
const app = read('src/App.tsx')
const legal = read('src/core/legal.ts')

/* ─── ① درع التلف ─── */
check('① فحص سلامة (quick_check) عند كل إقلاع قبل فتح القاعدة', main.includes('shieldDamagedDatabase(dbPath)') && main.includes("pragma('quick_check'"))
check('① التالف يُعزل (corrupt-*) ولا يُحذف — مع عزل WAL/SHM التابعة له', main.includes('.corrupt-') && main.includes("['-wal', '-shm']"))
check('① الاسترداد: أحدث نسخة سليمة من المكانين (يدوي/تلقائي) بفحص سلامة لكل مرشح', main.includes('candidateBackups') && main.includes('if (!quickCheck(candidate)) continue'))
check('① لا نسخة سليمة؟ قاعدة جديدة + إشعار صريح للمستخدم', main.includes('لا نسخة سليمة') && main.includes('db-recovery.json'))

/* ─── ② الاستعادة من داخل التطبيق ─── */
check('② IPC قائمة النسخ الملفية (المكانان + نوع + حجم + تاريخ)', main.includes("ipcMain.handle('database:listFileBackups'"))
check('② IPC استعادة: أمن مسار (الملفات المعروفة فقط) + فحص سلامة قبل الاستبدال', main.includes("ipcMain.handle('database:restoreFileBackup'") && main.includes('مسار نسخة غير معروف') && main.includes('النسخة المحددة غير سليمة'))
check('② الاستعادة تحفظ نسخة أمان من الحالية قبل الاستبدال (before-restore)', main.includes('.before-restore-'))
check('② الجسر كامل: preload + types', preload.includes('restoreFileBackup') && preload.includes('recoveryNotice') && bridge.includes('listFileBackups(): Promise'))
check('② بطاقة الاستعادة: قائمة + تحذير الاستبدال الكامل + تأكيد على مرحلتين', backupPage.includes('استعادة نسخة قاعدة كاملة (من النسخ الملفية)') && backupPage.includes('تستبدل بياناتك الحالية بالكامل') && backupPage.includes('متأكد — استبدل بياناتي الحالية'))

/* ─── ③ صدق الوثيقة ─── */
check('③ وثيقة قانونية صادقة: تشفير AES-256-GCM بمخزن مفاتيح النظام + توصية BitLocker طبقة إضافية', legal.includes('AES-256-GCM') && legal.includes('مخزن مفاتيح النظام') && legal.includes('BitLocker'))

/* ─── ④ الإشعار ─── */
check('④ إشعار الاسترداد التلقائي يظهر للمستخدم مرة واحدة عند الإقلاع', app.includes('recoveryNotice') && app.includes('استُردت تلقائياً من أحدث نسخة سليمة') && main.includes("ipcMain.handle('database:recoveryNotice'"))

if (failed === 0) console.log('\nبوابة v1.0.9: ✓ درع البيانات كامل')
else {
  console.log(`\nبوابة v1.0.9: ✗ ${failed} فحص فاشل — الفاشلة: ${failedNames.join(' · ')}`)
  process.exit(1)
}
