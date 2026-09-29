/* بوابة سلوك النوافذ كنوافذ سطح المكتب (مراجعة UI/UX الشاملة):
   نافذة نشطة مميَّزة · اختصارات إدارة النوافذ · تحجيم من الجهات الثماني ·
   احترام تقليل الحركة · مفاتيح شريط النوافذ. */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { reporter } from './auditKit.mjs'

const R = reporter('سلوك النوافذ على طراز سطح المكتب')
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')
const host = read('ui/windows/WindowHost.tsx')
const floating = read('ui/windows/FloatingWindow.tsx')
const css = read('index.css')

{
  assert.ok(/active \?/.test(floating) && /is-active/.test(floating) && /is-inactive/.test(floating),
    'النافذة النشطة غير مميَّزة عن الخاملة')
  assert.ok(/<FloatingWindow key=\{win\.id\} win=\{win\} active=\{win\.id === topId\}>/.test(host),
    'المضيف لا يمرّر حالة النشاط للنافذة')
  assert.ok(/\.app-window\.is-active \{/.test(css) && /\.app-window\.is-inactive \{/.test(css),
    'لا تنسيق يميّز النافذة النشطة')
  R.ok('النافذة النشطة مميَّزة بالظل والحدّ وشريط العنوان')
}
{
  assert.ok(/if \(!event\.ctrlKey \|\| !event\.altKey \|\| event\.metaKey\) return/.test(host),
    'اختصارات النوافذ غير مقيَّدة بـCtrl+Alt فتصطدم بغيرها')
  for (const [rx, label] of [
    [/key === 'w'/, 'Ctrl+Alt+W للتنقل'],
    [/Number\.isInteger\(digit\) && digit >= 1 && digit <= 9/, 'Ctrl+Alt+1..9 للقفز'],
    [/key === 'm' && top/, 'Ctrl+Alt+M للتصغير'],
    [/event\.key === 'ArrowUp' && top/, 'Ctrl+Alt+↑ للتكبير'],
    [/key === 'q' && top/, 'Ctrl+Alt+Q للإغلاق'],
  ]) assert.ok(rx.test(host), `اختصار مفقود: ${label}`)
  assert.ok(/app-window-task-key/.test(host) && /app-window-task-key/.test(css), 'رقم النافذة غير معروض في الشريط')
  R.ok('اختصارات إدارة النوافذ كاملة ومعروضة للمستخدم')
}
{
  assert.ok(/type ResizeDir = 'e' \| 'w' \| 's' \| 'se' \| 'sw' \| 'n' \| 'ne' \| 'nw'/.test(floating),
    'التحجيم لا يغطي الجهات الثماني')
  assert.ok(/if \(dir\.includes\('n'\)\) \{ h = origin\.h - dy; y = origin\.y \+ dy \}/.test(floating),
    'حافة الأعلى لا تُحجِّم النافذة')
  for (const dir of ['is-n', 'is-ne', 'is-nw']) assert.ok(new RegExp(`\\.app-window-resize\\.${dir} \\{`).test(css), `مقبض ${dir} بلا تنسيق`)
  R.ok('النافذة تُحجَّم من جهاتها الثماني')
}
{
  assert.ok(/@media \(prefers-reduced-motion: reduce\)[\s\S]{0,220}\.app-window \{ animation-duration/.test(css),
    'لا احترام لتفضيل تقليل الحركة في النوافذ')
  R.ok('الحركة تحترم تفضيل «تقليل الحركة»')
}
R.done()
