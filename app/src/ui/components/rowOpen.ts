import type { KeyboardEvent, MouseEvent } from 'react'

/** العناصر التي لها فعل خاص بها — النقر المزدوج فوقها لا يفتح المستند */
const INTERACTIVE = 'button, a, input, select, textarea, label, [role="button"], [data-no-row-open]'

/**
 * فتح أي مستند/معاملة بالنقر المزدوج على سطره (طلب المالك:
 * «عند الضغط على أي فاتورة ضغطتين أن تفتح، أو حتى أي معاملة تمت داخل التطبيق»).
 *
 * تُستعمل بنشرها على `<tr>` في قوائم المستندات:
 *   <tr {...rowOpenProps(() => setViewing(invoice))} className="…">
 *
 * لماذا نقرة مزدوجة لا مفردة؟ لأن أسطر القوائم فيها أزرار (طباعة، عكس، حذف)
 * وخانات اختيار؛ النقرة المفردة تبقى للتحديد، والمزدوجة تفتح — كسلوك أي جدول
 * في برامج المحاسبة المكتبية. وEnter يفتح أيضاً للوحة المفاتيح.
 */
export function rowOpenProps(open: () => void, label = 'انقر مرتين (أو Enter) لفتح المستند') {
  return {
    'data-row-open': 'true',
    title: label,
    tabIndex: 0,
    onDoubleClick: (event: MouseEvent<HTMLElement>) => {
      if ((event.target as HTMLElement).closest(INTERACTIVE)) return
      event.preventDefault()
      open()
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== 'Enter') return
      if ((event.target as HTMLElement).closest(INTERACTIVE)) return
      event.preventDefault()
      open()
    },
  }
}
