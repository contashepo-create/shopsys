/** منطق الإصدار قابل للاختبار بلا GitHub: ترقيم قابل للاستئناف وفحص أصول التحديث. */
import { readFileSync, statSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'

import { versionOf, compareReleaseVersions, completeRelease } from './releaseVersion.mjs'
export { versionOf, compareReleaseVersions, parseRemoteTags, completeRelease, previousCompleteRelease, planRelease } from './releaseVersion.mjs'

export function validateDesktopArtifacts(directory, expectedVersion) {
  versionOf(expectedVersion)
  const feed = parse(readFileSync(join(directory, 'latest.yml'), 'utf8'))
  if (feed?.version !== expectedVersion) throw new Error('latest.yml بإصدار مختلف عن الوسم/package.json')
  const exe = `tahakom-setup-${expectedVersion}.exe`
  const entry = feed.files?.find(file => file.url === exe)
  if (!entry || !Array.isArray(feed.files) || feed.files.length !== 1 || basename(entry.url) !== entry.url) throw new Error('ملفات التحديث لا تشير حصراً إلى المثبت المتوقع')
  if (feed.path && feed.path !== exe) throw new Error('مسار المثبت القديم في latest.yml غير مطابق')
  const bytes = readFileSync(join(directory, exe))
  const sha512 = createHash('sha512').update(bytes).digest('base64')
  if (!bytes.length || entry.size !== bytes.length || entry.sha512 !== sha512 || (feed.sha512 && feed.sha512 !== sha512)) throw new Error('حجم أو بصمة المثبت لا يطابق latest.yml')
  const blockmap = `${exe}.blockmap`
  if (statSync(join(directory, blockmap)).size === 0) throw new Error('ملف blockmap فارغ')
  const extras = readdirSync(directory).filter(name => name.endsWith('.exe') && name !== exe)
  if (extras.length) throw new Error('مجلد الإصدار يحوي مثبتاً لإصدار آخر')
  return ['latest.yml', exe, blockmap]
}

/** جميع الأصول تُرفع إلى draft؛ الإصدار المنشور الكامل لا يُعاد استبداله.
 * @param {{ tag: string, repo: string, target?: string | null, files: string[], expectedAssets?: Array<{ name: string, size: number, digest?: string }>, api: any }} opts
 */
export async function publishDesktopRelease({ tag, repo, target, files, expectedAssets = [], api }) {
  versionOf(tag)
  const existing = await api.read(repo, tag)
  if (completeRelease(existing, tag)) return { skipped: true }
  const latest = await api.latest(repo)
  const isLatest = !latest || compareReleaseVersions(tag, latest.tag_name) >= 0
  if (existing && !existing.draft) await api.hide(repo, tag)
  if (!existing) await api.create(repo, tag, target)
  await api.upload(repo, tag, files)
  const draft = await api.read(repo, tag)
  if (!completeRelease({ ...draft, draft: false }, tag)) throw new Error('أصول الإصدار غير مكتملة — بقي draft ولم يُعلن للتحديث')
  for (const expected of expectedAssets) {
    const asset = draft.assets.find(asset => asset.name === expected.name)
    if (asset.size !== expected.size || (asset.digest && asset.digest !== expected.digest)) throw new Error('حجم أو بصمة الأصل المرفوع لا يطابق ملف البناء — بقي draft')
  }
  await api.publish(repo, tag, isLatest)
  const result = await api.read(repo, tag)
  if (!completeRelease(result, tag)) throw new Error('تعذّر التحقق من الإصدار بعد النشر')
  return { skipped: false, isLatest }
}
