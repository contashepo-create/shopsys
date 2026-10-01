/**
 * بوابة جولة المالك 2026-10-01 — التفضيلات لكل مستخدم + نافذة إعدادات الطباعة + حد ائتمان صفر.
 *
 * ① تفضيلات مستقلة تماماً لكل مستخدم (نمط فاتورة بيع/شراء + قالب الطباعة المفضل)
 *    تُخزن بمفتاح المستخدم، وتُختبر حيةً بمستخدمَين مختلفَين.
 * ② زر «⚙ إعدادات الطباعة» داخل نافذة الفاتورة يفتح لوحة منبثقة مشتركة،
 *    وزر «المزيد» يقود إلى /settings/printing.
 * ③ المعاينة الحرارية تستعمل نفس اللوحة المشتركة (لا ازدواج كود).
 * ④ حد ائتمان صفر = بلا حد أدنى للتحصيل (فحص التفضيلات الحي يعتمد هذا).
 *
 * تشغيل: node --experimental-strip-types scripts/verify_owner_prefs_credit_font.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(__dirname, '..', 'src', p), 'utf8')
let pass = 0; const ok = (n) => { pass++; console.log('  ✓', n) }

const prefs = read('core/userPreferences.ts')
const repo = read('data/repo.ts')
const profile = read('ui/pages/ProfilePage.tsx')
const sales = read('ui/pages/AdvancedSalesInvoicePage.tsx')
const purchase = read('ui/pages/AdvancedPurchaseInvoicePage.tsx')
const frame = read('ui/components/InvoicePOSFrame.tsx')
const popup = read('ui/components/PrintSettingsPopup.tsx')
const quick = read('ui/components/QuickPrintSettings.tsx')
const thermal = read('ui/components/ThermalPreview.tsx')

console.log('① التفضيلات لكل مستخدم — فصل صارم')
{
  assert.ok(/salesInvoiceMode\?|salesInvoiceMode:/i.test(prefs) && /purchaseInvoiceMode/.test(prefs) && /preferredPrintTemplate\?:\s*'thermal'\s*\|\s*'a4'/.test(prefs),
    'نوع التفضيلات ناقص (نمط بيع/شراء/قالب طباعة)')
  assert.ok(/export const userPrefsKey = \(currentUserId[^)]*\): string =>/.test(prefs), 'دالة مفتاح التفضيلات مفقودة')
  assert.ok(/String\(currentUserId \?\? 'owner'\)/.test(prefs), 'المفتاح ليس هوية المستخدم الحالي')
  assert.ok(/userPrefs: Record<string, UserPreferences>/.test(repo) && /updateMyPreferences: \(patch: Partial<UserPreferences>\) => void/.test(repo),
    'حالة التفضيلات أو الدالة مفقودة من المخزن')
  assert.ok(/const key = userPrefsKey\(get\(\)\.currentUserId\)/.test(repo) && /\[key\]: \{ \.\.\.get\(\)\.userPrefs\[key\], \.\.\.patch \}/.test(repo),
    'التحديث لا يُخزن بمفتاح المستخدم الحالي (دمج عام يكسر الفصل)')
  assert.ok(/data-pref-sales-mode/.test(profile) && /data-pref-purchase-mode/.test(profile) && /data-pref-print-template/.test(profile) && /data-user-preferences/.test(profile),
    'صفحة الملف الشخصي بلا قسم تفضيلات العمل الثلاثة')
  ok('النوع + المفتاح لكل مستخدم + الدمج بالمفتاح + قسم «تفضيلات عملي»')
}

console.log('② الفاتورة تتبع تفضيلات صاحبها + نافذة إعدادات الطباعة المنبثقة')
{
  for (const [page, field] of [[sales, 'salesInvoiceMode'], [purchase, 'purchaseInvoiceMode']]) {
    assert.ok(new RegExp(`myPrefs\\.${field} ?? '`).test(page) || new RegExp(`myPrefs\\.${field}\\?\\?'`).test(page),
      `${page.includes('Sales') ? 'البيع' : 'الشراء'} لا يبدأ بالنمط المفضل للمستخدم`)
    assert.ok(new RegExp(`\\(useDataStore\\.getState\\(\\)\\.userPrefs\\[String\\(currentUserId\\?\\?'owner'\\)\\]\\?\\.preferredPrintTemplate\\)\\?\\?\\(printSwitches\\.cashierPrint\\?'thermal':'a4'\\)`).test(page),
      `${page.includes('Sales') ? 'البيع' : 'الشراء'}: الطباعة السريعة لا تقدّم قالب المستخدم المفضل`)
    assert.ok(/printSettingsOpen/.test(page) && /<PrintSettingsPopup/.test(page) && /onOpenPrintSettings/.test(page),
      `${page.includes('Sales') ? 'البيع' : 'الشراء'} بلا نافذة إعدادات الطباعة المنبثقة`)
  }
  assert.ok(/data-print-settings-button/.test(frame) && /onOpenPrintSettings\?/.test(frame), 'شريط الفاتورة بلا زر «⚙ إعدادات الطباعة»')
  assert.ok(/data-print-settings-popup/.test(popup), 'النافذة المنبثقة بلا غلاف موسوم')
  assert.ok(/data-print-settings-more/.test(popup) && /\/settings\/printing/.test(popup), 'زر «المزيد من إعدادات الطباعة» لا يقود إلى صفحة الطباعة')
  assert.ok(/<QuickPrintSettings/.test(popup), 'النافذة لا تعرض اللوحة المشتركة')
  ok('البيع والشراء: النمط المفضل + القالب المفضل أولاً + ⚙ المنبثقة + «المزيد…» → /settings/printing')
}

console.log('③ لوحة واحدة مشتركة + حجم الخط')
{
  assert.ok(/data-quick-paper/.test(quick) && /data-quick-accent/.test(quick) && /data-quick-fontscale/.test(quick) && /wide\?:\s*boolean/.test(quick),
    'اللوحة المشتركة ناقصة (حقول quick-* أو wide أو حجم الخط)')
  assert.ok(/<QuickPrintSettings wide=\{wide\} \/>/.test(thermal), 'المعاينة الحرارية لا تستعمل اللوحة المشتركة')
  assert.ok(!/data-quick-paper/.test(thermal), 'المعاينة ما زالت تحمل نسخة مكررة من الحقول')
  ok('QuickPrintSettings مشتركة بين النافذة والمعاينة + محدد حجم الخط (data-quick-fontscale)')
}

console.log('④ فحص حي: فصل تفضيلات مستخدمَين + حد ائتمان صفر')
{
  const mem = new Map()
  globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k), clear: () => mem.clear(), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size } }
  globalThis.window = { localStorage: globalThis.localStorage, addEventListener: () => {}, dispatchEvent: () => true }
  mem.set('shopsys-app', JSON.stringify({ state: { setup: { done: true, countryCode: 'EG', activityId: 'retail', vatPercent: 14, taxInclusive: true }, license: { plan: 'pro' } }, version: 0 }))
  const { useDataStore } = await import('../src/data/repo.ts')
  const st = () => useDataStore.getState()

  // المالك (بلا حساب دخول) يفضّل الفاتورة المتقدمة والقالب الحراري
  st().updateMyPreferences({ salesInvoiceMode: 'advanced', preferredPrintTemplate: 'thermal' })
  assert.equal(st().userPrefs['owner'].salesInvoiceMode, 'advanced')
  assert.equal(st().userPrefs['owner'].preferredPrintTemplate, 'thermal')

  // مستخدم دخول آخر: تفضيلاته منفصلة تماماً ولا يرث شيئاً من المالك
  const { hashPin } = await import('../src/core/audit.ts')
  st().setOwnerPin(await hashPin('135790'))
  const user2 = st().addAppUser({ nameAr: 'كاشير الفرع', roleId: 'cashier', pinHash: await hashPin('246810'), active: true })
  await st().login(user2.id, '246810')
  st().updateMyPreferences({ salesInvoiceMode: 'profit', purchaseInvoiceMode: 'standard', preferredPrintTemplate: 'a4' })
  assert.equal(st().userPrefs[String(user2.id)].salesInvoiceMode, 'profit')
  assert.equal(st().userPrefs[String(user2.id)].preferredPrintTemplate, 'a4')
  assert.equal(st().userPrefs['owner'].salesInvoiceMode, 'advanced', 'تسريب: تفضيل المالك تغيّر بفعل مستخدم آخر!')
  assert.equal(st().userPrefs[String(user2.id)].purchaseInvoiceMode, 'standard')
  assert.ok(!('purchaseInvoiceMode' in (st().userPrefs['owner'] ?? {})), 'تسريب: تفضيل شراء المستخدم الثاني ظهر عند المالك!')
  // الرجوع للمالك يعيد تفضيلاته كما هي
  await st().login(null, '135790')
  st().updateMyPreferences({ purchaseInvoiceMode: 'simple' })
  assert.equal(st().userPrefs['owner'].salesInvoiceMode, 'advanced')
  assert.equal(st().userPrefs['owner'].purchaseInvoiceMode, 'simple')
  ok('حياً: المالك (advanced/thermal) والمستخدم الثاني (profit/a4) لا يتقاطعان — والعودة للمالك تحفظ تفضيله')

  // حد ائتمان صفر = بلا حد: فاتورة 10,000 لعميل بلا حد بلا أي نقطة تحصيل تُقبل
  st().addCustomer({ nameAr: 'عميل بلا حد', phone: '01000000000', creditLimitMinor: 0, notes: '' })
  st().addItem({ nameAr: 'خدمة صيانة', categoryId: null, unit: 'زيارة', priceMinor: 1000000, barcode: 'SRV-1', sku: '', isActive: true, trackExpiry: false, trackSerial: false, soldByWeight: false, isService: true, minSalePriceMinor: 0, costMinor: 0, stockQty: 0 })
  const srv = st().items[0]
  const sale = st().postSale({ lines: [{ itemId: srv.id, nameAr: srv.nameAr, qty: 10, unitPriceMinor: 1000000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], customerId: st().customers[0].id, payment: 'cash', treasury: '1101', paidMinor: 0, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true })
  assert.equal(sale.paidMinor, 0)
  const credit = sale.totals.totalMinor - sale.paidMinor
  assert.equal(credit, 10000000, 'كل الفاتورة 10,000 آجلة')
  ok(`حياً: عميل حدّه صفر — فاتورة 10,000 آجلة بالكامل بلا نقطة تحصيل واحدة (${sale.invoiceNumber})`)
}

console.log(`✅ جولة المالك — التفضيلات والطباعة والحد الصفري: ${pass} فحوص ناجحة`)
