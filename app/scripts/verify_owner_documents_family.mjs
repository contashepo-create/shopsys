/**
 * بوابة مراجعة §84 — «نواة المستندات: العائلة الكاملة» (جولة المالك الخامسة على مصفوفة §70-هـ)
 * ─────────────────────────────────────────────────────────────────────────────
 * بوابة §76 (verify_owner_documents_core_review) غطت الستة الأصلية بعمق
 * (totals/tax/charges/settlement/lifecycle/commercial — آلاف الحالات العشوائية)؛
 * هذه الجولة تكمل النطاق إلى العائلة الكاملة (13 ملفاً):
 *
 * ① العنوان التجاري: الحقول والصيغ وهاتف بمسافات ورقم ضريبي.
 * ② قواعد اعتماد المستندات: القاعدة الأشد تطبيقاً، والمنشئ لا يعتمد مستنده.
 * ③ المرفقات: الأنواع/الحجم/SHA-256/مسار آمن ضد اجتياز الدليل.
 * ④ لقطة العملة: BigInt بلا float، تقريب الحدود، رفض اللقطات الفاسدة.
 * ⑤ ترقيم المستندات: التسلسل والنفاد والسنة المالية.
 * ⑥ مراجع المستندات: العكس/الاستبدال يتطلبان سبباً، ولا إشارة للنفس/تكرار.
 * ⑦ حارس الضريبة: غير المسجل لا يعرض ضريبة، والمسجل يعرض رقمه.
 * ⑧ سيناريو الترابط الكامل: **مستند واحد يُبنى من النواة الخالصة وحدها** —
 *    سطورها تُلخص ضريبياً (summarizeTaxes)، رسومها تُوزَّع بالقروش على السطور
 *    (allocateChargeByLineBase)، إجمالياتها تُحسب (documentNetAfterCharges →
 *    calculateDocumentTotals)، تسوياتها تصنف حالتها (settlementSummary)،
 *    رقمها يُحجز (reserveDocumentNumber)، بياناتها المشتركة تُتحقق
 *    (validateCommercialDocumentMeta)، وتُدار دورتها (transitionDocument) —
 *    وكل شيء بلا مستدعٍ حي: النواة معدّة لتكون مصدر الحقيقة في SQLite القادم
 *    فتُختبر هنا كوحدة واحدة مترابطة لأول مرة.
 * ⑨ ختام: عيب §84 المكتشف (documentNetAfterCharges سالب بصمت) مؤمَّن + المصدرية.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_owner_documents_family.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { validateDocumentAddress, sameDocumentAddress } from '../src/core/documentAddress.ts'
import { validateApprovalRules, requiredApprovalRule, approvalSatisfied } from '../src/core/documentApproval.ts'
import { validateDocumentAttachment, DOCUMENT_ATTACHMENT_LIMIT_BYTES } from '../src/core/documentAttachments.ts'
import { foreignMinorToLocalMinor, validateCurrencySnapshot } from '../src/core/documentCurrency.ts'
import { reserveDocumentNumber, validateDocumentNumberSequence } from '../src/core/documentNumbering.ts'
import { validateDocumentReferences, findOriginalReference } from '../src/core/documentReferences.ts'
import { guardTaxDocument } from '../src/core/taxDocumentGuard.ts'
import { documentNetAfterCharges, allocateChargeByLineBase } from '../src/core/documentCharges.ts'
import { calculateDocumentTotals } from '../src/core/documentTotals.ts'
import { calculateTaxMinor, summarizeTaxes } from '../src/core/documentTax.ts'
import { settlementSummary, validateSettlements } from '../src/core/documentSettlement.ts'
import { transitionDocument, isDocumentEditable, isDocumentTerminal, isValidIdempotencyKey } from '../src/core/documentLifecycle.ts'
import { validateCommercialDocumentMeta } from '../src/core/commercialDocument.ts'

const here = fileURLToPath(new URL('.', import.meta.url))
const R = { n: 0, ok(msg) { this.n++; console.log('  ✓', msg) } }
const ADDR = { nameAr: 'شركة النور للتجارة', countryCode: 'EG', city: 'المنصورة', district: 'الممشى', street: 'جمصة', buildingNumber: '12', postalCode: '35111', additionalNumber: '3456', phone: '+20 100 123 4567', taxNumber: '123-456-789' }

// ——— ① العنوان التجاري ———
console.log('① العنوان التجاري')
{
  assert.deepEqual(validateDocumentAddress(ADDR, true), [], 'عنوان كامل سليم')
  assert.deepEqual(validateDocumentAddress({ ...ADDR, nameAr: '', countryCode: 'EGY', city: '', street: '', phone: 'abc', postalCode: '1', taxNumber: '12' }, true).length, 7, 'سبعة أخطاء معاً')
  assert.deepEqual(validateDocumentAddress({ nameAr: '', countryCode: '', city: '', district: '', street: '', buildingNumber: '', postalCode: '', additionalNumber: '', phone: '', taxNumber: '' }, false), [], 'العنوان اختياري ما لم يُطلب')
  assert.ok(validateDocumentAddress({ ...ADDR, phone: '١٢٣' }, true).some((e) => e.includes('الهاتف')), 'الأرقام العربية في الهاتف مرفوضة')
  assert.ok(sameDocumentAddress(ADDR, { ...ADDR, nameAr: `  ${ADDR.nameAr}  ` }), 'المقارنة تتجاهل الحواشي')
  assert.ok(!sameDocumentAddress(ADDR, { ...ADDR, city: 'طنطا' }), 'مدينة مختلفة = عنوان مختلف')
  R.ok('الحقول الثمانية والصيغ (هاتف بمسافات وبادئة +، ضريبي، بريدي) والمقارنة المطلقة')
}

// ——— ② قواعد الاعتماد ———
console.log('② قواعد اعتماد المستندات')
{
  const rules = [
    { id: 'R1', minTotalMinor: 0, documentKinds: ['sale'], requiredPermission: 'approve_sales', approvalsRequired: 1 },
    { id: 'R2', minTotalMinor: 1000000, documentKinds: ['sale', 'purchase'], requiredPermission: 'approve_big', approvalsRequired: 2 },
  ]
  assert.deepEqual(validateApprovalRules(rules), [])
  const bad = [{ id: '', minTotalMinor: -1, documentKinds: [], requiredPermission: ' ', approvalsRequired: 0 }, { id: 'x', minTotalMinor: 0, documentKinds: ['s'], requiredPermission: 'p', approvalsRequired: 6 }]
  assert.equal(validateApprovalRules([...bad, { ...rules[0], id: 'dup' }, { ...rules[0], id: 'dup' }]).length, 7, 'خمس قيم فاسدة + اعتمادات فوق الحد + معرف مكرر')
  // القاعدة الأشد تطبيقاً: 2,000,000 على بيع ⇒ R2 لا R1
  assert.equal(requiredApprovalRule(rules, 'sale', 2000000)?.id, 'R2')
  assert.equal(requiredApprovalRule(rules, 'sale', 500000)?.id, 'R1')
  assert.equal(requiredApprovalRule(rules, 'transfer', 5000000), null, 'نوع بلا قاعدة')
  // المنشئ لا يعتمد مستنده، والصلاحية الخاطئة لا تُحسب، والاعتماد المزدوج لا يضاعف
  const ap = (userId, permission) => ({ userId, userName: `مستخدم${userId}`, permission, approvedAt: '2026-10-02T09:00:00Z' })
  assert.equal(approvalSatisfied(rules[1], [ap(7, 'approve_big'), ap(8, 'approve_big')], 7), false, 'منشئ + واحد = اعتماد واحد فقط (المنشئ مستثنى)')
  assert.equal(approvalSatisfied(rules[1], [ap(8, 'approve_big'), ap(9, 'approve_big')], 7), true, 'اثنان غير المنشئ = كافٍ')
  assert.equal(approvalSatisfied(rules[1], [ap(8, 'approve_sales'), ap(9, 'x')], 7), false, 'صلاحية مختلفة لا تُحسب')
  assert.equal(approvalSatisfied(null, [], null), true, 'بلا قاعدة = لا اعتماد مطلوب')
  R.ok('القاعدة الأشد تطبيقاً + المنشئ مستثنى + الصلاحية مطابقة + المكرر لا يضاعف')
}

// ——— ③ المرفقات ———
console.log('③ مرفقات المستندات')
{
  const meta = { id: 'att-1', documentKind: 'sale', documentId: 5, fileName: 'عقد.pdf', mimeType: 'application/pdf', sizeBytes: 1024, sha256: 'a'.repeat(64), localRelativePath: 'attachments/2026/att-1.pdf', createdBy: 'المالك', createdAt: '2026-10-02T09:00:00Z' }
  assert.deepEqual(validateDocumentAttachment(meta), [])
  assert.equal(validateDocumentAttachment({ ...meta, mimeType: 'application/x-msdownload' })[0], 'نوع المرفق غير مسموح')
  assert.equal(validateDocumentAttachment({ ...meta, sizeBytes: DOCUMENT_ATTACHMENT_LIMIT_BYTES + 1 })[0], 'حجم المرفق غير مسموح')
  assert.equal(validateDocumentAttachment({ ...meta, sizeBytes: 0 })[0], 'حجم المرفق غير مسموح')
  assert.ok(validateDocumentAttachment({ ...meta, sha256: 'XYZ' }).some((e) => e.includes('SHA-256')))
  assert.ok(validateDocumentAttachment({ ...meta, localRelativePath: '../etc/passwd.pdf' }).some((e) => e.includes('غير آمن')), 'اجتياز الدليل مرفوض')
  assert.ok(validateDocumentAttachment({ ...meta, localRelativePath: 'a%2e.pdf' }).some((e) => e.includes('غير آمن')), 'ترميز النقطة مرفوض')
  assert.ok(validateDocumentAttachment({ ...meta, fileName: 'a/b.pdf' }).some((e) => e.includes('اسم المرفق')), 'شرطة في الاسم مرفوضة')
  assert.ok(validateDocumentAttachment({ ...meta, fileName: 'x' + '\n' + 'y.pdf' }).some((e) => e.includes('اسم المرفق')), 'محرف تحكم في الاسم مرفوض')
  R.ok('الأنواع الأربعة وسقف 10MB وبصمة SHA-256 ومسار آمن ضد اجتياز الدليل والترميز')
}

// ——— ④ لقطة العملة ———
console.log('④ لقطة العملة والتحويل')
{
  const snap = { currencyCode: 'USD', currencyDecimals: 2, localMinorPerForeignMajorScaled: 487000, rateScale: 3, capturedAt: '2026-10-02T10:00:00Z' }
  assert.deepEqual(validateCurrencySnapshot(snap), [])
  assert.equal(foreignMinorToLocalMinor(100, snap), 487, '1 دولار = 487 قرشاً')
  assert.equal(foreignMinorToLocalMinor(1, snap), 5, 'نصف قرش يقرب لأعلى')
  // 3 سنتات × 487 قرشاً/دولار = 14.61 ⇒ 15 بالتقريب النصفي الصاعد
  assert.equal(foreignMinorToLocalMinor(3, snap), 15, 'التقريب النصفي الصاعد: 14.61 ⇒ 15')
  assert.equal(foreignMinorToLocalMinor(0, snap), 0, 'صفر يمر')
  // لقطات فاسدة تُرفض كلها
  for (const bad of [
    { ...snap, currencyCode: 'usd' }, { ...snap, currencyDecimals: 5 }, { ...snap, rateScale: -1 },
    { ...snap, localMinorPerForeignMajorScaled: 0 }, { ...snap, capturedAt: 'yesterday' },
  ]) assert.ok(validateCurrencySnapshot(bad).length > 0)
  assert.throws(() => foreignMinorToLocalMinor(1.5, snap), /صحيحة/, 'المبلغ يجب أن يكون صحيح الوحدات الصغرى')
  assert.throws(() => foreignMinorToLocalMinor(100, { ...snap, currencyCode: 'XX' }), /كود العملة/)
  R.ok('BigInt بلا float، تقريب نصفي صاعد، واللقطات الفاسدة الخمس كلها مرفوضة')
}

// ——— ⑤ ترقيم المستندات ———
console.log('⑤ ترقيم المستندات')
{
  const seq = { prefix: 'INV', nextValue: 9998, padding: 4, fiscalYear: 2026 }
  const a = reserveDocumentNumber(seq)
  assert.equal(a.documentNumber, 'INV-2026-9998')
  assert.equal(a.nextSequence.nextValue, 9999)
  const b = reserveDocumentNumber(a.nextSequence)
  assert.equal(b.documentNumber, 'INV-2026-9999')
  assert.throws(() => reserveDocumentNumber(b.nextSequence), /نفد نطاق/, 'الرقم 10000 بعرض 4 = نفاد')
  assert.equal(reserveDocumentNumber({ prefix: 'PO', nextValue: 7, padding: 2 }).documentNumber, 'PO-07', 'بلا سنة مالية: بادئة-رقم فقط')
  assert.ok(validateDocumentNumberSequence({ prefix: 'inv', nextValue: 0, padding: 0, fiscalYear: 1999 }).length >= 3, 'بادئة صغيرة وصفر وسنة قديمة')
  assert.throws(() => reserveDocumentNumber({ prefix: '', nextValue: 1, padding: 2 }), /بادئة/)
  R.ok('الحجز يزيد التسلسل ويعيد رقماً جاهزاً، النفاد محروس، والبادئة/العرض/السنة محققة')
}

// ——— ⑥ مراجع المستندات ———
console.log('⑥ مراجع المستندات')
{
  const refs = [
    { kind: 'return_of', documentId: 'doc-10', documentNumber: 'S-0010', createdAt: '2026-10-01T00:00:00Z' },
    { kind: 'reversal_of', documentId: 'doc-11', documentNumber: 'S-0011', createdAt: '2026-10-01T00:00:00Z', reason: 'خطأ سعر' },
  ]
  assert.deepEqual(validateDocumentReferences('doc-1', refs), [])
  assert.equal(findOriginalReference(refs)?.kind, 'return_of', 'الأصل المرتجع عنه يُقصد أولاً')
  assert.ok(validateDocumentReferences('doc-10', refs).some((e) => e.includes('نفسه')), 'إشارة للنفس مرفوضة')
  assert.ok(validateDocumentReferences('doc-1', [...refs, refs[0]]).some((e) => e.includes('مكرر')))
  assert.ok(validateDocumentReferences('doc-1', [...refs, { kind: 'replaces', documentId: 'doc-12', documentNumber: 'S-0012', createdAt: '2026-10-01T00:00:00Z' }]).some((e) => e.includes('الاستبدال مطلوب')), 'الاستبدال بلا سبب مرفوض')
  assert.ok(validateDocumentReferences('doc-1', [...refs, { kind: 'credit_for', documentId: '', documentNumber: 'x', createdAt: 'ليس تاريخاً' }]).length >= 2)
  assert.equal(findOriginalReference([]), null)
  R.ok('خمسة أنواع مراجع، السبب إلزامي للعكس/الاستبدال، ولا نفس/مكرر/فاسد')
}

// ——— ⑦ حارس الضريبة ———
console.log('⑦ حارس الضريبة على المستند')
{
  const reg = { status: 'registered', registrationNumber: '300-000-000', effectiveFrom: '2026-01-01', validUntil: null }
  const presented = guardTaxDocument(reg, [{ taxMinor: 1400, treatment: 'standard' }, { taxMinor: 0, treatment: 'exempt' }])
  assert.equal(presented.showTaxColumns, true)
  assert.equal(presented.showRegistrationNumber, true)
  const notReg = { status: 'not_registered', registrationNumber: null, effectiveFrom: '2026-01-01', validUntil: null }
  const clean = guardTaxDocument(notReg, [{ taxMinor: 0, treatment: 'not_registered' }])
  assert.equal(clean.showTaxColumns, false)
  assert.equal(clean.footerAr, 'المنشأة غير مسجلة ضريبياً')
  assert.throws(() => guardTaxDocument(notReg, [{ taxMinor: 1, treatment: 'not_registered' }]), /غير مسجلة/)
  assert.throws(() => guardTaxDocument(notReg, [{ taxMinor: 0, treatment: 'standard' }]), /غير مسجلة/)
  assert.throws(() => guardTaxDocument({ ...reg, registrationNumber: ' ' }, []), /رقم التسجيل/)
  assert.throws(() => guardTaxDocument(reg, [{ taxMinor: 0, treatment: 'not_registered' }]), /معالجة غير مسجل غير مسموحة/)
  assert.throws(() => guardTaxDocument(reg, [{ taxMinor: -1, treatment: 'standard' }]), /غير صالحة/)
  R.ok('غير المسجل لا يعرض ولا يحتسب ضريبة، والمسجل يعرض رقمه ويرفض معالجة غير مسجل')
}

// ——— ⑧ سيناريو الترابط: مستند كامل من النواة الخالصة وحدها ———
console.log('⑧ سيناريو الترابط الكامل')
{
  // مستند بيع بعملة أجنبية يُحوَّل، سطوره تُلخص ضريبياً، عليه خصم وشحن موزَّعان،
  // وله تسوية جزئية ورقم محجوز ودورة حياة كاملة — كل شيء من النواة وحدها.
  const snap = { currencyCode: 'USD', currencyDecimals: 2, localMinorPerForeignMajorScaled: 487000, rateScale: 3, capturedAt: '2026-10-02T08:00:00Z' }
  // 3 سطور أجنبية: 10.00$ + 20.00$ + 20.00$ ⇒ محلياً 4870 + 9740 + 9740 = 24350
  const linesLocal = [1000, 2000, 2000].map((f) => foreignMinorToLocalMinor(f, snap))
  assert.deepEqual(linesLocal, [4870, 9740, 9740], 'التحويل سطراً سطراً')
  const vat = { code: 'VAT14', nameAr: 'ضريبة القيمة المضافة', rateBasisPoints: 1400, registrationNumber: '300-000-000', capturedAt: '2026-01-01T00:00:00Z' }
  const exempt = { code: 'EX', nameAr: 'معفى', rateBasisPoints: 0, capturedAt: '2026-01-01T00:00:00Z' }
  const taxes = summarizeTaxes([
    { netMinor: linesLocal[0], tax: vat }, { netMinor: linesLocal[1], tax: vat },
    { netMinor: linesLocal[2], tax: exempt },
  ])
  // VAT: 14% من (4870+9740)=14610 ⇒ نصف-صاعد: 14610×0.14=2045.4 ⇒ 2045
  assert.equal(calculateTaxMinor(14610, vat), 2045, '14% بنصف-صاعد BigInt')
  assert.equal(taxes.VAT14.netMinor, 14610)
  assert.equal(taxes.EX.taxMinor, 0, 'المعفى بلا ضريبة')
  const taxMinor = taxes.VAT14.taxMinor
  // خصم 1000 قرش + شحن 500 قرش تُوزَّع على أسس السطور الثلاثة
  const shipping = allocateChargeByLineBase(500, linesLocal)
  assert.equal(shipping.reduce((s, x) => s + x.amountMinor, 0), 500, 'الشحن موزَّع بالكامل بالقرش')
  assert.ok(shipping.every((x) => x.amountMinor >= 0), 'لا حصة سالبة (عيب §76 مؤمَّن)')
  const charges = [
    { kind: 'discount', nameAr: 'خصم كمية', amountMinor: 1000, taxable: false },
    { kind: 'shipping', nameAr: 'شحن', amountMinor: 500, taxable: true },
  ]
  const subtotal = linesLocal.reduce((a, b) => a + b, 0)
  const netAfterCharges = documentNetAfterCharges(subtotal, charges)
  assert.equal(netAfterCharges, 23850, '24350 − 1000 + 500')
  // الإجماليات الكاملة (الخصم هنا منفصل عن رسوم الشحن)
  const totals = calculateDocumentTotals({ subtotalMinor: subtotal, discountMinor: 1000, chargeMinor: 500, taxMinor, paidMinor: 5000 })
  assert.equal(totals.grandTotalMinor, 24350 - 1000 + 500 + taxMinor, 'الإجمالي = الصافي − الخصم + الشحن + الضريبة')
  assert.equal(totals.dueMinor, totals.grandTotalMinor - 5000)
  // التسويات: نقدي + بنكي ⇒ جزئي، ثم الملغاة لا تُحسب
  const st = [
    { id: 'st-1', documentId: 'doc-84', amountMinor: 5000, settledAt: '2026-10-02T09:00:00Z', method: 'cash', voided: false },
    { id: 'st-2', documentId: 'doc-84', amountMinor: 3000, settledAt: '2026-10-02T10:00:00Z', method: 'bank', voided: false },
    { id: 'st-3', documentId: 'doc-84', amountMinor: 3000, settledAt: '2026-10-02T11:00:00Z', method: 'cheque', voided: true },
  ]
  assert.deepEqual(validateSettlements('doc-84', totals.grandTotalMinor, st), [])
  const summary = settlementSummary(totals.grandTotalMinor, st)
  assert.equal(summary.paidMinor, 8000, 'الملغاة لا تدخل المدفوع')
  assert.equal(summary.status, 'partial')
  // الرقم المحجوز والبيانات المشتركة ودورة الحياة
  const { documentNumber } = reserveDocumentNumber({ prefix: 'S', nextValue: 84, padding: 4, fiscalYear: 2026 })
  assert.equal(documentNumber, 'S-2026-0084')
  const meta = {
    status: 'approved', documentDate: '2026-10-02', postedAt: null, dueDate: '2026-11-01',
    externalReference: 'PO-77', notes: 'مستند §84', createdBy: 'المالك', createdAt: '2026-10-02T08:30:00Z',
    approvedBy: 'المدير', approvedAt: '2026-10-02T09:00:00Z', postedBy: null,
    idempotencyKey: 'doc-84-key-2026-10-02-0001',
  }
  assert.deepEqual(validateCommercialDocumentMeta(meta), [], 'معتمد بلا وقت ترحيل — سليم (عيب §76 مؤمَّن)')
  assert.ok(isValidIdempotencyKey(meta.idempotencyKey))
  // المصفوفة: مسودة → اعتماد → ترحيل → عكس جزئي → عكس كامل (كل انتقال بسياقه)
  let status = 'draft'
  status = transitionDocument(status, 'approve')
  assert.equal(status, 'approved')
  assert.ok(isDocumentEditable('draft') && !isDocumentEditable(status), 'المعتمد غير قابل للتحرير')
  status = transitionDocument(status, 'post')
  assert.equal(status, 'posted')
  assert.throws(() => transitionDocument(status, 'void', { hasPostedEffects: true }), /آثار مرحّلة/, 'المرحَّل لا يُلغى صامتاً')
  status = transitionDocument(status, 'record_partial_reversal', { hasPartialReversal: true })
  assert.equal(status, 'partially_reversed')
  status = transitionDocument(status, 'record_full_reversal', { hasFullReversal: true })
  assert.equal(status, 'reversed')
  assert.ok(isDocumentTerminal(status), 'المنتهي لا يتحرك')
  assert.throws(() => transitionDocument(status, 'approve'), /غير مسموح/)
  // والخصم الذي يلتهم الصافي: مرفوض في الدالتين معاً (عيب §84 مؤمَّن)
  assert.throws(() => documentNetAfterCharges(100, [{ kind: 'discount', nameAr: 'خصم قاتل', amountMinor: 500, taxable: false }]), /يتجاوز قيمة المستند/)
  assert.throws(() => calculateDocumentTotals({ subtotalMinor: 100, discountMinor: 500, chargeMinor: 0, taxMinor: 0, paidMinor: 0 }), /يتجاوز/)
  R.ok('مستند كامل من النواة وحدها: تحويل → تلخيص ضريبي → توزيع رسوم → إجماليات → تسويات جزئية → ترقيم → بيانات مشتركة → دورة حياة كاملة')
}

// ——— ⑨ ختام: مصدرية الإصلاح ———
console.log('⑨ مصدرية الإصلاح')
{
  const src = readFileSync(here + '../src/core/documentCharges.ts', 'utf8')
  assert.ok(src.includes('إصلاح §84') && src.includes('الخصم يتجاوز قيمة المستند'), 'حارس الصافي السالب موثق في مكانه')
  const repo = readFileSync(here + '../src/data/repo.ts', 'utf8')
  assert.ok(!repo.includes('documentNetAfterCharges'), 'لا مستدعٍ حياً — النواة معزولة بتصميم SQLite القادم، فالإصلاح أدنى وموثق')
  R.ok('عيب §84 (صافٍ سالب بصمت) موثق في المصدر، والنواة معزولة حياً بتصميم مقصود')
}

console.log(`\n✅ نواة المستندات — العائلة الكاملة (§84): ${R.n} فحصاً ناجحاً`)
