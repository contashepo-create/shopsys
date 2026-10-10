/**
 * زر واتساب لكل فاتورة: الطرف ورقمه يُؤخذان من بطاقة الطرف المسجّلة (لا من نص حر).
 * - بيع لعميل ⇒ رقم العميل، ولمورد/موظف (partyKind) ⇒ رقمه، ونقدي بلا طرف ⇒ لا طرف.
 * - شراء ⇒ رقم المورد المسجّل، ومورد نقدي (0) ⇒ لا طرف.
 * - بطاقة بلا رقم ⇒ phone فارغ فيُعطّل الزر (لا إرسال إلى جهة مجهولة).
 */
import { describe, expect, it } from 'vitest'
import { saleWaParty, purchaseWaParty, waChatLink } from '../src/core/whatsapp.ts'

const parties = {
  customers: [
    { id: 1, nameAr: 'أحمد العميل', phone: '01012345678' },
    { id: 2, nameAr: 'عميل بلا رقم', phone: '' },
  ],
  suppliers: [{ id: 5, nameAr: 'مورد الحديد', phone: '01099999999' }],
  employees: [{ id: 7, nameAr: 'عبد الرحمن', phone: '01155555555' }],
}

describe('saleWaParty — طرف فاتورة البيع', () => {
  it('عميل مسجّل ⇒ رقم بطاقة العميل', () => {
    expect(saleWaParty({ customerId: 1 }, parties)).toEqual({ name: 'أحمد العميل', phone: '01012345678' })
  })

  it('مورد عبر partyKind ⇒ رقم بطاقة المورد', () => {
    expect(saleWaParty({ customerId: null, partyKind: 'supplier', partyId: 5, partyName: 'مورد الحديد' }, parties))
      .toEqual({ name: 'مورد الحديد', phone: '01099999999' })
  })

  it('موظف عبر partyKind ⇒ رقم بطاقة الموظف', () => {
    expect(saleWaParty({ customerId: null, partyKind: 'employee', partyId: 7 }, parties))
      .toEqual({ name: 'عبد الرحمن', phone: '01155555555' })
  })

  it('بيع نقدي بلا طرف ⇒ لا طرف (لا زر إرسال)', () => {
    expect(saleWaParty({ customerId: null }, parties)).toBeNull()
    expect(saleWaParty({ customerId: 0 }, parties)).toBeNull()
  })

  it('عميل بلا رقم مسجّل ⇒ الهاتف فارغ فيُعطّل الزر', () => {
    expect(saleWaParty({ customerId: 2 }, parties)).toEqual({ name: 'عميل بلا رقم', phone: '' })
  })

  it('بطاقة محذوفة ⇒ لا رقم ولا اسم بطاقة (يُعرض الاسم المحفوظ على الفاتورة بلا رقم)', () => {
    expect(saleWaParty({ customerId: null, partyKind: 'supplier', partyId: 999, partyName: 'مورد قديم' }, parties))
      .toEqual({ name: 'مورد قديم', phone: '' })
    expect(saleWaParty({ customerId: 99 }, parties)).toBeNull()
  })
})

describe('purchaseWaParty — طرف فاتورة الشراء', () => {
  it('مورد مسجّل ⇒ رقم بطاقته', () => {
    expect(purchaseWaParty(5, parties.suppliers)).toEqual({ name: 'مورد الحديد', phone: '01099999999' })
  })

  it('مورد نقدي (0) ⇒ لا طرف', () => {
    expect(purchaseWaParty(0, parties.suppliers)).toBeNull()
  })
})

describe('الرابط الناتج من الرقم المسجّل', () => {
  it('الرقم المصري يتحول إلى +20 في رابط wa.me', () => {
    const party = saleWaParty({ customerId: 1 }, parties)!
    expect(waChatLink(party.phone, 'مرحبا')).toBe(`https://wa.me/201012345678?text=${encodeURIComponent('مرحبا')}`)
  })
})
