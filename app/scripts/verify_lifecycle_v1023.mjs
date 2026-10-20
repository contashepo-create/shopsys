/**
 * بوابة دورة حياة سطح المكتب (v1.0.23) — فحوص بنيوية على الكود الحقيقي،
 * لأن Electron لا يعمل داخل بيئة الاختبار. المنطق الخالص مختبر في
 * tests/desktop_shutdown.test.ts.
 *
 * يمنع رجوع بلاغ «التطبيق يبقى في الخلفية ولا يفتح»، وفجوات الإقلاع.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (rel) => readFileSync(join(root, rel), 'utf8')
const main = read('desktop/main.ts')
const shutdown = read('desktop/shutdown.ts')

let failures = 0
const check = (name, cond) => {
  if (cond) console.log(`✓ ${name}`)
  else { failures++; console.log(`❌ ${name}`) }
}

check('الإغلاق يمر عبر gracefulShutdown المستوردة من shutdown.ts', /import \{ gracefulShutdown \} from '\.\/shutdown\.ts'/.test(main) && /gracefulShutdown\(\{/.test(main))
check('الإغلاق له مهلة للنسخة الاحتياطية (لا يتعلّق)', /timeoutMs:\s*8_000/.test(main))
check('الإغلاق ينتهي بـ exit دائماً (exit في الوحدة بعد إغلاق القاعدة)', /closeDb\(\)[\s\S]*deps\.exit\(0\)/.test(shutdown) && /closeDb:\s*\(\)\s*=>\s*\{\s*closing\.close\(\);\s*database = null/.test(main))
check('لا app.quit() داخل سلسلة وعود الإغلاق (كان سبب العملية المعلّقة)', !/rotateBackups\(closing\)[\s\S]{0,200}app\.quit\(\)/.test(main))
check('المحاولة الثانية تعيد النافذة إن كانت مغلقة', /second-instance'[\s\S]*?else if \(database\)[\s\S]*?createMainWindow\(\)/.test(main))
check('المحاولة الثانية لا تعمل أثناء الإغلاق', /second-instance'[\s\S]*?if \(shuttingDown\) return/.test(main))
check('معالج uncaughtException يسجّل وينهي بوضوح', /process\.on\('uncaughtException'[\s\S]*?app\.exit\(1\)/.test(main))
check('معالج unhandledRejection يسجّل', /process\.on\('unhandledRejection'/.test(main))
check('الإقلاع مغلّف بـ try/catch يعرض الخطأ وينهي دون عملية معلّقة', /whenReady\(\)\.then\(async \(\) => \{\s*try \{[\s\S]*?\} catch \(error\) \{[\s\S]*?app\.exit\(1\)/.test(main))
check('فشل مجلد النسخ لا يُسقط الإقلاع (mkdirSync داخل try)', /try \{\s*\/\*[^*]*\*\/\s*mkdirSync\(join\(app\.getPath\('userData'\), 'backups', kind\)/.test(main) || /try \{[\s\S]{0,400}mkdirSync\(join\(app\.getPath\('userData'\), 'backups', kind\)/.test(main))

console.log(failures === 0 ? '✅ بوابة دورة الحياة: كل الفحوص نجحت' : `❌ بوابة دورة الحياة: ${failures} فحص فشل`)
process.exit(failures === 0 ? 0 : 1)
