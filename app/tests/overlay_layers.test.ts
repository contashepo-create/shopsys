import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * حارس بنيوي لطلب المالك: «كل النوافذ المنبثقة تظهر كاملة فوق كل العناصر».
 * السبب الجذري القديم: الحركات (anim-*) كانت تُبقي تحويلاً بعد انتهائها فيصير
 * كل كرت متحرك حاوية لـ position:fixed داخله، فتُحبس النافذة تحت الحقول.
 * الحل: fill-mode = backwards + بوابة OverlayPortal إلى body + سلم طبقات موحد.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return walk(full)
    return full.endsWith('.tsx') || full.endsWith('.ts') || full.endsWith('.css') ? [full] : []
  })
}

const files = walk(SRC)
const read = (path: string) => readFileSync(path, 'utf-8')

describe('طبقات النوافذ المنبثقة', () => {
  it('سلم الطبقات معرّف مرة واحدة وبترتيب صاعد', () => {
    const css = read(join(SRC, 'index.css'))
    expect(css).toMatch(/\.layer-modal \{ z-index: 1000; \}/)
    expect(css).toMatch(/\.layer-picker \{ z-index: 2000; \}/)
    expect(css).toMatch(/\.layer-approval \{ z-index: 3000; \}/)
    expect(css).toMatch(/\.layer-toast \{ z-index: 4000; \}/)
  })

  it('لا حركة تُبقي تحويلاً بعد انتهائها فتحبس النوافذ داخلها', () => {
    const css = read(join(SRC, 'index.css'))
    expect(css).not.toMatch(/animation-fill-mode:\s*both/)
    expect(css).toMatch(/backwards/)
  })

  it('كل غطاء ملء الشاشة يستعمل طبقة معروفة لا z-index محلياً', () => {
    const offenders: string[] = []
    for (const file of files.filter((path) => path.endsWith('.tsx'))) {
      for (const line of read(file).split('\n')) {
        if (!line.includes('fixed inset-0')) continue
        const hasLayer = /layer-(modal|picker|approval|toast)/.test(line)
        if (!hasLayer) offenders.push(`${file.replace(SRC, '')}: ${line.trim().slice(0, 90)}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('النوافذ والمنتقيات تُركَّب على body عبر OverlayPortal', () => {
    const ui = read(join(SRC, 'ui/components/ui.tsx'))
    expect(ui).toContain('createPortal')
    expect(ui).toContain('export function OverlayPortal')
    const pickers = read(join(SRC, 'ui/components/KeyboardPickers.tsx'))
    expect(pickers).toContain('OverlayPortal')
    expect(read(join(SRC, 'ui/pages/PosPage.tsx'))).toContain('OverlayPortal')
    expect(read(join(SRC, 'ui/pages/RecipesPage.tsx'))).toContain('OverlayPortal')
    expect(read(join(SRC, 'ui/components/SupervisorPinDialog.tsx'))).toContain('layer-approval')
  })
})
