/** نشر الأصول كـdraft ثم الإعلان بعد التحقق. لا أسرار على القرص ولا في المخرجات. */
import { spawnSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'
import { publishDesktopRelease, validateDesktopArtifacts } from './releasePipeline.mjs'

const tag = process.env.RELEASE_TAG
const repo = process.env.RELEASE_REPO
if (!/^v\d+\.\d+\.\d+$/.test(tag ?? '') || !/^[\w.-]+\/[\w.-]+$/.test(repo ?? '')) throw new Error('وجهة أو وسم إصدار غير صالح')
const directory = resolve('release')
const files = validateDesktopArtifacts(directory, tag.slice(1)).map(file => join(directory, file))
function gh(args, allowMissing = false) {
  const result = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 })
  if (result.status !== 0) {
    let body
    try { body = JSON.parse(result.stdout) } catch { /* ليس كل إخفاق JSON */ }
    if (allowMissing && (body?.status === '404' || body?.status === 404 || /HTTP 404/.test(result.stderr))) return null
    throw new Error(`فشلت خطوة النشر: ${result.stderr}`)
  }
  return result.stdout
}
const read = async (repository, suffix) => {
  const text = gh(['api', `repos/${repository}/releases/${suffix}`], true)
  return text === null ? null : JSON.parse(text)
}
const expectedAssets = files.map(file => ({ name: file.split(/[\\/]/).at(-1), size: statSync(file).size, digest: 'sha256:' + createHash('sha256').update(readFileSync(file)).digest('hex') }))
const result = await publishDesktopRelease({ tag, repo, files, expectedAssets, target: process.env.RELEASE_SOURCE_SHA, api: {
  // GET /releases/tags/{tag} يُوثق للإصدارات المنشورة؛ القائمة ترى drafts أيضاً.
  read: async (repository, version) => JSON.parse(gh(['api', `repos/${repository}/releases?per_page=100`, '--paginate', '--slurp'])).flat().find(release => release.tag_name === version) ?? null,
  latest: repository => read(repository, 'latest'),
  hide: async (repository, version) => { gh(['release', 'edit', version, '--repo', repository, '--draft=true']) },
  create: async (repository, version, target) => {
    // الرف العام ليس مستودع المصدر؛ لا نرسل SHA غير موجود إليه.
    const args = ['release', 'create', version, '--repo', repository, '--draft', '--title', `تَحَكَّم ${version.slice(1)}`, '--notes', `تحديث ${version.slice(1)} — مصدر البناء ${target ?? 'غير محدد'}`]
    if (repository === process.env.GITHUB_REPOSITORY && target) args.push('--target', target)
    gh(args)
  },
  upload: async (repository, version, assets) => { gh(['release', 'upload', version, '--repo', repository, '--clobber', ...assets]) },
  publish: async (repository, version, latest) => { gh(['release', 'edit', version, '--repo', repository, '--draft=false', `--latest=${latest}`]) },
} })
console.log(result.skipped ? `${repo}/${tag}: إصدار كامل موجود — بلا استبدال` : `${repo}/${tag}: نُشرت الأصول المتحققة${result.isLatest ? ' كأحدث إصدار' : ' دون إرجاع قناة التحديث للخلف'}`)
