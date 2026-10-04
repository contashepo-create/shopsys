/**
 * المرحلة التالية من طلب المالك: **١٨ شاشة تخصصية بلغة المستند الموحّدة**.
 *
 * كانت هذه الشاشات (ماكينات الدفع · عقود الإيجار · الموظفون · العيادة · المعمل ·
 * المقاولات بعمقها · العقارات · المطاعم · المغاسل · السيارات · المعدات · النقل ·
 * المجوهرات · الصيانة · المحافظ · عمليات المشاريع · خطط المقاولات) تفتح نوافذ
 * إدخال بيضاء بترويسة زجاجية وعناوين فيها إيموجي، بلا أي تسلسل ولا إعلان لأثر
 * العملية على الدفتر — بينما الفاتورة والسندات صارت «مستنداً» بلغة `--doc-*`.
 *
 * ما تحرسه هذه البوابة:
 *   ① غلاف النافذة المشترك (`Modal`) صار ورقة مستند: ترويسة بشارة وعنوان وسطر
 *      سياق، وسطح رمادي تُفرش عليه الأقسام — فتُرحّل كل نوافذ النظام دفعة واحدة.
 *   ② كل شاشة من الثمانية عشرة فيها قسم مرقّم وشريط «الأثر» قبل زر التنفيذ.
 *   ③ لا إيموجي في عنوان أي نافذة إدخال في المشروع كله.
 *   ④ **فحص وظيفي**: كل كود حساب يُذكر في شريط الأثر موجود فعلاً في الدليل
 *      القياسي — فلا يَعِد المستند بقيد على حساب غير موجود.
 *   ⑦ **الفحص الأهم**: وجود الكود في الدليل لا يعني صحته للشاشة — «4102 مرتجعات
 *      المبيعات» و«4103 إيرادات صيانة وخدمات» كلاهما قائم، وذِكر الأول في تسليم
 *      أمر صيانة كذبٌ يمر من البند ④. لذلك تُقارن أكواد كل شاشة بمجموعة الحسابات
 *      التي يقيّدها محرّكها فعلاً (`src/core/*.ts` + بُناة القيود في `repo.ts`)،
 *      كما رُوجعت يدوياً سطراً سطراً في تدقيق 2026-09-28.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_specialized_screens_document.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { reporter } from './auditKit.mjs'

const R = reporter('الشاشات التخصصية — نوافذ إدخال بلغة المستند')
import { fileURLToPath } from 'node:url'
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const css = readFileSync(`${ROOT}/src/index.css`, 'utf8')
const ui = readFileSync(`${ROOT}/src/ui/components/ui.tsx`, 'utf8')

/** الشاشات الثمانية عشرة المُتعهَّد بمراجعتها (§8 من تقرير التدقيق) */
const SCREENS = [
  ['ماكينات الدفع', 'PaymentTerminalsPage.tsx'],
  ['عقود الإيجار', 'RentalContractsPage.tsx'],
  ['الموظفون والسلف', 'EmployeesPage.tsx'],
  ['العيادة', 'ClinicPages.tsx'],
  ['المعمل', 'LabPages.tsx'],
  ['المقاولات', 'ContractingPages.tsx'],
  ['عمق المقاولات', 'ContractingDepthPages.tsx'],
  ['خطط المقاولات', 'ContractingPlanPages.tsx'],
  ['العقارات', 'RealEstatePages.tsx'],
  ['المطاعم', 'RestaurantOrdersPage.tsx'],
  ['المغاسل', 'LaundryPage.tsx'],
  ['معرض السيارات', 'CarsPage.tsx'],
  ['تأجير المعدات', 'EquipmentPage.tsx'],
  ['النقل والرحلات', 'TripsPage.tsx'],
  ['المجوهرات', 'JewelryPage.tsx'],
  ['الصيانة', 'MaintenancePage.tsx'],
  ['خدمات المحافظ', 'WalletServicesPage.tsx'],
  ['عمليات المشاريع', 'ProjectOpsPages.tsx'],
]
const src = new Map(SCREENS.map(([label, file]) => [file, { label, text: readFileSync(`${ROOT}/src/ui/pages/${file}`, 'utf8') }]))
const ruleOf = (selector) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = css.match(new RegExp(`(^|\\n)\\s*${esc}\\s*\\{([^}]*)\\}`))
  assert.ok(m, `قاعدة مفقودة في index.css: ${selector}`)
  return m[2]
}

/* ① غلاف النافذة المشترك صار ورقة مستند */
{
  const shell = ui.slice(ui.indexOf('export function Modal('))
  for (const cls of ['doc-window', 'doc-window-head', 'doc-window-title', 'doc-window-body', 'doc-window-close']) {
    assert.ok(shell.includes(cls), `غلاف النافذة المشترك ينقصه ${cls}`)
  }
  assert.ok(!/rounded-3xl bg-white/.test(shell), 'غلاف النافذة ما زال بطاقة بيضاء بحواف قديمة')
  assert.ok(!/glass rounded-t-3xl/.test(shell), 'الترويسة الزجاجية القديمة ما زالت قائمة')
  assert.ok(/subtitle\?: string/.test(ui), 'النافذة بلا سطر سياق (subtitle) في ترويستها')
  assert.ok(/z-\[70\]/.test(shell), 'ترويسة النافذة فقدت طبقتها (70) فستختفي خلف الرؤوس اللاصقة')
  for (const [sel, token] of [['.doc-window', '--doc-surface'], ['.doc-window-head', '--doc-paper'], ['.doc-window-body', 'padding'], ['.doc-window-icon', '--doc-accent']]) {
    assert.ok(ruleOf(sel).includes(token), `${sel} لا يقرأ ${token}`)
  }
  for (const sel of ['.doc-window', '.doc-window-head', '.doc-window-title', '.doc-window-icon']) {
    const body = ruleOf(sel)
    const hard = body.match(/#[0-9a-fA-F]{3,8}/g) ?? []
    assert.deepEqual(hard, [], `${sel} فيه لون محفور (${hard.join('، ')}) — استعمل var(--doc-*)`)
  }
  R.ok('غلاف النافذة المشترك ورقة مستند بمتغيرات --doc-* — كل منبثقات النظام ترثه دفعة واحدة')
}

/* ② الشاشات الثمانية عشرة: قسم مرقّم وأثر معلن وسطر سياق */
{
  const missing = []
  for (const [label, file] of SCREENS) {
    const { text } = src.get(file)
    const heads = (text.match(/<DocSectionHead step="/g) ?? []).length
    const outcomes = (text.match(/<DocOutcome>/g) ?? []).length
    const subtitles = (text.match(/subtitle="/g) ?? []).length
    if (!text.includes("from '../components/DocSection.tsx'")) missing.push(`${label}: لا تستورد قطع المستند`)
    if (heads < 1) missing.push(`${label}: بلا قسم مرقّم`)
    if (outcomes < 1) missing.push(`${label}: بلا شريط أثر قبل التنفيذ`)
    if (subtitles < 1) missing.push(`${label}: نافذتها بلا سطر سياق`)
  }
  assert.deepEqual(missing, [], `شاشات لم تُرحَّل بعد: ${missing.join(' | ')}`)
  R.ok(`الشاشات الثمانية عشرة كلها: قسم مرقّم + سطر سياق + شريط أثر (${SCREENS.length}/18)`)
}

/* ③ لا إيموجي في عنوان أي نافذة إدخال في المشروع */
{
  const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/u
  const offenders = []
  for (const [, file] of SCREENS) {
    for (const m of src.get(file).text.matchAll(/<Modal\b[^]{0,400}?title="([^"]*)"/g)) {
      if (EMOJI.test(m[1])) offenders.push(`${file}: ${m[1]}`)
    }
  }
  assert.deepEqual(offenders, [], `عناوين نوافذ فيها إيموجي: ${offenders.join(' | ')}`)
  R.ok('عناوين النوافذ نصّ مستند نظيف — الأيقونة من شارة الترويسة لا من إيموجي داخل العنوان')
}

/* ④ فحص وظيفي: كل حساب يَعِد به شريط الأثر موجود في الدليل القياسي */
{
  const { STANDARD_COA } = await import('../src/core/ledger.ts')
  const known = new Set(STANDARD_COA.map((a) => a.code))
  assert.ok(known.size > 40, `الدليل القياسي صغير بشكل مريب (${known.size})`)
  const cited = new Map()
  for (const [label, file] of SCREENS) {
    for (const m of src.get(file).text.matchAll(/<DocOutcome>([^]*?)<\/DocOutcome>/g)) {
      for (const [, code] of m[1].matchAll(/\b([1-5]\d{3})\b/g)) {
        if (!cited.has(code)) cited.set(code, label)
      }
    }
  }
  assert.ok(cited.size >= 12, `أشرطة الأثر تذكر ${cited.size} حساباً فقط — الوصف غير محاسبي`)
  const ghosts = [...cited].filter(([code]) => !known.has(code)).map(([code, label]) => `${code} (${label})`)
  assert.deepEqual(ghosts, [], `شريط الأثر يَعِد بقيد على حساب غير موجود في الدليل: ${ghosts.join('، ')}`)
  R.ok(`أشرطة الأثر تذكر ${cited.size} حساباً، وكلها موجودة فعلاً في الدليل القياسي (${known.size} حساباً)`)
}

/* ⑦ مطابقة أكواد كل شاشة لمحرّكها الفعلي (لا لمجرد وجودها في الدليل) */
{
  /**
   * لكل شاشة: الحسابات التي تلمسها قيودها فعلاً — مستخرجة من بُناة القيود لا من
   * النص. أي كود خارج القائمة = شريط أثر يَعِد بقيد لا يحدث (أو يُسمّي الحساب
   * الخطأ من بين حسابات متشابهة). عند إضافة تدفق جديد: عدّل المحرك أولاً ثم
   * وسّع القائمة هنا بنفس الكود — البوابة عقدٌ بين الشاشة والدفتر.
   */
  const ENGINE = {
    'PaymentTerminalsPage.tsx': ['5112', '5113'], // recordPaymentTerminalSettlement: بنك/حساب تسوية الماكينة + عمولة + فروق
    'RentalContractsPage.tsx': ['1104', '2103', '2109', '4104'], // rental.ts: إيجار + تأمين + إقفال
    'EmployeesPage.tsx': ['1107', '2104', '2107', '2111', '2116', '5102', '5117'], // payroll.ts + staffCommissions.ts + مستحقات سائقي النقلات
    'ClinicPages.tsx': ['1104', '2102', '4102', '4108'], // clinic.ts (زيارة) + serviceRefund.ts (مرتجع)
    'LabPages.tsx': ['1104', '2105', '4106', '5109'], // lab.ts: 4106 إيراد تحاليل + عمولة المحيلين
    'ContractingPages.tsx': ['1104', '1105', '2101', '2102', '2109', '2116', '4102', '4107', '5110', '5117'],
    'ContractingDepthPages.tsx': ['1104', '1105', '1109', '1111', '2101', '2108', '2112', '4107', '5108', '5110'],
    'ContractingPlanPages.tsx': ['4107', '5110'], // الموازنة والمهام بلا قيد — تشير لمصدر القيد
    'RealEstatePages.tsx': ['1104', '1113', '2102', '2103', '2115', '2116', '4110', '4113', '4114', '4115', '5108', '5116', '5117'],
    'RestaurantOrdersPage.tsx': ['1103', '1104', '2102', '4101', '5101'], // settleRestaurantOrder ⇒ postSale
    'LaundryPage.tsx': ['2109', '4103'], // laundry.ts: عربون 2109 ثم 4103 خدمات
    'CarsPage.tsx': ['1103', '1104', '2101', '2102', '2110', '4101', '4104', '4109', '5101'],
    'EquipmentPage.tsx': ['1201', '1202', '4104', '5105', '5107'], // assets.ts + مصروف تشغيل المعدة
    'TripsPage.tsx': ['1104', '4105', '5106'], // logistics.ts
    'JewelryPage.tsx': ['1103', '4101', '5101'], // jewelry.ts: كسر بالتكلفة والفرق ربحاً أو خسارة
    'MaintenancePage.tsx': ['1103', '1104', '2102', '2109', '4102', '4103', '5101'], // maintenance.ts + مرتجع خدمة
    'WalletServicesPage.tsx': ['1104', '2102', '4103'], // walletServices.ts: الهامش على 4103
    'ProjectOpsPages.tsx': ['1103', '5110'], // projectOps.ts: إذن صرف مواد بالمتوسط المرجح
  }
  const strays = []
  for (const [label, file] of SCREENS) {
    const allowed = new Set(ENGINE[file] ?? [])
    assert.ok(allowed.size > 0, `الشاشة ${label} بلا خريطة حسابات معتمدة من المحرك`)
    for (const m of src.get(file).text.matchAll(/<DocOutcome>([^]*?)<\/DocOutcome>/g)) {
      for (const [, code] of m[1].matchAll(/\b([1-5]\d{3})\b/g)) {
        if (!allowed.has(code)) strays.push(`${label}: ${code}`)
      }
    }
  }
  assert.deepEqual(strays, [], `شريط أثر يذكر حساباً لا يقيّده محرك الشاشة: ${strays.join('، ')}`)
  const total = Object.values(ENGINE).reduce((n, list) => n + list.length, 0)
  R.ok(`أكواد أشرطة الأثر مطابقة لبُناة القيود نفسها — ${total} ارتباط شاشة/حساب بلا كود دخيل`)
}

/* ⑤ الأثر يُعلن الاتجاه أو ينفي القيد صراحة — لا وصف إنشائي */
{
  const vague = []
  for (const [label, file] of SCREENS) {
    for (const m of src.get(file).text.matchAll(/<DocOutcome>([^]*?)<\/DocOutcome>/g)) {
      const t = m[1]
      if (!/مديناً|دائناً|لا قيد|يُخصم|يُقارن/.test(t)) vague.push(`${label}: ${t.slice(0, 60)}…`)
    }
  }
  assert.deepEqual(vague, [], `أشرطة أثر لا تعلن اتجاه القيد: ${vague.join(' | ')}`)
  R.ok('كل شريط أثر يقول ماذا يُدين وماذا يُدائن — أو يعلن صراحةً أنه بلا قيد')
}

/* ⑥ أقسام المستند نفسها لم تفقد لغتها (doc-* لا ألوان محفورة) */
{
  const docSection = readFileSync(`${ROOT}/src/ui/components/DocSection.tsx`, 'utf8')
  for (const cls of ['doc-card', 'doc-ring', 'doc-band', 'doc-ink', 'doc-faint', 'doc-head']) {
    assert.ok(docSection.includes(cls), `قطع المستند فقدت الصنف ${cls}`)
  }
  assert.ok(!/#[0-9a-fA-F]{3,6}/.test(docSection), 'لون محفور في قطع المستند المشتركة')
  R.ok('قطع الأقسام المشتركة ما زالت بلا لون محفور — تتبع الوضع الليلي تلقائياً')
}

R.done()
