/**
 * verify_methodology_manifest.mjs — بوابة **المنهجية نفسها**.
 *
 * لا تفحص الحسابات، بل تفحص أن طريقة الفحص قائمة ولا تنحدر:
 *   ① كل طبقة من الطبقات الست لها سكربتات موجودة، ومُوسَمة برقمها، وتُشغَّل الآن وتنجح.
 *   ② لا سكربت فحص جديد خارج التصنيف (رَتشِت فوق لقطة البوابات القديمة).
 *   ③ كل عائلة مستندات مالية يُمارَسها فعل مستند حقيقي في إحدى الطبقات.
 *   ④ الوثيقة `docs/منهجية_الفحص.md` مطابقة للتعريف — تُولَّد هنا وتُقارَن، فأي انحراف يفشل.
 *
 * التشغيل: node --experimental-strip-types scripts/verify_methodology_manifest.mjs
 *          [--write] لإعادة توليد الوثيقة فقط.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { LAYERS, FINAL_GATES, DOCUMENT_FAMILIES, LEGACY_SNAPSHOT, DOC_PATH } from './methodology_manifest.mjs'
import { reporter } from './auditKit.mjs'

const r = reporter('المنهجية')
const scriptDir = new URL('.', import.meta.url).pathname
const root = scriptDir.replace(/scripts\/$/, '')
const read = (path) => readFileSync(`${root}${path}`, 'utf8')

// ── ① الطبقات: موجودة، مُوسَمة، وتُشغَّل وتنجح ───────────────────────────────
const results = []
for (const layer of LAYERS) {
  const counts = []
  for (const script of layer.scripts) {
    const path = `${scriptDir}${script}`
    if (!existsSync(path)) throw new Error(`الطبقة ${layer.numeral}: السكربت «${script}» غير موجود — المنهجية منقوصة`)
    const source = readFileSync(path, 'utf8')
    if (!source.includes(layer.numeral)) throw new Error(`الطبقة ${layer.numeral}: السكربت «${script}» لا يحمل وسم طبقته (${layer.numeral})`)
    let output = ''
    try {
      output = execFileSync('node', ['--experimental-strip-types', path], { encoding: 'utf8', cwd: root, stdio: ['ignore', 'pipe', 'pipe'], timeout: 300_000 })
    } catch (error) {
      const detail = `${error.stdout ?? ''}${error.stderr ?? ''}`.split('\n').filter(Boolean).slice(-6).join(' / ')
      throw new Error(`الطبقة ${layer.numeral}: «${script}» فشل — ${detail}`)
    }
    // كل طبقة تُعلن عدّادها بصيغتها (فحوص/حالات/سلاسل) — نقرأ الرقم لا نفترضه
    const matches = [...output.matchAll(/(\d+)\s*(?:فحصاً|حالة|سلسلة)/g)].map((hit) => Number(hit[1]))
    const match = matches.length ? [null, String(Math.max(...matches))] : null
    counts.push(match ? Number(match[1]) : 1)
  }
  const total = counts.reduce((sum, n) => sum + n, 0)
  if (total < layer.minChecks) throw new Error(`الطبقة ${layer.numeral}: ${total} فحصاً فقط، والحد الأدنى ${layer.minChecks}`)
  results.push({ layer, total })
  r.ok(`الطبقة ${layer.numeral} «${layer.title}»: ${total} فحصاً في ${layer.scripts.length} سكربت`)
}

// ── ② الرَتشِت: لا سكربت فحص جديد بلا تصنيف ─────────────────────────────────
const classified = new Set(LAYERS.flatMap((layer) => layer.scripts))
const legacyPath = `${root}${LEGACY_SNAPSHOT}`
const legacy = existsSync(legacyPath)
  ? readFileSync(legacyPath, 'utf8').split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
  : []
const legacySet = new Set(legacy)
// بوابة المنهجية نفسها ليست طبقة تُفحص — هي الحاكم
const allGates = readdirSync(scriptDir).filter((file) => /^verify_.*\.mjs$/.test(file) && file !== 'verify_methodology_manifest.mjs')
const unclassified = allGates.filter((file) => !classified.has(file) && !legacySet.has(file))
if (unclassified.length) {
  throw new Error(`سكربتات فحص غير مُصنَّفة في المنهجية (أضِفها لطبقة أو للقطة القديمة بسبب مكتوب): ${unclassified.join(' · ')}`)
}
r.ok(`تصنيف البوابات: ${allGates.length} سكربتاً — ${classified.size} في المنهجية و${legacySet.size} قديمة موثّقة، بلا شاذّ`)

// ── ③ عائلات المستندات: كل عائلة يمارسها فعل مستند حقيقي ─────────────────────
const familySources = LAYERS.flatMap((layer) => layer.scripts).map((script) => readFileSync(`${scriptDir}${script}`, 'utf8'))
const layerText = familySources.join('\n')
const uncovered = DOCUMENT_FAMILIES.filter((family) => !family.markers.some((marker) => layerText.includes(`${marker}(`)))
if (uncovered.length) throw new Error(`عائلات مستندات بلا ممارسة في أي طبقة: ${uncovered.map((f) => f.name).join(' · ')}`)
r.ok(`عائلات المستندات المُمارَسة: ${DOCUMENT_FAMILIES.length}/${DOCUMENT_FAMILIES.length} (كل عائلة لها فعل مستند داخل طبقة)`)

// ── ④ الوثيقة مطابقة للتعريف ────────────────────────────────────────────────
const doc = `# منهجية الفحص والاختبار — ست طبقات

> وثيقة **مولَّدة آلياً** من \`app/scripts/methodology_manifest.mjs\` وتتحقق منها البوابة
> \`verify_methodology_manifest.mjs\`. أي تعديل يدوي هنا يُكتشف ويُفشل البوابة.

## الفكرة

المنهجية السابقة كانت تبدأ من **أمثلة نختارها**، فكان كل تسليم يكشف عيباً خارج الأمثلة.
المنهجية الحالية تبدأ من **الكود نفسه**: نحصر الأسطح آلياً، ثم نُلزم كل سطح وكل عائلة
مستندات بالمرور في طبقة واحدة على الأقل. لم يبقَ موضع «لم نفكّر فيه» بل موضع
«لم يُغطَّ بعد» — وهو مرئي في هذه الوثيقة ويفشل البوابة.

## الطبقات

| # | الطبقة | السؤال الذي تُغلقه | السكربتات | أقل عدد فحوص |
|---|---|---|---|---|
${LAYERS.map((layer) => `| ${layer.numeral} | ${layer.title} | ${layer.question} | ${layer.scripts.map((s) => `\`${s}\``).join('<br>')} | ${layer.minChecks} |`).join('\n')}

### ماذا تُغلق كل طبقة بالأمثلة

${LAYERS.map((layer) => `**${layer.numeral} ${layer.title}** — ${layer.closes}.`).join('\n\n')}

## عائلات المستندات

| المستند | الفعل | نوع القيد |
|---|---|---|
${DOCUMENT_FAMILIES.map((family) => `| ${family.name} | \`${family.markers[0]}\` | \`${family.sourceType}\` |`).join('\n')}

## ترتيب التنفيذ (من الأرخص إلى الأغلى)

1. الطبقة ① (ثانية واحدة): تحدد ما يجب فحصه — تُشغَّل أولاً دائماً.
2. الطبقات ②–④ (ثوانٍ): تُفحص بعد كل تعديل على \`repo.ts\` أو \`core\`.
3. الطبقة ⑤ (ثوانٍ): قبل كل تسليم.
4. الطبقة ⑥ (ثانية): بعد أي تعديل على التقارير.
5. الحكم النهائي أدناه.

## الحكم النهائي

| البوابة | الأمر | الغرض |
|---|---|---|
${FINAL_GATES.map((gate) => `| ${gate.name} | \`${gate.command}\` | ${gate.note} |`).join('\n')}

## الرَتشِت (منع الانحدار)

لقطة البوابات القديمة في \`${LEGACY_SNAPSHOT}\`. كل سكربت \`verify_*.mjs\` جديد يجب أن
يُصنَّف في طبقة داخل \`methodology_manifest.mjs\` — وإلا فشلت البوابة. كذلك تُشغَّل الطبقات
الست فعلياً داخل البوابة نفسها، فلا يمكن أن تُعلن المنهجية وتكون معطّلة.
`

const current = existsSync(`${root}${DOC_PATH}`) ? readFileSync(`${root}${DOC_PATH}`, 'utf8') : ''
if (process.argv.includes('--write')) {
  writeFileSync(`${root}${DOC_PATH}`, doc)
  console.log('✍️  كُتبت الوثيقة')
} else if (current !== doc) {
  throw new Error(`الوثيقة ${DOC_PATH} لا تطابق تعريف المنهجية — شغّل البوابة بـ--write`)
}
r.ok('الوثيقة مطابقة لتعريف المنهجية')

r.section('📋 خلاصة المنهجية:')
for (const { layer, total } of results) console.log(`   ${layer.numeral} ${layer.title.padEnd(28)} ${String(total).padStart(3)} فحصاً · ${layer.scripts.join(', ')}`)
r.ok(`${results.length} طبقات · ${results.reduce((sum, row) => sum + row.total, 0)} فحصاً · لا سكربت خارج التصنيف`)
r.done()
