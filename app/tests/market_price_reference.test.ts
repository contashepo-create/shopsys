import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useDataStore } from '../src/data/repo.ts'

const original = useDataStore.getState()

beforeEach(() => useDataStore.setState({ ...original, marketPrices: [] }))
afterEach(() => useDataStore.setState(original))

describe('مرجع سعر السوق اليومي (سد فجوة مستقبلية — النشاط #2: تجارة الأعلاف والحبوب)', () => {
  it('يسجل سعر سوق جديداً بأرقام متسلسلة', () => {
    const e1 = useDataStore.getState().addMarketPrice({ date: '2026-01-05', commodityName: 'ذرة صفراء', unit: 'طن', pricePerUnitMinor: 1500000 })
    const e2 = useDataStore.getState().addMarketPrice({ date: '2026-01-06', commodityName: 'كسب صويا', unit: 'طن', pricePerUnitMinor: 2200000 })
    expect(e1.id).not.toBe(e2.id)
    expect(useDataStore.getState().marketPrices).toHaveLength(2)
  })

  it('يرفض سلعة بلا اسم، تاريخاً غير صالح، أو سعراً سالباً', () => {
    expect(() => useDataStore.getState().addMarketPrice({ date: '2026-01-05', commodityName: '  ', unit: 'طن', pricePerUnitMinor: 100 })).toThrow()
    expect(() => useDataStore.getState().addMarketPrice({ date: '05-01-2026', commodityName: 'ذرة', unit: 'طن', pricePerUnitMinor: 100 })).toThrow()
    expect(() => useDataStore.getState().addMarketPrice({ date: '2026-01-05', commodityName: 'ذرة', unit: 'طن', pricePerUnitMinor: -1 })).toThrow()
  })

  it('يحذف سجل سعر سوق بمعرّفه', () => {
    const e = useDataStore.getState().addMarketPrice({ date: '2026-01-05', commodityName: 'دريس', unit: 'بالة', pricePerUnitMinor: 5000 })
    useDataStore.getState().deleteMarketPrice(e.id)
    expect(useDataStore.getState().marketPrices).toHaveLength(0)
  })
})
