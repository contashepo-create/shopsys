/**
 * حالة «الجلسة مصادَق عليها» — محصورة بعمر تبويب/نافذة المتصفح الحالية عبر
 * sessionStorage (لا localStorage): طلب المالك — إجبار تسجيل الدخول من جديد
 * في كل مرة يُفتح فيها التطبيق فعلياً (إغلاق كامل وإعادة فتح)، حتى لو لم يضغط
 * المستخدم السابق زر «تسجيل خروج» صراحة. بينما تبقى سارية أثناء التنقل
 * العادي أو تحديث الصفحة (F5) داخل نفس الجلسة — فلا يُزعَج المستخدم بدخول
 * متكرر لمجرد تحديث الصفحة.
 *
 * الفارق عن `loggedOut` في `repo.ts` (محفوظ دائماً عبر localStorage): ذاك
 * يسجّل نية خروج صريحة تبقى عبر كل الأجهزة والجلسات، وهذا علم إضافي خاص
 * بهذه النافذة/التبويب فقط يُصفَّر تلقائياً متى أُغلق المتصفح/التطبيق —
 * فبوابة الدخول في App.tsx تتطلب كليهما معاً (OR): إما خروج صريح وإما جلسة
 * جديدة لم تُصادَق عليها بعد.
 */
const SESSION_AUTH_KEY = 'tahakam-session-authenticated'

export function isSessionAuthenticated(): boolean {
  try {
    return sessionStorage.getItem(SESSION_AUTH_KEY) === '1'
  } catch {
    return false // تخزين الجلسة محظور (وضع خاص صارم) — الأحوط إجبار الدخول
  }
}

export function markSessionAuthenticated(): void {
  try {
    sessionStorage.setItem(SESSION_AUTH_KEY, '1')
  } catch {
    /* صامت — لا يعطل الدخول نفسه لو التخزين محظور */
  }
}

export function clearSessionAuthenticated(): void {
  try {
    sessionStorage.removeItem(SESSION_AUTH_KEY)
  } catch {
    /* صامت */
  }
}
