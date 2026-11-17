import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { ItemSearchPanel, type QuickItem } from '../src/ui/components/KeyboardPickers.tsx'
import { useAppStore } from '../src/stores/app.store.ts'
import { ean13CheckDigit } from '../src/core/barcode.ts'

const scaleCode = (plu: number, grams: number) => {
  const body = `22${String(plu).padStart(5, '0')}${String(grams).padStart(5, '0')}`
  return body + ean13CheckDigit(body)
}

const items: QuickItem[] = [
  { id: 1, nameAr: 'جبنة رومي', sku: 'CHE-42', barcodes: [], stockQty: 10, priceMinor: 2500, baseUnit: 'كجم', soldByWeight: true },
  { id: 2, nameAr: 'علبة جبنة', sku: 'BOX-43', barcodes: [], stockQty: 10, priceMinor: 900, baseUnit: 'علبة', soldByWeight: false },
]

const typeAndEnter = (view: ReturnType<typeof render>, text: string) => {
  const input = view.container.querySelector('input[aria-label="بحث الصنف"]') as HTMLInputElement
  fireEvent.change(input, { target: { value: text } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

describe('منتقي الأصناف يفكّ ملصق الميزان', () => {
  it('مسح ملصق وزن داخل منتقي الفاتورة يختار الصنف بوزن كسري لا بقطعة', () => {
    expect(useAppStore.getState().scaleRules.length).toBeGreaterThan(0)
    const onPick = vi.fn()
    const view = render(<ItemSearchPanel items={items} onPick={onPick} />)
    const input = view.container.querySelector('input[aria-label="بحث الصنف"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: scaleCode(42, 750) } })
    // اللافتة تظهر قبل الإضافة — وبعد Enter يُختار الصنف بالوزن ويُفرَّغ البحث
    expect(view.container.querySelector('[data-scale-pick]')).not.toBeNull()
    expect(view.container.textContent).toContain('0.750')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith(1, expect.objectContaining({ qty: 0.75 }))
    cleanup()
  })

  it('ملصق لكود صنف يُباع بالعدد لا يُحوَّل إلى وزن', () => {
    const onPick = vi.fn()
    const view = render(<ItemSearchPanel items={items} onPick={onPick} />)
    typeAndEnter(view, scaleCode(43, 500))
    expect(view.container.querySelector('[data-scale-pick]')).toBeNull()
    expect(onPick).not.toHaveBeenCalled()
    cleanup()
  })
})
