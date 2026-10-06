/**
 * جولة v1.0.9 — درع البيانات: بطاقة استعادة نسخة قاعدة ملفية.
 * سيناريو العميل: تلف القاعدة أو ويندوز جديد — يفتح «النسخ الاحتياطي»،
 * يعرض النسخ من المكانين، يؤكد الاستعادة صراحة، فيستبدل التطبيق القاعدة ويعيد تشغيله.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import React from 'react'
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

let restoredPaths: string[] = []
const listFileBackups = vi.fn(async () => [
  { path: 'D:/Tahakom/backups/manual/manual-2026-10-05T09-00-00.db', where: 'بجوار القاعدة', kind: 'يدوية', size: 40960, at: '2026-10-05T09:00:00.000Z' },
  { path: 'C:/Users/x/Documents/Tahakom-Backups/auto/auto-2026-10-04T10-00-00.db', where: 'المكان الثاني', kind: 'تلقائية', size: 38912, at: '2026-10-04T10:00:00.000Z' },
])

const desktopStub = {
    runtime: 'electron',
    databaseStorage: {
      getStorageInfo: async () => ({ dbPath: 'D:/Tahakom/shopsys.db', defaultDbPath: 'C:/default/shopsys.db', isCustom: true, secondaryBackupDir: 'C:/Users/x/Documents/Tahakom-Backups', secondaryIsDefault: true, lastFileBackupAt: '2026-10-04T22:00:00.000Z' }),
      chooseDbLocation: async () => ({ ok: false, canceled: true }),
      chooseSecondaryBackupDir: async () => ({ ok: false, canceled: true }),
      recoveryNotice: async () => null,
      listFileBackups,
      restoreFileBackup: async (path: string) => { restoredPaths.push(path); return { ok: true, restarting: true } },
    },
}
// الجسر على window الحقيقي (لا نستبدل window كله فنكسر jsdom)
;(window as unknown as { shopsysDesktop?: unknown }).shopsysDesktop = desktopStub

const { BackupPage } = await import('../src/ui/pages/BackupPage.tsx')

beforeEach(() => { restoredPaths = []; listFileBackups.mockClear(); cleanup() })

describe('درع البيانات — استعادة نسخة قاعدة ملفية (v1.0.9)', () => {
  it('يعرض النسخ من المكانين ثم يستعيد بالتأكيد الصريح فقط', async () => {
    render(<BackupPage />)
    // البطاقة ظاهرة في سطح المكتب وتشرح أنها تستبدل كل شيء
    expect(screen.getByText('استعادة نسخة قاعدة كاملة (من النسخ الملفية)')).toBeTruthy()
    expect(screen.getByText(/تستبدل بياناتك الحالية بالكامل/)).toBeTruthy()
    fireEvent.click(screen.getByText('عرض النسخ المتاحة'))
    await waitFor(() => expect(screen.getByText('2026-10-05 09:00')).toBeTruthy())
    // الترتيب: الأحدث أولاً + بيانات كل نسخة (يدوية/تلقائية + المكان)
    expect(screen.getAllByText(/تلقائية/).length).toBeGreaterThan(0)
    expect(screen.getByText(/المكان الثاني/)).toBeTruthy()
    // تأكيد على مرحلتين: زر استعادة لا يستدعي شيئاً حتى الضغط على «متأكد»
    fireEvent.click(screen.getAllByText('استعادة')[0])
    expect(restoredPaths).toEqual([])
    const confirmBtn = screen.getByText('متأكد — استبدل بياناتي الحالية')
    fireEvent.click(confirmBtn)
    await waitFor(() => expect(restoredPaths).toEqual(['D:/Tahakom/backups/manual/manual-2026-10-05T09-00-00.db']))
  })

  it('لا نسخ؟ رسالة إرشادية بدل قائمة فارغة', async () => {
    listFileBackups.mockResolvedValueOnce([])
    render(<BackupPage />)
    fireEvent.click(screen.getByText('عرض النسخ المتاحة'))
    await waitFor(() => expect(screen.getByText(/لا توجد نسخ ملفية بعد/)).toBeTruthy())
  })
})
