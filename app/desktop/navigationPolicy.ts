/**
 * سياسة التنقل داخل نافذة التطبيق (v1.0.22 — تقوية Electron). منطق خالص بلا Electron
 * ليُختبر مباشرةً. main.ts يستعمله في حدث will-navigate.
 */

/** هل الرابط صفحة التطبيق نفسها؟ الإنتاج: ملف index.html المحلي. التطوير: أصل خادم Vite. */
export function isInAppNavigation(url: string, appIndexFileUrl: string, devOrigin: string | null): boolean {
  try {
    const target = new URL(url)
    if (devOrigin) return target.origin === devOrigin
    if (target.protocol !== 'file:') return false
    return target.pathname === new URL(appIndexFileUrl).pathname
  } catch {
    return false
  }
}

/** المخططات التي يُسمح بتمريرها إلى المتصفح/النظام خارج التطبيق — نفس قائمة setWindowOpenHandler */
export function isExternalOpenable(url: string): boolean {
  return /^(?:https?:\/\/|mailto:|tel:)/i.test(url)
}
