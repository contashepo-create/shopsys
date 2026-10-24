/**
 * هوية هذه النافذة في نظام الأقمار الحرة (قرار المالك 2026-10-22):
 * النافذة الرئيسية معرّفها 'main'، وكل قمر (قسم/مستند/منتقٍ في نافذة نظام
 * مستقلة) يولد برمز `?sat=` في عنوانه فيطالب العملية الرئيسية بواصفه مرة
 * واحدة (claim) — منه يعرف معرّفه وخصائصه وأسماء ردود نداء أمه.
 * وحدة بلا اعتماديات واجهة حتى يستعملها windowStore دون دورات استيراد.
 */
import { desktopWindowsBridge, type SatelliteDescriptor } from '../../data/desktopBridge.ts'

let cachedToken: string | null | undefined

/** رمز المطالبة من عنوان النافذة — null في النافذة الرئيسية وفي الويب */
export function getSatelliteToken(): string | null {
  if (cachedToken !== undefined) return cachedToken
  try {
    cachedToken = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('sat')
  } catch {
    cachedToken = null
  }
  return cachedToken
}

/** هل أقلع هذا المُصيّر كنافذة قمر؟ (يُعرف من العنوان قبل أي IPC) */
export function isSatelliteBoot(): boolean {
  return getSatelliteToken() !== null
}

let descriptor: SatelliteDescriptor | null = null
let claimPromise: Promise<SatelliteDescriptor | null> | null = null

/** الواصف المستلم فعلاً — null قبل اكتمال المطالبة أو في الرئيسية */
export function getSatelliteDescriptor(): SatelliteDescriptor | null {
  return descriptor
}

/** معرّف هذه النافذة عند فتح أبناء لها: معرّف القمر أو 'main' */
export function getSelfWindowId(): string {
  return descriptor?.windowId ?? 'main'
}

/** مطالبة الواصف من العملية الرئيسية — تُنفَّذ مرة واحدة وتُخزَّن نتيجتها */
export function claimSatellite(): Promise<SatelliteDescriptor | null> {
  if (claimPromise) return claimPromise
  claimPromise = (async () => {
    const token = getSatelliteToken()
    const bridge = desktopWindowsBridge()
    if (!token || !bridge) return null
    try {
      descriptor = await bridge.claim(token)
    } catch {
      descriptor = null
    }
    return descriptor
  })()
  return claimPromise
}
