/**
 * 🧾 فحص دائم — كشف مصروفات المشروع التفصيلي (طلب المالك — بندا ٨ و١٠):
 *  أ) سطر مستقل لكل بند فاتورة، وسطر مستندي للمستندات القديمة بلا بنود.
 *  ب) الإجماليات من المستندات لا من السطور (المدفوع/الآجل لا يتضاعفا بعدد البنود).
 *  ج) لقطات التصنيفات الحرة والتاريخ والمرجع والمورد ومصدر السداد ورقم القيد تصل للسطر.
 *  د) التصدير: أعداد الأعمدة متطابقة، والمبالغ أرقام بوحدة الكبرى، وExcel XML/CSV يحتويان البيانات.
 *  هـ) الواجهة: بطاقة الكشف في صفحة المصروفات وتقارير المقاولات بأزرار طباعة/Excel.
 *
 * تشغيل: node --experimental-strip-types scripts/verify_project_expense_ledger.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const mem = new Map()
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { done: true, requireOpenShiftForSales: false, allowNegativeTreasury: true, vatPercent: 14, taxInclusive: true, activityId: 'contracting', countryCode: 'EG' }, license: { plan: 'pro' } } }))

let pass = 0
const ok = (cond, name) => { assert.ok(cond, name); pass++; console.log('  ✓', name) }
const eq = (a, b, name) => { assert.equal(a, b, `${name} — الفعلي ${a}`); pass++; console.log('  ✓', name) }

const { useDataStore } = await import(`${pathToFileURL(join(root, 'src/data/repo.ts')).href}?pexledger=1`)
const { buildProjectExpenseLedger, PROJECT_EXPENSE_LEDGER_HEADERS, projectExpenseLedgerExportRow } = await import(`${pathToFileURL(join(root, 'src/core/projectExpenseLedger.ts')).href}?pexledger=1`)
const { sheetsToExcelXml, sheetToCsv } = await import(`${pathToFileURL(join(root, 'src/core/fullExport.ts')).href}?pexledger=1`)

const S = () => useDataStore.getState()
S().seed([])
const EXT = { taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' }
S().addCustomer({ nameAr: 'عميل الكشف', phone: '0100', notes: '', creditLimitMinor: 0, ...EXT })
const client = S().customers.at(-1)
S().addSupplier({ nameAr: 'مورد الوقود', phone: '0120', notes: '', ...EXT })
const supplier = S().suppliers.at(-1)
const prj = S().addProject({ nameAr: 'مشروع الكشف', clientName: client.nameAr, clientId: client.id, contractValueMinor: 100000000, retentionPercent: 10, startDate: '2026-10-01', notes: '' })

const winch = S().addProjectExpenseCategory('إيجار ونش برجي', 'equipment')
// مستند مصروف متعدد البنود (بندان) بأثر رجعي وسداد مختلط
S().addProjectCost({
  projectId: prj.id, payment: 'mixed',
  supplierId: supplier.id, invoiceRef: 'فاتورة 77/2026', date: '2026-10-05',
  lines: [
    { description: 'إيجار ونش برجي شهر أكتوبر', kind: 'equipment', categoryId: winch.id, qty: 1, unitPriceMinor: 5000000, vatPercent: 14, taxMode: 'exclusive' },
    { description: 'سولار', kind: 'materials', qty: 200, unitPriceMinor: 1500, vatPercent: 14, taxMode: 'inclusive' },
  ],
  paidMinor: 3000000, treasury: S().treasuries[0]?.code ?? 'main',
})
// مستند قديم الطراز (مبلغ واحد بلا بنود)
S().addProjectCost({ projectId: prj.id, payment: 'cash', kind: 'labor', amountMinor: 750000, description: 'أجور نقداً' })

const costs = S().projectCosts.filter((c) => c.projectId === prj.id)
eq(costs.length, 2, 'أ: مستندان فقط')

const ledger = buildProjectExpenseLedger(costs, {
  supplierName: (id) => (id == null ? '—' : S().suppliers.find((x) => x.id === id)?.nameAr ?? `#${id}`),
  treasuryName: (code) => (code ? S().treasuries.find((x) => x.code === code)?.nameAr ?? code : ''),
  custodyLabel: () => 'عهدة موظف',
  boqLabel: () => '',
  journalEntryNumber: (entryId) => S().journal.find((e) => e.id === entryId)?.entryNumber ?? entryId,
})

eq(ledger.rows.length, 3, 'أ: 3 سطور (بندان + سطر مستندي قديم)')
eq(ledger.totals.docsCount, 2, 'أ: عدّ المستندات')
eq(ledger.totals.linesCount, 3, 'أ: عدّ البنود')

// إجماليات من المستندات
const netDocs = costs.reduce((a, c) => a + c.amountMinor, 0)
const vatDocs = costs.reduce((a, c) => a + (c.vatMinor ?? 0), 0)
eq(ledger.totals.netMinor, netDocs, 'ب: الصافي يطابق مجموع المستندات')
eq(ledger.totals.vatMinor, vatDocs, 'ب: الضريبة تطابق مجموع المستندات')
eq(ledger.totals.paidMinor, 3000000 + 750000, 'ب: المدفوع لا يتضاعف بعدد بنود المستند')
ok(ledger.totals.dueMinor > 0, 'ب: آجل موجب من السداد المختلط')
eq(ledger.totals.paidMinor + ledger.totals.dueMinor, ledger.totals.grossMinor, 'ب: مدفوع + آجل = الإجمالي')

// سطر الونش
const winchRow = ledger.rows.find((r) => r.lineDescription.includes('ونش'))
ok(!!winchRow, 'ج: سطر بند الونش موجود')
eq(winchRow.categoryName, 'إيجار ونش برجي', 'ج: لقطة التصنيف الحر على سطر الكشف')
eq(winchRow.kindName, 'معدات', 'ج: فئة الحوض')
eq(winchRow.date, '2026-10-05', 'ج: التاريخ بأثر رجعي')
eq(winchRow.invoiceRef, 'فاتورة 77/2026', 'ج: الفاتورة المرجعية')
eq(winchRow.supplierName, 'مورد الوقود', 'ج: اسم المورد')
eq(winchRow.sourceLabel, 'تسجيل يدوي', 'ج: مصدر المستند')
ok(winchRow.journalEntryNumber > 0, 'ج: رقم قيد حقيقي')
ok(winchRow.taxLabel.includes('14'), 'ج: حالة الضريبة على السطر')

const legacyRow = ledger.rows.find((r) => r.lineDescription === 'أجور نقداً')
ok(!!legacyRow, 'أ: سطر المستند القديم موجود ببيانه')
eq(legacyRow.netMinor, 750000, 'أ: صافي المستند القديم')
eq(ledger.rows[0].date <= ledger.rows.at(-1).date, true, 'أ: ترتيب زمني تصاعدي')

// التصدير
const firstExport = projectExpenseLedgerExportRow(winchRow, 2)
eq(firstExport.length, PROJECT_EXPENSE_LEDGER_HEADERS.length, 'د: أعمدة التصدير متطابقة')
eq(typeof firstExport[11], 'number', 'د: الصافي رقم بوحدة الكبرى')
eq(firstExport[11], 50000, 'د: تحويل القروش إلى جنيهات (50000)')
const sheet = { nameAr: 'مصروفات المشروع التفصيلية', headers: [...PROJECT_EXPENSE_LEDGER_HEADERS], rows: ledger.rows.map((r) => projectExpenseLedgerExportRow(r, 2)) }
const xml = sheetsToExcelXml([sheet], `كشف ${prj.code}`)
ok(xml.includes('مصروفات المشروع التفصيلية') && xml.includes('فاتورة 77/2026'), 'د: Excel XML يحمل الورقة والبيانات')
const csv = sheetToCsv(sheet)
ok(csv.startsWith('﻿') || csv.includes('مستند المصروف'), 'د: CSV بتنسيق النظام الموحد')

// الواجهة
const contractingPages = readFileSync(join(root, 'src/ui/pages/ContractingPages.tsx'), 'utf8')
const reports = readFileSync(join(root, 'src/ui/pages/ContractingReportsPage.tsx'), 'utf8')
const cardFile = readFileSync(join(root, 'src/ui/contracting/ProjectExpenseLedgerCard.tsx'), 'utf8')
ok(contractingPages.includes('<ProjectExpenseLedgerCard'), 'هـ: الكشف في صفحة مصروفات المشروع')
ok(reports.includes('<ProjectExpenseLedgerCard') && reports.includes('selectedLedger'), 'هـ: الكشف في تقارير المقاولات والطباعة الشاملة')
ok(reports.includes("nameAr: 'بطاقة المشروع'") && reports.includes("nameAr: 'المستخلصات'"), 'هـ: كشف Excel الشامل بثلاث أوراق')
ok(cardFile.includes('data-expense-ledger-excel') && cardFile.includes('data-expense-ledger-print'), 'هـ: أزرار طباعة/PDF وExcel موسومة')
ok(!cardFile.includes('printModelWithTemplate'), 'هـ: الطباعة بغلاف التقارير الموحد لا بقوالب الإيصال')

console.log(`\nPASS=${pass} FAIL=0`)
