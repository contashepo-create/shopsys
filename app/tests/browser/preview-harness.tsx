import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { ThermalPreview } from '../../src/ui/components/ThermalPreview.tsx'
import { openPrintPreview } from '../../src/ui/components/printPreviewStore.ts'

const html = `<!doctype html><html><body><h1 id="report">بيان اختبار</h1>
<script>parent.__previewScriptRan = true</script>
<img src="/does-not-exist" onerror="parent.__previewEventRan = true">
</body></html>`
createRoot(document.getElementById('root')!).render(
  <MemoryRouter>
    <button id="open-preview" onClick={() => openPrintPreview({ html, wide: true, title: 'معاينة اختبار' })}>فتح</button>
    <ThermalPreview />
  </MemoryRouter>,
)
