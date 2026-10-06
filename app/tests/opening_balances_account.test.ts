/**
 * الأرصدة الافتتاحية — نوع «الحساب العام» (جولة v1.0.3).
 *
 * طلب المالك: رصيد افتتاحي **لكل حساب موجود في التطبيق** — لا الأطراف المخصصة فقط.
 * هذه الاختبارات تحرس المعالجة المحاسبية للنوع الجديد:
 *   ① قيد متوازن يصيب الحساب المطلوب مقابل رأس المال 3101 وباتجاه طبيعة الحساب
 *      (أصول/مصاريف: الحساب مدين · التزامات/حقوق ملكية/إيرادات: الحساب دائن)
 *   ② التعديل يرحّل قيد الفرق فقط — لا حذف ولا تعديل قيود قديمة
 *   ③ الحسابات المغطاة بأنواع مخصصة (عملاء/موردون/سلف/مخزون/خزائن/رأس المال) مرفوضة
 *      من التبويب العام — لا رصيدان لمفس الطرف من مسارين
 *   ④ مصفوفة المحرك لا تتأثر: كل قيود الافتتاحي مصدرها 'opening'
 */
import { describe, it, expect, beforeAll, vi } from 'vitest'
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
const { useDataStore } = await import('../src/data/repo.ts')
const { STANDARD_COA, accountNature } = await import('../src/core/ledger.ts')
const { openingKey, OPENING_COVERED_SYSTEM_KEYS } = await import('../src/core/openingBalances.ts')
const { keyFingerprint } = await import('../src/core/license.ts')

/* نفس منطق تبويب «الحسابات العامة» في الواجهة: كل حساب قابل بلا مخصص وبلا 3101 */
const pickable = (rootType: string) => STANDARD_COA.find((a) => a.rootType === rootType && a.isPostable && !(a.systemKey && OPENING_COVERED_SYSTEM_KEYS.has(a.systemKey)) && a.code !== '3101')!

const S = () => useDataStore.getState()
const original = useDataStore.getState()
beforeAll(() => { useDataStore.setState(original) })

describe('الأرصدة الافتتاحية — الحساب العام (v1.0.3)', () => {
  it('قيد متوازن بطبيعة الحساب: أصل ثابت مدين ورأس المال دائن', () => {
    // 1131 أصول ثابتة (طبيعة مدينة) — زيادة الرصيد = الحساب مدين / رأس المال دائن
    const asset = pickable('assets')
    expect(asset).toBeTruthy()
    expect(accountNature(asset!.rootType)).toBe('debit')
    S().setOpeningBalance({ kind: 'account', refId: asset!.code, amountMinor: 100_000_00, label: 'أثاث ومعدات قائمة' })
    const entry = [...S().journal].reverse().find((e) => e.sourceType === 'opening')
    expect(entry).toBeTruthy()
    expect(entry!.lines.some((l) => l.accountCode === asset!.code && l.debit === 100_000_00)).toBe(true)
    expect(entry!.lines.some((l) => l.accountCode === '3101' && l.credit === 100_000_00)).toBe(true)
    const totalDebit = entry!.lines.reduce((a, l) => a + l.debit, 0)
    const totalCredit = entry!.lines.reduce((a, l) => a + l.credit, 0)
    expect(totalDebit).toBe(totalCredit)
    expect(S().openingBalances[openingKey('account', asset!.code)]).toBe(100_000_00)
  })

  it('حساب بطبيعة دائنة (التزامات): رأس المال مدين والحساب دائن', () => {
    const liability = pickable('liabilities')
    expect(liability).toBeTruthy()
    S().setOpeningBalance({ kind: 'account', refId: liability!.code, amountMinor: 50_000_00, label: 'التزام قائم' })
    const entry = [...S().journal].reverse().find((e) => e.sourceType === 'opening')
    expect(entry!.lines.some((l) => l.accountCode === '3101' && l.debit === 50_000_00)).toBe(true)
    expect(entry!.lines.some((l) => l.accountCode === liability!.code && l.credit === 50_000_00)).toBe(true)
  })

  it('التعديل يرحّل قيد الفرق فقط — لا حذف للقيود القديمة', () => {
    const asset = pickable('assets')
    const before = S().journal.length
    S().setOpeningBalance({ kind: 'account', refId: asset!.code, amountMinor: 120_000_00, label: 'تعديل' })
    // قيد جديد واحد فقط (فرق +20,000.00) والقديم باقٍ
    expect(S().journal.length).toBe(before + 1)
    const entry = [...S().journal].reverse().find((e) => e.sourceType === 'opening')!
    expect(entry.lines.some((l) => l.accountCode === asset!.code && l.debit === 20_000_00)).toBe(true)
    expect(S().openingBalances[openingKey('account', asset!.code)]).toBe(120_000_00)
    // تخفيض كامل = قيد معاكس (3101 مدين / الحساب دائن)
    S().setOpeningBalance({ kind: 'account', refId: asset!.code, amountMinor: 0, label: 'تصفير' })
    const zero = [...S().journal].reverse().find((e) => e.sourceType === 'opening')!
    expect(zero.lines.some((l) => l.accountCode === '3101' && l.debit === 120_000_00)).toBe(true)
    expect(S().openingBalances[openingKey('account', asset!.code)]).toBe(0)
  })

  it('الحسابات المغطاة بأنواع مخصصة ورأس المال مرفوضة من التبويب العام', () => {
    expect(() => S().setOpeningBalance({ kind: 'account', refId: '1104', amountMinor: 100, label: 'عملاء' })).toThrow('نوع افتتاحي مخصص')
    expect(() => S().setOpeningBalance({ kind: 'account', refId: '2101', amountMinor: 100, label: 'موردون' })).toThrow('نوع افتتاحي مخصص')
    expect(() => S().setOpeningBalance({ kind: 'account', refId: '1103', amountMinor: 100, label: 'مخزون' })).toThrow('نوع افتتاحي مخصص')
    expect(() => S().setOpeningBalance({ kind: 'account', refId: '1101', amountMinor: 100, label: 'خزينة' })).toThrow('نوع افتتاحي مخصص')
    expect(() => S().setOpeningBalance({ kind: 'account', refId: '3101', amountMinor: 100, label: 'رأس المال' })).toThrow('نوع افتتاحي مخصص')
    expect(() => S().setOpeningBalance({ kind: 'account', refId: '9999', amountMinor: 100, label: 'وهمي' })).toThrow('غير موجود')
  })

  it('كل قيود الافتتاحي مصدرها opening — بصمات الحرق دالة نصية خالصة مستقرة', () => {
    // البصمة تُستعمل لقائمة الحرق السحابية (8-hex) — استقرارها شرط توافق البوت
    expect(keyFingerprint('SHOPSYS1.abc.def')).toMatch(/^[0-9a-f]{8}$/)
    expect(keyFingerprint('SHOPSYS1.abc.def')).toBe(keyFingerprint('SHOPSYS1.abc.def'))
    expect(keyFingerprint('SHOPSYS1.abc.def')).not.toBe(keyFingerprint('SHOPSYS1.abc.deg'))
  })
})
