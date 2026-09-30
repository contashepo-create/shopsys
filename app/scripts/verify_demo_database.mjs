/**
 * بوابة قاعدة البيانات التجريبية (البند ⑲ من دفعة المالك ⑩ي).
 *
 * تتحقق أن البيانات التجريبية:
 *   • قاعدة SQLite حقيقية تعيش مع الملفات (app/demo-db/demo.sqlite) لا كوداً مبعثراً.
 *   • لكل نشاط بياناته: أصناف متنوعة · عملاء · موردون · مخازن · فروع · خزائن وبنوك
 *     ومحافظ إلكترونية تابعة لبنوكها · ماكينة دفع · فواتير بيع وشراء.
 *   • كل المبالغ أعداد صحيحة بالقروش (لا كسور عشرية إطلاقاً).
 *   • قابلة للتعديل: واجهة القراءة والكتابة وإعادة البناء موجودة.
 *   • محصورة في وضع التطوير: لا تتسرب إلى نسخة الإنتاج.
 */
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, existsSync } from 'node:fs'
import assert from 'node:assert/strict'
import { reporter } from './auditKit.mjs'

const R = reporter('قاعدة البيانات التجريبية متعددة الأنشطة (وضع التطوير)')
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const DB = new URL('../demo-db/demo.sqlite', import.meta.url)

assert.ok(existsSync(DB), 'ملف قاعدة البيانات التجريبية مفقود — شغّل npm run demo:build')
const db = new DatabaseSync(DB.pathname)
R.ok('قاعدة بيانات SQLite حقيقية موجودة مع ملفات المشروع: app/demo-db/demo.sqlite')

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name)
for (const table of ['activities', 'branches', 'warehouses', 'treasuries', 'payment_terminals', 'categories', 'items', 'customers', 'suppliers', 'sales', 'sale_lines', 'purchases', 'purchase_lines'])
  assert.ok(tables.includes(table), `جدول ${table} مفقود من القاعدة`)
R.ok(`الجداول الثلاثة عشر كاملة (${tables.length} جدولاً)`)

const activities = db.prepare('SELECT * FROM activities ORDER BY sort_order').all()
assert.ok(activities.length >= 3, 'لا بد من أنشطة متعددة للتجربة والتنقل بينها')
R.ok(`أنشطة متعددة قابلة للتجربة: ${activities.map((activity) => activity.name_ar).join(' · ')}`)

const countFor = (table, activity) => db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE activity = ?`).get(activity).n
for (const activity of activities) {
  const id = activity.id
  assert.ok(countFor('items', id) >= 8, `النشاط ${id}: أصناف قليلة`)
  assert.ok(countFor('customers', id) >= 3 && countFor('suppliers', id) >= 2, `النشاط ${id}: عملاء/موردون ناقصون`)
  assert.ok(countFor('warehouses', id) >= 2, `النشاط ${id}: لا مخازن متعددة`)
  assert.ok(countFor('branches', id) >= 2, `النشاط ${id}: لا فروع متعددة`)
  assert.ok(countFor('payment_terminals', id) >= 1, `النشاط ${id}: بلا ماكينة دفع`)
  assert.ok(countFor('sales', id) >= 1 && countFor('purchases', id) >= 1, `النشاط ${id}: بلا فواتير بيع وشراء`)
}
R.ok('كل نشاط يحمل بياناته الكاملة: أصناف وعملاء وموردون ومخازن وفروع وماكينة دفع وفواتير بيع وشراء')

for (const activity of activities) {
  const kinds = db.prepare('SELECT kind, COUNT(*) AS n FROM treasuries WHERE activity = ? GROUP BY kind').all(activity.id)
  const by = Object.fromEntries(kinds.map((row) => [row.kind, row.n]))
  assert.ok((by.cash ?? 0) >= 1 && (by.bank ?? 0) >= 1 && (by.wallet ?? 0) >= 1, `النشاط ${activity.id}: ينقصه خزينة أو بنك أو محفظة إلكترونية`)
  const orphans = db.prepare("SELECT ref FROM treasuries WHERE activity = ? AND kind = 'wallet' AND parent_ref NOT IN (SELECT ref FROM treasuries WHERE activity = ? AND kind = 'bank')").all(activity.id, activity.id)
  assert.equal(orphans.length, 0, `النشاط ${activity.id}: محفظة إلكترونية بلا بنك أب`)
}
R.ok('خزائن وبنوك متعددة، وكل محفظة إلكترونية تابعة فرعياً لبنكها (مطلب المالك)')

const decimals = [
  ...db.prepare('SELECT cost_minor AS v FROM items').all(),
  ...db.prepare('SELECT price_minor AS v FROM items').all(),
  ...db.prepare('SELECT opening_minor AS v FROM treasuries').all(),
  ...db.prepare('SELECT unit_price_minor AS v FROM sale_lines').all(),
  ...db.prepare('SELECT unit_price_minor AS v FROM purchase_lines').all(),
  ...db.prepare('SELECT credit_limit_minor AS v FROM customers').all(),
].filter((row) => !Number.isInteger(row.v))
assert.equal(decimals.length, 0, 'مبلغ غير صحيح (كسر عشري) داخل البيانات التجريبية')
R.ok('كل المبالغ أعداد صحيحة بالقروش — لا كسور عشرية في أي جدول')

const items = db.prepare('SELECT * FROM items').all()
assert.ok(items.some((item) => item.is_service === 1), 'لا يوجد صنف خدمي')
assert.ok(items.some((item) => item.sold_by_weight === 1), 'لا يوجد صنف بالوزن')
assert.ok(items.some((item) => item.track_expiry === 1), 'لا يوجد صنف بتاريخ صلاحية')
assert.ok(items.some((item) => item.colors && item.sizes), 'لا يوجد صنف بألوان ومقاسات')
assert.ok(items.some((item) => item.barcode), 'لا يوجد صنف بباركود')
assert.ok(items.some((item) => item.extra_units), 'لا يوجد صنف بوحدات إضافية')
R.ok(`أصناف متعددة الخواص (${items.length} صنفاً): خدمي · بالوزن · بصلاحية · بألوان ومقاسات · بباركود · بوحدات إضافية`)

const plugin = read('demo-db/vitePlugin.mjs')
assert.ok(/apply: 'serve'/.test(plugin), 'إضافة القاعدة تعمل في البناء الإنتاجي — يجب حصرها في وضع التطوير')
assert.ok(/'\/__demo\/data' && req\.method === 'POST'/.test(plugin) && /writeActivity/.test(plugin), 'لا مسار لكتابة التعديلات — البيانات غير قابلة للتعديل')
assert.ok(/'\/__demo\/reset'/.test(plugin), 'لا مسار لإعادة بناء القاعدة')
R.ok('القاعدة قابلة للتعديل: قراءة وكتابة وإعادة بناء عبر واجهة محلية في وضع التطوير فقط')

const bridge = read('src/dev/demoDatabase.ts')
const panel = read('src/dev/DemoDataPanel.tsx')
assert.ok(/if \(!import\.meta\.env\.DEV\)/.test(bridge) && /if \(!import\.meta\.env\.DEV\) return null/.test(panel),
  'لوحة البيانات التجريبية غير محروسة بوضع التطوير — ستظهر للعميل النهائي')
assert.ok(/switchDemoActivity/.test(bridge) && /data-demo-load/.test(panel), 'لا خيار داخلي لاختيار النشاط والتنقل لغيره')
assert.ok(/postSale\(/.test(bridge) && /postPurchase\(/.test(bridge) && /setOpeningBalance\(/.test(bridge),
  'التحميل يحقن البيانات بلا قيود محاسبية — يجب المرور بإجراءات الترحيل الرسمية')
R.ok('لوحة «بيانات تجريبية» محروسة بـDEV، تبدّل النشاط، وتحمّل الفواتير بالترحيل النظامي لا بحقنة صامتة')

db.close()
R.done()
