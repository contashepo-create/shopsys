/**
 * صندوق مرتجع الخدمة الموحّد — مطوَّر للنمط العالمي (اختيار بنود لا مبلغ حر فقط):
 * يُركب في نافذة أي مستند خدمة مُسلَّم/مرحَّل — مغسلة/صيانة/نقلات/معمل/عيادة/إيجار/مستخلص.
 * مرحلتان: ① ماذا يُرد؟ (بنود محددة من المستند أو مبلغ جزئي حر)
 *          ② كيف يُرد؟ (نقدي/بنك أو على حساب العميل) ثم تنفيذ بموافقة مشرف عند الحاجة.
 * الحساب في النواة: computeItemizedRefund يورث الخصم والضريبة نسبياً بسقف المتبقي.
 */
import { useMemo, useState } from 'react'
import { Btn, Field } from './ui.tsx'
import { TreasuryPicker } from './TreasuryPicker.tsx'
import { useSupervisorApproval } from './SupervisorPinDialog.tsx'
import { computeItemizedRefund, type RefundableServiceItem } from '../../core/serviceRefund.ts'

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
  /** تحصيل ماكينة أصلي؛ عند الرد النقدي يفرض مرجع رد المزود ويرسله للـRepository. */
  terminalOriginal?: { transactionId: string; terminalName: string }
  /**
   * بنود المستند القابلة للرد (فحوصات/بنود غسيل/خدمات/قطع) — النمط العالمي:
   * وجودها يفعّل وضع «اختر البنود»؛ غيابها يبقي المبلغ الحر فقط (مستند بلا بنود).
   */
  refundableItems?: RefundableServiceItem[]
  onSubmit: (args: {
    amountMinor: number
    mode: 'cash' | 'customer_credit'
    treasury: string
    reason: string
    approvedBy?: string
    /** مفاتيح البنود المختارة (وضع البنود) — للأنشطة التي تعيد قطعاً للمخزون */
    selectedKeys?: string[]
    /** تكلفة القطع المخزنية المختارة (الصيانة) — لإرجاعها للمخزون */
    restockCostMinor?: number
    terminalRefund?: { originalTransactionId: string; providerReference: string }
  }) => void
}) {
  const hasItems = (props.refundableItems?.length ?? 0) > 0
  const [pickMode, setPickMode] = useState<'items' | 'amount'>(hasItems ? 'items' : 'amount')
  const [selected, setSelected] = useState<string[]>([])
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState<'cash' | 'customer_credit'>('cash')
  const [treasury, setTreasury] = useState('1101')
  const [reason, setReason] = useState('')
  const [terminalRefundReference, setTerminalRefundReference] = useState('')
  const approval = useSupervisorApproval()
  const remaining = props.grandMinor - props.refundedMinor
  const creditLabel = props.creditLabel ?? 'حساب العميل'

  /** معاينة وضع البنود — نفس دالة النواة (لا حساب مزدوج) */
  const itemized = useMemo(() => {
    if (pickMode !== 'items' || !hasItems || !selected.length) return null
    try {
      return computeItemizedRefund({
        items: props.refundableItems!,
        selectedKeys: selected,
        grandMinor: props.grandMinor,
        refundedMinor: props.refundedMinor,
      })
    } catch { return null }
  }, [pickMode, hasItems, selected, props.refundableItems, props.grandMinor, props.refundedMinor])

  const effectiveAmount = pickMode === 'items' ? (itemized?.amountMinor ?? 0) : Math.round(Number(amount) * 100)

  if (remaining <= 0) {
    return (
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-3 text-[12px] text-slate-400">
        ↩️ اُستنفد كامل قيمة المستند مرتجعات — لا متبقٍ قابل للرد.
      </div>
    )
  }

  const toggle = (key: string) =>
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))

  const submit = () =>
    approval.request((approvedBy) =>
      props.onSubmit({
        amountMinor: effectiveAmount,
        mode, treasury,
        reason: reason.trim() || (itemized ? `رد بنود: ${itemized.labels.join('، ')}` : ''),
        approvedBy,
        selectedKeys: pickMode === 'items' ? selected : undefined,
        restockCostMinor: pickMode === 'items' ? itemized?.restockCostMinor : undefined,
        terminalRefund: mode === 'cash' && props.terminalOriginal ? { originalTransactionId: props.terminalOriginal.transactionId, providerReference: terminalRefundReference.trim() } : undefined,
      }),
    )

  return (
    <div className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.04] p-4 space-y-3">
      <div className="text-[13px] font-black text-amber-700 dark:text-amber-400">↩️ مرتجع خدمة</div>
      <p className="text-[11.5px] text-slate-500 leading-relaxed">
        {props.hint ?? 'الاسترداد يعكس الإيراد وحصة الضريبة بقيد تلقائي.'}{' '}
        المتبقي القابل للرد: <b className="text-amber-600">{props.fmt(remaining)} {props.currencySymbol}</b>
        {props.refundedMinor > 0 && <> (رُد سابقاً {props.fmt(props.refundedMinor)})</>}
      </p>

      {/* ① ماذا يُرد؟ بنود محددة أم مبلغ حر */}
      {hasItems && (
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setPickMode('items')} className={`p-2 rounded-xl border-2 font-bold text-[11.5px] transition-all ${pickMode === 'items' ? 'border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>
            📋 رد بنود محددة
          </button>
          <button onClick={() => setPickMode('amount')} className={`p-2 rounded-xl border-2 font-bold text-[11.5px] transition-all ${pickMode === 'amount' ? 'border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>
            💰 مبلغ جزئي حر
          </button>
        </div>
      )}

      {pickMode === 'items' && hasItems && (
        <div className="space-y-1.5">
          {props.refundableItems!.map((it) => (
            <button
              key={it.key}
              onClick={() => toggle(it.key)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl border text-[12px] transition-all ${selected.includes(it.key) ? 'border-amber-500/60 bg-amber-500/10' : 'border-slate-200 dark:border-slate-700 hover:border-amber-500/30'}`}
            >
              <span className="flex items-center gap-2">
                <span className={`w-4 h-4 rounded grid place-items-center text-[10px] border ${selected.includes(it.key) ? 'bg-amber-500 border-amber-500 text-white' : 'border-slate-300 dark:border-slate-600'}`}>
                  {selected.includes(it.key) && '✓'}
                </span>
                <b>{it.label}</b>
                {it.qty !== undefined && it.qty !== 1 && <span className="text-slate-400 text-[11px]">×{it.qty}</span>}
                {it.restockCostMinor !== undefined && it.restockCostMinor > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-bold">📦 تعود للمخزون</span>}
              </span>
              <b className="text-slate-600 dark:text-slate-300">{props.fmt(it.valueMinor)}</b>
            </button>
          ))}
          {itemized && (
            <div className="flex justify-between items-center px-3 py-2 rounded-xl bg-amber-500/10 text-[12px] font-black text-amber-700 dark:text-amber-300">
              <span>المبلغ المردود (بنسبة البنود من الإجمالي النهائي)</span>
              <span>{props.fmt(itemized.amountMinor)} {props.currencySymbol}</span>
            </div>
          )}
        </div>
      )}

      {pickMode === 'amount' && (
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="المبلغ المردود (شامل الضريبة)" className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent text-[13px]" />
      )}

      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="سبب الاسترداد…" className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent text-[13px]" />

      {/* ② كيف يُرد؟ */}
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => setMode('cash')} className={`p-2.5 rounded-xl border-2 font-bold text-[12px] transition-all ${mode === 'cash' ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>💵 رد نقدي / تحويل</button>
        <button onClick={() => setMode('customer_credit')} disabled={!props.allowCredit} className={`p-2.5 rounded-xl border-2 font-bold text-[12px] transition-all disabled:opacity-40 ${mode === 'customer_credit' ? 'border-sky-500/60 bg-sky-500/10 text-sky-700 dark:text-sky-300' : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}>
          🏦 على {creditLabel} {!props.allowCredit && '(غير متاح)'}
        </button>
      </div>
      {mode === 'cash' && (props.terminalOriginal ? <Field label={`مرجع رد الماكينة — ${props.terminalOriginal.terminalName}`}><input value={terminalRefundReference} onChange={(e) => setTerminalRefundReference(e.target.value)} className="w-full px-3 py-2 rounded-xl border bg-transparent" placeholder="مرجع refund من إيصال المزود"/></Field> : <Field label="الرد من (درج نقدي أو بنك للتحويل)"><TreasuryPicker value={treasury} onChange={setTreasury} compact /></Field>)}
      {approval.willAskPin && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">🔐 سيُطلب رقم مشرف أو المالك لاعتماد هذا المرتجع.</p>
      )}
      <div className="flex justify-end">
        <Btn onClick={submit} disabled={effectiveAmount <= 0 || (mode === 'cash' && !!props.terminalOriginal && !terminalRefundReference.trim())}>↩️ تنفيذ المرتجع</Btn>
      </div>
      {approval.dialog}
    </div>
  )
}
