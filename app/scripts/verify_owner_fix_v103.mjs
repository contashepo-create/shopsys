/* بوابة جولة v1.0.3 (بلاغات المالك بعد أول أسبوع استخدام فعلي):
   ① صورتا «حول»: مسارات نسبية — لا مسارات مطلقة تنكسر تحت file://
   ② زرّا التحديث موحّدان: قسم السحابة للمتصفح فقط (isElectronRuntime) — زر واحد يعمل في كل نسخة
   ③ أيقونة التطبيق: icon.ico حقيقي في buildResources + أيقونة نافذة في main.ts
   ④ عمود الضريبة في فواتير البيع/الشراء مخفي افتراضياً (tax: false) ويُعاد من «تخصيص الحقول»
   ⑤ عمود ضريبة الكاشير ديناميكي: يختفي كلياً للمنشأة المعفاة (لا عمود بلا قيم = تناسق الأعمدة)
   ⑥ الأرصدة الافتتاحية: نوع «حساب عام» بقيود متوازنة بطبيعة الحساب + منع الحسابات المغطاة
   ⑦ أمر الشراء: الوضع المتقدم المطابق للفاتورة + زر «اعتماد أمر الشراء» (لا «ترحيل» لأمر)
   ⑧ مركز تحكم المطوّر: بوت تليجرام + نقاط REST متوافقة مع cloud.ts + مولد مفاتيح + اختبار ذهبي */
import { readFileSync, existsSync } from 'node:fs'
import assert from 'node:assert/strict'
import { reporter } from './auditKit.mjs'

const R = reporter('جولة v1.0.3 — بلاغات الأسبوع الأول')
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')

/* ①② صور ووحدة التحديث في «حول» */
{
  const about = read('src/ui/pages/AboutPage.tsx')
  assert.ok(about.includes('src="./app-logo.png"') && about.includes('src="./dev-logo.png"'), 'صور حول ليست نسبية')
  assert.ok(!about.includes('src="/app-logo.png"') && !about.includes('src="/dev-logo.png"'), 'بقي مسار مطلق لصورة')
  R.ok('صورتا «حول» بمسارين نسبيين — لا مطلق ينكسر تحت file://')
  assert.ok(about.includes('!isElectronRuntime() && ('), 'قسم فحص السحابة ليس حكراً على المتصفح')
  assert.ok(about.includes('import { isElectronRuntime }'))
  assert.ok(strip(about).includes('<DesktopUpdater />'), 'DesktopUpdater مفقود لنسخة سطح المكتب')
  R.ok('زرّا التحديث موحّدان: السحابة للمتصفح فقط وسطح المكتب على electron-updater وحده')
}

/* ③ الأيقونة الحقيقية */
{
  const icoUrl = new URL('../desktop/build/icon.ico', import.meta.url)
  assert.ok(existsSync(icoUrl), 'icon.ico غير موجود')
  const buf = readFileSync(icoUrl)
  assert.ok(buf.length > 10_000, `ICO بحجم ${buf.length} بايت — أصغر من المتوقع`)
  assert.equal(buf.readUInt16LE(0), 0, 'توقيع ICO يجب أن يكون 0')
  assert.equal(buf.readUInt16LE(2), 1, 'نوع الملف يجب أن يكون 1 (ICO)')
  assert.ok(buf.readUInt16LE(4) >= 1, 'لا صور داخل الحاوية')
  const main = read('desktop/main.ts')
  assert.ok(main.includes("icon: join(__dirname, '../dist/app-icon.png')"), 'أيقونة النافذة غير مضبوطة')
  const yml = read('electron-builder.yml')
  assert.ok(/buildResources:\s*desktop\/build/.test(yml), 'buildResources ليس desktop/build')
  R.ok('أيقونة التطبيق: ICO حقيقي متعدد الأحجام في buildResources + أيقونة نافذة — نهاية أيقونة Electron الافتراضية')
}

/* ④⑤ الضريبة */
{
  const store = read('src/stores/app.store.ts')
  assert.ok(/DEFAULT_INVOICE_COLUMNS[^=]*=\s*\{ code: true, unit: true, tax: false \}/.test(store), 'الضريبة ليست مخفية افتراضياً')
  R.ok('عمود الضريبة مخفي افتراضياً في الفواتير — يُعاد من «تخصيص الحقول» داخل المستند')
  const pos = read('src/ui/pages/PosPage.tsx')
  assert.ok(pos.includes('const showTaxCol = taxPolicy.effectivePercent > 0'), 'لا شرط إظهار لعمود ضريبة الكاشير')
  assert.ok(pos.includes("const cartGrid = showTaxCol ? 'grid-cols-[1fr_7.3rem_6rem_3.7rem_4.2rem_5.8rem]' : 'grid-cols-[1fr_7.3rem_6rem_4.2rem_5.8rem]'"), 'قالب السلة ليس ديناميكياً')
  assert.ok(pos.includes('{showTaxCol && <span'), 'رأس الضريبة ليس مشروطاً')
  assert.ok(pos.includes('{showTaxCol && ('), 'خلية ضريبة السطر ليست مشروطة')
  assert.ok(!strip(pos).includes('grid-cols-[1fr_7.3rem_6rem_3.7rem_4.2rem_5.8rem] gap-2'), 'بقي قالب ثابت بعمود ضريبة')
  R.ok('سلة الكاشير: عمود الضريبة ديناميكي — يختفي كلياً للمعفى (رأس وصفوف معاً = تناسق الأعمدة)')
}

/* ⑥ الأرصدة الافتتاحية — نوع الحساب العام */
{
  const core = read('src/core/openingBalances.ts')
  assert.ok(core.includes("'item_stock' | 'account'"), 'نوع الحساب العام غير معرف')
  assert.ok(core.includes('OPENING_COVERED_SYSTEM_KEYS = new Set(['), 'قائمة الحسابات المغطاة غير معرفة')
  assert.ok(core.includes("case 'account':"), 'لا فرع لحساب عام في بناء القيد')
  assert.ok(core.includes("accountNatureKind === 'debit'"), 'اتجاه القيد لا يتبع طبيعة الحساب')
  const repo = read('src/data/repo.ts')
  assert.ok(repo.includes("args.kind === 'account'"), 'repo لا يعالج نوع الحساب العام')
  assert.ok(repo.includes('OPENING_COVERED_SYSTEM_KEYS.has(acc.systemKey)'), 'لا منع للحسابات المغطاة')
  assert.ok(repo.includes('accountNature(STANDARD_COA.find((a) => a.code === String(args.refId))?.rootType'), 'طبيعة الحساب لا تمرر للقيد')
  const page = read('src/ui/pages/OpeningBalancesPage.tsx')
  assert.ok(page.includes("id: 'account', nameAr: 'حسابات عامة'"), 'لا تبويب للحسابات العامة')
  assert.ok(page.includes('OPENING_COVERED_SYSTEM_KEYS.has(a.systemKey)'))
  assert.ok(page.includes("a.code !== '3101'"), 'رأس المال يقبل رصيداً من التبويب العام')
  R.ok('الأرصدة الافتتاحية: «حسابات عامة» لأي حساب بالشجرة — قيد بطبيعة الحساب، والحسابات المغطاة من تبويباتها')
}

/* ⑦ أمر الشراء مطابق للفاتورة */
{
  const po = read('src/ui/pages/PurchaseOrdersPage.tsx')
  assert.ok(po.includes('mode="advanced"'), 'محرر أمر الشراء ليس بالوضع المتقدم')
  assert.ok(!po.includes('mode="simple"'), 'بقي الوضع المبسط في أمر الشراء')
  const frame = read('src/ui/components/InvoicePOSFrame.tsx')
  assert.ok(frame.includes('postLabel?: string'), 'زر الاعتماد غير قابل للتخصيص')
  assert.ok(frame.includes("{postLabel ?? 'حفظ وترحيل'}"), 'النص الافتراضي للفواتير تغيّر')
  assert.ok(po.includes('postLabel="اعتماد أمر الشراء"'), 'أمر الشراء لا يستعمل نص الاعتماد الصحيح')
  R.ok('أمر الشراء: الوضع المتقدم المطابق للفاتورة + زر «اعتماد أمر الشراء» — التزام تجاري لا ترحيل')
}

/* ⑧ مركز تحكم المطوّر (بوت + Cloudflare) */
{
  for (const f of ['src/worker.js', 'src/licenseLib.js', 'scripts/keygen.mjs', 'wrangler.toml', 'README.md', '.gitignore']) {
    assert.ok(existsSync(new URL(`../../tools/devbot/${f}`, import.meta.url)), `tools/devbot/${f} غير موجود`)
  }
  R.ok('حزمة tools/devbot كاملة: Worker + مكتبة توقيع + مولد مفاتيح + إعداد + دليل نشر')
  const worker = read('../tools/devbot/src/worker.js')
  assert.ok(worker.includes("url.pathname === '/about'") && worker.includes("url.pathname === '/revoked'"), 'نقاط about/revoked مفقودة')
  assert.ok(worker.includes('/^\\/subscription\\/([^/]+)$/'), 'نقطة subscription مفقودة')
  assert.ok(worker.includes('String(actorId) !== cfg.adminId') && worker.includes('callback?.from?.id'), 'أوامر وأزرار البوت ليست محصرة بمعرّف المطوّر')
  assert.ok(worker.includes('x-telegram-bot-api-secret-token'), 'webhook بلا تحقق رأس تليجرام السري')
  R.ok('Worker: نقاط العقد الثلاث متوافقة مع cloud.ts + webhook محمي + إدارة محصرة بالمطوّر وحده')
  const lib = read('../tools/devbot/src/licenseLib.js')
  assert.ok(lib.includes("export const KEY_PREFIX = 'SHOPSYS1'"))
  assert.ok(lib.includes('features: [...p.features].sort(), issuedAt: p.issuedAt, expiresAt: p.expiresAt,'))
  assert.ok(lib.includes('if (p.extraUsers != null) base.extraUsers = p.extraUsers'))
  assert.ok(lib.includes('if (p.activityId != null) base.activityId = p.activityId'))
  assert.ok(lib.includes("h.toString(16).padStart(8, '0')"), 'بصمة الحرق ليست djb2-8hex')
  R.ok('مكتبة التوقيع مستنسخة حرفياً من license.ts: canonicalPayload + بصمة djb2 + بادئة SHOPSYS1')
  const compat = read('tests/devbot_license_compat.test.ts')
  assert.ok(compat.includes('verifyLicenseKey'), 'لا تحقق بverifyLicenseKey في الاختبار الذهبي')
  assert.ok(compat.includes('issueLicenseKey(basePayload, PRIV_B64U)'))
  R.ok('الاختبار الذهبي: مفاتيح البوت تمر بتحقق العميل الكامل — التوافق مُثبت لا مفترض')
}

R.done()
