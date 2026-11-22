import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BackupPage } from '../src/ui/pages/BackupPage.tsx'
import { useRawDataStore } from '../src/data/repo.ts'
import { flushSecureStorageWrites } from '../src/data/secureStorage.ts'
import { buildBackup } from '../src/core/backup.ts'
import { useToast } from '../src/ui/components/ui.tsx'

const initial = useRawDataStore.getState()
afterEach(() => { cleanup(); vi.restoreAllMocks(); useRawDataStore.setState(initial); useToast.getState().clear() })

it('يحجب استعادة نسخة JSON أقدم قبل كتابة الإعدادات أو البيانات إذا أسقطت سجل مشروع محذوف', async () => {
  const deletion = { id: 7, code: 'PRJ-7', nameAr: 'مشروع', reason: 'إلغاء', at: '2026-01-01', by: 'المالك' }
  useRawDataStore.setState({ projectDeletionRecords: [deletion], projects: [] })
  await flushSecureStorageWrites('shopsys-data')
  const current = localStorage.getItem('shopsys-data')
  const settings = localStorage.getItem('shopsys-app')
  const backup = buildBackup({ appState: { state: { fiscalYears: [] } }, storeState: { state: { journal: [], treasuries: [], projects: [{ id: 7 }] } }, appDataVersion: 1, shopName: 'اختبار' })
  const spy = vi.spyOn(Storage.prototype, 'setItem')
  const view = render(<BackupPage />)
  const input = view.container.querySelector('input[type="file"]')!
  fireEvent.change(input, { target: { files: [new File([JSON.stringify(backup)], 'backup.json', { type: 'application/json' })] } })
  await screen.findByText('نسخة سليمة — البصمة مطابقة')
  fireEvent.change(screen.getByPlaceholderText('اكتب هنا…'), { target: { value: 'استبدال' } })
  fireEvent.click(screen.getByText('استعادة الآن'))
  await waitFor(() => expect(useToast.getState().msg).toContain('سجل حذف المشروع'))
  expect(useToast.getState().kind).toBe('error')
  expect(useRawDataStore.getState().projectDeletionRecords).toEqual([deletion])
  expect(localStorage.getItem('shopsys-data')).toBe(current)
  expect(localStorage.getItem('shopsys-app')).toBe(settings)
  expect(spy.mock.calls.filter(([name]) => name === 'shopsys-data' || name === 'shopsys-app')).toEqual([])
})
