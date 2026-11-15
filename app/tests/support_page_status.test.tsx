import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
const mocks = vi.hoisted(() => ({ fetchConversation: vi.fn(), getOrCreateSupportToken: vi.fn(async () => 'A'.repeat(43)) }))
vi.mock('../src/data/supportAuth.ts', () => ({ getOrCreateSupportToken: mocks.getOrCreateSupportToken }))
vi.mock('../src/core/support.ts', async importOriginal => ({ ...await importOriginal<typeof import('../src/core/support.ts')>(), fetchConversation: mocks.fetchConversation }))
import { SupportPage } from '../src/ui/pages/SupportPage.tsx'
beforeAll(() => { Element.prototype.scrollIntoView = vi.fn() })
afterEach(() => { cleanup(); vi.clearAllMocks() })
it('فشل تحميل المحادثة لا يعرضها فارغة، والتحديث الناجح يعرض الخلو الصحيح', async () => {
 mocks.fetchConversation.mockResolvedValueOnce(null).mockResolvedValueOnce([])
 render(<SupportPage />)
 await waitFor(() => expect(screen.getByText(/المحادثة غير متاحة حالياً/)).toBeTruthy())
 expect(screen.queryByText('لا رسائل بعد')).toBeNull()
 fireEvent.click(screen.getByTitle('تحديث المحادثة'))
 await waitFor(() => expect(screen.getByText('لا رسائل بعد')).toBeTruthy())
 expect(screen.queryByText(/تعذر تحديث المحادثة/)).toBeNull()
})
it('بعد فشل تحديث لاحق تبقى الرسائل السابقة مرئية مع تحذير التقادم', async () => {
 mocks.fetchConversation.mockResolvedValueOnce([{ id: 1, from: 'developer', text: 'رد محفوظ', at: '' }]).mockResolvedValueOnce(null)
 render(<SupportPage />)
 await waitFor(() => expect(screen.getByText('رد محفوظ')).toBeTruthy())
 fireEvent.click(screen.getByTitle('تحديث المحادثة'))
 await waitFor(() => expect(screen.getByText(/تعذر تحديث المحادثة/)).toBeTruthy())
 expect(screen.getByText('رد محفوظ')).toBeTruthy()
})
