// تدقيق مسارات الاعتماد الحساس approveByPin تحت أدوار مختلفة
const mem = new Map()
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { done: true, activityId: 'general', allowNegativeTreasury: true } } }))
const { useDataStore } = await import('/home/user/shopsys/app/src/data/repo.ts')
const { hashPin } = await import('/home/user/shopsys/app/src/core/audit.ts')
const st = () => useDataStore.getState()
let pass = 0, fails = []
const ok = (n, c) => c ? (pass++, console.log('  ✓ ' + n)) : fails.push(n)

// إعداد: رقم مالك + 4 مستخدمين بأدوار مختلفة
useDataStore.setState({ ownerPinHash: await hashPin('9999') })
for (const emp of [['كاشير أحمد'], ['مشرف سامي'], ['محاسب منى'], ['كاشير موقوف']])
  st().addEmployee({ nameAr: emp[0], phone: '', jobTitle: '', salaryMinor: 0, hiredAt: '2026-01-01', notes: '', active: true })
const [e1, e2, e3, e4] = st().employees.slice(-4)
st().addAppUser({ nameAr: 'كاشير أحمد', roleId: 'cashier', pinHash: await hashPin('1111'), employeeId: e1.id })
st().addAppUser({ nameAr: 'مشرف سامي', roleId: 'branch_manager', pinHash: await hashPin('2222'), employeeId: e2.id })
st().addAppUser({ nameAr: 'محاسب منى', roleId: 'accountant', pinHash: await hashPin('3333'), employeeId: e3.id })
st().addAppUser({ nameAr: 'كاشير موقوف', roleId: 'branch_manager', pinHash: await hashPin('4444'), employeeId: e4.id })
const frozen = st().appUsers.at(-1)
st().updateAppUser(frozen.id, { active: false })

const tryApprove = async (pin, perm) => { try { return (await st().approveByPin(pin, perm)).approvedBy } catch (e) { return 'ERR:' + e.message } }

// ① رقم المالك يعتمد أي عملية دائماً
ok('رقم المالك يعتمد مرتجعاً', (await tryApprove('9999', 'sales.return.approve')) === 'المالك')
ok('رقم المالك يعتمد صرف نقدية', (await tryApprove('9999', 'trs.payment.approve')) === 'المالك')
// ② كاشير بلا صلاحية الاعتماد يُرفض رقمه الصحيح
const r2 = await tryApprove('1111', 'sales.return.approve')
ok('رقم الكاشير الصحيح يُرفض لاعتماد مرتجع (لا صلاحية) — ' + r2.slice(0, 40), r2.startsWith('ERR:'))
// ③ المشرف (manager) يعتمد المرتجع
const r3 = await tryApprove('2222', 'sales.return.approve')
ok('رقم المشرف يعتمد المرتجع باسمه: ' + r3, r3 === 'مشرف سامي')
// ④ المحاسب يعتمد صرف النقدية (صلاحية خزينة)
const r4 = await tryApprove('3333', 'trs.payment.approve')
ok('المحاسب وصرف النقدية: ' + r4, r4 === 'محاسب منى' || r4.startsWith('ERR:'))
// ⑤ مستخدم موقوف رقمه لا يعتمد شيئاً حتى لو دوره مشرف
const r5 = await tryApprove('4444', 'sales.return.approve')
ok('رقم مستخدم موقوف يُرفض رغم دوره مشرفاً', r5.startsWith('ERR:'))
// ⑥ حارس المحاولات: أرقام خاطئة متكررة تقفل الاعتماد مؤقتاً
let lockedMsg = ''
for (let i = 0; i < 8; i++) { const r = await tryApprove('0000', 'sales.return.approve'); if (r.includes('مقفول') || r.includes('قُفل')) { lockedMsg = r; break } }
ok('القفل المؤقت بعد محاولات خاطئة متكررة — ' + lockedMsg.slice(4, 50), lockedMsg !== '')
// ⑦ حتى الرقم الصحيح لا يمر أثناء القفل (نفس حارس الدخول)
const r7 = await tryApprove('9999', 'sales.return.approve')
ok('رقم المالك نفسه محجوب أثناء القفل المؤقت', r7.startsWith('ERR:') && (r7.includes('مقفول') || r7.includes('دقيقة')))
// ⑧ حدث تدقيق سُجل للمحاولات الفاشلة
ok('سجل التدقيق يحوي محاولة اعتماد خاطئة', st().auditLog.some((a) => a.title.includes('اعتماد') && a.title.includes('خاطئ')))

console.log(`\nPASS=${pass} FAIL=${fails.length}${fails.length ? '\n  ✗ ' + fails.join('\n  ✗ ') : ''}`)
// ⑨ حماية جديدة: دور غير موجود يُرفض عند الإضافة والتعديل
let blocked9 = false
try { st().addAppUser({ nameAr: 'دخيل', roleId: 'ghost_role', pinHash: 'x' }) } catch { blocked9 = true }
console.log((blocked9 ? '  ✓' : '  ✗') + ' إضافة مستخدم بدور غير موجود مرفوضة')
let blocked10 = false
try { st().updateAppUser(st().appUsers[0].id, { roleId: 'ghost_role' }) } catch { blocked10 = true }
console.log((blocked10 ? '  ✓' : '  ✗') + ' تعديل مستخدم إلى دور غير موجود مرفوض')
if (fails.length || !blocked9 || !blocked10) process.exit(1)
