/**
 * صندوق مرتجع الخدمة الموحّد (مراجعة المرتجعات على مستوى كل الأنشطة):
 * يُركب في نافذة أي مستند خدمة مُسلَّم/مرحَّل — مغسلة/صيانة/نقلات/معمل/عيادة/إيجار/مستخلص.
 * يعرض المتبقي القابل للرد، ويجمع المبلغ والسبب وطريقة الرد (نقدي/على حساب العميل)،
 * ويسلّم التنفيذ للـstore عبر onSubmit — كل الحسابات في النواة (buildServiceRefundEntry).
 */
import { useState } from 'react'
import { Btn, Field } from './ui.tsx'
import { TreasuryPicker } from './TreasuryPicker.tsx'

export function ServiceRefundBox(props: {
  /** إجمالي المستند شامل الضريبة (وعاء الاسترداد) */
  grandMinor: number
  /** المردود تراكمياً حتى الآن */
  refundedMinor: number
  /** عملة للعرض */
  currencySymbol: string
  /** تنسيق المبالغ (Minor → نص) */
  fmt: (minor: number) => string
  /** السماح بخيار «على حساب العميل» (false = عميل نقدي/غير مرتبط) */
  allowCredit: boolean
  /** تسمية خيار الحساب — «حساب العميل» أو «حساب المريض» */
  creditLabel?: string
  /** ملاحظة سياق تحت العنوان (اختياري) */
  hint?: string
  onSubmit: (args: { amountMinor: number; mode: 'cash' | 'customer_credit'; treasury: string; reason: string }) => void
}) {
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState<'cash' | 'customer_credit'>('cash')
  const [treasury, setTreasury] = useState('1101')
  const [reason, setReason] = useState('')
  const remaining = props.grandMinor - props.refundedMinor
  const creditLabel = props.creditLabel ?? 'حساب العميل'
  if (remaining <= 0) {
    return (
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-3 text-[12px] text-slate-400">
        ↩️ اُستنفد كامل قيمة المستند مرتجعات — لا متبقٍ قابل للرد.
      </div>
    )
  }
  return (
    <div className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.04] p-4 space-y-3">
      <div className="text-[13px] font-black text-amber-700 dark:text-amber-400">↩️ مرتجع خدمة</div>
      <p className="text-[11.5px] text-slate-500 leading-relaxed">
        {props.hint ?? 'الاسترداد يعكس الإيراد وحصة الضريبة بقيد تلقائي — لا مخزون يتحرك.'}{' '}
        المتبقي القابل للرد: <b className="text-amber-600">{props.fmt(remaining)} {props.currencySymbol}</b>
        {props.refundedMinor > 0 && <> (رُد سابقاً {props.fmt(props.refundedMinor)})</>}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="المبلغ المردود (شامل الضريبة)" className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent text-[13px]" />
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="سبب الاسترداد…" className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent text-[13px]" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => setMode('cash')} className={`p-2.5 rounded-xl border-2 font-bold text-[12px] transition-all ${mode === 'cash' ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>💵 رد نقدي</button>
        <button onClick={() => setMode('customer_credit')} disabled={!props.allowCredit} className={`p-2.5 rounded-xl border-2 font-bold text-[12px] transition-all disabled:opacity-40 ${mode === 'customer_credit' ? 'border-sky-500/60 bg-sky-500/10 text-sky-700 dark:text-sky-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>
          🏦 على {creditLabel} {!props.allowCredit && '(غير متاح)'}
        </button>
      </div>
      {mode === 'cash' && (
        <Field label="الرد من">
          <TreasuryPicker value={treasury} onChange={setTreasury} compact />
        </Field>
      )}
      <div className="flex justify-end">
        <Btn
          onClick={() => props.onSubmit({ amountMinor: Math.round(Number(amount) * 100), mode, treasury, reason: reason.trim() })}
          disabled={!amount || Number(amount) <= 0}
        >↩️ تنفيذ المرتجع</Btn>
      </div>
    </div>
  )
}
