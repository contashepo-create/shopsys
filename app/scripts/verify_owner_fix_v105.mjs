#!/usr/bin/env node
/**
 * بوابة جولة v1.0.5 — بلاغا المالك الميدانيان على النسخة المثبتة:
 *   ① «عندما أردت أن أستخدم الرصيد بالسالب منعني رغم تفعيله سواء نقود أو مخزن»
 *   ② «كشف حساب موظف يحسب بشكل خاطئ»
 *
 * تفحص البوابة أن الجذور الثلاثة للعلل موجودة في الكود ولم تُرَجَّع:
 *   1. حارس الخزينة يقرأ الإعداد من المتجر الحي (لا localStorage النصي الذي
 *      يبقى فارغاً في سطح المكتب لأن persist يكتب SQLite).
 *   2. الحارس يرفض فقط ما يُعمّق السالبية — لا يرفض القبض الذي يُقلّصها.
 *   3. الفاتورة المتقدمة تمرر allowNegativeStock حياً من الإعداد.
 *   4. كشف الموظف: تسميات الرصيد باتجاه الحساب (الموجب=له) وقيمة العملية ممتلئة.
 *   5. المعادلة الدفترية للكشف 2104+2116+1107 مثبتة بالاختبار الدائم.
 */
import { readFileSync } from 'node:fs'

const ROOT = new URL('../', import.meta.url).pathname
const read = (p) => readFileSync(ROOT + p, 'utf8')
let failed = 0
const check = (name, ok) => {
  console.log(`${ok ? '✓' : '✗'} ${name}`)
  if (!ok) failed++
}

/* ─── ① علة الخزينة السالبة: القراءة الحية من المتجر ─── */
const repo = read('src/data/repo.ts')
check('① حارس الخزينة يقرأ useAppStore.getState() الحي', repo.includes("useAppStore.getState().setup.allowNegativeTreasury === true"))
check('① الحارس يقارن بالرصيد القبلي (يرفض ما يُعمّق السالبية فقط)', repo.includes('bal < 0 && bal < (prevBalances.get(code) ?? 0)'))
check('① رسالة الرفض تسمّي مفتاح الخزائن وتفصله عن مفتاح المخزون', repo.includes('السماح بالرصيد السالب في الخزائن والبنوك'))
check('① لا قراءة نصية مباشرة بلا تراجع حي', !repo.includes("if (raw) allow = JSON.parse(raw)?.state?.setup?.allowNegativeTreasury === true\n  } catch { /* الافتراضي: ممنوع */ }\n  if (allow) return"))

/* ─── ② علة المخزون في الفاتورة المتقدمة: قراءة حية لا نسخة منتهية ─── */
const adv = read('src/ui/pages/AdvancedSalesInvoicePage.tsx')
const liveNeg = [...adv.matchAll(/allowNegativeStock:\s*setup\.allowNegativeStock,/g)].length
check('② الترحيل والتعديل يمرران setup.allowNegativeStock حياً (postSale + editSale)', liveNeg >= 2)

/* ─── ③ كشف الموظف: التسميات والقيمة ─── */
const stmt = read('src/ui/pages/StatementsPage.tsx')
check('③ تسمية رصيد الموظف الموجب = «له (مستحق)» باتجاه الحساب', stmt.includes("positive: 'رصيد له (مستحق)'"))
check('③ تسمية رصيد الموظف السالب = «عليه (سلف قائمة)»', stmt.includes("negative: 'رصيد عليه (سلف قائمة)'"))
check('③ عمود «قيمة العملية» يمتلئ في كشف الموظف', stmt.includes('operationMinor: Math.max(row.debitMinor, row.creditMinor) || undefined'))

/* ─── ④ الاختبارات الدائمة للبلاغين ─── */
const negTest = read('tests/negative_balance_settings.test.ts')
check('④ اختبار محاكاة سطح المكتب (localStorage فارغ) موجود', negTest.includes('محاكاة SQLite persist') && negTest.includes('localStorage.clear()'))
const empTest = read('tests/employee_statement_math.test.ts')
check('④ المعادلة الدفترية 2104+2116+1107 مثبتة بالاختبار', empTest.includes('bal2104 + bal2116 + bal1107'))
check('④ قيمة السيناريو مثبتة رقمياً (−20000: عليه 200)', empTest.includes("toBe(-20000)"))

console.log(failed === 0 ? '\nبوابة v1.0.5: ✓ كل فحوص البلاغين سليمة' : `\nبوابة v1.0.5: ✗ ${failed} فحص فاشل`)
process.exit(failed === 0 ? 0 : 1)
