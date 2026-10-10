/**
 * v1.0.22 — مراجعة ما قبل الدفع (تدقيق 2026-10-10):
 *   • لا يُرسل أي شيء يحمل معرّف الجهاز قبل قبول الإصدار الحالي من الاتفاقية
 *     (المحدَّث الذي لم يوافق بعد على الإفصاح الجديد لا يرسل بياناته).
 *   • بلاغ التسجيل إلى Cloudflare يُقفل على قبول الاتفاقية، لا على الإعداد وحده.
 *   • حدّ الحجم في /register بالبايت (UTF-8) لا بالمحارف — النص العربي بايتان للمحرف.
 *   • النافذة الرئيسية تظهر بعد جاهزيتها، فتظهر شاشة التحميل وشريط التقدّم فوقها.
 *   • نص الاتفاقية يذكر أن تقارير تيليجرام تذهب لبوت العميل نفسه لا للمطوّر.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')

describe('مراجعة البوابات قبل الإرسال (v1.0.22)', () => {
  it('App.tsx: كل إرسال يحمل معرّف الجهاز مشروط بقبول الاتفاقية الحالية', () => {
    const app = read('src/App.tsx')
    expect(app).toMatch(/const legalAccepted = legal !== null/)
    // تنبيهات المطوّر
    expect(app).toMatch(/if \(!legalAccepted \|\| !useAppStore\.getState\(\)\.setup\.completed\) return/)
    expect(app).toMatch(/\}, \[setCloudData, legalAccepted\]\)/)
    // مزامنة الترخيص/الأعلام
    expect(app).toMatch(/useEffect\(\(\) => \{\n    if \(!legalAccepted\) return\n/)
    expect(app).toMatch(/return \(\) => \{ cancelled = true; clearInterval\(t\) \}\n  \}, \[setCloudData, legalAccepted\]\)/)
    // بلاغ التسجيل
    expect(app).toMatch(/if \(!setup\.completed \|\| !legalAccepted\) return/)
    expect(app).toMatch(/\}, \[setup\.completed, legalAccepted\]\)/)
  })

  it('worker.js: حدّ /register بالبايت عبر TextEncoder', () => {
    const worker = read('../tools/devbot/src/worker.js')
    expect(worker).toMatch(/new TextEncoder\(\)\.encode\(rawText\)\.byteLength > REG_MAX_BYTES/)
    expect(worker).not.toMatch(/rawText\.length > REG_MAX_BYTES/)
  })

  it('desktop/main.ts: النافذة مخفية حتى ready-to-show ثم تظهر، وتظهر عند خطأ التحميل', () => {
    const main = read('desktop/main.ts')
    expect(main).toMatch(/show: false/)
    expect(main).toMatch(/win\.once\('ready-to-show', \(\) => \{\s*if \(!win\.isDestroyed\(\)\) win\.show\(\)/)
    expect(main).toMatch(/function showLoadError[\s\S]*?win\.show\(\)/)
  })

  it('legal.ts: تقارير تيليجرام تُوصف بأنها لبوت العميل ولا تصل للمطوّر', () => {
    const legal = read('src/core/legal.ts')
    expect(legal).toMatch(/تقارير تيليجرام[^\n]*تُرسل إلى بوت تيليجرام خاص بك أنت[^\n]*BotFather/)
    expect(legal).toMatch(/ولا تمر عبر خوادم المطوّر ولا تصل إليه/)
  })
})
