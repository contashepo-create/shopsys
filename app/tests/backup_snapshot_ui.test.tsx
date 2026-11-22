import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BackupPage } from '../src/ui/pages/BackupPage.tsx'
import * as persistence from '../src/data/persistentStorage.ts'
import * as secure from '../src/data/secureStorage.ts'
import { useToast } from '../src/ui/components/ui.tsx'

const appRaw = JSON.stringify({ state: { fiscalYears: [] } })
const dataRaw = JSON.stringify({ state: { journal: [], treasuries: [] } })
function storage(app: string | null, data: string | null) {
  const settingsGet = vi.fn(async () => app), dataGet = vi.fn(async () => data)
  vi.spyOn(persistence, 'settingsAppStorage').mockReturnValue({ getItem: settingsGet, setItem: vi.fn(), removeItem: vi.fn() })
  vi.spyOn(persistence, 'appStorage').mockReturnValue({ getItem: dataGet, setItem: vi.fn(), removeItem: vi.fn() })
  return { settingsGet, dataGet }
}
beforeEach(() => { vi.spyOn(secure, 'flushSecureStorageWrites').mockResolvedValue(undefined); vi.spyOn(secure, 'isStorageSealed').mockReturnValue(false) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); useToast.getState().clear() })

it('يسمي فحص الصيغة باسمه ويبيّن أنه لا يختبر الاستعادة', async () => {
  const { settingsGet, dataGet } = storage(appRaw, dataRaw)
  render(<BackupPage />)
  fireEvent.click(screen.getByText('فحص صيغة النسخة وبصمتها'))
  await waitFor(() => expect(useToast.getState().msg).toContain('لم تُختبر الاستعادة'))
  expect(screen.getByText(/آخر فحص صيغة وبصمة/)).toBeTruthy()
  expect(settingsGet).toHaveBeenCalledTimes(2); expect(dataGet).toHaveBeenCalledTimes(2)
})
it('عند غياب الإعدادات يحذر أن النسخة غير مكتملة ولا يسجل فحصاً ناجحاً', async () => {
  storage(null, dataRaw); render(<BackupPage />)
  fireEvent.click(screen.getByText('فحص صيغة النسخة وبصمتها'))
  await waitFor(() => expect(useToast.getState().msg).toContain('النسخة غير كاملة'))
  expect(useToast.getState().kind).toBe('error'); expect(screen.queryByText(/آخر فحص صيغة وبصمة/)).toBeNull()
})
it('لا ينزّل نسخة حين تتغير القراءة المخزنة بين المرتين', async () => {
  const { dataGet } = storage(appRaw, dataRaw)
  dataGet.mockResolvedValueOnce(dataRaw).mockResolvedValueOnce('{"state":{"journal":[1]}}')
  const createObjectURL = vi.fn(() => 'blob:test')
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() })
  render(<BackupPage />); fireEvent.click(screen.getByText('تنزيل نسخة احتياطية الآن'))
  await waitFor(() => expect(useToast.getState().msg).toContain('تغير التخزين أثناء أخذ النسخة'))
  expect(createObjectURL).not.toHaveBeenCalled()
})
it('يمنع تصدير نسخة عند فشل تصريف كتابة سابقة', async () => {
  const { settingsGet } = storage(appRaw, dataRaw)
  vi.mocked(secure.flushSecureStorageWrites).mockRejectedValueOnce(new Error('save failed'))
  render(<BackupPage />); fireEvent.click(screen.getByText('تنزيل نسخة احتياطية الآن'))
  await waitFor(() => expect(useToast.getState().msg).toContain('save failed'))
  expect(settingsGet).not.toHaveBeenCalled()
})
it('يتيح تنزيل نسخة إنقاذ دون إعدادات لكنه يحذر بأنها غير مكتملة', async () => {
  storage(null, dataRaw)
  const createObjectURL = vi.fn(() => 'blob:test')
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  render(<BackupPage />); fireEvent.click(screen.getByText('تنزيل نسخة احتياطية الآن'))
  await waitFor(() => expect(useToast.getState().msg).toContain('بلا إعدادات'))
  expect(useToast.getState().kind).toBe('error'); expect(createObjectURL).toHaveBeenCalledOnce()
})
