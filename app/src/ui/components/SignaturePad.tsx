/**
 * لوحة توقيع رقمي بسيطة بالماوس/اللمس (سد فجوة مستقبلية — النشاط #3: موبايلات
 * وصيانة): توقيع العميل عند استلام أو تسليم الجهاز، يُحفظ كصورة (dataURL)
 * مرفقة بالتذكرة لحماية الطرفين من نزاع حول الحالة الأصلية للجهاز.
 */
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

export function SignaturePad({ onSave, onCancel }: { onSave: (dataUrl: string) => void; onCancel?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const [empty, setEmpty] = useState(true)

  const ctxOf = () => canvasRef.current?.getContext('2d') ?? null
  /** يحوّل موضع المؤشر من بكسلات CSS المعروضة إلى إحداثيات الكانڤاس الداخلية — يمنع انزياح الرسم عند تصغير العرض (مثال: عمودان جنباً إلى جنب) */
  const posOf = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY }
  }
  const start = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    drawing.current = true
    const ctx = ctxOf(); if (!ctx) return
    const { x, y } = posOf(e)
    ctx.beginPath(); ctx.moveTo(x, y)
  }
  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const ctx = ctxOf(); if (!ctx) return
    const { x, y } = posOf(e)
    ctx.lineTo(x, y); ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.stroke()
    setEmpty(false)
  }
  const end = () => { drawing.current = false }
  const clear = () => {
    const canvas = canvasRef.current; const ctx = ctxOf()
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
    setEmpty(true)
  }
  const save = () => {
    const canvas = canvasRef.current
    if (!canvas || empty) return
    onSave(canvas.toDataURL('image/png'))
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        width={420}
        height={160}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        className="w-full rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-white cursor-crosshair"
        style={{ touchAction: 'none' }}
      />
      <div className="flex justify-between items-center">
        <span className="text-[10px] text-slate-400">وقّع هنا بالماوس أو الإصبع</span>
        <div className="flex gap-2">
          {onCancel && <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-[11.5px] font-bold text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">إلغاء</button>}
          <button onClick={clear} className="px-3 py-1.5 rounded-lg text-[11.5px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500">مسح</button>
          <button onClick={save} disabled={empty} className="px-3 py-1.5 rounded-lg text-[11.5px] font-bold bg-emerald-500/10 text-emerald-600 disabled:opacity-40">💾 حفظ التوقيع</button>
        </div>
      </div>
    </div>
  )
}
