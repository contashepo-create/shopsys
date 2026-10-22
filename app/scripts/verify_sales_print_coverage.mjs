/**
 * بوابة تغطية الرمز الضريبي — تفحص **كل موقع طباعة/إرسال** في صفحات المبيعات
 * على حدة، لا مجرد وجود `stampTax` في الملف.
 *
 * الخلل الذي منعت هذه البوابة رجوعه: زر «واتساب PDF» في فواتير المقاولات كان
 * يبني النموذج ويشاركه بلا ختم — بينما زر الطباعة بجانبه يختمه. الفحص القديم
 * (`source.includes('stampTax(')`) يمرّ لأن الكلمة موجودة في مكان آخر بالملف.
 *
 * القاعدة: لكل استدعاء طباعة/مشاركة، يجب أن يكون النموذج المُمرَّر قد خُتم في
 * الدالة المحيطة، أو أُنشئ عبر دالة/تعبير يحتوي ختماً (تتبّع حتى مستويين).
 * مستندات لا تحمل رمزاً بطبيعتها (بوليصة/تذكرة مطبخ/عقد إيجار/إذن استلام)
 * مستثناة صراحةً.
 */
import ts from 'typescript'
import { readFileSync } from 'node:fs'

const PRINT_CALLS = new Set([
  'printModelWithTemplate', 'openPrintPreview', 'printHtml', 'printToRoute',
  'renderInvoiceA4Html', 'renderReceiptHtml', 'shareDocPdfViaWhatsapp', 'shareDocImageViaWhatsapp',
])
/* مستندات غير ضريبية تُطبع من صفحات المبيعات (بوليصة نقل، تذكرة مطبخ، عقد، إذن استلام) */
const NON_TAX_MARKERS = ['renderWaybillHtml', 'renderKitchenTicketHtml', 'renderRentalContractHtml', 'buildWarehouseReceiptHtml', 'renderReportShell']
/* معاينة مسودة غير مرحّلة: لا تحمل رمزاً ضريبياً عمداً (الرمز للمستند الصادر).
   أي مسار غير مسودة في نفس الصفحة يبقى خاضعاً للفحص. */
const DRAFT_MARKERS = ['edPrintModel']
const STAMP = /(stampTax|maybeTaxBarcode|maybeTaxBarcodeSync|withTaxBarcodeSync|taxBarcodePayload|taxQrPayload)\s*\(|taxQrPayload/
const FILES = [
  'src/ui/pages/PosPage.tsx', 'src/ui/pages/SalesInvoicesPage.tsx', 'src/ui/pages/AdvancedSalesInvoicePage.tsx',
  'src/ui/pages/SaleReturnsPage.tsx', 'src/ui/pages/ActivityInvoicesHubs.tsx', 'src/ui/pages/ContractingInvoicesPage.tsx',
  'src/ui/pages/RentalContractsPage.tsx', 'src/ui/pages/RestaurantOrdersPage.tsx', 'src/ui/pages/TripsPage.tsx',
  'src/ui/pages/PrintSettingsPage.tsx',
]

/* صفحات تطبع مستندات شراء/عروض/مناقصات — خارج نطاق رمز البيع بقرار المالك */
const NON_SALES_FILES = ['PurchasesPage', 'PurchaseReturnsPage', 'PurchaseOrdersPage', 'QuotationsPage', 'AdvancedPurchaseInvoicePage', 'ContractingPages', 'ContractingDepthPages']
let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.error(`❌ ${name}`) } }

for (const file of FILES) {
  const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

  /* تعريفات حقيقية من الـAST (لا قصّ نصي عشوائي): لكل اسم، موضعه ونص مُهيّئه */
  const decls = []
  const collectDecls = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      decls.push({ name: node.name.text, pos: node.getStart(sf), text: node.initializer.getText(sf) })
    }
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      decls.push({ name: node.name.text, pos: node.getStart(sf), text: node.body.getText(sf) })
    }
    ts.forEachChild(node, collectDecls)
  }
  collectDecls(sf)

  const declText = (name, scopes, callPos) => {
    for (const scopeStart of scopes) {
      const candidates = decls.filter((d) => d.name === name && d.pos >= scopeStart && d.pos < callPos)
      if (candidates.length) return candidates.sort((a, b) => b.pos - a.pos)[0].text
    }
    const anywhere = decls.filter((d) => d.name === name && d.pos < callPos)
    return anywhere.length ? anywhere.sort((a, b) => b.pos - a.pos)[0].text : ''
  }
  const covers = (expr, depth = 0, scopes = [], callPos = 0, seen = new Set()) => {
    if (!expr) return false
    if (STAMP.test(expr)) return true
    if (depth >= 2) return false
    const ids = new Set((expr.match(/[A-Za-z_$][\w$]*/g) ?? []))
    for (const id of ids) {
      if (seen.has(id)) continue
      seen.add(id)
      const d = declText(id, scopes, callPos)
      if (d && d !== expr && covers(d, depth + 1, scopes, callPos, seen)) return true
    }
    return false
  }

  const sites = []
  const visit = (node, ancestors) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf)
      const simple = callee.split('.').pop()
      if (PRINT_CALLS.has(simple)) {
        const text = node.getText(sf)
        if (!NON_TAX_MARKERS.some((m) => text.includes(m)) && !DRAFT_MARKERS.some((m) => text.includes(m))) {
          const fnAncestors = [...ancestors].reverse().filter((n) => ts.isFunctionLike(n))
          const nearestText = fnAncestors.length ? fnAncestors[0].getText(sf) : ''
          const scopes = fnAncestors.map((n) => n.getStart(sf))
          const argText = node.arguments.map((a) => a.getText(sf)).join(', ')
          sites.push({
            line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            covered: STAMP.test(nearestText) || STAMP.test(text) || covers(argText, 0, scopes, node.getStart(sf)),
            snippet: text.slice(0, 90).replace(/\s+/g, ' '),
          })
        }
      }
    }
    ancestors.push(node)
    ts.forEachChild(node, (c) => visit(c, ancestors))
    ancestors.pop()
  }
  visit(sf, [])

  const bad = sites.filter((s) => !s.covered)
  ok(sites.length > 0, `${file}: عُثر على مسارات طباعة (${sites.length})`)
  ok(bad.length === 0, `${file}: ${bad.length} مسار طباعة/إرسال بلا رمز — ${bad.map((b) => `س${b.line}`).join('، ')}`)
  for (const b of bad) console.error(`   ↳ س${b.line}: ${b.snippet}`)
}

/* ─── اكتمال الجرد: أي صفحة جديدة تبني نموذج مستند وتطبعه/تشاركه يجب أن تدخل
   البوابة أو تُدرج صراحةً كمستند غير ضريبي — وإلا تفلت من الفحص بصمت. ─── */
import { readdirSync } from 'node:fs'
const pages = readdirSync(new URL('../src/ui/pages', import.meta.url)).filter((f) => f.endsWith('.tsx'))
const coveredNames = new Set(FILES.map((f) => f.split('/').pop()))
const uncovered = []
for (const page of pages) {
  const name = page.replace('.tsx', '')
  if (coveredNames.has(page) || NON_SALES_FILES.includes(name)) continue
  const source = readFileSync(new URL(`../src/ui/pages/${page}`, import.meta.url), 'utf8')
  if (/(buildReceiptModel|buildSimpleDocModel)\(/.test(source) && /(printModelWithTemplate|shareDocPdfViaWhatsapp|openPrintPreview)\(/.test(source)) {
    uncovered.push(page)
  }
}
ok(uncovered.length === 0, `صفحات تبني وتطبع مستنداً ولم تُدرج في بوابة التغطية: ${uncovered.join('، ') || '—'}`)

console.log(`PASS=${pass} FAIL=${fail}`)
if (fail > 0) process.exit(1)
console.log(`🎉 كل مسارات طباعة المبيعات مختومة — ${pass} ملفاً مسحوباً`)
