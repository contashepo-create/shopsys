import { beforeEach, describe, expect, it } from 'vitest'
import { readSectionView, writeSectionView } from '../src/ui/components/SectionViewPreference.ts'

const allowed = ['list', 'report'] as const

beforeEach(() => localStorage.clear())

describe('تفضيل عرض الأقسام', () => {
  it('يبدأ بالقائمة ولا يلوث الحالة المحاسبية', () => {
    expect(readSectionView('laundry', 'list', allowed)).toBe('list')
    expect(localStorage.getItem('shopsys:section-view:laundry')).toBeNull()
  })

  it('يحفظ الاختيار لكل قسم على حدة', () => {
    writeSectionView('laundry', 'report')
    expect(readSectionView('laundry', 'list', allowed)).toBe('report')
    expect(readSectionView('maintenance', 'list', allowed)).toBe('list')
  })

  it('يتجاهل قيمة غير معروفة ويعود للقائمة الآمنة', () => {
    localStorage.setItem('shopsys:section-view:transfers', 'unknown')
    expect(readSectionView('transfers', 'list', ['list', 'balances'] as const)).toBe('list')
  })
})
