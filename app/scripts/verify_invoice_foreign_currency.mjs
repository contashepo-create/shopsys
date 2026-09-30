/**
 * بوابة «الفاتورة بعملة ثانية» — امتداد عقد السند إلى فاتورتَي البيع والشراء.
 *
 * العقد المحاسبي المحروس هنا:
 *   ① الدفتر أحادي العملة: كل القيد بعملة الدفتر، والساق الأجنبية توثيق على المستند وفي وصف القيد.
 *   ② المحصَّل/المسدَّد بعملة الدفتر = حاصل التحويل حرفياً، وإلا رُفض المستند قبل أي كتابة.
 *   ③ الذمة (العميل/المورد) تنقص بالمحوَّل فقط — لا فروق عملة ولا قيود تسوية.
 *   ④ لا يجتمع التحصيل بعملة أجنبية مع ماكينة الدفع (سياستان مختلفتان للتسوية).
 */
import { readFileSync } from 'node:fs'
import { freshCase, addParty, addSimpleItem, assertInvariants, expectReject, reporter } from './auditKit.mjs'
import { convertFxToBookMinor } from '../src/core/foreignCurrency.ts'

const r = reporter('الفاتورة بعملة ثانية: البيع والشراء')
const USD = { currencyCode: 'USD', amountMinor: 10000, ratePpm: 48_500_000, decimals: 2 } // 100.00 USD × 48.5 = 4850.00

// ① فاتورة بيع محصَّلة بالدولار: القيد بعملة الدفتر والذمة صفر
{
  const c = await freshCase({ activityId: 'grocery' })
  const customer = addParty(c, 'customer', 'عميل تصدير')
  const item = addSimpleItem(c, { nameAr: 'صندوق تمر', priceMinor: 100000, extra: { costMinor: 60000, stockQty: 50 } })
  const bookMinor = convertFxToBookMinor(USD, 2)
  if (bookMinor !== 485000) throw new Error(`حاصل التحويل غير متوقع: ${bookMinor}`)

  const sale = c.st().postSale({
    lines: [{ itemId: item.id, qty: 1, unitPriceMinor: 485000, discountPercent: 0 }],
    customerId: customer.id, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false,
    treasury: '1101', paidMinor: bookMinor, fx: USD, bookDecimals: 2, bookCurrencyCode: 'EGP',
  })
  if (sale.paidMinor !== 485000) throw new Error('المحصَّل بعملة الدفتر غير مطابق')
  if (!sale.fx || sale.fx.currencyCode !== 'USD' || sale.fx.amountMinor !== 10000 || sale.fx.ratePpm !== 48_500_000) throw new Error('ساق العملة لم تُحفظ على الفاتورة')
  const entry = c.st().journal.find((row) => row.id === sale.journalEntryId)
  if (!entry.description.includes('100.00 USD × 48.5 = 4850.00')) throw new Error(`وصف القيد بلا ساق العملة: ${entry.description}`)
  for (const line of entry.lines) if (line.accountCode.startsWith('49')) throw new Error('ظهر حساب فروق عملة — الدفتر أحادي العملة')
  if (c.st().getCustomerBalance(customer.id) !== 0) throw new Error('الذمة لم تُقفل بالمحوَّل')
  assertInvariants('فاتورة بيع بالدولار', c)
  r.ok('فاتورة بيع محصَّلة بالدولار: القيد بعملة الدفتر · الساق موثقة على المستند وفي القيد · الذمة صفر · لا فروق عملة')
}

// ② رفض كل تلاعب في ساق العملة — بلا أثر على الدفتر
{
  const c = await freshCase({ activityId: 'grocery' })
  const customer = addParty(c, 'customer', 'عميل')
  const item = addSimpleItem(c, { nameAr: 'صنف', priceMinor: 100000, extra: { costMinor: 50000, stockQty: 50 } })
  const base = {
    lines: [{ itemId: item.id, qty: 1, unitPriceMinor: 485000, discountPercent: 0 }],
    customerId: customer.id, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, treasury: '1101',
  }
  const salesBefore = c.st().sales.length
  const journalBefore = c.st().journal.length

  expectReject('محصَّل لا يساوي حاصل التحويل', c, () => c.st().postSale({ ...base, paidMinor: 400000, fx: USD, bookDecimals: 2, bookCurrencyCode: 'EGP' }), /لا يساوي حاصل التحويل/)
  expectReject('العملة الأجنبية = عملة الدفتر', c, () => c.st().postSale({ ...base, paidMinor: 485000, fx: { ...USD, currencyCode: 'EGP' }, bookDecimals: 2, bookCurrencyCode: 'EGP' }), /عملة الدفتر/)
  expectReject('سعر صرف صفر', c, () => c.st().postSale({ ...base, paidMinor: 485000, fx: { ...USD, ratePpm: 0 }, bookDecimals: 2, bookCurrencyCode: 'EGP' }), /سعر الصرف/)
  expectReject('مبلغ أجنبي صفر', c, () => c.st().postSale({ ...base, paidMinor: 485000, fx: { ...USD, amountMinor: 0 }, bookDecimals: 2, bookCurrencyCode: 'EGP' }), /أكبر من صفر/)

  if (c.st().sales.length !== salesBefore || c.st().journal.length !== journalBefore) throw new Error('الرفض ترك أثراً في الدفتر')
  r.ok('الرفض قبل أي كتابة: مبلغ لا يطابق التحويل · عملة الدفتر نفسها · سعر صرف صفر · مبلغ أجنبي صفر')
}

// ③ ماكينة الدفع لا تجتمع مع العملة الأجنبية
{
  const c = await freshCase({ activityId: 'grocery' })
  const customer = addParty(c, 'customer', 'عميل بطاقة')
  const item = addSimpleItem(c, { nameAr: 'صنف', priceMinor: 100000, extra: { costMinor: 50000, stockQty: 50 } })
  const settlement = (c.st().treasuries.find((row) => row.kind === 'bank') ?? c.st().treasuries[0]).code
  c.st().addPaymentTerminal({ id: 'term-1', code: 'TERM-0001', nameAr: 'فيزا', providerName: 'بنك مصر', branchId: '', settlementAccountCode: settlement, terminalId: 'T-1001', status: 'active' })
  const terminal = c.st().paymentTerminals[0]
  expectReject('عملة أجنبية + ماكينة دفع', c, () => c.st().postSale({
    lines: [{ itemId: item.id, qty: 1, unitPriceMinor: 485000, discountPercent: 0 }],
    customerId: customer.id, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false,
    treasury: '1101', paidMinor: 485000, fx: USD, bookDecimals: 2, bookCurrencyCode: 'EGP',
    terminalPayment: { terminalId: terminal.id, providerReference: 'REF-1' },
  }), /لا يجتمع مع ماكينة الدفع/)
  r.ok('التحصيل بعملة أجنبية لا يجتمع مع ماكينة الدفع — رفض صريح بالعربية')
}

// ④ فاتورة شراء مسدَّدة جزئياً بالدولار: دين المورد ينقص بالمحوَّل فقط
{
  const c = await freshCase({ activityId: 'grocery' })
  const supplier = addParty(c, 'supplier', 'مورد مستورد')
  const item = addSimpleItem(c, { nameAr: 'خامة مستوردة', priceMinor: 200000, extra: { costMinor: 100000 } })
  const bookMinor = convertFxToBookMinor(USD, 2)
  const invoice = c.st().postPurchase({
    supplierId: supplier.id, date: '2026-05-01', lines: [{ itemId: item.id, qty: 10, unitPriceMinor: 100000, vatPercent: 0 }],
    expenses: [], paidMinor: bookMinor, treasury: '1101', notes: '', fx: USD, bookDecimals: 2, bookCurrencyCode: 'EGP',
  })
  if (invoice.paidMinor !== 485000) throw new Error('المسدَّد بعملة الدفتر غير مطابق')
  if (!invoice.fx || invoice.fx.currencyCode !== 'USD') throw new Error('ساق العملة لم تُحفظ على فاتورة الشراء')
  const entry = c.st().journal.find((row) => row.id === invoice.journalEntryId)
  if (!entry.description.includes('100.00 USD × 48.5 = 4850.00')) throw new Error('وصف قيد الشراء بلا ساق العملة')
  const due = c.st().getSupplierBalance(supplier.id)
  if (due !== 1_000_000 - 485000) throw new Error(`دين المورد غير متوقع: ${due}`)
  expectReject('مسدَّد لا يساوي حاصل التحويل', c, () => c.st().postPurchase({
    supplierId: supplier.id, date: '2026-05-02', lines: [{ itemId: item.id, qty: 1, unitPriceMinor: 100000, vatPercent: 0 }],
    expenses: [], paidMinor: 100000, treasury: '1101', notes: '', fx: USD, bookDecimals: 2, bookCurrencyCode: 'EGP',
  }), /لا يساوي حاصل التحويل/)
  assertInvariants('فاتورة شراء بالدولار', c)
  r.ok('فاتورة شراء مسدَّدة بالدولار: دين المورد ينقص بالمحوَّل فقط · الساق في القيد · المبلغ المخالف مرفوض')
}

// ⑤ عملة بثلاث خانات ومبالغ ضخمة داخل دورة فاتورة كاملة
{
  const c = await freshCase({ activityId: 'grocery' })
  const customer = addParty(c, 'customer', 'عميل الخليج')
  const item = addSimpleItem(c, { nameAr: 'شحنة', priceMinor: 20_000_000, extra: { costMinor: 10_000_000, stockQty: 20 } })
  const kwd = { currencyCode: 'KWD', amountMinor: 1000, ratePpm: 157_300_000, decimals: 3 } // 1.000 KWD × 157.3 = 157.30
  const bookMinor = convertFxToBookMinor(kwd, 2)
  if (bookMinor !== 15730) throw new Error(`تحويل الدينار غير متوقع: ${bookMinor}`)
  const sale = c.st().postSale({
    lines: [{ itemId: item.id, qty: 1, unitPriceMinor: 20_000_000, discountPercent: 0 }],
    customerId: customer.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false,
    treasury: '1101', paidMinor: bookMinor, fx: kwd, bookDecimals: 2, bookCurrencyCode: 'EGP',
  })
  if (sale.paidMinor !== 15730) throw new Error('الدفعة المقدَّمة بالدينار غير مطابقة')
  if (c.st().getCustomerBalance(customer.id) !== 20_000_000 - 15730) throw new Error('ذمة العميل بعد الدفعة بالدينار غير صحيحة')
  assertInvariants('دفعة مقدمة بالدينار', c)
  r.ok('دفعة مقدَّمة بعملة ثلاثية الخانات على فاتورة آجلة: الباقي على العميل بعملة الدفتر بلا كسور ضائعة')
}

// ⑥ الشاشتان: المبلغ محسوب لا يدوي، والساق تُمرَّر للمحرك
{
  const sales = readFileSync(new URL('../src/ui/pages/AdvancedSalesInvoicePage.tsx', import.meta.url), 'utf8')
  const purchase = readFileSync(new URL('../src/ui/pages/AdvancedPurchaseInvoicePage.tsx', import.meta.url), 'utf8')
  for (const [name, source, label] of [['فاتورة البيع', sales, 'تحصيل بعملة أجنبية'], ['فاتورة الشراء', purchase, 'سداد بعملة أجنبية']]) {
    if (!source.includes("from '../../core/foreignCurrency.ts'") && !source.includes("from'../../core/foreignCurrency.ts'")) throw new Error(`${name}: لا تستعمل نواة التحويل المشتركة`)
    if (!source.includes(label)) throw new Error(`${name}: خانة العملة الأجنبية غير معروضة`)
    if (!source.includes('data-invoice-fx-rate="true"')) throw new Error(`${name}: حقل سعر الصرف مفقود`)
    if (!source.includes('readOnly={fxOn')) throw new Error(`${name}: المبلغ بعملة الدفتر يجب أن يكون محسوباً لا يدوياً`)
    if (!source.includes('bookCurrencyCode:cur.code')) throw new Error(`${name}: عملة الدفتر لا تُمرَّر للمحرك`)
    if (!source.includes('fxErrors')) throw new Error(`${name}: أخطاء الساق لا تُعرض للمستخدم`)
  }
  if (!sales.includes('أزل التحصيل على حساب الموظف')) throw new Error('فاتورة البيع: حارس التحصيل على حساب الموظف مفقود')
  if (!sales.includes('fxOn?fxBookMinor:toMinor')) throw new Error('فاتورة البيع: المحصَّل نقداً لا يتبع حاصل التحويل')
  if (!purchase.includes('fxOn?fxBookMinor:toMinor')) throw new Error('فاتورة الشراء: المسدَّد لا يتبع حاصل التحويل')
  r.ok('الشاشتان: نواة تحويل واحدة · مبلغ محسوب لا يدوي · أخطاء معروضة · عملة الدفتر مُمرَّرة للمحرك')
}

r.done()
