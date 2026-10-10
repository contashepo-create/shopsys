/**
 * بوابة زر واتساب لكل فاتورة (v1.0.23) — فحوص بنيوية:
 * فاتورة البيع (للعميل/المورد/الموظف) وفاتورة الشراء (للمورد) تملكان زر إرسال لكل سطر،
 * يستعمل رقم الطرف من بطاقته، ويُعطَّل بلا رقم، ويمر عبر الوجه الموحّد shareDocPdfViaWhatsapp.
 * السلوك نفسه مختبر في tests/whatsapp_party.test.ts.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (rel) => readFileSync(join(root, rel), 'utf8')
const sales = read('src/ui/pages/SalesInvoicesPage.tsx')
const purchases = read('src/ui/pages/PurchasesPage.tsx')
const core = read('src/core/whatsapp.ts')

let failures = 0
const check = (name, cond) => {
  if (cond) console.log(`✓ ${name}`)
  else { failures++; console.log(`❌ ${name}`) }
}

check('core: saleWaParty و purchaseWaParty مُصدَّرتان', /export function saleWaParty\(/.test(core) && /export function purchaseWaParty\(/.test(core))
check('الفواتير: زر الإرسال يستعمل رقم الطرف من بطاقته (saleWaParty)', /saleWaParty\(s, \{ customers, suppliers, employees \}\)/.test(sales))
check('فواتير البيع: الزر يُعطَّل بلا رقم', /disabled=\{!party\?\.phone\}/.test(sales))
check('فواتير البيع: الإرسال يمر عبر الوجه الموحّد shareDocPdfViaWhatsapp', /sendSaleWhatsapp = async[\s\S]*?shareDocPdfViaWhatsapp\(\{[\s\S]*?partyPhone: party\.phone/.test(sales))
check('فواتير البيع: الطباعة والإرسال يشتركان في buildSaleModel', /const buildSaleModel = async/.test(sales) && /const model = await buildSaleModel\(s\)/.test(sales))
check('فواتير البيع: القائمة تستقبل الموردين (بيع لمورد)', /const \{ sales, customers, suppliers,/.test(sales))
check('فواتير الشراء: زر الإرسال يستعمل رقم المورد (purchaseWaParty)', /purchaseWaParty\(p\.supplierId, suppliers\)/.test(purchases))
check('فواتير الشراء: الزر يُعطَّل بلا رقم', /disabled=\{!party\?\.phone\}/.test(purchases))
check('فواتير الشراء: الإرسال يمر عبر shareDocPdfViaWhatsapp', /sendPurchaseWhatsapp = \(inv: PurchaseInvoice\)[\s\S]*?shareDocPdfViaWhatsapp\(\{/.test(purchases))
check('فواتير الشراء: الطباعة والإرسال يشتركان في buildPurchaseModel', /const buildPurchaseModel = /.test(purchases) && /printModelWithTemplate\(buildPurchaseModel\(inv\)/.test(purchases))

console.log(failures === 0 ? '✅ بوابة زر واتساب: كل الفحوص نجحت' : `❌ بوابة زر واتساب: ${failures} فحص فشل`)
process.exit(failures === 0 ? 0 : 1)
