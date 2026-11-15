/** فهرس آلي أولي لمواضع إدخال JSX، وليس حكماً بأن الحقل مطلوب أو غائب في التنفيذ. */
import ts from 'typescript'
import fs from 'node:fs'
import path from 'node:path'
const root = path.resolve('src/ui')
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(x => x.isDirectory() ? walk(path.join(dir, x.name)) : x.name.endsWith('.tsx') ? [path.join(dir, x.name)] : [])
const rows = []
for (const file of walk(root).sort()) {
  const text = fs.readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const visit = node => {
    if (ts.isJsxElement(node)) {
      const tag = node.openingElement.tagName.getText(sf)
      if (['Modal', 'SheetPanel', 'InvoicePOSFrame', 'form'].includes(tag)) {
        let inputs = 0, dates = 0
        const find = child => {
          if (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) {
            const name = child.tagName.getText(sf)
            if (['input', 'select', 'textarea', 'DecimalInput', 'QuickSelect', 'PartyQuickPicker'].includes(name)) inputs++
            if (name === 'input' && child.attributes.properties.some(p => ts.isJsxAttribute(p) && p.name.getText(sf) === 'type' && p.initializer && ts.isStringLiteral(p.initializer) && ['date', 'datetime-local'].includes(p.initializer.text))) dates++
          }
          ts.forEachChild(child, find)
        }
        ts.forEachChild(node, find)
        if (inputs) {
          const attrs = node.openingElement.attributes.properties
          const title = attrs.find(p => ts.isJsxAttribute(p) && p.name.getText(sf) === 'title')
          const label = title?.initializer && ts.isStringLiteral(title.initializer) ? title.initializer.text : '(عنوان ديناميكي أو غير محدد)'
          rows.push({ file: path.relative(process.cwd(), file).replaceAll('\\', '/'), line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, tag, label, inputs, dates })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}
const noDate = rows.filter(row => row.dates === 0)
console.log(`# فهرس آلي أولي لواجهات الإدخال\n\nنتيجة تحليل شيفرة JSX: ${rows.length} غلاف إدخال منها ${noDate.length} بلا input من نوع date أو datetime-local داخل الغلاف نصياً. هذا ليس حصراً نهائياً للفورمات التي تحتاج تاريخ معاملة: قد يكون التاريخ داخل مكوّن مستورد، أو حقل آخر خارج الغلاف، وقد تكون النافذة فلتراً أو إعداداً أو تحصيلاً لا يحتاج تاريخاً. ولا يحصي الواجهات التي لا تستخدم هذه الأغلفة، ولا يميز تاريخ استحقاق أو صلاحية عن تاريخ المعاملة. يجب مراجعة كل مرشح مع مسار الحفظ والأثر المالي يدوياً قبل التغيير.\n\nالأغلفة الممسوحة: Modal وSheetPanel وInvoicePOSFrame وform. يكرر الفهرس بعض المكونات المتداخلة. شُغّل من app بالأمر node scripts/inventory_date_forms.mjs.\n\n| الملف والسطر | الغلاف | العنوان النصي | عدد عناصر الإدخال التقريبي |\n|---|---|---|---:|`)
for (const row of noDate) console.log(`| \`${row.file}:${row.line}\` | ${row.tag} | ${row.label.replaceAll('|', '\\|')} | ${row.inputs} |`)
