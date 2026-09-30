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
  /* الاستحقاق دائن بالمستحق قبل الاقتطاع، والخصم والسلفة مدينان — بلا ازدواج */
  assert.ok(/creditMinor: slip\.grossMinor \+ slip\.allowancesMinor/.test(repo), 'كشف الموظف يزدوج فيه الخصم')
  assert.ok(/description: 'خصومات على الراتب', debitMinor: slip\.deductionsMinor/.test(repo), 'الخصومات لا تظهر مديناً')
  assert.ok(/description: 'استقطاع سلفة من الراتب', debitMinor: slip\.advanceMinor/.test(repo), 'السلف المستقطعة لا تظهر مديناً')
  assert.ok(/description: 'صرف الراتب', debitMinor: slip\.netMinor/.test(repo), 'الصرف لا يصفّي رصيد الموظف')
  R.ok('كشف الموظف: استحقاق دائن · خصومات وسلف مدين · الصرف يصفّي الرصيد')
}
{
  assert.ok(/partyKind\?: 'customer' \| 'supplier' \| 'employee' \| null/.test(repo), 'السندات لا تقبل الموظف كطرف')
  assert.ok(/state\.vouchers\.filter\(\(row\) => row\.partyKind === 'employee'/.test(repo), 'سندات الموظف لا تدخل كشفه')
  assert.ok(/debitMinor: voucher\.kind === 'payment' \? voucher\.amountMinor : 0/.test(repo), 'سند الصرف للموظف لا يُقيَّد مديناً')
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
