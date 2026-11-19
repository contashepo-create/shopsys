/**
 * حالة «قارئ الميزان المباشر» — ذاكرة تشغيل فقط (لا تُحفظ في القاعدة):
 * الوزن القادم من جهاز متصل بجهاز الكاشير يصلح لثوانٍ ثم يصبح قديماً،
 * فحفظه في الإعدادات كان سيعرض وزناً وهمياً بعد إعادة التشغيل.
 * الإعدادات (المنفذ/السرعة/التفعيل) تُحفظ في localStorage داخل الخطاف.
 */
import { create } from 'zustand'

export interface LiveScaleReading {
  kg: number
  grams: number
  stable: boolean
  at: number
}

interface ScaleDeviceState {
  /** آخر قراءة وزن صالحة — null قبل أول قراءة أو بعد القطع */
  reading: LiveScaleReading | null
  connected: boolean
  portLabel: string | null
  error: string | null
  setReading: (reading: Omit<LiveScaleReading, 'at'> | null) => void
  setConnected: (connected: boolean, portLabel?: string | null) => void
  setError: (error: string | null) => void
}

export const useScaleStore = create<ScaleDeviceState>((set) => ({
  reading: null,
  connected: false,
  portLabel: null,
  error: null,
  setReading: (reading) => set({ reading: reading ? { ...reading, at: Date.now() } : null }),
  setConnected: (connected, portLabel = null) => set({ connected, portLabel, ...(connected ? {} : { reading: null }) }),
  setError: (error) => set({ error }),
}))

/** صلاحية القراءة: 15 ثانية كافية لاختيار السطر والضغط (كي لا تُطبَّق قراءة قديمة) */
export const SCALE_READING_TTL_MS = 15_000
export function isReadingFresh(reading: LiveScaleReading | null, now = Date.now()): boolean {
  return Boolean(reading && now - reading.at <= SCALE_READING_TTL_MS)
}
