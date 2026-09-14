/**
 * فحص الفاتورة الإلكترونية (القرار 30): زاتكا TLV + مستند البوابة المصرية
 * node --experimental-strip-types scripts/verify_einvoice.mjs
 */
import {
  minorToDecimalString, isValidSaVatNumber, isValidEgTaxNumber,
  validateZatcaFields, tlvBytes, buildZatcaQr, decodeZatcaQr,
  bytesToBase64, base64ToBytes,
  validateEgInvoice, buildEgInvoiceDocument,
  DEFAULT_EINVOICE_SETTINGS,
} from '../src/core/einvoice.ts'

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
  sellerName: 'مؤسسة حسبان التجارية',
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
ok(decoded.get(1) === 'مؤسسة حسبان التجارية', 'فك: اسم البائع عربي سليم')
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

/* ─── مستند البوابة المصرية ─── */
const egInput = {
  issuerName: 'محل حسبان',
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

/* مستهلك نهائي B2C */
const b2c = buildEgInvoiceDocument({ ...egInput, receiverTaxNumber: '', receiverName: '' })
ok(b2c.receiver.type === 'P' && b2c.receiver.name === 'مستهلك نهائي', 'مستهلك نهائي P')

/* أخطاء مصر */
throws(() => buildEgInvoiceDocument({ ...egInput, issuerTaxNumber: '12' }), 'رقم مُصدر قصير يرمي')
throws(() => buildEgInvoiceDocument({ ...egInput, lines: [] }), 'بلا بنود يرمي')
throws(() => buildEgInvoiceDocument({ ...egInput, lines: [{ ...egInput.lines[0], itemCode: '' }] }), 'بند بلا كود يرمي')
ok(validateEgInvoice({ ...egInput, receiverTaxNumber: 'abc' }).length === 1, 'رقم مستلم فاسد يُكشف')

/* ─── الإعدادات الافتراضية ─── */
ok(DEFAULT_EINVOICE_SETTINGS.taxNumber === '' && DEFAULT_EINVOICE_SETTINGS.printZatcaQr === true, 'الافتراضيات سليمة')

console.log(`PASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
console.log(`🎉 نجح فحص الفاتورة الإلكترونية — ${pass} اختباراً`)
