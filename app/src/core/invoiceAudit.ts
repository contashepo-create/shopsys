/**
 * سطر تدقيق المستند المرحّل — «متى عُدِّلت الفاتورة ومن عدّلها ولماذا» في **سطر واحد**.
 *
 * طلب المالك (2026-09-28): الفاتورة المرحّلة تُفتح للتعديل مثل أي فاتورة، ويُكتب في
 * الشريط السفلي وقت التعديل وتاريخه ومن قام به وسببه — كلها في سطر واحد — مع إزالة
 * «الإجمالي» و«المتبقي» من ذلك الشريط (يكفي ظهورهما في لوحتي الإجماليات والتحصيل).
 *
 * وحدة حسابية صرفة (بلا DOM) حتى تُستعمل من صفحات البيع والشراء والمرتجعات معاً.
 */

export interface InvoiceEditEvent {
  at: string
  reason: string
  by?: string
}

/** تنسيق «YYYY-MM-DD HH:MM» من ISO — بلا اعتماد على منطقة زمنية للمتصفح في الاختبارات */
export function formatAuditStamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso.slice(0, 16).replace('T', ' ')
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * يبني سطر التدقيق النهائي، أو `null` لو الفاتورة لم تُعدَّل بعد (مسودة أو مرحّلة بلا تعديل).
 * الصيغة: «عُدِّلت 2026-09-28 14:35 · بواسطة أحمد · السبب: تصحيح كمية · (٣ تعديلات)».
 */
export function formatInvoiceAuditLine(
  history: InvoiceEditEvent[] | undefined,
  fallbackUser = 'المالك',
): string | null {
  if (!history || !history.length) return null
  const last = history[history.length - 1]
  const parts = [
    `عُدِّلت ${formatAuditStamp(last.at)}`,
    `بواسطة ${last.by?.trim() || fallbackUser}`,
    `السبب: ${last.reason?.trim() || 'بلا سبب مسجَّل'}`,
  ]
  if (history.length > 1) parts.push(`(${history.length} تعديلات)`)
  return parts.join(' · ')
}
