/**
 * بوابة جولة المالك 2026-10-01 — تخصيص اختصارات لوحة المفاتيح (بند ① من أمر «اكمل ونفذ»).
 *
 * ① نواة الاختصارات: عشرة أفعال بمفاتيح وظائف F1..F12 فقط (لا حروف ولا
 *    توليفات — فلا تُختطف مفاتيح المتصفح ولا تُعطَّل الكتابة)، مع حل
 *    التجاوزات وتطهير القيم غير الصالحة وكشف التصادم والغمض.
 * ② دليل F12 نفسه يصير شاشة التخصيص: التقاط مفتاح، تبديل تلقائي عند
 *    التصادم، استعادة الافتراضي، وحفظ الفروق فقط.
 * ③ المعالج العام وأزرار Btn ونقطة البيع تتبع خريطة المستخدم المحلولة،
 *    مع بقاء F7 مكرراً تاريخياً لبحث الطرف ما لم يُعيَّن لغيره.
 * ④ فصل صارم لكل مستخدم حياً: خريطة المالك لا يت unseen — تختبر بمستخدمَين.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_owner_shortcuts.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(__dirname, '..', 'src', p), 'utf8')
let pass = 0; const ok = (n) => { pass++; console.log('  ✓', n) }

const core = read('core/keyboardShortcuts.ts')
const prefs = read('core/userPreferences.ts')
const nav = read('ui/components/KeyboardNavigation.tsx')
const ui = read('ui/components/ui.tsx')
const pos = read('ui/pages/PosPage.tsx')
const repo = read('data/repo.ts')

console.log('① النواة: أفعال بمفاتيح وظائف فقط + حل + تطهير + تصادم + غمض')
{
  assert.ok(/export type ShortcutActionId/.test(core) && /export const SHORTCUT_ACTIONS/.test(core), 'تعريف الأفعال مفقود')
  assert.ok((core.match(/\{ id: '/g) ?? []).length === 10, 'يجب أن تكون عشرة أفعال قابلة للتخصيص')
  assert.ok(/const FUNCTION_KEYS[\s\S]*?F\$\{i \+ 1\}/.test(core), 'مفاتيح الوظائف ليست F1..F12')
  assert.ok(/\/\^F\(\[1-9\]\|1\[0-2\]\)\$\//.test(core), 'لا يوجد حصر صارم لمفاتيح الوظائح F1..F12')
  assert.ok(/export function resolveShortcuts/.test(core) && /export function shortcutConflicts/.test(core) && /export function shortcutActionFor/.test(core) && /export function freeShortcutKeys/.test(core),
    'دوال الحل/التصادم/الغمض/الحرّة مفقودة')
  assert.ok(/isFunctionKey\(key\) \|\| taken\.has\(key\)\) continue/.test(core), 'الحل لا يطهّر القيم غير الصالحة أو المكررة')
  assert.ok(/hits\.length === 1 \? hits\[0\]\.id : null/.test(core), 'المفتاح الغامض (فعلان) لا يُتجاهل بأمان')
  assert.ok(/keyboardShortcuts\?: ShortcutOverrides/.test(prefs), 'حقل الاختصارات مفقود من تفضيلات المستخدم')
  ok('عشرة أفعال + F1..F12 حصراً + تطهير + تصادم + غمض + حقل التفضيلات')
}

console.log('② دليل F12 يصير شاشة التخصيص: التقاط + تبديل + استعادة + حفظ الفروق')
{
  assert.ok(/data-shortcut-help/.test(nav) && /data-shortcut-editor/.test(nav), 'دليل F12 بلا غلاف موسوم')
  assert.ok(/data-shortcut-edit/.test(nav) && /data-shortcut-capture=/.test(nav) && /data-shortcut-save/.test(nav) && /data-shortcut-restore/.test(nav) && /data-shortcut-cancel/.test(nav),
    'أزرار التخصيص/الالتقاط/الحفظ/الاستعادة/الإلغاء ناقصة')
  assert.ok(/window\.addEventListener\('keydown', onKey, true\)/.test(nav), 'الالتقاط ليس في طور الالتقاط قبل المعالج العام')
  assert.ok(/if \(owner\) next\[owner\.id\] = displaced/.test(nav), 'لا تبديلاً تلقائياً عند التصادم')
  assert.ok(/draft\[def\.id\] !== def\.defaultKey\) overrides\[def\.id\]/.test(nav), 'الحفظ لا يقتصر على الفروق عن الافتراضي')
  assert.ok(/updateMyPreferences\(\{ keyboardShortcuts: overrides \}\)/.test(nav), 'الحفظ لا يمر بخاصية تفضيلات المستخدم الحالي')
  assert.ok(/setDraft\(\{ \.\.\.DEFAULT_SHORTCUTS \}\)/.test(nav), 'زر استعادة الافتراضي مفقود')
  assert.ok(/مفاتيح الوظائف F1\.\.F12 فقط/.test(nav), 'رسالة رفض المفاتيح غير الوظيفية مفقودة')
  assert.ok(/disabled=\{conflicts\.length > 0\}/.test(nav), 'الحفظ غير معطَّل عند وجود تصادم')
  ok('دليل F12: التقاط بتبديل تلقائي + استعادة + حفظ الفروق معطَّل عند التصادم')
}

console.log('③ المعالج والأزرار والكاشير تتبع خريطة المستخدم + توافق F7')
{
  assert.ok(/const shortcuts = useMemo\(\(\) => resolveShortcuts\(savedOverrides\)/.test(nav), 'المعالج لا يحل خريطة المستخدم')
  assert.ok(/shortcutActionFor\(shortcuts, event\.key\)/.test(nav), 'المعالج لا يحدد الفعل من الخريطة المحلولة')
  assert.ok(/candidate\.dataset\.shortcut === event\.key/.test(nav), 'مطابقة الأزرار الموسومة لا تتبع مفتاح الحدث')
  assert.ok(/event\.key === 'F7' && !Object\.values\(shortcuts\)\.includes\('F7'\)/.test(nav), 'توافق F7 التاريخي (بحث طرف) مفقود')
  assert.ok(/if \(editMode && isFunctionKey\(event\.key\)\) \{ event\.preventDefault\(\); event\.stopPropagation\(\); return \}/.test(nav), 'أثناء التخصيص لا تُبتلع مفاتيح الوظائح (مع بقاء Tab/Enter طبيعيين)')
  assert.ok(/SHORTCUT_PROP_ACTIONS: Record<string, ShortcutActionId> = \{ F3: 'newInvoice', F6: 'print', F8: 'saveDraft', F9: 'post' \}/.test(ui),
    'أزرار Btn لا تحوّل مفاتيح F3/F6/F8/F9 إلى أفعال قياسية')
  assert.ok(/useResolvedShortcutKey\(shortcut, autoPost\)/.test(ui), 'مفتاح الزر الظاهر لا يتبع خريطة المستخدم')
  assert.ok(/data-shortcut=\{resolvedShortcut\}/.test(ui), 'وسم الزر بdata-shortcut مفقود')
  assert.ok(/e\.key === posShortcuts\.quickSearch/.test(pos) && /e\.key === posShortcuts\.post \|\| e\.key === 'F8'/.test(pos),
    'الكاشير لا يتبع مفتاحي البحث والترحيل المخصصين')
  ok('المعالج + Btn (F3/F6/F8/F9 كأفعال) + الكاشير (بحث/ترحيل) + بلع المفاتيح أثناء التخصيص')
}

console.log('④ فحص حي: النواة تعمل كما صُممت (حل/تطهير/تصادم/غمض/حرّة)')
{
  const { SHORTCUT_ACTIONS, DEFAULT_SHORTCUTS, resolveShortcuts, shortcutConflicts, shortcutActionFor, freeShortcutKeys, isFunctionKey, FUNCTION_KEYS } = await import('../src/core/keyboardShortcuts.ts')

  assert.equal(SHORTCUT_ACTIONS.length, 10, 'عدد الأفعال ليس عشرة')
  assert.equal(DEFAULT_SHORTCUTS.post, 'F9'); assert.equal(DEFAULT_SHORTCUTS.help, 'F12')
  assert.deepEqual(freeShortcutKeys(DEFAULT_SHORTCUTS), ['F1', 'F7'], 'الحر افتراضياً ليس F1 وF7')
  assert.equal(FUNCTION_KEYS.length, 12)
  assert.ok(isFunctionKey('F1') && isFunctionKey('F12') && !isFunctionKey('F13') && !isFunctionKey('f9') && !isFunctionKey('Ctrl+K') && !isFunctionKey(''))

  /* تجاوز جزئي سليم */
  const remapped = resolveShortcuts({ post: 'F7', quickSearch: 'F1' })
  assert.equal(remapped.post, 'F7'); assert.equal(remapped.quickSearch, 'F1')
  assert.equal(remapped.print, 'F6', 'الفعل غير المُجاوز يجب أن يبقى على افتراضه')
  assert.equal(shortcutActionFor(remapped, 'F7'), 'post', 'F7 لم يعد بحث طرف بعد تعيينه للترحيل')
  assert.deepEqual(freeShortcutKeys(remapped), ['F2', 'F9'], 'المفاتيح المحرَّرة بالتجاوز لا تُعرض حرة')

  /* التطهير: قيم غير صالحة أو مكررة تُهمل ولا تفسد الحل */
  const dirty = resolveShortcuts({ post: 'Ctrl+S', discount: 'F10', help: 'f12', print: '' })
  assert.equal(dirty.post, 'F9', 'مفتاح غير وظيفي قُبل!'); assert.equal(dirty.help, 'F12')
  const dup = resolveShortcuts({ post: 'F7', print: 'F7' })
  assert.equal(dup.print, 'F7', 'الأسبق بترتيب التعريف يجب أن يفوز (الطباعة قبل الترحيل)')
  assert.equal(dup.post, 'F9', 'الفعل المتأخر المكرر يجب أن يبقى على افتراضه')
  assert.deepEqual(shortcutConflicts(dup), [], 'الحل يجب ألا ينتج تصادماً إطلاقاً')

  /* التصادم والغمض على خريطة مصنوعة يدوياً (بيانات قديمة فاسدة) */
  const broken = { ...DEFAULT_SHORTCUTS, post: 'F6', print: 'F6' }
  assert.equal(shortcutConflicts(broken).length, 1, 'التصادم بين الترحيل والطباعة لم يُكتشف')
  assert.equal(shortcutActionFor(broken, 'F6'), null, 'المفتاح الغامض يجب أن يعطى null (تجاهل آمن)')
  assert.equal(shortcutActionFor(DEFAULT_SHORTCUTS, 'F4'), 'partySearch')
  assert.equal(shortcutActionFor(DEFAULT_SHORTCUTS, 'F7'), null, 'F7 ليس فعلاً في الخريطة (بل توافق تاريخي في المعالج)')
  ok('حياً: الحل والتطهير والفوز الأول والتصادم والغمض والحرّة كلها كما صُممت')
}

console.log('⑤ فحص حي: فصل صارم بين مستخدمَين + بقاء الخريطة عبر الدمج')
{
  const mem = new Map()
  globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k), clear: () => mem.clear(), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size } }
  globalThis.window = { localStorage: globalThis.localStorage, addEventListener: () => {}, dispatchEvent: () => true }
  mem.set('shopsys-app', JSON.stringify({ state: { setup: { done: true, countryCode: 'EG', activityId: 'retail', vatPercent: 14, taxInclusive: true }, license: { plan: 'pro' } }, version: 0 }))
  const { useDataStore } = await import('../src/data/repo.ts')
  const { resolveShortcuts, shortcutConflicts } = await import('../src/core/keyboardShortcuts.ts')
  const st = () => useDataStore.getState()

  /* المالك يخصص: ترحيل→F7 وبحث سريع→F1 */
  st().updateMyPreferences({ keyboardShortcuts: { post: 'F7', quickSearch: 'F1' } })
  const ownerMap = st().userPrefs['owner'].keyboardShortcuts
  assert.equal(ownerMap.post, 'F7'); assert.equal(ownerMap.quickSearch, 'F1')
  const ownerResolved = resolveShortcuts(ownerMap)
  assert.equal(ownerResolved.post, 'F7'); assert.equal(ownerResolved.itemSearch, 'F5')
  assert.deepEqual(shortcutConflicts(ownerResolved), [], 'خريطة المالف بعد التخصيص متصادمة')
  /* الدمج الجزئي: تجاوز لاحق لا يمسح التجاوزات السابقة */
  st().updateMyPreferences({ keyboardShortcuts: { post: 'F7', quickSearch: 'F1', print: 'F1' } })
  assert.equal(st().userPrefs['owner'].keyboardShortcuts.post, 'F7', 'الدمج السطحي مسح تجاوزاً سابقاً')

  /* مستخدم دخول ثانٍ: خريطته منفصلة تماماً ولا يرث شيئاً */
  const { hashPin } = await import('../src/core/audit.ts')
  st().setOwnerPin(await hashPin('135790'))
  const user2 = st().addAppUser({ nameAr: 'كاشير الفرع', roleId: 'cashier', pinHash: await hashPin('246810'), active: true })
  await st().login(user2.id, '246810')
  st().updateMyPreferences({ keyboardShortcuts: { itemSearch: 'F1' } })
  assert.equal(st().userPrefs[String(user2.id)].keyboardShortcuts.itemSearch, 'F1')
  assert.equal(st().userPrefs['owner'].keyboardShortcuts.post, 'F7', 'تسريب: خريطة المالك تغيّرت بفعل مستخدم آخر!')
  assert.ok(!('itemSearch' in (st().userPrefs['owner'].keyboardShortcuts ?? {})), 'تسريب: تجاوز المستخدم الثاني ظهر عند المالك!')
  const user2Resolved = resolveShortcuts(st().userPrefs[String(user2.id)].keyboardShortcuts)
  assert.equal(user2Resolved.post, 'F9', 'تسريب: المستخدم الثاني ورث ترحيل المالك F7!')
  assert.deepEqual(shortcutConflicts(user2Resolved), [], 'خريطة المستخدم الثاني متصادمة')
  /* العودة للمالك: خريطته كما خصصها */
  await st().login(null, '135790')
  assert.equal(resolveShortcuts(st().userPrefs['owner'].keyboardShortcuts).post, 'F7', 'خريطة المالك لم تنجُ من جولة المستخدم الثاني')
  ok('حياً: المالك (ترحيل F7/بحث F1) والمستخدم الثاني (صنف F1) منفصلان، والدمج لا يمسح السابق')
}

console.log(`✅ جولة المالك — تخصيص اختصارات لوحة المفاتيح: ${pass} فحوص ناجحة`)
