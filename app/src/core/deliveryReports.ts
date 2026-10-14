/**
 * تقرير التزام مواعيد التوصيل/التركيب — ShopSys
 * (سد فجوة مستقبلية #3 — النشاط #6: أجهزة كهربائية)
 * ─────────────────────────────────────────────────────────────────────
 * منطق خالص بلا واجهة: نسبة طلبات التوصيل المكتملة (status = 'done') في
 * الموعد المجدوَل (completedAt ≤ نهاية يوم scheduledAt) مقابل المتأخرة،
 * مبني فوق حقلي `scheduledAt`/`completedAt` في `DeliveryJob` (سد فجوة
 * فورية #2). الطلبات غير المكتملة بعد لا تدخل الحساب (لا قرار نهائي بعد).
 */
import type { DeliveryJob } from '../data/repo.ts'

export interface DeliveryOnTimeReport {
  completedCount: number
  onTimeCount: number
  lateCount: number
  onTimeRatePercent: number
  rows: { job: DeliveryJob; onTime: boolean; daysLate: number }[]
}

/** بين تاريخين (شاملين) — يُقاس بتاريخ الإكمال completedAt لا الجدولة */
export function deliveryOnTimeRate(jobs: readonly DeliveryJob[], from: string, to: string): DeliveryOnTimeReport {
  const rows: DeliveryOnTimeReport['rows'] = []
  for (const job of jobs) {
    if (job.status !== 'done' || !job.completedAt) continue
    const completedDay = job.completedAt.slice(0, 10)
    if (completedDay < from || completedDay > to) continue
    const scheduledMs = Date.parse(job.scheduledAt)
    const completedMs = Date.parse(completedDay)
    const daysLate = Math.max(0, Math.round((completedMs - scheduledMs) / 86_400_000))
    rows.push({ job, onTime: daysLate === 0, daysLate })
  }
  const onTimeCount = rows.filter((r) => r.onTime).length
  const completedCount = rows.length
  return {
    completedCount,
    onTimeCount,
    lateCount: completedCount - onTimeCount,
    onTimeRatePercent: completedCount > 0 ? Math.round((onTimeCount / completedCount) * 1000) / 10 : 0,
    rows: rows.sort((a, b) => b.job.scheduledAt.localeCompare(a.job.scheduledAt)),
  }
}
