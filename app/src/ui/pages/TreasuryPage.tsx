/**
 * الخزائن والبنوك (المرحلة 4) —
 * أرصدة حية من دفتر الأستاذ + تحويل بين الخزينة والبنك (إيداع/سحب)
 * + كشف حركة لكل خزينة.
 */
import { useMemo, useState } from 'react'
import { Landmark, PiggyBank, ArrowLeftRight, BookOpenText } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import type { TreasuryAccount } from '../../core/accounting.ts'
import { Btn, Modal, Field, inputCls, useToast } from '../components/ui.tsx'
import { ACCOUNT_NAMES } from './accountNames.ts'

export function TreasuryPage() {
  const { journal, postVoucher } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
  const fmt = (m: number) => formatMinor(m, cur, false)

  const [transferOpen, setTransferOpen] = useState(false)
  const [from, setFrom] = useState<TreasuryAccount>('1101')
  const [amount, setAmount] = useState('')
  const [desc, setDesc] = useState('')
  const [statement, setStatement] = useState<TreasuryAccount | null>(null)

  /** رصيد وحركة كل خزينة من دفتر الأستاذ مباشرة */
  const treasuries = useMemo(() => {
    const calc = (code: TreasuryAccount) => {
      let bal = 0
      const moves: { date: string; description: string; inMinor: number; outMinor: number; balance: number; entryId: number }[] = []
      for (const e of journal) {
        for (const l of e.lines) {
          if (l.accountCode !== code) continue
          bal += l.debit - l.credit
          moves.push({ date: e.date, description: e.description, inMinor: l.debit, outMinor: l.credit, balance: bal, entryId: e.id })
        }
      }
      return { balance: bal, moves }
    }
    return { '1101': calc('1101'), '1102': calc('1102') }
  }, [journal])

  const to: TreasuryAccount = from === '1101' ? '1102' : '1101'

  const doTransfer = () => {
    try {
      const v = postVoucher({
        kind: 'transfer',
        treasury: from,
        counterAccountCode: to,
        amountMinor: toMinor(amount || '0', cur.decimals),
        description: desc.trim() || (from === '1101' ? 'إيداع بنكي' : 'سحب من البنك'),
      })
      toast.show(`تم التحويل ${v.voucherNumber} — ${fmt(v.amountMinor)} من ${ACCOUNT_NAMES[from]} إلى ${ACCOUNT_NAMES[to]} ✓`)
      setTransferOpen(false)
      setAmount('')
      setDesc('')
    } catch (e) {
      toast.show((e as Error).message, 'error')
    }
  }

  const cards: { code: TreasuryAccount; icon: typeof Landmark; color: string; glow: string }[] = [
    { code: '1101', icon: PiggyBank, color: 'from-emerald-500 to-teal-500', glow: 'shadow-emerald-500/30' },
    { code: '1102', icon: Landmark, color: 'from-sky-500 to-cyan-500', glow: 'shadow-sky-500/30' },
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between anim-up flex-wrap gap-2">
        <div className="text-sm text-slate-500">الأرصدة حية من دفتر الأستاذ — اضغط خزينة لكشف حركتها</div>
        <Btn onClick={() => { setAmount(''); setDesc(''); setTransferOpen(true) }}>
          <ArrowLeftRight size={15} /> تحويل خزينة ↔ بنك
        </Btn>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {cards.map(({ code, icon: Icon, color, glow }, i) => (
          <button
            key={code}
            onClick={() => setStatement(code)}
            style={{ animationDelay: `${i * 60}ms` }}
            className="anim-up text-right rounded-3xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5 hover:scale-[1.02] hover:shadow-xl transition-all duration-200"
          >
            <div className="flex items-center gap-3">
              <span className={`w-12 h-12 rounded-2xl bg-gradient-to-l ${color} flex items-center justify-center text-white shadow-lg ${glow}`}>
                <Icon size={22} />
              </span>
              <div>
                <div className="text-[12px] font-bold text-slate-400">{ACCOUNT_NAMES[code]}</div>
                <div className={`font-black text-2xl ${treasuries[code].balance < 0 ? 'text-rose-500' : 'text-slate-800 dark:text-white'}`}>
                  {fmt(treasuries[code].balance)} <span className="text-xs">{cur.symbol}</span>
                </div>
              </div>
            </div>
            <div className="text-[11px] text-slate-400 mt-3">{treasuries[code].moves.length} حركة — اضغط لكشف الحساب</div>
          </button>
        ))}
      </div>

      {/* تحويل */}
      <Modal open={transferOpen} onClose={() => setTransferOpen(false)} title="تحويل بين الخزينة والبنك">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setFrom('1101')}
              className={`p-3 rounded-2xl border-2 font-bold text-sm transition-all ${from === '1101' ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}
            >🏦 إيداع: خزينة ← بنك</button>
            <button
              onClick={() => setFrom('1102')}
              className={`p-3 rounded-2xl border-2 font-bold text-sm transition-all ${from === '1102' ? 'border-sky-500/60 bg-sky-500/10 text-sky-700 dark:text-sky-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}
            >💵 سحب: بنك ← خزينة</button>
          </div>
          <div className="text-center text-[12px] text-slate-400 font-bold">
            من <b className="text-slate-600 dark:text-slate-200">{ACCOUNT_NAMES[from]}</b> إلى <b className="text-slate-600 dark:text-slate-200">{ACCOUNT_NAMES[to]}</b>
          </div>
          <Field label={`المبلغ (${cur.symbol})`}>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className={inputCls} dir="ltr" autoFocus />
          </Field>
          <Field label="البيان (اختياري)">
            <input value={desc} onChange={(e) => setDesc(e.target.value)} className={inputCls} />
          </Field>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setTransferOpen(false)}>إلغاء</Btn>
            <Btn onClick={doTransfer} disabled={!amount.trim()}>↔️ تنفيذ التحويل</Btn>
          </div>
        </div>
      </Modal>

      {/* كشف حساب خزينة */}
      <Modal open={!!statement} onClose={() => setStatement(null)} title={statement ? `كشف حركة — ${ACCOUNT_NAMES[statement]}` : ''} wide>
        {statement && (
          <div className="space-y-3">
            {treasuries[statement].moves.length === 0 ? (
              <div className="text-center text-sm text-slate-400 py-8">لا حركات بعد</div>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-right text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                    <th className="px-3 py-2">التاريخ</th>
                    <th className="px-3 py-2">البيان</th>
                    <th className="px-3 py-2 text-left">داخل</th>
                    <th className="px-3 py-2 text-left">خارج</th>
                    <th className="px-3 py-2 text-left">الرصيد</th>
                  </tr>
                </thead>
                <tbody>
                  {[...treasuries[statement].moves].reverse().map((m, i) => (
                    <tr key={i} className="border-b border-slate-50 dark:border-slate-800/50">
                      <td className="px-3 py-2 text-slate-400 text-[11px]">{m.date}</td>
                      <td className="px-3 py-2 font-bold text-slate-700 dark:text-slate-200">
                        {m.description}
                        <span className="text-[10px] text-rose-400 mr-2 inline-flex items-center gap-0.5"><BookOpenText size={10} />#{m.entryId}</span>
                      </td>
                      <td className="px-3 py-2 text-left font-bold text-emerald-600">{m.inMinor ? fmt(m.inMinor) : ''}</td>
                      <td className="px-3 py-2 text-left font-bold text-rose-500">{m.outMinor ? fmt(m.outMinor) : ''}</td>
                      <td className={`px-3 py-2 text-left font-black ${m.balance < 0 ? 'text-rose-500' : 'text-slate-800 dark:text-white'}`}>{fmt(m.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
