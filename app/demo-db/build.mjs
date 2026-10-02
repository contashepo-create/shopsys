/**
 * بناء قاعدة البيانات التجريبية الحقيقية: app/demo-db/demo.sqlite
 *
 *   node --experimental-sqlite demo-db/build.mjs          # يعيد البناء من seed.data.mjs
 *   npm run demo:build
 *
 * يستعمل وحدة node:sqlite المدمجة (Node 22) — بلا أي اعتماد خارجي.
 * القاعدة الناتجة ملف SQLite عادي: افتحها بأي أداة (DB Browser/sqlite3) وعدّلها،
 * أو عدّلها من داخل التطبيق عبر لوحة «بيانات تجريبية» في وضع التطوير.
 */
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, existsSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { DEMO_ACTIVITIES } from './seed.data.mjs'

const here = dirname(fileURLToPath(import.meta.url))
export const DB_PATH = join(here, 'demo.sqlite')
const SCHEMA_PATH = join(here, 'schema.sql')

export function buildDemoDatabase(target = DB_PATH) {
  if (existsSync(target)) rmSync(target)
  const db = new DatabaseSync(target)
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'))

  const insertActivity = db.prepare('INSERT INTO activities (id, name_ar, shop_name, owner_name, city, phone, note, sort_order) VALUES (?,?,?,?,?,?,?,?)')
  const insertBranch = db.prepare('INSERT INTO branches (activity, ref, name_ar, city, phone, is_main) VALUES (?,?,?,?,?,?)')
  const insertWarehouse = db.prepare('INSERT INTO warehouses (activity, ref, name_ar, branch_ref, is_main) VALUES (?,?,?,?,?)')
  const insertTreasury = db.prepare('INSERT INTO treasuries (activity, ref, name_ar, kind, parent_ref, bank_name, account_no, branch_ref, opening_minor) VALUES (?,?,?,?,?,?,?,?,?)')
  const insertTerminal = db.prepare('INSERT INTO payment_terminals (activity, code, name_ar, provider_name, branch_ref, settlement_ref, terminal_id, merchant_id, serial_number, status) VALUES (?,?,?,?,?,?,?,?,?,?)')
  const insertCategory = db.prepare('INSERT INTO categories (activity, ref, name_ar) VALUES (?,?,?)')
  const insertItem = db.prepare(`INSERT INTO items
    (activity, ref, name_ar, sku, barcode, category_ref, base_unit, extra_units, cost_minor, price_minor, stock_qty, min_qty,
     is_service, track_expiry, track_serial, sold_by_weight, warranty_months, colors, sizes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  const insertCustomer = db.prepare('INSERT INTO customers (activity, ref, name_ar, phone, credit_limit_minor, notes) VALUES (?,?,?,?,?,?)')
  const insertSupplier = db.prepare('INSERT INTO suppliers (activity, ref, name_ar, phone, notes) VALUES (?,?,?,?,?)')
  const insertSale = db.prepare('INSERT INTO sales (activity, ref, doc_date, customer_ref, warehouse_ref, payment, paid_minor, treasury_ref, notes) VALUES (?,?,?,?,?,?,?,?,?)')
  const insertSaleLine = db.prepare('INSERT INTO sale_lines (activity, sale_ref, item_ref, qty, unit_price_minor, discount_percent) VALUES (?,?,?,?,?,?)')
  const insertPurchase = db.prepare('INSERT INTO purchases (activity, ref, doc_date, supplier_ref, warehouse_ref, supplier_doc, paid_minor, treasury_ref, notes) VALUES (?,?,?,?,?,?,?,?,?)')
  const insertPurchaseLine = db.prepare('INSERT INTO purchase_lines (activity, purchase_ref, item_ref, qty, unit_price_minor, expiry_date) VALUES (?,?,?,?,?,?)')
  /* ─── توسعة المرحلة ⑥: موارد بشرية ومستندات تجارية ─── */
  const insertEmployee = db.prepare('INSERT INTO employees (activity, ref, name_ar, phone, job_title, hire_date, base_salary_minor, allowances_minor, active, notes) VALUES (?,?,?,?,?,?,?,?,?,?)')
  const insertAttendance = db.prepare('INSERT INTO attendance_records (activity, ref, employee_ref, date, status, check_in, check_out, notes) VALUES (?,?,?,?,?,?,?,?)')
  const insertLeave = db.prepare('INSERT INTO leave_requests (activity, ref, employee_ref, type_id, from_date, to_date, status, reason) VALUES (?,?,?,?,?,?,?,?)')
  const insertPayrollMonth = db.prepare('INSERT INTO payroll_months (activity, ref, month, pay_employee_refs, treasury_ref) VALUES (?,?,?,?,?)')
  const insertQuotation = db.prepare('INSERT INTO quotations (activity, ref, kind, client_name, client_ref, title_ar, valid_until, status, win_probability, bid_bond_minor, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
  const insertQuotationLine = db.prepare('INSERT INTO quotation_lines (activity, quotation_ref, name_ar, description_ar, unit_ar, qty, unit_price_minor, est_cost_minor, vat_percent, tax_included) VALUES (?,?,?,?,?,?,?,?,?,?)')
  const insertPurchaseOrder = db.prepare('INSERT INTO purchase_orders (activity, ref, supplier_ref, order_date, expected_date, warehouse_ref, notes) VALUES (?,?,?,?,?,?,?)')
  const insertPurchaseOrderLine = db.prepare('INSERT INTO purchase_order_lines (activity, order_ref, item_ref, qty, unit_price_minor, vat_percent) VALUES (?,?,?,?,?,?)')
  const insertWastageDoc = db.prepare('INSERT INTO wastage_docs (activity, ref, doc_date, reason, notes) VALUES (?,?,?,?,?)')
  const insertWastageLine = db.prepare('INSERT INTO wastage_lines (activity, doc_ref, item_ref, qty) VALUES (?,?,?,?)')
  /* ─── تعميق المرحلة ⑥: معدات وعقود إيجار ومقاولو باطن ومستخلصات ─── */
  const insertEquipment = db.prepare('INSERT INTO equipment (activity, ref, name_ar, code, daily_rate_minor, hourly_rate_minor, monthly_rate_minor, meter_reading, service_every_hours, notes) VALUES (?,?,?,?,?,?,?,?,?,?)')
  const insertRentalContract = db.prepare('INSERT INTO rental_contracts (activity, ref, customer_ref, equipment_ref, days, daily_rate_minor, deposit_minor, payment, paid_minor, vat_percent, start_date, notes, close_deduct_minor, close_end_date, treasury_ref) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  const insertCostCenter = db.prepare('INSERT INTO cost_centers (activity, ref, code, name_ar, parent_ref, is_active, notes) VALUES (?,?,?,?,?,?,?)')
  const insertEquipmentCost = db.prepare('INSERT INTO equipment_costs (activity, ref, equipment_ref, date, kind, amount_minor, description, treasury_ref) VALUES (?,?,?,?,?,?,?,?)')
  const insertSubContract = db.prepare('INSERT INTO sub_contracts (activity, ref, quotation_ref, contractor_name, supplier_ref, scope_ar, contract_value_minor, retention_percent, tax_withhold_percent, advance_percent, start_date, advance_minor, advance_treasury_ref, certificate_amount_minor, certificate_description) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  const insertProjectExtract = db.prepare('INSERT INTO project_extracts (activity, ref, quotation_ref, percent, vat_percent, payment, description, treasury_ref) VALUES (?,?,?,?,?,?,?,?)')

  db.exec('BEGIN')
  DEMO_ACTIVITIES.forEach((activity, order) => {
    insertActivity.run(activity.id, activity.name_ar, activity.shop_name, activity.owner_name, activity.city ?? 'المنصورة', activity.phone ?? '01000000000', activity.note ?? '', order)
    for (const branch of activity.branches ?? [])
      insertBranch.run(activity.id, branch.ref, branch.name_ar, branch.city ?? '', branch.phone ?? '', branch.is_main ? 1 : 0)
    for (const warehouse of activity.warehouses ?? [])
      insertWarehouse.run(activity.id, warehouse.ref, warehouse.name_ar, warehouse.branch_ref ?? '', warehouse.is_main ? 1 : 0)
    for (const treasury of activity.treasuries ?? [])
      insertTreasury.run(activity.id, treasury.ref, treasury.name_ar, treasury.kind, treasury.parent_ref ?? '', treasury.bank_name ?? '', treasury.account_no ?? '', treasury.branch_ref ?? '', treasury.opening_minor ?? 0)
    for (const terminal of activity.terminals ?? [])
      insertTerminal.run(activity.id, terminal.code, terminal.name_ar, terminal.provider_name, terminal.branch_ref ?? '', terminal.settlement_ref ?? '', terminal.terminal_id, terminal.merchant_id ?? '', terminal.serial_number ?? '', terminal.status ?? 'active')
    for (const category of activity.categories ?? [])
      insertCategory.run(activity.id, category.ref, category.name_ar)
    for (const row of activity.items ?? [])
      insertItem.run(
        activity.id, row.ref, row.name_ar, row.sku ?? '', row.barcode ?? '', row.category_ref ?? '', row.base_unit ?? 'قطعة', row.extra_units ?? '',
        row.cost_minor ?? 0, row.price_minor ?? 0, row.stock_qty ?? 0, row.min_qty ?? 0,
        row.is_service ? 1 : 0, row.track_expiry ? 1 : 0, row.track_serial ? 1 : 0, row.sold_by_weight ? 1 : 0, row.warranty_months ?? 0,
        row.colors ?? '', row.sizes ?? '',
      )
    for (const customer of activity.customers ?? [])
      insertCustomer.run(activity.id, customer.ref, customer.name_ar, customer.phone ?? '', customer.credit_limit_minor ?? 0, customer.notes ?? '')
    for (const supplier of activity.suppliers ?? [])
      insertSupplier.run(activity.id, supplier.ref, supplier.name_ar, supplier.phone ?? '', supplier.notes ?? '')
    for (const purchase of activity.purchases ?? []) {
      insertPurchase.run(activity.id, purchase.ref, purchase.doc_date, purchase.supplier_ref ?? '', purchase.warehouse_ref ?? '', purchase.supplier_doc ?? '', purchase.paid_minor ?? 0, purchase.treasury_ref ?? '', purchase.notes ?? '')
      for (const line of purchase.lines ?? [])
        insertPurchaseLine.run(activity.id, purchase.ref, line.item_ref, line.qty, line.unit_price_minor, line.expiry_date ?? '')
    }
    for (const employee of activity.employees ?? [])
      insertEmployee.run(activity.id, employee.ref, employee.name_ar, employee.phone ?? '', employee.job_title ?? '', employee.hire_date ?? '', employee.base_salary_minor ?? 0, employee.allowances_minor ?? 0, employee.active === false ? 0 : 1, employee.notes ?? '')
    for (const row of activity.attendance ?? [])
      insertAttendance.run(activity.id, row.ref, row.employee_ref, row.date, row.status ?? 'present', row.check_in ?? '', row.check_out ?? '', row.notes ?? '')
    for (const row of activity.leaves ?? [])
      insertLeave.run(activity.id, row.ref, row.employee_ref, row.type_id ?? 'annual', row.from_date, row.to_date, row.status ?? 'approved', row.reason ?? '')
    for (const row of activity.payroll_months ?? [])
      insertPayrollMonth.run(activity.id, row.ref, row.month, row.pay_employee_refs ?? '', row.treasury_ref ?? '')
    for (const quotation of activity.quotations ?? []) {
      insertQuotation.run(activity.id, quotation.ref, quotation.kind ?? 'quotation', quotation.client_name, quotation.client_ref ?? '', quotation.title_ar, quotation.valid_until ?? '', quotation.status ?? 'draft', quotation.win_probability ?? 50, quotation.bid_bond_minor ?? 0, quotation.notes ?? '')
      for (const line of quotation.lines ?? [])
        insertQuotationLine.run(activity.id, quotation.ref, line.name_ar ?? '', line.description_ar, line.unit_ar ?? 'مقطوعية', line.qty ?? 1, line.unit_price_minor ?? 0, line.est_cost_minor ?? 0, line.vat_percent ?? 0, line.tax_included ? 1 : 0)
    }
    for (const order of activity.purchase_orders ?? []) {
      insertPurchaseOrder.run(activity.id, order.ref, order.supplier_ref ?? '', order.order_date, order.expected_date ?? '', order.warehouse_ref ?? '', order.notes ?? '')
      for (const line of order.lines ?? [])
        insertPurchaseOrderLine.run(activity.id, order.ref, line.item_ref, line.qty, line.unit_price_minor ?? 0, line.vat_percent ?? 0)
    }
    for (const doc of activity.wastage ?? []) {
      insertWastageDoc.run(activity.id, doc.ref, doc.doc_date, doc.reason ?? 'انتهاء صلاحية', doc.notes ?? '')
      for (const line of doc.lines ?? [])
        insertWastageLine.run(activity.id, doc.ref, line.item_ref, line.qty)
    }
    for (const row of activity.cost_centers ?? [])
      insertCostCenter.run(activity.id, row.ref, row.code, row.name_ar, row.parent_ref ?? '', row.is_active === false ? 0 : 1, row.notes ?? '')
    for (const row of activity.equipment ?? [])
      insertEquipment.run(activity.id, row.ref, row.name_ar, row.code ?? '', row.daily_rate_minor ?? 0, row.hourly_rate_minor ?? 0, row.monthly_rate_minor ?? 0, row.meter_reading ?? 0, row.service_every_hours ?? 0, row.notes ?? '')
    for (const row of activity.rental_contracts ?? [])
      insertRentalContract.run(activity.id, row.ref, row.customer_ref ?? '', row.equipment_ref, row.days, row.daily_rate_minor, row.deposit_minor ?? 0, row.payment ?? 'cash', row.paid_minor ?? 0, row.vat_percent ?? 0, row.start_date ?? '', row.notes ?? '', row.close_deduct_minor ?? 0, row.close_end_date ?? '', row.treasury_ref ?? '')
    for (const row of activity.equipment_costs ?? [])
      insertEquipmentCost.run(activity.id, row.ref, row.equipment_ref, row.date, row.kind ?? 'fuel', row.amount_minor, row.description ?? '', row.treasury_ref ?? '')
    for (const row of activity.sub_contracts ?? [])
      insertSubContract.run(activity.id, row.ref, row.quotation_ref ?? '', row.contractor_name, row.supplier_ref ?? '', row.scope_ar, row.contract_value_minor, row.retention_percent ?? 5, row.tax_withhold_percent ?? 0, row.advance_percent ?? 0, row.start_date ?? '', row.advance_minor ?? 0, row.advance_treasury_ref ?? '', row.certificate_amount_minor ?? 0, row.certificate_description ?? '')
    for (const row of activity.project_extracts ?? [])
      insertProjectExtract.run(activity.id, row.ref, row.quotation_ref ?? '', row.percent ?? 0, row.vat_percent ?? 14, row.payment ?? 'credit', row.description ?? '', row.treasury_ref ?? '')
    for (const sale of activity.sales ?? []) {
      insertSale.run(activity.id, sale.ref, sale.doc_date, sale.customer_ref ?? '', sale.warehouse_ref ?? '', sale.payment ?? 'cash', sale.paid_minor ?? 0, sale.treasury_ref ?? '', sale.notes ?? '')
      for (const line of sale.lines ?? [])
        insertSaleLine.run(activity.id, sale.ref, line.item_ref, line.qty, line.unit_price_minor, line.discount_percent ?? 0)
    }
  })
  db.exec('COMMIT')

  const counts = Object.fromEntries(
    ['activities', 'branches', 'warehouses', 'treasuries', 'payment_terminals', 'categories', 'items', 'customers', 'suppliers', 'sales', 'sale_lines', 'purchases', 'purchase_lines', 'employees', 'attendance_records', 'leave_requests', 'payroll_months', 'quotations', 'quotation_lines', 'purchase_orders', 'purchase_order_lines', 'wastage_docs', 'wastage_lines', 'cost_centers', 'equipment', 'rental_contracts', 'equipment_costs', 'sub_contracts', 'project_extracts']
      .map((table) => [table, db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n]),
  )
  db.close()
  return counts
}

if (process.argv[1] && process.argv[1].endsWith('build.mjs')) {
  const counts = buildDemoDatabase()
  console.log('✅ قاعدة البيانات التجريبية جاهزة:', DB_PATH)
  for (const [table, n] of Object.entries(counts)) console.log(`   • ${table}: ${n}`)
}
