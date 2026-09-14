/**
 * ShopSys Control — Cloudflare Worker (القرار 28)
 * ────────────────────────────────────────────────
 * لوحة تحكم المطوّر السحابية: صفحة «حول»، قائمة حرق المفاتيح، حالة الاشتراكات.
 * النشر: wrangler deploy — ثم اربط KV باسم SHOPSYS_KV.
 *
 * مفاتيح KV التي يديرها المطوّر (من لوحة Cloudflare أو من بوت التليجرام):
 *   about                 → JSON: {title, body, supportPhone, supportTelegram, website, updatedAt}
 *   revoked               → JSON: ["deadbeef", …] بصمات المفاتيح المحروقة
 *   sub:<deviceId>        → JSON: {plan, expiresAt, message}
 *
 * ملاحظة أمان: هذه النقاط للعرض فقط — الحجية القانونية دائماً للمفتاح
 * الموقّع Ed25519 الذي يتحقق منه التطبيق محلياً بلا إنترنت.
 */

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'cache-control': 'no-store',
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const path = url.pathname.replace(/\/$/, '')

    if (request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'GET only' }), { status: 405, headers: JSON_HEADERS })
    }

    // GET /about — محتوى صفحة «حول» يتحكم فيه المطوّر
    if (path === '/about') {
      const raw = await env.SHOPSYS_KV.get('about')
      return new Response(raw ?? JSON.stringify({
        title: 'نظام المحاسبة والكاشير',
        body: 'نظام عربي متكامل — تواصل مع المطوّر للتفعيل والدعم.',
        supportPhone: '', supportTelegram: '', website: '',
        updatedAt: new Date().toISOString(),
      }), { headers: JSON_HEADERS })
    }

    // GET /revoked — بصمات المفاتيح المحروقة (حرق نهائي، لا يعاد الاستخدام)
    if (path === '/revoked') {
      const raw = await env.SHOPSYS_KV.get('revoked')
      return new Response(raw ?? '[]', { headers: JSON_HEADERS })
    }

    // GET /subscription/:deviceId — حالة اشتراك للعرض في التطبيق
    const m = path.match(/^\/subscription\/([A-Z0-9-]+)$/i)
    if (m) {
      const raw = await env.SHOPSYS_KV.get(`sub:${m[1]}`)
      if (!raw) return new Response(JSON.stringify(null), { headers: JSON_HEADERS })
      return new Response(raw, { headers: JSON_HEADERS })
    }

    return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: JSON_HEADERS })
  },
}
