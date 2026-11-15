import { afterEach, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DEFAULT_WAREHOUSE_RECEIPT } from '../src/core/warehouseReceipt.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { PrintSettingsPage } from '../src/ui/pages/PrintSettingsPage.tsx'
import { ThermalPreview } from '../src/ui/components/ThermalPreview.tsx'
import { usePrintPreview } from '../src/ui/components/printPreviewStore.ts'

const app = useAppStore.getState()
afterEach(() => { cleanup(); usePrintPreview.getState().closePreview(); useAppStore.setState(app) })
it('معاينة إذن المستودع تستخدم بيانات وأعمدة الإذن وتتحدث بتغيير إعداداته', async () => {
 useAppStore.setState({ warehouseReceipt: { ...DEFAULT_WAREHOUSE_RECEIPT, showBarcode: false } })
 render(<MemoryRouter><PrintSettingsPage /><ThermalPreview /></MemoryRouter>)
 fireEvent.click(screen.getByRole('button', { name: 'معاينة الإذن' }))
 expect(usePrintPreview.getState().handle?.title).toContain('إذن المستودع')
 let html = usePrintPreview.getState().handle?.html ?? ''
 expect(html).toContain('صنف تجريبي أول')
 expect(html).toContain('الكمية')
 expect(html).not.toContain('السعر')
 expect(html).not.toContain('6221000000017')
 act(() => { useAppStore.getState().updateWarehouseReceipt({ showBarcode: true, paper: 'a5' }) })
 await waitFor(() => expect(usePrintPreview.getState().handle?.html).toContain('6221000000017'))
 html = usePrintPreview.getState().handle?.html ?? ''
 expect(html).toMatch(/size:\s*a5/i)
 expect(screen.queryByRole('button', { name: 'تقدير الاحتواء في صفحة A4' })).toBeNull()
})
