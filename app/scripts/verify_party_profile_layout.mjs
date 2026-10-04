/**
 * بطاقة الطرف في ترويسة الفاتورة — بلاغ المالك:
 * «مسافة فارغة كبيرة بين اسم العميل ورصيده، والرصيد يخرج خارج إطار البوكس»
 * (النص الظاهر كان: «الرصيد الحالي0.00 ر.س مت»).
 *
 * سببان مجتمعان:
 *   1) تخطيط: `.invoice-party-profile-card` كانت `justify-content: space-between` مع حدود
 *      دنيا صلبة (15rem للاسم + 31rem للمؤشرات = 47rem). داخل نافذة عائمة قابلة للتصغير
 *      لا يتوافر هذا العرض، فتفيض المؤشرات خارج الإطار؛ وفي الشاشة العريضة يتحوّل الفارق
 *      إلى فراغ ميت بين الاسم والرصيد.
 *   2) نصّ: قيمة الرصيد كانت تُبنى دائماً «قيمة + رمز عملة + حالة» فتصير عند التوازن
 *      «0.00 ر.س متزن» — أطول من خانتها، وبلا `text-overflow` على `b` فتُقصّ بصرياً.
 *
 * هذه البوابة تمنع عودة الاثنين: لا حدود دنيا صلبة في أصناف البطاقة، وكل قيمة تُقصّ
 * بثلاث نقاط بدل الخروج، والنص نفسه يمرّ عبر `partyBalanceText` المختصرة.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_party_profile_layout.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { reporter } from './auditKit.mjs'

const R = reporter('بطاقة الطرف — لا فراغ ميت ولا فيضان خارج الإطار')
import { fileURLToPath } from 'node:url'
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const css = readFileSync(`${ROOT}/src/index.css`, 'utf8')
const sales = readFileSync(`${ROOT}/src/ui/pages/AdvancedSalesInvoicePage.tsx`, 'utf8')
const purch = readFileSync(`${ROOT}/src/ui/pages/AdvancedPurchaseInvoicePage.tsx`, 'utf8')

/** جسم قاعدة CSS لمحدِّد بعينه (أول تطابق خارج أي media query متداخلة) */
const ruleOf = (selector) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = css.match(new RegExp(`(^|\\n)\\s*${esc}\\s*\\{([^}]*)\\}`))
  assert.ok(m, `قاعدة مفقودة في index.css: ${selector}`)
  return m[2]
}

/** كل قواعد أصناف بطاقة الطرف (بما فيها ما داخل media queries) */
const partyRules = [...css.matchAll(/([^{}\n]*invoice-party-profile[^{}\n]*)\{([^}]*)\}/g)]
  .map(([, sel, body]) => ({ sel: sel.trim(), body }))

// ① البطاقة مرنة بلا `space-between`: العنصران يتجاوران ويلتفّان بدل التباعد الميت
{
const card = ruleOf('.invoice-party-profile-card')
assert.ok(/flex-wrap:\s*wrap/.test(card), 'ينقص flex-wrap: wrap على .invoice-party-profile-card')
assert.ok(
  !/justify-content:\s*space-between/.test(card),
  'عاد space-between إلى بطاقة الطرف ⇒ فراغ ميت بين الاسم والرصيد',
)
  R.ok('البطاقة تلتفّ ولا تستعمل space-between')
}

// ② لا حدّ أدنى صلب كبير في أي صنف من أصناف البطاقة (هو أصل الفيضان)
{
const offenders = []
for (const { sel, body } of partyRules) {
  for (const [, prop, num] of body.matchAll(/(min-width|flex-basis)\s*:\s*([\d.]+)rem/g)) {
    if (Number(num) >= 6) offenders.push(`${sel} { ${prop}: ${num}rem }`)
  }
}
assert.deepEqual(offenders, [], `حدود دنيا صلبة تُفيض البطاقة داخل النوافذ الضيقة: ${offenders.join(' | ')}`)
  R.ok('لا min-width صلبة ≥ 6rem في أصناف بطاقة الطرف')
}

// ③ الكتلتان تقبلان الانكماش: min-width: 0 شرط كي يعمل text-overflow داخل flex/grid
{
for (const sel of ['.invoice-party-profile-main', '.invoice-party-profile-metrics']) {
  assert.ok(/min-width:\s*0/.test(ruleOf(sel)), `ينقص min-width: 0 على ${sel}`)
}
assert.ok(
  /min-width:\s*0/.test(ruleOf('.invoice-party-profile-metrics > div')),
  'ينقص min-width: 0 على خانة المؤشر ⇒ لا يعمل القصّ بالنقاط',
)
  R.ok('الاسم والمؤشرات يقبلان الانكماش (min-width: 0)')
}

// ④ شبكة المؤشرات تُنقص أعمدتها بدل أن تفيض
{
const metrics = ruleOf('.invoice-party-profile-metrics')
const m = metrics.match(/grid-template-columns:\s*repeat\(\s*auto-fit\s*,\s*minmax\(\s*([\d.]+)rem/)
assert.ok(m, 'شبكة المؤشرات ليست repeat(auto-fit, minmax(...)) ⇒ ستفيض عند الضيق')
assert.ok(Number(m[1]) <= 8, `أدنى عرض عمود ${m[1]}rem كبير؛ يجب ≤ 8rem ليتسع «الرصيد الحالي» في نافذة ضيقة`)
  R.ok('شبكة المؤشرات auto-fit تنكمش بعدد أعمدتها')
}

// ⑤ كل نصّ داخل البطاقة يُقصّ بثلاث نقاط بدل الخروج من الإطار
{
for (const sel of [
  '.invoice-party-profile-metrics b',
  '.invoice-party-profile-metrics small',
  '.invoice-party-profile-main b',
  '.invoice-party-profile-main small',
]) {
  const body = ruleOf(sel)
  assert.ok(/overflow:\s*hidden/.test(body), `ينقص overflow: hidden على ${sel}`)
  assert.ok(/text-overflow:\s*ellipsis/.test(body), `ينقص text-overflow: ellipsis على ${sel}`)
  assert.ok(/white-space:\s*nowrap/.test(body), `ينقص white-space: nowrap على ${sel}`)
}
  R.ok('القيم والعناوين تُقصّ بثلاث نقاط')
}

// ⑥ ترويسة الفاتورة كلها لا تفرض عرضاً أكبر من النافذة
{
const grid = ruleOf('.invoice-reference-account-invoice-grid')
const bare = [...grid.matchAll(/minmax\(\s*([\d.]+)rem/g)].map((x) => `${x[1]}rem`)
assert.deepEqual(bare, [], `minmax بحدّ أدنى صلب في شبكة الترويسة (${bare.join(', ')}) ⇒ فيضان أفقي؛ استعمل minmax(min(Nrem, 100%), …)`)
for (const [, num] of css.matchAll(/\.invoice-reference-top-actions\s*\{[^}]*?min-width:\s*([\d.]+)rem/g)) {
  assert.fail(`شريط الأدوات يفرض min-width: ${num}rem ⇒ يوسّع الترويسة قسراً؛ استعمل min(${num}rem, 100%)`)
}
  R.ok('ترويسة الفاتورة تنكمش مع النافذة (لا minmax صلبة)')
}

// ⑦ نصّ الرصيد يمرّ عبر الدالة المختصرة في الصفحتين، ولا يُبنى يدوياً
{
for (const [name, src] of [['البيع', sales], ['الشراء', purch]]) {
  assert.ok(src.includes("partyBalanceText"), `صفحة ${name} لا تستعمل partyBalanceText`)
  assert.ok(
    !/\$\{cur\.symbol\}\s*\$\{selected(Customer|Supplier)Balance\s*>/.test(src),
    `صفحة ${name} عادت تبني نص الرصيد يدوياً (قيمة + رمز + حالة) ⇒ يفيض من خانته`,
  )
}
  R.ok('صفحتا الفاتورة تستعملان partyBalanceText')
}

// ⑧ سلوك الدالة نفسها: عند التوازن كلمة واحدة بلا أرقام ولا رمز عملة
{
const { partyBalanceText } = await import('../src/core/money.ts')
const sar = { code: 'SAR', symbol: 'ر.س', decimals: 2, name: 'ريال' }
const zero = partyBalanceText(0, true, sar)
assert.equal(zero, 'متزن')
assert.ok(!/\d/.test(zero) && !zero.includes(sar.symbol), 'نص التوازن يجب أن يخلو من الأرقام ورمز العملة')

const owes = partyBalanceText(125000, true, sar)
assert.ok(owes.includes('عليه') && owes.includes('ر.س'), `نص المديونية غير متوقع: ${owes}`)
const owed = partyBalanceText(-125000, true, sar)
assert.ok(owed.includes('له') && !owed.includes('-'), `نص الدائنية غير متوقع: ${owed}`)

const supplier = partyBalanceText(125000, true, sar, { owes: 'مستحق له', owed: 'لك عنده' })
assert.ok(supplier.includes('مستحق له'), `صيغة المورد غير مطبَّقة: ${supplier}`)

assert.equal(partyBalanceText(0, false, sar), 'نقدي — بلا حساب')

// أطول نص محتمل لمبلغ من سبعة أرقام يبقى ضمن خانة المؤشر (≈ 22 محرفاً)
const longest = partyBalanceText(999999999, true, sar, { owes: 'مستحق له', owed: 'لك عنده' })
assert.ok(longest.length <= 26, `نص الرصيد طويل (${longest.length} محرفاً): ${longest}`)
  R.ok('partyBalanceText: «متزن» بلا أرقام عند الصفر، ومختصرة عند غيره')
}

R.done()
