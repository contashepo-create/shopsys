// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { parse, stringify } from 'yaml'
import { versionOf, compareReleaseVersions, parseRemoteTags, completeRelease, planRelease, validateDesktopArtifacts, publishDesktopRelease } from '../scripts/releasePipeline.mjs'

const sha = 'a'.repeat(40), other = 'b'.repeat(40)
const roots: string[] = []
afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const assets = (tag = 'v1.0.24') => ['latest.yml', `tahakom-setup-${tag.slice(1)}.exe`, `tahakom-setup-${tag.slice(1)}.exe.blockmap`].map(name => ({ name, size: 42, state: 'uploaded' }))
const release = (tag = 'v1.0.24') => ({ tag_name: tag, draft: false, prerelease: false, assets: assets(tag) })

it('semver numérique, pas lexical; refuse les versions ambiguës', () => {
  expect(compareReleaseVersions('v1.0.10', '1.0.9')).toBe(1)
  expect(compareReleaseVersions('v2.0.0', 'v1.99.99')).toBe(1)
  expect(compareReleaseVersions('1.0.24', 'v1.0.24')).toBe(0)
  for (const value of ['v01.0.0', '1.0', 'main', '1.0.24-beta', '1.0.24\n']) expect(() => versionOf(value)).toThrow()
})
it('annotated tags use peeled commit SHA in either remote order', () => {
  for (const lines of [[`${other}\trefs/tags/v1.0.24`, `${sha}\trefs/tags/v1.0.24^{}`], [`${sha}\trefs/tags/v1.0.24^{}`, `${other}\trefs/tags/v1.0.24`]]) {
    expect(parseRemoteTags(lines.join('\n')).get('v1.0.24')).toBe(sha)
  }
  expect(parseRemoteTags(`${sha}\trefs/tags/unrelated`).size).toBe(0)
})
describe('recovery of partially failed automatic releases', () => {
  const base = { version: '1.0.24', head: sha, message: 'fix: data', tags: new Map([['v1.0.23', other]]) }
  it('actual v24 failure: existing package bump without tag is reused, not v25', () => expect(planRelease(base)).toEqual({ tag: 'v1.0.24', bump: false, skip: false, resume: true }))
  it('rerun after atomic push resumes the exact tagged source', () => expect(planRelease({ ...base, tags: new Map([['v1.0.24', sha]]), message: 'chore(release): v1.0.24' })).toEqual({ tag: 'v1.0.24', bump: false, skip: false, resume: true }))
  it('complete bot release skips; ordinary new code must get a new tag', () => {
    const tags = new Map([['v1.0.24', sha]])
    expect(planRelease({ ...base, tags, message: 'chore(release): v1.0.24', published: true }).skip).toBe(true)
    expect(planRelease({ ...base, tags, head: other, published: true })).toEqual({ tag: 'v1.0.25', bump: true, skip: false, resume: false })
  })
  it('incomplete older version cannot move an existing tag', () => {
    expect(planRelease({ ...base, tags: new Map([['v1.0.24', other], ['v1.0.26', other]]) }).tag).toBe('v1.0.27')
    expect(() => planRelease({ ...base, tags: new Map() })).toThrow()
  })
})
it('public completeness requires correct tag, all uploaded nonempty assets and no draft/prerelease', () => {
  expect(completeRelease(release(), 'v1.0.24')).toBe(true)
  for (const patch of [{ draft: true }, { prerelease: true }, { tag_name: 'v1.0.23' }, { assets: assets().slice(1) }, { assets: assets().map(a => ({ ...a, size: 0 })) }, { assets: assets().map(a => ({ ...a, state: 'new' })) }]) expect(completeRelease({ ...release(), ...patch }, 'v1.0.24')).toBe(false)
})
function artifact() {
  const dir = mkdtempSync(join(tmpdir(), 'shopsys-release-')); roots.push(dir)
  const bytes = Buffer.from('installer fixture — NOT a native installer')
  const exe = 'tahakom-setup-1.0.24.exe'
  const digest = createHash('sha512').update(bytes).digest('base64')
  const feed = { version: '1.0.24', files: [{ url: exe, size: bytes.length, sha512: digest }], path: exe, sha512: digest }
  writeFileSync(join(dir, exe), bytes); writeFileSync(join(dir, exe + '.blockmap'), 'blockmap fixture'); writeFileSync(join(dir, 'latest.yml'), stringify(feed))
  return { dir, feed, exe }
}
it('validates real local bytes and the complete exact update trio', () => {
  const { dir, exe } = artifact()
  expect(validateDesktopArtifacts(dir, '1.0.24')).toEqual(['latest.yml', exe, exe + '.blockmap'])
})
for (const mutation of ['version', 'size', 'digest', 'path', 'multiple-files', 'empty-blockmap', 'foreign-exe', 'tampered-exe'] as const) {
  it(`rejects artifact corruption: ${mutation}`, () => {
    const { dir, feed, exe } = artifact()
    if (mutation === 'version') feed.version = '1.0.23'
    if (mutation === 'size') feed.files[0].size++
    if (mutation === 'digest') feed.files[0].sha512 = 'wrong'
    if (mutation === 'path') feed.path = '../' + exe
    if (mutation === 'multiple-files') feed.files.push({ ...feed.files[0] })
    if (mutation === 'empty-blockmap') writeFileSync(join(dir, exe + '.blockmap'), '')
    if (mutation === 'foreign-exe') writeFileSync(join(dir, 'old.exe'), 'old')
    if (mutation === 'tampered-exe') writeFileSync(join(dir, exe), 'tampered')
    writeFileSync(join(dir, 'latest.yml'), stringify(feed))
    expect(() => validateDesktopArtifacts(dir, '1.0.24')).toThrow()
  })
}
function server(existing: any = null, latest: any = null) {
  const calls: string[] = []; let current = existing
  return { calls, get current() { return current }, api: {
    read: async () => current, latest: async () => latest,
    hide: async () => { calls.push('hide'); current.draft = true },
    create: async () => { calls.push('create'); current = { ...release(), draft: true, assets: [] } },
    upload: async () => { calls.push('upload'); current.assets = assets() },
    publish: async (_repo: string, _tag: string, isLatest: boolean) => { calls.push(`publish:${isLatest}`); current.draft = false },
  } }
}
const args = { tag: 'v1.0.24', repo: 'owner/releases', files: ['latest.yml', 'installer.exe', 'installer.exe.blockmap'] }
it('draft first, upload all, verify, then announce; complete rerun is immutable', async () => {
  const s = server()
  expect(await publishDesktopRelease({ ...args, api: s.api })).toEqual({ skipped: false, isLatest: true })
  expect(s.calls).toEqual(['create', 'upload', 'publish:true'])
  expect(await publishDesktopRelease({ ...args, api: s.api })).toEqual({ skipped: true })
  expect(s.calls).toEqual(['create', 'upload', 'publish:true'])
})
it('upload failure leaves draft; retry resumes without creating a duplicate', async () => {
  const s = server(); const upload = s.api.upload
  s.api.upload = async () => { throw new Error('network') }
  await expect(publishDesktopRelease({ ...args, api: s.api })).rejects.toThrow('network')
  expect(s.current.draft).toBe(true)
  s.api.upload = upload
  await publishDesktopRelease({ ...args, api: s.api })
  expect(s.calls.filter(c => c === 'create')).toHaveLength(1)
})
it('incomplete previous public release is hidden before repair; old tags never downgrade latest', async () => {
  const s = server({ ...release(), assets: [] }, release('v1.0.25'))
  expect(await publishDesktopRelease({ ...args, api: s.api })).toEqual({ skipped: false, isLatest: false })
  expect(s.calls).toEqual(['hide', 'upload', 'publish:false'])
})
it('missing asset after upload is never published', async () => {
  const s = server(); s.api.upload = async () => { s.current.assets = assets().slice(1) }
  await expect(publishDesktopRelease({ ...args, api: s.api })).rejects.toThrow('غير مكتملة')
  expect(s.current.draft).toBe(true); expect(s.calls).not.toContain('publish:true')
})
it('server-side size or digest mismatch keeps the upload private', async () => {
  for (const expected of [{ name: 'latest.yml', size: 43 }, { name: 'latest.yml', size: 42, digest: 'sha256:expected' }]) {
    const s = server(); const upload = s.api.upload
    s.api.upload = async () => { await upload(); s.current.assets[0].digest = 'sha256:wrong' }
    await expect(publishDesktopRelease({ ...args, expectedAssets: [expected], api: s.api })).rejects.toThrow('بصمة')
    expect(s.current.draft).toBe(true)
  }
})
it('publication/API failures are surfaced, not success-shaped', async () => {
  const s = server(); s.api.publish = async () => { throw new Error('403') }
  await expect(publishDesktopRelease({ ...args, api: s.api })).rejects.toThrow('403')
  s.api.read = async () => { throw new Error('API denied') }
  await expect(publishDesktopRelease({ ...args, api: s.api })).rejects.toThrow('API denied')
})
it('workflows parse, atomic push and explicit dispatch have separate steps; branch builds cannot publish', () => {
  const auto = parse(readFileSync('../.github/workflows/auto-release.yml', 'utf8'))
  const desktop = parse(readFileSync('../.github/workflows/desktop-release.yml', 'utf8'))
  expect(auto.permissions.actions).toBe('write'); expect(auto.permissions.contents).toBe('write')
  const steps = auto.jobs['tag-release'].steps
  const atomic = steps.findIndex((s: any) => s.run?.includes('git push --atomic'))
  const dispatch = steps.findIndex((s: any) => s.run?.includes('gh workflow run desktop-release.yml --ref'))
  expect(atomic).toBeGreaterThan(0); expect(dispatch).toBeGreaterThan(atomic)
  expect(steps.find((s: any) => s.uses?.includes('checkout')).with.ref).toBe('main')
  const publishes = desktop.jobs['build-windows'].steps.filter((s: any) => s.run?.includes('publish_desktop_release.mjs'))
  expect(publishes).toHaveLength(2)
  for (const s of publishes) expect(s.if).toBe('inputs.dry_run != true')
  expect(desktop.on.workflow_dispatch.inputs.dry_run.default).toBe(false)
})
it.skipIf(process.platform === 'win32')('all bash workflow blocks are syntax checked (not merely YAML checked)', () => {
  for (const file of ['auto-release.yml', 'desktop-release.yml']) {
    const workflow = parse(readFileSync(`../.github/workflows/${file}`, 'utf8'))
    for (const job of Object.values(workflow.jobs) as any[]) for (const step of job.steps) if (step.run && (!step.shell || step.shell === 'bash')) {
      const result = spawnSync('bash', ['-n'], { input: step.run.replace(/\$\{\{.*?\}\}/g, 'fixture'), encoding: 'utf8' })
      expect(result.status, `${step.name}: ${result.stderr}`).toBe(0)
    }
  }
})


it('يمنع النشر العام قبل اختبار المثبت القديم وprofile ومفتاح وآخر عمل', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/desktop-release.yml', import.meta.url), 'utf8')
  const native = workflow.indexOf('./scripts/windows_installer_smoke.ps1 -FromPublished23')
  const publish = workflow.indexOf('run: node scripts/publish_desktop_release.mjs')
  expect(native).toBeGreaterThan(0)
  expect(publish).toBeGreaterThan(native)
  expect(workflow.indexOf('validateDesktopArtifacts(\'release-previous\',\'1.0.23\')')).toBeGreaterThan(0)
})
it('يتحقق بعد النشر من تنزيل العميل السابق للإصدار العام الجديد بلا مصادقة أو تثبيت', () => {
  const workflow = parse(readFileSync('../.github/workflows/desktop-release.yml', 'utf8'))
  const steps = workflow.jobs['build-windows'].steps
  const baseline = steps.findIndex((step: any) => step.id === 'public_baseline')
  const publish = steps.findIndex((step: any) => step.env?.RELEASE_REPO === 'contashepo-create/tahakam-releases')
  const mirror = steps.findIndex((step: any) => step.env?.RELEASE_REPO === '${{ github.repository }}')
  const readback = steps.findIndex((step: any) => step.run?.includes('windows_public_update_probe.cjs'))
  expect(baseline).toBeGreaterThan(-1)
  expect(publish).toBeGreaterThan(baseline)
  expect(mirror).toBeGreaterThan(publish)
  expect(readback).toBeGreaterThan(mirror)
  expect(steps[readback].if).toBe('inputs.dry_run != true')
  expect(steps[readback].env.PUBLIC_UPDATE_FROM_VERSION).toBe('${{ steps.public_baseline.outputs.version }}')
  const probe = readFileSync('scripts/windows_public_update_probe.cjs', 'utf8')
  expect(probe).toContain("process.env.PUBLIC_UPDATE_FROM_VERSION || '1.0.23'")
  expect(probe).toContain('installAttempted: false')
})
it('keeps the v23 upgrade fixture in the source repo, not the current public releases feed', () => {
  const desktop = readFileSync('../.github/workflows/desktop-release.yml', 'utf8')
  const quality = readFileSync('../.github/workflows/quality.yml', 'utf8')
  for (const workflow of [desktop, quality]) {
    expect(workflow).toContain('gh release download v1.0.23 --repo contashepo-create/shopsys')
    expect(workflow).not.toContain('gh release download v1.0.23 --repo contashepo-create/tahakam-releases')
  }
})
