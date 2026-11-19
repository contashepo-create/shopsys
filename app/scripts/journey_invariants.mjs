/**
 * بوابة الثوابت المشتركة لكل رحلات الأنشطة.
 *
 * لم تُبنَ من الصفر: `auditKit.checkInvariants` هو فاحص الثوابت العشرة المعتمد
 * (توازن، نظافة سطر وشجرة حسابات، مرجع مصدر وسنة مقفلة، ترقيم، مطابقة 1103،
 * معادلة الميزانية، مطابقة الأطراف، النقدية، ومنع التعديل الصامت).
 * هذه البوابة تُشغّله في نهاية كل رحلة نشاط، وتضيف فحصاً واحداً لا يغطيه الفاحص:
 * كميات المخزون والدفعات لا تكون سالبة، ومجموع الدفعات = رصيد الصنف.
 */
import assert from 'node:assert/strict'
import { checkInvariants } from './auditKit.mjs'

/**
 * @param {any} raw حالة المتجر الخام (useRawDataStore.getState())
 * @param {{ label: string; allowNegativeStock?: boolean; allowNegativeTreasury?: boolean;
 *           skipStockLedger?: boolean; stockLedgerDriftMinor?: number }} options
 */
export function assertJourneyInvariants(raw, options) {
  const {
    label,
    allowNegativeStock = false,
    allowNegativeTreasury = true,
    skipStockLedger = false,
    stockLedgerDriftMinor = 0,
  } = options

  // إشارة الفاحص: book = valued - إزاحة ⇒ الإزاحة = −فارق البذرة المعلن
  const { errors, warnings, stats } = checkInvariants(raw, {
    allowNegativeTreasury,
    inventoryOffsetMinor: -stockLedgerDriftMinor,
  })

  const relevant = errors.filter((message) => !(skipStockLedger && message.startsWith('ث5')))

  /* كميات المخزون والدفعات (ليس ضمن الثوابت العشرة) */
  const problems = [...relevant]
  for (const item of raw.items ?? []) {
    if (!allowNegativeStock && (item.stockQty ?? 0) < -0.0001) problems.push(`صنف «${item.nameAr}» بكمية سالبة ${item.stockQty}`)
    const owned = (raw.batches ?? []).filter((batch) => batch.itemId === item.id)
    if (!owned.length) continue
    if (owned.some((batch) => (batch.qty ?? 0) <= 0)) problems.push(`صنف «${item.nameAr}» فيه دفعة بكمية غير موجبة`)
    if (item.trackExpiry) {
      const batchQty = owned.reduce((sum, batch) => sum + (batch.qty ?? 0), 0)
      if (Math.abs(batchQty - (item.stockQty ?? 0)) > 0.0001) problems.push(`صنف «${item.nameAr}»: مجموع الدفعات ${batchQty} ≠ الرصيد ${item.stockQty}`)
    }
  }

  if (problems.length) {
    throw new assert.AssertionError({
      message: `ثوابت «${label}» منقوضة (${problems.length}):\n- ${problems.slice(0, 12).join('\n- ')}`,
    })
  }
  return { ...stats, warnings }
}
