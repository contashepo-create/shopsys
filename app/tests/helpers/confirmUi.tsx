import { fireEvent, waitFor } from '@testing-library/react'
import { ConfirmHost } from '../../src/ui/components/ConfirmDialog.tsx'

/**
 * مساعد اختبارات نافذة التأكيد الداخلية (بديل `window.confirm`).
 *
 * الشاشة لا ترسم النافذة بنفسها — `<ConfirmHost/>` يُركَّب مرة واحدة في App.
 * أي اختبار يتعامل مع عملية محمية بتأكيد يرسمه بجانب الصفحة ثم يقبل/يرفض.
 */
export { ConfirmHost }

/** يقبل التأكيد المفتوح الآن (يفشل إن لم تُفتح نافذة) */
export async function acceptConfirmDialog(): Promise<void> {
  await waitFor(() => {
    if (!document.body.querySelector('[data-confirm-accept]')) throw new Error('لم تُفتح نافذة تأكيد')
  })
  fireEvent.click(document.body.querySelector('[data-confirm-accept]') as HTMLElement)
  await waitFor(() => {
    if (document.body.querySelector('[data-confirm-accept]')) throw new Error('لم تُغلق نافذة التأكيد')
  })
}

/** يرفض التأكيد المفتوح الآن (اختبار «الإلغاء لا يحذف») */
export async function cancelConfirmDialog(): Promise<void> {
  await waitFor(() => {
    if (!document.body.querySelector('[data-confirm-cancel]')) throw new Error('لم تُفتح نافذة تأكيد')
  })
  fireEvent.click(document.body.querySelector('[data-confirm-cancel]') as HTMLElement)
}
