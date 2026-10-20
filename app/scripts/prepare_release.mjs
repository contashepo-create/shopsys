/** لا يوسم ولا يدفع شيئاً: خطة الإصدار + تحديث metadata فقط. Git في خطوات مستقلة. */
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { completeRelease, parseRemoteTags, planRelease } from './releaseVersion.mjs'

function releaseAt(repo, tag) {
  const result = spawnSync('gh', ['api', `repos/${repo}/releases/tags/${tag}`], { encoding: 'utf8' })
  if (result.status === 0) return JSON.parse(result.stdout)
  let body
  try { body = JSON.parse(result.stdout) } catch { /* يُعرض السبب بدون إخفاء فشل الصلاحيات */ }
  if (body?.status === '404' || body?.status === 404 || /HTTP 404/.test(result.stderr)) return null
  throw new Error(`تعذّر قراءة الإصدار: ${result.stderr}`)
}
const root = new URL('../', import.meta.url)
const pkgPath = new URL('package.json', root), lockPath = new URL('package-lock.json', root)
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const message = execFileSync('git', ['log', '-1', '--pretty=%s'], { encoding: 'utf8' }).trim()
const tags = parseRemoteTags(execFileSync('git', ['ls-remote', '--tags', 'origin', 'refs/tags/v*'], { encoding: 'utf8' }))
const published = completeRelease(releaseAt('contashepo-create/tahakam-releases', `v${pkg.version}`), `v${pkg.version}`)
const plan = planRelease({ version: pkg.version, head, message, tags, published })
if (plan.bump) {
  pkg.version = plan.tag.slice(1)
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
  lock.version = pkg.version
  lock.packages[''].version = pkg.version
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n')
}
for (const [key, value] of Object.entries(plan)) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`)
}
console.log(`خطة الإصدار: ${JSON.stringify(plan)} — المصدر ${head}`)
