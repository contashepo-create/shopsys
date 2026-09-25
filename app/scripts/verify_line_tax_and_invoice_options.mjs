#!/usr/bin/env node
/**
 * فحص دائم — طلب المالك:
 * 1) ضريبة القيمة المضافة تظهر بجانب كل بند تلقائياً حسب بلد المنشأة/استثناء الصنف.
 * 2) تاريخ الصلاحية لا يظهر افتراضياً في فاتورة الشراء؛ يظهر فقط من زر «خيارات أكثر» ومربع checkbox.
 * 3) ضريبة مدخلات الشراء تُحفظ على مستوى سطور الفاتورة ولا تعتمد على حقل عام يدوي.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

let pass = 0
function ok(cond, msg) { assert.ok(cond, msg); pass++; console.log(`  ✓ ${msg}`) }

console.log('\n═══ ضريبة السطور وخيارات حقول الفاتورة ═══')
const pos = read('src/ui/pages/PosPage.tsx')
const pur = read('src/ui/pages/PurchasesPage.tsx')
const sales = read('src/ui/pages/SalesInvoicesPage.tsx')
const receipt = read('src/core/receipt.ts')
const repo = read('src/data/repo.ts')
const printA4 = read('src/ui/print/printInvoiceA4.ts')
const printThermal = read('src/ui/print/printReceipt.ts')

ok(pos.includes('countryVatPercent = country?.vatPercent ?? setup.vatPercent'), 'الكاشير يأخذ نسبة الضريبة من البلد لا من إدخال عام فقط')
ok(pos.includes('vatPercentOverride: itemVatPercent'), 'كل سطر كاشير يحصل على نسبته الفعلية عند الإضافة')
ok(pos.includes('النسبة تظهر بجانب كل بند') && pos.includes('ضريبة السطر'), 'واجهة الكاشير تعرض الضريبة بجانب كل بند لا كحقل عام فقط')

ok(pur.includes('countryVatPercent = country?.vatPercent ?? setup.vatPercent'), 'فاتورة الشراء تأخذ نسبة الضريبة من بلد المنشأة')
ok(pur.includes('makeDraftLine') && pur.includes('vatPercent: itemVatPercent(itemId)'), 'سطر الشراء الجديد يحمل نسبة ضريبته تلقائياً')
ok(pur.includes('inputVatMinor = useMemo') && pur.includes('lineVatMinor(l)'), 'إجمالي ضريبة المدخلات يُحسب من السطور')
ok(!pur.includes('value={inputVat}') && !pur.includes('setInputVat'), 'لا يوجد حقل ضريبة عام يدوي في فاتورة الشراء')
ok(pur.includes('خيارات أكثر') && pur.includes('lineOptions.expiry') && pur.includes('type="checkbox"'), 'الصلاحية خلف زر خيارات أكثر ومربع checkbox')
ok(pur.includes('{lineOptions.expiry && (lineItem?.trackExpiry') && pur.includes('تاريخ الصلاحية لكل سطر'), 'حقل الصلاحية لا يظهر افتراضياً بجانب السطور')

ok(repo.includes('vatPercent?: number') && repo.includes('inputVatMinor?: number'), 'طبقة البيانات تحفظ نسبة/قيمة ضريبة كل سطر شراء')
ok(repo.includes('linesInputVatMinor') && repo.includes('vatPercent: inv.lines[i]?.vatPercent'), 'ترحيل الشراء يحسب ويحفظ ضريبة السطور')

ok(receipt.includes('vatPercent: number | null') && receipt.includes('ض.ق.م من السطور'), 'نموذج الطباعة يدعم ضريبة كل سطر')
ok(printThermal.includes('ض. ${r.vatPercent') && printA4.includes('<th>الضريبة</th>'), 'الطباعة الحرارية وA4 تعرضان ضريبة البند')
ok(sales.includes('s.taxPercent ?? countryVatPercent') && sales.includes('vatPercentOverride ?? viewing.taxPercent'), 'عرض/طباعة فواتير البيع يستخدم ضريبة السطر والبلد')

console.log(`\n✅ فحص ضريبة السطور وخيارات الفاتورة: ${pass} محطات — كلها خضراء\n`)
