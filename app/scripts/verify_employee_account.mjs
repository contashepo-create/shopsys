/* بوابة: الموظف طرف كامل بحساب وكشف · زر المراجعة أسفل · فلترة طرق الدفع */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { reporter } from './auditKit.mjs'

const R = reporter('حساب الموظف · موضع زر المراجعة · فلترة وسائل الدفع')
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')
const repo = read('data/repo.ts')
const picker = read('ui/components/PaymentMethodPicker.tsx')
const frame = read('ui/components/InvoicePOSFrame.tsx')
const sales = read('ui/pages/AdvancedSalesInvoicePage.tsx')

{
  assert.ok(/getEmployeeBalance: \(employeeId: number\) => number/.test(repo), 'لا رصيد للموظف كطرف')
  assert.ok(/getEmployeeStatementRows: \(employeeId: number\)/.test(repo), 'لا كشف حساب للموظف')
  /* القاعدة المحاسبية (مساوية لقيد المسير 2104): الاستحقاق دائن بالصافي فقط،
     واستقطاع السلفة دائن لأنه سداد لدينها على 1107، والخصم بند توثيقي في البيان
     (أخفض مصروف 5102) — لا يُقيَّد على الموظف وإلا ازدوج. البوابة الحية
     (verify_owner_live_preview_batch) تثبت الرصيد صفراً بهذه المعادلة. */
  assert.ok(/debitMinor: 0, creditMinor: slip\.netMinor/.test(repo), 'استحقاق القسيمة ليس دائناً بالصافي فقط')
  assert.ok(/سلفة استُردت من الراتب \(سداد دين السلفة\)'.*debitMinor: 0, creditMinor: slip\.advanceMinor/s.test(repo), 'استقطاع السلفة ليس دائناً — الازدواج عاد')
  assert.ok(!/debitMinor: slip\.deductionsMinor/.test(repo), 'الخصومات لا تكون مدينة على الموظف (ازدواج)')
  assert.ok(/صرف راتب \$\{slipMonth\}/.test(repo) && /debitMinor: slip\.netMinor, creditMinor: 0/.test(repo), 'الصرف لا يصفّي رصيد الموظف')
  assert.ok(/سلفة استُردت من المسير/.test(repo), 'سلف المسير القديم لا تُسترد في الكشف')
  R.ok('كشف الموظف: استحقاق دائن بالصافي · استقطاع السلفة سداد دائن · الخصم توثيقي · الصرف يصفّي الرصيد')
}
{
  assert.ok(/partyKind\?: 'customer' \| 'supplier' \| 'employee' \| null/.test(repo), 'السندات لا تقبل الموظف كطرف')
  assert.ok(/state\.vouchers\.filter\(\(row\) => row\.partyKind === 'employee'/.test(repo), 'سندات الموظف لا تدخل كشفه')
  /* Â§93: مدين بكامل المبلغ إلا ما سدّد قسائم رواتب — سطر القسيمة نفسه موجود في الكشف فلا يزدوج */
  assert.ok(/const settledByVoucher = voucher\.kind === 'payment'/.test(repo), 'لا استثناء لسند تسديد القسائم — الازدواج عاد')
  assert.ok(/voucherDebit = voucher\.kind === 'payment' \? Math\.max\(0, voucher\.amountMinor - settledByVoucher\) : 0/.test(repo), 'سند الصرف للموظف لا يُقيَّد مديناً')
  assert.ok(/creditMinor: voucher\.kind === 'receipt' \? voucher\.amountMinor : 0/.test(repo), 'سند القبض من الموظف لا يُقيَّد دائناً')
  R.ok('سندا القبض والصرف يقبلان الموظف ويحدّثان رصيده مثل العميل')
}
{
  assert.ok(/restrictTo\?: 'cash' \| 'bank' \| 'terminal' \| null/.test(picker), 'لا فلترة لوسائل الدفع')
  assert.ok(/restrictTo === 'cash' \? permitted\.filter\(\(treasury\) => treasury\.kind === 'cash'\)/.test(picker),
    'اختيار «نقدي» ما زال يعرض البنوك')
  assert.ok(/const terminals = restrictTo && restrictTo !== 'terminal' \? \[\] : allTerminals/.test(picker),
    'الماكينات تظهر مع النقدي والبنكي')
  assert.ok(/restrictTo=\{payRows\.some\(r=>r\.method==='card'\)\?'terminal':payRows\.some\(r=>r\.method==='bank'\)\?'bank':'cash'\}/.test(sales),
    'لوحة التحصيل لا تمرّر نوع الطريقة للمنتقي')
  R.ok('قائمة الوسائل تعرض نوع الطريقة المختار فقط (نقدي/بنكي/ماكينة)')
}
{
  assert.ok(/reviewSlot\?: ReactNode/.test(frame) && /\{reviewSlot\}\n\s*<PrintSwitches compact\/>/.test(frame),
    'زر المراجعة ليس في شريط التذييل')
  assert.ok(/reviewSlot=\{<>/.test(sales) && /data-prepost-open/.test(sales), 'الفاتورة لا تمرّر زر المراجعة للتذييل')
  R.ok('زر «مراجعة قبل الترحيل» ظاهر دائماً أسفل بجوار «تصدير PDF»')
}
{
  const vouchers = read('ui/pages/VouchersPage.tsx')
  const employeesPage = read('ui/pages/EmployeesPage.tsx')
  assert.ok(/const needsEmployee = counter === '1107' \|\| \(kind === 'payment' && counter === '2104'\)/.test(vouchers),
    'شاشة السندات لا تطلب الموظف عند السلف/الرواتب')
  assert.ok(/data-voucher-employee/.test(vouchers) && /aria-label="موظف السند"/.test(vouchers), 'لا حقل اختيار موظف في السند')
  assert.ok(/partyKind: needsEmployee \? 'employee'/.test(vouchers), 'السند لا يُرحَّل باسم الموظف')
  assert.ok(/if \(needsEmployee && !employeePartyId\) throw new Error/.test(vouchers), 'يمكن ترحيل سند موظف بلا موظف')
  assert.ok(/data-employee-statement-open=\{e\.id\}/.test(employeesPage) && /data-employee-statement/.test(employeesPage),
    'لا زر/نافذة كشف حساب للموظف')
  assert.ok(/data-statement-balance/.test(employeesPage) && /له على المنشأة/.test(employeesPage), 'الكشف بلا رصيد جارٍ مفسَّر')
  R.ok('واجهة: كشف حساب الموظف من قائمته · واختياره طرفاً في سندَي القبض والصرف')
}
R.done()
