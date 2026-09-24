import { describe, expect, it } from 'vitest'
import { nextTerminalCode, validatePaymentTerminal } from '../src/core/paymentTerminals.ts'
const terminal = { id: 't1', code: 'TERM-0001', nameAr: 'ماكينة الأهلي 1', providerName: 'الأهلي', branchId: 'b1', settlementAccountCode: '1150', terminalId: 'A100', status: 'active' as const }
describe('سجل ماكينات الدفع', () => {
 it('يقبل ماكينة مرتبطة بفرع وحساب تسوية', () => expect(validatePaymentTerminal(terminal, [], true)).toEqual([]))
 it('يقبل ماكينة بلا فرع في وضع الفرع الواحد', () => expect(validatePaymentTerminal({ ...terminal, branchId: '' })).toEqual([]))
 it('يرفض غياب الفرع عند تفعيل إدارة الفروع', () => expect(validatePaymentTerminal({ ...terminal, branchId: '' }, [], true)).toContain('فرع ماكينة الدفع مطلوب'))
 it('يولد الكود التالي مع تجاهل الأكواد الحرة', () => expect(nextTerminalCode(['TERM-0002', 'OLD'])).toBe('TERM-0003'))
 it('يرفض كوداً مكرراً', () => expect(validatePaymentTerminal({ ...terminal, id: 't2' }, [terminal])).toContain('كود ماكينة الدفع مستخدم'))
 it('يرفض رقم طرفية مكرراً لدى المزود نفسه', () => expect(validatePaymentTerminal({ ...terminal, id: 't2', code: 'TERM-0002' }, [terminal])).toContain('رقم الطرفية مكرر لدى مزود الدفع'))
})
