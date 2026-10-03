/**
 * تفريغ حمولات الأنشطة من قاعدة البيانات التجريبية إلى JSON قابل للقراءة.
 *
 *   node demo-db/dump.mjs          # يكتب demo-db/demo-payloads.json
 *
 * الغرض: اختبارات الواجهة (jsdom) لا تستطيع استيراد node:sqlite — فتقرأ هذه
 * الحمولة الجاهزة بدل قاعدة البيانات مباشرة. `build.mjs` يستدعي نفس التفريغ
 * تلقائياً بعد كل بناء فتبقى الحمولة مطابقة للبذرة دائماً.
 */
import { DatabaseSync } from 'node:sqlite'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { DB_PATH } from './build.mjs'

const here = dirname(fileURLToPath(import.meta.url))
export const PAYLOADS_PATH = join(here, 'demo-payloads.json')

const TABLES = ['branches', 'warehouses', 'treasuries', 'payment_terminals', 'categories', 'items', 'customers', 'suppliers', 'sales', 'sale_lines', 'purchases', 'purchase_lines', 'employees', 'attendance_records', 'leave_requests', 'payroll_months', 'quotations', 'quotation_lines', 'purchase_orders', 'purchase_order_lines', 'wastage_docs', 'wastage_lines', 'cost_centers', 'equipment', 'rental_contracts', 'equipment_costs', 'sub_contracts', 'project_extracts', 'contracting_docs']

/** يقرأ نشاطاً كاملاً بنفس شكل /__demo/data (واجهة إضافة Vite) */
export function readActivityPayload(db, activity) {
  const rows = (table) => db.prepare(`SELECT * FROM ${table} WHERE activity = ?`).all(activity)
  const withLines = (docTable, lineTable, key) =>
    rows(docTable).map((doc) => ({ ...doc, lines: db.prepare(`SELECT * FROM ${lineTable} WHERE activity = ? AND ${key} = ?`).all(activity, doc.ref) }))
  return {
    activity: db.prepare('SELECT * FROM activities WHERE id = ?').get(activity),
    branches: rows('branches'),
    warehouses: rows('warehouses'),
    treasuries: rows('treasuries'),
    terminals: rows('payment_terminals'),
    categories: rows('categories'),
    items: rows('items'),
    customers: rows('customers'),
    suppliers: rows('suppliers'),
    costCenters: rows('cost_centers'),
    employees: rows('employees'),
    attendance: rows('attendance_records'),
    leaves: rows('leave_requests'),
    payrollMonths: rows('payroll_months'),
    quotations: withLines('quotations', 'quotation_lines', 'quotation_ref'),
    purchaseOrders: withLines('purchase_orders', 'purchase_order_lines', 'order_ref'),
    wastage: withLines('wastage_docs', 'wastage_lines', 'doc_ref'),
    equipment: rows('equipment'),
    rentalContracts: rows('rental_contracts'),
    equipmentCosts: rows('equipment_costs'),
    subContracts: rows('sub_contracts'),
    projectExtracts: rows('project_extracts'),
    contractingDocs: db.prepare('SELECT * FROM contracting_docs WHERE activity = ? ORDER BY sort_order').all(activity),
    sales: withLines('sales', 'sale_lines', 'sale_ref'),
    purchases: withLines('purchases', 'purchase_lines', 'purchase_ref'),
  }
}

/** يفرّغ كل الأنشطة إلى كائن {id: payload} */
export function dumpPayloads(db) {
  const out = {}
  for (const row of db.prepare('SELECT id FROM activities ORDER BY sort_order').all()) out[row.id] = readActivityPayload(db, row.id)
  return out
}

if (process.argv[1] && process.argv[1].endsWith('dump.mjs')) {
  const db = new DatabaseSync(DB_PATH)
  const payloads = dumpPayloads(db)
  db.close()
  writeFileSync(PAYLOADS_PATH, JSON.stringify(payloads, null, 1) + '\n')
  console.log(`✅ حُرِّرت حمولات الأنشطة: ${PAYLOADS_PATH}`)
  for (const [id, payload] of Object.entries(payloads))
    console.log(`   • ${id}: ${payload.items.length} صنفاً · ${payload.contractingDocs.length} مستند مقاولة · ${payload.sales.length} بيع · ${payload.purchases.length} شراء`)
}
