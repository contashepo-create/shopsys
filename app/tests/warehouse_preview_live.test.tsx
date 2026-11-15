import { afterEach, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { useLiveWarehouseReceipt } from '../src/ui/print/previewWarehouseReceipt.ts'
import { usePrintPreview } from '../src/ui/components/printPreviewStore.ts'
import { useAppStore } from '../src/stores/app.store.ts'

function Editor({ label }: { label: string }) {
 const [name, setName] = useState(label)
 const [qty, setQty] = useState(1)
 const open = useLiveWarehouseReceipt(() => ({ title: 'إذن', docNumber: 'مسودة', dateLabel: '2026-11-05', partyLabel: name, branchLabel: 'الفرع', companyName: 'المنشأة', userLabel: 'المستخدم', lines: [{ nameAr: name, qty, unit: 'قطعة' }] }))
 return <div><input aria-label={`${label} اسم`} value={name} onChange={e => setName(e.target.value)} /><input aria-label={`${label} كمية`} type="number" value={qty} onChange={e => setQty(Number(e.target.value))} /><button onClick={open}>{label} معاينة</button></div>
}
afterEach(() => { cleanup(); usePrintPreview.getState().closePreview() })
it('يحدث بيانات وإعدادات الإذن ويمنع محرراً آخر من الكتابة على المعاينة', () => {
 const original = useAppStore.getState().warehouseReceipt
 render(<><Editor label="أول" /><Editor label="ثان" /></>)
 fireEvent.click(screen.getByText('أول معاينة'))
 expect(usePrintPreview.getState().handle?.html).toContain('أول')
 fireEvent.change(screen.getByLabelText('أول اسم'), { target: { value: 'تحديث الصنف والجهة' } })
 fireEvent.change(screen.getByLabelText('أول كمية'), { target: { value: '42' } })
 expect(usePrintPreview.getState().handle?.html).toContain('تحديث الصنف والجهة')
 expect(usePrintPreview.getState().handle?.html).toContain('42')
 fireEvent.click(screen.getByText('ثان معاينة'))
 fireEvent.change(screen.getByLabelText('أول اسم'), { target: { value: 'لا يستبدل الآخر' } })
 expect(usePrintPreview.getState().handle?.html).toContain('ثان')
 expect(usePrintPreview.getState().handle?.html).not.toContain('لا يستبدل الآخر')
 act(() => { useAppStore.setState({ warehouseReceipt: { ...original, copies: 3 } }); usePrintPreview.getState().refresh() })
 expect(usePrintPreview.getState().handle?.html).toContain('نسخة 3 من 3')
 act(() => useAppStore.setState({ warehouseReceipt: original }))
})
