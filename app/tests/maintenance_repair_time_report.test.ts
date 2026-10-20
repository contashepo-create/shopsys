import { describe, expect, it } from 'vitest'
import { maintenanceRepairTimeReport, ticketWorkMinutes } from '../src/core/maintenance.ts'

describe('تقرير متوسط زمن الإصلاح لكل نوع عطل (سد فجوة النشاط #3: موبايلات وصيانة)', () => {
  it('يحسب متوسط/أدنى/أقصى ساعات الإصلاح فقط للتذاكر المُسلَّمة فعلياً', () => {
    const rows = maintenanceRepairTimeReport([
      {
        issue: 'كسر شاشة',
        status: 'delivered',
        statusHistory: [
          { status: 'received', at: '2026-01-01T10:00:00.000Z' },
          { status: 'in_progress', at: '2026-01-01T12:00:00.000Z' },
          { status: 'delivered', at: '2026-01-02T10:00:00.000Z' }, // 24 ساعة
        ],
      },
      {
        issue: 'كسر الشاشة', // صياغة مختلفة قليلاً لكن نفس العطل بعد التطبيع تقريباً — لا، يختلف نصياً فيُحسب منفصلاً
        status: 'delivered',
        statusHistory: [
          { status: 'received', at: '2026-01-03T10:00:00.000Z' },
          { status: 'delivered', at: '2026-01-03T22:00:00.000Z' }, // 12 ساعة
        ],
      },
      {
        issue: 'بطارية ضعيفة',
        status: 'in_progress', // لم تُسلَّم بعد — تُستبعد
        statusHistory: [{ status: 'received', at: '2026-01-04T10:00:00.000Z' }],
      },
    ])
    const kasrShasha = rows.find((r) => r.issueLabel === 'كسر شاشة')
    expect(kasrShasha).toMatchObject({ ticketCount: 1, avgHours: 24, minHours: 24, maxHours: 24 })
    expect(rows.find((r) => r.issueLabel === 'بطارية ضعيفة')).toBeUndefined()
  })

  it('يجمع تذاكر العطل الواحد (نفس النص بعد التطبيع) في صف واحد بمتوسط صحيح', () => {
    const rows = maintenanceRepairTimeReport([
      {
        issue: '  شاشة مكسورة  ',
        status: 'delivered',
        statusHistory: [
          { status: 'received', at: '2026-01-01T00:00:00.000Z' },
          { status: 'delivered', at: '2026-01-01T10:00:00.000Z' }, // 10 ساعات
        ],
      },
      {
        issue: 'شاشة مكسورة',
        status: 'delivered',
        statusHistory: [
          { status: 'received', at: '2026-01-02T00:00:00.000Z' },
          { status: 'delivered', at: '2026-01-02T20:00:00.000Z' }, // 20 ساعة
        ],
      },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ ticketCount: 2, avgHours: 15, minHours: 10, maxHours: 20 })
  })

  it('يتجاهل تذكرة مُسلَّمة بلا توقيت استلام أو تسليم صالح في السجل', () => {
    const rows = maintenanceRepairTimeReport([
      { issue: 'عطل غامض', status: 'delivered', statusHistory: [{ status: 'in_progress', at: '2026-01-01T00:00:00.000Z' }] },
    ])
    expect(rows).toHaveLength(0)
  })

  it('يرجع مصفوفة فارغة إن لم توجد تذاكر مُسلَّمة إطلاقاً', () => {
    expect(maintenanceRepairTimeReport([])).toEqual([])
  })
})

describe('تتبع وقت عمل الفني لكل تذكرة (سد فجوة مستقبلية — النشاط #3: موبايلات وصيانة)', () => {
  it('يجمع مدة جلسات مغلقة متعددة بالدقائق', () => {
    const minutes = ticketWorkMinutes([
      { startedAt: '2026-01-01T10:00:00.000Z', endedAt: '2026-01-01T10:30:00.000Z' }, // 30 دقيقة
      { startedAt: '2026-01-01T12:00:00.000Z', endedAt: '2026-01-01T12:15:00.000Z' }, // 15 دقيقة
    ])
    expect(minutes).toBe(45)
  })

  it('يحسب الجلسة المفتوحة حتى وقت مرجعي مُمرَّر', () => {
    const minutes = ticketWorkMinutes(
      [{ startedAt: '2026-01-01T10:00:00.000Z', endedAt: null }],
      '2026-01-01T10:20:00.000Z',
    )
    expect(minutes).toBe(20)
  })

  it('يتجاهل جلسة بتوقيت غير منطقي (نهاية قبل البداية)', () => {
    expect(ticketWorkMinutes([{ startedAt: '2026-01-01T10:00:00.000Z', endedAt: '2026-01-01T09:00:00.000Z' }])).toBe(0)
  })

  it('يرجع صفراً بلا أي جلسات', () => {
    expect(ticketWorkMinutes([])).toBe(0)
  })
})
