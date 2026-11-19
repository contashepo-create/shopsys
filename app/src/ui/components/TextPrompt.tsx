import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Btn, Field, Modal, inputCls } from './ui.tsx'

/**
 * نافذة إدخال نص واحدة للتطبيق كله — بديل `window.prompt`.
 *
 * لماذا: التطبيق يُوزَّع كبرنامج سطح مكتب (Electron)، وElectron **لا يدعم**
 * `window.prompt` إطلاقاً (يُطلق استثناءً وقت التشغيل). فكانت شاشات:
 *   · نسبة إنجاز مهمة مشروع
 *   · سبب تقليل/حذف صنف بعد إرساله للمطبخ، وسبب إلغاء الأمر
 *   · مرجع refund من إيصال الماكينة
 * تُعطّل في النسخة المكتبية بلا رسالة. هذه النافذة تعمل في المتصفح وفي Electron،
 * وتتبع لغة التطبيق وشكله (نفس Modal/Btn) فلا تخرج نافذة نظام أجنبية.
 */
export interface TextPromptOptions {
  title: string
  label?: string
  placeholder?: string
  defaultValue?: string
  confirmLabel?: string
  /** سبب الطلب — يُعرض تحت الحقل (شفافية: المستخدم يعرف لماذا يُسأل) */
  hint?: string
  /** معرّف ثابت للاختبارات */
  testId?: string
}

interface PendingPrompt {
  opts: TextPromptOptions
  resolve: (value: string | null) => void
}

export function useTextPrompt(): {
  /** يفتح النافذة ويعيد النص المُدخل، أو null إن أُلغيت */
  ask: (opts: TextPromptOptions) => Promise<string | null>
  /** يُرسم داخل الصفحة: {promptElement} */
  promptElement: ReactNode
} {
  const [pending, setPending] = useState<PendingPrompt | null>(null)
  const [value, setValue] = useState('')
  /* المُحلِّل في ref: لا يُستدعى داخل مُحدِّث حالة (StrictMode ينفّذ المُحدِّث مرتين) */
  const resolver = useRef<((value: string | null) => void) | null>(null)

  const settle = useCallback((result: string | null) => {
    const resolve = resolver.current
    resolver.current = null
    setPending(null)
    setValue('')
    resolve?.(result)
  }, [])

  const ask = useCallback((opts: TextPromptOptions) => new Promise<string | null>((resolve) => {
    /* طلب جديد قبل إغلاق السابق: يُغلق القديم بإلغاء بدل تعليقه للأبد */
    resolver.current?.(null)
    resolver.current = resolve
    setValue(opts.defaultValue ?? '')
    setPending({ opts, resolve })
  }), [])

  const promptElement = pending ? (
    <Modal open onClose={() => settle(null)} title={pending.opts.title}>
      <div className="space-y-4" data-text-prompt={pending.opts.testId ?? 'default'}>
        <Field label={pending.opts.label ?? ''} hint={pending.opts.hint}>
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={pending.opts.placeholder ?? ''}
            className={inputCls}
            data-text-prompt-input
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); settle(value.trim() || null) }
              if (e.key === 'Escape') { e.preventDefault(); settle(null) }
            }}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Btn variant="ghost" onClick={() => settle(null)}>إلغاء</Btn>
          <Btn onClick={() => settle(value.trim() || null)} disabled={!value.trim()} data-text-prompt-confirm>
            {pending.opts.confirmLabel ?? 'حفظ'}
          </Btn>
        </div>
      </div>
    </Modal>
  ) : null

  return { ask, promptElement }
}
