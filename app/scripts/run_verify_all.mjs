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
  const result = spawnSync(process.execPath, ['--experimental-strip-types', join(root, file)], {
    encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
    cwd: fileURLToPath(new URL('..', import.meta.url)),
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.status !== 0) {
    failures++
    failed.push(file)
    const candidates = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.split(/\r?\n/)
      .filter((line) => /❌|✗|FAIL|AssertionError|Error:|ERR_/.test(line))
      .slice(-6)
    const reason = result.error?.message ?? (result.signal ? `توقف بسبب ${result.signal}` : `رمز الخروج ${result.status ?? 'غير معروف'}`)
    const detail = (candidates.join(' | ') || reason).slice(0, 700)
      .replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A').replaceAll(':', '%3A').replaceAll(',', '%2C')
    console.error(`::error file=app/scripts/${file},line=1,title=بوابة تحقق فاشلة::${detail}`)
  }
}
if (failures) {
  console.error(`فشل ${failures} من ${files.length} (بوابات ${gates.length} + رحلات ${journeys.length}):\n  - ${failed.join('\n  - ')}`)
  process.exit(1)
}
console.log(`نجحت كل الفحوص: ${files.length} = ${gates.length} بوابة تحقق + ${journeys.length} رحلة مستخدم`)
