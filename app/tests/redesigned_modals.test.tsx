import { describe, it, expect, beforeAll, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { chooseQuickValue } from './quickSelectHelpers.ts'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'

vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

const { useDataStore } = await import('../src/data/repo.ts')
const { useAppStore } = await import('../src/stores/app.store.ts')
const { ProcessingPage } = await import('../src/ui/pages/ProcessingPage.tsx')
const { PurchaseExpenseManager } = await import('../src/ui/components/PurchaseExpenseManager.tsx')
const { ToastHost } = await import('../src/ui/components/ui.tsx')

const S = () => useDataStore.getState()

beforeAll(() => {
  localStorage.clear()
  const app = useAppStore.getState()
  useAppStore.setState({ ...app, setup: { ...app.setup, completed: true, countryCode: 'SA', activityId: 'dates', shopName: 'مزرعة النخيل', ownerName: 'م', features: [], modules: ['inventory', 'purchases', 'processing'], accountingMode: 'full' } })
  const base = { categoryId: 1, extraUnits: [], minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, barcodes: [] as string[] }
  S().addItem({ ...base, nameAr: 'تمر خام', sku: 'RAW-1', baseUnit: 'كجم', costMinor: 2000, stockQty: 500, priceMinor: 2500 })
  S().addItem({ ...base, nameAr: 'سكري فاخر', sku: 'OUT-1', baseUnit: 'كجم', costMinor: 0, stockQty: 0, priceMinor: 6000 })
})

describe('نافذة التصنيع/التجهيز المعاد بناؤها', () => {
  it('تفتح كنافذة كاملة بأقسام التصنيع ومؤشرات حية وقيد متوقع', () => {
    const view = render(<MemoryRouter><ProcessingPage /></MemoryRouter>)
    fireEvent.click(view.getByText('أمر فرز وتعبئة').closest('button')!)
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement
    expect(dialog).toBeTruthy()
    const text = dialog.textContent ?? ''
    expect(text).toContain('① الخام المستهلك والمخازن')
    expect(text).toContain('② ')
    expect(text).toContain('③ الفاقد ومصاريف التشغيل')
    expect(text).toContain('④ توثيق الجودة والحلال')
    expect(text).toContain('التكلفة الكلية')
    expect(text).toContain('نسبة التصافي')
    expect(text).toContain('القيد المتوقع')
    // جدول النواتج يحمل أعمدة التوزيع الاحترافية
    expect(text).toContain('نصيبه من التكلفة')
    expect(text).toContain('تكلفة الوحدة')
    expect(text).toContain('هامش الوحدة')
    // بنود مصاريف التشغيل قابلة للإضافة سطراً سطراً
    expect(dialog.querySelectorAll('[aria-label="بند مصروف التجهيز"]').length).toBeGreaterThan(0)
    fireEvent.click(view.getByText('بند مصروف').closest('button')!)
    expect(dialog.querySelectorAll('[aria-label="بند مصروف التجهيز"]').length).toBe(2)
  })
})

describe('نافذة مصاريف فاتورة الشراء بنمط السندات', () => {
  it('تعرض الملخص والأقسام المرقّمة وتضيف بنداً من القالب', () => {
    const template = { id: 1, code: 'EXP-1', nameAr: 'نولون', accountCode: '5108', taxTreatment: 'exempt' as const, taxPercent: 0, settlement: 'payable_later' as const, affectsProfit: true, landedCostAllocation: 'value' as const, notes: '', isActive: true }
    let expenses: unknown[] = []
    const view = render(
      <>
        <PurchaseExpenseManager
          expenses={expenses as never}
          onChange={(next) => { expenses = next }}
          expenseTemplates={[template]}
          onAddTemplate={() => template}
          costCenters={[]}
          vehicles={[]}
          treasuries={[{ code: '1101', nameAr: 'الخزينة الرئيسية', kind: 'cash', isActive: true } as never]}
          custodyFiles={[]}
          currencyDecimals={2}
          taxPercent={15}
          taxEnabled
          defaultTreasury="1101"
        />
        <ToastHost />
      </>,
    )
    const text = view.container.textContent ?? ''
    expect(text).toContain('مصاريف الفاتورة والتكلفة المحمّلة')
    expect(text).toContain('اختر بند المصروف')
    expect(text).toContain('على المخزون')
    expect(text).toContain('لا مصروف على هذه الفاتورة بعد')
    // اختيار قالب يضيف بنداً كاملاً للمصروف
    // QuickSelect منتقٍ بحثي: التركيز يفتح القائمة ثم يُختار الخيار من الطبقة المنبثقة
    expect(chooseQuickValue(document, '1'), 'لم يُعثر على قالب المصروف في القائمة').toBe(true)
    expect(expenses).toHaveLength(1)
    expect((expenses[0] as { nameAr: string }).nameAr).toBe('نولون')
  })

  it('تعرض أقسام البند الأربعة والقيد المتوقع لمصروف مستحق لجهة أخرى', () => {
    const expense = { nameAr: 'نولون', amountMinor: 10000, method: 'value' as const, paidBy: 'payable' as const, payAccount: '1101', custodyFileId: null, beneficiaryName: '', payableAccountCode: '2117', accountCode: '5108', costTreatment: 'inventory' as const, taxTreatment: 'exclusive' as const, taxPercent: 15, costCenterId: null, vehicleId: null }
    const view = render(
      <>
        <PurchaseExpenseManager
          expenses={[expense] as never}
          onChange={() => {}}
          expenseTemplates={[]}
          onAddTemplate={() => ({}) as never}
          costCenters={[]}
          vehicles={[]}
          treasuries={[{ code: '1101', nameAr: 'الخزينة الرئيسية', kind: 'cash', isActive: true } as never]}
          custodyFiles={[]}
          currencyDecimals={2}
          taxPercent={15}
          taxEnabled
          defaultTreasury="1101"
        />
        <ToastHost />
      </>,
    )
    const text = view.container.textContent ?? ''
    expect(text).toContain('القيمة ومعالجة التكلفة')
    expect(text).toContain('الضريبة ومركز التكلفة')
    expect(text).toContain('مصدر السداد والاستحقاق')
    expect(text).toContain('مصاريف مستحقة (2117)')
    expect(text).toContain('القيد المتوقع')
    // معاينة الضريبة: 100 أساس + 15 ضريبة = 115 إجمالي
    expect(text).toContain('115.00')
  })
})
