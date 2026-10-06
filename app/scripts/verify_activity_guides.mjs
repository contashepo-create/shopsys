/**
 * بوابة «دليل نشاطك» (طلب المالك: شرح مفصّل لكل قسم داخل النشاط مع مثال لكل شيء،
 * ولا يُشرح نشاط داخل نشاط آخر):
 * 1) تغطية كاملة: كل شاشة في كتالوج التنقل لها شرح، وكل شرح يقابل شاشة حقيقية.
 * 2) جودة المحتوى: غرض + متى + خطوات (٣ فأكثر) + مثال + أثر محاسبي لكل شاشة.
 * 3) القوالب: كل قالب {…} في الأمثلة قابل للاستبدال بعيّنة أي نشاط (لا بقايا أقواس).
 * 4) العزل بين الأنشطة: لكل نشاط تُحسب شاشاته المرئية كما تحسبها القائمة تماماً،
 *    ويُتحقق ألا يتسرب لدليله لفظٌ يخص وحدة لا يملكها (مستخلص/مريض/غسيل…).
 * 5) دفتر النشاط: مقدمة + دورة يومية + نقاط تركيز + عيّنة لكل نشاط في القوالب.
 * 6) الموضوعات العامة تُصفّى بوحدات النشاط (مرتجع مبيعات لا يظهر لنشاط بلا مبيعات).
 * 7) فحص الصفحة نصياً: تبني أقسامها من الكتالوج وتستدعي المحرّك وأزرار فتح الشاشة.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

let pass = 0
const ok = (name) => { pass++; console.log(`  ✓ ${name}`) }

const { ALL_SCREEN_GUIDES, screenGuideFor, guideText, guideMatches } = await import(pathToFileURL(join(root, 'src/core/activityGuide.ts')).href)
const { ACTIVITY_PLAYBOOKS, playbookFor, fillSample } = await import(pathToFileURL(join(root, 'src/core/activityPlaybook.ts')).href)
const { ACTIVITY_TEMPLATES } = await import(pathToFileURL(join(root, 'src/core/activities.ts')).href)
const { guidesForActivity, topicsForSetup, COMMON_GUIDES } = await import(pathToFileURL(join(root, 'src/core/guides.ts')).href)

/* ─── قراءة كتالوج التنقل نصياً (فيه JSX/أيقونات فلا يُستورد هنا) ─── */
const navSrc = readFileSync(join(root, 'src/ui/navCatalog.tsx'), 'utf8')
const catalog = []
{
  let current = null
  for (const rawLine of navSrc.split('\n')) {
    const line = rawLine.trim()
    if (line.startsWith('id: ') && line.includes("color: '")) {
      current = {
        id: /id: '([^']+)'/.exec(line)[1],
        module: /(?:^|[\s,{])module: '([^']+)'/.exec(line)?.[1] ?? null,
        accountingOnly: line.includes('accountingOnly: true'),
        children: [],
      }
      catalog.push(current)
      continue
    }
    if (!current || !line.includes('path:')) continue
    for (const [chunk] of line.matchAll(/\{ id: '[^']+'[^}]*path: '[^']+'[^}]*\}/g)) {
      const activities = /activities: \[([^\]]*)\]/.exec(chunk)?.[1]
      const hideRaw = /hideForActivities: (\[[^\]]*\]|[A-Z_]+)/.exec(chunk)?.[1]
      current.children.push({
        id: /id: '([^']+)'/.exec(chunk)[1],
        path: /path: '([^']+)'/.exec(chunk)[1],
        module: /module: '([^']+)'/.exec(chunk)?.[1] ?? null,
        feature: /feature: '([^']+)'/.exec(chunk)?.[1] ?? null,
        activities: activities ? [...activities.matchAll(/'([^']+)'/g)].map((m) => m[1]) : null,
        hideForActivities: hideRaw
          ? (hideRaw.startsWith('[') ? [...hideRaw.matchAll(/'([^']+)'/g)].map((m) => m[1]) : ['trading', 'manufacturing', 'services'])
          : null,
      })
    }
  }
}
const allPaths = catalog.flatMap((s) => s.children.map((c) => c.path))

/** شاشات نشاط بعينه — نفس فلترة MenuBar/GuidesPage حرفياً (بلا صلاحيات) */
function visiblePaths(activity, accountingMode = 'simple') {
  return catalog
    .filter((sec) => (!sec.module || activity.modules.includes(sec.module)) && (!sec.accountingOnly || accountingMode === 'full'))
    .flatMap((sec) => sec.children
      .filter((c) => !c.module || activity.modules.includes(c.module))
      .filter((c) => !c.feature || activity.features.includes(c.feature))
      .filter((c) => !c.activities || c.activities.includes(activity.id))
      .filter((c) => !c.hideForActivities || !c.hideForActivities.includes(activity.id))
      .map((c) => c.path))
}

/* ═══ 1) تغطية كاملة ═══ */
{
  assert.ok(catalog.length >= 15, 'قراءة الكتالوج فشلت')
  assert.ok(allPaths.length >= 85, `عدد شاشات الكتالوج غير متوقع: ${allPaths.length}`)
  const keys = Object.keys(ALL_SCREEN_GUIDES)
  const missing = allPaths.filter((p) => !keys.includes(p))
  const orphan = keys.filter((k) => !allPaths.includes(k))
  assert.deepEqual(missing, [], `شاشات بلا شرح: ${missing.join(', ')}`)
  assert.deepEqual(orphan, [], `شروحات بلا شاشة: ${orphan.join(', ')}`)
  ok(`تغطية كاملة: ${allPaths.length} شاشة ولكل واحدة شرح مفصّل`)
}

/* ═══ 2) جودة كل شرح ═══ */
{
  for (const [path, g] of Object.entries(ALL_SCREEN_GUIDES)) {
    assert.ok(g.titleAr?.length >= 3, `${path}: عنوان`)
    assert.ok(g.purposeAr?.length >= 40, `${path}: الغرض قصير`)
    assert.ok(g.whenAr?.length >= 15, `${path}: «متى تستخدمه» قصير`)
    assert.ok(g.stepsAr?.length >= 3, `${path}: الخطوات أقل من ٣`)
    assert.ok(g.stepsAr.every((s) => s.length >= 15), `${path}: خطوة قصيرة`)
    assert.ok(g.exampleAr?.length >= 1, `${path}: بلا مثال`)
    assert.ok(g.exampleAr.every((s) => s.length >= 20), `${path}: مثال قصير`)
    assert.ok(g.effectAr?.length >= 1, `${path}: بلا أثر محاسبي/مخزني`)
    assert.ok(/[\u0600-\u06FF]/.test(guideText(g)), `${path}: يجب أن يكون بالعربية`)
  }
  const withMistakes = Object.values(ALL_SCREEN_GUIDES).filter((g) => (g.mistakesAr ?? []).length > 0).length
  assert.ok(withMistakes >= 25, `الأخطاء الشائعة قليلة: ${withMistakes}`)
  ok(`جودة المحتوى: غرض + متى + خطوات + مثال + أثر لكل شاشة (${withMistakes} شاشة بأخطاء شائعة)`)
}

/* ═══ 3) القوالب تُملأ لكل نشاط بلا بقايا ═══ */
{
  const known = ['item', 'unit', 'qty', 'qtyMinusOne', 'buy', 'sell', 'twoBuy', 'lineTotal', 'saleTotal', 'profitUnit', 'customer', 'supplier']
  const used = new Set()
  for (const g of Object.values(ALL_SCREEN_GUIDES)) {
    for (const m of guideText(g).matchAll(/\{(\w+)\}/g)) used.add(m[1])
  }
  const unknown = [...used].filter((k) => !known.includes(k))
  assert.deepEqual(unknown, [], `قوالب غير معروفة: ${unknown.join(', ')}`)
  for (const a of ACTIVITY_TEMPLATES) {
    for (const path of visiblePaths(a)) {
      const filled = screenGuideFor(path, a.id)
      assert.ok(filled, `${a.id}/${path}: بلا شرح`)
      assert.ok(!/\{\w+\}/.test(guideText(filled)), `${a.id}/${path}: قالب لم يُستبدل`)
    }
  }
  assert.equal(fillSample('{item} × {qty}', playbookFor('feed_trade').sample), 'علف بادئ 25 كجم × 40')
  assert.equal(fillSample('{saleTotal}', playbookFor('feed_trade').sample), '24,000')
  ok(`القوالب (${used.size}) تُملأ بعيّنة كل نشاط: مثال الأعلاف «علف بادئ 25 كجم × 40 = 24,000»`)
}

/* ═══ 4) العزل: لا نشاط داخل نشاط ═══ */
{
  // ألفاظ لا تظهر إلا لمن يملك الوحدة المقابلة
  const FOREIGN = [
    { word: 'المستخلص', modules: ['contracting'] },
    { word: 'مقاول الباطن', modules: ['contracting'] },
    { word: 'خطابات الضمان', modules: ['contracting'] },
    { word: 'المريض', modules: ['lab', 'clinic'] },
    { word: 'الفحوصات', modules: ['lab'] },
    { word: 'الغسيل', modules: ['laundry'] },
    { word: 'سعر جرام', modules: ['jewelry'] },
    { word: 'النقلة', modules: ['logistics'] },
    { word: 'المستأجر', modules: ['realestate'] },
    { word: 'الشاسيه', modules: ['cars'] },
    { word: 'أوامر الصيانة', modules: ['maintenance'] },
    { word: 'المحفظة', modules: ['wallet_services'] },
    { word: 'أوامر الطاولات', modules: ['recipes'] },
  ]
  for (const a of ACTIVITY_TEMPLATES) {
    const paths = visiblePaths(a, 'full')
    assert.ok(paths.length >= 5, `${a.id}: أقسام قليلة (${paths.length})`)
    const text = paths.map((p) => guideText(screenGuideFor(p, a.id))).join(' ')
    for (const f of FOREIGN) {
      if (f.modules.some((m) => a.modules.includes(m))) continue
      assert.ok(!text.includes(f.word), `${a.id}: تسرّب لفظ «${f.word}» من نشاط آخر`)
    }
  }
  // عيّنات صريحة على الفصل
  const grocery = visiblePaths(ACTIVITY_TEMPLATES.find((a) => a.id === 'grocery'), 'full')
  assert.ok(!grocery.some((p) => p.startsWith('/contracting') || p.startsWith('/lab') || p.startsWith('/realestate')), 'بقالة ترى أقسام أنشطة أخرى')
  const lab = visiblePaths(ACTIVITY_TEMPLATES.find((a) => a.id === 'lab'), 'full')
  assert.ok(!lab.includes('/pos') && !lab.includes('/inventory/items'), 'معمل يرى شاشات مبيعات/مخزون')
  assert.ok(lab.includes('/lab/orders') && lab.includes('/lab/tests'), 'معمل بلا شاشاته')
  const contracting = visiblePaths(ACTIVITY_TEMPLATES.find((a) => a.id === 'contracting'), 'full')
  assert.ok(contracting.includes('/contracting/projects') && !contracting.includes('/laundry/orders'), 'مقاولات: عزل خاطئ')
  ok(`العزل بين ${ACTIVITY_TEMPLATES.length} نشاطاً: لا شاشة ولا لفظ من نشاط آخر (بقالة ${grocery.length} · معمل ${lab.length} · مقاولات ${contracting.length})`)
}

/* ═══ 5) دفتر كل نشاط ═══ */
{
  for (const a of ACTIVITY_TEMPLATES) {
    const pb = ACTIVITY_PLAYBOOKS[a.id]
    assert.ok(pb, `${a.id}: بلا دفتر نشاط`)
    assert.ok(pb.introAr.length >= 60, `${a.id}: مقدمة قصيرة`)
    assert.ok(pb.dailyCycleAr.length >= 4, `${a.id}: دورة يومية قصيرة`)
    assert.ok(pb.focusAr.length >= 3, `${a.id}: نقاط تركيز قليلة`)
    for (const key of ['itemAr', 'customerAr', 'supplierAr']) {
      assert.ok(pb.sample[key]?.length >= 3, `${a.id}: عيّنة ناقصة (${key})`)
    }
    assert.ok(pb.sample.unitAr?.length >= 2, `${a.id}: وحدة العيّنة`)
    assert.ok(Number.isInteger(pb.sample.buyMinor) && Number.isInteger(pb.sample.sellMinor), `${a.id}: المبالغ يجب أن تكون بأصغر وحدة صحيحة`)
    assert.ok(pb.sample.qty > 0, `${a.id}: كمية العيّنة`)
  }
  // العيّنات متمايزة فعلاً بين الأنشطة (لا نص واحد للجميع)
  const items = new Set(ACTIVITY_TEMPLATES.map((a) => ACTIVITY_PLAYBOOKS[a.id].sample.itemAr))
  assert.ok(items.size >= 25, `عيّنات متكررة: ${items.size}`)
  assert.equal(playbookFor('غير-موجود').sample.itemAr, ACTIVITY_PLAYBOOKS.general.sample.itemAr)
  ok(`دفتر النشاط لكل ${ACTIVITY_TEMPLATES.length} نشاط: مقدمة + دورة يومية + تركيز + عيّنة (${items.size} عيّنة متمايزة)`)
}

/* ═══ 6) تصفية الموضوعات العامة ═══ */
{
  const grocery = ACTIVITY_TEMPLATES.find((a) => a.id === 'grocery')
  const lab = ACTIVITY_TEMPLATES.find((a) => a.id === 'lab')
  const trading = ACTIVITY_TEMPLATES.find((a) => a.id === 'trading')
  const gTopics = topicsForSetup(guidesForActivity('grocery'), grocery.modules, 'grocery')
  const lTopics = topicsForSetup(guidesForActivity('lab'), lab.modules, 'lab')
  const tTopics = topicsForSetup(guidesForActivity('trading'), trading.modules, 'trading')
  assert.ok(gTopics.some((t) => t.id === 'returns_wizard'), 'البقالة يجب أن ترى معالج المرتجعات')
  assert.ok(!lTopics.some((t) => t.id === 'returns_wizard' || t.id === 'purchase_returns'), 'المعمل لا يرى مرتجعات المبيعات/المشتريات')
  assert.ok(!tTopics.some((t) => t.id === 'returns_exchange'), 'أنشطة الفاتورة أولاً بلا شاشة استبدال')
  assert.equal(topicsForSetup(COMMON_GUIDES, grocery.modules, 'grocery').length, COMMON_GUIDES.length)
  assert.ok(guidesForActivity('lab').length >= COMMON_GUIDES.length, 'توافق خلفي مع الواجهة القديمة')
  ok(`تصفية الموضوعات: بقالة ${gTopics.length} · معمل ${lTopics.length} (بلا مرتجعات مبيعات) · تجارة بلا استبدال`)
}

/* ═══ 7) البحث داخل الدليل ═══ */
{
  const g = screenGuideFor('/inventory/counting', 'grocery')
  assert.ok(guideMatches(g, 'الجرد', 'عجز'))
  assert.ok(guideMatches(g, 'الجرد', ''))
  assert.ok(!guideMatches(g, 'الجرد', 'كلمة-لا-توجد-إطلاقاً'))
  assert.ok(guideMatches(null, 'الجرد', 'الجرد'))
  ok('البحث يطابق داخل نص الشرح وعناوين الشاشات')
}

/* ═══ 8) الصفحة تبني الدليل من الكتالوج ═══ */
{
  const page = readFileSync(join(root, 'src/ui/pages/GuidesPage.tsx'), 'utf8')
  for (const marker of [
    'NAV_SECTIONS', 'labelFor', 'screenGuideFor', 'playbookFor', 'topicsForSetup',
    'guidesForActivity', 'searchGuides', 'setup.activityId', 'setup.modules', 'setup.features',
    'hideForActivities', 'canAccessPath', 'data-guide-screen', 'data-guide-example', 'افتح الشاشة',
  ]) {
    assert.ok(page.includes(marker), `GuidesPage بلا ${marker}`)
  }
  assert.ok(!/ACTIVITY_GUIDES\[/.test(page), 'الصفحة يجب ألا تقرأ خرائط الأنشطة مباشرة')
  ok('صفحة الشروحات تبني أقسامها من كتالوج التنقل بنفس فلترة القائمة')
}

console.log(`نجحت ${pass} بوابات دليل النشاط`)
