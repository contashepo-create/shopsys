#!/usr/bin/env node
/**
 * verify_backup — فحص نواة النسخ الاحتياطي
 * node --experimental-strip-types scripts/verify_backup.mjs
 */
import { strict as assert } from 'node:assert'
import {
  checksum, buildBackup, parseBackup, summarizeBackup, backupFileName,
  BACKUP_FORMAT, BACKUP_VERSION,
} from '../src/core/backup.ts'

let passed = 0
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`) }
  catch (e) { console.error(`  ❌ ${name}: ${e.message}`); process.exitCode = 1 }
}

const STORE = {
  state: {
    items: [{ id: 1 }, { id: 2 }],
    sales: [{ id: 1 }],
    purchases: [],
    journal: [{ id: 1 }, { id: 2 }, { id: 3 }],
    customers: [{ id: 5 }],
  },
  version: 6,
}
const APP = { state: { setup: { shopName: 'بقالة النور' } }, version: 0 }

console.log('🔍 البناء والبصمة')

ok('بصمة حتمية وتتغير مع أي تعديل', () => {
  assert.equal(checksum('abc'), checksum('abc'))
  assert.notEqual(checksum('abc'), checksum('abd'))
  assert.match(checksum('x'), /^[0-9a-f]{8}$/)
})

const backup = buildBackup({ appState: APP, storeState: STORE, appDataVersion: 6, shopName: 'بقالة النور', now: '2026-09-14T22:10:00.000Z' })

ok('بنية النسخة: صيغة وإصدار وبصمة', () => {
  assert.equal(backup.format, BACKUP_FORMAT)
  assert.equal(backup.version, BACKUP_VERSION)
  assert.equal(backup.appDataVersion, 6)
  assert.equal(backup.checksum, checksum(JSON.stringify(backup.data)))
})

ok('اسم الملف آمن وواضح', () => {
  const n = backupFileName('بقالة النور/فرع 1', '2026-09-14T22:10:00.000Z')
  assert.ok(n.startsWith('shopsys-backup-'))
  assert.ok(n.endsWith('.json'))
  assert.ok(!n.includes('/') && !n.includes(' '))
  assert.ok(n.includes('2026-09-14'))
})

console.log('🔍 التحقق قبل الاستعادة')

ok('ذهاب وإياب: نسخة سليمة تمر', () => {
  const parsed = parseBackup(JSON.stringify(backup))
  assert.equal(parsed.shopName, 'بقالة النور')
})

ok('ملف ليس JSON يُرفض برسالة عربية', () => {
  assert.throws(() => parseBackup('not json'), /ليس JSON/)
})

ok('صيغة غريبة تُرفض', () => {
  assert.throws(() => parseBackup(JSON.stringify({ format: 'other', data: {} })), /ليس نسخة/)
})

ok('إصدار أحدث يُرفض بطلب التحديث', () => {
  assert.throws(() => parseBackup(JSON.stringify({ ...backup, version: 99 })), /أحدث/)
})

ok('العبث بالبيانات يكسر البصمة', () => {
  const tampered = JSON.parse(JSON.stringify(backup))
  tampered.data.store.state.sales.push({ id: 999 })
  assert.throws(() => parseBackup(JSON.stringify(tampered)), /بصمة/)
})

ok('العبث بالبصمة نفسها يُكشف', () => {
  assert.throws(() => parseBackup(JSON.stringify({ ...backup, checksum: 'deadbeef' })), /بصمة/)
})

ok('بيانات ناقصة تُرفض', () => {
  assert.throws(() => parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1, data: { app: null } })), /ناقصة/)
})

console.log('🔍 الملخص')

ok('ملخص النسخة يعدّ المحتوى صحيحاً (صيغة persist)', () => {
  const s = summarizeBackup(backup)
  assert.equal(s.items, 2)
  assert.equal(s.sales, 1)
  assert.equal(s.purchases, 0)
  assert.equal(s.journalEntries, 3)
  assert.equal(s.customers, 1)
})

ok('الملخص يقبل الحالة المباشرة بلا غلاف state', () => {
  const flat = buildBackup({ appState: APP, storeState: STORE.state, appDataVersion: 6, shopName: 'x' })
  const s = summarizeBackup(flat)
  assert.equal(s.items, 2)
  assert.equal(s.journalEntries, 3)
})

console.log(`\n${process.exitCode ? '💥 فشل الفحص' : `🎉 نجح الفحص — ${passed} اختباراً`}`)
