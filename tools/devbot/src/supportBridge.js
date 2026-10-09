/**
 * عميل جسر قناة الدعم — بند 1 من تدقيق 2026-10-08.
 * ───────────────────────────────────────────────────
 * قناة الدعم (التخزين، HMAC v2، TOFU، تحديد المعدل) تعيش في عامل آخر هو
 * `cloud/worker.js`، بينما لوحة المطوّر وبوت التليجرام هنا في `tools/devbot`.
 * وبوت تليجرام واحد لا يقبل إلا ويبهوك واحداً ⇒ كان رد المطوّر (Reply على بلاغ
 * دعم) يصل للعامل الذي يملك الويبهوك فقط: إن كانت اللوحة تملكه عومل الرد أمراً
 * مجهولاً ولم يصل العميل أبداً، وإن كان عامل الدعم يملكه ماتت اللوحة كلها.
 *
 * الحل: جسر مصادَق عليه بسرّ مشترك — لا نقل تخزين، ولا تغيير في تطبيق العميل،
 * ولا بروتوكول جديد. وحدة مستقلة (لا استيراد من worker.js) كي تستخدمها اللوحة
 * والعامل معاً بلا استيراد دائري.
 *
 * الضبط (مرة واحدة، في العاملين):
 *   tools/devbot:  wrangler secret put SUPPORT_BRIDGE_URL      ← https://shopsys-control.<الحساب>.workers.dev
 *                  wrangler secret put SUPPORT_BRIDGE_SECRET   ← 32+ محرفاً عشوائياً
 *   cloud/:        wrangler secret put SUPPORT_BRIDGE_SECRET   ← القيمة نفسها
 */

/** الحد الأدنى لطول السرّ — أقصر من ذلك يُرفض قبل أي طلب شبكة */
export const BRIDGE_SECRET_MIN = 16

/**
 * نداء واحد للجسر. **لا يرمي استثناء أبداً**: كل فشل يعود كـ`{ok:false,error}`
 * برسالة عربية تُعرض للمطوّر، فلا يتوقف البوت ولا اللوحة بسبب عامل آخر.
 */
export async function supportBridge(cfg, action, payload = {}) {
  const url = String(cfg?.supportBridgeUrl ?? '').replace(/\/$/, '')
  const secret = String(cfg?.supportBridgeSecret ?? '')
  if (!url || secret.length < BRIDGE_SECRET_MIN) {
    return {
      ok: false,
      error: 'جسر الدعم غير مضبوط — نفّذ في tools/devbot:\n  wrangler secret put SUPPORT_BRIDGE_URL\n  wrangler secret put SUPPORT_BRIDGE_SECRET\nوفي cloud/:\n  wrangler secret put SUPPORT_BRIDGE_SECRET (القيمة نفسها)',
    }
  }
  try {
    const res = await fetch(`${url}/support-bridge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bridge-secret': secret },
      body: JSON.stringify({ action, ...payload }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) return { ok: false, error: data?.error ? String(data.error) : `HTTP ${res.status}` }
    return { ok: true, ...(data && typeof data === 'object' ? data : {}) }
  } catch (err) {
    return { ok: false, error: (err && err.message) || 'فشل الاتصال بعامل الدعم' }
  }
}
