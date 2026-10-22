/**
 * بوابة الوقت والتاريخ — تمنع عودة عيب UTC في المستندات المحاسبية.
 *
 * الخلل الذي تمنعه: `new Date().toISOString().slice(0,10)` يعطي يوم UTC، ففاتورة
 * الساعة 01:00 في القاهرة (UTC+2/+3) تُرحَّل بتاريخ أمس، وساعة الطباعة تنقص 2–3 ساعات.
 * الفحص لا «يقرأ الكود بعينه»: يشغّل الدوال فعلياً في منطقتين زمنيتين مختلفتين
 * (شرق وجنوب خط جرينتش) ويثبت النتيجة، ثم يمنع التعبير الخام في الشيفرة.
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.error(`❌ ${name}`) } }

/* ① سلوك فعلي تحت منطقتين زمنيتين */
const probe = (tz) => {
  const code = `
    import { todayLocalIso, localDateIso, localDateTimeLabel } from '${fileURLToPath(new URL('../src/core/time.ts', import.meta.url))}'
    const instant = new Date('2026-10-22T01:00:00+03:00')   // 22:00 UTC يوم 21
    console.log(JSON.stringify({
      today: todayLocalIso(instant),
      date: localDateIso('2026-10-21T22:00:00Z'),
      label: localDateTimeLabel('2026-10-21T22:00:00Z'),
      plain: localDateTimeLabel('2026-10-22'),
      invalid: localDateTimeLabel('not-a-date'),
      docStamp: localDateTimeLabel('2026-07-15T12:00:00.000+03:00'),
      docDay: localDateIso('2026-07-15T00:30:00.000+03:00'),
    }))
  `
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', code], {
    encoding: 'utf8', env: { ...process.env, TZ: tz },
  })
  if (r.status !== 0) { console.error(r.stderr); return null }
  return JSON.parse(r.stdout.trim())
}
const cairo = probe('Africa/Cairo')
const newYork = probe('America/New_York')
ok(cairo && cairo.today === '2026-10-22', 'القاهرة: لحظة 01:00 محلياً ⇒ تاريخ اليوم 22 لا 21')
ok(cairo && cairo.date === '2026-10-22' && cairo.label === '2026-10-22 01:00', 'القاهرة: العرض 01:00 كما حدث فعلاً')
ok(newYork && newYork.today === '2026-10-21', 'نيويورك: نفس اللحظة ليست 22 هناك (الإصلاح ليس تغييراً أعمى)')
ok(newYork && newYork.label === '2026-10-21 18:00', 'نيويورك: العرض بالتوقيت المحلي 18:00')
ok(cairo && cairo.plain === '2026-10-22' && cairo.invalid === 'not-a-date'.slice(0, 16), 'التاريخ المجرد يبقى كما هو والقيمة الفاسدة لا تُرمى')
/* ختم محلي بإزاحته: ساعته ساعة المستند — لا تتغير بمنطقة العارض ولا بفصل السنة */
ok(cairo && cairo.docStamp === '2026-07-15 12:00', 'القاهرة: ختم يوليو +03 يُعرض 12:00 كما كُتب', cairo?.docStamp)
ok(newYork && newYork.docStamp === '2026-07-15 12:00', 'نيويورك: نفس المستند يعرض 12:00 (ساعة المستند لا ساعة العارض)', newYork?.docStamp)
ok(cairo && cairo.docDay === '2026-07-15' && newYork && newYork.docDay === '2026-07-15', 'يوم المستند من ختمه المحلي لا من إزاحة العارض')

/* ② منع التعبير الخام في الشيفرة (خارج time.ts) */
const root = fileURLToPath(new URL('../src', import.meta.url))
const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const full = join(dir, name)
  return statSync(full).isDirectory() ? walk(full) : [full]
})
const offenders = []
for (const file of walk(root)) {
  if (!/\.(ts|tsx)$/.test(file) || file.endsWith('/core/time.ts')) continue
  const src = readFileSync(file, 'utf8')
  if (/toISOString\(\)\.slice\(0,\s*10\)/.test(src)) offenders.push(file.replace(root + '/', 'src/'))
}
ok(offenders.length === 0, `لا تاريخ UTC خام في الشيفرة — وجدت: ${offenders.slice(0, 6).join('، ') || '—'}`)

/* ③ ترحيل المستندات يستخدم الختم المحلي لا UTC */
const repo = readFileSync(new URL('../src/data/repo.ts', import.meta.url), 'utf8')
ok(repo.includes('const now = localIsoTimestamp()'), 'repo: تواريخ المستندات تُبنى بختم محلي')
ok(/const stamp = localIsoTimestamp\(\w*\)/.test(repo), 'repo: ختم لحظة البيع محلي لا UTC')
ok(repo.includes('localTimestampOnDay(postingDate, at)'), 'repo: الفاتورة المؤرَّخة تأخذ إزاحة يومها لا إزاحة اليوم')
ok(!/date: new Date\(\)\.toISOString\(\)/.test(repo), 'repo: لا تاريخ مستند من UTC الخام')

/* ④ ذوات «اليوم/الشهر» للجديد: لا تُشتق من UTC في أي واجهة أو نواة */
const walk2 = (dir) => readdirSync(dir).flatMap((name) => {
  const full = join(dir, name)
  return statSync(full).isDirectory() ? walk2(full) : [full]
})
const utcMonth = []
const utcTodayArgs = []
for (const file of walk2(root)) {
  if (!/\.(ts|tsx)$/.test(file) || file.endsWith('/core/time.ts')) continue
  const src = readFileSync(file, 'utf8')
  if (/new Date\(\)\.toISOString\(\)\.slice\(0,\s*7\)/.test(src)) utcMonth.push(file.replace(root + '/', 'src/'))
  for (const m of src.matchAll(/([A-Za-z_$][\w$]*(?:Warnings|Overdue|Aging|Due)\()\s*[^\n]*?new Date\(\)\.toISOString\(\)/g)) {
    utcTodayArgs.push(`${file.replace(root + '/', 'src/')}: ${m[1]}`)
  }
  if (/promotionActiveOn\([^)]*new Date\(\)\.toISOString\(\)/.test(src)) utcTodayArgs.push(`${file.replace(root + '/', 'src/')}: promotionActiveOn`)
}
ok(utcMonth.length === 0, 'لا شهر مشتق من UTC (رواتب/تقارير)', utcMonth.slice(0, 5).join('، '))
ok(utcTodayArgs.length === 0, 'لا «اليوم» مشتق من UTC في تنبيهات/سريان', utcTodayArgs.slice(0, 5).join('، '))

/* ⑤ لا رياضيات تواريخ على كائنات UTC ثم تُقرأ بمنطقة محلية (عيب انزياح اليوم غرباً) */
const utcMath = []
for (const file of walk(root)) {
  if (!/\.(ts|tsx)$/.test(file) || file.endsWith('/core/time.ts')) continue
  const src = readFileSync(file, 'utf8')
  const name = file.replace(root + '/', 'src/')
  src.split('\n').forEach((line, i) => {
    if (/toISOString\(\)\.slice\(0,\s*10\)/.test(line)) utcMath.push(`${name}:${i + 1} قص UTC`)
    // داخل النواة: التاريخ المجرّد يُبنى بـUTC ويُقرأ بـcalendarDateIso فقط.
    // قراءته بـtodayLocalIso (getFullYear/getMonth) تُزيح اليوم غرب جرينتش.
    if (name.includes('/core/') && !name.endsWith('/core/time.ts') && /todayLocalIso\(\s*[^)\s]/.test(line)) {
      utcMath.push(`${name}:${i + 1} تاريخ مجرّد يُقرأ محلياً`)
    }
  })
}
ok(utcMath.length === 0, 'لا كائن UTC يُقرأ كتاريخ محلي — استخدم calendarDateIso/addCalendarMonths', utcMath.slice(0, 5).join('، '))

/* ⑥ المستندات المخزّنة تعرض بتوقيت المستخدم (نموذج الطباعة) */
const receipt = readFileSync(new URL('../src/core/receipt.ts', import.meta.url), 'utf8')
ok(receipt.includes('localDateTimeLabel(args.dateIso)'), 'نموذج الطباعة يعرض توقيت المستخدم لا UTC')

console.log(`PASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
console.log(`🎉 فحص الوقت والتواريخ — ${pass} اختباراً`)
