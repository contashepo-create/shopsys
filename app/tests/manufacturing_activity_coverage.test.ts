import { describe, expect, it } from 'vitest'
import { ACTIVITY_TEMPLATES, ALL_MODULES } from '../src/core/activities.ts'

const manufacturingCapable = ['grocery', 'feed_trade', 'restaurant', 'bakery', 'manufacturing', 'herbalist']

describe('تغطية التصنيع حسب النشاط', () => {
  it.each(manufacturingCapable)('يوفر الوصفات والإنتاج افتراضياً لنشاط %s', (activityId) => {
    expect(ACTIVITY_TEMPLATES.find(activity => activity.id === activityId)?.modules).toContain('recipes')
  })

  it('يبقي وحدة التصنيع متاحة للتفعيل اليدوي في أي نشاط مركب', () => {
    expect(ALL_MODULES).toContain('recipes')
  })

  it('لا يخلط مسارات الإنتاج المتخصصة بالتصنيع العام', () => {
    expect(ACTIVITY_TEMPLATES.find(activity => activity.id === 'jewelry')?.modules).toContain('jewelry')
    expect(ACTIVITY_TEMPLATES.find(activity => activity.id === 'dates')?.modules).toContain('processing')
  })
})
