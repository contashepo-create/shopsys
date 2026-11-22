import { useEffect, useState } from 'react'
import { Btn, Modal } from './ui.tsx'
import { getPendingConfirm, settleConfirm, subscribeConfirm, type PendingConfirm } from './confirmStore.ts'

/**
 * نافذة التأكيد الداخلية — بديل `window.confirm` في التطبيق كله.
 * الوحدة تُركَّب مرة واحدة في App، وتُفتح من أي معالج عبر `confirmDialog()`
 * (من `confirmStore.ts`) بلا تمرير props عبر الصفحات.
 */
export function ConfirmHost() {
  const [state, setState] = useState<PendingConfirm | null>(getPendingConfirm)

  useEffect(() => subscribeConfirm((value) => setState(value)), [])

  if (!state) return null
  const settle = (ok: boolean) => settleConfirm(state.key, ok)
  return (
    <Modal open onClose={() => settle(false)} title={state.opts.title}>
      <div className="space-y-4" data-confirm-dialog={state.opts.testId ?? 'default'}>
        <p className="text-sm leading-6 text-slate-700 dark:text-slate-200 whitespace-pre-line">{state.opts.message}</p>
        <div className="flex justify-end gap-2">
          <Btn variant="ghost" onClick={() => settle(false)} data-confirm-cancel>
            {state.opts.cancelLabel ?? 'إلغاء'}
          </Btn>
          <Btn variant={state.opts.danger ? 'danger' : 'primary'} onClick={() => settle(true)} data-confirm-accept>
            {state.opts.confirmLabel ?? 'متابعة'}
          </Btn>
        </div>
      </div>
    </Modal>
  )
}
