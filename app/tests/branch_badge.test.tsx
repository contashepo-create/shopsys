/**
 * شارة الفرع النشط (قرار المالك 2026-10-22):
 *  - موظف مقيَّد بفرع يرى اسم فرعه للقراءة فقط، بلا قائمة تبديل.
 *  - المالك يرى مبدّلاً يحوي «كل الفروع» وكل الفروع النشطة.
 *  - «كل الفروع» تُوسم بلون مختلف عن الفرع المحدد.
 *  - بلا فروع لا تُرسم شارة أصلاً.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BranchBadge } from '../src/ui/components/BranchBadge.tsx'

const branches = [
  { id: 1, nameAr: 'الفرع الرئيسي' },
  { id: 2, nameAr: 'فرع المنصورة', customModulesMode: 'custom' as const },
]

describe('BranchBadge', () => {
  it('موظف مقيَّد: اسم فرعه ظاهر، بلا select، ووسم القفل', () => {
    const { container } = render(<BranchBadge branches={branches} value={2} locked placement="sidebar" />)
    expect(screen.getByText('فرع المنصورة')).toBeTruthy()
    expect(container.querySelector('select')).toBeNull()
    expect(container.querySelector('[data-sidebar-branch-locked="2"]')).toBeTruthy()
    expect(screen.getByTitle(/مخصص لحسابك/)).toBeTruthy()
  })

  it('المالك: مبدّل بكل الفروع + خيار شامل، ويُبلّغ الاختيار', () => {
    const onChange = vi.fn()
    const { container } = render(
      <BranchBadge branches={branches} value={1} onChange={onChange} placement="menubar" />,
    )
    const select = container.querySelector('select') as HTMLSelectElement
    expect(select).toBeTruthy()
    expect(select.value).toBe('1')
    expect(select.options.length).toBe(3)
    expect(select.options[0].textContent).toContain('كل الفروع')
    expect(select.options[2].textContent).toContain('(مخصص)')
    fireEvent.change(select, { target: { value: '2' } })
    expect(onChange).toHaveBeenCalledWith(2)
    fireEvent.change(select, { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('«كل الفروع» لها لون حالة مختلف عن الفرع المحدد', () => {
    const { container: all } = render(<BranchBadge branches={branches} value={null} placement="header" />)
    expect(all.querySelector('.branch-badge.is-all')).toBeTruthy()
    const { container: one } = render(<BranchBadge branches={branches} value={1} placement="header" />)
    expect(one.querySelector('.branch-badge.is-current')).toBeTruthy()
  })

  it('بلا فروع لا تُرسم شارة', () => {
    const { container } = render(<BranchBadge branches={[]} value={null} placement="sidebar" />)
    expect(container.innerHTML).toBe('')
  })
})
