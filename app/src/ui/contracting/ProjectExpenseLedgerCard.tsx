/**
 * كشف مصروفات المشروع التفصيلي (طلب المالك — بندا ٨ و١٠): جدول سطر-لكل-بند
 * بكل تفاصيل المراجعة (تاريخ/مستند/فاتورة مرجعية/مورد/تصنيف/كمية×سعر/صافٍ/
 * ضريبة/إجمالي/قيد) + تصدير احترافي: طباعة/PDF بالغلاف الموحد · Excel
 * (سبريددشيت XML بأوراق) · CSV. تُمرَّر له مستندات التكلفة كما هي ويقرأ دوابّ
 * الأسماء من المستودع — يستعمله «مصروفات المشروع» و«تقارير المقاولات».
 */
import { useMemo } from 'react'
import { FileSpreadsheet, FileText, Printer } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import {
  buildProjectExpenseLedger,
  PROJECT_EXPENSE_LEDGER_HEADERS,
  projectExpenseLedgerExportRows,
  type ProjectCostLike,
} from '../../core/projectExpenseLedger.ts'
import { sheetsToExcelXml, sheetToCsv, downloadTextFile, exportFileName, type ExportSheet } from '../../core/fullExport.ts'
import { renderReportShell, htmlTableHtml } from '../../core/reportPrint.ts'
import { printHtml } from '../print/printReceipt.ts'
import { resolveDocumentPrintSettings } from '../print/branchPrint.ts'
import { localIsoTimestamp } from '../../core/time.ts'

const PRINT_HEADERS = ['التاريخ', 'المستند', 'مرجع المورد', 'المورد', 'بيان البند', 'التصنيف', 'كمية × سعر', 'الصافي', 'الضريبة', 'الإجمالي'] as const

export function ProjectExpenseLedgerCard(props: {
  costs: readonly ProjectCostLike[]
  projectCode: string
  projectNameAr: string
  /** أوراق Excel تسبق ورقة المصروفات (بطاقة المشروع/المستخلصات من التقارير) */
  preSheets?: ExportSheet[]
  title?: string
}) {
  const { suppliers, treasuries, custodyFiles, boqItems, journal } = useDataStore()
  const { setup } = useAppStore()
  const cur = getCountry(setup.countryCode ?? 'EG')!.currency
  const fmt = (m: number) => formatMinor(m, cur, false)

  const ledger = useMemo(() => buildProjectExpenseLedger(props.costs, {
    supplierName: (id) => (id == null ? '—' : suppliers.find((s) => s.id === id)?.nameAr ?? `#${id}`),
    treasuryName: (code) => (code ? treasuries.find((t) => t.code === code)?.nameAr ?? code : ''),
    custodyLabel: (fileId) => { const f = custodyFiles.find((x) => x.id === fileId); return f ? `عهدة ${f.fileNumber}` : 'عهدة موظف' },
    boqLabel: (id) => { const b = boqItems.find((x) => x.id === id); return b ? `${b.code} — ${b.descriptionAr}` : '' },
    journalEntryNumber: (entryId) => journal.find((e) => e.id === entryId)?.entryNumber ?? entryId,
  }), [props.costs, suppliers, treasuries, custodyFiles, boqItems, journal])

  const exportSheet = (): ExportSheet => ({
    nameAr: 'مصروفات المشروع التفصيلية',
    headers: [...PROJECT_EXPENSE_LEDGER_HEADERS],
    rows: projectExpenseLedgerExportRows(ledger.rows, cur.decimals),
  })
  const hasLedger = ledger.rows.length > 0

  /* كشف المشروع الواحد يحمل هوية فرع مستندات التكلفة إذا اتفقت كلها على
     فرع واحد؛ عند اختلافها (بيانات قديمة/مجمعة) يبقى سياق العرض الحالي. */
  const resolveLedgerPrintSettings = () => {
    const byBranch = new Map<number, ReturnType<typeof resolveDocumentPrintSettings>>()
    for (const cost of props.costs) {
      const resolved = resolveDocumentPrintSettings(cost)
      byBranch.set(resolved.branchId ?? 0, resolved)
    }
    return byBranch.size === 1 ? [...byBranch.values()][0] : null
  }

  const exportExcel = () => {
    const sheets = [...(props.preSheets ?? []), exportSheet()]
    downloadTextFile(
      exportFileName(resolveLedgerPrintSettings()?.setup.shopName || setup.shopName || 'المنشأة', `كشف-مصروفات-${props.projectCode}`, 'xls', localIsoTimestamp()),
      'application/vnd.ms-excel',
      sheetsToExcelXml(sheets),
    )
  }
  const exportCsv = () => downloadTextFile(
    exportFileName(resolveLedgerPrintSettings()?.setup.shopName || setup.shopName || 'المنشأة', `كشف-مصروفات-${props.projectCode}`, 'csv', localIsoTimestamp()),
    'text/csv;charset=utf-8',
    sheetToCsv(exportSheet()),
  )

  const printLedger = () => {
    const active = useAppStore.getState()
    const documentSettings = resolveLedgerPrintSettings()
    const reportPrint = documentSettings?.reportPrint ?? active.reportPrint
    const receipt = documentSettings?.receipt ?? active.receipt
    const companyName = documentSettings?.setup.shopName ?? active.setup.shopName
    const bodyHtml = htmlTableHtml({
      headers: [...PRINT_HEADERS],
      numCols: [6, 7, 8, 9],
      rows: ledger.rows.map((r) => [
        r.date, r.expenseNumber, r.invoiceRef || '—', r.supplierName, r.lineDescription, r.categoryName,
        `${r.qty} × ${fmt(r.unitPriceMinor)}`, fmt(r.netMinor), fmt(r.vatMinor), fmt(r.grossMinor),
      ]),
      totalRow: ['', '', '', '', `الإجمالي (${ledger.totals.docsCount} مستند · ${ledger.totals.linesCount} بند)`, '', '', fmt(ledger.totals.netMinor), fmt(ledger.totals.vatMinor), fmt(ledger.totals.grossMinor)],
    })
    printHtml(renderReportShell({
      title: `كشف مصروفات المشروع التفصيلي — ${props.projectCode}`,
      subtitle: `${props.projectNameAr} · المدفوع ${fmt(ledger.totals.paidMinor)} · الآجل ${fmt(ledger.totals.dueMinor)}`,
      companyName: companyName || 'المنشأة', logoDataUrl: receipt.logoDataUrl, bodyHtml, settings: reportPrint,
    }))
  }

  const t = ledger.totals
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-card-dark" data-expense-ledger>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <div>
          <h3 className="text-[13px] font-black text-slate-700 dark:text-slate-100">{props.title ?? 'كشف المصروفات التفصيلي — سطر لكل بند'}</h3>
          <p className="text-[11px] font-bold text-slate-400">
            {t.docsCount} مستند · {t.linesCount} بند · الصافي {fmt(t.netMinor)} · الضريبة {fmt(t.vatMinor)} · الإجمالي {fmt(t.grossMinor)} · المدفوع {fmt(t.paidMinor)} · الآجل {fmt(t.dueMinor)}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={printLedger} disabled={!hasLedger} data-expense-ledger-print className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11.5px] font-black text-slate-600 transition hover:border-brand hover:text-brand disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"><Printer size={13} /> طباعة / PDF</button>
          <button type="button" onClick={exportExcel} disabled={!hasLedger} data-expense-ledger-excel className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11.5px] font-black text-white transition hover:bg-emerald-500 disabled:opacity-40"><FileSpreadsheet size={13} /> Excel{props.preSheets?.length ? ' (كشف شامل)' : ''}</button>
          <button type="button" onClick={exportCsv} disabled={!hasLedger} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11.5px] font-black text-slate-600 transition hover:border-brand hover:text-brand disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"><FileText size={13} /> CSV</button>
        </div>
      </div>
      {!hasLedger ? (
        <p className="px-4 py-6 text-center text-[12px] font-bold text-slate-400">لا مصروفات مسجلة لهذا المشروع بعد — سجّل أول مستند من «تسجيل مصروف».</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-right text-[12px]">
            <thead>
              <tr className="border-b border-slate-100 text-slate-400 dark:border-slate-800">
                <th className="px-3 py-2 font-black">التاريخ</th>
                <th className="px-3 py-2 font-black">المستند / المرجع</th>
                <th className="px-3 py-2 font-black">المورد</th>
                <th className="px-3 py-2 font-black">بيان البند</th>
                <th className="px-3 py-2 font-black">التصنيف</th>
                <th className="px-3 py-2 font-black">كمية × سعر</th>
                <th className="px-3 py-2 font-black">الصافي</th>
                <th className="px-3 py-2 font-black">الضريبة</th>
                <th className="px-3 py-2 font-black">الإجمالي</th>
                <th className="px-3 py-2 font-black">السداد</th>
              </tr>
            </thead>
            <tbody>
              {ledger.rows.map((r, i) => (
                <tr key={`${r.costId}-${i}`} className="border-b border-slate-50 transition hover:bg-slate-50/70 dark:border-slate-800/60 dark:hover:bg-slate-800/40">
                  <td className="whitespace-nowrap px-3 py-2 font-bold text-slate-500" dir="ltr">{r.date}</td>
                  <td className="px-3 py-2">
                    <span className="font-black text-brand" dir="ltr">{r.expenseNumber}</span>
                    {r.invoiceRef ? <span className="block text-[10px] font-bold text-slate-400">{r.invoiceRef}</span> : null}
                    <span className="block text-[10px] font-bold text-slate-400">{r.sourceLabel} · قيد JE-{String(r.journalEntryNumber).padStart(4, '0')}</span>
                  </td>
                  <td className="px-3 py-2 font-bold text-slate-600 dark:text-slate-300">{r.supplierName}</td>
                  <td className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-100">
                    {r.lineDescription}
                    {r.boqLabel ? <span className="block text-[10px] font-bold text-sky-600">BOQ: {r.boqLabel}</span> : null}
                  </td>
                  <td className="px-3 py-2">
                    <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-black text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">{r.categoryName}</span>
                    <span className="mt-0.5 block text-[10px] font-bold text-slate-400">{r.kindName}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-bold text-slate-500" dir="ltr">{r.qty} × {fmt(r.unitPriceMinor)}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-black text-slate-700 dark:text-slate-100">{fmt(r.netMinor)}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-bold text-slate-500">
                    {fmt(r.vatMinor)}
                    <span className="block text-[10px] font-bold text-slate-400">{r.taxLabel}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-black text-slate-800 dark:text-slate-50">{fmt(r.grossMinor)}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-bold text-slate-500">
                    دُفع {fmt(r.docPaidMinor)}{r.docDueMinor > 0 ? ` · آجل ${fmt(r.docDueMinor)}` : ''}
                    <span className="block text-[10px] font-bold text-slate-400">{r.paymentSourceLabel}</span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 text-[12px] font-black text-slate-700 dark:bg-slate-800/60 dark:text-slate-100">
                <td className="px-3 py-2" colSpan={6}>الإجمالي — {t.docsCount} مستند · {t.linesCount} بند (المدفوع {fmt(t.paidMinor)} · الآجل {fmt(t.dueMinor)})</td>
                <td className="whitespace-nowrap px-3 py-2">{fmt(t.netMinor)}</td>
                <td className="whitespace-nowrap px-3 py-2">{fmt(t.vatMinor)}</td>
                <td className="whitespace-nowrap px-3 py-2">{fmt(t.grossMinor)}</td>
                <td className="px-3 py-2"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  )
}
