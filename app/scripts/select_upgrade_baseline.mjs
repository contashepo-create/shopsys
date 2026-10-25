/** اختَر أحدث مثبت مستقر مكتمل قبل المرشح لاختبار ترقية NSIS. */
import { appendFileSync, readFileSync } from 'node:fs'
import { previousCompleteRelease } from './releaseVersion.mjs'

const [releaseListPath, candidateTag] = process.argv.slice(2)
if (!releaseListPath || !candidateTag) throw new Error('Expected release-list JSONL path and candidate tag')
const releases = readFileSync(releaseListPath, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
const baseline = previousCompleteRelease(releases, candidateTag)
if (!baseline) throw new Error(`No complete stable published release precedes ${candidateTag}`)
const version = baseline.tag_name.slice(1)
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `tag=${baseline.tag_name}\nversion=${version}\n`)
}
console.log(`Upgrade baseline: ${baseline.tag_name} (${version})`)
