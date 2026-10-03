/**
 * بوابة جولة المالك 2026-10-01 (الثانية) — العملات الأجنبية والنوافذ وتبويبات HR:
 *
 * ① تبويبات شؤون الموظفين: مسار واحد ديناميكي /hr/:tab — المسارات الصريحة
 *    المكررة كانت تسبق فلا يصل :tab إلى useParams فتبقى الصفحة على «الحضور».
 * ② إغلاق نافذة مصغَّرة من شريط المهام: تُستعاد أولاً ثم يظهر حوار تأكيدها
 *    (كان الحوار يُرسم داخل نافذة غير مرسومة أصلاً).
 * ③ التحصيل/السداد بعملة أجنبية: للفاتورة المتقدمة فقط + سعر اليوم تحت
 *    العملة + نافذة أسعار مفلترة + إعدادات يدوي/API بالرقم السري للمالك.
 * ④ لوحة الشروط: مربع أصغر + أزرار المصروفات والعمولات في صفين لا شريط تمرير.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_owner_fx_windows_hr.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(__dirname, '..', 'src', p), 'utf8')
let pass = 0; const ok = (n) => { pass++; console.log('  ✓', n) }

const app = read('App.tsx')
const winStore = read('ui/windows/windowStore.ts')
const sales = read('ui/pages/AdvancedSalesInvoicePage.tsx')
const purchase = read('ui/pages/AdvancedPurchaseInvoicePage.tsx')
const fxManager = read('ui/components/FxRatesManager.tsx')
const fxCollect = read('ui/components/FxCollectModal.tsx')
const fxCore = read('core/fxRates.ts')
const appStore = read('stores/app.store.ts')
const settings = read('ui/pages/GeneralSettingsPage.tsx')
const css = read('index.css')

console.log('① تبويبات شؤون الموظفين — مسار واحد ديناميكي')
{
  assert.ok(app.includes('<Route path="/hr/:tab" element={<HrPage />} />'), 'مسار /hr/:tab مفقود')
  for (const id of ['attendance', 'fingerprint', 'leaves', 'shifts', 'reports']) {
    assert.ok(!app.includes(`<Route path="/hr/${id}"`), `مسار صريح مكرر /hr/${id} يسبق المسار الديناميكي`)
  }
  ok('راوتر نظيف: /hr + /hr/:tab فقط — useParams يستقبل التاب في كل النقرات')
}

console.log('② إغلاق نافذة مصغَّرة من شريط المهام')
{
  assert.ok(/if \(win\.mode === 'minimized'\) get\(\)\.focusWindow\(id\)/.test(winStore), 'النافذة المصغرة لا تُرفع للأمام قبل حوار الإغلاق')
  assert.ok(/row\.mode === 'minimized' \? 'normal' : row\.mode, askingClose: true/.test(winStore), 'النافذة المصغرة لا تُستعاد (normal) عند طلب إغلاقها')
  ok('طلب إغلاق مصغَّرة ⇒ استعادة (focus + normal) ثم حوار التأكيد — والبقية لا تُمس')
}

console.log('③ عملة أجنبية: زر واحد → نافذة منظمة (§93) للفاتورة المتقدمة فقط')
{
  for (const [page, verb, panel] of [[sales, 'التحصيل', 'payment'], [purchase, 'السداد', 'purchase']]) {
    const fxGate = "<div className=\"invoice-doc-fx\""
    assert.ok(page.includes(fxGate), `${verb} بعملة أجنبية: كتلة FX غير مقيّدة بالنمط المتقدم في ${panel}`)
    assert.ok(page.includes('متاح في الفاتورة المتقدمة فقط'), `${panel}: لا صمام أمان يمنع ترحيل ساق FX من نمط غير متقدم`)
    /* §93: طلب المالك — بدل الحقول المتداخلة داخل لوحة الدفع: زر يفتح نافذة منبثقة بكل الحقول */
    assert.ok(page.includes('data-fx-open') && page.includes('<FxCollectModal'), `${panel}: زر العملة الأجنبية أو نافذتها مفقودان`)
    assert.ok(page.includes('onApply={(leg)=>') && page.includes('data-fx-summary'), `${panel}: الحفظ لا يعيد التعبئة التلقائية أو شارة الملخص مفقودة`)
    assert.ok(page.includes('fxLegWithDefaultRate('), `${panel}: الساق لا تستعمل السعر المحفوظ افتراضياً`)
  }
  assert.ok(fxCollect.includes('data-fx-collect-modal'), 'المكوّن: جذر النافذة غير موسوم')
  assert.ok(fxCollect.includes('data-fx-today') && fxCollect.includes('data-fx-rates-popup') && fxCollect.includes('<FxRatesManager focusCode={draft.currencyCode}'), 'المكوّن: رقاقة سعر اليوم → نافذة مفلترة غير موجودة')
  assert.ok(fxCollect.includes('fxLegWithDefaultRate(') && fxCollect.includes('validateFxLeg(') && fxCollect.includes('convertFxToBookMinor('), 'المكوّن: التحقق/التحويل/الفحص غير محققة')
  assert.ok(fxCollect.includes('data-fx-apply') && fxCollect.includes('data-fx-preview') && fxCollect.includes('data-fx-amount') && fxCollect.includes('data-fx-rate'), 'المكوّن: أزرار ومعاينات النافذة ناقصة')
  assert.ok(css.includes('.invoice-doc-fx-open') && css.includes('.invoice-doc-fx-active'), 'CSS زر العملة/شارة الملخص مفقود')
  ok('البيع والشراء: زر واحد → نافذة منظمة (عملة/مبلغ/سعر/سعر اليوم/معاينة) → تعبئة تلقائية + شارة ملخص قابلة للتعديل')
}

console.log('④ مدير أسعار الصرف: يدوي/API — المالك فقط وبالرقم السري')
{
  assert.ok(fxManager.includes("useSupervisorApproval('set.general', { forcePin: true })"), 'الحفظ/السحب لا يمران بالرقم السري إجبارياً')
  assert.ok(fxManager.includes('كيف تُستعمل أسعار الصرف؟'), 'شرح طريقة الاستخدام للمستخدم مفقود')
  assert.ok(/data-fx-save\b/.test(fxManager) && /data-fx-mode/.test(fxManager) && /data-fx-pull/.test(fxManager), 'أزرار الحفظ/الوضع/السحب موسومة')
  assert.ok(fxManager.includes('open.er-api.com') && fxManager.includes('customUrl'), 'خيارا المزود (مجاني/مخصص) غير مكتملين')
  assert.ok(fxCore.includes('export async function fetchFxRates'), 'دالة السحب من API مفقودة')
  assert.ok(fxCore.includes('fxLegWithDefaultRate'), 'دالة السعر الافتراضي مفقودة')
  assert.ok(appStore.includes('fxRates: FxRatesMap') && appStore.includes('setFxRate: (code, ratePpm, updatedBy)') && appStore.includes('applyFxApiQuotes:') && appStore.includes('updateFxRatesSettings:'), 'مخزن أسعار الصرف ناقص')
  assert.ok(settings.includes('data-settings-fx-rates') && settings.includes('<FxRatesManager />'), 'قسم أسعار الصرف مفقود من الإعدادات العامة')
  assert.ok(css.includes('.invoice-doc-fx-today'), 'CSS رقاقة سعر اليوم مفقود')
  ok('المدير: PIN إجباري (set.general) + شرح + erapi/مخصص + المخزن + قسم في الإعدادات')
}

console.log('⑤ لوحة الشروط: مربع أصغر + صفوف أزرار بلا تمرير')
{
  assert.ok(css.includes('.invoice-doc-termsbox { min-height: 3.1rem'), 'مربع الشروط لم يُصغَّر')
  assert.ok(css.includes('.invoice-doc-addons-row { display: grid;'), 'صفوف الأزرار غير معرفة')
  assert.ok(css.includes('.invoice-doc-addons .invoice-doc-addons-row > button {'), 'أزرار الصفوف فقدت تنسيقها (محدد الابن المباشر القديم لا يطابق الأحفاد)')
  assert.ok(sales.includes('data-invoice-addons-expenses') && sales.includes('data-invoice-addons-commissions'), 'الأزرار ليست في صفين معنوين (مصروفات/عمولات)')
  /* مراجعة المالك: إصلاحات ثلاثة تعودت كبوابات */
  for (const page of [sales, purchase]) {
    assert.ok(page.includes("mode!=='advanced'&&fxOn){setFxOn(false)"), 'مغادرة النمط المتقدم لا تطفئ العملة الأجنبية (fxOn يعلق فيعلّق حقل المبلغ)')
  }
  const quick = read('ui/components/QuickPrintSettings.tsx')
  assert.ok(quick.includes("receipt.fontScale ?? 'large'"), 'قائمة حجم الخط تعرض normal للمستخدم القديم بينما المحرك يطبع large (تناقض عرض)')
  ok('مربع الشروط 3.1rem + صفوف الأزرار منسقة + fxOn يُطفأ بمغادرة المتقدم + افتراض الخط متسق')
}

console.log('⑥ فحص حي: مخزن النوافذ + تحويلات الأسعار')
{
  /* مخزن النوافذ: افتح، صغّر، أغلق من الشريط ⇒ استعادة + حوار */
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, get length() { return 0 } }
  globalThis.window = { localStorage: globalThis.localStorage, addEventListener: () => {}, dispatchEvent: () => true, crypto: { randomUUID: () => 'w-' + Math.random().toString(36).slice(2) } }
  const { useWindowStore } = await import('../src/ui/windows/windowStore.ts')
  const ws = useWindowStore.getState()
  const id = ws.openWindow({ kind: 'sales-invoice', title: 'فاتورة اختبار', subtitle: '', props: {} })
  ws.setWindowDirty(id, true)
  ws.minimizeWindow(id)
  assert.equal(useWindowStore.getState().windows.find((w) => w.id === id)?.mode, 'minimized', 'التصغير فشل')
  ws.requestCloseWindow(id)
  const after = useWindowStore.getState().windows.find((w) => w.id === id)
  assert.ok(after, 'النافذة أُغلقت مباشرة رغم وجود تعديلات!')
  assert.equal(after.mode, 'normal', 'النافذة المصغرة لم تُستععد إلى normal عند طلب إغلاقها')
  assert.equal(after.askingClose, true, 'حوار تأكيد الإغلاق لم يُفتح')
  ok('حياً: مصغَّرة + متسخة → طلب إغلاق ⇒ استعادة + askingClose (لا إغلاق صامت)')

  /* تحويلات الأسعار: انقلاب سعر المزود + السعر الافتراضي للساق */
  const { fxLegWithDefaultRate, normalizeFxRatesSettings, parseFxRateInput, fxRateIsFresh } = await import('../src/core/fxRates.ts')
  const leg = fxLegWithDefaultRate({ currencyCode: 'USD', amountMinor: 10000, ratePpm: 0, decimals: 2 }, { USD: { ratePpm: 48_500_000, updatedAt: new Date().toISOString(), updatedBy: 'المالك', source: 'manual' } })
  assert.equal(leg.ratePpm, 48_500_000, 'السعر المحفوظ لم يُستعمل كسعر افتراضي')
  const typed = fxLegWithDefaultRate({ currencyCode: 'USD', amountMinor: 10000, ratePpm: 50_000_000, decimals: 2 }, { USD: { ratePpm: 48_500_000, updatedAt: '', updatedBy: '', source: 'manual' } })
  assert.equal(typed.ratePpm, 50_000_000, 'السعر المكتوب يدوياً دُوس بالسعر المحفوظ!')
  assert.equal(parseFxRateInput('48.5'), 48_500_000, 'تحويل النص إلى ppm خاطئ')
  assert.equal(parseFxRateInput('٤٨٫٥'), 48_500_000, 'الأرقام العربية غير مدعومة في السعر')
  const norm = normalizeFxRatesSettings({ mode: 'api', autoRefreshHours: 999, customUrl: '  https://x.y/rates  ' })
  assert.equal(norm.autoRefreshHours, 168, 'حد ساعات السحب التلقائي غير مقيّد')
  assert.equal(norm.customUrl, 'https://x.y/rates', 'الرابط المخصص لم يُنظّف')
  assert.ok(!fxRateIsFresh(undefined, 1) && !fxRateIsFresh(undefined, 0), 'سجل غائب يجب ألا يكون طازجاً أبداً')
  assert.ok(fxRateIsFresh({ ratePpm: 1, updatedAt: new Date().toISOString(), updatedBy: '', source: 'api' }, 1), 'سجل حديث يجب أن يكون طازجاً')
  assert.ok(!fxRateIsFresh({ ratePpm: 1, updatedAt: new Date(Date.now() - 7_200_000).toISOString(), updatedBy: '', source: 'api' }, 1), 'سعر عمره ساعتان ليس طازجاً لمدة ساعة')
  for (const page of [sales, purchase]) assert.ok(page.includes('fxSettings.mode!==\'api\'||fxSettings.autoRefreshHours<=0') && page.includes('fetchFxRates({provider:fxSettings.apiProvider'), 'السحب التلقائي من API غير موصول عند تفعيل العملة الأجنبية')
  ok('حياً: انقلاب/تعبئة الأسعار والقيود كلها سليمة + السحب التلقائي موصول')
}

console.log(`✅ جولة المالك (العملات والنوافذ والتبويبات): ${pass} فحوص ناجحة`)
