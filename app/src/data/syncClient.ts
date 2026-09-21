/**
 * عميل المزامنة السحابية (Supabase REST/PostgREST) — طبقة الجلب فوق نواة core/sync.ts
 * ─────────────────────────────────────────────────────────────────────────────────
 * - البيانات تُشفَّر AES-256-GCM بمفتاح مشتق من «سر المزامنة» قبل مغادرة الجهاز:
 *   السحابة لا ترى إلا شفرة — نفس السر يُدخل على كل جهاز من أجهزة المتجر.
 * - الدفع شرطي (rev=eq.baseRev): جهاز سبقك ⇒ 0 صفوف ⇒ تعارض يُحل بسحب الأحدث.
 * - كل الدوال ترمي أخطاء عربية واضحة، والفشل الشبكي لا يفسد شيئاً محلياً.
 */
import {
  buildSyncEnvelope, decideSync, interpretPushResult,
  syncChecksum, SUPABASE_STORES_TABLE, type RemoteRow, type SyncDecision,
} from '../core/sync.ts'
import { deriveKey, encryptText, decryptText, isEncrypted } from '../core/security.ts'

export interface SyncConfig {
  url: string // https://xxxx.supabase.co
  anonKey: string // مفتاح anon (Row Level Security تضبط الوصول)
  storeId: string // معرف المتجر — نفسه على كل الأجهزة
  secret: string // سر التشفير المشترك — لا يغادر الأجهزة أبداً
  accessToken: string // اعتماد RLS عشوائي — يُرسل للتفويض ولا يُستخدم للتشفير
}

export function validateSyncConfig(c: SyncConfig): string[] {
  const errors: string[] = []
  if (!/^https:\/\/[\w.-]+\.supabase\.co\/?$/.test(c.url.trim()) && !/^https:\/\/[\w.-]+(:\d+)?\/?$/.test(c.url.trim())) {
    errors.push('رابط Supabase غير صالح — مثل https://xxxx.supabase.co')
  }
  if (c.anonKey.trim().length < 20) errors.push('مفتاح anon قصير جداً — انسخه من إعدادات مشروع Supabase')
  if (!c.storeId.trim()) errors.push('معرف المتجر مطلوب — نفس المعرف على كل الأجهزة')
  if (c.secret.trim().length < 16) errors.push('سر التشفير 16 حرفاً على الأقل — نفسه على كل الأجهزة')
  if (!/^[A-Za-z0-9_-]{43}$/.test(c.accessToken.trim())) errors.push('اعتماد عزل المتجر غير صالح — ولّده من الزر وانسخه لكل الأجهزة')
  return errors
}

export function generateStoreAccessToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function accessTokenHash(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
}

const headers = (c: SyncConfig) => ({
  apikey: c.anonKey,
  Authorization: `Bearer ${c.anonKey}`,
  'Content-Type': 'application/json',
  'X-Store-Id': c.storeId,
  'X-Store-Access-Token': c.accessToken,
})

const restUrl = (c: SyncConfig) =>
  `${c.url.trim().replace(/\/$/, '')}/rest/v1/${SUPABASE_STORES_TABLE}`

interface RawRow {
  store_id: string
  rev: number
  device_id: string
  updated_at: string
  checksum: string
  data: string
  access_token_hash?: string | null
}

/** مطالبة آمنة لمرة واحدة بصف قديم أنشأته السياسة التاريخية المفتوحة. */
async function claimLegacyRow(c: SyncConfig): Promise<void> {
  const hash = await accessTokenHash(c.accessToken)
  const res = await fetch(`${restUrl(c)}?store_id=eq.${encodeURIComponent(c.storeId)}&access_token_hash=is.null`, {
    method: 'PATCH',
    headers: { ...headers(c), Prefer: 'return=representation' },
    body: JSON.stringify({ access_token_hash: hash }),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`تعذر تأمين سجل المزامنة القديم (${res.status})`)
  const rows = await res.json() as unknown[]
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('سجل المزامنة مرتبط باعتماد آخر — راجع مسؤول النظام')
}

/** قراءة صف المتجر من السحابة — null لو غير موجود بعد */
export async function fetchRemote(c: SyncConfig): Promise<RemoteRow | null> {
  const res = await fetch(`${restUrl(c)}?store_id=eq.${encodeURIComponent(c.storeId)}&select=*`, {
    headers: headers(c), signal: AbortSignal.timeout(15000),
  })
  if (res.status === 401 || res.status === 403) throw new Error('مفتاح Supabase مرفوض — راجع anon key وسياسات RLS')
  if (!res.ok) throw new Error(`السحابة ردت بخطأ ${res.status}`)
  const rows = (await res.json()) as RawRow[]
  if (!Array.isArray(rows) || rows.length === 0) return null
  const r = rows[0]
  if (!r.access_token_hash) await claimLegacyRow(c)
  return { rev: r.rev, deviceId: r.device_id, updatedAt: r.updated_at, checksum: r.checksum, data: r.data }
}

/** إنشاء صف المتجر أول مرة (rev=0 فارغ) — تجاهُل التعارض لو جهاز آخر أنشأه لتوه */
export async function ensureRemoteRow(c: SyncConfig): Promise<void> {
  const res = await fetch(restUrl(c), {
    method: 'POST',
    headers: { ...headers(c), Prefer: 'resolution=ignore-duplicates' },
    body: JSON.stringify({
      store_id: c.storeId, rev: 0, device_id: '', checksum: '', data: '',
      access_token_hash: await accessTokenHash(c.accessToken),
    }),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok && res.status !== 409) throw new Error(`تعذر إنشاء سجل المتجر (${res.status})`)
}

/**
 * دفع شرطي: UPDATE ... WHERE store_id AND rev=baseRev.
 * Prefer: return=representation يجعل PostgREST يعيد الصفوف المتأثرة — صفر = تعارض.
 */
export async function pushRemote(
  c: SyncConfig,
  deviceId: string,
  baseRev: number,
  encryptedData: string,
): Promise<SyncDecision> {
  const env = buildSyncEnvelope({ storeId: c.storeId, deviceId, baseRev, data: encryptedData })
  const res = await fetch(
    `${restUrl(c)}?store_id=eq.${encodeURIComponent(c.storeId)}&rev=eq.${baseRev}`,
    {
      method: 'PATCH',
      headers: { ...headers(c), Prefer: 'return=representation' },
      body: JSON.stringify({
        rev: env.nextRev, device_id: deviceId, updated_at: env.sentAt,
        checksum: env.checksum, data: env.data,
      }),
      signal: AbortSignal.timeout(20000),
    },
  )
  if (res.status === 401 || res.status === 403) throw new Error('مفتاح Supabase مرفوض — راجع anon key وسياسات RLS')
  if (!res.ok) throw new Error(`فشل الدفع للسحابة (${res.status})`)
  const rows = (await res.json()) as unknown[]
  return interpretPushResult(Array.isArray(rows) ? rows.length : 0, env)
}

/* ─── التشفير قبل النقل: مفتاح من سر المتجر (يشترك فيه كل الأجهزة) ─── */

const keyCache = new Map<string, Promise<CryptoKey>>()
function syncKey(secret: string): Promise<CryptoKey> {
  let p = keyCache.get(secret)
  if (!p) { p = deriveKey(`sync:${secret}`); keyCache.set(secret, p) }
  return p
}

export async function encryptForSync(plain: string, secret: string): Promise<string> {
  return encryptText(plain, await syncKey(secret))
}

export async function decryptFromSync(stored: string, secret: string): Promise<string> {
  if (!isEncrypted(stored)) throw new Error('بيانات السحابة ليست بصيغة «تَحَكَّم» المشفرة')
  try {
    return await decryptText(stored, await syncKey(secret))
  } catch {
    throw new Error('سر المزامنة لا يطابق سر الجهاز الذي دفع البيانات — وحّد السر على كل الأجهزة')
  }
}

/* ─── الدورة الكاملة: قرار ← (سحب|دفع) ← نتيجة ─── */

export interface SyncOutcome {
  action: 'pushed' | 'pulled' | 'noop'
  newRev: number
  /** حالة المتجر المسحوبة (JSON نصي مفكوك التشفير) — فقط عند action='pulled' */
  pulledData?: string
  message: string
}

/**
 * دورة مزامنة واحدة:
 * localData = حالة المتجر الحالية (JSON نصي) · lastKnownRev = آخر مراجعة طبقها الجهاز.
 * - سحابة أحدث ⇒ تُسحب وتُفك وتُعاد للتطبيق (الطبقة العليا تطبقها ثم تعيد الدفع إن لزم)
 * - محلي أحدث/مساوٍ ⇒ يُشفَّر ويُدفع شرطياً؛ تعارض ⇒ سحب الأحدث بدل الدفع الأعمى
 */
export async function syncOnce(args: {
  config: SyncConfig
  deviceId: string
  lastKnownRev: number
  localData: string
  localDirty: boolean // هل توجد تغييرات محلية لم تُدفع؟
}): Promise<SyncOutcome> {
  const { config } = args
  let remote = await fetchRemote(config)
  if (remote === null) {
    await ensureRemoteRow(config)
    remote = { rev: 0, deviceId: '', updatedAt: '', checksum: '', data: '' }
  }

  const decision = decideSync(args.lastKnownRev, remote.rev)
  if (decision.action === 'pull') {
    const plain = await pullAndValidate(remote, config.secret)
    return { action: 'pulled', newRev: remote.rev, pulledData: plain, message: `سُحبت مراجعة أحدث (${remote.rev}) من جهاز ${remote.deviceId || 'آخر'}` }
  }

  if (!args.localDirty) return { action: 'noop', newRev: remote.rev, message: 'لا تغييرات — كل الأجهزة متطابقة' }

  const encrypted = await encryptForSync(args.localData, config.secret)
  const result = await pushRemote(config, args.deviceId, remote.rev, encrypted)
  if (result.action === 'conflict') {
    // جهاز سبقنا بين القراءة والدفع — نسحب الأحدث الآن وتُعاد المحاولة بالدورة التالية
    const fresh = await fetchRemote(config)
    if (fresh && fresh.rev > args.lastKnownRev && fresh.data) {
      const plain = await pullAndValidate(fresh, config.secret)
      return { action: 'pulled', newRev: fresh.rev, pulledData: plain, message: `جهاز آخر سبقك — سُحبت مراجعته (${fresh.rev}) وتُعاد محاولتك تلقائياً` }
    }
    throw new Error('تعارض دفع متكرر — أعد المحاولة')
  }
  return { action: 'pushed', newRev: remote.rev + 1, message: `دُفعت تغييراتك (مراجعة ${remote.rev + 1}) ✅` }
}

/**
 * تحقق ثلاثي قبل تطبيق أي بيانات مسحوبة (ضد التلف — طلب المالك):
 * 1) البصمة على الشفرة تطابق  2) فك AES-GCM ينجح (سلامة مُوثَّقة تشفيرياً)
 * 3) الناتج JSON صالح — أي فشل يوقف التطبيق ولا يمس البيانات المحلية
 */
async function pullAndValidate(remote: RemoteRow, secret: string): Promise<string> {
  if (!remote.data) throw new Error('صف السحابة بلا بيانات — لن يُطبق')
  if (remote.checksum && syncChecksum(remote.data) !== remote.checksum) {
    throw new Error('بصمة بيانات السحابة لا تطابق — نقل تالف، لن تُطبق')
  }
  const plain = await decryptFromSync(remote.data, secret)
  try { JSON.parse(plain) } catch { throw new Error('بيانات السحابة ليست JSON صالحاً — لن تُطبق') }
  return plain
}
