#!/usr/bin/env node
/**
 * فحص تصنيف الموظف:
 * نموذج الموظف يحفظ الفئة/الدور فقط، وحساب الدخول والرقم السري يظلان في الإعدادات.
 * تغيير التصنيف يحدّث دور الحساب المرتبط تلقائياً دون إنشاء حساب جديد.
 * التشغيل: node --experimental-strip-types scripts/verify_employee_role_classification.mjs
 */
import assert from 'node:assert/strict'

const mem = new Map()
globalThis.localStorage = {
  getItem: (key) => mem.get(key) ?? null,
  setItem: (key, value) => mem.set(key, String(value)),
  removeItem: (key) => mem.delete(key),
  clear: () => mem.clear(),
  key: (index) => [...mem.keys()][index] ?? null,
  get length() { return mem.size },
}
globalThis.window = { localStorage: globalThis.localStorage, addEventListener: () => {}, dispatchEvent: () => true }
mem.set('shopsys-app', JSON.stringify({ state: { setup: { done: true, countryCode: 'EG', activityId: 'grocery', modules: ['pos', 'inventory', 'purchases'], allowNegativeTreasury: true } }, version: 0 }))

const { useDataStore } = await import('../src/data/repo.ts?employee-role')
const S = () => useDataStore.getState()
let pass = 0
const ok = (message) => { pass++; console.log(`  ✓ ${message}`) }
const EXT = { taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' }

console.log('\n═══ فحص تصنيف الموظف والدور التلقائي ═══')
S().seed([])
S().addEmployee({ nameAr: 'موظف تصنيف', phone: '', jobTitle: 'كاشير', roleId: 'cashier', hireDate: '2026-09-24', baseSalaryMinor: 0, allowancesMinor: 0, active: true, notes: '', ...EXT })
const employee = S().employees.at(-1)
assert.equal(employee.roleId, 'cashier')
assert.equal(S().appUsers.length, 0)
ok('إنشاء الموظف يحفظ الفئة/الدور التشغيلي دون إنشاء حساب دخول')

S().setOwnerPin('owner-hash')
const user = S().addAppUser({ nameAr: employee.nameAr, roleId: employee.roleId, pinHash: 'initial-hash', employeeId: employee.id, initialPin: '1234', mustChangePin: true })
assert.equal(user.employeeId, employee.id)
assert.equal(user.pinHash, 'initial-hash')
ok('حساب الدخول والرقم السري لا يُنشآن من نموذج الموظف؛ الإعدادات تنشئهما منفصلين')

S().updateEmployee(employee.id, { roleId: 'senior_seller' })
assert.equal(S().employees.find((item) => item.id === employee.id)?.roleId, 'senior_seller')
assert.equal(S().appUsers.find((item) => item.id === user.id)?.roleId, 'senior_seller')
ok('تغيير فئة الموظف يحدّث دور الحساب المرتبط وصلاحياته تلقائياً')

assert.throws(() => S().addEmployee({ nameAr: 'مالك ممنوع', phone: '', jobTitle: '', roleId: 'owner', hireDate: '2026-09-24', baseSalaryMinor: 0, allowancesMinor: 0, active: true, notes: '', ...EXT }), /تصنيف الموظف غير صالح/)
ok('تصنيف المالك محمي ولا يُسند لموظف')

console.log(`\n✅ تصنيف الموظفين: ${pass} محطات — خضراء\n`)
