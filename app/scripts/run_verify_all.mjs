/** تشغيل كل بوابات الأعمال والأمن بنفس بيئة CI ومنع نجاح جزئي صامت. */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = new URL('.', import.meta.url).pathname
const files = readdirSync(root).filter((file) => /^verify_.*\.mjs$/.test(file)).sort()
let failures = 0
for (const file of files) {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', join(root, file)], { stdio: 'inherit', cwd: new URL('..', import.meta.url).pathname })
  if (result.status !== 0) failures++
}
if (failures) {
  console.error(`فشل ${failures} من ${files.length} بوابة تحقق`)
  process.exit(1)
}
console.log(`نجحت كل بوابات التحقق: ${files.length}`)
