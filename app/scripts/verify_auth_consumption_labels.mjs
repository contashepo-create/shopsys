/**
 * فحص الدفعة: تسجيل الدخول الفعلي + استعادة كلمة السر + الصرف الداخلي + قالب الملصقات
 * ① نواة auth: حارس المحاولات، الرقم المؤقت، صلاحية الرسالة، authRequired
 * ② repo: login/logout بفحص PIN حقيقي، منع setCurrentUser المباشر، القفل المؤقت
 * ③ استعادة الموظف: طلب → إشعار جرس → المالك يعيّن → الطلب يُغلق ويعمل الرقم الجديد
 * ④ استعادة المالك: رقم مؤقت يُحرق باستخدامه وينتهي بوقته
 * ⑤ الصرف الداخلي: تحقق، قيد 5114/1103 متوازن، خصم رصيد، FEFO، رفض تجاوز الرصيد وحساب غير مصروف
 * ⑥ الملصقات: مقاسات، تحقق الطباعة، رسم ملصقات أصناف وسيريال بالقالب
 * تشغيل: node --experimental-strip-types scripts/verify_auth_consumption_labels.mjs
 */
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false,  allowNegativeTreasury: true } } }))

const { useDataStore } = await import('../src/data/repo.ts')
const { hashPin, verifyPin } = await import('../src/core/audit.ts')
const auth = await import('../src/core/auth.ts')
const cons = await import('../src/core/consumption.ts')
const labels = await import('../src/core/labels.ts')
const { collectNotifications } = await import('../src/core/notifications.ts')
const S = () => useDataStore.getState()

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra) : ''}`) } }
const throwsAsync = async (name, fn, part) => {
  try { await fn(); fail++; console.log(`  ❌ ${name} (لم يرمِ)`) }
  catch (e) { const good = !part || String(e.message).includes(part); good ? pass++ : fail++; console.log(`  ${good ? '✅' : '❌'} ${name}${good ? '' : ' — ' + e.message}`) }
}
const throws = (name, fn, part) => {
  try { fn(); fail++; console.log(`  ❌ ${name} (لم يرمِ)`) }
  catch (e) { const good = !part || String(e.message).includes(part); good ? pass++ : fail++; console.log(`  ${good ? '✅' : '❌'} ${name}${good ? '' : ' — ' + e.message}`) }
}

console.log('\n1️⃣ نواة المصادقة (auth.ts)')
{
  const now = '2026-09-16T10:00:00Z'
  let g = auth.EMPTY_GUARD
  for (let i = 0; i < auth.MAX_LOGIN_FAILURES - 1; i++) g = auth.registerFailure(g, now)
  ok('قبل الحد: لا قفل', g.lockedUntil === null && g.failures === auth.MAX_LOGIN_FAILURES - 1)
  g = auth.registerFailure(g, now)
  ok('عند الحد: قفل مؤقت وتصفير العداد', g.lockedUntil !== null && g.failures === 0)
  ok(`مدة القفل ${auth.LOCKOUT_MINUTES} دقائق`, auth.lockoutMinutesLeft(g, now) === auth.LOCKOUT_MINUTES)
  ok('بعد انقضاء المدة يفك', auth.lockoutMinutesLeft(g, '2026-09-16T10:06:00Z') === 0)
  const tp = auth.generateTempPin()
  ok('الرقم المؤقت 6 خانات رقمية', /^\d{6}$/.test(tp))
  const t = { pinHash: 'x', expiresAt: '2026-09-16T10:15:00Z' }
  ok('غير منتهٍ قبل وقته', !auth.tempPinExpired(t, '2026-09-16T10:14:00Z'))
  ok('منتهٍ بعد وقته', auth.tempPinExpired(t, '2026-09-16T10:15:01Z'))
  const msg = auth.buildTempPinMessage('محل النور', '123456', 15)
  ok('رسالة التليجرام تحمل الرقم والمدة', msg.includes('123456') && msg.includes('15 دقيقة') && msg.includes('محل النور'))
  ok('authRequired: لا مالك بلا PIN ولا موظفين', !auth.authRequired(null, 0))
  ok('authRequired: PIN مالك يفعّلها', auth.authRequired('h', 0))
  ok('authRequired: موظف نشط يفعّلها', auth.authRequired(null, 1))
  ok('validateResetRequest: مستخدم غير موجود يُرفض', auth.validateResetRequest([], 5, false).length === 1)
  ok('validateResetRequest: طلب مفتوح مكرر يُرفض', auth.validateResetRequest([{ id: 1, userId: 5, nameAr: 'x', requestedAt: 'T', status: 'open', resolvedAt: null }], 5, true).length === 1)
}

console.log('\n2️⃣ الدخول والخروج في repo (فحص PIN حقيقي)')
const ownerHash = await hashPin('111111')
S().setOwnerPin(ownerHash)
ok('تجزئة المالك محفوظة (لا الرقم)', S().ownerPinHash === ownerHash && !JSON.stringify(S().ownerPinHash).includes('111111'))
const empHash = await hashPin('222222')
const emp = S().addAppUser({ nameAr: 'كاشيرة سارة', roleId: 'cashier', pinHash: empHash })
throws('setCurrentUser المباشر مرفوض بعد التفعيل', () => S().setCurrentUser(emp.id), 'شاشة الدخول')
await throwsAsync('دخول برقم خاطئ يُرفض', () => S().login(emp.id, '999999'), 'خاطئ')
await S().login(emp.id, '222222')
ok('دخول الموظف بالرقم الصحيح', S().currentUserId === emp.id && !S().loggedOut)
ok('حدث الدخول في سجل النشاطات', S().auditLog.some((e) => e.kind === 'auth' && e.title.includes('سارة')))
S().logout()
ok('الخروج يفعّل شاشة الدخول', S().loggedOut === true)
await S().login(null, '111111')
ok('دخول المالك برقمه', S().currentUserId === null && !S().loggedOut)
// القفل المؤقت بعد محاولات متتالية
for (let i = 0; i < auth.MAX_LOGIN_FAILURES; i++) { try { await S().login(null, '0000') } catch { /* متوقع */ } }
await throwsAsync('بعد استنفاد المحاولات: مقفول بالدقائق', () => S().login(null, '111111'), 'مقفول')
useDataStore.setState({ loginGuard: { failures: 0, lockedUntil: null } }) // فك القفل للفحوص التالية
await S().login(null, '111111')

console.log('\n3️⃣ استعادة الموظف: طلب → جرس المالك → تعيين → إغلاق')
S().requestPinReset(emp.id)
const req = S().pinResetRequests.find((r) => r.userId === emp.id && r.status === 'open')
ok('الطلب مسجل مفتوحاً', !!req)
throws('طلب ثانٍ لنفس المستخدم يُرفض', () => S().requestPinReset(emp.id), 'مفتوح بالفعل')
const bell = collectNotifications({ batches: [], itemName: () => '', installmentPlans: [], customerName: () => '', cheques: [], openPinResets: S().pinResetRequests.filter((r) => r.status === 'open').map((r) => ({ id: r.id, nameAr: r.nameAr })), fmt: String, todayIso: new Date().toISOString() })
ok('يظهر في جرس المالك ويوجه للصلاحيات', bell.some((n) => n.id === `pinreset:${req.id}` && n.route === '/settings/permissions'))
throws('تنفيذ بلا رقم جديد يُرفض', () => S().resolvePinReset(req.id, 'done'), 'عيّن الرقم')
const newEmpHash = await hashPin('333333')
S().resolvePinReset(req.id, 'done', newEmpHash)
ok('الطلب أُغلق والرقم الجديد سرى', S().pinResetRequests.find((r) => r.id === req.id).status === 'done' && S().appUsers.find((u) => u.id === emp.id).pinHash === newEmpHash)
await throwsAsync('الرقم القديم لم يعد يعمل', () => S().login(emp.id, '222222'), 'خاطئ')
await S().login(emp.id, '333333')
ok('الرقم الجديد يعمل', S().currentUserId === emp.id)
await S().login(null, '111111')

console.log('\n4️⃣ استعادة المالك: رقم مؤقت يُحرق ويَنتهي')
const temp = auth.generateTempPin()
S().setOwnerTempPin({ pinHash: await hashPin(temp), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() })
const res = await S().login(null, temp)
ok('الدخول بالرقم المؤقت يمر ويبلغ الواجهة', res.usedTempPin === true)
ok('الرقم المؤقت احترق باستخدامه', S().ownerTempPin === null)
S().setOwnerTempPin({ pinHash: await hashPin('654321'), expiresAt: new Date(Date.now() - 1000).toISOString() })
await throwsAsync('الرقم المؤقت المنتهي يُرفض', () => S().login(null, '654321'), 'خاطئ')
S().setOwnerTempPin(null)
ok('verifyPin لا يقبل غير الأرقام', !(await verifyPin('abcd', ownerHash)))

console.log('\n5️⃣ الصرف الداخلي (استهلاك المخزون للتشغيل)')
S().seed(['expiry'])
S().addItem({ nameAr: 'منظف صناعي', sku: 'CLN-1', barcodes: [], categoryId: 1, baseUnit: 'عبوة', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 0, minQty: 0, trackExpiry: true, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
const cln = S().items.at(-1)
S().addSupplier({ nameAr: 'مورد كيماويات', phone: '', notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })
const sup = S().suppliers.at(-1)
S().postPurchase({ supplierId: sup.id, date: '2026-09-01', lines: [{ itemId: cln.id, qty: 10, unitPriceMinor: 4000, expiryDate: '2026-10-01' }], expenses: [], paidMinor: 0, notes: '' })
S().postPurchase({ supplierId: sup.id, date: '2026-09-02', lines: [{ itemId: cln.id, qty: 10, unitPriceMinor: 4000, expiryDate: '2026-12-01' }], expenses: [], paidMinor: 0, notes: '' })
ok('الرصيد بعد الشراء 20 والتكلفة 40.00', S().items.find((i) => i.id === cln.id).stockQty === 20 && S().items.find((i) => i.id === cln.id).costMinor === 4000)
// نواة خالصة
ok('validateConsumption: غرض فارغ يُرفض', cons.validateConsumption({ purpose: ' ', expenseAccount: '5114', lines: [{ itemId: 1, nameAr: 'x', qty: 1, unitCostMinor: 100 }] }, () => 5, () => true).length === 1)
ok('validateConsumption: حساب غير مصروف يُرفض', cons.validateConsumption({ purpose: 'p', expenseAccount: '1103', lines: [{ itemId: 1, nameAr: 'x', qty: 1, unitCostMinor: 100 }] }, () => 5, (c) => c.startsWith('5')).length === 1)
const entry5 = cons.buildConsumptionEntry([{ itemId: 1, nameAr: 'x', qty: 3, unitCostMinor: 4000 }], '5114', 'CNS-T')
ok('القيد: 5114 مدين 12000 / 1103 دائن 12000', entry5[0].accountCode === '5114' && entry5[0].debit === 12000 && entry5[1].accountCode === '1103' && entry5[1].credit === 12000)
throws('قيد بقيمة صفرية يُرفض', () => cons.buildConsumptionEntry([{ itemId: 1, nameAr: 'x', qty: 1, unitCostMinor: 0 }], '5114', 'T'), 'موجبة')
// عبر repo
const before = S().journal.length
const doc = S().postConsumption({ purpose: 'مواد تشغيل', lines: [{ itemId: cln.id, qty: 8 }], notes: 'مغسلة — وردية الصباح' })
ok('مستند CNS-0001 بالتكلفة الصحيحة', doc.consumptionNumber === 'CNS-0001' && doc.totalCostMinor === 32000)
ok('الحساب الافتراضي 5114', doc.expenseAccount === '5114')
const jc = S().journal.at(-1)
ok('قيد internal_use متوازن ومربوط', S().journal.length === before + 1 && jc.sourceType === 'internal_use' && jc.lines.reduce((a, l) => a + l.debit - l.credit, 0) === 0)
ok('الرصيد خُصم إلى 12', S().items.find((i) => i.id === cln.id).stockQty === 12)
const batchOld = S().batches.find((b) => b.itemId === cln.id && b.expiryDate === '2026-10-01')
ok('FEFO: الدفعة الأقدم استُهلكت أولاً (10→2... )', batchOld.qty === 2)
throws('تجاوز الرصيد يُرفض', () => S().postConsumption({ purpose: 'مواد تشغيل', lines: [{ itemId: cln.id, qty: 999 }], notes: '' }), 'تتجاوز')
const doc2 = S().postConsumption({ purpose: 'ضيافة ونظافة', expenseAccount: '5108', lines: [{ itemId: cln.id, qty: 2 }], notes: '' })
ok('حساب مصروف بديل (5108) يعمل', doc2.expenseAccount === '5108' && S().journal.at(-1).lines[0].accountCode === '5108')
throws('حساب غير مصروف (1101) يُرفض', () => S().postConsumption({ purpose: 'p', expenseAccount: '1101', lines: [{ itemId: cln.id, qty: 1 }], notes: '' }), 'مصروفات')

console.log('\n6️⃣ قالب الملصقات والرسم')
{
  ok('6 مقاسات معيارية', labels.LABEL_SIZES.length === 6)
  ok('labelSize يسقط للافتراضي عند مجهول', labels.labelSize('غير-موجود').id === labels.LABEL_SIZES[0].id)
  ok('تحقق الطباعة: صفر يُرفض', labels.validateLabelPrint(0).length === 1)
  ok('تحقق الطباعة: فوق 2000 يُرفض', labels.validateLabelPrint(2001).length === 1)
  ok('تحقق الطباعة: 50 يمر', labels.validateLabelPrint(50).length === 0)
  const { renderItemLabelsHtml, renderSerialLabelsHtml } = await import('../src/ui/print/printProLabels.ts')
  const cur = { code: 'EGP', symbol: 'ج.م', decimals: 2, name: '' }
  const cfg = { ...labels.DEFAULT_LABEL_SETTINGS, customLine: 'للاستبدال خلال 14 يوماً' }
  const html = renderItemLabelsHtml('محل النور', [{ nameAr: 'شاي العروسة', barcode: '6221031954016', sku: 'ITM-1', priceMinor: 3500, count: 3 }], cfg, cur)
  ok('ملصق الصنف: 3 نسخ + اسم + سعر + سطر مخصص', (html.match(/class="lbl"/g) || []).length === 3 && html.includes('شاي العروسة') && html.includes('35.00') && html.includes('للاستبدال خلال 14 يوماً'))
  ok('باركود SVG مرسوم', html.includes('<svg'))
  const rollCfg = { ...cfg, sizeId: 'roll-50x25' }
  const rollHtml = renderItemLabelsHtml('محل', [{ nameAr: 'صنف', barcode: '123456', sku: '', priceMinor: 100, count: 2 }], rollCfg, cur)
  ok('الرول: @page بمقاس الملصق نفسه', rollHtml.includes('@page') && rollHtml.includes('50mm 25mm'))
  const sHtml = renderSerialLabelsHtml('محل النور', [{ serial: '359881234567890', itemNameAr: 'iPhone 15', warrantyMonths: 12, receivedAt: '2026-09-01T10:00:00Z' }], cfg)
  ok('ملصق السيريال: السيريال + القطعة + الضمان تلقائياً', sHtml.includes('359881234567890') && sHtml.includes('iPhone 15') && sHtml.includes('ضمان 12'))
  const noNameCfg = { ...cfg, serialShowItemName: false, serialShowWarranty: false }
  const sHtml2 = renderSerialLabelsHtml('محل', [{ serial: 'SN1', itemNameAr: 'جهاز', warrantyMonths: 12, receivedAt: 'T' }], noNameCfg)
  ok('القالب يتحكم فعلاً فيما يظهر', !sHtml2.includes('جهاز') && !sHtml2.includes('ضمان'))
}

console.log(`\n═══ النتيجة: نجح ${pass} — فشل: ${fail} ═══`)
if (fail > 0) process.exit(1)
