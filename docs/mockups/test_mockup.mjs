// فحص سلوكي للنموذج الحي لشاشة الفاتورة (بلا متصفح).
// التشغيل:  mkdir -p /home/user/tools && cd /home/user/tools && npm i jsdom && node <مسار هذا الملف>
// يتحقق من البنود الـ12 المطلوبة: البحث من خلية الصنف · دورة Enter · خمسة سطور · نوافذ متعددة · تحصيل متعدد · سطر الخصم · الحقول التابعة للصنف.
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
const html = readFileSync('/home/user/shopsys/docs/mockups/invoice-layout-2026/index.html', 'utf8')
const errors = []
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true })
dom.virtualConsole.on('jsdomError', (e) => errors.push('jsdomError: ' + e.message))
const { window } = dom
window.alert = () => {}
await new Promise((r) => setTimeout(r, 200))
const d = window.document
const $ = (s) => d.querySelector(s)
const key = (el, k) => el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
const ok = (label, cond, extra = '') => console.log((cond ? '  ✓ ' : '  ✗ ') + label + (cond ? '' : ' — ' + extra))

// ① الإقلاع بلا أخطاء + خمسة سطور ظاهرة
ok('الصفحة تُقلع بلا أخطاء JS', errors.length === 0, errors.join(' | '))
ok('خمسة سطور ظاهرة على الأقل', d.querySelectorAll('#linesBody tr').length >= 5, d.querySelectorAll('#linesBody tr').length + ' سطر')
ok('لا يوجد شريط بحث أصناف مستقل', !d.querySelector('.entry'))

// ② الكتابة في خلية الصنف تفتح البحث بأول حرف
const cell0 = d.querySelector('.namecell[data-r="0"]')
cell0.focus(); key(cell0, 'ت')
ok('الكتابة في خلية الصنف تفتح نافذة البحث', !$('#itemWin').hidden)
ok('أول حرف يذهب لحقل البحث', $('#itemQuery').value === 'ت', 'القيمة=' + $('#itemQuery').value)
ok('النتائج تعرض بيانات الصنف بجانبه', /تكلفة/.test($('#itemList').textContent) && /المتاح/.test($('#itemSide').textContent))
ok('زرا التعديل والأسعار مفعّلان على الصنف المحدد', !!$('#btnItemEdit') && !!$('#btnItemPrices'))

// ③ الأسهم + Enter يختار ويقف على الكمية
const q = $('#itemQuery')
key(q, 'ArrowDown'); key(q, 'Enter')
ok('اختيار الصنف يغلق النافذة', $('#itemWin').hidden)
ok('التركيز ينتقل إلى الكمية', d.activeElement?.dataset?.c === 'qty', 'الآن=' + d.activeElement?.dataset?.c)
const nameCellText = d.querySelector('.namecell[data-r="0"] b').textContent
ok('اسم الصنف ظهر في السطر', nameCellText.length > 3 && !nameCellText.includes('اضغط'), nameCellText)

// ④ Enter: كمية ← سعر ← السطر التالي (خلية الصنف)
const qty = d.activeElement; qty.value = '4'; qty.dispatchEvent(new window.Event('input', { bubbles: true })); key(qty, 'Enter')
ok('Enter من الكمية ينتقل للسعر', d.activeElement?.dataset?.c === 'price', 'الآن=' + d.activeElement?.dataset?.c)
key(d.activeElement, 'Enter')
ok('Enter من السعر ينتقل لخلية صنف السطر التالي', d.activeElement?.dataset?.c === 'name' && d.activeElement?.dataset?.r === '1',
  'الآن=' + d.activeElement?.dataset?.c + '/' + d.activeElement?.dataset?.r)
ok('الإجمالي يحسب الكمية الجديدة', $('#grand').textContent !== '0.00', $('#grand').textContent)

// ⑤ النقر مرتين على اسم الصنف يفتح البحث للتبديل
d.querySelector('.namecell[data-r="0"]').dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }))
ok('نقرتان على اسم الصنف تفتحان البحث', !$('#itemWin').hidden)
ok('Esc يغلق النافذة', (key(d, 'Escape'), $('#itemWin').hidden))
ok('زر التصغير موجود ويعمل', !!d.querySelector('#itemWin [data-min]'))

// ⑥ بحث العميل + تعديل فوق البحث بلا إغلاقه
$('#customerField').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
ok('بحث العملاء يفتح', !$('#custWin').hidden)
ok('الرصيد وحد الائتمان بجانب كل عميل', /الرصيد/.test($('#custList').textContent) && /الحد/.test($('#custList').textContent))
d.querySelector('#custList [data-edit="1"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
ok('نافذة التعديل تفتح فوق البحث', !$('#custEditWin').hidden && !$('#custWin').hidden)
$('#ceName').value = 'مؤسسة النخيل — معدّلة'; $('#ceLimit').value = '75000'
$('#ceSave').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
ok('الحفظ يغلق التعديل ويُبقي البحث مفتوحاً', $('#custEditWin').hidden && !$('#custWin').hidden)
ok('البحث تحدّث صامتاً بالبيانات الجديدة', /معدّلة/.test($('#custList').textContent) && /75,000/.test($('#custList').textContent))
d.querySelectorAll('#custList .res')[1].dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }))
ok('اختيار العميل يظهر رصيده وحده في بطاقة الطرف', /75,000/.test($('#partyCard').textContent), $('#partyCard').textContent.replace(/\s+/g, ' ').slice(0, 90))

// ⑦ التحصيل المتعدد
$('#multiPay').checked = true; $('#multiPay').dispatchEvent(new window.Event('change', { bubbles: true }))
ok('خانة «تحصيل متعدد» تفتح طرق الدفع', !$('#multiPayBox').hasAttribute('hidden'))
const setPay = (k, v) => { const el = d.querySelector(`.pay[data-k="${k}"]`); el.value = v; el.dispatchEvent(new window.Event('input', { bubbles: true })) }
setPay('cash', 100); setPay('card', 20)
ok('المحصَّل يجمع الطرق (100 + 20)', $('#paidOut').textContent === '120.00', $('#paidOut').textContent)

// ⑧ الخصم: نسبة ↔ يدوي في سطر واحد
$('#discPct').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
$('#discInput').value = '10'; $('#discInput').dispatchEvent(new window.Event('input', { bubbles: true }))
const eqPct = $('#discEq').textContent
ok('نسبة 10% تعرض مقابلها بالريال', /ر\.س/.test(eqPct) && eqPct !== '= 0.00 ر.س', eqPct)
$('#discAmt').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
$('#discInput').value = '50'; $('#discInput').dispatchEvent(new window.Event('input', { bubbles: true }))
ok('خصم يدوي 50 يعرض مقابله بالنسبة', /%/.test($('#discEq').textContent), $('#discEq').textContent)

// ⑨ الأنماط تغيّر الأعمدة فعلاً
const visCols = () => [...d.querySelectorAll('thead th')].filter((th) => !th.classList.contains('hidecol')).length
const modeSel = $('#modeSelect')
const counts = {}
for (const m of ['simple', 'standard', 'profit', 'advanced']) { modeSel.value = m; modeSel.dispatchEvent(new window.Event('change', { bubbles: true })); counts[m] = visCols() }
ok('كل نمط يعطي عدد أعمدة مختلفاً', counts.simple < counts.standard && counts.profit > counts.standard, JSON.stringify(counts))
modeSel.value = 'standard'; modeSel.dispatchEvent(new window.Event('change', { bubbles: true }))
ok('الحقول الثلاثة تتبع الصنف المحدد', $('#selName').textContent !== '—' || $('#selStock').textContent !== '—', $('#selName').textContent)
ok('اسم منشئ الفاتورة ظاهر في الترويسة', /محمد عبده/.test(d.querySelector('.header').textContent))
console.log(errors.length ? '\n⚠ أخطاء: ' + errors.join(' | ') : '\n— بلا أخطاء JS —')
