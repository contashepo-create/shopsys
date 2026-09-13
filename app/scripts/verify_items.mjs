#!/usr/bin/env node
/**
 * verify_items — فحص نموذج الأصناف المعمَّم ونظام وراثة الخصائص
 * node --experimental-strip-types scripts/verify_items.mjs
 */
import { strict as assert } from 'node:assert'
import { validateItem, nextSku, draftFromCategory } from '../src/core/items.ts'

let passed = 0
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`) }
  catch (e) { console.error(`  ❌ ${name}: ${e.message}`); process.exitCode = 1 }
}

console.log('🔍 فحص نموذج الأصناف (items.ts)')

const groceryCat = { id: 1, nameAr: 'ألبان', features: ['expiry_batches', 'weight_scale', 'multi_unit'] }
const mobileCat = { id: 2, nameAr: 'موبايلات', features: ['serial_warranty', 'variants'] }

ok('الوراثة: قسم أغذية → صلاحية + وزن مفعلان والوحدة كجم', () => {
  const d = draftFromCategory(groceryCat, 'ITM-1001')
  assert.equal(d.trackExpiry, true)
  assert.equal(d.soldByWeight, true)
  assert.equal(d.trackSerial, false)
  assert.equal(d.baseUnit, 'كجم')
})

ok('الوراثة: قسم موبايلات → سيريال مفعل والوحدة قطعة', () => {
  const d = draftFromCategory(mobileCat, 'ITM-1002')
  assert.equal(d.trackSerial, true)
  assert.equal(d.trackExpiry, false)
  assert.equal(d.baseUnit, 'قطعة')
})

ok('التجاوز الفردي: غسالة بسيريال داخل هايبر أغذية (القرار 5)', () => {
  const d = draftFromCategory(groceryCat, 'ITM-1003')
  d.trackSerial = true // تجاوز يدوي
  d.soldByWeight = false
  d.nameAr = 'غسالة'
  d.baseUnit = 'قطعة'
  const errs = validateItem(d, [])
  assert.equal(errs.length, 0)
  assert.equal(d.trackExpiry, true) // ما زال يرث صلاحية القسم حتى يُعطَّل
})

const existing = [{
  id: 1, nameAr: 'لبن', sku: 'ITM-1001', barcodes: ['6221001'], categoryId: 1,
  baseUnit: 'قطعة', extraUnits: [{ nameAr: 'كرتونة', factor: 12, barcode: '6221002' }],
  costMinor: 100, priceMinor: 150, minQty: 0,
  trackExpiry: true, trackSerial: false, soldByWeight: false,
  variantColors: [], variantSizes: [], isActive: true,
}]

ok('رفض اسم فارغ', () => {
  const d = { ...draftFromCategory(groceryCat, 'X'), nameAr: '  ' }
  assert.ok(validateItem(d, []).some((e) => e.includes('اسم')))
})

ok('رفض تكرار الباركود عبر الأصناف', () => {
  const d = { ...draftFromCategory(groceryCat, 'X'), nameAr: 'جديد', barcodes: ['6221001'] }
  assert.ok(validateItem(d, existing).some((e) => e.includes('مستخدم')))
})

ok('رفض تكرار باركود وحدة إضافية أيضاً', () => {
  const d = { ...draftFromCategory(groceryCat, 'X'), nameAr: 'جديد', barcodes: ['6221002'] }
  assert.ok(validateItem(d, existing).some((e) => e.includes('مستخدم')))
})

ok('السماح بنفس الباركود عند تعديل نفس الصنف', () => {
  const { id: _id, ...rest } = existing[0]
  const errs = validateItem(rest, existing, 1)
  assert.equal(errs.filter((e) => !e.startsWith('تنبيه')).length, 0)
})

ok('رفض باركود مكرر داخل نفس الصنف', () => {
  const d = { ...draftFromCategory(groceryCat, 'X'), nameAr: 'جديد', barcodes: ['111', '111'] }
  assert.ok(validateItem(d, []).some((e) => e.includes('مكرر')))
})

ok('تنبيه (غير مانع) عند تكلفة أعلى من البيع', () => {
  const d = { ...draftFromCategory(groceryCat, 'X'), nameAr: 'خسران', costMinor: 200, priceMinor: 100 }
  const errs = validateItem(d, [])
  assert.ok(errs.some((e) => e.startsWith('تنبيه')))
})

ok('رفض اجتماع السيريال مع الوزن', () => {
  const d = { ...draftFromCategory(groceryCat, 'X'), nameAr: 'مستحيل', trackSerial: true, soldByWeight: true }
  assert.ok(validateItem(d, []).some((e) => e.includes('لا يجتمع')))
})

ok('رفض معامل وحدة ≤ 1', () => {
  const d = {
    ...draftFromCategory(groceryCat, 'X'), nameAr: 'كرتونة غلط',
    extraUnits: [{ nameAr: 'كرتونة', factor: 1 }],
  }
  assert.ok(validateItem(d, []).some((e) => e.includes('أكبر من 1')))
})

ok('توليد SKU تصاعدي', () => {
  assert.equal(nextSku(existing), 'ITM-1002')
  assert.equal(nextSku([]), 'ITM-1001')
})

console.log(`\n${process.exitCode ? '💥 فشل الفحص' : `🎉 نجح الفحص — ${passed} اختباراً`}`)
