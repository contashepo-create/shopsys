/**
 * فحص التهريب الشامل لقوالب الطباعة — يمرّ على **كل** ملف في src/ui/print
 * ويستخرج كل تعبير داخل `${...}`، ثم يرفض أي تعبير نهائي (بعد إزالة استدعادات
 * التهريب/التنسيق) يحتوي حقلاً نصياً يكتبه المستخدم.
 *
 * الغرض: لو أُضيف قالب أو حقل جديد بلا `esc(` لا يظهر في مراجعة بشرية، تسقط البوابة.
 */
import { readFileSync, readdirSync } from 'node:fs'

/* الجولة السادسة: الشعار والألوان تُستعاد من نسخة احتياطية وقد تحمل HTML/CSS
   خاماً داخل سمة src أو كتلة <style> — أضفناها لقائمة الحقول الخطرة. */
const TEXT_FIELD = /\b(nameAr|descriptionAr|customerName|partyName|shopName|sellerName|buyerName|notes|address|phone|plateNumber|driverName|companyName|supplierName|itemName|branchName|employeeName|patientName|doctorName|clientName|projectName|vehicleName|expenseNameAr|serviceNameAr|terms|clauses|contractNumber|invoiceNumber|refCode|taxNumber|returnNumber|watermarkText|footerText|headerLines|logoDataUrl|accentColor|watermarkColor)\b/
/** معرّفات تُمرَّر مهرَّبة إلى `kv` أو ثابتة — ليست حقول مستخدم خام */
const ALLOWED_IDENTIFIERS = new Set(['label', 'value'])

/** دوال تُنتج HTML مهرَّباً داخلياً أو أرقاماً فقط */
const SAFE_CALLS = ['.map(esc)', 'esc(', 'escHtml(', 'escAttr(', 'safeHexColor(', 'safeLogoUrl(', 'safeColor(', 'fmt(', 'formatMinor(', 'amountInWords(', 'barcodeSvg(', 'headerLinesHtml(', 'whoBlock(', 'footer(', 'renderRows(', 'renderTotals(', 'kv(', 'labels.join(', 'money(', 'toFixed(', 'formatQty(', 'dateLabel', 'todayLocalIso(', 'localDateTimeLabel(', 'modelRows(', 'itemsHtml(']

/** يحذف استدعاءات دوال آمنة (مع أقواسها) من تعبير */
function stripSafe(expr) {
  let out = expr
    .replace(/[A-Za-z_$][\w$.\[\]]*\.map\(\s*esc\s*\)\s*\.join\([^)]*\)/g, ' SAFE ')
    .replace(/[A-Za-z_$][\w$.\[\]]*\.map\(\s*\(?\s*[A-Za-z_$][\w$]*\s*\)?\s*=>\s*esc\([^)]*\)\s*\)\s*\.join\([^)]*\)/g, ' SAFE ')
  for (let guard = 0; guard < 50; guard++) {
    const hit = SAFE_CALLS.map((name) => ({ name, at: out.indexOf(name) })).filter((x) => x.at >= 0).sort((a, b) => a.at - b.at)[0]
    if (!hit) break
    const start = hit.at
    let i = start + hit.name.length - (hit.name.endsWith('(') ? 1 : 0)
    // ابحث عن '(' التابع للاسم
    const paren = out.indexOf('(', start)
    if (paren < 0) { out = out.slice(0, start) + out.slice(start + hit.name.length); continue }
    let depth = 0, end = -1
    for (let j = paren; j < out.length; j++) {
      if (out[j] === '(') depth++
      else if (out[j] === ')') { depth--; if (depth === 0) { end = j; break } }
    }
    if (end < 0) break
    out = out.slice(0, start) + ' SAFE ' + out.slice(end + 1)
  }
  return out
}

const dir = new URL('../src/ui/print/', import.meta.url)
const coreDir = new URL('../src/core/', import.meta.url)
let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.error(`❌ ${name}`) } }
const findings = []

/* الجولة السادسة: غلاف التقارير الرسمية في core/ لم يكن مشمولاً بالفحص،
   فمرّ حقن accentColor/logoDataUrl خاماً. يُفحص الآن مع قوالب ui/print. */
const scanTargets = [
  ...readdirSync(dir).filter((f) => f.endsWith('.ts')).sort().map((f) => ({ label: f, url: new URL(f, dir) })),
  ...['reportPrint.ts', 'formalReport.ts'].map((f) => ({ label: `core/${f}`, url: new URL(f, coreDir) })),
]

for (const { label: file, url } of scanTargets) {
  const src = readFileSync(url, 'utf8')
  const exprs = []
  for (let i = 0; i < src.length - 1; i++) {
    if (src[i] !== '$' || src[i + 1] !== '{') continue
    let depth = 1, j = i + 2, quote = null
    for (; j < src.length; j++) {
      const ch = src[j]
      if (quote) {
        if (ch === '\\') { j++; continue }
        if (ch === quote) quote = null
        continue
      }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
      if (ch === '{' || ch === '(' || ch === '[') depth++
      else if (ch === '}' || ch === ')' || ch === ']') { depth--; if (depth === 0) break }
    }
    if (depth === 0) { exprs.push([src.slice(i + 2, j), i]) }
    i = j
  }
  let checked = 0
  for (const [expr, index] of exprs) {
    /* نفحص ما يُطبَع فعلاً: التعابير الداخلية `${...}` إن وُجدت، وإلا التعبير نفسه.
       الحقل المستخدم في شرط فقط (`notes ? ... : ''`) ليس إخراجاً بحد ذاته. */
    const outputs = []
    for (let k = 0; k < expr.length - 1; k++) {
      if (expr[k] !== '$' || expr[k + 1] !== '{') continue
      let depth = 1, j = k + 2
      for (; j < expr.length; j++) {
        if (expr[j] === '{') depth++
        else if (expr[j] === '}') { depth--; if (depth === 0) break }
      }
      outputs.push(expr.slice(k + 2, j))
      k = j
    }
    const targets = outputs.length ? outputs : [expr]
    for (const target of targets) {
      const rest = stripSafe(target)
      const hit = TEXT_FIELD.exec(rest)
      if (!hit) continue
      const ident = rest.trim()
      if (ALLOWED_IDENTIFIERS.has(ident)) continue
      checked++
      const line = src.slice(0, index).split('\n').length
      findings.push(`${file}:${line} → ${target.trim().slice(0, 90)}`)
    }
  }
  ok(true, `${file}: ${checked} تعبيراً نصياً مفحوصاً`)
}

ok(findings.length === 0, `تعبيرات نصية غير مهرَّبة: ${findings.length}`)
for (const f of findings) console.error('   ↳ ' + f)

console.log(`PASS=${pass} FAIL=${fail}`)
if (fail) process.exit(1)
console.log(`🎉 كل قوالب الطباعة تمرّر النصوص عبر esc — ${pass} ملفاً`)
