// فحص سلوكي للنموذج الحي لشاشة الفاتورة (بلا متصفح).
// التشغيل:  mkdir -p /home/user/tools && cd /home/user/tools && npm i jsdom
//           cp /home/user/shopsys/docs/mockups/test_mockup.mjs . && node test_mockup.mjs
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
const file = '/home/user/shopsys/docs/mockups/invoice-layout-2026/index.html'
const html = readFileSync(file, 'utf8')
const errors = []
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true })
dom.virtualConsole.on('jsdomError', (e) => errors.push('jsdomError: ' + e.message))
const { window } = dom
window.alert = () => {}
await new Promise((r) => setTimeout(r, 200))
const d = window.document
const $ = (s) => d.querySelector(s)
const key = (el, k) => el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
const dbl = (el) => el.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }))
const input = (el, v) => { el.value = v; el.dispatchEvent(new window.Event('input', { bubbles: true })) }
let pass = 0, fail = 0
const ok = (label, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? '  ✓ ' : '  ✗ ') + label + (cond ? '' : ' — ' + extra)) }
const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>')).replace(/\s/g, '')
const cell = (r, c) => d.querySelector(`.cell-in[data-r="${r}"][data-c="${c}"]`)
const nameCell = (r) => d.querySelector(`.namecell[data-r="${r}"]`)

console.log('\n── الطلبات الجديدة ──')
// ① لا أسهم في أي حقل أرقام
ok('لا يوجد أي حقل type=number (بلا أسهم زيادة/نقصان)', d.querySelectorAll('input[type=number]').length === 0)
ok('CSS يلغي أزرار السبينر احتياطاً', /webkit-inner-spin-button\{-webkit-appearance:none/.test(css))

// ② الأسهم للتنقل بين الحقول فقط
nameCell(0).focus(); key(nameCell(0), 'ت'); key($('#itemQuery'), 'ArrowDown'); key($('#itemQuery'), 'Enter')
const q0 = cell(0, 'qty'); q0.focus(); input(q0, '7')
key(q0, 'ArrowDown')
ok('سهم لأسفل ينتقل لنفس العمود في السطر التالي', d.activeElement === cell(1, 'qty'), 'الآن=' + d.activeElement?.dataset?.c + '/' + d.activeElement?.dataset?.r)
key(d.activeElement, 'ArrowUp')
ok('سهم لأعلى يعود للسطر السابق', d.activeElement === cell(0, 'qty'))
ok('السهم لم يغيّر قيمة الحقل', cell(0, 'qty').value === '7', 'القيمة=' + cell(0, 'qty').value)
key(cell(0, 'qty'), 'ArrowLeft')
ok('سهم لليسار ينتقل للحقل التالي (السعر)', d.activeElement === cell(0, 'price'), 'الآن=' + d.activeElement?.dataset?.c)
key(cell(0, 'price'), 'ArrowRight')
ok('سهم لليمين يعود للحقل السابق (الكمية)', d.activeElement === cell(0, 'qty'), 'الآن=' + d.activeElement?.dataset?.c)
key(cell(0, 'qty'), 'ArrowRight')
ok('سهم لليمين من الكمية يصل لخلية اسم الصنف', d.activeElement === nameCell(0))

// ③ خلية الصنف فارغة تماماً بلا أي شرح أو سطر بيانات
ok('خلية الصنف الفارغة بلا أي نص', nameCell(2).textContent.trim() === '', '«' + nameCell(2).textContent.trim() + '»')
ok('لا سطر بيانات (المتاح/المخزن) تحت اسم الصنف', d.querySelectorAll('#linesBody .namecell small').length === 0)
ok('كل السطور الفارغة نظيفة تماماً (بلا نص ولا أصفار)', [...d.querySelectorAll('#linesBody tr')].filter((tr) => !tr.querySelector('.namecell b').textContent).every((tr) => tr.textContent.replace(/\s/g, '') === String([...d.querySelectorAll('#linesBody tr')].indexOf(tr) + 1)))
ok('بيانات الصنف تظهر في الحقول العلوية بدلاً منها', $('#selName').textContent !== '—' && $('#selStock').textContent !== '—', $('#selName').textContent + ' | ' + $('#selStock').textContent)

// ④ حجم ديناميكي مع الشاشة
ok('جذر الصفحة يكبر مع الشاشة (clamp على html)', /html\{font-size:clamp\(/.test(css))

// ⑤ المحاذاة داخل جدول الأصناف
ok('رأس الجدول كله في المنتصف', /theadth\{[^}]*text-align:center/.test(css))
ok('خلايا السطور في المنتصف', /tbodytd\{[^}]*text-align:center/.test(css))
ok('عمود اسم الصنف محاذاة يمين', /tbodytd\.cell-name\{text-align:right\}/.test(css) && d.querySelectorAll('#linesBody td.cell-name').length > 0)
ok('حقول الأرقام داخل الخلايا في المنتصف', /\.cell-in\{[^}]*text-align:center/.test(css))

// ⑥ زر الترحيل = حفظ وترحيل فقط
ok('زر الترحيل صار «حفظ وترحيل» بلا مبلغ', /حفظ وترحيل/.test($('#postBtn').textContent) && !$('#postAmount'))
ok('زر تحصيل المبلغ كاملاً باقٍ في لوحة التحصيل', /تحصيل المبلغ كاملاً/.test($('#payFull').textContent))

// ⑦ رأس الجدول: مسح باركود فقط · الشريط السفلي محذوف · المسح يضيف سطراً بالترتيب
ok('شريط الأزرار أسفل الجدول محذوف', !d.querySelector('.lines-foot') && !d.querySelector('#addLineBtn'))
ok('زر «مسح باركود» بجانب عنوان الجدول', !!d.querySelector('.lines-head #barBtn'))
ok('أزرار إضافة/تكرار/حذف موجودة بجانب كل سطر', ['add', 'dup', 'del'].every((a) => !!d.querySelector(`#linesBody [data-act="${a}"]`)))
click($('#barBtn'))
ok('نافذة الباركود تفتح', !$('#barWin').hidden)
const bar = $('#barInput'); bar.value = '62810420004'; key(bar, 'Enter')
const filled = () => [...d.querySelectorAll('#linesBody .namecell b')].map((b) => b.textContent).filter(Boolean)
ok('المسح يضيف الصنف في أول سطر فارغ بالترتيب', filled().length === 2 && /عسل سدر/.test(filled()[1]), filled().join(' / '))
bar.value = 'ITM-2014'; key(bar, 'Enter')
ok('مسح ثانٍ يضيف السطر التالي بالترتيب', /لوز محمص/.test(filled()[2] || ''), filled().join(' / '))
ok('النافذة تبقى مفتوحة للمسح المتتابع', !$('#barWin').hidden && /2 مسح/.test($('#barCount').textContent))
bar.value = '999'; key(bar, 'Enter')
ok('باركود غير معروف: رسالة بلا إضافة سطر', /غير معروف/.test($('#barLog').textContent) && filled().length === 3)
key(d, 'Escape')
ok('Esc يغلق نافذة الباركود', $('#barWin').hidden)

// ⑧ الأزرار الأربعة تحت محرر الشروط في نفس اللوحة
const notesPanel = $('.notes')?.closest('.panel')
ok('الأزرار الأربعة داخل لوحة الشروط تحت المحرر', !!notesPanel?.querySelector('.addons') && notesPanel.querySelector('.addons').children.length === 4)
ok('ترتيبها شبكة منتظمة من عمودين', /\.addons\{display:grid;grid-template-columns:repeat\(2/.test(css))
click($('#expCustBtn'))
ok('«مصروف على العميل» يفتح نافذة إدخال', !$('#expWin').hidden)
$('#expNote').value = 'نقل وتحميل'; $('#expAmount').value = '75'
click($('#expSave'))
ok('الحفظ يضيف رقاقة صغيرة ويزيد العداد', $('#expCustN').textContent === '1' && /نقل وتحميل/.test($('#addonList').textContent))

// ⑨ الترويسة صفّان فقط
const fields = $('.fields')
ok('حقول الترويسة صف واحد (٦ حقول في ٦ أعمدة)', fields.querySelectorAll(':scope > .f:not(.f-strip)').length === 6,
  fields.querySelectorAll(':scope > .f:not(.f-strip)').length + ' حقل')
ok('شبكة الحقول ستة أعمدة ثابتة', /\.fields\{display:grid;grid-template-columns:1\.55fr1fr1fr1\.2fr1\.3fr1fr/.test(css))
ok('الصف الثاني شريط واحد يمتد بعرض الترويسة', !!fields.querySelector('.f-strip .selstrip') && /\.fields\.f-strip\{grid-column:1\/-1\}/.test(css))
ok('المستخدم والخانات الثلاث كلها داخل الشريط', ['selName', 'selStock', 'selCost'].every((id) => !!$('.selstrip #' + id)) && /محمد عبده/.test($('.selstrip').textContent))
ok('بطاقة العميل مضغوطة في سطرين', $('#partyCard').querySelectorAll('.prow').length === 2)

console.log('\n── الطلبات السابقة (عدم انكسار) ──')
ok('لا يوجد شريط بحث أصناف مستقل', !d.querySelector('.entry'))
ok('خمسة سطور ظاهرة على الأقل', d.querySelectorAll('#linesBody tr').length >= 5)
nameCell(4).focus(); key(nameCell(4), 'ع')
ok('الكتابة في خلية الصنف تفتح البحث محمّلاً', !$('#itemWin').hidden && $('#itemQuery').value === 'ع')
ok('نافذة البحث تُصغَّر وتُغلق', !!d.querySelector('#itemWin [data-min]') && !!d.querySelector('#itemWin [data-close]'))
ok('لوحة بيانات الصنف بجانب النتائج', /المتاح/.test($('#itemSide').textContent) && /الباركود/.test($('#itemSide').textContent))
ok('زرا «تعديل الصنف» و«الأسعار» فاعلان', !!$('#btnItemEdit') && !!$('#btnItemPrices'))
key($('#itemQuery'), 'Enter')
ok('اختيار الصنف يقف على الكمية', d.activeElement?.dataset?.c === 'qty')
key(d.activeElement, 'Enter')
ok('Enter من الكمية ← السعر', d.activeElement?.dataset?.c === 'price')
key(d.activeElement, 'Enter')
ok('Enter من السعر ← اسم صنف السطر التالي', d.activeElement?.dataset?.c === 'name')
dbl(nameCell(0))
ok('نقرتان على الاسم تفتحان البحث للتبديل', !$('#itemWin').hidden)
key(d, 'Escape')
click($('#customerField'))
ok('بحث العملاء بالرصيد وحد الائتمان', !$('#custWin').hidden && /الرصيد/.test($('#custList').textContent) && /الحد/.test($('#custList').textContent))
click(d.querySelector('#custList [data-edit]'))
ok('تعديل العميل فوق البحث بلا إغلاقه', !$('#custEditWin').hidden && !$('#custWin').hidden)
$('#ceName').value = 'مؤسسة النخيل — معدّلة'; click($('#ceSave'))
ok('الحفظ يعيد للبحث محدَّثاً بصمت', $('#custEditWin').hidden && !$('#custWin').hidden && /معدّلة/.test($('#custList').textContent))
dbl(d.querySelectorAll('#custList .res')[0])
$('#multiPay').checked = true; $('#multiPay').dispatchEvent(new window.Event('change', { bubbles: true }))
const setPay = (k, v) => input(d.querySelector(`.pay[data-k="${k}"]`), v)
setPay('cash', 100); setPay('card', 20)
ok('تحصيل متعدد مجمَّع (100 + 20)', $('#paidOut').textContent === '120.00', $('#paidOut').textContent)
click($('#discPct')); input($('#discInput'), '10')
ok('خصم نسبة يعرض مقابله بالريال', /ر\.س/.test($('#discEq').textContent) && $('#discEq').textContent !== '= 0.00 ر.س', $('#discEq').textContent)
click($('#discAmt')); input($('#discInput'), '50')
ok('خصم يدوي يعرض مقابله بالنسبة', /%/.test($('#discEq').textContent), $('#discEq').textContent)
const vis = () => [...d.querySelectorAll('thead th')].filter((th) => !th.classList.contains('hidecol')).length
const counts = {}
for (const m of ['simple', 'standard', 'profit', 'advanced']) {
  $('#modeSelect').value = m; $('#modeSelect').dispatchEvent(new window.Event('change', { bubbles: true })); counts[m] = vis()
}
ok('الأنماط تغيّر الأعمدة فعلاً', counts.simple < counts.standard && counts.profit > counts.standard, JSON.stringify(counts))
$('#modeSelect').value = 'standard'; $('#modeSelect').dispatchEvent(new window.Event('change', { bubbles: true }))
ok('اسم منشئ الفاتورة ظاهر في الترويسة', /محمد عبده/.test(d.querySelector('.header').textContent))
ok('بلا أخطاء JavaScript', errors.length === 0, errors.join(' | '))
console.log(`\nالنتيجة: ${pass} ناجح · ${fail} فاشل`)
process.exit(fail ? 1 : 0)
