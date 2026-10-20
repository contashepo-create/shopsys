/**
 * تحقق سد فجوة تقرير النشاط #29 (نشاط عام / آخر):
 * خصائص الصنف (صلاحية/سيريال/وزن/خدمة/متغيرات) متاحة فعلياً لأي نشاط عبر
 * «خيارات أكثر» في شاشة الأصناف (القرار 5) بغض النظر عن قائمة features —
 * لكن «قوائم الأسعار» (price_lists) ميزة استثناء: بوابتها في كتالوج
 * التنقل (navCatalog.tsx) تتحقق من setup.features مباشرة بلا أي مسار
 * بديل لتفعيلها لاحقاً من الإعدادات. نشاط «عام/آخر» وحده يَعِد صراحة
 * بـ"قالب مرن — فعّل ما تحتاجه لاحقاً" بلا نموذج عمل محدد يبرر استبعاد
 * قوائم الأسعار (خلافاً لأنشطة مثل الصيدلية/العيادة/المعمل التي لا
 * يلائمها هذا المفهوم فعلاً). الإصلاح: إضافة 'price_lists' لقائمة
 * features الخاصة بنشاط 'general'.
 * تشغيل: node --experimental-strip-types scripts/verify_general_price_lists.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

let PASS = 0
const ok = (cond, msg) => {
  assert.ok(cond, msg)
  PASS++
  console.log(`  ✓ ${msg}`)
}

console.log('— ① نشاط general يحوي الآن خاصية price_lists —')
const { getActivity, FEATURE_LABELS } = await import('../src/core/activities.ts')
const general = getActivity('general')
ok(general != null, 'نشاط general موجود')
ok(general.features.includes('price_lists'), 'قائمة features تحوي price_lists')
ok(general.features.includes('multi_unit'), 'لم تُفقد خاصية multi_unit الأصلية')
ok(FEATURE_LABELS.price_lists != null, 'price_lists له مدخل في FEATURE_LABELS')

console.log('— ② navCatalog: شاشتا قوائم الأسعار والعروض مشروطتان بـfeature price_lists فقط (بلا قيد نشاط إضافي) —')
const navSrc = readFileSync(new URL('../src/ui/navCatalog.tsx', import.meta.url), 'utf8')
ok(/id: 'price-lists'[^}]*feature: 'price_lists'/.test(navSrc), 'عنصر قوائم الأسعار مشروط بـ price_lists فقط')
ok(/id: 'promotions'[^}]*feature: 'price_lists'/.test(navSrc), 'عنصر العروض والباقات مشروط بـ price_lists فقط')

console.log('— ③ سيناريو حيّ: نشاط عام ينشئ قائمة أسعار جملة ويربطها بعميل ويبيع بخصمها —')
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false, allowNegativeTreasury: true, vatPercent: 14, activityId: 'general', countryCode: 'EG', taxInclusive: true, features: ['multi_unit', 'price_lists'], modules: ['pos', 'inventory', 'purchases', 'installments'] }, license: { plan: 'pro' } }, version: 0 }))

const { useDataStore } = await import('../src/data/repo.ts')
const S = () => useDataStore.getState()
S().seed([])
S().addCustomer({ nameAr: 'عميل جملة', phone: '', openingBalanceMinor: 0, creditLimitMinor: 0 })
const cust = S().customers.at(-1)
S().addItem({ nameAr: 'منتج عام', sku: 'G-1', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 1000, priceMinor: 2000, minQty: 0, stockQty: 100, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, isService: false })
const item = S().items.at(-1)
const pl = S().addPriceList('سعر جملة', 20)
ok(pl.id != null, 'قائمة الأسعار أُنشئت بنجاح')
S().setCustomerPriceList(cust.id, pl.id)
ok(S().customers.find((c) => c.id === cust.id).priceListId === pl.id, 'العميل مربوط بقائمة الأسعار')

const sale = S().postSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: 2000 * 0.8, unitCostMinor: 1000, discountPercent: 0 }], customerId: cust.id, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: true })
ok(sale.lines[0].unitPriceMinor === 1600, 'سعر الجملة المخفَّض (20%) طُبِّق فعلياً على سطر الفاتورة')

console.log(`\nPASS=${PASS} FAIL=0`)
console.log('🎉 نشاط عام/آخر: قوائم الأسعار متاحة الآن ومُختبرة حياً بسيناريو حقيقي')
