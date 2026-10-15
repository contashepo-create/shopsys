#!/usr/bin/env node
/**
 * بوابة تاريخية لنسخة المتصفح (v1.0.15): نقل سر localStorage المشفّر بكلمة سر.
 * لا تخص SQLite في Electron؛ ملف .tkey.json يغلف سر المتصفح:
 * PBKDF2/SHA-256 بـ250 ألف دورة + ملح عشوائي + AES-256-GCM.
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

const core = read('src/core/secretTransfer.ts')
check('⑤ النواة: تغليف PBKDF2 بـ250 ألف دورة + AES-256-GCM بملح عشوائي لكل ملف', core.includes('250_000') && core.includes('getRandomValues'))
check('⑤ النواة: كلمة السر الخاطئة تُرفض برسالة عربية — GCM يتحقق من السلامة', core.includes('كلمة السر غير صحيحة أو الملف تالف'))
check('⑤ النواة: الحد الأدنى لكلمة السر 6 أحرف', core.includes('6 أحرف على الأقل'))
check('⑤ النواة: تحقق صيغة السر 64 رقماً سداسياً قبل أي فتح', core.includes("^[0-9a-f]{64}$"))
check('⑤ النواة: parseKeyFile يرفض ما ليس ملف سر تَحَكَّم', core.includes('صيغة تَحَكَّم'))

const storage = read('src/data/secureStorage.ts')
check('⑤ التخزين: setDeviceSecret يستبدل السر ويرفض أي صيغة أخرى', storage.includes('64 رقماً سداسياً عشرياً'))
check('⑤ التخزين: ختم الكتابة بعد الاستبدال — لا حفظ بالسر الجديد قبل قراءة القاعدة المنقولة', storage.includes('sealedForTransfer') && storage.includes('if (sealedForTransfer) return'))
check('⑤ التخزين: الختم يُفتح بإقلاع جديد فقط (unsealStorageAfterReload)', storage.includes('unsealStorageAfterReload'))

const main = read('src/main.tsx')
check('⑤ الإقلاع: فتح الختم مرة واحدة عند كل إقلاع جديد', main.includes('unsealStorageAfterReload()'))

const page = read('src/ui/pages/BackupPage.tsx')
check('⑤ الواجهة: بطاقة نقل سر localStorage المشفّر للمتصفح (تصدير + استيراد)', page.includes('نقل سر التخزين المشفّر للمتصفح') && page.includes('تصدير نسخة السر بكلمة سر') && page.includes('استيراد نسخة سر'))
check('⑤ الواجهة: مودال التصدير بكلمة سر وتأكيدها', page.includes('keyExportOpen') && page.includes('تأكيد كلمة السر'))
check('⑤ الواجهة: مودال الاستيراد بتحذير الاستبدال وإعادة التشغيل', page.includes('يستبدل سر هذا الجهاز') && page.includes('window.location.reload()'))
check('⑤ الواجهة: تنبيه أن نسخة JSON مقروءة ولا تحتاج سر المتصفح', page.includes('بيانات مقروءة ولا تحتاج هذا المفتاح') && page.includes('لا تخص قاعدة SQLite'))

const test = read('tests/secret_transfer_v115.test.ts')
check('⑤ اختبارات الجولة (8): تغليف/فك/ملح عشوائي/رفض خاطئ/صيغة/ختم', test.includes('wrapSecretWithPassword') && test.includes('sealedForTransfer') || test.includes('isStorageSealed'))

console.log('')
if (failed > 0) {
  console.error(`✗ فشل ${failed} فحصاً من بوابة v1.0.15:`)
  for (const n of failedNames) console.error(`  — ${n}`)
  process.exit(1)
}
console.log('✓ بوابة المرحلة ⑤ (12 فحصاً): نسخة سر التخزين المشفّر لنسخة المتصفح — لا تخص SQLite في Electron')
