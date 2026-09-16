/**
 * فحص سجل النشاطات + المستخدمين + البلاغات + الدعم + التعقيم (طلب المالك):
 * ① sanitizeText: إزالة وسوم/محارف تحكم/محارف خفية + قص الطول (ضد الحقن)
 * ② سجل النشاطات التلقائي: كل كتابة (قيد/إضافة/حذف/تعديل فاتورة) تولد حدثاً باسم المستخدم النشط
 * ③ حلقة AUDIT_MAX: لا انتفاخ
 * ④ المستخدمون: PIN مجزأ، دور المالك محمي، الحذف = تعطيل (يحفظ التاريخ)
 * ⑤ البلاغات الداخلية: إنشاء → قيد معالجة → حل موثق + إشعار جرس
 * ⑥ سجل التطبيق (applog): حلقة + نص للإرسال مقصوص
 * ⑦ الدعم: حمولة معقمة + تنقية محادثة واردة (لا نثق بالخارج)
 * تشغيل: node --experimental-strip-types scripts/verify_audit_support.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { allowNegativeTreasury: true } } }))

const { useDataStore } = await import('../src/data/repo.ts')
const { sanitizeText, auditFromPatch, appendAudit, AUDIT_MAX, hashPin, verifyPin, validateIssue, isValidDeviceId } = await import('../src/core/audit.ts')
const { pushLog, logToText, logEvent, getLogLines, LOG_MAX } = await import('../src/core/applog.ts')
const { buildSupportPayload, parseConversation, supportUrl } = await import('../src/core/support.ts')
const { collectNotifications } = await import('../src/core/notifications.ts')
const S = () => useDataStore.getState()

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }
const throws = (name, fn, part) => {
  try { fn(); fail++; console.log(`  ❌ ${name} (لم يرمِ)`) }
  catch (e) { const good = !part || String(e.message).includes(part); good ? pass++ : fail++; console.log(`  ${good ? '✅' : '❌'} ${name}${good ? '' : ' — ' + e.message}`) }
}
const item = (over) => ({
  nameAr: 'x', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [],
  costMinor: 0, stockQty: 0, priceMinor: 0, minQty: 0, trackExpiry: false, trackSerial: false,
  warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, ...over,
})
const party = (nameAr) => ({ nameAr, phone: '', notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })
const cartLine = (itemId, qty, price, cost) => ({ itemId, nameAr: 'صنف', qty, unitPriceMinor: price, unitCostMinor: cost, discountPercent: 0, soldByWeight: false })

console.log('\n1️⃣ التعقيم المركزي (ضد الحقن)')
ok('يزيل وسوم HTML', sanitizeText('<script>alert(1)</script>مرحبا') === 'scriptalert(1)/scriptمرحبا')
ok('يزيل محارف التحكم', sanitizeText('a\u0000b\u0007c\u001Fd') === 'abcd')
ok('يزيل المحارف الخفية', sanitizeText('a\u200Bb\uFEFFc') === 'abc')
ok('يقص الطول', sanitizeText('x'.repeat(1000), 100).length === 100)
ok('غير النص ⇒ فارغ', sanitizeText(12345) === '' && sanitizeText(null) === '')
ok('deviceId صالح يقبل', isValidDeviceId('ABC-123_xyz'))
ok('deviceId بحقن مسار يُرفض', !isValidDeviceId('../etc/passwd') && !isValidDeviceId('a b'))

console.log('\n2️⃣ سجل النشاطات التلقائي من الكتابات')
S().addCustomer({ ...party('عميل السجل'), creditLimitMinor: 0 })
const cust = S().customers.at(-1)
ok('إضافة عميل ولّدت حدث add', S().auditLog.some((e) => e.kind === 'add' && e.title.includes('عميل السجل')))
S().addItem(item({ nameAr: 'صنف السجل', stockQty: 50, costMinor: 1000, priceMinor: 3000 }))
const it = S().items.at(-1)
ok('إضافة صنف ولّدت حدثاً', S().auditLog.some((e) => e.title.includes('صنف السجل')))
const auditBefore = S().auditLog.length
const sale = S().postSale({ lines: [cartLine(it.id, 1, 3000, 1000)], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101', paidMinor: 3000 })
ok('البيع ولّد حدث journal بوصف القيد', S().auditLog.slice(auditBefore).some((e) => e.kind === 'journal' && e.title.includes('فاتورة بيع')))
ok('الحدث باسم «المالك» (لا مستخدم نشط)', S().auditLog.at(-1).user === 'المالك')
// تعديل فاتورة يولد حدث edit
S().editSale({ saleId: sale.id, lines: [cartLine(it.id, 2, 3000, 1000)], customerId: null, payment: 'cash', paidMinor: 6000, treasury: '1101', invoiceDiscountPercent: 0, reason: 'فحص', einvoiceActive: false })
ok('تعديل الفاتورة ولّد حدث edit', S().auditLog.some((e) => e.kind === 'edit' && e.title.includes('تعديل فاتورة بيع')))

console.log('\n3️⃣ حلقة السجل — لا انتفاخ')
const big = appendAudit([], Array.from({ length: AUDIT_MAX + 500 }, (_, i) => ({ at: 't', user: 'u', kind: 'add', title: `e${i}` })))
ok(`السجل مقصوص عند ${AUDIT_MAX}`, big.length === AUDIT_MAX)
ok('الأحدث محفوظ والأقدم محذوف', big.at(-1).title === `e${AUDIT_MAX + 499}` && !big.some((e) => e.title === 'e0'))
// دالة الفروقات الخالصة
const evs = auditFromPatch({ journal: [{ id: 1, description: 'قديم' }], items: [] }, { journal: [{ id: 1, description: 'قديم' }, { id: 2, description: 'قيد <b>جديد</b>' }] }, 'كاشير<script>', 'T')
ok('حدث القيد الجديد فقط ومعقم', evs.length === 1 && evs[0].title === 'قيد bجديد/b' && evs[0].user === 'كاشيرscript')

console.log('\n4️⃣ المستخدمون: PIN مجزأ + مالك محمي + تعطيل لا حذف')
const pinHash = await hashPin('1234')
ok('PIN يُخزن hex-64 لا نصاً', /^[0-9a-f]{64}$/.test(pinHash))
ok('التحقق الصحيح يمر', await verifyPin('1234', pinHash))
ok('التحقق الخاطئ يفشل', !(await verifyPin('9999', pinHash)))
await (async () => { try { await hashPin('12'); fail++; console.log('  ❌ PIN قصير (لم يرمِ)') } catch { pass++; console.log('  ✅ PIN قصير يُرفض') } })()
// أمان الدفعة الجديدة: لا مستخدمين قبل تحصين المالك برقم سري
throws('إضافة مستخدم قبل PIN المالك تُرفض', () => S().addAppUser({ nameAr: 'مبكر', roleId: 'cashier', pinHash }), 'المالك أولاً')
S().setOwnerPin(pinHash)
const u1 = S().addAppUser({ nameAr: 'كاشير أحمد', roleId: 'cashier', pinHash })
ok('أُضيف المستخدم', S().appUsers.some((u) => u.id === u1.id && u.active))
throws('اسم مكرر يُرفض', () => S().addAppUser({ nameAr: 'كاشير أحمد', roleId: 'cashier', pinHash }), 'نفس الاسم')
// التبديل المباشر مقفول بعد تفعيل المصادقة — الدخول بفحص PIN فقط
throws('setCurrentUser المباشر مرفوض بعد تفعيل المصادقة', () => S().setCurrentUser(u1.id), 'شاشة الدخول')
await S().login(u1.id, '1234')
ok('الدخول بالرقم الصحيح يفعّل المستخدم', S().currentUserId === u1.id)
S().addCustomer({ ...party('عميل من الكاشير'), creditLimitMinor: 0 })
ok('الحدث باسم المستخدم النشط', S().auditLog.at(-1).user === 'كاشير أحمد')
const uOwner = S().addAppUser({ nameAr: 'المالك الحقيقي', roleId: 'owner', pinHash })
throws('مالك ثانٍ يُرفض', () => S().addAppUser({ nameAr: 'مالك آخر', roleId: 'owner', pinHash }), 'مالك')
throws('تخفيض دور المالك يُرفض', () => S().updateAppUser(uOwner.id, { roleId: 'cashier' }), 'محمي')
throws('حذف المالك يُرفض', () => S().removeAppUser(uOwner.id), 'لا يُحذف')
S().removeAppUser(u1.id)
ok('حذف مستخدم = تعطيل (يبقى بالسجل)', S().appUsers.some((u) => u.id === u1.id && !u.active))
ok('المستخدم النشط رجع للمالك بعد تعطيله', S().currentUserId === null)
await S().login(null, '1234') // رجوع للمالك بالدخول الشرعي قبل بقية الفحوص

console.log('\n5️⃣ البلاغات الداخلية: إنشاء → معالجة → حل موثق + جرس')
ok('تحقق البلاغ: عنوان مطلوب', validateIssue({ title: '', details: 'تفاصيل كافية' }).length === 1)
const issue = S().reportIssue({ title: 'فاتورة <img src=x> بمبلغ خاطئ', details: 'القيمة الصحيحة 500 وليس 5000', refKey: `sale:${sale.id}` })
ok('البلاغ مفتوح ومعقم من الوسوم', issue.status === 'open' && !issue.title.includes('<'))
ok('المُبلغ مسجل', issue.reportedBy === 'المالك')
const notifs = collectNotifications({ batches: [], itemName: () => '', installmentPlans: [], customerName: () => '', cheques: [], openIssues: S().issues.filter((i) => i.status !== 'resolved').map((i) => ({ id: i.id, title: i.title, reportedBy: i.reportedBy })), fmt: (m) => String(m), todayIso: new Date().toISOString() })
ok('البلاغ المفتوح يظهر في الجرس', notifs.some((n) => n.id === `issue:${issue.id}` && n.route === '/settings/issues'))
S().setIssueStatus(issue.id, 'in_progress')
ok('قيد المعالجة', S().issues.find((i) => i.id === issue.id).status === 'in_progress')
S().setIssueStatus(issue.id, 'resolved', 'عُدلت الفاتورة بقيد عاكس')
const solved = S().issues.find((i) => i.id === issue.id)
ok('الحل موثق باسم من حلّه ونصه', solved.status === 'resolved' && solved.resolvedBy === 'المالك' && solved.resolution.includes('عاكس'))
const notifs2 = collectNotifications({ batches: [], itemName: () => '', installmentPlans: [], customerName: () => '', cheques: [], openIssues: S().issues.filter((i) => i.status !== 'resolved').map((i) => ({ id: i.id, title: i.title, reportedBy: i.reportedBy })), fmt: (m) => String(m), todayIso: new Date().toISOString() })
ok('بعد الحل يختفي من الجرس', !notifs2.some((n) => n.id === `issue:${issue.id}`))

console.log('\n6️⃣ سجل التطبيق التقني (applog)')
const ring = Array.from({ length: LOG_MAX + 100 }, (_, i) => ({ at: 'T', level: 'info', msg: `m${i}` })).reduce((r, l) => pushLog(r, l), [])
ok(`الحلقة مقصوصة عند ${LOG_MAX}`, ring.length === LOG_MAX)
logEvent('error', 'مشكلة تجريبية للفحص')
ok('logEvent يكتب ويُقرأ', getLogLines().some((l) => l.msg.includes('تجريبية')))
const longText = logToText(Array.from({ length: 5000 }, (_, i) => ({ at: '2026-01-01T00:00:00', level: 'info', msg: 'x'.repeat(50) + i })), 10_000)
ok('نص الإرسال مقصوص من الأقدم', longText.length <= 10_100 && longText.startsWith('…'))

console.log('\n7️⃣ الدعم: حمولة معقمة + تنقية المحادثة الواردة')
const payload = buildSupportPayload({ text: '  <b>مشكلة</b> في الطباعة  ', customer: 'محل <x>', activity: 'موبايلات', appVersion: '1.0', attachLog: true, logText: 'سطر لوج' })
ok('النص معقم من الوسوم', payload.text === 'bمشكلة/b في الطباعة')
ok('اللوج مرفق عند الموافقة فقط', payload.log === 'سطر لوج' && buildSupportPayload({ text: 'مشكلة', customer: '', activity: '', appVersion: '', attachLog: false, logText: 'x' }).log === undefined)
throws('رسالة فارغة تُرفض', () => buildSupportPayload({ text: ' <> ', customer: '', activity: '', appVersion: '', attachLog: false, logText: '' }), 'اكتب')
const conv = parseConversation([
  { id: 1, from: 'client', text: 'مرحبا', at: '2026-09-15T10:00:00Z' },
  { id: 2, from: 'developer', text: '<script>حقن</script>الرد', at: '2026-09-15T10:05:00Z' },
  { id: 3, from: 'hacker', text: 'تسلل' },
  'garbage', null, { from: 'client' },
])
ok('التنقية: رسالتان صالحتان فقط', conv.length === 2)
ok('رد المطوّر معقم', conv[1].text === 'scriptحقن/scriptالرد' && conv[1].from === 'developer')
ok('supportUrl يبني المسار', supportUrl('https://x.workers.dev/', 'DEV-123').endsWith('/support/DEV-123'))
throws('supportUrl يرفض deviceId خبيث', () => supportUrl('https://x.dev', '../admin'), 'غير صالح')

console.log(`\n═══════════ PASS=${pass} FAIL=${fail} ═══════════`)
if (fail > 0) process.exit(1)
