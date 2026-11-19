/**
 * مسح الثوابت على **كل** نشاط (29 نشاطاً) — بديل الفحص العشوائي.
 *
 * لكل نشاط: حالة نظيفة مستقلة (freshCase) بميزاته الحقيقية (صلاحية/سيريال/وزن)،
 * ثم دورة ترحيل قصيرة: شراء → بيع نقدي (ووردية) → مرتجع — مع تشغيل فاحص الثوابت
 * العشرة (auditKit) **بعد كل خطوة**. أي انحراف في أي نشاط يسقط البوابة باسمه.
 */
import assert from 'node:assert/strict'
import { reporter, freshCase, assertInvariants, ACTIVITY_TEMPLATES } from './auditKit.mjs'

const R = reporter('مسح الثوابت على الأنشطة كافة (29)')

const FEATURE = {
  expiry: 'expiry_batches',
  serial: 'serial_warranty',
  weight: 'weight_scale',
}

const table = []

for (const template of ACTIVITY_TEMPLATES) {
  const activityId = template.id
  const features = new Set(template.features ?? [])
  const trackExpiry = features.has(FEATURE.expiry)
  const trackSerial = features.has(FEATURE.serial)
  const soldByWeight = features.has(FEATURE.weight)
  const c = await freshCase({ activityId, requireOpenShiftForSales: false })
  const st = c.st

  st().addSupplier({ nameAr: 'مورد المسح', phone: '', taxNumber: '', address: '', notes: '', isActive: true })
  st().addItem({
    nameAr: 'صنف المسح', categoryId: null, unit: soldByWeight ? 'كجم' : 'قطعة', priceMinor: 2500,
    barcode: '6281000000017', sku: 'SWEEP-1', isActive: true,
    trackExpiry, trackSerial, soldByWeight, isService: false, minSalePriceMinor: 0, costMinor: 0, stockQty: 0,
  })
  const item = st().items.find((row) => row.sku === 'SWEEP-1')
  assert.ok(item, `${c.label}: الصنف لم يُنشأ`)

  /* ① الشراء: يثبت التكلفة والرصيد وقيد 1103 */
  const serials = trackSerial ? Array.from({ length: 10 }, (_, index) => `SWEEP-IMEI-${index + 1}`) : []
  const purchaseLines = [{
    itemId: item.id, qty: 10, unitPriceMinor: 1000,
    ...(trackExpiry ? { expiryDate: '2099-12-31' } : {}),
    ...(trackSerial ? { serialsRaw: serials.join('\n') } : {}),
  }]
  st().postPurchase({
    supplierId: st().suppliers[0].id, date: '2026-11-17', treasury: '1101', notes: '', expenses: [], paidMinor: 10000,
    lines: purchaseLines,
  })
  assertInvariants(`شراء — ${c.label}`, c)
  assert.equal(st().items.find((row) => row.id === item.id).stockQty, 10, `${c.label}: رصيد الشراء`)

  /* ② البيع النقدي: الضريبة والخصم والتكلفة من نفس محرك الترحيل */
  st().openShift('كاشير المسح', 0)
  const line = {
    itemId: item.id, nameAr: item.nameAr, qty: 2, unitPriceMinor: 2500, unitCostMinor: 1000, discountPercent: 0, soldByWeight,
    ...(trackSerial ? { serials: serials.slice(0, 2) } : {}),
  }
  const sale = st().postSale({
    lines: [line], customerId: null, payment: 'cash', treasury: '1101',
    invoiceDiscountPercent: 0, taxPercent: 14, taxInclusive: true,
  })
  assertInvariants(`بيع — ${c.label}`, c)
  assert.equal(st().items.find((row) => row.id === item.id).stockQty, 8, `${c.label}: رصيد البيع`)
  assert.equal(sale.totals.totalMinor, 5000, `${c.label}: إجمالي البيع`)
  assert.equal(sale.totals.taxMinor, Math.round(5000 * 14 / 114), `${c.label}: ضريبة البيع`)

  /* ③ المرتجع: سليم يعود للمخزون بقيد عاكس — مع دليل الدفعة إن كان الصنف بصلاحية */
  const returnSpec = { lineIndex: 0, qty: 1, condition: 'resellable', ...(trackSerial ? { serials: [serials[0]] } : {}) }
  if (trackExpiry) {
    const soldBatch = st().sales.find((row) => row.id === sale.id).saleExpiryBatches?.[0]
    assert.ok(soldBatch, `${c.label}: فاتورة الصلاحية بلا دليل دفعة`)
    returnSpec.batchAllocations = [{ batchId: soldBatch.id, qty: 1 }]
  }
  st().postSaleReturn({ saleId: sale.id, lineSpecs: [returnSpec], refund: 'cash', reason: 'مسح الثوابت' })
  assertInvariants(`مرتجع — ${c.label}`, c)
  assert.equal(st().items.find((row) => row.id === item.id).stockQty, 9, `${c.label}: رصيد المرتجع`)
  st().closeShift(0)

  table.push({
    activity: activityId,
    label: template.nameAr,
    entries: st().journal.length,
    features: [...features].filter((f) => [FEATURE.expiry, FEATURE.serial, FEATURE.weight].includes(f)).join('+') || '—',
  })
  R.ok(`${template.nameAr}: شراء/بيع/مرتجع — ${table[table.length - 1].entries} قيداً وميزان متزن`)
}

R.section('الخلاصة')
console.log(`  الأنشطة الممسوحة: ${table.length}`)
console.log(`  الأنشطة ذات صلاحية/سيريال/وزن: ${table.filter((row) => row.features !== '—').length}`)
assert.equal(table.length, ACTIVITY_TEMPLATES.length, 'نشاط لم يُمسح')
R.done()
