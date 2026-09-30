/**
 * إضافة Vite لوضع التطوير فقط: تفتح قاعدة البيانات التجريبية الحقيقية
 * (app/demo-db/demo.sqlite) وتقدّمها للتطبيق عبر واجهة محلية، وتكتب التعديلات
 * إلى الملف نفسه — فالبيانات التجريبية «قابلة للتعديل» فعلاً لا للقراءة فقط.
 *
 *   GET  /__demo/activities            قائمة الأنشطة المتاحة وعدّاداتها
 *   GET  /__demo/data?activity=grocery كل بيانات النشاط (جداول مترابطة)
 *   POST /__demo/data                  حفظ تعديلات نشاط كامل في القاعدة
 *   POST /__demo/reset                 إعادة بناء القاعدة من seed.data.mjs
 *
 * لا شيء من هذا يدخل نسخة الإنتاج: الإضافة تعمل داخل configureServer فقط،
 * ونداءات المتصفح محروسة بـ import.meta.env.DEV.
 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const DB_PATH = join(here, 'demo.sqlite')

const TABLES = ['branches', 'warehouses', 'treasuries', 'payment_terminals', 'categories', 'items', 'customers', 'suppliers', 'sales', 'sale_lines', 'purchases', 'purchase_lines', 'employees', 'attendance_records', 'leave_requests', 'payroll_months', 'quotations', 'quotation_lines', 'purchase_orders', 'purchase_order_lines', 'wastage_docs', 'wastage_lines', 'equipment', 'rental_contracts', 'equipment_costs', 'sub_contracts', 'project_extracts']

function openDb() {
  if (!existsSync(DB_PATH)) return null
  return new DatabaseSync(DB_PATH)
}

function readActivity(db, activity) {
  const rows = (table, where = 'activity = ?', args = [activity]) => db.prepare(`SELECT * FROM ${table} WHERE ${where}`).all(...args)
  const info = db.prepare('SELECT * FROM activities WHERE id = ?').get(activity)
  if (!info) return null
  const sales = rows('sales')
  const purchases = rows('purchases')
  const quotations = rows('quotations')
  const purchaseOrders = rows('purchase_orders')
  return {
    activity: info,
    branches: rows('branches'),
    warehouses: rows('warehouses'),
    treasuries: rows('treasuries'),
    terminals: rows('payment_terminals'),
    categories: rows('categories'),
    items: rows('items'),
    customers: rows('customers'),
    suppliers: rows('suppliers'),
    employees: rows('employees'),
    attendance: rows('attendance_records'),
    leaves: rows('leave_requests'),
    payrollMonths: rows('payroll_months'),
    quotations: quotations.map((quotation) => ({ ...quotation, lines: db.prepare('SELECT * FROM quotation_lines WHERE activity = ? AND quotation_ref = ?').all(activity, quotation.ref) })),
    purchaseOrders: purchaseOrders.map((order) => ({ ...order, lines: db.prepare('SELECT * FROM purchase_order_lines WHERE activity = ? AND order_ref = ?').all(activity, order.ref) })),
    wastage: db.prepare('SELECT * FROM wastage_docs WHERE activity = ?').all(activity).map((doc) => ({ ...doc, lines: db.prepare('SELECT * FROM wastage_lines WHERE activity = ? AND doc_ref = ?').all(activity, doc.ref) })),
    equipment: rows('equipment'),
    rentalContracts: rows('rental_contracts'),
    equipmentCosts: rows('equipment_costs'),
    subContracts: rows('sub_contracts'),
    projectExtracts: rows('project_extracts'),
    sales: sales.map((sale) => ({ ...sale, lines: db.prepare('SELECT * FROM sale_lines WHERE activity = ? AND sale_ref = ?').all(activity, sale.ref) })),
    purchases: purchases.map((purchase) => ({ ...purchase, lines: db.prepare('SELECT * FROM purchase_lines WHERE activity = ? AND purchase_ref = ?').all(activity, purchase.ref) })),
  }
}

function listActivities(db) {
  return db.prepare('SELECT * FROM activities ORDER BY sort_order').all().map((row) => ({
    ...row,
    items: db.prepare('SELECT COUNT(*) AS n FROM items WHERE activity = ?').get(row.id).n,
    customers: db.prepare('SELECT COUNT(*) AS n FROM customers WHERE activity = ?').get(row.id).n,
    suppliers: db.prepare('SELECT COUNT(*) AS n FROM suppliers WHERE activity = ?').get(row.id).n,
    warehouses: db.prepare('SELECT COUNT(*) AS n FROM warehouses WHERE activity = ?').get(row.id).n,
    branches: db.prepare('SELECT COUNT(*) AS n FROM branches WHERE activity = ?').get(row.id).n,
    treasuries: db.prepare('SELECT COUNT(*) AS n FROM treasuries WHERE activity = ?').get(row.id).n,
    terminals: db.prepare('SELECT COUNT(*) AS n FROM payment_terminals WHERE activity = ?').get(row.id).n,
    sales: db.prepare('SELECT COUNT(*) AS n FROM sales WHERE activity = ?').get(row.id).n,
    purchases: db.prepare('SELECT COUNT(*) AS n FROM purchases WHERE activity = ?').get(row.id).n,
    employees: db.prepare('SELECT COUNT(*) AS n FROM employees WHERE activity = ?').get(row.id).n,
    quotations: db.prepare('SELECT COUNT(*) AS n FROM quotations WHERE activity = ?').get(row.id).n,
    purchaseOrders: db.prepare('SELECT COUNT(*) AS n FROM purchase_orders WHERE activity = ?').get(row.id).n,
  }))
}

/** كتابة نشاط كامل: تُحذف صفوفه القديمة ثم تُكتب الصفوف الواردة (تعديل حقيقي على الملف) */
function writeActivity(db, payload) {
  const activity = payload?.activity?.id
  if (!activity) throw new Error('النشاط غير محدد')
  db.exec('BEGIN')
  try {
    db.prepare('INSERT INTO activities (id, name_ar, shop_name, owner_name, city, phone, note, sort_order) VALUES (?,?,?,?,?,?,?,?)'
      + ' ON CONFLICT(id) DO UPDATE SET name_ar = excluded.name_ar, shop_name = excluded.shop_name, owner_name = excluded.owner_name, city = excluded.city, phone = excluded.phone, note = excluded.note')
      .run(activity, payload.activity.name_ar ?? activity, payload.activity.shop_name ?? '', payload.activity.owner_name ?? '', payload.activity.city ?? '', payload.activity.phone ?? '', payload.activity.note ?? '', payload.activity.sort_order ?? 0)
    for (const table of TABLES) db.prepare(`DELETE FROM ${table} WHERE activity = ?`).run(activity)
    const insertRows = (table, rows) => {
      for (const row of rows ?? []) {
        const data = { ...row, activity }
        delete data.id
        delete data.lines
        const keys = Object.keys(data)
        if (!keys.length) continue
        db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
          .run(...keys.map((key) => (typeof data[key] === 'boolean' ? (data[key] ? 1 : 0) : data[key] ?? '')))
      }
    }
    insertRows('branches', payload.branches)
    insertRows('warehouses', payload.warehouses)
    insertRows('treasuries', payload.treasuries)
    insertRows('payment_terminals', payload.terminals)
    insertRows('categories', payload.categories)
    insertRows('items', payload.items)
    insertRows('customers', payload.customers)
    insertRows('suppliers', payload.suppliers)
    for (const sale of payload.sales ?? []) {
      insertRows('sales', [sale])
      insertRows('sale_lines', (sale.lines ?? []).map((line) => ({ ...line, sale_ref: sale.ref })))
    }
    for (const purchase of payload.purchases ?? []) {
      insertRows('purchases', [purchase])
      insertRows('purchase_lines', (purchase.lines ?? []).map((line) => ({ ...line, purchase_ref: purchase.ref })))
    }
    /* ─── توسعة المرحلة ⑥: موارد بشرية ومستندات تجارية ─── */
    insertRows('employees', payload.employees)
    insertRows('attendance_records', payload.attendance)
    insertRows('leave_requests', payload.leaves)
    insertRows('payroll_months', payload.payrollMonths)
    for (const quotation of payload.quotations ?? []) {
      insertRows('quotations', [quotation])
      insertRows('quotation_lines', (quotation.lines ?? []).map((line) => ({ ...line, quotation_ref: quotation.ref })))
    }
    for (const order of payload.purchaseOrders ?? []) {
      insertRows('purchase_orders', [order])
      insertRows('purchase_order_lines', (order.lines ?? []).map((line) => ({ ...line, order_ref: order.ref })))
    }
    for (const doc of payload.wastage ?? []) {
      insertRows('wastage_docs', [doc])
      insertRows('wastage_lines', (doc.lines ?? []).map((line) => ({ ...line, doc_ref: doc.ref })))
    }
    insertRows('equipment', payload.equipment)
    insertRows('rental_contracts', payload.rentalContracts)
    insertRows('equipment_costs', payload.equipmentCosts)
    insertRows('sub_contracts', payload.subContracts)
    insertRows('project_extracts', payload.projectExtracts)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

const json = (res, status, body) => {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

const readBody = (req) => new Promise((resolve, reject) => {
  let raw = ''
  req.on('data', (chunk) => { raw += chunk })
  req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}) } catch (error) { reject(error) } })
  req.on('error', reject)
})

export function demoDatabasePlugin() {
  return {
    name: 'shopsys-demo-database',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/__demo/')) return next()
        const url = new URL(req.url, 'http://localhost')
        const db = openDb()
        if (!db) return json(res, 503, { error: 'قاعدة البيانات التجريبية غير مبنية — شغّل: npm run demo:build' })
        try {
          if (url.pathname === '/__demo/activities' && req.method === 'GET')
            return json(res, 200, { path: DB_PATH, activities: listActivities(db) })
          if (url.pathname === '/__demo/data' && req.method === 'GET') {
            const data = readActivity(db, url.searchParams.get('activity') ?? '')
            return data ? json(res, 200, data) : json(res, 404, { error: 'النشاط غير موجود في قاعدة البيانات' })
          }
          if (url.pathname === '/__demo/data' && req.method === 'POST') {
            writeActivity(db, await readBody(req))
            return json(res, 200, { ok: true, saved: true, path: DB_PATH })
          }
          if (url.pathname === '/__demo/reset' && req.method === 'POST') {
            db.close()
            const { buildDemoDatabase } = await import('./build.mjs')
            return json(res, 200, { ok: true, counts: buildDemoDatabase() })
          }
          return json(res, 404, { error: 'مسار غير معروف' })
        } catch (error) {
          return json(res, 500, { error: String(error?.message ?? error) })
        } finally {
          try { db.close() } catch { /* أُغلقت سلفاً في مسار إعادة البناء */ }
        }
      })
    },
  }
}
