import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useToast } from '../src/ui/components/ui.tsx'

beforeEach(() => { vi.useFakeTimers(); useToast.getState().clear() })
afterEach(() => { useToast.getState().clear(); vi.useRealTimers() })
it('لا يمسح مؤقت رسالة سابقة تحذيراً أحدث من فشل تأكيد الحفظ', () => {
  useToast.getState().show('رسالة سابقة')
  vi.advanceTimersByTime(2500)
  useToast.getState().show('تعذر تأكيد الحفظ', 'error')
  vi.advanceTimersByTime(100)
  expect(useToast.getState().msg).toBe('تعذر تأكيد الحفظ')
  expect(useToast.getState().kind).toBe('error')
  vi.advanceTimersByTime(2500)
  expect(useToast.getState().msg).toBeNull()
})
it('الإزالة اليدوية تلغي مؤقتها ولا تمسح رسالة لاحقة', () => {
  useToast.getState().show('قديمة')
  vi.advanceTimersByTime(2500)
  useToast.getState().clear()
  useToast.getState().show('جديدة')
  vi.advanceTimersByTime(100)
  expect(useToast.getState().msg).toBe('جديدة')
  vi.advanceTimersByTime(2500)
  expect(useToast.getState().msg).toBeNull()
})
it('رسالة أحدث يطلقها مشترك أثناء نشر رسالة لا يحذفها مؤقت الرسالة الأولى', () => {
  const unsubscribe = useToast.subscribe(state => {
    if (state.msg === 'أولى') useToast.getState().show('ثانية', 'error')
  })
  useToast.getState().show('أولى')
  unsubscribe()
  expect(useToast.getState().msg).toBe('ثانية')
  expect(useToast.getState().kind).toBe('error')
  vi.advanceTimersByTime(2600)
  expect(useToast.getState().msg).toBeNull()
})
