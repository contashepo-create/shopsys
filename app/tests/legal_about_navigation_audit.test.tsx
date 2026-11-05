import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { LegalPage } from '../src/ui/LegalGate.tsx'
import { AboutPage } from '../src/ui/pages/AboutPage.tsx'
import { parseAbout } from '../src/core/cloud.ts'
import { useAppStore } from '../src/stores/app.store.ts'
const original = useAppStore.getState()
afterEach(() => { cleanup(); useAppStore.setState(original) })
it('زر الرجوع يعيد من مراجعة الاتفاقية إلى حول التطبيق حتى عند فتح الرابط مباشرة', () => {
 render(<MemoryRouter initialEntries={['/settings/legal']}><Routes><Route path="/settings/legal" element={<LegalPage />} /><Route path="/settings/about" element={<div>صفحة حول</div>} /></Routes></MemoryRouter>)
 fireEvent.click(screen.getByRole('link', { name: /رجوع إلى حول التطبيق/ }))
 expect(screen.getByText('صفحة حول')).toBeTruthy()
})
it('أيقونتا تواصل المطوّر تستخدمان بيانات السحابة المنقاة بلا وجهة مخترعة', () => {
 useAppStore.setState({ cloudAbout: parseAbout({ supportWhatsapp: '+20 100 123 4567', supportTelegram: '@tahakam_support' }) })
 render(<MemoryRouter><AboutPage /></MemoryRouter>)
 expect(screen.getByRole('link', { name: 'مراسلة المطوّر على واتساب' }).getAttribute('href')).toBe('https://wa.me/201001234567')
 expect(screen.getByRole('link', { name: 'مراسلة المطوّر على تليجرام' }).getAttribute('href')).toBe('https://t.me/tahakam_support')
 cleanup()
 useAppStore.setState({ cloudAbout: parseAbout({}) })
 render(<MemoryRouter><AboutPage /></MemoryRouter>)
 expect(screen.queryByRole('link', { name: 'مراسلة المطوّر على واتساب' })).toBeNull()
 expect(screen.getByText('واتساب غير مضبوط').getAttribute('aria-disabled')).toBe('true')
 expect(screen.getByText('تليجرام غير مضبوط').getAttribute('aria-disabled')).toBe('true')
})
