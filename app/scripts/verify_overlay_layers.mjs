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

R.done('— نافذة بحث العميل/الصنف تعلو الفاتورة دائماً، والنوافذ لا تتسلق فوق طبقتها مهما طال العمل')
