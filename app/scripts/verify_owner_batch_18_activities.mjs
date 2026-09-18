/**
 * المراجعة الشاملة لدفعة المالك على مستوى كل الأنشطة الـ18 (متجر نظيف لكل نشاط):
 * لكل نشاط على حدة:
 * ① شراء → بيع بكمية عشرية (0.25) → القيد متوازن والإجماليات صحيحة (نقطة POS العشري)
 * ② صرف داخلي بغرض حر خاص بالنشاط → قيد 5114/1103 متوازن + خصم الرصيد
 * ③ مورد بتصنيف حر خاص بالنشاط → يُحفظ كما كُتب
 * ④ طباعة الفاتورة بالقوالب الثلاثة (حراري/A4/A5) — HTML سليم لكل نشاط بإعداداته
 * ⑤ دور مخصص «مشرف {النشاط}» باعتماد المرتجع → approveByPin يقبل رقمه
 * ⑥ إشعار الصلاحية: expired → /inventory/wastage و near → /reports
 * تشغيل: node --experimental-strip-types scripts/verify_owner_batch_18_activities.mjs
 */
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { webcrypto } from 'node:crypto'
if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() { return mem.size },
}
globalThis.window = { localStorage: globalThis.localStorage, addEventListener: () => {}, dispatchEvent: () => true }

const { ACTIVITY_TEMPLATES } = await import(join(root, 'src/core/activities.ts'))
const { assertBalanced } = await import(join(root, 'src/core/ledger.ts'))
const { computeTotals, lineTotal } = await import(join(root, 'src/core/pos.ts'))
const { buildReceiptModel, DEFAULT_RECEIPT_SETTINGS } = await import(join(root, 'src/core/receipt.ts'))
const { renderInvoiceA4Html } = await import(join(root, 'src/ui/print/printInvoiceA4.ts'))
const { renderReceiptHtml } = await import(join(root, 'src/ui/print/printReceipt.ts'))
const { collectNotifications } = await import(join(root, 'src/core/notifications.ts'))
const { rolesWithOverrides } = await import(join(root, 'src/core/permissions.ts'))
const { REFUND_APPROVE_PERM } = await import(join(root, 'src/core/refundApproval.ts'))
const { hashPin } = await import(join(root, 'src/core/audit.ts'))

const ACTIVITIES = ACTIVITY_TEMPLATES.map((a) => a.id)
assert.equal(ACTIVITIES.length, 18, `المتوقع 18 نشاطاً — الموجود ${ACTIVITIES.length}`)

const repoUrl = pathToFileURL(join(root, 'src/data/repo.ts')).href
const cur = { code: 'EGP', symbol: 'ج.م', decimals: 2, name: '' }
let pass = 0

for (const activityId of ACTIVITIES) {
  const tpl = ACTIVITY_TEMPLATES.find((a) => a.id === activityId)
  mem.clear()
  mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false,  done: true, countryCode: 'EG', activityId, vatPercent: 0, taxInclusive: true, allowNegativeTreasury: true }, license: { plan: 'pro' } }, version: 0 }))
  const { useDataStore } = await import(`${repoUrl}?batch18=${activityId}`)
  const st = () => useDataStore.getState()

  // ── ① صنف وزني + شراء + بيع بكمية 0.25 ──
  st().addItem({ nameAr: `خام ${tpl.nameAr}`, sku: `RAW-${activityId}`, barcodes: [], categoryId: 1, baseUnit: 'كجم', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 80_00, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: true, variantColors: [], variantSizes: [], isActive: true })
  const item = st().items.at(-1)
  st().addSupplier({ nameAr: `مورد ${tpl.nameAr}`, phone: '', notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })
  const sup = st().suppliers.at(-1)
  // ③ تصنيف حر خاص بالنشاط
  st().updateSupplier(sup.id, { category: `تصنيف خاص — ${tpl.nameAr}` })
  assert.equal(st().suppliers.find((s) => s.id === sup.id).category, `تصنيف خاص — ${tpl.nameAr}`, `${activityId}: التصنيف الحر`)

  st().postPurchase({ supplierId: sup.id, date: '2026-09-01', lines: [{ itemId: item.id, qty: 10, unitPriceMinor: 50_00 }], expenses: [], paidMinor: 0, notes: '' })
  const line = { itemId: item.id, nameAr: item.nameAr, qty: 0.25, unitPriceMinor: 80_00, unitCostMinor: 50_00, discountPercent: 0, soldByWeight: true }
  assert.equal(lineTotal(line), 20_00, `${activityId}: ربع كيلو × 80 = 20`)
  const totals = computeTotals([line], 0, 0, true)
  assert.equal(totals.totalMinor, 20_00, `${activityId}: إجمالي 0.25`)
  const sale = st().postSale({ lines: [line], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true })
  const saleEntry = st().journal.find((e) => e.id === sale.journalEntryId)
  assertBalanced(saleEntry.lines)
  const stockAfterSale = st().items.find((i) => i.id === item.id).stockQty
  assert.equal(stockAfterSale, 9.75, `${activityId}: الرصيد 10-0.25=9.75 — الموجود ${stockAfterSale}`)

  // ── ② صرف داخلي بغرض حر خاص بالنشاط ──
  const freePurpose = `تجهيز افتتاح ركن ${tpl.nameAr}`
  const doc = st().postConsumption({ purpose: freePurpose, expenseAccount: '5114', lines: [{ itemId: item.id, qty: 1.5 }], notes: '' })
  assert.equal(doc.purpose, freePurpose, `${activityId}: الغرض الحر`)
  assertBalanced(st().journal.find((e) => e.id === doc.journalEntryId).lines)
  assert.equal(st().items.find((i) => i.id === item.id).stockQty, 8.25, `${activityId}: 9.75-1.5=8.25`)

  // ── ④ الطباعة بالقوالب الثلاثة بإعدادات النشاط ──
  const settings = { ...DEFAULT_RECEIPT_SETTINGS, shopName: `متجر ${tpl.nameAr}`, defaultTemplate: tpl.defaultInvoiceTemplate }
  const model = buildReceiptModel({ invoiceNumber: sale.invoiceNumber, dateIso: sale.date, lines: [line], totals: sale.totals, payment: 'cash', customerName: null, taxPercent: 0, taxInclusive: true, settings })
  const thermal = renderReceiptHtml(model, cur, settings)
  const a4 = renderInvoiceA4Html(model, cur, settings)
  const a5 = renderInvoiceA4Html(model, cur, settings, 'a5')
  assert.ok(thermal.includes(sale.invoiceNumber), `${activityId}: حراري يحمل رقم الفاتورة`)
  assert.ok(a4.includes('size: A4') && a4.includes(`متجر ${tpl.nameAr}`), `${activityId}: A4 سليم`)
  assert.ok(a5.includes('size: A5') && a5.includes('margin: 7mm') && a5.includes(sale.invoiceNumber), `${activityId}: A5 سليم`)

  // ── ⑤ دور مخصص «مشرف النشاط» + approveByPin ──
  st().setOwnerPin(await hashPin('1111'))
  st().addEmployee({ nameAr: `مشرف ${tpl.nameAr}`, phone: `01${String(Math.abs(activityId.length * 7919)).padStart(8, '0')}`, jobTitle: 'مشرف', hireDate: '2026-01-01', baseSalaryMinor: 500000, allowancesMinor: 0, active: true, notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })
  const emp = st().employees.at(-1)
  const roleId = st().addCustomRole(`مشرف ${tpl.nameAr}`, 'cashier')
  st().setRolePermissions(roleId, [...st().roleOverrides[roleId], REFUND_APPROVE_PERM])
  st().addAppUser({ nameAr: emp.nameAr, roleId, pinHash: await hashPin('9999'), employeeId: emp.id, phone: emp.phone, email: '', initialPin: '9999', mustChangePin: false })
  const approved = await st().approveByPin('9999', REFUND_APPROVE_PERM)
  assert.equal(approved.approvedBy, `مشرف ${tpl.nameAr}`, `${activityId}: اعتماد الدور المخصص`)
  const allRoles = rolesWithOverrides(st().roleOverrides, st().customRoles)
  assert.ok(allRoles.some((r) => r.id === roleId && r.permissions.includes(REFUND_APPROVE_PERM)), `${activityId}: الدور في القائمة الكاملة`)

  // ── ⑥ وجهة إشعار الصلاحية ──
  const ns = collectNotifications({
    batches: [
      { id: 1, itemId: item.id, qty: 2, expiryDate: '2026-01-01', purchasedAt: '2025-06-01' },
      { id: 2, itemId: item.id, qty: 3, expiryDate: '2026-10-01', purchasedAt: '2025-06-01' },
    ],
    itemName: () => item.nameAr,
    installmentPlans: [], customerName: () => '', fmt: (m) => String(m), openIssues: [],
    items: [], suppliers: [], purchases: [], vouchers: [], cheques: [],
    todayIso: '2026-09-18',
  })
  const expired = ns.find((n) => n.id === `exp:${item.id}:2026-01-01`)
  const soon = ns.find((n) => n.id === `exp:${item.id}:2026-10-01`)
  assert.equal(expired?.route, '/inventory/wastage', `${activityId}: المنتهي → الهوالك`)
  assert.equal(soon?.route, '/reports', `${activityId}: الموشك → التقارير`)

  pass++
  console.log(`  ✅ ${tpl.icon ?? ''} ${tpl.nameAr} (${activityId}) — عشري POS + صرف حر + تصنيف حر + 3 قوالب + مشرف مخصص + وجهات الإشعار`)
}

console.log(`\n══════════════════\n${pass}/18 نشاطاً اجتاز المراجعة الشاملة`)
if (pass !== 18) process.exit(1)
console.log('OWNER-BATCH-18-ACTIVITIES-OK ✅')
