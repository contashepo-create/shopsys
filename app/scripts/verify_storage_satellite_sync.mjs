#!/usr/bin/env node
// اختبار سلوكي لمزامنة التخزين بين نوافذ الأقمار الحرة: مثيلان من
// DesktopStateStorage (نافذتان) فوق قاعدة زائفة واحدة بمراجعات متفائلة.
// يثبت: (1) كتابة أ تصل ب بعد «البث»، (2) صدى الكتابة على النافذة الكاتبة
// نفسها لا يُعيد التطبيق، (3) إعادة كتابة المحتوى نفسه لا ترفع المراجعة،
// (4) تعارض المراجعة يدمج الحقول المستقلة ولا يستبدل اللقطة الأحدث،
// (5) إخطار خارجي متزامن مع كتابة جارية لا يكسر الطابور.
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0
const ok = (c, m) => { if (!c) { console.error('✗', m); process.exit(1) } pass++; console.log('  ✓', m) }
const eq = (a, b, m) => ok(a === b, `${m} (حصل: ${JSON.stringify(a)}، متوقع: ${JSON.stringify(b)})`)
const tick = () => new Promise((r) => setTimeout(r, 5))

/* قاعدة زائفة بنفس عقود SQLite في العملية الرئيسية:
   getSnapshot(name) → {storeName, revision, payloadJson}
   saveSnapshot({...}) → {revision} ويرمي 'revision conflict' عند قدم القاعدة */
const rows = new Map()
let saveDelayMs = 0
const fakeDb = {
  async getSnapshot(storeName) {
    const row = rows.get(storeName) ?? { revision: 0, payloadJson: null }
    return { storeName, revision: row.revision, payloadJson: row.payloadJson }
  },
  async saveSnapshot({ storeName, expectedRevision, payloadJson }) {
    if (saveDelayMs) await new Promise((r) => setTimeout(r, saveDelayMs))
    const row = rows.get(storeName) ?? { revision: 0, payloadJson: null }
    // نفس رسالة عقد العملية الرئيسية حرفياً (desktop/sqlite/storage.ts) —
    // محاولة الإعادة في العارض تتعرف عليها، فيجب أن يطابقها الزائف
    if (expectedRevision !== row.revision) throw new Error(`تعارض كتابة على ${storeName}: المتوقع ${expectedRevision} والموجود ${row.revision} — أعد الفتح ثم أعد المحاولة`)
    const revision = row.revision + 1
    rows.set(storeName, { revision, payloadJson })
    return { revision }
  },
  async deleteSnapshot(storeName) {
    const row = rows.get(storeName) ?? { revision: 0, payloadJson: null }
    const revision = row.revision + 1
    rows.set(storeName, { revision, payloadJson: null })
    return { revision }
  },
}

const { DesktopStateStorage, registerExternalSnapshotApplier } =
  await import(pathToFileURL(join(root, 'src/data/persistentStorage.ts')).href)

const applied = []
registerExternalSnapshotApplier((storeName) => applied.push(storeName))

const winA = new DesktopStateStorage(fakeDb, null, async () => null)
const winB = new DesktopStateStorage(fakeDb, null, async () => null)
const NAME = 'shopsys-app'

// 1) أ تكتب — ب لا ترى شيئاً قبل البث (لها ذاكرتها)، وبعده ترى القيمة ويُستدعى المطبِّق
await winB.getItem(NAME) // ب تحمّل الفراغ أولاً (ذاكرة فيها payload null)
await winA.setItem(NAME, JSON.stringify({ v: 1 }))
eq(await winB.getItem(NAME), null, 'قبل البث: النافذة ب ما زالت على نسختها')
winB.handleExternalChange(NAME)
await tick(); await tick()
eq(await winB.getItem(NAME), JSON.stringify({ v: 1 }), 'بعد البث: ب ترى كتابة أ')
eq(applied.length, 1, 'المطبِّق الخارجي استُدعي مرة واحدة')

// 2) صدى: بث يصل النافذة الكاتبة نفسها — مراجعتها متطابقة فلا إعادة تطبيق
winA.handleExternalChange(NAME)
await tick(); await tick()
eq(applied.length, 1, 'صدى الكتابة على كاتبها لا يُعيد التطبيق')

// 3) إعادة كتابة المحتوى نفسه — لا حفظ جديد ولا رفع مراجعة
const revBefore = rows.get(NAME).revision
await winA.setItem(NAME, JSON.stringify({ v: 1 }))
eq(rows.get(NAME).revision, revBefore, 'كتابة المحتوى المتطابق حرفياً تُتخطى')

// 4) تعارض: ب تتقدم دون أن تعلم أ (فشل بث). الحقول المستقلة تُدمج ولا تسقط.
await winB.setItem(NAME, JSON.stringify({ v: 1, branchB: 'saved-by-B' }))
await winA.setItem(NAME, JSON.stringify({ v: 1, branchA: 'saved-by-A' }))
eq(rows.get(NAME).payloadJson, JSON.stringify({ v: 1, branchA: 'saved-by-A', branchB: 'saved-by-B' }), 'التعارض يدمج حقلي النافذتين ولا يستبدل إحداهما')
winB.handleExternalChange(NAME)
await tick(); await tick()
eq(await winB.getItem(NAME), JSON.stringify({ v: 1, branchA: 'saved-by-A', branchB: 'saved-by-B' }), 'ب تلحق بالحالة المدمجة بعد البث')

// التعارض على الحقل نفسه غير قابل للدمج الآلي: يُرفض ويحافظ على أحدث لقطة.
const conflictA = new DesktopStateStorage(fakeDb, null, async () => null)
const conflictB = new DesktopStateStorage(fakeDb, null, async () => null)
const CONFLICT_NAME = 'conflicting-field'
await conflictA.setItem(CONFLICT_NAME, JSON.stringify({ value: 'base' }))
await conflictB.getItem(CONFLICT_NAME)
await conflictA.setItem(CONFLICT_NAME, JSON.stringify({ value: 'remote-edit' }))
let conflictRejected = false
try { await conflictB.setItem(CONFLICT_NAME, JSON.stringify({ value: 'local-edit' })) } catch { conflictRejected = true }
ok(conflictRejected, 'التعديل المتعارض على الحقل نفسه يُرفض ولا يطمس تعديل النافذة الأخرى')
eq(rows.get(CONFLICT_NAME).payloadJson, JSON.stringify({ value: 'remote-edit' }), 'اللقطة الأحدث تبقى محفوظة عند تعذر الدمج')

// 5) إخطار خارجي أثناء كتابة بطيئة جارية في نفس النافذة — الطابور يرتّب ولا ينكسر
saveDelayMs = 30
const writeInFlight = winA.setItem(NAME, JSON.stringify({ v: 4, branchA: 'saved-by-A', branchB: 'saved-by-B' }))
winA.handleExternalChange(NAME) // يدخل نفس الطابور خلف الكتابة
await writeInFlight
await tick(); await tick(); await tick()
saveDelayMs = 0
eq(rows.get(NAME).payloadJson, JSON.stringify({ v: 4, branchA: 'saved-by-A', branchB: 'saved-by-B' }), 'الكتابة البطيئة اكتملت رغم الإخطار المتزامن')
eq(await winA.getItem(NAME), JSON.stringify({ v: 4, branchA: 'saved-by-A', branchB: 'saved-by-B' }), 'ونسخة أ الذاكرة سليمة بعد الترتيب')

// 6) removeItem في أ ثم البث لب: لا انهيار، وكتابة لاحقة من ب تنجح
await winA.removeItem(NAME)
winB.handleExternalChange(NAME)
await tick(); await tick()
await winB.setItem(NAME, JSON.stringify({ v: 5 }))
eq(rows.get(NAME).payloadJson, JSON.stringify({ v: 5 }), 'بعد حذف أ وبثّه: ب تكتب بنجاح')

console.log(`✅ verify_storage_satellite_sync PASS=${pass}`)
