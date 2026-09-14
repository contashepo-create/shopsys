/**
 * كشوف الحساب (طلب المالك) — عميل / مورد / موظف
 * كل صف بتاريخه ومستنده والرصيد التراكمي، مع رصيد نهائي واضح وطباعة.
 */
import { useMemo, useState } from 'react'
import { FileSpreadsheet, UserRound, Building2, UserCog, Printer } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import { customerStatement, supplierStatement, employeeStatement, statementBalance, type StatementRow } from '../../core/statements.ts'
import { inputCls, EmptyState, Btn } from '../components/ui.tsx'

type Kind = 'customer' | 'supplier' | 'employee'

const KINDS: { id: Kind; nameAr: string; icon: typeof UserRound; debitLabel: string; creditLabel: string; positive: string; negative: string }[] = [
  { id: 'customer', nameAr: 'كشف حساب عميل', icon: UserRound, debitLabel: 'عليه (مدين)', creditLabel: 'له (دائن)', positive: 'مطلوب منه', negative: 'رصيد له عندك' },
  { id: 'supplier', nameAr: 'كشف حساب مورد', icon: Building2, debitLabel: 'سددنا / مرتجع', creditLabel: 'مستحق له', positive: 'مستحق له عندك', negative: 'رصيد لك عنده' },
  { id: 'employee', nameAr: 'كشف حساب موظف', icon: UserCog, debitLabel: 'سلف مصروفة', creditLabel: 'مستقطع من الراتب', positive: 'سلف متبقية عليه', negative: 'رصيد له' },
]

export function StatementsPage() {
  const { customers, suppliers, employees, sales, saleReturns, purchases, purchaseReturns, vouchers, cheques, employeeAdvances, payrollRuns } = useDataStore()
  const { setup } = useAppStore()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)

  const [kind, setKind] = useState<Kind>('customer')
  const [partyId, setPartyId] = useState(0)

  const parties = kind === 'customer' ? customers : kind === 'supplier' ? suppliers : employees
  const meta = KINDS.find((k) => k.id === kind)!

  const rows: StatementRow[] = useMemo(() => {
    if (!partyId) return []
    if (kind === 'customer') {
      return customerStatement({
        customerId: partyId,
        sales, saleReturns,
        allSales: sales,
        vouchers, cheques,
      })
    }
    if (kind === 'supplier') {
      return supplierStatement({
        supplierId: partyId,
        purchases, purchaseReturns,
        allPurchases: purchases,
        vouchers, cheques,
      })
    }
    return employeeStatement({ employeeId: partyId, advances: employeeAdvances, payrollRuns })
  }, [kind, partyId, sales, saleReturns, purchases, purchaseReturns, vouchers, cheques, employeeAdvances, payrollRuns])

  const balance = statementBalance(rows)
  const partyName = parties.find((p) => p.id === partyId)?.nameAr ?? ''

  const print = () => {
    const w = window.open('', '_blank', 'width=800,height=600')
    if (!w) return
    const rowsHtml = rows.map((r) => `<tr>
      <td>${r.date.slice(0, 10)}</td><td>${r.docLabel}</td>
      <td style="text-align:left">${r.debitMinor ? fmt(r.debitMinor) : ''}</td>
      <td style="text-align:left">${r.creditMinor ? fmt(r.creditMinor) : ''}</td>
      <td style="text-align:left;font-weight:bold">${fmt(r.balanceMinor)}</td></tr>`).join('')
    w.document.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>${meta.nameAr} — ${partyName}</title>
      <style>body{font-family:system-ui;padding:24px}h2{margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:16px;font-size:13px}
      th,td{border:1px solid #ddd;padding:6px 10px;text-align:right}th{background:#f5f5f5}</style></head><body>
      <h2>${setup.shopName || 'تَحَكَّم'}</h2>
      <div>${meta.nameAr}: <b>${partyName}</b> — حتى ${new Date().toISOString().slice(0, 10)}</div>
      <table><thead><tr><th>التاريخ</th><th>المستند</th><th>${meta.debitLabel}</th><th>${meta.creditLabel}</th><th>الرصيد</th></tr></thead>
      <tbody>${rowsHtml}</tbody></table>
      <h3 style="margin-top:16px">الرصيد النهائي: ${fmt(Math.abs(balance))} ${cur.symbol} ${balance >= 0 ? `(${meta.positive})` : `(${meta.negative})`}</h3>
      <script>window.print()</script></body></html>`)
    w.document.close()
  }

  return (
    <div className="space-y-4">
      {/* اختيار النوع والطرف */}
      <div className="anim-up grid grid-cols-1 sm:grid-cols-3 gap-2">
        {KINDS.map((k) => (
          <button
            key={k.id}
            onClick={() => { setKind(k.id); setPartyId(0) }}
            className={`p-3.5 rounded-2xl border-2 font-bold text-[13px] flex items-center gap-2.5 justify-center transition-all duration-200 hover:scale-[1.01] ${
              kind === k.id ? 'border-indigo-500/60 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'
            }`}
          >
            <k.icon size={17} /> {k.nameAr}
          </button>
        ))}
      </div>

      <div className="anim-up flex items-center gap-3 flex-wrap" style={{ animationDelay: '60ms' }}>
        <select value={partyId} onChange={(e) => setPartyId(Number(e.target.value))} className={`${inputCls} max-w-sm`}>
          <option value={0}>اختر {kind === 'customer' ? 'العميل' : kind === 'supplier' ? 'المورد' : 'الموظف'}…</option>
          {parties.map((p) => <option key={p.id} value={p.id}>{p.nameAr}</option>)}
        </select>
        {partyId > 0 && rows.length > 0 && (
          <Btn variant="ghost" onClick={print}><Printer size={15} /> طباعة الكشف</Btn>
        )}
      </div>

      {!partyId ? (
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
          <EmptyState icon="📄" title="اختر طرفاً لعرض كشف حسابه" sub="فواتير آجلة، سندات، شيكات، مرتجعات، سلف — كل حركة بتاريخها ورصيدها التراكمي" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
          <EmptyState icon="✓" title="لا حركات على هذا الحساب" sub="كل تعاملاته نقدية مسددة أو لم تبدأ بعد" />
        </div>
      ) : (
        <>
          {/* الرصيد النهائي */}
          <div className={`anim-pop rounded-2xl border-2 p-4 flex items-center justify-between ${
            balance > 0 ? 'border-rose-500/25 bg-rose-500/5' : balance < 0 ? 'border-emerald-500/25 bg-emerald-500/5' : 'border-slate-200 dark:border-slate-700'
          }`}>
            <div className="flex items-center gap-2 text-[13px] font-bold text-slate-600 dark:text-slate-300">
              <FileSpreadsheet size={16} /> الرصيد النهائي — {partyName}
            </div>
            <div className={`font-black text-xl ${balance > 0 ? 'text-rose-600' : balance < 0 ? 'text-emerald-600' : 'text-slate-500'}`}>
              {fmt(Math.abs(balance))} {cur.symbol}
              <span className="text-[11px] font-bold mr-2 opacity-80">{balance === 0 ? 'مُسدد بالكامل ✓' : balance > 0 ? meta.positive : meta.negative}</span>
            </div>
          </div>

          <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-right text-[10.5px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                  <th className="px-4 py-3 font-bold">التاريخ</th>
                  <th className="px-4 py-3 font-bold">المستند</th>
                  <th className="px-4 py-3 font-bold text-left">{meta.debitLabel}</th>
                  <th className="px-4 py-3 font-bold text-left">{meta.creditLabel}</th>
                  <th className="px-4 py-3 font-bold text-left">الرصيد</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={{ animationDelay: `${i * 20}ms` }} className="anim-in border-b border-slate-50 dark:border-slate-800/50">
                    <td className="px-4 py-2.5 text-slate-400 text-[11.5px]">{r.date.slice(0, 10)}</td>
                    <td className="px-4 py-2.5 font-bold text-slate-700 dark:text-slate-200">{r.docLabel}</td>
                    <td className="px-4 py-2.5 text-left font-bold text-rose-500">{r.debitMinor ? fmt(r.debitMinor) : ''}</td>
                    <td className="px-4 py-2.5 text-left font-bold text-emerald-600">{r.creditMinor ? fmt(r.creditMinor) : ''}</td>
                    <td className={`px-4 py-2.5 text-left font-black ${r.balanceMinor > 0 ? 'text-slate-800 dark:text-white' : 'text-emerald-600'}`}>{fmt(r.balanceMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
