import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QuickPrintSettings } from '../src/ui/components/QuickPrintSettings.tsx'
import { A4_STYLES } from '../src/core/receipt.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const app = useAppStore.getState()
afterEach(() => { cleanup(); useAppStore.setState(app) })
it('تظهر جميع أنماط A4 في لوحة المعاينة السريعة ويمكن اختيار النمط الجديد', () => {
 render(<QuickPrintSettings wide />)
 const select = screen.getByLabelText('نمط الفاتورة الكبيرة') as HTMLSelectElement
 expect([...select.options].map(option => option.value)).toEqual(A4_STYLES.map(style => style.id))
 fireEvent.change(select, { target: { value: 'project' } })
 expect(useAppStore.getState().receipt.a4Style).toBe('project')
})
