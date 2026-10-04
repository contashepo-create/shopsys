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
for (const table of ['activities', 'branches', 'warehouses', 'treasuries', 'payment_terminals', 'categories', 'items', 'customers', 'suppliers', 'sales', 'sale_lines', 'purchases', 'purchase_lines', 'sale_returns', 'sale_return_lines', 'purchase_returns', 'purchase_return_lines', 'vouchers'])
  assert.ok(tables.includes(table), `جدول ${table} مفقود من القاعدة`)
R.ok(`الجداول الأساسية كاملة (${tables.length} جدولاً)`)

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

/* §96: نشاط المقاولات يحمل مستندات لكل أقسامه — جدول contracting_docs بأنواع كاملة */
const docKinds = db.prepare("SELECT DISTINCT kind FROM contracting_docs WHERE activity = 'contracting'").all().map((row) => row.kind)
for (const kind of ['project', 'boq_item', 'budget', 'change_order', 'bond', 'daily_worker', 'material_issue', 'project_cost', 'client_advance', 'project_receipt', 'project_payment', 'client_collection', 'project_purchase', 'extract', 'project_task', 'approval_flow', 'approval_request'])
  assert.ok(docKinds.includes(kind), `مستندات المقاولات: نوع ${kind} مفقود من contracting_docs`)
const contractingDocsCount = db.prepare("SELECT COUNT(*) AS n FROM contracting_docs WHERE activity = 'contracting'").get().n
assert.ok(contractingDocsCount >= 35, 'مستندات المقاولات أقل من 35 — أقسام ستظهر فارغة')
assert.ok(db.prepare("SELECT COUNT(*) AS n FROM quotations WHERE activity = 'contracting' AND convert = 'project'").get().n >= 1, 'لا عرض فائز يتحول مشروعاً — عمود convert')
R.ok(`نشاط المقاولات كامل الأقسام: ${contractingDocsCount} مستنداً ب${docKinds.length} نوعاً (مشروع يدوي · موازنة · أوامر تغيير · خطابات ضمان · عمال يومية · أذون صرف · سندات موسومة · تحصيل FIFO · شراء مربوط · مهام · موافقات)`)

/* §98: حمولة JSON (demo-payloads.json) مطابقة تماماً لما تنتجه البذرة —
   تُبنى قاعدة مؤقتة من البذرة وتُفرَّغ وتُقارن بالملف الملتزم (نمط بوابة المصفوفة) */
{
  const { buildDemoDatabase } = await import('../demo-db/build.mjs')
  const { DatabaseSync } = await import('node:sqlite')
  const { dumpPayloads } = await import('../demo-db/dump.mjs')
  const { mkdtempSync, readFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const tmp = mkdtempSync(join(tmpdir(), 'shopsys-demo-'))
  try {
    buildDemoDatabase(join(tmp, 'demo.sqlite'))
    const db = new DatabaseSync(join(tmp, 'demo.sqlite'))
    const fresh = dumpPayloads(db)
    db.close()
    const committed = JSON.parse(readFileSync(new URL('../demo-db/demo-payloads.json', import.meta.url), 'utf8'))
    /* صفوف sqlite كائنات بلا prototype وJSON.parse عادية — فالمقارنة قانونية نصياً */
    assert.equal(JSON.stringify(fresh), JSON.stringify(committed), 'demo-payloads.json لا يطابق البذرة — شغّل npm run demo:build')
  } finally { rmSync(tmp, { recursive: true, force: true }) }
  R.ok('حمولات الأنشطة الجاهزة للاختبارات (demo-payloads.json) مطابقة للبذرة حرفياً')
}

/* ═══ §100: بذور أعمق — مرتجعات وسندات لكل نشاط ═══ */
{
  let srTotal = 0, prTotal = 0, vTotal = 0
  for (const activity of activities) {
    const sr = db.prepare('SELECT COUNT(*) AS n FROM sale_returns WHERE activity = ?').get(activity.id).n
    const pr = db.prepare('SELECT COUNT(*) AS n FROM purchase_returns WHERE activity = ?').get(activity.id).n
    const vR = db.prepare("SELECT COUNT(*) AS n FROM vouchers WHERE activity = ? AND kind = 'receipt'").get(activity.id).n
    const vP = db.prepare("SELECT COUNT(*) AS n FROM vouchers WHERE activity = ? AND kind = 'payment'").get(activity.id).n
    srTotal += sr; prTotal += pr; vTotal += vR + vP
    assert.ok(sr >= 1, `نشاط ${activity.id}: لا مرتجع بيع — شاشة المرتجعات ستظهر فارغة`)
    assert.ok(pr >= 1, `نشاط ${activity.id}: لا مرتجع شراء`)
    assert.ok(vR >= 1 && vP >= 1, `نشاط ${activity.id}: يجب سند قبض وسند صرف على الأقل`)
    /* المرتجع يشير لفاتورة موجودة بنفس النشاط وسطوره أصناف من فاتورته الأصل */
    const badRef = db.prepare(`SELECT COUNT(*) AS n FROM sale_returns r WHERE r.activity = ? AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.activity = r.activity AND s.ref = r.sale_ref)`).get(activity.id).n
    assert.equal(badRef, 0, `نشاط ${activity.id}: مرتجع بيع يشير لفاتورة غير موجودة`)
    const badPRef = db.prepare(`SELECT COUNT(*) AS n FROM purchase_returns r WHERE r.activity = ? AND NOT EXISTS (SELECT 1 FROM purchases p WHERE p.activity = r.activity AND p.ref = r.purchase_ref)`).get(activity.id).n
    assert.equal(badPRef, 0, `نشاط ${activity.id}: مرتجع شراء يشير لفاتورة غير موجودة`)
    const badVoucher = db.prepare(`SELECT COUNT(*) AS n FROM vouchers v WHERE v.activity = ? AND v.amount_minor <= 0`).get(activity.id).n
    assert.equal(badVoucher, 0, `نشاط ${activity.id}: سند بمبلغ غير موجب`)
  }
  /* كميات المرتجعات لا تتجاوز كميات فواتيرها الأصلية (سطر بسطر) */
  const overSale = db.prepare(`
    SELECT COUNT(*) AS n FROM sale_return_lines rl
    JOIN sale_returns r ON r.activity = rl.activity AND r.ref = rl.return_ref
    JOIN sales s ON s.activity = r.activity AND s.ref = r.sale_ref
    JOIN sale_lines sl ON sl.activity = s.activity AND sl.sale_ref = s.ref AND sl.item_ref = rl.item_ref
    WHERE rl.qty > sl.qty`).get().n
  assert.equal(overSale, 0, 'مرتجع بيع بكمية أكبر من سطر الفاتورة الأصل')
  R.ok(`بذور أعمق لكل نشاط: ${srTotal} مرتجع بيع · ${prTotal} مرتجع شراء · ${vTotal} سند قبض/صرف — بمرجعيات سليمة وكميات لا تتجاوز الأصل`)
}

const bridge = read('src/dev/demoDatabase.ts')
const panel = read('src/dev/DemoDataPanel.tsx')
assert.ok(/if \(!import\.meta\.env\.DEV\)/.test(bridge) && /if \(!import\.meta\.env\.DEV\) return null/.test(panel),
  'لوحة البيانات التجريبية غير محروسة بوضع التطوير — ستظهر للعميل النهائي')
assert.ok(/switchDemoActivity/.test(bridge) && /data-demo-load/.test(panel), 'لا خيار داخلي لاختيار النشاط والتنقل لغيره')
assert.ok(/postSale\(/.test(bridge) && /postPurchase\(/.test(bridge) && /setOpeningBalance\(/.test(bridge),
  'التحميل يحقن البيانات بلا قيود محاسبية — يجب المرور بإجراءات الترحيل الرسمية')
assert.ok(/postSaleReturn\(/.test(bridge) && /postPurchaseReturn\(/.test(bridge) && /postVoucher\(/.test(bridge),
  'المرتجعات والسندات تُحقن بغير الإجراءات الرسمية — يجب postSaleReturn/postPurchaseReturn/postVoucher كي تُبنى القيود العاكسة بصدق')
assert.ok(/issueBond\(/.test(bridge) && /issueMaterials\(/.test(bridge) && /addDailyWorker\(/.test(bridge) && /addChangeOrder\(/.test(bridge)
  && /addProjectTask\(/.test(bridge) && /setProjectBudget\(/.test(bridge) && /receiveClientAdvance\(/.test(bridge)
  && /receiveClientPayment\(/.test(bridge) && /setApprovalFlow\(/.test(bridge),
  'مستندات المقاولات تُحقن بغير الإجراءات الرسمية — يجب المرور بissueBond/issueMaterials/... كي تُبنى القيود بصدق')
R.ok('لوحة «بيانات تجريبية» محروسة بـDEV، تبدّل النشاط، وتحمّل الفواتير بالترحيل النظامي لا بحقنة صامتة')

db.close()
R.done()
