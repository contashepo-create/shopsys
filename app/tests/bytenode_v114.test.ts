/**
 * جولة v1.0.14 — المرحلة ④: bytenode + تشويش المحرك الرئيسي.
 * يثبت سلسلة bytecode نفسها (تجميع ← ملف ← require يعيد الوحدة) في بيئة
 * الاختبار — توافق snapshot الإلكترون يضمنه electronMain:true وقت البناء
 * (داخل عملية رئيسية حقيقية)، والمحمل يرجع للاحتياط المشوش عند أي فشل.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, statSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('④ bytenode — سلسلة bytecode من التجميع إلى التشغيل', () => {
  it('compileFile ← require(.jsc) يعيد الوحدة كما هي (محمل main.cjs نفسه)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tahakom-jsc-'))
    try {
      const src = join(dir, 'mod.cjs')
      const jsc = join(dir, 'mod.jsc')
      writeFileSync(src, "module.exports = { ok: true, answer: 6 * 19, label: 'تَحَكَّم' }\n")
      /* نفس استدعاء build.mjs: compileFile compileAsModule (افتراضي) */
      execFileSync(process.execPath, ['-e', `const b=require('bytenode');b.compileFile({filename:${JSON.stringify(src)},output:${JSON.stringify(jsc)}}).then(()=>console.log('done'))`], { cwd: process.cwd(), stdio: 'pipe' })
      expect(existsSync(jsc)).toBe(true)
      expect(statSync(jsc).size).toBeGreaterThan(64) // ترويسة V8 + bytecode
      /* المحمل كما في main.cjs حرفياً: bytenode أولاً (يسجل امتداد .jsc) ثم الملف */
      const out = execFileSync(process.execPath, ['-e', `require('bytenode');const m=require(${JSON.stringify(jsc)});console.log(JSON.stringify(m))`], { cwd: process.cwd(), stdio: 'pipe' }).toString().trim()
      const parsed = JSON.parse(out) as { ok: boolean; answer: number; label: string }
      expect(parsed.ok).toBe(true)
      expect(parsed.answer).toBe(114)
      expect(parsed.label).toBe('تَحَكَّم')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)
})
