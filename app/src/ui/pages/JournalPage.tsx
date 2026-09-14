/**
 * اليومية العامة — للوضع المحاسبي الكامل (القرار 10)
 * كل قيد مربوط بمستنده، وميزان تحقق حي أسفل الشاشة
 */
import { useMemo } from 'react'
import { BookOpenText, Link2, Scale } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import { EmptyState } from '../components/ui.tsx'
import { ACCOUNT_NAMES } from './accountNames.ts'

/** تسميات مصادر القيود بالعربية — كل قيد مربوط بمستنده (القرار 9) */
const SOURCE_LABELS: Record<string, string> = {
  sale: 'فاتورة بيع',
  sale_return: 'مرتجع مبيعات',
  purchase: 'فاتورة شراء',
  purchase_return: 'مرتجع شراء',
  receipt_voucher: 'سند قبض',
  payment_voucher: 'سند صرف',
  adjustment: 'تسوية',
  payroll: 'رواتب',
  rental_contract: 'عقد إيجار',
  logistics_trip: 'نقلة',
  opening: 'قيد افتتاحي',
  manual: 'قيد يدوي',
  reversal: 'قيد عاكس',
}

export function JournalPage() {
  const { journal } = useDataStore()
  const { setup } = useAppStore()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)

  const { totalDebit, totalCredit } = useMemo(() => {
    let d = 0, c = 0
    for (const e of journal) for (const l of e.lines) { d += l.debit; c += l.credit }
    return { totalDebit: d, totalCredit: c }
  }, [journal])

  if (journal.length === 0) {
    return (
      <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800">
        <EmptyState icon="📒" title="لا قيود بعد" sub="كل فاتورة بيع أو عملية مالية ستولد قيدها هنا تلقائياً — جرب البيع من الكاشير" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* شريط التوازن الحي */}
      <div className={`anim-pop flex items-center gap-3 p-4 rounded-2xl border font-bold text-sm ${
        totalDebit === totalCredit
          ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-700 dark:text-emerald-400'
          : 'bg-rose-500/15 border-rose-500/40 text-rose-700 animate-pulse'
      }`}>
        <Scale size={18} />
        {totalDebit === totalCredit
          ? <>✅ الدفتر متوازن: مجموع المدين {fmt(totalDebit)} = مجموع الدائن {fmt(totalCredit)}</>
          : <>💥 اختلال! مدين {fmt(totalDebit)} ≠ دائن {fmt(totalCredit)} — هذا مستحيل بنيوياً، أبلغ الدعم فوراً</>}
      </div>

      <div className="space-y-3">
        {[...journal].reverse().map((e, i) => (
          <div key={e.id} style={{ animationDelay: `${i * 40}ms` }} className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden hover:border-rose-300/50 transition-colors duration-200">
            <div className="px-4 py-2.5 flex items-center gap-3 border-b border-slate-50 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/20">
              <span className="text-[11px] font-black px-2 py-0.5 rounded-lg bg-rose-500/10 text-rose-600">#{e.entryNumber}</span>
              <span className="text-[12px] text-slate-400">{e.date}</span>
              <span className="font-bold text-[13px] text-slate-700 dark:text-slate-200 flex-1">{e.description}</span>
              {e.sourceId && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-600 font-bold flex items-center gap-1">
                  <Link2 size={10} /> {SOURCE_LABELS[e.sourceType] ?? e.sourceType}
                </span>
              )}
            </div>
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-right text-[10px] text-slate-300 dark:text-slate-600">
                  <th className="px-4 pt-2 pb-1 font-bold">الحساب</th>
                  <th className="px-4 pt-2 pb-1 font-bold w-32">مدين</th>
                  <th className="px-4 pt-2 pb-1 font-bold w-32">دائن</th>
                </tr>
              </thead>
              <tbody>
                {e.lines.map((l, j) => (
                  <tr key={j}>
                    <td className={`px-4 py-1 ${l.credit > 0 ? 'pr-10 text-slate-500' : 'font-bold text-slate-700 dark:text-slate-200'}`}>
                      {l.credit > 0 && 'إلى '} {ACCOUNT_NAMES[l.accountCode] ?? l.accountCode}
                      {l.note && <span className="text-[10px] text-slate-300 dark:text-slate-600 mr-2">({l.note})</span>}
                    </td>
                    <td className="px-4 py-1 font-bold">{l.debit > 0 ? fmt(l.debit) : ''}</td>
                    <td className="px-4 py-1 text-slate-400">{l.credit > 0 ? fmt(l.credit) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-1.5 text-[10px] text-slate-300 dark:text-slate-600 border-t border-slate-50 dark:border-slate-800/60 flex items-center gap-1">
              <BookOpenText size={10} /> {e.createdBy} · {e.createdAt.slice(0, 16).replace('T', ' ')} · دفتر Append-Only — التصحيح بقيد عكسي فقط
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
