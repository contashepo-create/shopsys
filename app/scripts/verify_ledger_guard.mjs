/**
 * verify_ledger_guard.mjs — بوابة الحارس المركزي للدفتر (المرحلة 1 — إغلاق AUDIT-002 وAUDIT-003).
 *
 * تثبت أن **بوابة واحدة** تحمي دفتر اليومية مهما كان المسار:
 *   أ) وحدةً: `validateEntry`/`assertJournalIntegrity` ترفض كل صنف مخالفة بنص عربي.
 *   ب) تكاملاً: مسارات حقيقية (سند/شراء) صار قفل السنة المالية يسري عليها — لا على القيد اليدوي وحده.
 *   ج) توحيد التاريخ: أي مسار يرسل ISO كاملاً يُخزَّن YYYY-MM-DD (وإلا انفتحت ثغرة «آخر يوم في السنة المقفلة»).
 *   د) لا تعديل صامت لسطور قيد مُرحَّل.
 */
import { readFileSync } from 'node:fs'
import { freshCase, expectReject, addSimpleItem, addParty, assertInvariants, reporter, STANDARD_COA, useAppStore } from './auditKit.mjs'

const { validateEntry, assertJournalIntegrity, normalizeJournalDates, validateSourceReference } = await import(new URL('../src/core/ledgerGuard.ts', import.meta.url).href)
const { SOURCE_TYPE_VALUES, SOURCE_REFERENCE_COLLECTIONS, SOURCE_REFERENCE_COLLECTION_OPTIONS, NON_DIRECT_SOURCE_REFERENCE_REASONS } = await import(new URL('../src/core/sourceTypes.ts', import.meta.url).href)
const { fullCoa } = await import(new URL('../src/core/treasury.ts', import.meta.url).href)
const { DEFAULT_TREASURIES } = await import(new URL('../src/core/treasury.ts', import.meta.url).href)

const R = reporter('بوابة الحارس المركزي للدفتر')
const CTX = { coa: fullCoa(STANDARD_COA, DEFAULT_TREASURIES), fiscalYears: [{ nameAr: 'سنة 2025', startDate: '2025-01-01', endDate: '2025-12-31', status: 'closed' }] }

const entry = (lines, patch = {}) => ({
  id: 1, entryNumber: 1, date: '2026-05-05', description: 'اختبار', sourceType: 'manual',
  sourceId: 1, lines, createdBy: 'المدقق', createdAt: '2026-05-05T00:00:00.000Z',
  reversedByEntryId: null, reversesEntryId: null, ...patch,
})

// ————————————————————————————————————————————————
// أ) وحدةً — كل صنف مخالفة يُرفض بنص عربي
// ————————————————————————————————————————————————
R.section('🔬 فحص الحارس وحدةً')
{
  const directTypes = Object.keys(SOURCE_REFERENCE_COLLECTIONS)
  const nonDirectTypes = Object.keys(NON_DIRECT_SOURCE_REFERENCE_REASONS)
  const mixedTypes = Object.keys(SOURCE_REFERENCE_COLLECTION_OPTIONS)
  const classified = [...directTypes, ...nonDirectTypes]
  const unique = new Set(classified)
  if (unique.size !== SOURCE_TYPE_VALUES.length || SOURCE_TYPE_VALUES.some((type) => !unique.has(type))) {
    console.error('❌ سياسة مراجع المصدر لا تصنف كل SourceType مرة واحدة بالضبط'); process.exit(1)
  }
  if (directTypes.some((type) => !SOURCE_REFERENCE_COLLECTIONS[type]) || nonDirectTypes.some((type) => !NON_DIRECT_SOURCE_REFERENCE_REASONS[type])) {
    console.error('❌ تصنيف مصدر بلا مجموعة أو تعليل'); process.exit(1)
  }
  if (mixedTypes.some((type) => !nonDirectTypes.includes(type)) || nonDirectTypes.filter((type) => !mixedTypes.includes(type)).sort().join(',') !== ['depreciation', 'manual', 'opening'].sort().join(',')) {
    console.error('❌ خيارات المجموعات المختلطة لا تطابق الأنواع المؤجلة أو الاستثناءات الثلاثة الموثقة'); process.exit(1)
  }
  const repoSource = readFileSync(new URL('../src/data/repo.ts', import.meta.url), 'utf8')
  const dataState = repoSource.match(/interface DataState\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
  const missingCollections = [...new Set(Object.values(SOURCE_REFERENCE_COLLECTIONS))]
    .filter((collection) => !new RegExp(`^\\s*${collection}\\s*:\\s*[^\\n]*\\[\\]`, 'm').test(dataState))
  if (missingCollections.length) {
    console.error(`❌ مجموعات سياسة المراجع ليست مصفوفات DataState: ${missingCollections.join(', ')}`); process.exit(1)
  }
  const tsImport = await import('typescript')
  const ts = tsImport.default ?? tsImport
  const sourceFile = ts.createSourceFile('repo.ts', repoSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const mixedSourceErrors = []
  let mixedSourceEntries = 0
  const getPropertyName = (property) => property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : null)
  const collectStringLiterals = (node, out = []) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text)
    else ts.forEachChild(node, (child) => collectStringLiterals(child, out))
    return out
  }
  const visitSourceObjects = (node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const sourceTypeProperty = node.properties.find((property) => ts.isPropertyAssignment(property) && getPropertyName(property) === 'sourceType')
      if (sourceTypeProperty) {
        const actualMixedTypes = [...new Set(collectStringLiterals(sourceTypeProperty.initializer).filter((type) => mixedTypes.includes(type)))]
        if (actualMixedTypes.length) {
          mixedSourceEntries++
          const sourceCollectionProperty = node.properties.find((property) => ts.isPropertyAssignment(property) && getPropertyName(property) === 'sourceCollection')
          const selectedCollections = sourceCollectionProperty ? collectStringLiterals(sourceCollectionProperty.initializer) : []
          for (const sourceType of actualMixedTypes) {
            const allowed = SOURCE_REFERENCE_COLLECTION_OPTIONS[sourceType]
            if (!allowed.some((collection) => selectedCollections.includes(collection))) {
              const { line } = sourceFile.getLineAndCharacterOfPosition(sourceTypeProperty.getStart(sourceFile))
              mixedSourceErrors.push(`${sourceType} عند repo.ts:${line + 1} بلا sourceCollection مسموح`)
            }
          }
        }
      }
    }
    ts.forEachChild(node, visitSourceObjects)
  }
  visitSourceObjects(sourceFile)
  if (mixedSourceErrors.length) {
    console.error(`❌ مسارات إنشاء المصدر المختلط بلا discriminator: ${mixedSourceErrors.join(' · ')}`); process.exit(1)
  }
  R.ok(`فحص AST غطى ${mixedSourceEntries} بُنى إنشاء للمصادر المختلطة — لكل منها discriminator مسموح`)
  R.ok(`سياسة صريحة تغطي ${directTypes.length} نوعاً مباشراً و${mixedTypes.length} نوعاً مختلطاً بثلاثة استثناءات بلا مستند من أصل ${SOURCE_TYPE_VALUES.length}`)
  R.ok(`كل المجموعات الـ${new Set(Object.values(SOURCE_REFERENCE_COLLECTIONS)).size} موجودة كمصفوفات في DataState`)
  const sourceFixtureIndexes = Object.fromEntries(directTypes.map((type) => [type, new Map([[77, 2]])]))
  for (const sourceType of directTypes) {
    const linked = entry([], { sourceType, sourceId: 77, branchId: 2 })
    const orphan = entry([], { sourceType, sourceId: 78, branchId: 2 })
    const foreign = entry([], { sourceType, sourceId: 77, branchId: 3 })
    if (validateSourceReference(linked, sourceFixtureIndexes).length) throw new Error(`مرجع صحيح رُفض للنوع ${sourceType}`)
    if (!validateSourceReference(orphan, sourceFixtureIndexes).some((error) => error.includes('غير موجود'))) throw new Error(`مرجع يتيم مرّ للنوع ${sourceType}`)
    if (!validateSourceReference(foreign, sourceFixtureIndexes).some((error) => error.includes('فرع آخر'))) throw new Error(`مرجع فرع أجنبي مرّ للنوع ${sourceType}`)
  }
  R.ok(`اختُبرت دالة الحارس على كل الأنواع المباشرة الـ${directTypes.length}: صحيح/يتيم/فرع مختلف`)
  const mixedLines = [{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }]
  for (const sourceType of mixedTypes) {
    const sourceCollection = SOURCE_REFERENCE_COLLECTION_OPTIONS[sourceType][0]
    const collectionIndexes = { [sourceCollection]: new Map([[77, 2]]) }
    const mixedCtx = { ...CTX, fiscalYears: [], sourceCollectionIndexes: collectionIndexes, requireSourceCollection: true }
    const tagged = entry(mixedLines, { sourceType, sourceId: 77, sourceCollection, branchId: 2 })
    if (validateEntry(tagged, mixedCtx).length) throw new Error(`مرجع مختلط صحيح رُفض للنوع ${sourceType}`)
    const missingTag = entry(mixedLines, { sourceType, sourceId: 77, branchId: 2 })
    if (!validateEntry(missingTag, mixedCtx).some((error) => error.includes('يجب تحديد مجموعة المستند'))) throw new Error(`مرّ مصدر مختلط بلا discriminator: ${sourceType}`)
    const orphan = entry(mixedLines, { sourceType, sourceId: 78, sourceCollection, branchId: 2 })
    if (!validateEntry(orphan, mixedCtx).some((error) => error.includes('غير موجود'))) throw new Error(`مرّ مرجع يتيم للنوع المختلط ${sourceType}`)
  }
  R.ok(`اختُبر discriminator والمرجع اليتيم لكل الأنواع المختلطة الـ${mixedTypes.length}`)
}
const cases = [
  ['قيد غير متزن', entry([{ accountCode: '1101', debit: 1000, credit: 0 }, { accountCode: '4101', debit: 0, credit: 900 }]), /غير متزن/],
  ['سطر بجانبين', entry([{ accountCode: '1101', debit: 500, credit: 500 }, { accountCode: '4101', debit: 0, credit: 500 }, { accountCode: '5108', debit: 500, credit: 0 }]), /مدين ودائن معاً/],
  ['مبلغ سالب', entry([{ accountCode: '1101', debit: -100, credit: 0 }, { accountCode: '4101', debit: 0, credit: -100 }]), /سالب/],
  ['مبلغ كسري', entry([{ accountCode: '1101', debit: 10.5, credit: 0 }, { accountCode: '4101', debit: 0, credit: 10.5 }]), /غير صحيح/],
  ['حساب غير موجود', entry([{ accountCode: '9999', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }]), /غير موجود/],
  ['حساب تجميعي', entry([{ accountCode: '11', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }]), /تجميعي/],
  ['طرف واحد', entry([{ accountCode: '1101', debit: 0, credit: 0 }]), /طرفين/],
  ['بلا نوع مصدر', entry([{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }], { sourceType: '' }), /نوع مصدر/],
  ['نوع مصدر غير معروف وقت التشغيل', entry([{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }], { sourceType: 'unknown_source' }), /نوع مصدر غير معروف/],
  ['مستند بلا معرّف مصدر', entry([{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }], { sourceType: 'sale', sourceId: null }), /معرّف المصدر مطلوب/],
  ['معرّف مصدر صفري', entry([{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }], { sourceId: 0 }), /معرّف المصدر غير صالح/],
  ['معرّف مصدر كسري', entry([{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }], { sourceId: 1.5 }), /معرّف المصدر غير صالح/],
  ['تاريخ غير صالح', entry([{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }], { date: '20-5-2026' }), /تاريخ غير صالح/],
  ['داخل سنة مقفلة', entry([{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }], { date: '2025-06-01' }), /مقفلة/],
]
for (const [label, e, pattern] of cases) {
  const errs = validateEntry(e, CTX)
  if (!errs.length) { console.error(`❌ «${label}» مرّ بلا رفض`); process.exit(1) }
  if (!errs.some((x) => pattern.test(x))) { console.error(`❌ «${label}» رُفض برسالة غير متوقعة: ${errs.join(' | ')}`); process.exit(1) }
  if (!errs.every((x) => /[\u0600-\u06FF]/.test(x))) { console.error(`❌ «${label}» رسالته ليست عربية`); process.exit(1) }
  R.ok(`${label}: مرفوض — «${errs[0].slice(0, 70)}…»`)
}

// المصدر الفارغ استثناء صريح ومحدود، لا يسري على مستندات البيع/الشراء وغيرها.
{
  const noFiscalYears = { ...CTX, fiscalYears: [] }
  const validLines = [{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }]
  for (const sourceType of ['manual', 'opening', 'depreciation']) {
    const errs = validateEntry(entry(validLines, { sourceType, sourceId: null }), noFiscalYears)
    if (errs.length) { console.error(`❌ الاستثناء الموثق ${sourceType} رُفض: ${errs.join(' | ')}`); process.exit(1) }
    R.ok(`sourceId=null مسموح استثناءً لـ${sourceType} فقط`)
  }
  const strictReferences = { ...noFiscalYears, sourceDocumentIndexes: { sale: new Map([[77, 2]]) } }
  const orphanErrors = validateEntry(entry(validLines, { sourceType: 'sale', sourceId: 78 }), strictReferences)
  if (!orphanErrors.some((message) => message.includes('غير موجود في سجلات النظام'))) {
    console.error('❌ مرّ مصدر بيع يشير إلى مستند غير موجود'); process.exit(1)
  }
  R.ok('مرجع بيع يتيم مرفوض عند تفعيل سياسة الربط المباشر')
  const linkedErrors = validateEntry(entry(validLines, { sourceType: 'sale', sourceId: 77, branchId: 2 }), strictReferences)
  if (linkedErrors.length) { console.error(`❌ مرجع بيع صحيح رُفض: ${linkedErrors.join(' | ')}`); process.exit(1) }
  R.ok('مرجع بيع موجود في الفرع نفسه يمر تحت سياسة الربط المباشر')
  const wrongBranchErrors = validateEntry(entry(validLines, { sourceType: 'sale', sourceId: 77, branchId: 3 }), strictReferences)
  if (!wrongBranchErrors.some((message) => message.includes('تابع لفرع آخر'))) {
    console.error('❌ مرجع بيع من فرع آخر مرّ دون رفض'); process.exit(1)
  }
  R.ok('مرجع بيع موجود بفرع مختلف مرفوض')
  const unownedReferenceErrors = validateSourceReference(entry(validLines, { sourceType: 'manual', sourceId: 78 }), {})
  if (unownedReferenceErrors.length) { console.error('❌ فُرض ربط مستند على مصدر غير مباشر'); process.exit(1) }
  R.ok('الأنواع غير المباشرة لا تُعامل خطأً كمستندات مباشرة')
}

// قيد الإقفال السنوي مستثنى من قفل السنة (يقع في آخر يوم من السنة المقفلة نفسها)
{
  const closing = entry([{ accountCode: '4101', debit: 1000, credit: 0 }, { accountCode: '3102', debit: 0, credit: 1000 }], { date: '2025-12-31', sourceType: 'year_closing' })
  const errs = validateEntry(closing, CTX)
  if (errs.length) { console.error(`❌ قيد الإقفال السنوي رُفض: ${errs.join(' | ')}`); process.exit(1) }
  R.ok('قيد الإقفال السنوي مسموح داخل السنة المقفلة (استثناء موثق وحيد)')
}

// ث9: تعديل سطور قيد مُرحَّل
{
  const prev = [entry([{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }])]
  const tampered = [{ ...prev[0], lines: [{ accountCode: '1101', debit: 900, credit: 0 }, { accountCode: '4101', debit: 0, credit: 900 }] }]
  let threw = false
  try { assertJournalIntegrity(prev, tampered, CTX) } catch (e) { threw = /تعديل صامت/.test(e.message) }
  if (!threw) { console.error('❌ تعديل سطور قيد مُرحَّل لم يُرفض'); process.exit(1) }
  R.ok('ث9: تعديل سطور قيد مُرحَّل مرفوض — التصحيح بقيد عاكس فقط')
}

// ث9: منع الحذف أو تغيير رقم قيد مرحّل عبر استبدال مصفوفة الدفتر
{
  const original = entry([{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }])
  let deletionRejected = false
  try { assertJournalIntegrity([original], [], CTX) } catch (e) { deletionRejected = /حذف القيد/.test(e.message) }
  if (!deletionRejected) { console.error('❌ حذف قيد مرحّل من مصفوفة الدفتر لم يُرفض'); process.exit(1) }
  R.ok('ث9: حذف قيد مرحّل من مصفوفة الدفتر مرفوض')

  let numberChangeRejected = false
  try { assertJournalIntegrity([original], [{ ...original, entryNumber: original.entryNumber + 1 }], CTX) }
  catch (e) { numberChangeRejected = /تغيير رقم القيد/.test(e.message) }
  if (!numberChangeRejected) { console.error('❌ تغيير رقم قيد مرحّل لم يُرفض'); process.exit(1) }
  R.ok('ث9: تغيير رقم القيد المرحّل مرفوض')
}

// ث4: تكرار رقم القيد
{
  const a = entry([{ accountCode: '1101', debit: 100, credit: 0 }, { accountCode: '4101', debit: 0, credit: 100 }])
  const b = { ...a, id: 2 }
  let threw = false
  try { assertJournalIntegrity([], [a, b], CTX) } catch (e) { threw = /مكرر/.test(e.message) }
  if (!threw) { console.error('❌ تكرار رقم القيد لم يُرفض'); process.exit(1) }
  R.ok('ث4: رقم قيد مكرر مرفوض')

  const sameIdDifferentNumber = { ...a, entryNumber: a.entryNumber + 1 }
  threw = false
  try { assertJournalIntegrity([], [a, sameIdDifferentNumber], CTX) } catch (e) { threw = /معرّف القيد/.test(e.message) }
  if (!threw) { console.error('❌ تكرار معرّف قيد برقم دفتر مختلف لم يُرفض'); process.exit(1) }
  R.ok('ث4: معرّف القيد المكرر مرفوض حتى مع رقم دفتر مختلف')
}

// توحيد التاريخ
{
  const iso = [entry([{ accountCode: '1101', debit: 1, credit: 0 }, { accountCode: '4101', debit: 0, credit: 1 }], { date: '2026-09-20T09:00:00.000Z' })]
  const out = normalizeJournalDates(iso)
  if (out[0].date !== '2026-09-20') { console.error('❌ لم يُطبَّع التاريخ'); process.exit(1) }
  if (normalizeJournalDates([entry([{ accountCode: '1101', debit: 1, credit: 0 }, { accountCode: '4101', debit: 0, credit: 1 }])]).length !== 1) { console.error('❌ التطبيع أفسد المصفوفة'); process.exit(1) }
  R.ok('توحيد التاريخ: ISO كامل ⇒ YYYY-MM-DD (يسد ثغرة آخر يوم في السنة المقفلة)')
}

// ————————————————————————————————————————————————
// ب) تكاملاً — المسارات الحقيقية صارت محمية
// ————————————————————————————————————————————————
R.section('🔗 الحارس داخل المسارات الحقيقية')
{
  const c = await freshCase({
    activityId: 'general',
    fiscalYears: [
      { id: 1, nameAr: 'سنة 2025', startDate: '2025-01-01', endDate: '2025-12-31', status: 'closed' },
      { id: 2, nameAr: 'سنة 2026', startDate: '2026-01-01', endDate: '2026-12-31', status: 'open' },
    ],
  })
  const item = addSimpleItem(c, { nameAr: 'صنف', priceMinor: 5000 })
  const sup = addParty(c, 'supplier', 'مورد')
  const cust = addParty(c, 'customer', 'عميل')

  // AUDIT-003 سابقاً: السند كان يمر بتاريخ داخل سنة مقفلة
  expectReject('سند قبض بتاريخ داخل سنة مقفلة', c, () => c.st().postVoucher({
    kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 10000,
    description: 'تحصيل قديم', date: '2025-07-01', partyKind: 'customer', partyId: cust.id,
  }), /مقفلة/)
  R.ok('سند قبض داخل سنة مقفلة: مرفوض الآن (كان يمر قبل الحارس)')

  expectReject('فاتورة شراء بتاريخ داخل سنة مقفلة', c, () => c.st().postPurchase({
    supplierId: sup.id, date: '2025-11-20', treasury: '1101', notes: '', paidMinor: 0, expenses: [],
    lines: [{ itemId: item.id, qty: 5, unitPriceMinor: 3000 }],
  }), /مقفلة/)
  R.ok('فاتورة شراء داخل سنة مقفلة: مرفوضة الآن بلا أثر على المخزون ولا الدفتر')

  // نفس المسارات تعمل داخل السنة المفتوحة
  c.st().postPurchase({ supplierId: sup.id, date: '2026-04-10T08:30:00.000Z', treasury: '1101', notes: '', paidMinor: 0, expenses: [], lines: [{ itemId: item.id, qty: 10, unitPriceMinor: 3000 }] })
  const dates = c.st().journal.map((e) => e.date)
  if (dates.some((d) => d.length !== 10)) { console.error(`❌ تاريخ غير موحد في الدفتر: ${dates.join(', ')}`); process.exit(1) }
  R.ok(`الشراء داخل السنة المفتوحة يمر، وكل تواريخ الدفتر موحدة (${dates.join('، ')})`)

  assertInvariants('بعد عمل الحارس', c)
  R.ok('الثوابت العشرة سليمة بعد الرفض والقبول')
}

// السنة تُقفل بعد الترحيل: القيود القديمة تبقى، والجديد يُمنع
{
  const c = await freshCase({ activityId: 'general' })
  c.st().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '5108', amountMinor: 2000, description: 'مصروف 2026', date: '2026-06-01' })
  const before = c.st().journal.length
  useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: 'سنة 2026', startDate: '2026-01-01', endDate: '2026-12-31', status: 'closed' }] })
  expectReject('ترحيل بعد إقفال السنة', c, () => c.st().postVoucher({
    kind: 'payment', treasury: '1101', counterAccountCode: '5108', amountMinor: 3000, description: 'مصروف متأخر', date: '2026-08-01',
  }), /مقفلة/)
  if (c.st().journal.length !== before) { console.error('❌ القيود القديمة تأثرت'); process.exit(1) }
  R.ok('إقفال السنة يمنع الجديد ولا يمس القديم')
  useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: 'سنة 2026', startDate: '2026-01-01', endDate: '2026-12-31', status: 'open' }] })
}

R.done('· الحارس المركزي يغطي ث1 وث2 وث3 وث4 وث9 على كل المسارات')
