import { useRef } from 'react'
import { letterBackgroundUrl } from '../../core/letterBackgrounds.ts'
import { letterFieldStyle, validLetterImage, type Letter, type LetterTextStyle } from '../../core/letters.ts'
import { LETTER_PAGE_HEIGHT, LETTER_PAGE_WIDTH, getLetterBoxes, isLetterItemVisible, letterBoxLabel, letterLayoutItems, type LetterBox } from '../../core/letterLayout.ts'

export function LetterCanvas({ letter, pageNumber, selected, onSelect, onMove }: {
  letter: Letter; pageNumber: number; selected: string
  onSelect: (key: string) => void; onMove: (key: string, box: LetterBox) => void
}) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ key: string; pointer: number; x: number; y: number; box: LetterBox; width: number; height: number } | null>(null)
  const boxes = getLetterBoxes(letter)
  const logo = /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(letter.identity.logo) && letter.identity.logo.length < 2_000_000 ? letter.identity.logo : ''
  return <div ref={sheetRef} data-letter-page={pageNumber} className={`letters-canvas template-${letter.layout?.template ?? 'classic'}`} dir="rtl" style={{ fontFamily: `${letter.font}, LetterArabic, sans-serif`, '--letter-accent': letter.accent } as React.CSSProperties}>
    {letterBackgroundUrl(letter.layout?.background) && <img className="letters-canvas-background" data-letter-background alt="" aria-hidden="true" src={letterBackgroundUrl(letter.layout?.background)} style={{ opacity: (letter.layout?.background?.opacity ?? 0) / 100 }} />}
    {letterLayoutItems(letter).filter(item => isLetterItemVisible(letter, item.key) && ((boxes[item.key].page ?? 1) === pageNumber || boxes[item.key].repeat) && (item.rule || (item.logo ? !!logo : item.image ? validLetterImage(letter[item.image] ?? '') : !!item.text))).map(item => {
      const box = boxes[item.key]
      const paragraph = item.paragraphId ? letter.paragraphs.find(p => p.id === item.paragraphId) : undefined
      const style: LetterTextStyle | undefined = paragraph ?? (item.field ? letterFieldStyle(letter, item.field) : undefined)
      if (item.fixed) return <div key={item.key} data-letter-box={item.key} className={`letters-canvas-fixed${item.rule ? ' letters-canvas-line' : ' letters-canvas-footer'}`} aria-label={letterBoxLabel(item.key, letter)}
        style={{ left: `${box.x / LETTER_PAGE_WIDTH * 100}%`, top: `${box.y / LETTER_PAGE_HEIGHT * 100}%`, width: `${box.width / LETTER_PAGE_WIDTH * 100}%` }}>{item.text}</div>
      return <div key={item.key} data-letter-box={item.key} data-letter-field={item.field} className={`letters-canvas-item${item.paragraphId ? ' letters-sheet-paragraph' : item.rule ? ' letters-canvas-line' : ''}${selected === item.key ? ' is-selected' : ''}`}
        role="button" tabIndex={0} aria-label={`تحريك ${letterBoxLabel(item.key, letter)}`}
        style={{ left: `${box.x / LETTER_PAGE_WIDTH * 100}%`, top: `${box.y / LETTER_PAGE_HEIGHT * 100}%`, width: `${box.width / LETTER_PAGE_WIDTH * 100}%`, ...(item.logo || item.image ? { height: `${(box.height ?? 22) / LETTER_PAGE_HEIGHT * 100}%` } : {}), ...((letter.layout?.contentVersion === 1 || letter.layout?.contentVersion === 2 || letter.layout?.contentVersion === 3 || letter.layout?.contentVersion === 4) && item.field && ((item.field.startsWith('header') && item.field !== 'headerRecipientName') || (item.field.startsWith('recipient') && item.field !== 'recipient') || (item.field.startsWith('identity') && item.field !== 'identityName')) ? { lineHeight: 1.2 } : {}), ...(style ? { textAlign: style.align, fontSize: `${style.size}pt`, color: style.color, fontWeight: style.bold ? 'bold' : 'normal', fontStyle: style.italic ? 'italic' : 'normal', textDecoration: style.underline ? 'underline' : 'none', fontFamily: `${style.font ?? letter.font}, LetterArabic, sans-serif` } : {}) }}
        onPointerDown={event => { if (event.button !== 0 || !sheetRef.current) return; onSelect(item.key); const rect = sheetRef.current.getBoundingClientRect(); if (!rect.width || !rect.height) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { key: item.key, pointer: event.pointerId, x: event.clientX, y: event.clientY, box, width: rect.width, height: rect.height }; event.preventDefault() }}
        onPointerMove={event => { const d = drag.current; if (!d || d.pointer !== event.pointerId) return; const x = Math.max(0, Math.min(LETTER_PAGE_WIDTH - d.box.width, d.box.x + (event.clientX - d.x) * LETTER_PAGE_WIDTH / d.width)); const y = Math.max(0, Math.min(LETTER_PAGE_HEIGHT - (d.box.height ?? 1), d.box.y + (event.clientY - d.y) * LETTER_PAGE_HEIGHT / d.height)); onMove(d.key, { ...d.box, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }) }}
        onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} onClick={() => onSelect(item.key)}
        onKeyDown={event => { const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }; const delta = directions[event.key]; if (!delta) return; event.preventDefault(); onSelect(item.key); onMove(item.key, { ...box, x: Math.max(0, Math.min(LETTER_PAGE_WIDTH - box.width, box.x + delta[0])), y: Math.max(0, Math.min(LETTER_PAGE_HEIGHT - (box.height ?? 1), box.y + delta[1])) }) }}>
        {item.rule ? null : item.logo ? <img src={logo} alt="شعار المنشأة" /> : item.image ? <img src={letter[item.image]} alt={letterBoxLabel(item.key, letter)} /> : item.text || '\u00a0'}
      </div>
    })}
  </div>
}
