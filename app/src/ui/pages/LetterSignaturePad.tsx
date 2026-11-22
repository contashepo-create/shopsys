import { useRef, useState } from 'react'

/** رسم حر محلي؛ لا يحفظ حتى يضغط المستخدم «استخدام التوقيع». */
export function LetterSignaturePad({ onUse, onClose }: { onUse: (data: string) => void; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const pointer = useRef<number | null>(null)
  const [hasMarks, setHasMarks] = useState(false)
  const [color, setColor] = useState('#18334d')
  const [width, setWidth] = useState(3)
  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: (event.clientX - rect.left) * event.currentTarget.width / rect.width, y: (event.clientY - rect.top) * event.currentTarget.height / rect.height }
  }
  return <div className="letters-signature-pad">
    <strong>ارسم توقيعك بالماوس أو اللمس</strong>
    <canvas ref={canvas} width="800" height="240" aria-label="مساحة الرسم الحر للتوقيع" onPointerDown={event => {
      if (event.button !== 0 || pointer.current !== null) return
      const ctx = event.currentTarget.getContext('2d'); if (!ctx) return
      const p = point(event); pointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId)
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width * 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      ctx.beginPath(); ctx.arc(p.x, p.y, width, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.moveTo(p.x, p.y); setHasMarks(true); event.preventDefault()
    }} onPointerMove={event => {
      if (pointer.current !== event.pointerId) return
      const ctx = event.currentTarget.getContext('2d'); if (!ctx) return
      const p = point(event); ctx.lineTo(p.x, p.y); ctx.stroke(); event.preventDefault()
    }} onPointerUp={event => { if (pointer.current === event.pointerId) pointer.current = null }} onPointerCancel={event => { if (pointer.current === event.pointerId) pointer.current = null }} />
    <div className="letters-toolbar"><label>لون القلم<input type="color" aria-label="لون قلم التوقيع" value={color} onChange={e => setColor(e.target.value)} /></label><label>سُمك القلم<input type="range" aria-label="سمك قلم التوقيع" min="1" max="8" value={width} onChange={e => setWidth(Number(e.target.value))} /></label></div>
    <div className="letters-toolbar"><button type="button" className="letters-button" onClick={() => { const node = canvas.current; node?.getContext('2d')?.clearRect(0, 0, node.width, node.height); setHasMarks(false) }}>مسح الرسم</button><button type="button" className="letters-button primary" disabled={!hasMarks} onClick={() => { if (canvas.current && hasMarks) onUse(canvas.current.toDataURL('image/png')) }}>استخدام التوقيع</button><button type="button" className="letters-button" onClick={onClose}>إلغاء الرسم</button></div>
    <small>صورة مرئية للتوقيع وليست توقيعاً رقمياً موثقاً.</small>
  </div>
}
