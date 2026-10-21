/**
 * حالة «الجلسة مصادَق عليها» — محصورة بعمر النافذة الحالية (طلب المالك:
 * إجبار تسجيل الدخول من جديد في كل مرة يُفتح فيها التطبيق فعلياً، حتى لو لم
 * يسجّل المستخدم خروجاً صريحاً). تبقى سارية أثناء التنقل أو تحديث الصفحة (F5)
 * داخل نفس الجلسة.
 *
 * الفارق عن loggedOut في repo.ts: ذاك يسجّل نية خروج صريحة تبقى عبر
 * كل الجلسات، وهذا علم خاص بهذه النافذة فقط. بوابة الدخول في App.tsx
 * تتطلب كليهما معاً (OR): إما خروج صريح وإما جلسة جديدة لم تُصادَق عليها.
 *
 * إصلاح بلاغ المالك (2026-10-21) — «يكتب دخول موفق ولا يسجّل دخول»:
 * في تطبيق سطح المكتب (Electron) الصفحة تُحمَّل من file:// وChromium يرفض
 * sessionStorage هناك (SecurityError: Access is denied for this document —
 * issue electron/electron#18470) بينما localStorage يعمل. الكتابة الصامتة
 * كانت تفشل، فتبقى isSessionAuthenticated() false إلى الأبد: المستخدم يدخل
 * الرقم الصحيح، فيظهر «دخول موفق ✅»، وتبقى شاشة الدخول — ويُطلب منه
 * الرقم السري مرة أخرى، في حلقة لا تنتهي.
 *
 * الحل: العلم في الذاكرة (متجر zustand) هو المعتمد للجلسة الحالية.
 * بعد نجاح التحقق من الرقم السري تفتح البوابة فوراً بلا اعتماد على
 * sessionStorage. تبقى sessionStorage آلية best-effort لنقل العلم عبر
 * F5 داخل نفس الجلسة — متى كان متاحاً. عند إغلاق التطبيق وإعادة فتحه
 * (نافذة جديدة = وحدة برمجية جديدة) يبدأ العلم من sessionStorage فارغة،
 * فيُفرض الدخول من جديد — طلب المالك.
 */
import { create } from 'zustand'

const SESSION_AUTH_KEY = 'tahakam-session-authenticated'

/** قراءة العلم من sessionStorage — في حال SecurityError ⇒ false (الأحوط إجبار الدخول) */
function readSessionFlag(): boolean {
  try {
    return sessionStorage.getItem(SESSION_AUTH_KEY) === '1'
  } catch {
    return false // تخزين الجلسة محظور (وضع صارم — مثل سطح المكتب file://) — الأحوط إجبار الدخول
  }
}

/** متجر React لحالة الجلسة — تعيد بوابة الدخول في App.tsx التصيير فوراً عند تغيّر العلم */
export const useSessionAuthStore = create<{ authenticated: boolean }>(() => ({ authenticated: readSessionFlag() }))

export function isSessionAuthenticated(): boolean {
  return useSessionAuthStore.getState().authenticated
}

export function markSessionAuthenticated(): void {
  try {
    sessionStorage.setItem(SESSION_AUTH_KEY, '1')
  } catch {
    /* صامت — لا يعطل الدخول نفسه لو التخزين محظور */
  }
  /* العلم في الذاكرة هو المعتمد للجلسة الحالية: المستخدم أثبت رقمه السري
   * للتو — يجب أن تفتح البوابة حتى لو فشلت الكتابة في sessionStorage
   * (تخزين محظور — مثل تطبيق سطح المكتب على file://). */
  useSessionAuthStore.setState({ authenticated: true })
}

export function clearSessionAuthenticated(): void {
  try {
    sessionStorage.removeItem(SESSION_AUTH_KEY)
  } catch {
    /* صامت */
  }
  useSessionAuthStore.setState({ authenticated: false })
}
