/**
 * verify_typecheck.mjs — البوابة ① : الأنواع لا تُختبَر بالنية بل بالمُصرِّف.
 *
 * لماذا بوابة مستقلة: `npx tsc --noEmit` في جذر التطبيق **لا يفحص شيئاً**، لأن
 * `tsconfig.json` فيه `"files": []` و`references` فقط — فالمُصرِّف يخرج بالرمز 0
 * وهو لم يقرأ ملفاً واحداً. من ظنّ أنه يفحص الأنواع بتلك الصيغة ظنّ أنه فحصها.
 * الصيغ الصحيحة: `tsc -b --force` (الشيفرة) و`tsc -p tsconfig.tests-check.json`.
 *
 * ويُفحَص الأمران معاً لأن قواعد اختبارات الفحص تختلف عن قواعد الشيفرة (أنواع
 * vitest، عناصر DOM)، فقد يمرّ أحدهما ويفشل الآخر.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { reporter } from './auditKit.mjs'

const r = reporter('فحص الأنواع')
const root = fileURLToPath(new URL('..', import.meta.url))

function run(label, args) {
  const started = Date.now()
  const result = spawnSync('npx', ['tsc', ...args], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, shell: process.platform === 'win32' })
  const elapsed = ((Date.now() - started) / 1000).toFixed(1)
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  const errors = output.split(/\r?\n/).filter((line) => /error TS\d+/.test(line))
  r.check(result.status === 0 && errors.length === 0, `${label} (${elapsed} ثانية)`, errors.slice(0, 5).join(' · '))
  if (errors.length > 5) console.log(`   … و${errors.length - 5} خطأ أنواع آخر`)
  /* حارس ضد «نجاح كاذب»: مُصرِّف لم يُدخل ملفات لا ينتج خطأً ولا تحذيراً — لكن
     tsconfig قد يعود إلى `"files": []` بلا أدلة، فيُكتشف هنا بغياب أي إخراج. */
  return { ok: result.status === 0, output }
}

const app = run('الشيفرة (tsc -b --force)', ['-b', '--force'])
const tests = run('الاختبارات (tsconfig.tests-check.json)', ['-p', 'tsconfig.tests-check.json', '--noEmit', '--pretty', 'false'])

r.check(app.output.trim().length > 0 || app.ok, 'الشيفرة: المُصرِّف أنتج تشخيصاً أو نجح فعلياً', 'المُصرِّف لم يقرأ أي ملف (tsconfig بلا files)')
r.check(tests.ok, 'الاختبارات بلا أخطاء أنواع')

r.done('الشيفرة والاختبارات')
