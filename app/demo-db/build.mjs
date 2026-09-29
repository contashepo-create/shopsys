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
  const insertPurchaseLine = db.prepare('INSERT INTO purchase_lines (activity, purchase_ref, item_ref, qty, unit_price_minor) VALUES (?,?,?,?,?)')

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
        insertPurchaseLine.run(activity.id, purchase.ref, line.item_ref, line.qty, line.unit_price_minor)
    }
    for (const sale of activity.sales ?? []) {
      insertSale.run(activity.id, sale.ref, sale.doc_date, sale.customer_ref ?? '', sale.warehouse_ref ?? '', sale.payment ?? 'cash', sale.paid_minor ?? 0, sale.treasury_ref ?? '', sale.notes ?? '')
      for (const line of sale.lines ?? [])
        insertSaleLine.run(activity.id, sale.ref, line.item_ref, line.qty, line.unit_price_minor, line.discount_percent ?? 0)
    }
  })
  db.exec('COMMIT')

  const counts = Object.fromEntries(
    ['activities', 'branches', 'warehouses', 'treasuries', 'payment_terminals', 'categories', 'items', 'customers', 'suppliers', 'sales', 'sale_lines', 'purchases', 'purchase_lines']
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
