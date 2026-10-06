/**
 * عدّاد الأرقام الحي (الموجة ① من خطة UX — بلا أي تغيير في تقسيم الفاتورة):
 * الرقم لا يقفز فجأة بل يعدّ حتى قيمته الجديدة في ٢٦٠ms مع نبضة خفيفة، فيلاحظ
 * المستخدم **ما الذي تغيّر** عند إضافة بند أو خصم. يحترم «تقليل الحركة».
 */
import { useEffect, useRef, useState } from 'react'

const REDUCED = () => typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/* hook داخلي للمكون (سياسة Fast Refresh: الملف يصدّر مكونات فقط) */
function useAnimatedMinor(value: number, duration = 260): number {
  const [shown, setShown] = useState(value)
  const fromRef = useRef(value)
  const rafRef = useRef(0)
  useEffect(() => {
    const from = fromRef.current
    const to = value
    if (from === to) return
    if (REDUCED() || typeof requestAnimationFrame !== 'function') {
      fromRef.current = to
      /* تزامن مشروع مع نظام خارجي (requestAnimationFrame) — جوهر العدّاد الحي */
      // oxlint-disable-next-line
      setShown(to)
      return
    }
    const started = performance.now()
    const step = (now: number) => {
      const k = Math.min(1, (now - started) / duration)
      const eased = 1 - Math.pow(1 - k, 3)
      const next = Math.round(from + (to - from) * eased)
      setShown(next)
      if (k < 1) rafRef.current = requestAnimationFrame(step)
      else fromRef.current = to
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [duration, value])
  return shown
}

/** يعرض مبلغاً بالقروش مع عدّ حي ونبضة عند التغيّر */
export function AnimatedMinor({ value, format, className }: { value: number; format: (minor: number) => string; className?: string }) {
  const shown = useAnimatedMinor(value)
  const [bump, setBump] = useState(false)
  const previous = useRef(value)
  useEffect(() => {
    if (previous.current === value) return
    previous.current = value
    setBump(true)
    const timer = setTimeout(() => setBump(false), 180)
    return () => clearTimeout(timer)
  }, [value])
  return <span className={`money-counter${bump ? ' is-bump' : ''}${className ? ` ${className}` : ''}`} data-money-counter>{format(shown)}</span>
}
