import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AppErrorBoundary } from './ui/AppErrorBoundary.tsx'
import { seedDeveloperDefaults } from './dev/devDefaults.ts'

// يجهز الحساب التجريبي مرة واحدة في بيئة التطوير فقط؛ لا يُضمّن في النسخة النهائية.
seedDeveloperDefaults()

/** حراسة واجهة النسخة النهائية فقط: لا رسالة ولا سلوك إضافي في وضع المطور. */
if (import.meta.env.PROD) {
  document.addEventListener('contextmenu', (event) => event.preventDefault())
  document.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase()
    const blocked = event.key === 'F12'
      || (event.ctrlKey && event.shiftKey && ['i', 'j', 'c'].includes(key))
      || (event.ctrlKey && key === 'u')
    if (blocked) {
      event.preventDefault()
      event.stopPropagation()
    }
  }, true)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
