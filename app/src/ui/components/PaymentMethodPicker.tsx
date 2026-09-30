import { QuickSelect } from './KeyboardPickers.tsx'
import { useEffect } from 'react'
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
/** بلاغ المالك: عند اختيار «نقدي» لا تظهر البنوك ولا الماكينات داخل القائمة —
 *  يُمرَّر `restrictTo` فتُعرض وسائل ذلك النوع فقط. */
export function PaymentMethodPicker({
  value,
  onChange,
  operation,
  allowTerminal = operation === 'receipt',
  allowCredit = false,
  terminalOptions,
  tiles = false, restrictTo }: {
  value: PaymentMethodDraft
  onChange: (value: PaymentMethodDraft) => void
  operation: TreasuryOperation
  allowTerminal?: boolean
  allowCredit?: boolean
  terminalOptions?: readonly { id: string; nameAr: string }[]
  /** بلاطات «نقدي · تحويل بنكي · ماكينة» فوق القائمة (شكل الفاتورة المرجعي) */
  tiles?: boolean
  /** فلترة الوسائل حسب نوع الطريقة (بلاغ المالك) */
  restrictTo?: 'cash' | 'bank' | 'terminal' | null
}) {
  const { treasuries: allTreasuries, appUsers, currentUserId, paymentTerminals } = useDataStore()
  const currentUser = appUsers.find((user) => user.id === currentUserId)
  const allowed = allowedTreasuryCodes(currentUser?.treasuryAccess, operation)
  const permitted = allowed == null ? allTreasuries : allTreasuries.filter((treasury) => allowed.includes(treasury.code))
  /* الفلترة حسب نوع الطريقة: نقدي ⇒ خزائن نقدية فقط · بنكي ⇒ بنوك فقط · ماكينة ⇒ لا خزائن */
  const treasuries = restrictTo === 'terminal' ? []
    : restrictTo === 'cash' ? permitted.filter((treasury) => treasury.kind === 'cash')
    : restrictTo === 'bank' ? permitted.filter((treasury) => treasury.kind === 'bank')
    : permitted
  const allTerminals = allowTerminal ? (terminalOptions ?? eligiblePaymentTerminals(paymentTerminals, currentUser, 'charge')) : []
  const terminals = restrictTo && restrictTo !== 'terminal' ? [] : allTerminals
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

  const firstCash = treasuries.find((treasury) => treasury.kind === 'cash')
  const firstBank = treasuries.find((treasury) => treasury.kind === 'bank')
  const firstTerminal = terminals[0]
  const activeTreasury = treasuries.find((treasury) => treasury.code === value.treasury)
  const tileMode: 'cash' | 'bank' | 'terminal' | null = value.kind === 'credit' ? null
    : value.terminalPayment.terminalId ? 'terminal'
    : activeTreasury?.kind === 'bank' ? 'bank'
    : activeTreasury ? 'cash' : null

  return (
    <div className="space-y-2">
      {tiles && (
        <div className="invoice-doc-tiles" role="group" aria-label="طريقة الدفع السريعة">
          <button type="button" aria-pressed={tileMode === 'cash'} disabled={!firstCash} onClick={() => firstCash && selectMethod(`treasury:${firstCash.code}`)}>نقدي</button>
          <button type="button" aria-pressed={tileMode === 'bank'} disabled={!firstBank} onClick={() => firstBank && selectMethod(`treasury:${firstBank.code}`)}>تحويل بنكي</button>
          <button type="button" aria-pressed={tileMode === 'terminal'} disabled={!firstTerminal} onClick={() => firstTerminal && selectMethod(`terminal:${firstTerminal.id}`)}>ماكينة دفع</button>
        </div>
      )}
      <QuickSelect aria-label="طريقة الدفع" value={selectedValue} onChange={(event) => selectMethod(event.target.value)} className={inputCls}>
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
      </QuickSelect>
      {value.terminalPayment.terminalId && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input aria-label="مرجع ماكينة الدفع" className={inputCls} value={value.terminalPayment.providerReference} onChange={(event) => onChange({ ...value, terminalPayment: { ...value.terminalPayment, providerReference: event.target.value } })} placeholder="مرجع الماكينة (اختياري)" />
          <input aria-label="آخر أربعة أرقام" className={inputCls} value={value.terminalPayment.cardLast4} onChange={(event) => onChange({ ...value, terminalPayment: { ...value.terminalPayment, cardLast4: event.target.value.replace(/\D/g, '').slice(0, 4) } })} placeholder="آخر 4 أرقام (اختياري)" inputMode="numeric" maxLength={4} />
        </div>
      )}
    </div>
  )
}
