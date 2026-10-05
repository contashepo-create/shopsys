#!/usr/bin/env node
/**
 * بوابة جولة v1.0.6 — بلاغا المالك + طلبات التصدير والأيقونة:
 *   ① «عندما أريد أن أحتفظ بنسخة احتياطية يقول لا يوجد بيانات لحفظها»
 *      → صفحة النسخ كانت تقرأ/تكتب localStorage مباشرة بينما persist في سطح
 *        المكتب يكتب SQLite — يجب أن تمر كل قراءة/كتابة عبر appStorage().
 *   ② «الصورة الداخلية بجانب الشريط الجانبي اختفت» + أيقونة Electron
 *      → الأصول بمسارات جذرية مطلقة تختفي عبر file:// (base: './')،
 *        وأيقونة المثبت يجب أن تكون صريحة وسليمة متعددة الأحجام.
 *   ③ التصدير الشامل Excel/CSV موجود ومختبر.
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

/* ─── ① النسخ الاحتياطي: مصدر الحقيقة موحّد ─── */
const backup = read('src/ui/pages/BackupPage.tsx')
check('① صفحة النسخ لا تلمس localStorage مباشرة (لا قراءة ولا كتابة)', !/localStorage\.(get|set|remove)Item/.test(backup))
check('① القراءة عبر طبقة التخزين الحقيقية settingsAppStorage()/appStorage()', backup.includes("settingsAppStorage().getItem('shopsys-app')") && backup.includes("appStorage().getItem('shopsys-data')"))
check('① الاستعادة تكتب عبر نفس الطبقة (SQLite في سطح المكتب)', backup.includes("appStorage().setItem('shopsys-data'"))

/* ─── ② الأصول والأيقونة ─── */
const sidebar = read('src/ui/layout/Sidebar.tsx')
const menubar = read('src/ui/layout/MenuBar.tsx')
const lock = read('src/ui/LockScreen.tsx')
check('② شعار الشريط الجانبي بمسار نسبي (يعمل عبر file://)', sidebar.includes('src="./app-icon.png'))
check('② شعار شريط القوائم بمسار نسبي', menubar.includes('src="./app-icon.png'))
check('② شعار شاشة القفل بمسار نسبي', lock.includes('src="./dev-logo.png'))

const builder = read('electron-builder.yml')
check('② electron-builder: أيقونة ويندوز صريحة win.icon', /win:[^]*?\n\s*icon:\s*desktop\/build\/icon\.ico/.test(builder))

/* رأس ICO: بايتا 4-5 = عدد الصور داخله (uint16 little-endian) */
const ico = readFileSync(join(DIR, '..', 'desktop/build/icon.ico'))
const icoSizes = ico.readUInt16LE(4)
const sizeOk = ico.length > 50_000 && icoSizes >= 6
check(`② icon.ico سليم ومتعدد الأحجام (${icoSizes} أحجام، ${(ico.length / 1024).toFixed(0)}KB)`, sizeOk)
const iconPng = readFileSync(join(DIR, '..', 'desktop/build/icon.png'))
check(`② icon.png موجود (${(iconPng.length / 1024).toFixed(0)}KB ≥ 512px مصدر)`, iconPng.length > 20_000)

/* ─── ③ التصدير الشامل ─── */
const exportCore = read('src/core/fullExport.ts')
check('③ نواة التصدير الشامل موجودة (أوراق كل الجداول + Excel XML + CSV BOM)', exportCore.includes('buildFullExportSheets') && exportCore.includes('sheetsToExcelXml') && exportCore.includes('sheetToCsv'))
check('③ بطاقة التصدير في صفحة النسخ الاحتياطي', backup.includes('تنزيل Excel شامل'))
const exportTest = read('tests/backup_export_v106.test.ts')
check('③ الاختبار الدائم للنسخ والتصدير موجود', exportTest.includes('buildFullExportSheets') && exportTest.includes("startsWith('\\uFEFF')"))

if (failed === 0) console.log('\nبوابة v1.0.6: ✓ كل فحوص البلاغ والطلبات سليمة')
else {
  console.log(`\nبوابة v1.0.6: ✗ ${failed} فحص فاشل — الفاشلة: ${failedNames.join(' · ')}`)
  process.exit(1)
}
