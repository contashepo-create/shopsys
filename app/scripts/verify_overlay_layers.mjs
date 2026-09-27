/**
 * سلّم الطبقات — بلاغ المالك: «أكتب اسم العميل داخل الفاتورة فتظهر نافذة البحث **خلف** الفاتورة».
 *
 * السبب الجذري: قاعدة في `index.css` كانت تفرض `.invoice-search-overlay { z-index: 110 !important }`
 * فتهزم صنف الطبقة `layer-picker` (2000)، فتهبط نافذة بحث العميل/الصنف تحت الفاتورة (نافذة 700+)
 * وتحت أي حوار (1000+). والسبب الكامن الثاني: `topZ` في مخزن النوافذ كان يتصاعد بلا سقف،
 * فبعد مئات عمليات الفتح/التركيز تتسلق النوافذ فوق طبقة المنتقيات فيعود العطل من باب آخر.
 *
 * هذه البوابة تمنع عودة الاثنين معاً.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_overlay_layers.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { reporter } from './auditKit.mjs'

const R = reporter('سلّم الطبقات — لا نافذة تختفي خلف أخرى')
const css = readFileSync('/home/user/shopsys/app/src/index.css', 'utf8')
const store = readFileSync('/home/user/shopsys/app/src/ui/windows/windowStore.ts', 'utf8')
const pickers = readFileSync('/home/user/shopsys/app/src/ui/components/KeyboardPickers.tsx', 'utf8')
const ui = readFileSync('/home/user/shopsys/app/src/ui/components/ui.tsx', 'utf8')

/** قراءة z-index المعرّف لصنف بعينه */
const layerOf = (name) => {
  const m = css.match(new RegExp(`\\.${name}\\s*\\{[^}]*z-index:\\s*(\\d+)`))
  return m ? Number(m[1]) : null
}

/* ① السلّم معرَّف ومرتب تصاعدياً */
{
  const scale = { 'layer-window': layerOf('layer-window'), 'layer-modal': layerOf('layer-modal'), 'layer-picker': layerOf('layer-picker'), 'layer-approval': layerOf('layer-approval'), 'layer-toast': layerOf('layer-toast') }
  for (const [name, value] of Object.entries(scale)) assert.ok(value != null, `طبقة ${name} غير معرَّفة في index.css`)
  const values = Object.values(scale)
  const sorted = [...values].sort((a, b) => a - b)
  assert.deepEqual(values, sorted, `ترتيب الطبقات مكسور: ${JSON.stringify(scale)}`)
  R.ok(`السلّم مرتب: نوافذ ${scale['layer-window']} < حوارات ${scale['layer-modal']} < منتقيات ${scale['layer-picker']} < اعتماد ${scale['layer-approval']} < تنبيهات ${scale['layer-toast']}`)
}

/* ② لا قاعدة تُهبط طبقة طافية تحت سلّمها — وهذا هو العطل الذي بلّغ عنه المالك */
{
  const overlayClasses = ['invoice-search-overlay', 'invoice-party-overlay', 'invoice-search-dialog']
  const pickerLayer = layerOf('layer-picker')
  const offenders = []
  for (const cls of overlayClasses) {
    const re = new RegExp(`\\.${cls}[^{]*\\{[^}]*z-index:\\s*(\\d+)([^;}]*)`, 'g')
    for (const m of css.matchAll(re)) {
      const value = Number(m[1])
      const positioned = new RegExp(`\\.${cls}[^{]*\\{[^}]*position:\\s*relative`).test(css)
      // المسموح: قيمة صغيرة داخل عنصر position:relative (ترتيب داخلي)، أو قيمة ≥ طبقة المنتقي
      if (value < pickerLayer && !positioned) offenders.push(`${cls}: z-index ${value}${m[2].includes('important') ? ' !important' : ''}`)
    }
  }
  assert.deepEqual(offenders, [], `قواعد تُهبط نوافذ البحث تحت طبقتها: ${offenders.join(' · ')}`)
  assert.ok(!/\.invoice-search-overlay\s*\{[^}]*z-index:\s*\d+\s*!important/.test(css),
    'عادت القاعدة التي تفرض z-index منخفضاً على نافذة البحث — ستختفي خلف الفاتورة من جديد')
  R.ok('لا قاعدة CSS تهبط نافذة بحث العميل/الصنف تحت طبقتها — الصنف layer-picker هو المرجع الوحيد')
}

/* ③ نوافذ البحث فعلاً تُركَّب على body بطبقة المنتقي */
{
  const overlays = [...pickers.matchAll(/<OverlayPortal><div className="([^"]+)"/g)].map((m) => m[1])
  assert.ok(overlays.length >= 2, 'منتقيا العميل والصنف لا يستعملان OverlayPortal')
  for (const cls of overlays) assert.ok(cls.includes('layer-picker'), `نافذة بحث بلا صنف الطبقة: ${cls}`)
  assert.ok(ui.includes('createPortal(children, document.body)'), 'OverlayPortal لا يركّب على body — أي سياق تراكم سيحبس النافذة')
  R.ok(`${overlays.length} نافذتا بحث تُركَّبان على body بصنف layer-picker — لا يحبسهما سياق تراكم داخل الفاتورة`)
}

/* ④ النوافذ العائمة لا تتسلق فوق طبقة المنتقيات مهما طال الاستعمال */
{
  assert.ok(store.includes('MAX_WINDOW_Z'), 'مخزن النوافذ بلا سقف لطبقة النوافذ')
  const ceiling = Number(store.match(/const MAX_WINDOW_Z = (\d+)/)?.[1])
  const modal = layerOf('layer-modal')
  assert.ok(Number.isFinite(ceiling) && ceiling < modal, `سقف النوافذ ${ceiling} يجب أن يقل عن طبقة الحوارات ${modal}`)
  assert.ok(store.includes('function renumber'), 'لا إعادة ترقيم عند بلوغ السقف')
  for (const site of ['openWindow', 'focusWindow']) {
    const body = store.slice(store.indexOf(`${site}: (`), store.indexOf(`${site}: (`) + 1800)
    assert.ok(body.includes('MAX_WINDOW_Z'), `${site} لا يحترم سقف الطبقة — سيعود التسلق`)
  }
  R.ok(`سقف النوافذ ${ceiling} < طبقة الحوارات ${modal}: عند بلوغه تُعاد ترقيم النوافذ بدل التصاعد بلا حد`)
}

/* ⑤ محاكاة حية: ألف عملية فتح/تركيز لا ترفع أي نافذة فوق السقف */
{
  const BASE = Number(store.match(/const BASE_Z = (\d+)/)[1])
  const ceiling = Number(store.match(/const MAX_WINDOW_Z = (\d+)/)[1])
  // محاكاة مبسطة لمنطق المخزن نفسه
  let windows = []
  let topZ = BASE
  const renumber = (list, topId) => {
    const ordered = [...list].sort((a, b) => (a.id === topId ? 1 : b.id === topId ? -1 : a.z - b.z))
    ordered.forEach((w, i) => { w.z = BASE + 1 + i })
    topZ = BASE + ordered.length
    return ordered
  }
  for (let i = 0; i < 1000; i++) {
    if (windows.length < 6 && i % 7 === 0) {
      const win = { id: `w${i}`, z: topZ + 1 }
      windows.push(win)
      if (win.z > ceiling) windows = renumber(windows, win.id); else topZ = win.z
    } else if (windows.length) {
      const target = windows[i % windows.length]
      const z = topZ + 1
      target.z = z
      if (z > ceiling) windows = renumber(windows, target.id); else topZ = z
    }
  }
  const maxZ = Math.max(...windows.map((w) => w.z))
  assert.ok(maxZ <= ceiling, `بعد 1000 عملية بلغت طبقة نافذة ${maxZ} — فوق السقف ${ceiling}`)
  assert.ok(maxZ < layerOf('layer-picker'), 'نافذة تجاوزت طبقة المنتقيات — نافذة البحث ستختفي خلفها')
  assert.equal(new Set(windows.map((w) => w.z)).size, windows.length, 'نافذتان بنفس الطبقة بعد إعادة الترقيم')
  R.ok(`محاكاة 1000 فتح/تركيز: أعلى طبقة نافذة ${maxZ} — تحت السقف وتحت طبقة المنتقيات، وكل نافذة بطبقة فريدة`)
}

/* ⑥ تأكيد إغلاق النافذة يخرج ببورتال فوق كل شيء (بلاغ المالك المتكرر: رأس الجدول فوق رسالة التأكيد)
      الغطاء داخل النافذة يبقى رهين سياق التكديس حوله مهما رفعنا z-index، فنُخرجه إلى <body>. */
{
  const contentMax = Number(css.match(/--z-in-window-content-max:\s*(\d+)/)?.[1])
  const askZ = Number(css.match(/--z-window-ask:\s*(\d+)/)?.[1])
  assert.ok(Number.isFinite(contentMax) && Number.isFinite(askZ), 'سلّم ما بداخل النافذة أو طبقة التأكيد غير معرَّفة في index.css')
  const ask = css.match(/\.app-window-ask\s*\{([^}]*)\}/)?.[1] ?? ''
  assert.ok(/z-index:\s*var\(--z-window-ask\)/.test(ask), 'غطاء تأكيد الإغلاق بلا طبقة صريحة')
  assert.ok(/position:\s*fixed/.test(ask) && /inset:\s*0/.test(ask), 'غطاء التأكيد لا يغطي الشاشة كاملةً')
  const floatingSrc = readFileSync('/home/user/shopsys/app/src/ui/windows/FloatingWindow.tsx', 'utf8')
  const askBlock = floatingSrc.slice(floatingSrc.indexOf('win.askingClose'), floatingSrc.indexOf('app-window-resize'))
  assert.ok(/<OverlayPortal>/.test(askBlock), 'حوار تأكيد الإغلاق ما زال يُرسم داخل النافذة — سيغطيه رأس جدول لاصق يوماً ما')
  assert.ok(askZ > layerOf('layer-window') && askZ > layerOf('layer-modal'),
    `طبقة التأكيد ${askZ} يجب أن تعلو النوافذ والحوارات`)
  assert.ok(askZ < layerOf('layer-picker'), 'طبقة التأكيد يجب أن تبقى تحت منتقيات البحث')
  R.ok(`تأكيد الإغلاق ببورتال على body بطبقة ${askZ} — فوق النوافذ (${layerOf('layer-window')}) والحوارات (${layerOf('layer-modal')}) ولا شيء داخل الصفحة يعلوه`)
}

/* ⑦ لا عنصر داخل الصفحة/النافذة يتسلق فوق سقف المحتوى فيغطي أغطية التأكيد */
{
  const contentMax = Number(css.match(/--z-in-window-content-max:\s*(\d+)/)[1])
  const overlayZ = Number(css.match(/--z-in-window-overlay:\s*(\d+)/)[1])
  const askZ = Number(css.match(/--z-window-ask:\s*(\d+)/)[1])
  const layerValues = new Set([690, 700, 1000, 2000, 3000, 4000, askZ])
  const offenders = []
  for (const m of css.matchAll(/([^{}]+)\{([^}]*z-index:\s*(\d+)[^}]*)\}/g)) {
    const selector = m[1].trim().split('\n').pop().trim()
    const value = Number(m[3])
    if (layerValues.has(value) || value === overlayZ) continue
    if (value > contentMax) offenders.push(`${selector} → ${value}`)
  }
  assert.deepEqual(offenders, [], `عناصر تتجاوز سقف محتوى النافذة وتغطي أغطية التأكيد: ${offenders.join(' · ')}`)

  const tsxZ = [...new Set([...readFileSync('/home/user/shopsys/app/src/ui/components/ui.tsx', 'utf8').matchAll(/\bz-\[(\d+)\]/g)].map((m) => Number(m[1])))]
  for (const value of tsxZ) assert.ok(value <= overlayZ, `صنف z-[${value}] في واجهة الحوارات يتجاوز طبقة الأغطية`)
  R.ok(`لا عنصر CSS يتجاوز سقف المحتوى ${contentMax} داخل النافذة، وأصناف الحوارات ضمن الحد`)
}

/* ⑧ ترويسة الحوار تعلو أي رأس جدول لاصق داخل جسمه */
{
  const uiSrc = readFileSync('/home/user/shopsys/app/src/ui/components/ui.tsx', 'utf8')
  const headerZ = Number(uiSrc.match(/sticky top-0 z-\[(\d+)\]/)?.[1])
  assert.ok(Number.isFinite(headerZ), 'ترويسة الحوار بلا طبقة صريحة')
  const stickyInPages = [...new Set([
    ...[...readFileSync('/home/user/shopsys/app/src/index.css', 'utf8').matchAll(/position:\s*sticky[^}]*z-index:\s*(\d+)/g)].map((m) => Number(m[1])),
    ...[...uiSrc.matchAll(/sticky[^"']*\bz-(\d+)\b/g)].map((m) => Number(m[1])),
  ])]
  const worst = Math.max(0, ...stickyInPages)
  assert.ok(headerZ > worst, `ترويسة الحوار ${headerZ} لا تعلو أعلى رأس لاصق ${worst} — سيغطي زر الإغلاق`)
  R.ok(`ترويسة الحوار z=${headerZ} تعلو أعلى رأس جدول لاصق (${worst}) — زر الإغلاق يبقى ظاهراً دائماً`)
}

/* ⑨ كل حوار تأكيد في التطبيق إما مُركَّب على body أو له طبقة صريحة تعلو محتواه */
{
  const overlayZ = Number(css.match(/--z-in-window-overlay:\s*(\d+)/)[1])
  const floating = readFileSync('/home/user/shopsys/app/src/ui/windows/FloatingWindow.tsx', 'utf8')
  assert.ok(floating.includes('app-window-ask'), 'غطاء تأكيد الإغلاق مفقود من نافذة التطبيق')
  // أي غطاء inset-0 في الواجهة يجب أن يحمل صنف طبقة أو يكون داخل بورتال
  const bare = [...readFileSync('/home/user/shopsys/app/src/ui/components/ui.tsx', 'utf8').matchAll(/className="((?:absolute|fixed) inset-0[^"]*)"/g)]
    .map((m) => m[1])
    .filter((cls) => !/layer-|z-\[?\d/.test(cls) && !/bg-slate-900\/55/.test(cls))
  assert.deepEqual(bare, [], `أغطية بلا طبقة في مكوّنات الواجهة: ${bare.join(' · ')}`)
  assert.ok(overlayZ < 700, `طبقة الأغطية داخل الصفحات ${overlayZ} يجب أن تبقى تحت طبقة النوافذ`)
  assert.ok(floating.includes('OverlayPortal'), 'تأكيد الإغلاق يجب أن يخرج ببورتال إلى body')
  R.ok('أغطية التأكيد كلها إما داخل بورتال أو بطبقة صريحة، وتأكيد إغلاق النافذة يعلو كل شيء ببورتال')
}

/* ⑩ كل قائمة منسدلة داخل الصفحة تعلو محتواها (وإلا غطّاها رأس لاصق أو شريط) */
{
  const overlayZ = Number(css.match(/--z-in-window-overlay:\s*(\d+)/)[1])
  const contentMax = Number(css.match(/--z-in-window-content-max:\s*(\d+)/)[1])
  const files = ['ui/layout/Header.tsx', 'ui/layout/Sidebar.tsx', 'ui/layout/MenuBar.tsx', 'ui/components/ui.tsx']
  const naked = []
  for (const file of files) {
    const src = readFileSync(`/home/user/shopsys/app/src/${file}`, 'utf8')
    for (const m of src.matchAll(/className="(absolute[^"]*)"/g)) {
      const cls = m[1]
      // القوائم المنسدلة تُعرف بأنها مرساة أسفل/أعلى الزر — الشارات والزخارف لا تُحسب
      if (!/top-full|bottom-full/.test(cls)) continue
      const z = cls.match(/z-\[(\d+)\]|z-(\d+)/)
      const value = z ? Number(z[1] ?? z[2]) : 0
      if (value <= contentMax) naked.push(`${file}: ${cls.slice(0, 60)}… → z=${value || 'auto'}`)
    }
  }
  assert.deepEqual(naked, [], `قوائم منسدلة تحت سقف المحتوى فتغطيها الرؤوس اللاصقة: ${naked.join(' · ')}`)
  assert.ok(overlayZ > contentMax, 'سلّم الأغطية مكسور')
  R.ok(`القوائم المنسدلة في الترويسة والقوائم كلها فوق سقف المحتوى ${contentMax} — لا يغطيها رأس لاصق ولا شريط`)
}

R.done('— نافذة بحث العميل/الصنف تعلو الفاتورة دائماً، والنوافذ لا تتسلق فوق طبقتها مهما طال العمل')
