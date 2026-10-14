/** ترقيم واستئناف الإصدار — بلا اعتماديات npm في سير الوسم. */
export function versionOf(tag) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag)
  if (!match || match[0] !== tag || !match.slice(1).every(value => Number.isSafeInteger(Number(value)))) throw new Error(`إصدار غير صالح: ${tag}`)
  return match.slice(1).map(Number)
}
export function compareReleaseVersions(a, b) {
  const av = versionOf(a), bv = versionOf(b)
  for (let i = 0; i < 3; i++) if (av[i] !== bv[i]) return Math.sign(av[i] - bv[i])
  return 0
}
export function parseRemoteTags(text) {
  const tags = new Map()
  for (const line of text.trim().split(/\r?\n/)) {
    const match = /^([a-f0-9]{40,64})\s+refs\/tags\/(v\d+\.\d+\.\d+)(\^\{\})?$/.exec(line)
    if (!match) continue
    versionOf(match[2])
    const previous = tags.get(match[2])
    if (!previous || match[3]) tags.set(match[2], match[1])
  }
  return tags
}
export function completeRelease(release, tag) {
  versionOf(tag)
  if (!release || release.draft || release.prerelease || release.tag_name !== tag) return false
  const names = ['latest.yml', `tahakom-setup-${tag.slice(1)}.exe`, `tahakom-setup-${tag.slice(1)}.exe.blockmap`]
  return names.every(name => release.assets?.some(asset => asset.name === name && asset.size > 0 && (!asset.state || asset.state === 'uploaded')))
}
export function planRelease({ version, head, message, tags, published = false }) {
  versionOf(version)
  const tag = `v${version}`
  const latest = [...tags.keys()].sort(compareReleaseVersions).at(-1)
  if (!latest) throw new Error('لا يوجد وسم إصدار سابق — الترقيم يحتاج أساساً معروفاً')
  if (tags.get(tag) === head) {
    return { tag, bump: false, skip: /^chore\(release\):/.test(message) && published, resume: !published }
  }
  if (compareReleaseVersions(version, latest) > 0) return { tag, bump: false, skip: false, resume: true }
  const [major, minor, patch] = versionOf(latest)
  return { tag: `v${major}.${minor}.${patch + 1}`, bump: true, skip: false, resume: false }
}

