/**
 * فحص آلي asserted لمطابقة «ما يرحّله المحرك» مع «ما تُظهره الشجرة»؛ مستورد ضمن verify_engine_tree_alignment.mjs.
 * يقرأ أكواد الحسابات الحرفية من ملفات النواة التي تبني القيود، ينسِبُها إلى
 * الوحدات حسب ملفها، ثم يقارنها بخريطة ACCOUNT_MODULE_MAP والشجرة المفلترة
 * لكل نشاط (وحداته الأصلية + الوحدات المطعَّمة).
 *
 * تشغيل: node --experimental-strip-types scripts/audit_engine_tree_alignment.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ACTIVITY_TEMPLATES, ALL_MODULES, effectiveModules } from '../src/core/activities.ts'
import { coaForModules, ACCOUNT_MODULE_MAP } from '../src/core/coaVisibility.ts'
import { STANDARD_COA } from '../src/core/ledger.ts'

const core = new URL('../src/core/', import.meta.url)
const read = (f) => readFileSync(fileURLToPath(new URL(f, core)), 'utf8')

/** ملفات النواة التي تبني قيود المحرك → الوحدة التي تنتمي إليها */
const ENGINE = {
  pos: ['pos.ts', 'returns.ts', 'loyalty.ts'],
  inventory: ['stocktake.ts', 'wastage.ts', 'consumption.ts'],
  purchases: ['purchases.ts'],
  maintenance: ['maintenance.ts'],
  laundry: ['laundry.ts'],
  equipment_rental: ['rental.ts', 'rentalMeter.ts'],
  logistics: ['logistics.ts'],
  lab: ['lab.ts'],
  clinic: ['clinic.ts'],
  contracting: ['contracting.ts', 'projectOps.ts'],
  cars: ['cars.ts'],
  realestate: ['realestate.ts'],
  jewelry: ['jewelry.ts'],
  recipes: ['recipes.ts', 'processing.ts'],
  wallet_services: ['walletServices.ts'],
}
/** ملفات محايدة (خدمات عامة مفعّلة دائماً) — لا تُنسب لوحدة */
const NEUTRAL = ['accounting.ts', 'treasury.ts', 'custody.ts', 'cheques.ts', 'assets.ts', 'payroll.ts', 'payrollSlips.ts', 'fxTreasury.ts', 'settlement.ts', 'openingBalances.ts', 'commissions.ts', 'staffCommissions.ts', 'insurance.ts', 'fiscal.ts', 'advancedInvoice.ts', 'serviceRefund.ts']

const codesOf = (file) => [...new Set([...read(file).matchAll(/'([1-5][0-9]{3})'/g)].map((m) => m[1]))]

const coa = STANDARD_COA
const codeName = (c) => coa.find((a) => a.code === c)?.nameAr ?? '؟'

console.log('═══ ① حسابات يرحّلها المحرك ولا تنسبها خريطة الوحدات لأي وحدة (تبقى «عامة» لكل الأنشطة) ═══')
const mapped = new Set(Object.keys(ACCOUNT_MODULE_MAP))
const unmappedUsed = new Map() // code -> [modules]
for (const [mod, files] of Object.entries(ENGINE)) {
  for (const f of files) {
    for (const c of codesOf(f)) {
      if (mapped.has(c)) continue
      const arr = unmappedUsed.get(c) ?? []
      arr.push(`${mod}/${f}`)
      unmappedUsed.set(c, arr)
    }
  }
}
for (const [c, where] of [...unmappedUsed.entries()].sort()) {
  console.log(`  • ${c} «${codeName(c)}» — يرحَّل من: ${where.join(' · ')} — غير مذكور في الخريطة ⇒ ظاهر في كل نشاط`)
}
{
  const neutralCodes = new Set()
  for (const f of NEUTRAL) for (const c of codesOf(f)) if (!mapped.has(c)) neutralCodes.add(c)
  console.log(`\n  (الملفات المحايدة — خدمات عامة لا تُنسب لوحدة: ${NEUTRAL.length} ملفاً، تُضيف ${neutralCodes.size} حساباً حراً مثل 1102 البنك · 3101 رأس المال · 5102 الرواتب — كلها عامة بحكم التصميم)`)
}

console.log('\n═══ ② ثقوب محتملة: وحدة مفعّلة يرحّل محركها على حساب مخفي عنها (قبل أول حركة) ═══')
{
  let holes = 0
  for (const tpl of ACTIVITY_TEMPLATES) {
    const mods = effectiveModules(tpl.id, [])
    const visible = new Set(coaForModules(coa, mods).map((a) => a.code))
    for (const m of mods) {
      for (const f of ENGINE[m] ?? []) {
        for (const c of codesOf(f)) {
          if (visible.has(c)) continue
          console.log(`  ✗ ${tpl.id} — الوحدة «${m}» مفعّلة، لكن ${c} «${coa.find((a) => a.code === c)?.nameAr ?? '؟'}» (${f}) مخفي. سبب الخريطة: ${JSON.stringify(ACCOUNT_MODULE_MAP[c] ?? null)}`)
          holes++
        }
      }
    }
  }
  if (!holes) console.log('  ✓ لا ثقب: كل حساب يرحّله محرك وحدةٍ مفعّلة ظاهر في شجرة النشاط')
  assert.equal(holes, 0, 'يوجد حساب يرحّله محرك وحدة مفعّلة لكنه مخفي عن شجرة النشاط')
}

console.log('\n═══ ③ الوحدات المطعَّمة (نشاط × وحدة إضافية): هل تكفي حساباتها وحدها؟ ═══')
{
  const rows = []
  for (const tpl of ACTIVITY_TEMPLATES) {
    const native = effectiveModules(tpl.id, [])
    for (const extra of ALL_MODULES) {
      if (native.includes(extra)) continue
      const grafted = effectiveModules(tpl.id, [extra])
      const visible = new Set(coaForModules(coa, grafted).map((a) => a.code))
      const missing = []
      for (const f of ENGINE[extra] ?? []) for (const c of codesOf(f)) if (!visible.has(c)) missing.push(`${c}«${coa.find((a) => a.code === c)?.nameAr ?? '؟'}»`)
      if (missing.length) rows.push({ activity: tpl.id, extra, missing: [...new Set(missing)] })
    }
  }
  if (!rows.length) console.log('  ✓ كل الوحدات المطعَّمة تجد حساباتها ظاهرة في كل الأنشطة')
  for (const r of rows) console.log(`  ✗ ${r.activity} + ${r.extra} ⇒ ناقص: ${r.missing.join(' · ')}`)
  assert.deepEqual(rows, [], 'توجد تركيبة وحدة مطعّمة تفتقد حساباً يرحّله محركها')
}

console.log('\n═══ ④ تسريب: حسابات نشاطٍ تظهر في نشاط لا يملك وحدته ═══')
{
  const allMods = new Set(ALL_MODULES)
  const leaks = new Map() // code -> activities
  for (const tpl of ACTIVITY_TEMPLATES) {
    const mods = effectiveModules(tpl.id, [])
    const visible = new Set(coaForModules(coa, mods).map((a) => a.code))
    for (const [code, need] of Object.entries(ACCOUNT_MODULE_MAP)) {
      if (!need.every((m) => allMods.has(m))) continue
      if (visible.has(code) && !need.some((m) => mods.includes(m))) {
        leaks.set(code, [...(leaks.get(code) ?? []), tpl.id])
      }
    }
  }
  if (!leaks.size) console.log('  ✓ لا تسريب وفق الخريطة الحالية')
  for (const [c, list] of leaks) console.log(`  • ${c} «${coa.find((a) => a.code === c)?.nameAr}» يظهر في: ${list.slice(0, 4).join(', ')}${list.length > 4 ? ` … (+${list.length - 4})` : ''}`)
  assert.equal(leaks.size, 0, 'يوجد حساب تخصصي ظاهر لنشاط لا يملك وحدته وفق خريطة الحسابات')
}

console.log('\n═══ ⑤ جدول: لكل نشاط — وحداته وحسابات محركه المخفية ═══')
for (const tpl of ACTIVITY_TEMPLATES) {
  const mods = effectiveModules(tpl.id, [])
  const visible = new Set(coaForModules(coa, mods).map((a) => a.code))
  const hidden = []
  for (const m of mods) for (const f of ENGINE[m] ?? []) for (const c of codesOf(f)) if (!visible.has(c)) hidden.push(c)
  console.log(`  ${tpl.id.padEnd(20)} وحدات: ${mods.join(',')}${hidden.length ? `  ⚠ مخفي: ${[...new Set(hidden)].join(',')}` : ''}`)
}
