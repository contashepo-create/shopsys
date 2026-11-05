import { useMemo, useState } from 'react'
import { Printer } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { representativeSalesReport } from '../../core/representativeSales.ts'
import { receiptCollectorReport } from '../../core/receiptCollectorReport.ts'
import { saleEmployeeCustodyReport } from '../../core/saleEmployeeCustodyReport.ts'
import { representativeReportSum } from '../../core/representativeReportMoney.ts'
import { formatMinor, type CurrencyConfig } from '../../core/money.ts'
import { renderReportShell } from '../../core/reportPrint.ts'
import type { Period } from '../../core/reports.ts'
import { printHtml } from '../print/printReceipt.ts'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
export function RepresentativeSalesTab({ period, cur }: { period: Period; cur: CurrencyConfig }) {
  const { sales, saleReturns, vouchers, journal, employees, employeeAdvances } = useDataStore()
  const { setup } = useAppStore()
  const [representative, setRepresentative] = useState('all')
  const report = useMemo(() => representativeSalesReport(sales, saleReturns, journal, employees, period), [sales, saleReturns, journal, employees, period])
  const receipts = useMemo(() => receiptCollectorReport(vouchers, journal, employees, period), [vouchers, journal, employees, period])
  const custody = useMemo(() => saleEmployeeCustodyReport(sales, employeeAdvances, journal, employees, period), [sales, employeeAdvances, journal, employees, period])
  const custodyRows = custody.rows.filter(row => representative === 'all' || String(row.employeeId) === representative)
  const custodyMinor = representativeReportSum(custodyRows.filter(row => row.kind === 'allocation').map(row => row.amountMinor))
  const custodyReversalMinor = representativeReportSum(custodyRows.filter(row => row.kind === 'reversal').map(row => row.amountMinor))
  const netCustodyMinor = representativeReportSum([custodyMinor, -custodyReversalMinor])
  const receiptRows = receipts.rows.filter(row => representative === 'all' || (representative === 'unassigned' ? row.collectorId == null : String(row.collectorId) === representative))
  const receiptMinor = representativeReportSum(receiptRows.filter(row => row.kind === 'receipt').map(row => row.amountMinor))
  const reversedMinor = representativeReportSum(receiptRows.filter(row => row.kind === 'reversal').map(row => row.amountMinor))
  const rows = report.rows.filter(row => representative === 'all' || (representative === 'unassigned' ? row.representativeId == null : String(row.representativeId) === representative))
  const salesMinor = representativeReportSum(rows.filter(row => row.kind === 'sale').map(row => row.amountMinor))
  const returnsMinor = representativeReportSum(rows.filter(row => row.kind === 'return').map(row => row.amountMinor))
  const reversalsMinor = representativeReportSum(rows.filter(row => row.kind === 'reversal').map(row => row.amountMinor))
  const netSalesMinor = representativeReportSum([salesMinor, -returnsMinor, -reversalsMinor])
  const netReceiptsMinor = representativeReportSum([receiptMinor, -reversedMinor])
  const fmt = (amount: number) => formatMinor(amount, cur, false)
  const scope = 'دفتر جزئي لفواتير البيع ومرتجعاتها وسندات القبض فقط؛ لا يشمل التحصيلات الأخرى أو مستندات الأنشطة الأخرى. لا يُنسب البيع من العمولة أو المحصّل، ولا القبض من البائع أو طرف السند. الفواتير أو سلسلة التعديل غير المثبتة مستبعدة للمراجعة؛ عكس التعديل والقيد البديل بتاريخيهما. عهدة الموظف تثبت حيازته المسجلة لا من قبض من العميل، ولا تضاف إلى إجمالي سندات القبض؛ عهدة الفواتير المعدلة تُعرض عند اكتمال إثبات سلسلة التعديل؛ غير المثبت مستبعد للمراجعة. القبض شامل كل الحسابات المقابلة، وليس مبيعات أو ذمم عملاء فقط.'
  const print = () => {
    const { reportPrint, receipt } = useAppStore.getState()
    const details = rows.map(row => `<tr><td>${esc(row.date)}</td><td>${esc(row.document)}</td><td>${row.kind === 'sale' ? 'بيع' : row.kind === 'return' ? 'مرتجع' : 'عكس تعديل'}</td><td>${esc(row.representativeName)}</td><td class="num">${fmt(row.kind === 'sale' ? row.amountMinor : 0)}</td><td class="num">${fmt(row.kind === 'return' ? row.amountMinor : 0)}</td><td class="num">${fmt(row.kind === 'reversal' ? row.amountMinor : 0)}</td></tr>`).join('')
    const allWarnings = [...report.warnings, ...receipts.warnings, ...custody.warnings]
    const warnings = allWarnings.length ? `<p>مستندات مستبعدة للمراجعة: ${allWarnings.map(esc).join('؛ ')}</p>` : ''
    const receiptDetails = receiptRows.map(row => `<tr><td>${esc(row.date)}</td><td>${esc(row.document)}</td><td>${row.kind === 'receipt' ? 'قبض' : 'عكس قبض'}</td><td>${esc(row.collectorName)}</td><td>${esc(row.counterAccountCode)}</td><td class="num">${fmt(row.kind === 'receipt' ? row.amountMinor : 0)}</td><td class="num">${fmt(row.kind === 'reversal' ? row.amountMinor : 0)}</td></tr>`).join('')
    const custodyDetails = custodyRows.map(row => `<tr><td>${esc(row.date)}</td><td>${esc(row.document)}</td><td>${esc(row.employeeName)}</td><td>${row.kind === 'allocation' ? 'إثبات عهدة' : 'عكس تعديل'}</td><td class="num">${fmt(row.kind === 'allocation' ? row.amountMinor : 0)}</td><td class="num">${fmt(row.kind === 'reversal' ? row.amountMinor : 0)}</td></tr>`).join('')
    const bodyHtml = `<p>${esc(scope)}</p>${warnings}<table><thead><tr><th>التاريخ</th><th>المستند</th><th>الحركة</th><th>المندوب</th><th>البيع شامل الضريبة</th><th>المرتجع شامل الضريبة</th><th>عكس تعديل</th></tr></thead><tbody>${details}<tr class="total"><td colspan="4">الإجمالي</td><td class="num">${fmt(salesMinor)}</td><td class="num">${fmt(returnsMinor)}</td><td class="num">${fmt(reversalsMinor)}</td></tr></tbody></table><p>الصافي: ${fmt(netSalesMinor)} ${esc(cur.symbol)}</p><h3>سندات القبض حسب المحصّل — منفصلة عن المبيعات</h3><table><thead><tr><th>التاريخ</th><th>السند</th><th>الحركة</th><th>المحصّل</th><th>الحساب المقابل</th><th>قبض</th><th>عكس</th></tr></thead><tbody>${receiptDetails}<tr class="total"><td colspan="5">الإجمالي</td><td class="num">${fmt(receiptMinor)}</td><td class="num">${fmt(reversedMinor)}</td></tr></tbody></table><p>صافي سندات القبض: ${fmt(netReceiptsMinor)} ${esc(cur.symbol)}</p><h3>عهدة الموظف المسجلة عند البيع — ليست إثباتاً للمحصّل</h3><table><thead><tr><th>التاريخ</th><th>الفاتورة</th><th>الموظف</th><th>الحركة</th><th>إثبات عهدة</th><th>عكس تعديل</th></tr></thead><tbody>${custodyDetails}<tr class="total"><td colspan="4">الإجمالي</td><td class="num">${fmt(custodyMinor)}</td><td class="num">${fmt(custodyReversalMinor)}</td></tr></tbody></table><p>صافي حركة العهدة: ${fmt(netCustodyMinor)} ${esc(cur.symbol)}. هذه حركة الأصل وليست رصيداً حالياً؛ السداد اللاحق لا يخصم منها هنا.</p>`
    const selected = representative === 'all' ? 'الكل' : representative === 'unassigned' ? 'غير محدد' : employees.find(employee => String(employee.id) === representative)?.nameAr ?? 'مندوب غير موجود'
    const html = renderReportShell({ title: 'دفتر المناديب والتحصيل — جزئي', subtitle: `من ${period.from} إلى ${period.to} · الشخص: ${selected}`, companyName: setup.shopName || '', logoDataUrl: receipt.logoDataUrl, settings: reportPrint, bodyHtml })
    printHtml(html)
  }
  return <section aria-label="دفتر مندوب فواتير البيع" className="space-y-3">
    <p className="text-sm text-amber-700 dark:text-amber-400">{scope}</p>
    <div className="flex flex-wrap items-center gap-3">
      <label className="text-sm font-bold">الشخص (مندوب البيع / المحصّل) <select aria-label="تصفية المندوب" value={representative} onChange={event => setRepresentative(event.target.value)} className="ms-2 rounded-lg border p-2 bg-transparent"><option value="all">الكل</option><option value="unassigned">غير محدد</option>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.nameAr}</option>)}</select></label>
      <button type="button" onClick={print} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold"><Printer size={16} /> معاينة وطباعة</button>
    </div>
    {(report.warnings.length > 0 || receipts.warnings.length > 0 || custody.warnings.length > 0) && <div role="alert" className="text-sm text-rose-700">{[...report.warnings, ...receipts.warnings, ...custody.warnings].map((warning, index) => <div key={index}>{warning}</div>)}</div>}
    <div className="overflow-x-auto"><table className="w-full text-sm border-collapse"><thead><tr className="border-b text-right"><th className="p-2">التاريخ</th><th className="p-2">المستند</th><th className="p-2">الحركة</th><th className="p-2">المندوب</th><th className="p-2">البيع شامل الضريبة</th><th className="p-2">المرتجع شامل الضريبة</th><th className="p-2">عكس تعديل</th></tr></thead><tbody>
      {rows.map(row => <tr key={`${row.kind}:${row.sequence}`} className="border-b"><td className="p-2">{row.date}</td><td className="p-2">{row.document}</td><td className="p-2">{row.kind === 'sale' ? 'بيع' : row.kind === 'return' ? 'مرتجع' : 'عكس تعديل'}</td><td className="p-2">{row.representativeName}</td><td className="p-2">{row.kind === 'sale' ? fmt(row.amountMinor) : '—'}</td><td className="p-2">{row.kind === 'return' ? fmt(row.amountMinor) : '—'}</td><td className="p-2">{row.kind === 'reversal' ? fmt(row.amountMinor) : '—'}</td></tr>)}
      <tr className="font-bold border-b"><td colSpan={4} className="p-2">الإجمالي</td><td className="p-2">{fmt(salesMinor)}</td><td className="p-2">{fmt(returnsMinor)}</td><td className="p-2">{fmt(reversalsMinor)}</td></tr><tr className="font-bold"><td colSpan={4} className="p-2">الصافي شامل الضريبة</td><td colSpan={3} className="p-2">{fmt(netSalesMinor)} {cur.symbol}</td></tr>
    </tbody></table></div>
    <h3 className="font-bold pt-3">سندات القبض حسب المحصّل — منفصلة عن المبيعات</h3>
    <div className="overflow-x-auto"><table className="w-full text-sm border-collapse"><thead><tr className="border-b text-right"><th className="p-2">التاريخ</th><th className="p-2">السند</th><th className="p-2">الحركة</th><th className="p-2">المحصّل</th><th className="p-2">الحساب المقابل</th><th className="p-2">قبض</th><th className="p-2">عكس</th></tr></thead><tbody>
      {receiptRows.map((row, index) => <tr key={`${row.kind}:${row.document}:${index}`} className="border-b"><td className="p-2">{row.date}</td><td className="p-2">{row.document}</td><td className="p-2">{row.kind === 'receipt' ? 'قبض' : 'عكس قبض'}</td><td className="p-2">{row.collectorName}</td><td className="p-2">{row.counterAccountCode}</td><td className="p-2">{row.kind === 'receipt' ? fmt(row.amountMinor) : '—'}</td><td className="p-2">{row.kind === 'reversal' ? fmt(row.amountMinor) : '—'}</td></tr>)}
      <tr className="font-bold border-b"><td colSpan={5} className="p-2">الإجمالي</td><td className="p-2">{fmt(receiptMinor)}</td><td className="p-2">{fmt(reversedMinor)}</td></tr><tr className="font-bold"><td colSpan={5} className="p-2">صافي سندات القبض</td><td colSpan={2} className="p-2">{fmt(netReceiptsMinor)} {cur.symbol}</td></tr>
    </tbody></table></div>
    <h3 className="font-bold pt-3">عهدة الموظف المسجلة عند البيع — ليست إثباتاً للمحصّل</h3>
    <p className="text-sm text-slate-600">أصل العهدة بتاريخ البيع لا يمثل رصيدها الحالي؛ السداد اللاحق لا يخصم منها هنا، ولا تضاف لسندات القبض.</p>
    <div className="overflow-x-auto"><table className="w-full text-sm border-collapse"><thead><tr className="border-b text-right"><th className="p-2">التاريخ</th><th className="p-2">الفاتورة</th><th className="p-2">الموظف</th><th className="p-2">الحركة</th><th className="p-2">إثبات عهدة</th><th className="p-2">عكس تعديل</th></tr></thead><tbody>
      {custodyRows.map((row, index) => <tr key={`${row.document}:${row.employeeId}:${index}`} className="border-b"><td className="p-2">{row.date}</td><td className="p-2">{row.document}</td><td className="p-2">{row.employeeName}</td><td className="p-2">{row.kind === 'allocation' ? 'إثبات عهدة' : 'عكس تعديل'}</td><td className="p-2">{row.kind === 'allocation' ? fmt(row.amountMinor) : '—'}</td><td className="p-2">{row.kind === 'reversal' ? fmt(row.amountMinor) : '—'}</td></tr>)}
      <tr className="font-bold border-b"><td colSpan={4} className="p-2">الإجمالي</td><td className="p-2">{fmt(custodyMinor)}</td><td className="p-2">{fmt(custodyReversalMinor)}</td></tr><tr className="font-bold"><td colSpan={4} className="p-2">صافي حركة العهدة</td><td colSpan={2} className="p-2">{fmt(netCustodyMinor)} {cur.symbol}</td></tr>
    </tbody></table></div>
  </section>
}
