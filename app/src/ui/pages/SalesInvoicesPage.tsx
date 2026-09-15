/** فواتير المبيعات — كل فاتورة مربوطة بقيدها (اضغط لعرض القيد) + طباعة الإيصال */
import { useMemo, useState } from 'react'
import { Eye, BookOpenText, Printer, FileText } from 'lucide-react'
import { useDataStore, type SaleInvoice } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import { buildReceiptModel } from '../../core/receipt.ts'
import { renderReceiptHtml, printHtml } from '../print/printReceipt.ts'
import { renderInvoiceA4Html } from '../print/printInvoiceA4.ts'
import { maybeZatcaQr } from '../print/zatcaQr.ts'
import { evaluateLicense, hasFeature } from '../../core/license.ts'
import { Modal, EmptyState, useToast, inputCls } from '../components/ui.tsx'
import { ACCOUNT_NAMES } from './accountNames.ts'
import { normalizeRefQuery } from '../../core/refcode.ts'

export function SalesInvoicesPage() {
  const { sales, customers, journal } = useDataStore()
  const { setup, receipt, einvoice, activatedPayload, trialStartedAt, lastSeenAt } = useAppStore()
  const toast = useToast()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)
  const [viewing, setViewing] = useState<SaleInvoice | null>(null)
  // البحث بالمرجع/رقم الفاتورة — المرجعي يُطبع على الإيصال فيقرأه العميل بالهاتف
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = query.trim()
    if (!q) return [...sales].reverse()
    const ref = normalizeRefQuery(q)
    return [...sales].reverse().filter((s) =>
      s.invoiceNumber.includes(q) || (s.refCode ?? '').includes(ref))
  }, [sales, query])

  const printInvoice = async (s: SaleInvoice, template: 'thermal' | 'a4') => {
    const licState = evaluateLicense({ activatedPayload, trialStartedAt, lastSeenAt, today: new Date().toISOString() })
    const qrDataUrl = await maybeZatcaQr({
      featureActive: hasFeature(licState, 'einvoice_sa'),
      printEnabled: einvoice.printZatcaQr,
      sellerName: setup.shopName,
      vatNumber: einvoice.taxNumber,
      dateIso: s.date,
      totalMinor: s.totals.totalMinor,
      taxMinor: s.totals.taxMinor,
      decimals: cur.decimals,
    })
    const model = buildReceiptModel({
      invoiceNumber: s.invoiceNumber,
      refCode: s.refCode,
      dateIso: s.date,
      lines: s.lines,
      totals: s.totals,
      payment: s.payment,
      paidMinor: s.paidMinor, // الدفع المجزأ: المدفوع/المتبقي على المطبوعة (بلاغ المالك)
      customerName: s.customerId ? customers.find((c) => c.id === s.customerId)?.nameAr ?? null : null,
      taxPercent: setup.vatPercent,
      taxInclusive: setup.taxInclusive,
      settings: receipt,
    })
    if (qrDataUrl) model.qrDataUrl = qrDataUrl
    printHtml(template === 'a4' ? renderInvoiceA4Html(model, cur, receipt) : renderReceiptHtml(model, cur, receipt))
    toast.show(template === 'a4' ? `أُرسلت فاتورة A4 ${s.invoiceNumber} للطباعة 📄` : `أُرسل إيصال ${s.invoiceNumber} للطباعة 🖨️`)
  }

  const entry = viewing ? journal.find((e) => e.id === viewing.journalEntryId) : null

  if (sales.length === 0) {
    return (
      <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
        <EmptyState icon="🧾" title="لا فواتير مبيعات بعد" sub="افتح شاشة البيع (الكاشير) وابدأ أول فاتورة — سيتولد قيدها تلقائياً" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="anim-up flex items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="🔎 ابحث برقم الفاتورة أو مرجع التتبع (مثل SAL-260915-…)"
          className={inputCls + ' max-w-md'}
        />
        {query && <span className="text-[12px] text-slate-400">{filtered.length} نتيجة</span>}
      </div>
      <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-right text-[11px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
              <th className="px-4 py-3 font-bold">الفاتورة</th>
              <th className="px-4 py-3 font-bold">العميل</th>
              <th className="px-4 py-3 font-bold">الدفع</th>
              <th className="px-4 py-3 font-bold">الأصناف</th>
              <th className="px-4 py-3 font-bold">الإجمالي</th>
              <th className="px-4 py-3 font-bold">القيد</th>
              <th className="px-4 py-3 font-bold"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s, i) => (
              <tr key={s.id} style={{ animationDelay: `${i * 30}ms` }} className="anim-in border-b border-slate-50 dark:border-slate-800/50 hover:bg-emerald-500/[0.04] transition-colors duration-150">
                <td className="px-4 py-3">
                  <div className="font-bold text-slate-800 dark:text-white">{s.invoiceNumber}</div>
                  {s.refCode && <div className="text-[10px] font-mono text-sky-600 dark:text-sky-400" dir="ltr">{s.refCode}</div>}
                  <div className="text-[11px] text-slate-400">{s.date.slice(0, 16).replace('T', ' ')}</div>
                </td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                  {s.customerId ? customers.find((c) => c.id === s.customerId)?.nameAr ?? '—' : 'عميل نقدي'}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${s.payment === 'cash' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-violet-500/10 text-violet-600'}`}>
                    {s.payment === 'cash' ? '💵 كاش' : '👥 آجل'}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-500">{s.lines.length}</td>
                <td className="px-4 py-3 font-black text-emerald-600 dark:text-emerald-400">{fmt(s.totals.totalMinor)}</td>
                <td className="px-4 py-3">
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 font-bold flex items-center gap-1 w-fit">
                    <BookOpenText size={11} /> قيد #{s.journalEntryId}
                  </span>
                </td>
                <td className="px-4 py-3 text-left whitespace-nowrap">
                  <button onClick={() => printInvoice(s, 'thermal')} title="طباعة إيصال حراري" className="p-2 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-500/10 transition-all duration-200 hover:scale-110">
                    <Printer size={15} />
                  </button>
                  <button onClick={() => printInvoice(s, 'a4')} title="طباعة فاتورة A4 احترافية" className="p-2 rounded-lg text-slate-400 hover:text-violet-600 hover:bg-violet-500/10 transition-all duration-200 hover:scale-110">
                    <FileText size={15} />
                  </button>
                  <button onClick={() => setViewing(s)} className="p-2 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-500/10 transition-all duration-200 hover:scale-110">
                    <Eye size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing ? `فاتورة ${viewing.invoiceNumber}${viewing.refCode ? ` — ${viewing.refCode}` : ''}` : ''} wide>
        {viewing && (
          <div className="space-y-4">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-right text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                  <th className="px-3 py-2">الصنف</th><th className="px-3 py-2">كمية</th><th className="px-3 py-2">سعر</th><th className="px-3 py-2">خصم</th><th className="px-3 py-2">الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {viewing.lines.map((l, i) => (
                  <tr key={i} className="border-b border-slate-50 dark:border-slate-800/50">
                    <td className="px-3 py-2 font-bold">{l.nameAr}</td>
                    <td className="px-3 py-2">{l.qty}</td>
                    <td className="px-3 py-2">{fmt(l.unitPriceMinor)}</td>
                    <td className="px-3 py-2">{l.discountPercent ? `${l.discountPercent}٪` : '—'}</td>
                    <td className="px-3 py-2 font-bold">{fmt(Math.round(l.unitPriceMinor * l.qty * (1 - l.discountPercent / 100)))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex gap-4 text-[13px] font-bold flex-wrap">
              <span>الإجمالي: <b className="text-emerald-600">{fmt(viewing.totals.totalMinor)}</b></span>
              {viewing.totals.discountMinor > 0 && <span className="text-rose-500">الخصم: {fmt(viewing.totals.discountMinor)}</span>}
              {viewing.totals.taxMinor > 0 && <span className="text-slate-500">الضريبة: {fmt(viewing.totals.taxMinor)}</span>}
            </div>

            {/* القيد المحاسبي المرتبط — الشفافية بالاتجاهين (القرار 9) */}
            {entry && (
              <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.03] overflow-hidden">
                <div className="px-4 py-2.5 text-[12px] font-bold text-rose-600 dark:text-rose-400 border-b border-rose-500/10 flex items-center gap-1.5">
                  <BookOpenText size={13} /> القيد المحاسبي المتولد #{entry.entryNumber}
                </div>
                <table className="w-full text-[12px]">
                  <tbody>
                    {entry.lines.map((l, i) => (
                      <tr key={i} className="border-t border-rose-500/5">
                        <td className="px-4 py-1.5 text-slate-600 dark:text-slate-300">
                          {l.debit > 0 ? '' : '\u00A0\u00A0\u00A0\u00A0إلى '} {ACCOUNT_NAMES[l.accountCode] ?? l.accountCode}
                        </td>
                        <td className="px-4 py-1.5 w-28 font-bold">{l.debit > 0 ? fmt(l.debit) : ''}</td>
                        <td className="px-4 py-1.5 w-28 font-bold text-slate-400">{l.credit > 0 ? fmt(l.credit) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
