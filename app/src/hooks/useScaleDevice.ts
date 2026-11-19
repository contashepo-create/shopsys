/**
 * خطاف قارئ الميزان المباشر (Web Serial — متاح في Chromium/Electron بلا حزم
 * أصلية إضافية). يفتح المنفذ، يقرأ بايتات، يكوّن الأسطر، ويفكّك الوزن عبر
 * `parseScaleFrame`. كل الأخطاء تُعرض للمستخدم ولا تُسقط الشاشة.
 *
 * الموازين التي تخرج USB-HID (تكتب كأنها لوحة مفاتيح) لا تحتاج هذا الخطاف:
 * تكفي خانة المسح في الكاشير. أما الميزان التسلسلي (RS-232/USB-Serial) فيُقرأ هنا.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { parseScaleFrame, splitScaleBuffer, webSerialAvailable } from '../core/scaleSerial.ts'
import { useScaleStore } from '../stores/scale.store.ts'

export interface ScalePortLike {
  open: (options: { baudRate: number }) => Promise<void>
  close: () => Promise<void>
  readable: { getReader: () => { read: () => Promise<{ value?: Uint8Array; done: boolean }>; cancel: () => Promise<void>; releaseLock: () => void } } | null
  getInfo?: () => { usbVendorId?: number; usbProductId?: number }
}

const BAUD_KEY = 'shopsys.scale.baudRate'
const DEFAULT_BAUD = 9600

function serialApi(): { requestPort: () => Promise<ScalePortLike>; getPorts: () => Promise<ScalePortLike[]> } | null {
  if (!webSerialAvailable()) return null
  const nav = navigator as unknown as { serial?: { requestPort: () => Promise<ScalePortLike>; getPorts: () => Promise<ScalePortLike[]> } }
  return nav.serial ?? null
}

export function useScaleDevice() {
  const { connected, portLabel, error, setConnected, setError, setReading } = useScaleStore()
  const [baudRate, setBaudRateState] = useState<number>(() => {
    const saved = typeof localStorage === 'undefined' ? null : Number(localStorage.getItem(BAUD_KEY))
    return Number.isFinite(saved) && saved && saved > 0 ? saved : DEFAULT_BAUD
  })
  const [support] = useState(() => webSerialAvailable())
  const portRef = useRef<ScalePortLike | null>(null)
  const readerRef = useRef<{ cancel: () => Promise<void>; releaseLock: () => void } | null>(null)
  const stoppedRef = useRef(false)

  const setBaudRate = useCallback((rate: number) => {
    setBaudRateState(rate)
    try { localStorage.setItem(BAUD_KEY, String(rate)) } catch { /* تخزين محظور لا يمنع القراءة */ }
  }, [])

  const disconnect = useCallback(async () => {
    stoppedRef.current = true
    try { await readerRef.current?.cancel() } catch { /* المنفذ أُغلق من الجهاز */ }
    try { readerRef.current?.releaseLock() } catch { /* لا قفل */ }
    readerRef.current = null
    try { await portRef.current?.close() } catch { /* أُغلق مسبقاً */ }
    portRef.current = null
    setConnected(false)
    setReading(null)
  }, [setConnected, setReading])

  const connect = useCallback(async () => {
    const api = serialApi()
    if (!api) { setError('هذا الجهاز لا يدعم Web Serial — استخدم ميزان USB يكتب كلوحة مفاتيح أو اطبع ملصقات الميزان'); return }
    setError(null)
    /* اتصال مزدوج (نقرة مكررة) كان يترك المنفذ الأول مفتوحاً ويُفقد قارئه —
       فيبقى محجوزاً لبرنامج آخر. نفصل الحالي أولاً ثم نفتح من جديد. */
    if (portRef.current) await disconnect()
    try {
      const port = await api.requestPort()
      await port.open({ baudRate })
      portRef.current = port
      stoppedRef.current = false
      const info = port.getInfo?.() ?? {}
      setConnected(true, info.usbVendorId != null ? `USB ${info.usbVendorId.toString(16)}:${(info.usbProductId ?? 0).toString(16)}` : 'منفذ تسلسلي')
      const reader = port.readable?.getReader()
      if (!reader) throw new Error('المنفذ لا يدعم القراءة')
      readerRef.current = reader
      const decoder = new TextDecoder()
      let buffer = ''
      // حلقة قراءة واحدة — تنتهي عند الإغلاق أو الخطأ
      void (async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read()
            if (done || stoppedRef.current) break
            if (!value) continue
            const { lines, rest } = splitScaleBuffer(buffer, decoder.decode(value, { stream: true }))
            buffer = rest
            for (const line of lines) {
              const parsed = parseScaleFrame(line)
              if (parsed && parsed.stable) setReading({ kg: parsed.kg, grams: parsed.grams, stable: true })
            }
          }
        } catch (readError) {
          if (!stoppedRef.current) setError(readError instanceof Error ? readError.message : 'انقطع اتصال الميزان')
        } finally {
          if (!stoppedRef.current) setConnected(false)
        }
      })()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذّر فتح منفذ الميزان')
      setConnected(false)
    }
  }, [baudRate, setConnected, setError, setReading, disconnect])

  // أغلق المنفذ عند مغادرة الشاشة حتى لا يبقى محجوزاً لبرنامج آخر
  useEffect(() => () => { void disconnect() }, [disconnect])

  return { support, connect, disconnect, connected, portLabel, error, baudRate, setBaudRate }
}
