/**
 * فحص الفاتورة الإلكترونية (القرار 30): زاتكا TLV + مستند البوابة المصرية
 * node --experimental-strip-types scripts/verify_einvoice.mjs
 */
import {
  minorToDecimalString, isValidSaVatNumber, isValidEgTaxNumber, isValidZatcaTimestamp,
  validateZatcaFields, tlvBytes, buildZatcaQr, decodeZatcaQr, isValidLocalIsoDateTime,
  bytesToBase64, base64ToBytes,
  validateEgInvoice, buildEgInvoiceDocument,
  validateEgReceiptBarcodeFields, buildEgReceiptBarcodeText,
  DEFAULT_EINVOICE_SETTINGS,
} from '../src/core/einvoice.ts'
import { zatcaQrPolicy, egTaxBarcodePolicy, zatcaLinkPolicy } from '../src/core/invoiceEdit.ts'
import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++ } else { fail++; console.error(`❌ ${name}`) } }
const throws = (fn, name) => { try { fn(); fail++; console.error(`❌ لم يرمِ: ${name}`) } catch { pass++ } }

/* ─── تحويل Minor لنص عشري ─── */
ok(minorToDecimalString(150050, 2) === '1500.50', '150050 ← 1500.50')
ok(minorToDecimalString(0, 2) === '0.00', 'صفر بخانتين')
ok(minorToDecimalString(5, 2) === '0.05', 'خمس هللات')
ok(minorToDecimalString(1234, 3) === '1.234', 'ثلاث خانات (دينار)')
ok(minorToDecimalString(7, 0) === '7', 'عملة بلا كسور')
throws(() => minorToDecimalString(-1, 2), 'مبلغ سالب يرمي')
throws(() => minorToDecimalString(1.5, 2), 'كسور ترمي')

/* ─── التحقق من الأرقام الضريبية ─── */
ok(isValidSaVatNumber('310122393500003'), 'رقم سعودي صالح')
ok(!isValidSaVatNumber('410122393500003'), 'لا يبدأ بـ3')
ok(!isValidSaVatNumber('310122393500004'), 'لا ينتهي بـ3')
ok(!isValidSaVatNumber('31012239350003'), '14 رقماً مرفوض')
ok(!isValidSaVatNumber(''), 'فارغ مرفوض')
ok(isValidEgTaxNumber('123456789'), 'رقم مصري 9 أرقام')
ok(isValidEgTaxNumber('123-456-789'), 'الشرطات تُنظف')
ok(isValidEgTaxNumber('123 456 789'), 'المسافات تُنظف (لصق من فاتورة ورقية)')
ok(isValidSaVatNumber('310 122 393 500 003'), 'رقم سعودي بمسافات يُقبل')
ok(isValidSaVatNumber('310-122-393-500-003'), 'رقم سعودي بشرطات يُقبل')
ok(!isValidEgTaxNumber('12345678'), '8 أرقام مرفوض')
ok(!isValidEgTaxNumber('abc456789'), 'حروف مرفوضة')

/* ─── TLV ─── */
const t1 = tlvBytes(1, 'AB')
ok(t1[0] === 1 && t1[1] === 2 && t1[2] === 65 && t1[3] === 66, 'TLV لاتيني: tag/len/bytes')
const tAr = tlvBytes(1, 'شركة')
ok(tAr[1] === 8, 'العربية UTF-8: 4 حروف = 8 بايت')
throws(() => tlvBytes(1, 'x'.repeat(256)), 'أطول من 255 بايت يرمي')

/* ─── Base64 يدوي (بدون btoa) ─── */
ok(bytesToBase64([77, 97, 110]) === 'TWFu', 'Man ← TWFu')
ok(bytesToBase64([77, 97]) === 'TWE=', 'حشو =')
ok(bytesToBase64([77]) === 'TQ==', 'حشو ==')
ok(JSON.stringify(base64ToBytes('TWFu')) === '[77,97,110]', 'فك TWFu')
ok(JSON.stringify(base64ToBytes('TQ==')) === '[77]', 'فك مع الحشو')

/* ─── رمز زاتكا كامل: بناء ← فك ← تطابق ─── */
const fields = {
  sellerName: 'مؤسسة تَحَكَّم التجارية',
  vatNumber: '310122393500003',
  timestampIso: '2026-09-14T20:30:00Z',
  totalWithVatMinor: 115000,
  vatMinor: 15000,
  decimals: 2,
}
ok(validateZatcaFields(fields).length === 0, 'حقول سليمة بلا أخطاء')
const qr = buildZatcaQr(fields)
ok(qr.length > 0 && /^[A-Za-z0-9+/]+=*$/.test(qr), 'الرمز Base64 صالح')
const decoded = decodeZatcaQr(qr)
ok(decoded.get(1) === 'مؤسسة تَحَكَّم التجارية', 'فك: اسم البائع عربي سليم')
ok(decoded.get(2) === '310122393500003', 'فك: الرقم الضريبي')
ok(decoded.get(3) === '2026-09-14T20:30:00Z', 'فك: الطابع الزمني')
ok(decoded.get(4) === '1150.00', 'فك: الإجمالي بالضريبة')
ok(decoded.get(5) === '150.00', 'فك: قيمة الضريبة')
ok(decoded.size === 5, 'خمسة حقول تماماً')

/* أخطاء زاتكا */
throws(() => buildZatcaQr({ ...fields, vatNumber: '123' }), 'رقم ضريبي غير صالح يرمي')
throws(() => buildZatcaQr({ ...fields, sellerName: ' ' }), 'اسم فارغ يرمي')
throws(() => buildZatcaQr({ ...fields, vatMinor: 200000 }), 'ضريبة أكبر من الإجمالي ترمي')
ok(validateZatcaFields({ ...fields, timestampIso: 'ليس تاريخاً' }).length === 1, 'طابع زمني فاسد يُكشف')
ok(validateZatcaFields({ ...fields, timestampIso: '2026-02-30T00:00:00Z' }).length === 1, 'تاريخ تقويمي مستحيل يُكشف (لا يُطبَّع إلى مارس)')
ok(validateZatcaFields({ ...fields, timestampIso: '2026-09-14T20:30:00' }).length === 1, 'طابع بلا منطقة زمنية يُكشف')
ok(validateZatcaFields({ ...fields, timestampIso: '2026-09-14T20:30:00+03:00' }).length === 0, 'منطقة زمنية صريحة مقبولة')
ok(isValidZatcaTimestamp('2026-09-14T20:30:00.123Z') && !isValidZatcaTimestamp('2026-09-14'), 'فاحص الطابع الزمني مباشرة')
/* أرقام عربية/فارسية: تُطبَّع قبل التحقق والترميز بدل إسقاط الرمز بصمت */
ok(isValidSaVatNumber('٣١٠١٢٢٣٩٣٥٠٠٠٠٣'), 'الرقم السعودي بالأرقام العربية يُقبل')
ok(isValidEgTaxNumber('١٢٣٤٥٦٧٨٩'), 'الرقم المصري بالأرقام العربية يُقبل')
ok(decodeZatcaQr(buildZatcaQr({ ...fields, vatNumber: '٣١٠-١٢٢-٣٩٣-٥٠٠-٠٠٣' })).get(2) === '310122393500003', 'الرقم العربي المنسّق يُرمَّز لاتينياً')
/* ساعة/دقيقة/ثانية صحيحة — Date.parse وحدها تقبل 24:00 وتحوّلها لليوم التالي */
ok(!isValidZatcaTimestamp('2026-09-14T24:00:00Z'), 'الساعة 24 مرفوضة في طابع زاتكا')
ok(!isValidZatcaTimestamp('2026-09-14T20:30:60Z'), 'الثانية 60 مرفوضة')
ok(isValidZatcaTimestamp('2026-09-14T23:59:59Z'), 'آخر لحظة في اليوم مقبولة')
const longName = 'م'.repeat(300)
ok(validateZatcaFields({ ...fields, sellerName: longName }).some((e) => e.includes('255')), 'اسم أطول من 255 بايت ⇒ رسالة عربية قبل RangeError')
throws(() => buildZatcaQr({ ...fields, sellerName: longName }), 'بناء الرمز يرفض الاسم الطويل برسالة مفهومة')
const formattedVat = buildZatcaQr({ ...fields, vatNumber: '310-122-393-500-003' })
ok(decodeZatcaQr(formattedVat).get(2) === '310122393500003', 'الرقم المنسّق يُرمَّز أرقاماً فقط')

/* ─── مستند البوابة المصرية ─── */
const egInput = {
  issuerName: 'محل تَحَكَّم',
  issuerTaxNumber: '123456789',
  issuerAddress: 'شارع الجيش، المنصورة',
  receiverName: 'شركة النور',
  receiverTaxNumber: '987654321',
  invoiceNumber: 'INV-0001',
  dateIso: '2026-09-14T20:30:00Z',
  lines: [
    { nameAr: 'أرز 5 كجم', itemCode: '6221031234567', codeType: 'GS1', qty: 2, unitPriceMinor: 10000, discountMinor: 0, taxMinor: 2800 },
    { nameAr: 'خدمة توصيل', itemCode: 'EG-55', codeType: 'EGS', qty: 1, unitPriceMinor: 5000, discountMinor: 500, taxMinor: 630 },
  ],
  totalDiscountMinor: 500,
  totalTaxMinor: 3430,
  totalMinor: 27930,
  decimals: 2,
}
ok(validateEgInvoice(egInput).length === 0, 'مدخل مصري سليم')
const doc = buildEgInvoiceDocument(egInput)
ok(doc.documentType === 'I' && doc.documentTypeVersion === '1.0', 'نوع المستند وإصداره')
ok(doc.issuer.id === '123456789' && doc.issuer.type === 'B', 'المُصدر ممول B')
ok(doc.receiver.type === 'B' && doc.receiver.id === '987654321', 'المستلم ممول B برقمه')
ok(doc.internalID === 'INV-0001', 'الرقم الداخلي')
ok(doc.invoiceLines.length === 2, 'سطران')
ok(doc.invoiceLines[0].itemType === 'GS1' && doc.invoiceLines[0].itemCode === '6221031234567', 'كود GS1')
ok(doc.invoiceLines[1].itemType === 'EGS', 'كود EGS للخدمة')
ok(doc.invoiceLines[0].salesTotal === 200 && doc.invoiceLines[0].netTotal === 200, 'إجماليات السطر الأول')
ok(doc.invoiceLines[0].taxableItems[0].taxType === 'T1' && doc.invoiceLines[0].taxableItems[0].amount === 28, 'ضريبة T1 للسطر')
ok(doc.invoiceLines[1].netTotal === 45 && doc.invoiceLines[1].total === 51.3, 'سطر الخدمة بخصمه وضريبته')
ok(doc.totalAmount === 279.3, 'الإجمالي النهائي')
ok(doc.netAmount === 245, 'الصافي قبل الضريبة')
ok(doc.taxTotals[0].amount === 34.3, 'إجمالي الضرائب')
const docFormatted = buildEgInvoiceDocument({ ...egInput, issuerTaxNumber: '123-456-789', receiverTaxNumber: '987 654 321' })
ok(docFormatted.issuer.id === '123456789' && docFormatted.receiver.id === '987654321', 'مستند ETA يطبّع أرقام الضرائب (بلا شرطات/مسافات)')

/* مستهلك نهائي B2C */
const b2c = buildEgInvoiceDocument({ ...egInput, receiverTaxNumber: '', receiverName: '' })
ok(b2c.receiver.type === 'P' && b2c.receiver.name === 'مستهلك نهائي', 'مستهلك نهائي P')

/* أخطاء مصر */
throws(() => buildEgInvoiceDocument({ ...egInput, issuerTaxNumber: '12' }), 'رقم مُصدر قصير يرمي')
throws(() => buildEgInvoiceDocument({ ...egInput, lines: [] }), 'بلا بنود يرمي')
throws(() => buildEgInvoiceDocument({ ...egInput, lines: [{ ...egInput.lines[0], itemCode: '' }] }), 'بند بلا كود يرمي')
ok(validateEgInvoice({ ...egInput, receiverTaxNumber: 'abc' }).length === 1, 'رقم مستلم فاسد يُكشف')

/* ─── مصر: رمز التحقق المحلي على الإيصال (بلاغ المالك: الباركود الضريبي
   لا يظهر أبداً في مصر — المفتاح لا يعيش إلا داخل قسم الفاتورة الإلكترونية) ─── */
const egBarcodeFields = {
  sellerName: 'محل تَحَكَّم', taxNumber: '123456789', invoiceNumber: 'INV-0042',
  dateIso: '2026-10-20T12:00:00Z', totalMinor: 115000, decimals: 2,
}
ok(validateEgReceiptBarcodeFields(egBarcodeFields).length === 0, 'حقول رمز مصر سليمة')
const egText = buildEgReceiptBarcodeText(egBarcodeFields)
ok(egText === 'EGTAX1|123456789|INV-0042|2026-10-20T12:00:00|1150.00', 'نص رمز التحقق المصري بالصيغة الصحيحة')
throws(() => buildEgReceiptBarcodeText({ ...egBarcodeFields, taxNumber: '123' }), 'رقم ضريبي مصري قصير يرمي')
throws(() => buildEgReceiptBarcodeText({ ...egBarcodeFields, invoiceNumber: '' }), 'رقم فاتورة فارغ يرمي')
/* باركود مصر: الفاصل «|» يفكك البنية، والتاريخ المستحيل يُرفض */
throws(() => buildEgReceiptBarcodeText({ ...egBarcodeFields, invoiceNumber: 'INV|42' }), 'فاصل | في رقم فاتورة مصر يرمي')
ok(validateEgReceiptBarcodeFields({ ...egBarcodeFields, invoiceNumber: 'INV|42' }).length === 1, 'فاصل | يُكشف برسالة')
ok(validateEgReceiptBarcodeFields({ ...egBarcodeFields, dateIso: '2026-02-30T10:00:00' }).length === 1, 'تاريخ مصري مستحيل يُكشف')
ok(validateEgReceiptBarcodeFields({ ...egBarcodeFields, sellerName: ' ' }).length === 1, 'اسم بائع فارغ يُكشف')

/* سياسة باركود مصر: ميزة + مفتاح طباعة فقط — بلا اشتراط اتصال */
ok(egTaxBarcodePolicy({ featureActive: true, printEnabled: true }).printQr === true, 'مصر: كل الشروط ⇒ يُطبع')
ok(egTaxBarcodePolicy({ featureActive: false, printEnabled: true }).printQr === false, 'مصر: ميزة موقوفة ⇒ لا رمز')
ok(egTaxBarcodePolicy({ featureActive: true, printEnabled: false }).printQr === false, 'مصر: خيار الطباعة موقوف ⇒ لا رمز')

/* سياسة زاتكا (قرار المالك 2026-10-22): رمز المرحلة الأولى (Generation)
   يُولَّد محلياً ولا يشترط اتصالاً. الاتصال شرط للربط/الإرسال (المرحلة
   الثانية) وحدهما — فصلُهما هنا يمنع عودة منع الرمز عند انقطاع الشبكة. */
ok(zatcaQrPolicy({ featureActive: true, printEnabled: true }).printQr === true, 'السعودية: الرمز يُطبع بلا شرط اتصال')
ok(zatcaQrPolicy({ featureActive: false, printEnabled: true }).printQr === false, 'السعودية: ميزة موقوفة ⇒ لا رمز')
ok(zatcaQrPolicy({ featureActive: true, printEnabled: false }).printQr === false, 'السعودية: مفتاح الطباعة موقوف ⇒ لا رمز')
ok(zatcaLinkPolicy({ featureActive: true, online: false }).canLink === false, 'الربط/الإرسال بلا إنترنت ⇒ ممنوع (مرحلة ثانية)')
ok(String(zatcaLinkPolicy({ featureActive: true, online: false }).reasonAr).includes('بلا اتصال'), 'سبب منع الربط يوضح أن الطباعة المحلية لا تتأثر')
ok(zatcaLinkPolicy({ featureActive: true, online: true }).canLink === true, 'الربط/الإرسال مع إنترنت ⇒ متاح')

/* ─── ربط الرمز بكل مسارات طباعة فاتورة المبيعات ───
   بلاغ المالك 2026-10-22: فاتورة لعميل نقدي بلا باركود رغم تفعيل زاتكا.
   السبب: محرر «فاتورة مبيعات جديدة» كان يبني نموذج الطباعة بلا رمز إطلاقاً —
   الكاشير وقائمة الفواتير فقط هما من يطلبان الرمز. هذه البوابة تمنع رجوع العيب. */
const readSource = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
for (const [label, path, token] of [
  ['الكاشير', '../src/ui/pages/PosPage.tsx', 'maybeTaxBarcode'],
  ['قائمة فواتير المبيعات', '../src/ui/pages/SalesInvoicesPage.tsx', 'maybeTaxBarcode'],
  ['محرر فاتورة المبيعات', '../src/ui/pages/AdvancedSalesInvoicePage.tsx', 'stampTax('],
  /* مستندات المبيعات الأخرى — كلها كانت تطبع بلا رمز قبل 2026-10-22 */
  ['مرتجع مبيعات (إشعار دائن)', '../src/ui/pages/SaleReturnsPage.tsx', 'stampTax('],
  ['مراكز فواتير الأنشطة الخدمية', '../src/ui/pages/ActivityInvoicesHubs.tsx', 'stampTax('],
  ['فواتير المقاولات', '../src/ui/pages/ContractingInvoicesPage.tsx', 'stampTax('],
  ['فواتير الإيجار الدورية', '../src/ui/pages/RentalContractsPage.tsx', 'stampTax('],
  ['فواتير النقل', '../src/ui/pages/TripsPage.tsx', 'stampTax('],
  ['إيصال عميل المطعم', '../src/ui/pages/RestaurantOrdersPage.tsx', 'stampTax('],
  ['معاينة إعدادات الطباعة', '../src/ui/pages/PrintSettingsPage.tsx', 'stampTax('],
]) {
  const source = readSource(path)
  ok(source.includes(token), `${label}: مسار الطباعة يطلب الرمز الضريبي (${token})`)
}
const advSalesSrc = readSource('../src/ui/pages/AdvancedSalesInvoicePage.tsx')
ok(advSalesSrc.includes('useTaxBarcodeStamp'), 'محرر فاتورة المبيعات: يستخدم خطاف الختم الموحد')
ok(/buildModelHtml\(buildPrintModel\(totals,qrDataUrl/.test(advSalesSrc), 'محرر الفاتورة: المعاينة الحية تعيد بناء النموذج مع رمز QR نفسه')
ok(advSalesSrc.includes('editingInvoice?{invoiceNumber:editingInvoice.invoiceNumber'), 'محرر الفاتورة: معاينة فاتورة قائمة تستخدم رقمها وتاريخها لا «مسودة» (طابع زاتكا صحيح)')
/* إعادة طباعة فاتورة شاملة الضريبة كانت تعرض «(مضافة)» رغم أن الإجماليات مشمولة */
ok(/taxInclusive:editingInvoice\?\.taxInclusive\?\?false/.test(advSalesSrc), 'محرر الفاتورة: نمط الضريبة (مضافة/مشمولة) يتبع الفاتورة المعدّلة')
/* إشعار الدائن: نسبة الضريبة من الفاتورة الأصلية لا من إعدادات اليوم — وإلا
   طُبع سطر ضريبة بنسبة مخالفة للإشعار ولو كانت الإجماليات صحيحة */
ok(readSource('../src/ui/pages/SaleReturnsPage.tsx').includes('deriveTaxConfig(r.totals, r.lines).taxPercent'), 'إشعار الدائن: فاتورة قديمة بلا نسبة ⇒ استنتاج من إجماليات المرتجع')
/* إعادة طباعة فاتورة قديمة/مستوردة بلا taxPercent مخزّن: النسبة تُستنتج من
   إجمالياتها لا من إعدادات اليوم (وإلا طُبع سطر ضريبة بنسبة تخالف المستند) */
ok(readSource('../src/ui/pages/SalesInvoicesPage.tsx').includes('deriveTaxConfig(s.totals, s.lines)'), 'قائمة المبيعات: نسبة الفاتورة القديمة تُستنتج من إجمالياتها')
ok(readSource('../src/ui/pages/ActivityInvoicesHubs.tsx').includes('deriveTaxConfig(s.totals, s.lines)'), 'مراكز الأنشطة: نفس الاستنتاج')
ok(readSource('../src/ui/pages/ContractingInvoicesPage.tsx').includes('deriveTaxConfig(s.totals, s.lines)'), 'فواتير المقاولات: نفس الاستنتاج')
ok(readSource('../src/ui/hooks/useTaxBarcodeStamp.ts').includes('einvoice.enabled === true'), 'خطاف الختم يربط الرمز بتشغيل الإصدار الإلكتروني — لا يُطبع بلا تشغيل')
/* منع عودة شرط الاتصال إلى مسار الطباعة: المولّد لا يقرأ الشبكة، والشاشة تفصل الربط عنه */
ok(!readSource('../src/ui/print/taxBarcode.ts').includes('navigator.onLine'), 'مولّد الرمز لا يقرأ حالة الشبكة — الطباعة محلية')
ok(!readSource('../src/ui/print/taxBarcode.ts').includes('online'), 'بيانات توليد الرمز خالية من أي شرط اتصال')
ok(readSource('../src/ui/pages/EinvoicePage.tsx').includes('zatcaLinkPolicy'), 'شاشة الفاتورة الإلكترونية تفصل سياسة الربط عن طباعة الرمز')

/* ─── الإعدادات الافتراضية ─── */
ok(DEFAULT_EINVOICE_SETTINGS.taxNumber === '' && DEFAULT_EINVOICE_SETTINGS.printZatcaQr === true, 'الافتراضيات سليمة')

console.log(`PASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
console.log(`🎉 نجح فحص الفاتورة الإلكترونية — ${pass} اختباراً`)
