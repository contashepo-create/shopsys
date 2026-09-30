/* بوابة دفعة ⑳: الدرج الجانبي + استعادة جلسة النوافذ */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { reporter } from './auditKit.mjs'

const R = reporter('دفعة المالك ⑳ — الدرج الجانبي واستعادة الجلسة')
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')
const sheet = read('ui/components/SheetPanel.tsx')
const sales = read('ui/pages/AdvancedSalesInvoicePage.tsx')
const store = read('ui/windows/windowStore.ts')
const host = read('ui/windows/WindowHost.tsx')
const css = read('index.css')

{
  assert.ok(/export function SheetPanel/.test(sheet), 'مكوّن الدرج الجانبي مفقود')
  assert.ok(/data-app-sheet/.test(sheet), 'الدرج بلا معرّف فحص')
  assert.ok(/event\.key !== 'Escape'/.test(sheet) || /if \(event\.key !== 'Escape'\) return/.test(sheet), 'الدرج لا يُغلق بـEscape')
  assert.ok(/\.app-sheet \{[\s\S]{0,400}position: fixed/.test(css), 'الدرج بلا تنسيق')
  /* قاعدة المالك: لا تعتيم ولا عزل */
  const block = css.slice(css.indexOf('.app-sheet {'), css.indexOf('.app-sheet-head'))
  assert.ok(!/inset: 0/.test(block) && !/rgba?\(0, ?0, ?0, ?0?\.[3-9]/.test(block), 'الدرج يعتّم الخلفية — ممنوع')
  R.ok('الدرج الجانبي ينزلق بلا تعتيم ويُغلق بـEscape أو بالنقر خارجه')
}
{
  assert.ok(/const \[newPartySheet,setNewPartySheet\]=useState\(false\)/.test(sales), 'الفاتورة بلا درج «عميل جديد»')
  assert.ok(/event\.ctrlKey\|\|!event\.shiftKey\|\|event\.key\.toLowerCase\(\)!=='n'/.test(sales), 'اختصار Ctrl+Shift+N غير مربوط')
  assert.ok(/data-new-party-sheet/.test(sales) && /saveNewParty/.test(sales), 'حفظ العميل من الدرج غير منفَّذ')
  assert.ok(/setCustomerId\(created\.id\)/.test(sales), 'العميل الجديد لا يُختار في الفاتورة')
  R.ok('Ctrl+Shift+N يفتح درج «عميل جديد» ويُضيفه ويختاره بلا مغادرة الفاتورة')
}
{
  for (const rx of [/export function saveWindowSession/, /export function restoreWindowSession/, /export function watchWindowSession/])
    assert.ok(rx.test(store), 'دوال جلسة النوافذ ناقصة')
  assert.ok(/const RESTORABLE: AppWindowKind\[\] = \['sales-invoice', 'purchase-invoice'/.test(store),
    'قائمة النوافذ القابلة للاستعادة ناقصة')
  assert.ok(/if \(store\.windows\.length\) return 0/.test(store), 'الاستعادة قد تكرر نوافذ مفتوحة')
  assert.ok(/restoreWindowSession\(\)/.test(host) && /watchWindowSession\(\)/.test(host), 'الجلسة غير مربوطة بالمضيف')
  assert.ok(/x\?: number\n  y\?: number/.test(store), 'فتح النافذة لا يقبل موضعاً محفوظاً')
  R.ok('جلسة النوافذ تُحفظ مع كل تغيّر وتُستعاد بعد التحديث بمقاسها وموضعها')
}
R.done()
