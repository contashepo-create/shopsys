/** تشغيل كل بوابات الأعمال والأمن ورحلات المستخدم بنفس بيئة CI ومنع نجاح جزئي صامت. */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('.', import.meta.url))
const all = readdirSync(root)
const gates = all.filter((file) => /^verify_.*\.mjs$/.test(file)).sort()
const journeys = all.filter((file) => /^user_journey_.*\.mjs$/.test(file)).sort()
const files = [...gates, ...journeys]

let failures = 0
const failed = []
for (const file of files) {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', join(root, file)], { stdio: 'inherit', cwd: fileURLToPath(new URL('..', import.meta.url)) })
  if (result.status !== 0) { failures++; failed.push(file) }
}
if (failures) {
  console.error(`فشل ${failures} من ${files.length} (بوابات ${gates.length} + رحلات ${journeys.length}):\n  - ${failed.join('\n  - ')}`)
  process.exit(1)
}
console.log(`نجحت كل الفحوص: ${files.length} = ${gates.length} بوابة تحقق + ${journeys.length} رحلة مستخدم`)
