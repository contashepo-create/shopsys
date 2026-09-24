import { useEffect, useMemo } from 'react'
import { eligiblePaymentTerminals } from '../../core/paymentTerminalEligibility.ts'
import { allowedTreasuryCodes, type TreasuryOperation } from '../../core/treasuryAccess.ts'
import { treasuryLabel } from '../../core/treasury.ts'
import { useDataStore } from '../../data/repo.ts'
import { inputCls } from './ui.tsx'
import type { TerminalPaymentDraft } from './TerminalPaymentPicker.tsx'

export interface PaymentMethodDraft {
  /** credit = بيع آجل؛ غيابها يعني اختيار خزينة أو ماكينة */
  kind?: 'credit'
  treasury: string
  terminalPayment: TerminalPaymentDraft
}

/**
 * منتقي وسيلة الدفع الموحد للفواتير:
 * حساب نقدي/بنك/محفظة/فرع تابع في قائمة واحدة، أو ماكينة دفع عند التحصيل.
 * لا يخلط بين اختيار الحساب ومبلغ السداد؛ المبلغ يبقى في الحقل المجاور.
 */
export function PaymentMethodPicker({
  value,
  onChange,
  operation,
  allowTerminal = operation === 'receipt',
  allowCredit = false,
  terminalOptions,
}: {
  value: PaymentMethodDraft
  onChange: (value: PaymentMethodDraft) => void
  operation: TreasuryOperation
  allowTerminal?: boolean
  allowCredit?: boolean
  terminalOptions?: readonly { id: string; nameAr: string }[]
}) {
  const { treasuries: allTreasuries, appUsers, currentUserId, paymentTerminals } = useDataStore()
  const currentUser = appUsers.find((user) => user.id === currentUserId)
  const allowed = allowedTreasuryCodes(currentUser?.treasuryAccess, operation)
  const treasuries = useMemo(
    () => (allowed == null ? allTreasuries : allTreasuries.filter((treasury) => allowed.includes(treasury.code))),
    [allTreasuries, allowed],
  )
  const terminals = allowTerminal ? (terminalOptions ?? eligiblePaymentTerminals(paymentTerminals, currentUser, 'charge')) : []
  const selectedValue = value.kind === 'credit' ? 'credit' : value.terminalPayment.terminalId ? `terminal:${value.terminalPayment.terminalId}` : `treasury:${value.treasury}`
  const fallbackTreasury = treasuries.find((treasury) => treasury.code === value.treasury)?.code ?? treasuries[0]?.code ?? ''

  useEffect(() => {
    if (!value.terminalPayment.terminalId && fallbackTreasury && value.treasury !== fallbackTreasury) {
      onChange({ ...value, treasury: fallbackTreasury })
    }
  }, [fallbackTreasury, onChange, value])

  const selectMethod = (selected: string) => {
    if (selected === 'credit') {
      onChange({ ...value, kind: 'credit', terminalPayment: { terminalId: '', providerReference: '', cardLast4: '' } })
      return
    }
    if (selected.startsWith('terminal:')) {
      onChange({ ...value, kind: undefined, terminalPayment: { ...value.terminalPayment, terminalId: selected.slice('terminal:'.length) } })
      return
    }
    onChange({
      ...value,
      kind: undefined,
      treasury: selected.slice('treasury:'.length),
      terminalPayment: { ...value.terminalPayment, terminalId: '', providerReference: '', cardLast4: '' },
    })
  }

  if (treasuries.length === 0 && terminals.length === 0 && !allowCredit) {
    return <div className="text-[11px] font-bold text-rose-500">لا توجد وسيلة دفع مسموحة لهذه العملية</div>
  }

  return (
    <div className="space-y-2">
      <select aria-label="طريقة الدفع" value={selectedValue} onChange={(event) => selectMethod(event.target.value)} className={inputCls}>
        <option value="">اختر طريقة الدفع…</option>
        {treasuries.length > 0 && (
          <optgroup label="خزينة / بنك / محفظة">
            {treasuries.filter((treasury) => !treasury.parentCode).map((parent) => {
              const children = treasuries.filter((treasury) => treasury.parentCode === parent.code)
              return children.length ? (
                <option key={parent.code} value={`treasury:${parent.code}`}>{treasuryLabel(parent)} — الرئيسي</option>
              ) : <option key={parent.code} value={`treasury:${parent.code}`}>{treasuryLabel(parent)}</option>
            })}
            {treasuries.filter((treasury) => treasury.parentCode).map((treasury) => <option key={treasury.code} value={`treasury:${treasury.code}`}>↳ {treasuryLabel(treasury)}</option>)}
          </optgroup>
        )}
        {allowCredit && <option value="credit">📒 آجل بالكامل</option>}
        {terminals.length > 0 && (
          <optgroup label="ماكينات الدفع">
            {terminals.map((terminal) => <option key={terminal.id} value={`terminal:${terminal.id}`}>💳 {terminal.nameAr}</option>)}
          </optgroup>
        )}
      </select>
      {value.terminalPayment.terminalId && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input aria-label="مرجع ماكينة الدفع" className={inputCls} value={value.terminalPayment.providerReference} onChange={(event) => onChange({ ...value, terminalPayment: { ...value.terminalPayment, providerReference: event.target.value } })} placeholder="مرجع الماكينة *" />
          <input aria-label="آخر أربعة أرقام" className={inputCls} value={value.terminalPayment.cardLast4} onChange={(event) => onChange({ ...value, terminalPayment: { ...value.terminalPayment, cardLast4: event.target.value.replace(/\D/g, '').slice(0, 4) } })} placeholder="آخر 4 أرقام" inputMode="numeric" maxLength={4} />
        </div>
      )}
    </div>
  )
}
