/**
 * جولة v1.0.10 — سؤال المالك: «هل أي تعديل على قاعدة البيانات (تحديث التطبيق
 * أو إلغاء ميزة) يفقد العميل بياناته؟» — الإثبات عبر المسار الحقيقي:
 * تخزين قديم النسخة (v22) يُقرأ عند إقلاع المتجر الحالي (v25) فيُرحَّل
 * تلقائياً: كل عنصر قديم يبقى بمعرفه، وكل حقل جديد يُستكمل افتراضياً.
 */
import { describe, it, expect, vi } from 'vitest'
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

/* بيانات قديمة النسق فعلاً: مريض بلا سجل منظم، سيارة بلا طريقة دفع،
   تذكرة صيانة إجمالياتها القديمة بلا استكمالات الإصدار 23 */
const OLD_STATE = {
  seeded: true,
  items: [{ id: 101, nameAr: 'زيت عباد الشمس 1 لتر', unit: 'زجاجة', costMinor: 6000, priceMinor: 7500, stockQty: 12 }],
  customers: [{ id: 7, nameAr: 'عميل قديم منذ 2024', phone: '01000000000', balanceMinor: 0 }],
  suppliers: [{ id: 3, nameAr: 'مورد الأعلاف', phone: '01111111111', balanceMinor: 0 }],
  journal: [
    { id: 9001, date: '2024-03-01', description: 'فاتورة بيع قديمة', lines: [{ accountCode: '1101', debit: 7500, credit: 0 }, { accountCode: '4101', debit: 0, credit: 7500 }] },
  ],
  vouchers: [{ id: 55, voucherNumber: 'RV-0055', kind: 'receipt', date: '2024-03-01', treasury: '1101', counterAccountCode: '1104', amountMinor: 2000, description: 'تحصيل', journalEntryId: 9002, partyKind: 'customer', partyId: 7, reversalEntryId: null }],
  purchaseExpensePayables: [],
  clinicPatients: [{ id: 11, nameAr: 'مريض قديم', phone: '01000000001', medicalHistory: 'ضغط مرتفع منذ 2020' }],
  cars: [{ id: 21, nameAr: 'شيفروليه أوبترا 2020', purchaseCostMinor: 5000000, salePriceMinor: 5600000, status: 'in_stock' }],
  tickets: [{ id: 31, device: 'آيفون 11', problem: 'شاشة', status: 'delivered', payment: 'cash', totals: { grandMinor: 3000, revenueMinor: 3000, partsCostMinor: 1500 } }],
}

describe('سلامة الترحيل عبر التحديثات (v1.0.10)', () => {
  it('قاعدة قديمة النسخة (v22) تُرحَّل عند الإقلاع بلا فقد أي عنصر وباستكمال الحقول الجديدة', async () => {
    const { appStorage } = await import('../src/data/persistentStorage.ts')
    await appStorage().setItem('shopsys-data', JSON.stringify({ state: OLD_STATE, version: 22 }))
    // إقلاع المتجر = ما يحدث فعلياً عند تحديث التطبيق وفتحه
    const { useDataStore, DATA_VERSION } = await import('../src/data/repo.ts')
    if (!useDataStore.persist?.hasHydrated()) {
      await new Promise<void>((resolve) => useDataStore.persist.onFinishHydration(() => resolve()))
    }
    const st = useDataStore.getState()
    expect(DATA_VERSION).toBeGreaterThanOrEqual(25)
    // كل عنصر قديم نجا بمعرفه
    expect(st.items.find((x) => x.id === 101)?.nameAr).toBe('زيت عباد الشمس 1 لتر')
    expect(st.customers.find((x) => x.id === 7)?.nameAr).toBe('عميل قديم منذ 2024')
    expect(st.journal.find((x) => x.id === 9001)?.lines.length).toBe(2)
    expect(st.vouchers.find((x) => x.id === 55)?.voucherNumber).toBe('RV-0055')
    // استكمالات الترحيل: حقول جديدة بقيم افتراضية سليمة
    const patient = st.clinicPatients.find((x) => x.id === 11)!
    expect(patient.history).toBeTruthy() // migrateFreeHistory حوّل النص الحر لبنية منظمة
    expect(patient.linkedCustomerId).toBeNull()
    const car = st.cars.find((x) => x.id === 21)!
    expect(car.purchasePayment).toBeNull()
    expect(car.purchaseDueMinor).toBe(0) // لا دفع قديم ⇐ لا مستحق مفبرك
    const ticket = st.tickets.find((x) => x.id === 31)!
    expect(ticket.totals.paidMinor).toBe(3000) // نقدية = مسددة كاملة
    expect(ticket.totals.creditMinor).toBe(0)
  })
})
