/**
 * تثبيت أي قائمة/نافذة صغيرة على حقلها بإحداثيات الشاشة.
 * ──────────────────────────────────────────────────────
 * بلاغ المالك: «جزء من النافذة المنبثقة يختفي خلف خانة أو داخل نافذة».
 * القوائم المطلقة (absolute) تُقصّ داخل أي حاوية بـoverflow (جسم المودال أو
 * جدول بسكرول)، لذلك تُرسم هنا بـposition: fixed فوق كل شيء، مع قلبها أعلى
 * الحقل تلقائياً عندما لا تكفي المساحة أسفله، وإعادة القياس عند أي تمرير أو
 * تغيير مقاس نافذة المتصفح.
 */
import { useCallback, useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'

export function useAnchoredMenu(
  anchorRef: RefObject<HTMLElement | null>,
  open: boolean,
  maxHeight = 288,
): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', top: 0, left: 0, width: 0 })
  const measure = useCallback(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const viewport = typeof window === 'undefined' ? 0 : window.innerHeight
    const below = viewport - rect.bottom - 8
    const above = rect.top - 8
    const dropUp = below < Math.min(maxHeight, 176) && above > below
    setStyle({
      position: 'fixed',
      left: rect.left,
      width: rect.width,
      maxHeight: Math.max(140, Math.min(maxHeight, dropUp ? above : below)),
      ...(dropUp ? { bottom: viewport - rect.top + 4 } : { top: rect.bottom + 4 }),
    })
  }, [anchorRef, maxHeight])
  useLayoutEffect(() => {
    if (!open) return
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open, measure])
  return style
}
