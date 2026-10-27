import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('دورة حياة نوافذ Electron المستقلة', () => {
  it('لا يقرأ webContents من BrowserWindow بعد حدث closed', () => {
    const source = read('../desktop/satelliteWindows.ts')
    const closedHandler = source.match(/win\.on\('closed', \(\) => \{([\s\S]*?)\n  \}\)/)?.[1]

    expect(source).toMatch(/webContentsId: number/)
    expect(source).toMatch(/webContentsId: win\.webContents\.id/)
    expect(closedHandler).toBeTruthy()
    expect(closedHandler).toContain('entry.webContentsId')
    expect(closedHandler).not.toMatch(/entry\.win\.webContents\s*\./)
  })

  it('يتجاهل موت المصيّر المتوقع أثناء الإغلاق/التحديث ولا يحاول تحميل صفحة خطأ', () => {
    const source = read('../desktop/main.ts')
    const handler = source.match(/win\.webContents\.on\('render-process-gone',[\s\S]*?\n  \}\)/)?.[0]

    expect(handler).toBeTruthy()
    expect(handler).toMatch(/if \(shuttingDown\)[\s\S]*?return/)
    expect(handler).toMatch(/showLoadError\(win/)
    expect(handler!.indexOf('if (shuttingDown)')).toBeLessThan(handler!.indexOf('showLoadError(win'))
  })

  it('يركّز النافذة المستهدفة أمام المستخدم قبل إرسال سؤال تأكيد الإغلاق', () => {
    /* حوار التأكيد يُرسم داخل وثيقة القمر — إن بقي خلف نافذة أخرى لا يراه أحد
       حتى تنتهي المهلة. الترتيب: focusEntry ثم windows:request-close. */
    const source = read('../desktop/satelliteWindows.ts')
    const handshake = source.match(/function handshakeClose\(entry: SatEntry\): Promise<boolean> \{[\s\S]*?\n\}/)?.[0]
    expect(handshake).toBeTruthy()
    const focusAt = handshake!.indexOf('focusEntry(entry)')
    const sendAt = handshake!.indexOf("send('windows:request-close'")
    expect(focusAt).toBeGreaterThan(-1)
    expect(sendAt).toBeGreaterThan(-1)
    expect(focusAt).toBeLessThan(sendAt)
  })

  it('الإغلاق يمر على أبناء القمر قبل القمر نفسه ويتوقف عند أول اعتراض', () => {
    const source = read('../desktop/satelliteWindows.ts')
    const attempt = source.match(/async function attemptClose\(entry: SatEntry\): Promise<boolean> \{[\s\S]*?\n\}/)?.[0]
    expect(attempt).toBeTruthy()
    const childrenAt = attempt!.indexOf('attemptClose(child)')
    const handshakeAt = attempt!.indexOf('handshakeClose(entry)')
    expect(childrenAt).toBeGreaterThan(-1)
    expect(handshakeAt).toBeGreaterThan(-1)
    /* الأبناء أولاً (استدعاء ذاتي لكل ابن) ثم مصافحة الأم */
    expect(childrenAt).toBeLessThan(handshakeAt)
    /* اعتراض أي ابن: يُركَّز هو وتُلغى سلسلة الإغلاق كلها */
    expect(attempt).toContain('focusEntry(child); return false')
    expect(attempt).toContain('focusEntry(entry); return false')
  })
})
