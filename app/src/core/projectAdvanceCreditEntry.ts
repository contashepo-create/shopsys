import { assertBalanced, type JournalLine } from './ledger.ts'

/**
 * نموذج قيد معزول للمراجعة، لا يرحّل أو يحدّث المقدمات أو العملاء.
 * يجب تدقيق اختيار الكميات، التخصيص، الخزينة، الطرف، والذمم والتزامن
 * بصورة مستقلة قبل أي استخدام تشغيلي. لا ينشئ حركة ماكينة أو إشعاراً.
 */
export function planProjectAdvanceCreditEntry(args: {
  grossMinor: number
  taxMinor: number
  retentionMinor: number
  amountMinor: number
  restoredAdvanceMinor: number
  mode: 'cash' | 'customer_credit'
  treasury?: string
  treasuryCodes: ReadonlySet<string>
}): { lines: JournalLine[]; settlementMinor: number } {
  const fail = (): never => { throw new Error('قيد إعادة مقدمة المستخلص غير صالح — راجع تفاصيل الإشعار') }
  const { grossMinor, taxMinor, retentionMinor, amountMinor, restoredAdvanceMinor, mode } = args
  const values = [grossMinor, taxMinor, retentionMinor, amountMinor, restoredAdvanceMinor]
  if (values.some(value => !Number.isSafeInteger(value) || value < 0) || grossMinor <= 0 || amountMinor <= 0 || restoredAdvanceMinor > amountMinor || !Number.isSafeInteger(grossMinor + taxMinor) || !Number.isSafeInteger(amountMinor + retentionMinor) || grossMinor + taxMinor !== amountMinor + retentionMinor || (mode !== 'cash' && mode !== 'customer_credit')) return fail()
  const settlementMinor = amountMinor - restoredAdvanceMinor
  const prohibited = new Set(['4102', '2102', '1105', '2109', '1104'])
  if (mode === 'cash' && settlementMinor && (!args.treasury || prohibited.has(args.treasury) || !args.treasuryCodes.has(args.treasury))) return fail()
  const lines: JournalLine[] = [
    { accountCode: '4102', debit: grossMinor, credit: 0, note: 'عكس أعمال المستخلص' },
    ...(taxMinor ? [{ accountCode: '2102', debit: taxMinor, credit: 0, note: 'عكس ضريبة الأعمال' }] : []),
    ...(retentionMinor ? [{ accountCode: '1105', debit: 0, credit: retentionMinor, note: 'عكس محتجز الأعمال' }] : []),
    ...(restoredAdvanceMinor ? [{ accountCode: '2109', debit: 0, credit: restoredAdvanceMinor, note: 'إعادة استرداد المقدمة' }] : []),
    ...(settlementMinor ? [{ accountCode: mode === 'cash' ? args.treasury! : '1104', debit: 0, credit: settlementMinor, note: mode === 'cash' ? 'رد التسوية للخزينة' : 'تخفيض ذمة العميل' }] : []),
  ]
  assertBalanced(lines)
  return { lines, settlementMinor }
}
