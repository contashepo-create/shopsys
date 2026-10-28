/** بيانات تاريخية لا يمكن اشتقاق رصيدها بأمان من المستند والدفتر. */
export class FinancialDataReviewError extends Error {
  constructor(documentLabel: string) {
    super(`يلزم مراجعة ${documentLabel}: القيد الأصلي أو قيد المرتجع مفقود أو غير مطابق. الرصيد والتوزيع متوقفان حتى مطابقة المستند والدفتر؛ لا تُنشئ تسوية تقديرية.`)
    this.name = 'FinancialDataReviewError'
  }
}
