/**
 * run_fuzz_money.mjs — مُشغّل المُزعزِعات العشرة على حزمة بذور.
 * كل مزعزع يبني دولة من الصفر ويُجري عمليات مالية عشوائية، ثم يفحص الثوابت
 * (توازن كل قيد · 1103 = Σ قيم الأصناف · لا سالب · الضريبة = المستند).
 * التشغيل: npm run verify:fuzz   (أو بالبذور: node … --seeds=1,2,3)
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const arg = process.argv.find((a) => a.startsWith('--seeds='))
const seeds = (arg ? arg.slice(8) : '1,7,13,29').split(',').map(Number).filter(Number.isFinite)
let runs = 0
const failures = []
for (let i = 1; i <= 10; i++) {
  for (const seed of seeds) {
    runs++
    const out = spawnSync(process.execPath, ['--experimental-strip-types', join(here, `fuzz_money_invariants_${i}.mjs`), String(seed)], { encoding: 'utf8' })
    const text = `${out.stdout ?? ''}${out.stderr ?? ''}`
    if (out.status !== 0 || !/✅/.test(text)) failures.push({ fuzz: i, seed, tail: text.trim().split('\n').slice(-3).join(' | ') })
  }
}
for (const f of failures) console.log(`❌ مزعزع ${f.fuzz} · بذرة ${f.seed}: ${f.tail}`)
console.log(failures.length === 0 ? `✅ المُزعزِعات: ${runs} تشغيلاً (10 مزعزعات × ${seeds.length} بذور) — كل الثوابت سليمة` : `❌ فشل ${failures.length} من ${runs}`)
process.exit(failures.length === 0 ? 0 : 1)
