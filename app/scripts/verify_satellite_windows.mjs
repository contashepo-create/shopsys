/**
 * 🔎 فحص دائم — النوافذ الحرة لنظام التشغيل (قرار المالك 2026-10-22 —
 * سطح المكتب فقط، الكل دفعة واحدة):
 *  أ) سلوك النقل: openWindow مع جسر سطح مكتب يطلب نافذة نظام (لا ينشئ
 *     نافذة داخلية)، وردود النداء تُفصل (تبقى عند الأم، أسماؤها فقط تعبر)،
 *     ومنقّي الأصناف لا ترسل قائمتها ولا دوال عرضها (تُبنى من متجر القمر)،
 *     ومنع التكرار يركّز القمر القائم، واستدعاء القمر ينفّذ عند الأم.
 *  ب) الأقسام: openSectionWindow عبر IPC، والجذر '/' لا يفتح نافذة.
 *  ج) الويب سالم: بلا جسر (عملية منفصلة --web) تبقى الفتحة داخلية كما هي.
 *  د) الأسلاك البنيوية: جذر القمر في App.tsx مع مصادقة الجلسة وتعطيل
 *     خدمات الرئيسية عنه، ومصافحة الإغلاق، والقناة في preload والعملية
 *     الرئيسية، ومزامنة اللقطات الخارجية (الصدى/التعارض/المطبّقات).
 *
 * تشغيل: node --experimental-strip-types scripts/verify_satellite_windows.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

let pass = 0
const ok = (cond, name) => { assert.ok(cond, name); pass++; console.log('  ✓', name) }
const eq = (a, b, name) => { assert.equal(a, b, `${name} — الفعلي ${a}`); pass++; console.log('  ✓', name) }
const src = (rel) => readFileSync(join(root, rel), 'utf8')

/* ─── وضع الويب (عملية منفصلة): لا جسر → نوافذ داخلية كما هي ─── */
if (process.argv.includes('--web')) {
  globalThis.window = { location: { search: '' } }
  globalThis.localStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }
  const { useWindowStore, openSectionWindow } = await import(`${pathToFileURL(join(root, 'src/ui/windows/windowStore.ts')).href}?satweb=1`)
  const id = useWindowStore.getState().openWindow({ kind: 'sales-invoice', title: 'فاتورة بيع', dedupeKey: 'k1' })
  eq(useWindowStore.getState().windows.length, 1, 'الويب: الفتحة داخلية (نافذة في المتجر)')
  eq(openSectionWindow('/sales', 'المبيعات'), false, 'الويب: openSectionWindow لا يتولى الفتح (تنقل داخلي)')
  eq(openSectionWindow('/', 'الرئيسية'), false, 'الويب: الجذر لا يفتح نافذة')
  console.log(`WEB OK pass=${pass}`)
  process.exit(0)
}

/* ─── جسر سطح مكتب وهمي يسجّل كل ما يمر ─── */
const calls = { open: [], openSection: [], focus: [], invokeProp: [], claim: [] }
let propInvokeHandler = null
let registryHandler = null
const stubBridge = {
  open: async (d) => { calls.open.push(d); return { ok: true } },
  openSection: async (d) => { calls.openSection.push(d); return { ok: true } },
  list: async () => [],
  focus: (id) => calls.focus.push(id),
  minimize: () => undefined,
  toggleMaximize: () => undefined,
  requestClose: () => undefined,
  claim: async (token) => { calls.claim.push(token); return { windowId: 'win-self', type: 'view', kind: 'item-picker', title: 'بحث صنف', props: {}, callbackNames: ['onPick'], requestId: 'req-1' } },
  closeSelf: () => undefined,
  setDirty: () => undefined,
  setTitle: () => undefined,
  invokeProp: (m) => calls.invokeProp.push(m),
  respondClose: () => undefined,
  onPropInvoke: (h) => { propInvokeHandler = h; return () => undefined },
  onRegistry: (h) => { registryHandler = h; return () => undefined },
  onNavigate: () => () => undefined,
  onRequestClose: () => () => undefined,
}
globalThis.window = { shopsysDesktop: { windows: stubBridge }, location: { search: '?sat=tok-gate' } }
globalThis.localStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }

const { useWindowStore, openSectionWindow } = await import(`${pathToFileURL(join(root, 'src/ui/windows/windowStore.ts')).href}?satgate=1`)
const satelliteState = await import(`${pathToFileURL(join(root, 'src/ui/windows/satelliteState.ts')).href}?satgate=1`)

/* أ) النقل: فصل الدوال، منع تكرار، تنفيذ عند الأم */
let picked = null
const id1 = useWindowStore.getState().openWindow({
  kind: 'sales-invoice', title: 'فاتورة بيع',
  props: { documentId: 'd1', onPick: (row) => { picked = row } },
  dedupeKey: 'entity:inv1',
})
eq(calls.open.length, 1, 'النقل: الفتحة عبر IPC مرة واحدة')
eq(useWindowStore.getState().windows.length, 0, 'النقل: لا نافذة داخلية على سطح المكتب')
eq(calls.open[0].callbackNames.join(','), 'onPick', 'النقل: اسم رد النداء فقط يعبر')
ok(!('onPick' in calls.open[0].props), 'النقل: الدالة نفسها لا تعبر')
eq(calls.open[0].props.documentId, 'd1', 'النقل: الخصائص المسلسلة تعبر كما هي')
const id2 = useWindowStore.getState().openWindow({ kind: 'sales-invoice', title: 'فاتورة بيع', dedupeKey: 'entity:inv1' })
eq(id2, id1, 'النقل: نفس dedupeKey يعيد القمر القائم')
eq(calls.open.length, 1, 'النقل: بلا فتحة ثانية عند التكرار')
eq(calls.focus.join(','), id1, 'النقل: التكرار يركّز القمر')
eq(typeof propInvokeHandler, 'function', 'النقل: قناة prop-invoke مسجلة عند الأم')
propInvokeHandler({ requestId: calls.open[0].requestId, prop: 'onPick', args: [{ id: 'x9' }] })
eq(picked?.id, 'x9', 'النقل: استدعاء القمر ينفّذ رد النداء عند الأم')

/* منقّي الأصناف: القائمة ودوال العرض لا تعبر */
useWindowStore.getState().openWindow({
  kind: 'item-picker', title: 'بحث صنف',
  props: { items: [{ id: 'i1' }], itemMeta: () => ({}), amountLabel: () => '', onPick: () => undefined, quick: false },
  parentId: id1,
})
const picker = calls.open[1]
eq(picker.props.itemsFromStore, true, 'المنقّي: القائمة من متجر القمر (itemsFromStore)')
ok(!('items' in picker.props), 'المنقّي: القائمة نفسها لا تُرسل')
eq(picker.callbackNames.join(','), 'onPick', 'المنقّي: دوال العرض المتزامنة لا تعبر')
eq(picker.parentId, id1, 'النقل: الأبوة المنطقية للقمر الابن محفوظة')

/* مرآة السجل: إغلاق الجميع يسمح بفتحة جديدة */
eq(typeof registryHandler, 'function', 'النقل: مرآة سجل الأقمار مسجلة')
registryHandler([])
useWindowStore.getState().openWindow({ kind: 'sales-invoice', title: 'فاتورة بيع', dedupeKey: 'entity:inv1' })
eq(calls.open.length, 3, 'النقل: بعد إغلاق القمر تُفتح نسخة جديدة')

/* ب) الأقسام */
eq(openSectionWindow('/sales', 'المبيعات'), true, 'الأقسام: سطح المكتب يتولى الفتح')
eq(calls.openSection.at(-1)?.path, '/sales', 'الأقسام: المسار والعنوان عبر IPC')
eq(calls.openSection.at(-1)?.title, 'المبيعات', 'الأقسام: العنوان يرافق المسار')
eq(openSectionWindow('/', 'الرئيسية'), false, 'الأقسام: لوحة التحكم تبقى في الرئيسية (المشغّل)')

/* هوية القمر */
eq(satelliteState.isSatelliteBoot(), true, 'الهوية: رمز ?sat= في الرابط = نافذة قمر')
const descriptor = await satelliteState.claimSatellite()
eq(calls.claim.join(','), 'tok-gate', 'الهوية: المطالبة تُرسل الرمز للعملية الرئيسية')
eq(descriptor?.type, 'view', 'الهوية: الوصف يعود من المطالبة')
eq(satelliteState.getSelfWindowId(), 'win-self', 'الهوية: معرّف الذات من الوصف')

/* ج) الويب سالم — عملية منفصلة بلا جسر */
const webOut = execFileSync(process.execPath, ['--experimental-strip-types', fileURLToPath(import.meta.url), '--web'], { cwd: root, encoding: 'utf8' })
ok(webOut.includes('WEB OK pass=3'), 'الويب: المسار الداخلي كما هو حرفياً بلا جسر')

/* د) الأسلاك البنيوية */
const app = src('src/App.tsx')
ok(app.includes('<SatelliteViewRoot descriptor={satDescriptor} />'), 'App: جذر عرض القمر في الفرع النهائي')
ok(app.includes('markSessionAuthenticated()'), 'App: جلسة القمر مصادقة بلا PIN مع كل نافذة')
ok(app.includes('الرئيسية مشغّل'), 'App: معترض تنقل الرئيسية موجود')
ok((app.match(/satelliteBoot\) return|satelliteBoot \|\||!satelliteBoot/g) ?? []).length >= 10, 'App: خدمات الرئيسية معطلة في الأقمار (≥10 بوابات)')
const sat = src('src/ui/windows/satellite.tsx')
ok(sat.includes('export function SatelliteLayout') && sat.includes('export function SatelliteViewRoot'), 'القمر: التخطيط وجذر العرض معرّفان')
ok(sat.includes('onRequestClose') && sat.includes('respondClose'), 'القمر: مصافحة إغلاق النظام موصلة')
ok(sat.includes('hasUnsavedChangesInCurrentWindow') && sat.includes('data-section-close-confirm'), 'القسم الحر: تأكيد قبل فقد تعديلات النماذج')
ok(sat.includes('catch (error)') && sat.includes('بقيت النافذة مفتوحة'), 'القمر: فشل إجراء الحفظ لا يسمح بالإغلاق')
ok(sat.includes("event.key !== 'Escape'"), 'القمر: Escape يغلق هذه النافذة وحدها')
const main = src('desktop/satelliteWindows.ts')
ok(main.includes('windows:open') && main.includes('windows:claim') && main.includes('windows:prop-invoke'), 'الرئيسية: قنوات IPC الأربع موجودة')
ok(main.includes('confirmAndCloseAllSatellites'), 'الرئيسية: حارس إغلاق الرئيسية موجود')
ok(main.includes('mayControlSatellite') && main.includes('القمر لا ينشئ إلا أبناءه'), 'أمن IPC: القمر لا يتحكم إلا بنفسه أو بأبنائه المباشرين')
ok(main.includes('resolve(false)') && main.includes('أُلغي الإغلاق حفاظاً على البيانات'), 'القمر: انتهاء مهلة المصافحة يلغي الإغلاق ولا يفقد البيانات')
const mainTs = src('desktop/main.ts')
ok(mainTs.includes('broadcastSnapshotChanged') && mainTs.includes('satellitesOpenCount()'), 'الرئيسية: بث اللقطات ومانع إغلاق الرئيسية موصلان')
const preload = src('desktop/preload.ts')
ok(preload.includes('windows:') && preload.includes('onSnapshotChanged'), 'preload: جسر النوافذ وتغيّر اللقطات معروضان')
const storage = src('src/data/persistentStorage.ts')
ok(storage.includes('registerExternalSnapshotApplier') && storage.includes('handleExternalChange'), 'المزامنة: مطبّق اللقطات الخارجية مسجل')
ok(storage.includes('تعارض كتابة'), 'المزامنة: إعادة المحاولة عند تعارض الكتابة')
ok(src('src/data/repo.ts').includes("storeName === 'shopsys-data'") && src('src/data/repo.ts').includes('useRawDataStore.persist.rehydrate()'), 'المزامنة: متجر البيانات يُرطَّب خارجياً')
ok(src('src/stores/app.store.ts').includes("storeName === 'shopsys-app'") && src('src/stores/app.store.ts').includes('useAppStore.persist.rehydrate()'), 'المزامنة: متجر الإعداد يُرطَّب خارجياً')
const views = src('src/ui/windows/windowViews.tsx')
ok(views.includes('itemsFromStore') && views.includes('effectiveMeta'), 'المنقّي: افتراضيات القمر من متجره الحي')
const nav = src('src/ui/layout/Sidebar.tsx') + src('src/ui/layout/MenuBar.tsx') + src('src/ui/components/CommandPalette.tsx')
ok((nav.match(/openSectionWindow\(/g) ?? []).length >= 6, 'التنقل: الشريطان ولوحة الأوامر تفتح الأقسام كأقمار')

console.log(`\n✅ verify_satellite_windows PASS=${pass}`)
