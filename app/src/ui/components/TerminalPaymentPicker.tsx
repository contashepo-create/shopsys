import { QuickSelect } from './KeyboardPickers.tsx'
import { eligiblePaymentTerminals } from '../../core/paymentTerminalEligibility.ts'
import { useDataStore } from '../../data/repo.ts'
import { inputCls } from './ui.tsx'

export interface TerminalPaymentDraft { terminalId: string; providerReference: string; cardLast4: string }
export function TerminalPaymentPicker({ value, onChange, allowCash = true }: { value: TerminalPaymentDraft; onChange: (value: TerminalPaymentDraft) => void; allowCash?: boolean }) {
  const { paymentTerminals, appUsers, currentUserId } = useDataStore()
  const terminals = eligiblePaymentTerminals(paymentTerminals, appUsers.find((user) => user.id === currentUserId), 'charge')
  const patch = (next: Partial<TerminalPaymentDraft>) => onChange({ ...value, ...next })
  return <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
    <QuickSelect aria-label="طريقة التحصيل" className={inputCls} value={value.terminalId} onChange={(event) => patch({ terminalId: event.target.value })}>
      {allowCash && <option value="">نقدي/بنك</option>}
      {terminals.map((terminal) => <option key={terminal.id} value={terminal.id}>💳 {terminal.nameAr}</option>)}
    </QuickSelect>
    {value.terminalId && <><input aria-label="مرجع ماكينة الدفع" className={inputCls} value={value.providerReference} onChange={(event) => patch({ providerReference: event.target.value })} placeholder="مرجع الماكينة (اختياري)"/><input aria-label="آخر أربعة أرقام" className={inputCls} value={value.cardLast4} onChange={(event) => patch({ cardLast4: event.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="آخر 4 أرقام (اختياري)" inputMode="numeric" maxLength={4}/></>}
  </div>
}
