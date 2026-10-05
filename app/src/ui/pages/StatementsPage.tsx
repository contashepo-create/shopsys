import { PartyQuickPicker } from '../components/KeyboardPickers.tsx'
/**
 * كشوف الحساب (طلب المالك) — عميل / مورد / موظف
 * كل صف بتاريخه ومستنده والرصيد التراكمي، مع رصيد نهائي واضح وطباعة.
 */
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FileSpreadsheet, UserRound, Building2, UserCog, Printer } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { PartyNotesLog } from '../components/PartyNotesLog.tsx'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import { statementBalance, type StatementRow } from '../../core/statements.ts'
import { renderStatementHtml } from '../print/printStatement.ts'
import { printHtml } from '../print/printReceipt.ts'
import { EmptyState, Btn, useToast } from '../components/ui.tsx'

type Kind = 'customer' | 'supplier' | 'employee'

const KINDS: { id: Kind; nameAr: string; icon: typeof UserRound; debitLabel: string; creditLabel: string; positive: string; negative: string }[] = [
  { id: 'customer', nameAr: 'كشف حساب عميل', icon: UserRound, debitLabel: 'عليه (مدين)', creditLabel: 'له (دائن)', positive: 'مطلوب منه', negative: 'رصيد له عندك' },
  { id: 'supplier', nameAr: 'كشف حساب مورد', icon: Building2, debitLabel: 'سددنا / مرتجع', creditLabel: 'مستحق له', positive: 'مستحق له عندك', negative: 'رصيد لك عنده' },
  /* v1.0.5: تسميات الموظف كانت معكوسة عن اتجاه الحساب (الموجب=له) — بلاغ المالك */
  { id: 'employee', nameAr: 'كشف حساب موظف', icon: UserCog, debitLabel: 'عليه (سلف/قبض)', creditLabel: 'له (رواتب/سداد)', positive: 'رصيد له (مستحق)', negative: 'رصيد عليه (سلف قائمة)' },
]

export function StatementsPage() {
  const { customers, suppliers, employees,
    getCustomerStatementRows, getSupplierStatementRows, getEmployeeStatementRows } = useDataStore()
  const { setup, receipt } = useAppStore()
  const toast = useToast()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)

  // زر «كشف حساب» بجانب كل طرف (طلب المالك): يصل هنا بباراميترات ?kind=&id= فيفتح الكشف فوراً
  const [params] = useSearchParams()
  const urlKind = params.get('kind') as Kind | null
  const urlId = Number(params.get('id') || 0)
  const [kind, setKind] = useState<Kind>(urlKind && ['customer', 'supplier', 'employee'].includes(urlKind) ? urlKind : 'customer')
  const [partyId, setPartyId] = useState(urlId > 0 ? urlId : 0)

  const parties = kind === 'customer' ? customers : kind === 'supplier' ? suppliers : employees
  const meta = KINDS.find((k) => k.id === kind)!

  // AUDIT-013: مصدر واحد للكشف — دوال المتجر نفسها التي تغذي الأرصدة والتقارير
  // (كانت الصفحة تعيد تركيب الكشف يدوياً فتسقط منها نقاط الولاء والمقاصات).
  // بلا useMemo عمداً: الدوال مستقرة المرجع فكان الكشف يتجمد على لقطة قديمة بعد كل مستند جديد.
  const rows: StatementRow[] = !partyId
    ? []
    : kind === 'customer'
      ? getCustomerStatementRows(partyId)
      : kind === 'supplier'
        ? getSupplierStatementRows(partyId)
        /* كشف الموظف الموحّد (طلب المالك): مسيرات وقسائم وسلف وخصومات وسندات
         * وعمولات وعهدات — من دالة المتجر نفسها التي تغذي رصيد الموظف، فلا
         * يسقط منها مستند ولا يتكرر استرداد سلفة مرتين. */
        : getEmployeeStatementRows(partyId).map((row, index, list) => ({
          date: row.date,
          docLabel: `${row.ref} — ${row.description}`,
          /* v1.0.5: قيمة العملية = أكبر الجانبين (الحركة غالباً أحادية الجانب،
             والعمولة المصروفة مدين+دائن معاً فلا يصح جمعهما فيتضاعف المبلغ) */
          operationMinor: Math.max(row.debitMinor, row.creditMinor) || undefined,
          debitMinor: row.debitMinor,
          creditMinor: row.creditMinor,
          balanceMinor: list.slice(0, index + 1).reduce((sum, line) => sum + line.creditMinor - line.debitMinor, 0),
        }))

  const balance = statementBalance(rows)
  const partyName = parties.find((p) => p.id === partyId)?.nameAr ?? ''

  // إصلاح بلاغ المالك: كانت الطباعة عبر window.open فتحجبها المتصفحات —
  // الآن iframe مخفي (نفس آلية إيصال الكاشير) + قالب احترافي على نمط pro-acc
  const exportStatement = () => {
    const headers = ['التاريخ', 'المستند', 'قيمة العملية', meta.debitLabel, meta.creditLabel, 'الرصيد']
    const values = rows.map((row) => [row.date.slice(0, 10), row.docLabel, row.operationMinor != null ? fmt(row.operationMinor) : '', fmt(row.debitMinor), fmt(row.creditMinor), fmt(row.balanceMinor)])
    const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
    const csv = '\ufeff' + [headers, ...values].map((row) => row.map(escape).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `statement-${kind}-${partyId}.csv`; anchor.click(); URL.revokeObjectURL(url)
    toast.show('تم تصدير كشف الحساب إلى Excel ✓')
  }

  const print = () => {
    printHtml(renderStatementHtml({
      shopName: setup.shopName || 'تَحَكَّم',
      headerLines: receipt.headerLines,
      title: meta.nameAr,
      partyName,
      rows,
      debitLabel: meta.debitLabel,
      creditLabel: meta.creditLabel,
      balanceMeaning: [meta.positive, meta.negative],
      cur,
    }))
    toast.show('أُرسل كشف الحساب للطباعة 🖨️')
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
        <div className="max-w-sm w-full"><PartyQuickPicker parties={parties} value={partyId} onChange={setPartyId} cashLabel={`اختر ${kind === 'customer' ? 'العميل' : kind === 'supplier' ? 'المورد' : 'الموظف'}`} label={`بحث ${kind === 'customer' ? 'العميل' : kind === 'supplier' ? 'المورد' : 'الموظف'}`} showCash={false} /></div>
        {partyId > 0 && rows.length > 0 && (
          <><Btn variant="ghost" onClick={print}><Printer size={15} /> طباعة الكشف</Btn><Btn variant="ghost" onClick={exportStatement}><FileSpreadsheet size={15} /> Excel</Btn></>
        )}
      </div>

      {/* سجل ملاحظات الطرف: تاريخ ما كُتب عنه في الفواتير وفي بطاقته (طلب المالك) */}
      {partyId > 0 && kind !== 'employee' && (
        <PartyNotesLog kind={kind} partyId={partyId} partyName={parties.find((party) => party.id === partyId)?.nameAr ?? ''} />
      )}

      {!partyId ? (
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
          <EmptyState icon="📄" title="اختر طرفاً لعرض كشف حسابه" sub="فواتير ومرتجعات وخدمات وسندات وشيكات ورواتب وسلف — كل عملية بتاريخها ورصيدها التراكمي" />
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
                  <th className="px-4 py-3 font-bold text-left">قيمة العملية</th>
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
                    <td className="px-4 py-2.5 text-left font-bold text-indigo-500">{r.operationMinor != null ? fmt(r.operationMinor) : ''}</td>
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
