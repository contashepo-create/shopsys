#!/usr/bin/env node
/**
 * verify_items — فحص نموذج الأصناف المعمَّم ونظام وراثة الخصائص
 * node --experimental-strip-types scripts/verify_items.mjs
 */
import { strict as assert } from 'node:assert'
import { validateItem, nextSku, draftFromCategory, categoryPath, categoryDescendants } from '../src/core/items.ts'

let passed = 0
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`) }
  catch (e) { console.error(`  ❌ ${name}: ${e.message}`); process.exitCode = 1 }
}

console.log('🔍 فحص نموذج الأصناف (items.ts)')

const groceryCat = { id: 1, nameAr: 'ألبان', features: ['expiry_batches', 'weight_scale', 'multi_unit'] }
const mobileCat = { id: 2, nameAr: 'موبايلات', features: ['serial_warranty', 'variants'] }

ok('الوراثة: قسم أغذية → الوزن مفعل والوحدة كجم، والصلاحية اختيارية', () => {
  const d = draftFromCategory(groceryCat, 'ITM-1001')
  assert.equal(d.trackExpiry, false)
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
  const errs = validateItem(d, []).filter((e) => !e.startsWith('تنبيه'))
  assert.equal(errs.length, 0)
  assert.equal(d.trackExpiry, false) // الصلاحية اختيارية ولا تُفرض من القسم
})

ok('تنبيه (غير مانع) عند سعر بيع صفر — درس خطأ الكاشير', () => {
  const d = { ...draftFromCategory(groceryCat, 'X'), nameAr: 'بلا سعر', priceMinor: 0 }
  const errs = validateItem(d, [])
  assert.ok(errs.some((e) => e.startsWith('تنبيه') && e.includes('صفر')))
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

console.log('🔍 فحص الأقسام الهرمية (رئيسي/فرعي)')

const tree = [
  { id: 1, nameAr: 'أغذية', parentId: null, features: ['expiry_batches'] },
  { id: 2, nameAr: 'ألبان', parentId: 1, features: ['expiry_batches'] },
  { id: 3, nameAr: 'أجبان', parentId: 2, features: ['expiry_batches', 'weight_scale'] },
  { id: 4, nameAr: 'أجهزة', parentId: null, features: ['serial_warranty'] },
]

ok('المسار الكامل: أغذية ← ألبان ← أجبان', () => {
  assert.equal(categoryPath(tree[2], tree), 'أغذية ← ألبان ← أجبان')
  assert.equal(categoryPath(tree[0], tree), 'أغذية')
})

ok('الفلترة الهرمية: اختيار «أغذية» يشمل ألبان وأجبان', () => {
  assert.deepEqual(categoryDescendants(1, tree).sort(), [1, 2, 3])
  assert.deepEqual(categoryDescendants(4, tree), [4])
})

ok('حماية من الحلقات اللانهائية في شجرة فاسدة', () => {
  const bad = [
    { id: 1, nameAr: 'أ', parentId: 2, features: [] },
    { id: 2, nameAr: 'ب', parentId: 1, features: [] },
  ]
  // لا يعلّق — يخرج بأمان
  categoryPath(bad[0], bad)
  categoryDescendants(1, bad)
  assert.ok(true)
})

console.log(`\n${process.exitCode ? '💥 فشل الفحص' : `🎉 نجح الفحص — ${passed} اختباراً`}`)
