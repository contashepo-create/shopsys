import { QuickSelect } from './KeyboardPickers.tsx'
/**
 * منتقي مصدر الدفع الموحّد (طلب المالك):
 * خزينة/بنك — أو ملف عهدة موظف مفتوح (يُخصم من عهدته ويظهر في ملفه).
 * لا يعرض أبداً ملفات عهد مغلقة، ويعرض متبقي كل ملف مباشرة.
 */
import { useEffect } from 'react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import { summarizeCustody } from '../../core/custody.ts'
import { inputCls } from './ui.tsx'
import { treasuryLabel } from '../../core/treasury.ts'
import { allowedTreasuryCodes } from '../../core/treasuryAccess.ts'

export interface PaySourceValue {
  kind: 'treasury' | 'custody'
  treasury: string // كود الخزينة/البنك (عند kind=treasury)
  custodyFileId: number | null // ملف العهدة (عند kind=custody)
}

export const DEFAULT_PAY_SOURCE: PaySourceValue = { kind: 'treasury', treasury: '1101', custodyFileId: null }

export function PaySourcePicker({ value, onChange, layout = 'combined' }: { value: PaySourceValue; onChange: (v: PaySourceValue) => void; layout?: 'combined' | 'dependent' }) {
  const custodyFiles = useDataStore((s) => s.custodyFiles)
  const custodyTxs = useDataStore((s) => s.custodyTxs)
  const employees = useDataStore((s) => s.employees)
  const allTreasuries = useDataStore((s) => s.treasuries)
  const appUsers = useDataStore((s) => s.appUsers)
  const currentUserId = useDataStore((s) => s.currentUserId)
  const currentUser = appUsers.find((user) => user.id === currentUserId)
  const allowedCodes = allowedTreasuryCodes(currentUser?.treasuryAccess, 'payment')
  const treasuries = allowedCodes == null ? allTreasuries : allTreasuries.filter((treasury) => allowedCodes.includes(treasury.code))
  const preferredTreasury = currentUser?.treasuryAccess?.defaultTreasuryCode
  const fallbackTreasury = treasuries.find((treasury) => treasury.code === preferredTreasury)?.code ?? treasuries[0]?.code
  useEffect(() => {
    if (value.kind === 'treasury' && fallbackTreasury && !treasuries.some((treasury) => treasury.code === value.treasury)) {
      onChange({ ...value, treasury: fallbackTreasury })
    }
  }, [fallbackTreasury, onChange, treasuries, value])
  const { setup } = useAppStore()
  const cur = (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }

  // ملفات مفتوحة فقط — وفي منتقي المشروع نُخفي الملف الذي لا يملك رصيداً قابلاً للصرف.
  const openFiles = custodyFiles.filter((f) => f.status === 'open')
  const payableOpenFiles = openFiles.filter((f) => summarizeCustody(custodyTxs.filter((t) => t.fileId === f.id)).remainingMinor > 0)
  const fallbackFile = payableOpenFiles[0]?.id ?? openFiles[0]?.id ?? null
  useEffect(() => {
    if (layout === 'dependent') {
      if (value.kind === 'custody' && payableOpenFiles.length === 0 && fallbackTreasury) {
        onChange({ ...value, kind: 'treasury', treasury: fallbackTreasury, custodyFileId: null })
      } else if (value.kind === 'treasury' && treasuries.length === 0 && fallbackFile != null) {
        onChange({ ...value, kind: 'custody', custodyFileId: fallbackFile })
      } else if (value.kind === 'custody' && payableOpenFiles.length > 0 && !payableOpenFiles.some((file) => file.id === value.custodyFileId)) {
        onChange({ ...value, custodyFileId: fallbackFile })
      } else if (value.kind === 'treasury' && fallbackTreasury && !treasuries.some((treasury) => treasury.code === value.treasury)) {
        onChange({ ...value, treasury: fallbackTreasury })
      }
    } else if (value.kind === 'treasury' && fallbackTreasury && !treasuries.some((treasury) => treasury.code === value.treasury)) {
      onChange({ ...value, treasury: fallbackTreasury })
    }
  }, [fallbackFile, fallbackTreasury, layout, onChange, payableOpenFiles, treasuries, value])
  const selectableFiles = layout === 'dependent' ? payableOpenFiles : openFiles
  if (treasuries.length === 0 && selectableFiles.length === 0) return <div className="text-[11px] font-bold text-rose-500">لا يوجد مصدر دفع مسموح لهذه العملية</div>

  if (layout === 'dependent') {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" data-pay-source-dependent>
        <QuickSelect
          aria-label="نوع مصدر الدفع"
          value={value.kind}
          onChange={(e) => {
            if (e.target.value === 'custody') {
              onChange({ ...value, kind: 'custody', custodyFileId: payableOpenFiles.some((file) => file.id === value.custodyFileId) ? value.custodyFileId : fallbackFile })
            } else {
              onChange({ ...value, kind: 'treasury', treasury: treasuries.some((treasury) => treasury.code === value.treasury) ? value.treasury : fallbackTreasury ?? '1101', custodyFileId: null })
            }
          }}
          className={inputCls}
        >
          {treasuries.length > 0 && <option value="treasury">خزينة / بنك</option>}
          {payableOpenFiles.length > 0 && <option value="custody">عهدة موظف</option>}
        </QuickSelect>
        {value.kind === 'custody' ? (
          <QuickSelect
            aria-label="ملف العهدة للدفع"
            value={value.custodyFileId ?? ''}
            onChange={(e) => onChange({ ...value, custodyFileId: Number(e.target.value) || null })}
            className={inputCls}
          >
            {payableOpenFiles.map((file) => {
              const employeeName = employees.find((employee) => employee.id === file.employeeId)?.nameAr ?? '—'
              const remaining = summarizeCustody(custodyTxs.filter((tx) => tx.fileId === file.id)).remainingMinor
              return <option key={file.id} value={file.id}>{file.fileNumber} — {employeeName} (متبقٍ {formatMinor(remaining, cur, false)} {cur.symbol})</option>
            })}
          </QuickSelect>
        ) : (
          <QuickSelect
            aria-label="الخزينة أو البنك للدفع"
            value={value.treasury}
            onChange={(e) => onChange({ ...value, treasury: e.target.value, custodyFileId: null })}
            className={inputCls}
          >
            {treasuries.filter((treasury) => !treasury.parentCode).map((parent) => {
              const children = treasuries.filter((treasury) => treasury.parentCode === parent.code)
              return children.length
                ? <option key={parent.code} value={parent.code}>{treasuryLabel(parent)} — الرئيسي</option>
                : <option key={parent.code} value={parent.code}>{treasuryLabel(parent)}</option>
            })}
            {treasuries.filter((treasury) => treasury.parentCode).map((treasury) => <option key={treasury.code} value={treasury.code}>↳ {treasuryLabel(treasury)}</option>)}
          </QuickSelect>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <QuickSelect
        aria-label="مصدر الدفع"
        value={value.kind === 'treasury' ? `treasury:${value.treasury}` : `custody:${value.custodyFileId ?? ''}`}
        onChange={(e) => {
          const selected = e.target.value
          if (selected.startsWith('custody:')) onChange({ ...value, kind: 'custody', custodyFileId: Number(selected.slice('custody:'.length)) || openFiles[0]?.id || null })
          else onChange({ ...value, kind: 'treasury', treasury: selected.slice('treasury:'.length), custodyFileId: null })
        }}
        className={inputCls}
      >
        <optgroup label="خزينة / بنك / محفظة">
          {treasuries.filter((treasury) => !treasury.parentCode).map((parent) => {
            const children = treasuries.filter((treasury) => treasury.parentCode === parent.code)
            return children.length
              ? <option key={parent.code} value={`treasury:${parent.code}`}>{treasuryLabel(parent)} — الرئيسي</option>
              : <option key={parent.code} value={`treasury:${parent.code}`}>{treasuryLabel(parent)}</option>
          })}
          {treasuries.filter((treasury) => treasury.parentCode).map((treasury) => <option key={treasury.code} value={`treasury:${treasury.code}`}>↳ {treasuryLabel(treasury)}</option>)}
        </optgroup>
        {openFiles.length > 0 && (
          <optgroup label="عهدة موظف">
            {openFiles.map((f) => {
              const emp = employees.find((x) => x.id === f.employeeId)?.nameAr ?? '—'
              const remaining = summarizeCustody(custodyTxs.filter((t) => t.fileId === f.id)).remainingMinor
              return <option key={f.id} value={`custody:${f.id}`}>{f.fileNumber} — {emp} (متبقٍ {formatMinor(remaining, cur, false)} {cur.symbol})</option>
            })}
          </optgroup>
        )}
      </QuickSelect>
    </div>
  )
}
