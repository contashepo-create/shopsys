/** فتح رابط مُعَدّ فقط؛ المتصفح وواتساب لا يثبتان فتح النافذة أو إرسال الرسالة. */
export function openCustomerWhatsapp(buildLink: () => string, toast: { show: (message: string, kind?: 'success' | 'error') => void }): void {
  try {
    const link = buildLink()
    window.open(link, '_blank', 'noopener')
    toast.show('محاولة فتح واتساب لا تؤكد الإرسال — راجع المحادثة وأرسل الرسالة بنفسك')
  } catch (error) {
    toast.show(error instanceof Error ? error.message : 'تعذر فتح واتساب', 'error')
  }
}
