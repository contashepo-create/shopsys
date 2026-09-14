/**
 * منتقي مصدر الدفع الموحّد (طلب المالك):
 * خزينة/بنك — أو ملف عهدة موظف مفتوح (يُخصم من عهدته ويظهر في ملفه).
 * لا يعرض أبداً ملفات عهد مغلقة، ويعرض متبقي كل ملف مباشرة.
 */
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import { summarizeCustody } from '../../core/custody.ts'
import { inputCls } from './ui.tsx'
import { TreasuryPicker } from './TreasuryPicker.tsx'

export interface PaySourceValue {
  kind: 'treasury' | 'custody'
  treasury: string // كود الخزينة/البنك (عند kind=treasury)
  custodyFileId: number | null // ملف العهدة (عند kind=custody)
}

export const DEFAULT_PAY_SOURCE: PaySourceValue = { kind: 'treasury', treasury: '1101', custodyFileId: null }

export function PaySourcePicker({ value, onChange }: { value: PaySourceValue; onChange: (v: PaySourceValue) => void }) {
  const custodyFiles = useDataStore((s) => s.custodyFiles)
  const custodyTxs = useDataStore((s) => s.custodyTxs)
  const employees = useDataStore((s) => s.employees)
  const { setup } = useAppStore()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }

  // ملفات مفتوحة فقط — «لا تعطيني عهدة مغلقة لأسوي منها» (طلب المالك)
  const openFiles = custodyFiles.filter((f) => f.status === 'open')

  const btn = (active: boolean) =>
    `flex-1 py-2 rounded-xl text-[12px] font-bold border-2 transition-all ${active ? 'border-brand-500/60 bg-brand-500/10 text-brand-700 dark:text-brand-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        <button type="button" onClick={() => onChange({ ...value, kind: 'treasury' })} className={btn(value.kind === 'treasury')}>🏦 خزينة / بنك</button>
        <button
          type="button"
          onClick={() => onChange({ kind: 'custody', treasury: value.treasury, custodyFileId: openFiles[0]?.id ?? null })}
          disabled={openFiles.length === 0}
          className={`${btn(value.kind === 'custody')} disabled:opacity-40`}
          title={openFiles.length === 0 ? 'لا ملفات عهد مفتوحة' : ''}
        >🤝 عهدة موظف</button>
      </div>
      {value.kind === 'treasury' ? (
        <TreasuryPicker value={value.treasury} onChange={(code) => onChange({ ...value, treasury: code })} compact />
      ) : (
        <select
          value={value.custodyFileId ?? ''}
          onChange={(e) => onChange({ ...value, custodyFileId: e.target.value ? Number(e.target.value) : null })}
          className={inputCls}
        >
          {openFiles.map((f) => {
            const emp = employees.find((x) => x.id === f.employeeId)?.nameAr ?? '—'
            const remaining = summarizeCustody(custodyTxs.filter((t) => t.fileId === f.id)).remainingMinor
            return <option key={f.id} value={f.id}>{f.fileNumber} — {emp} (متبقٍ {formatMinor(remaining, cur, false)} {cur.symbol})</option>
          })}
        </select>
      )}
    </div>
  )
}
