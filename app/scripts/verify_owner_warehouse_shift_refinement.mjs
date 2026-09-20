#!/usr/bin/env node
/**
 * فحص دائم — مراجعة المالك:
 * - لا معلومات ضريبية غير عملية في الهيدر بجانب مؤشر الاتصال.
 * - لا «مخزن غير محدد» في الفواتير؛ الشراء المختلط يختار المخزن لكل سطر.
 * - صفحة المخازن تفتح محتويات المخزن بالضغط المزدوج مع فلترة.
 * - صفحة الأصناف تُفلتر حسب المخزن، وكارت الصنف يفتح بالضغط المزدوج ويدعم مخزن/فترة/مستخدم.
 * - إقفال وردية بها عجز/زيادة يُختم باعتماد مشرف.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
let pass = 0
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log(`  ✓ ${msg}`) }

console.log('\n═══ تهذيب الضريبة والمخازن والورديات ═══')
const header = read('src/ui/layout/Header.tsx')
const purchases = read('src/ui/pages/PurchasesPage.tsx')
const pos = read('src/ui/pages/PosPage.tsx')
const general = read('src/ui/pages/GeneralSettingsPage.tsx')
const warehouses = read('src/ui/pages/WarehousesPage.tsx')
const items = read('src/ui/pages/ItemsPage.tsx')
const transfers = read('src/core/transfers.ts')
const repo = read('src/data/repo.ts')
const shifts = read('src/core/shifts.ts')
const shiftsPage = read('src/ui/pages/ShiftsPage.tsx')
const itemLedger = read('src/core/itemLedger.ts')

ok(!header.includes('country.vatPercent') && !header.includes('ضريبة ${country.vatPercent'), 'الهيدر لا يعرض معلومة ضريبة بجانب مؤشر الاتصال')
ok(!purchases.includes('مخزن غير محدد') && !pos.includes('مخزن غير محدد') && !general.includes('مخزن غير محدد'), 'لا يوجد اختيار مخزن غير محدد في الشراء/الكاشير/الإعدادات')
ok(purchases.includes('تحديد المخزن لكل سطر') && purchases.includes('lineWarehouseMode') && purchases.includes('warehouseId: lineWarehouseMode'), 'فاتورة الشراء المختلطة تُظهر خانة مخزن لكل سطر وتحفظها')
ok(repo.includes('warehouseId?: number | null') && repo.includes('warehouseId: inv.lines[i]?.warehouseId'), 'طبقة البيانات تحفظ مخزن سطر الشراء')
ok(transfers.includes('lines: { itemId: number; qty: number; warehouseId?: number | null }') && transfers.includes('l.warehouseId ?? p.warehouseId'), 'حساب أرصدة المخازن يقرأ مخزن السطر قبل مخزن الفاتورة')

ok(warehouses.includes('onDoubleClick') && warehouses.includes('محتويات مخزن') && warehouses.includes('فلترة بالاسم أو SKU أو الباركود'), 'صفحة المخازن تفتح محتويات المخزن بالضغط المزدوج مع فلترة')
ok(items.includes('warehouseFilter') && items.includes('stockInWarehouse') && items.includes('onDoubleClick={() => openItemCard(it)}'), 'صفحة الأصناف تدعم فلتر مخزن وفتح كارت الصنف بالضغط المزدوج')
ok(items.includes('ledgerWarehouseId') && items.includes('ledgerUser') && items.includes('shownLedgerRows'), 'كارت الصنف يدعم فلترة مخزن/مستخدم/فترة')
ok(itemLedger.includes('warehouseId?: number | null') && itemLedger.includes('userName?: string | null') && itemLedger.includes('transfers?:'), 'نواة كارت الصنف تحمل المخزن والمستخدم والتحويلات')

ok(shifts.includes('closeApprovedBy?: string | null') && repo.includes('closeShift: (countedCashMinor, closeApprovedBy'), 'الوردية تحفظ اسم معتمد الإقفال عند وجود فرق')
ok(shiftsPage.includes('closeApproval.request') && shiftsPage.includes('projectedVariance === 0') && shiftsPage.includes('باعتماد مشرف'), 'إقفال وردية بها عجز/زيادة يطلب اعتماد مشرف')

console.log(`\n✅ فحص تهذيب الضريبة والمخازن والورديات: ${pass} محطات — كلها خضراء\n`)
