import { useEffect } from 'react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import { summarizeCustody } from '../../core/custody.ts'
import { treasuryLabel } from '../../core/treasury.ts'
import { allowedTreasuryCodes } from '../../core/treasuryAccess.ts'
import { QuickSelect } from './KeyboardPickers.tsx'
import { Field, inputCls } from './ui.tsx'

/** منتقي الخزينة/البنك أو ملف العهدة المفتوح. */
export interface PaySourceValue {
  kind: 'treasury' | 'custody'
  treasury: string // كود الخزينة/البنك (عند kind=treasury)
  custodyFileId: number | null // ملف العهدة (عند kind=custody)
}

export const DEFAULT_PAY_SOURCE: PaySourceValue = { kind: 'treasury', treasury: '1101', custodyFileId: null }

type PaySourcePickerProps = {
  value: PaySourceValue
  onChange: (value: PaySourceValue) => void
  /** منتقي بعنصرين: نوع المصدر ثم الخزينة/الملف التابع له. */
  layout?: 'combined' | 'dependent'
  /** تسميات صريحة حول كل قائمة في النماذج التي تعرض المبلغ المدفوع. */
  linked?: boolean
}

export function PaySourcePicker({ value, onChange, layout = 'combined', linked = false }: PaySourcePickerProps) {
  const custodyFiles = useDataStore((state) => state.custodyFiles)
  const custodyTxs = useDataStore((state) => state.custodyTxs)
  const employees = useDataStore((state) => state.employees)
  const allTreasuries = useDataStore((state) => state.treasuries)
  const appUsers = useDataStore((state) => state.appUsers)
  const currentUserId = useDataStore((state) => state.currentUserId)
  const currentUser = appUsers.find((user) => user.id === currentUserId)
  const allowedCodes = allowedTreasuryCodes(currentUser?.treasuryAccess, 'payment')
  const treasuries = allowedCodes == null ? allTreasuries : allTreasuries.filter((treasury) => allowedCodes.includes(treasury.code))
  const openFiles = custodyFiles.filter((file) => file.status === 'open')
  const payableOpenFiles = openFiles.filter((file) => summarizeCustody(custodyTxs.filter((tx) => tx.fileId === file.id)).remainingMinor > 0)
  const preferredTreasury = currentUser?.treasuryAccess?.defaultTreasuryCode
  const fallbackTreasury = treasuries.find((treasury) => treasury.code === preferredTreasury)?.code ?? treasuries[0]?.code
  const fallbackFile = payableOpenFiles[0]?.id ?? openFiles[0]?.id ?? null
  const { setup } = useAppStore()
  const currency = (setup.countryCode && getCountry(setup.countryCode)?.currency)
    || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }

  useEffect(() => {
    if (linked || layout === 'dependent') {
      if (value.kind === 'custody') {
        if (payableOpenFiles.some((file) => file.id === value.custodyFileId)) return
        if (payableOpenFiles[0]) {
          onChange({ ...value, custodyFileId: payableOpenFiles[0].id })
        } else if (fallbackTreasury) {
          onChange({ ...value, kind: 'treasury', treasury: fallbackTreasury, custodyFileId: null })
        }
      } else if (fallbackTreasury && !treasuries.some((treasury) => treasury.code === value.treasury)) {
        onChange({ ...value, treasury: fallbackTreasury, custodyFileId: null })
      } else if (!fallbackTreasury && payableOpenFiles[0]) {
        onChange({ ...value, kind: 'custody', custodyFileId: payableOpenFiles[0].id })
      }
      return
    }
    if (value.kind === 'treasury' && fallbackTreasury && !treasuries.some((treasury) => treasury.code === value.treasury)) {
      onChange({ ...value, treasury: fallbackTreasury, custodyFileId: null })
    }
  }, [fallbackTreasury, layout, linked, onChange, payableOpenFiles, treasuries, value])

  const selectableFiles = linked || layout === 'dependent' ? payableOpenFiles : openFiles
  if (treasuries.length === 0 && selectableFiles.length === 0) {
    return <div className="text-[11px] font-bold text-rose-500">لا يوجد مصدر دفع مسموح لهذه العملية</div>
  }

  if (linked) {
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-pay-source-picker data-pay-source-linked>
        <Field label="نوع مصدر السداد">
          <QuickSelect
            native
            aria-label="نوع مصدر السداد"
            value={value.kind}
            onChange={(event) => {
              if (event.target.value === 'custody') {
                onChange({ ...value, kind: 'custody', custodyFileId: fallbackFile })
              } else {
                onChange({
                  ...value,
                  kind: 'treasury',
                  treasury: value.kind === 'treasury' && treasuries.some((row) => row.code === value.treasury)
                    ? value.treasury
                    : (fallbackTreasury ?? treasuries[0]?.code ?? ''),
                  custodyFileId: null,
                })
              }
            }}
            className={inputCls}
          >
            <option value="treasury" disabled={treasuries.length === 0}>خزينة / بنك / محفظة</option>
            <option value="custody" disabled={payableOpenFiles.length === 0}>عهدة موظف</option>
          </QuickSelect>
        </Field>
        <Field label={value.kind === 'custody' ? 'ملف العهدة' : 'الخزينة / البنك'}>
          {value.kind === 'custody' ? (
            <QuickSelect
              native
              aria-label="ملف العهدة"
              value={value.custodyFileId ?? ''}
              onChange={(event) => onChange({ ...value, kind: 'custody', custodyFileId: Number(event.target.value) || null })}
              className={inputCls}
            >
              <option value="">— اختر ملف العهدة —</option>
              {payableOpenFiles.map((file) => {
                const employee = employees.find((row) => row.id === file.employeeId)?.nameAr ?? '—'
                const remaining = summarizeCustody(custodyTxs.filter((tx) => tx.fileId === file.id)).remainingMinor
                return <option key={file.id} value={file.id}>{file.fileNumber} — {employee} (متبقٍ {formatMinor(remaining, currency, false)} {currency.symbol})</option>
              })}
            </QuickSelect>
          ) : (
            <QuickSelect
              native
              aria-label="الخزينة أو البنك"
              value={value.treasury}
              onChange={(event) => onChange({ ...value, kind: 'treasury', treasury: event.target.value, custodyFileId: null })}
              className={inputCls}
            >
              <option value="">— اختر خزينة / بنك —</option>
              {treasuries.filter((treasury) => !treasury.parentCode).map((parent) => {
                const children = treasuries.filter((treasury) => treasury.parentCode === parent.code)
                return children.length
                  ? <option key={parent.code} value={parent.code}>{treasuryLabel(parent)} — الرئيسي</option>
                  : <option key={parent.code} value={parent.code}>{treasuryLabel(parent)}</option>
              })}
              {treasuries.filter((treasury) => treasury.parentCode).map((treasury) => (
                <option key={treasury.code} value={treasury.code}>↳ {treasuryLabel(treasury)}</option>
              ))}
            </QuickSelect>
          )}
        </Field>
      </div>
    )
  }

  if (layout === 'dependent') {
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-pay-source-dependent>
        <QuickSelect
          aria-label="نوع مصدر الدفع"
          value={value.kind}
          onChange={(event) => {
            if (event.target.value === 'custody') {
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
            onChange={(event) => onChange({ ...value, custodyFileId: Number(event.target.value) || null })}
            className={inputCls}
          >
            {payableOpenFiles.map((file) => {
              const employee = employees.find((row) => row.id === file.employeeId)?.nameAr ?? '—'
              const remaining = summarizeCustody(custodyTxs.filter((tx) => tx.fileId === file.id)).remainingMinor
              return <option key={file.id} value={file.id}>{file.fileNumber} — {employee} (متبقٍ {formatMinor(remaining, currency, false)} {currency.symbol})</option>
            })}
          </QuickSelect>
        ) : (
          <QuickSelect
            aria-label="الخزينة أو البنك للدفع"
            value={value.treasury}
            onChange={(event) => onChange({ ...value, treasury: event.target.value, custodyFileId: null })}
            className={inputCls}
          >
            {treasuries.filter((treasury) => !treasury.parentCode).map((parent) => {
              const children = treasuries.filter((treasury) => treasury.parentCode === parent.code)
              return children.length
                ? <option key={parent.code} value={parent.code}>{treasuryLabel(parent)} — الرئيسي</option>
                : <option key={parent.code} value={parent.code}>{treasuryLabel(parent)}</option>
            })}
            {treasuries.filter((treasury) => treasury.parentCode).map((treasury) => (
              <option key={treasury.code} value={treasury.code}>↳ {treasuryLabel(treasury)}</option>
            ))}
          </QuickSelect>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2" data-pay-source-picker>
      <QuickSelect
        aria-label="مصدر الدفع"
        value={value.kind === 'treasury' ? `treasury:${value.treasury}` : `custody:${value.custodyFileId ?? ''}`}
        onChange={(event) => {
          const selected = event.target.value
          if (selected.startsWith('custody:')) {
            onChange({ ...value, kind: 'custody', custodyFileId: Number(selected.slice('custody:'.length)) || openFiles[0]?.id || null })
          } else {
            onChange({ ...value, kind: 'treasury', treasury: selected.slice('treasury:'.length), custodyFileId: null })
          }
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
          {treasuries.filter((treasury) => treasury.parentCode).map((treasury) => (
            <option key={treasury.code} value={`treasury:${treasury.code}`}>↳ {treasuryLabel(treasury)}</option>
          ))}
        </optgroup>
        {openFiles.length > 0 && (
          <optgroup label="عهدة موظف">
            {openFiles.map((file) => {
              const employee = employees.find((row) => row.id === file.employeeId)?.nameAr ?? '—'
              const remaining = summarizeCustody(custodyTxs.filter((tx) => tx.fileId === file.id)).remainingMinor
              return <option key={file.id} value={`custody:${file.id}`}>{file.fileNumber} — {employee} (متبقٍ {formatMinor(remaining, currency, false)} {currency.symbol})</option>
            })}
          </optgroup>
        )}
      </QuickSelect>
    </div>
  )
}
