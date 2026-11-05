/** بيانات تاريخية لا يمكن اشتقاق رصيدها بأمان من المستند والدفتر. */
export class FinancialDataReviewError extends Error {
  constructor(documentLabel: string, detail = 'القيد الأصلي أو قيد المرتجع مفقود أو غير مطابق') {
    super(`يلزم مراجعة ${documentLabel}: ${detail}. الرصيد والتوزيع متوقفان حتى مطابقة المستند والدفتر؛ لا تُنشئ تسوية تقديرية.`)
    this.name = 'FinancialDataReviewError'
  }
}
