/**
 * منع انحدار بلاغ v1.0.1 (ويندوز مثبّت): قوائم البحث المرصودة بحقل
 * QuickSelect لم تكن تظهر إطلاقاً — كانت تُرسم داخل شجرة الشاشة بposition:fixed
 * فيحبسها أي سلف بtransform (أنيميشن خطوات المعالج fill-mode=both) ويقصّها
 * جذر المعالج overflow-hidden. العلاج المزدوج:
 *   ① القائمة تُركَّب على <body> عبر بورتال — خارج كل سياق سلف مهما كان
 *   ② شاشة الإعداد تستعمل القائمة الأصلية الحقيقية (prop native)
 * والاختبارات هنا تُثبت الخصائلتين وتمنعان العودة.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useState } from 'react'
import { QuickSelect } from '../src/ui/components/KeyboardPickers.tsx'

const manyOptions = Array.from({ length: 14 }, (_, i) => <option key={i} value={`v${i}`}>خيار رقم {i + 1}</option>)

describe('QuickSelect — قائمة بحث عبر بورتال على body (بلاغ v1.0.1)', () => {
  beforeEach(() => cleanup())

  it('القائمة المفتوحة تُركَّب على document.body لا داخل الحاوية — لا يحبسها transform/overflow', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    /* حاوية تحاكي علة المعالج: transform (كتلة احتواء) + قص */
    root.setAttribute('style', 'transform: scale(1); overflow: hidden; height: 40px; position: relative')
    render(
      <QuickSelect value="" onChange={() => {}}>
        {manyOptions}
      </QuickSelect>,
      { container: root },
    )
    const field = root.querySelector('input[role="combobox"]') as HTMLInputElement
    expect(field).not.toBeNull()
    expect(document.querySelector('[data-quick-option]')).toBeNull()
    fireEvent.mouseDown(field)
    const options = document.querySelectorAll('[data-quick-option]')
    expect(options.length).toBe(14)
    /* الجوهر: الخيارات في body مباشرة — وليست داخل الحاوية المتحولة */
    for (const option of options) {
      expect(root.contains(option)).toBe(false)
      expect(document.body.contains(option)).toBe(true)
    }
  })

  it('النقر على خيار من القائمة (على body) يختاره ولا يغلقه قبل الاختيار', () => {
    function LiveSelect() {
      const [value, setValue] = useState('')
      return (
        <QuickSelect value={value} onChange={(e) => setValue(e.target.value)}>
          {manyOptions}
        </QuickSelect>
      )
    }
    render(<LiveSelect />)
    const field = screen.getByRole('combobox') as HTMLInputElement
    fireEvent.mouseDown(field)
    const target = document.querySelector('[data-quick-option][data-value="v3"]') as HTMLElement
    /* mousedown (يمنع فقد التركيز) ثم click — نفس تسلسل الفأرة الحقيقي */
    fireEvent.mouseDown(target)
    fireEvent.click(target)
    expect(field.value).toContain('خيار رقم 4')
    /* وبعد الاختيار أُغلقت القائمة */
    expect(document.querySelector('[data-quick-option]')).toBeNull()
  })

  it('prop native تفرض قائمة أصلية حقيقية مهما زاد عدد الخيارات', () => {
    render(
      <QuickSelect native value="v1" onChange={() => {}}>
        {manyOptions}
      </QuickSelect>,
    )
    const select = document.querySelector('[data-quick-native] select') as HTMLSelectElement
    expect(select).not.toBeNull()
    expect(select.tagName).toBe('SELECT')
    expect(select.options.length).toBe(14)
    expect(select.value).toBe('v1')
  })

  it('القوائم القصيرة (≤10) تظل قائمة أصلية كما هي (قاعدة المالك الموثقة)', () => {
    render(
      <QuickSelect value="" onChange={() => {}}>
        {Array.from({ length: 8 }, (_, i) => <option key={i} value={`s${i}`}>قصير {i}</option>)}
      </QuickSelect>,
    )
    expect(document.querySelector('[data-quick-native] select')).not.toBeNull()
  })
})
