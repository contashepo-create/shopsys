/**
 * بوابة أرصدة الأطراف (v1.0.23) — فحوص بنيوية: كل قائمة أو سند يقرأ الرصيد من مصدر
 * المتجر الموحّد (كشف الطرف الكامل)، لا من حساب جزئي يُعيد إنشاء الكشف بمدخلات ناقصة.
 * السلوك نفسه مختبر في tests/party_balance_sync.test.ts.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (rel) => readFileSync(join(root, rel), 'utf8')
const parties = read('src/ui/pages/PartiesPages.tsx')
const vouchers = read('src/ui/pages/VouchersPage.tsx')
const repo = read('src/data/repo.ts')

let failures = 0
const check = (name, cond) => {
  if (cond) console.log(`✓ ${name}`)
  else { failures++; console.log(`❌ ${name}`) }
}

check('قائمة الموردين تقرأ الرصيد من getSupplierBalance', /map\.set\(s\.id, getSupplierBalance\(s\.id\)\)/.test(parties))
check('قائمة الموردين لم تعد تبني الكشف بمدخلات ناقصة', !/supplierStatement\(\{\s*supplierId: s\.id/.test(parties))
check('قائمة العملاء تقرأ الرصيد من getCustomerBalance', /map\.set\(c\.id, getCustomerBalance\(c\.id\)\)/.test(parties))
check('اعتماديات أرصدة الموردين تشمل journal (كل ترحيل مالي يغيّره)', /\}, \[suppliers, getSupplierBalance, journal,/.test(parties))
check('اعتماديات أرصدة العملاء تشمل journal', /\}, \[customers, getCustomerBalance, journal,/.test(parties))
check('الرصيد الحي في السندات يقرأ من المتجر (لا كشف مبني يدوياً)', /return kind === 'receipt' \? getCustomerBalance\(partyId\) : getSupplierBalance\(partyId\)/.test(vouchers))
check('لا كشف يُبنى يدوياً في شاشة السندات', !/customerStatement\(\{|supplierStatement\(\{/.test(vouchers))
check('كشف المورد في المتجر يشمل فواتير البيع الآجلة له', /state\.sales\.filter\(\(sl\) => sl\.partyKind === 'supplier' && sl\.partyId === supplierId\)/.test(repo))

console.log(failures === 0 ? '✅ بوابة أرصدة الأطراف: كل الفحوص نجحت' : `❌ بوابة أرصدة الأطراف: ${failures} فحص فشل`)
process.exit(failures === 0 ? 0 : 1)
