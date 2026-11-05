import { Component, type ReactNode } from 'react'
import { FinancialDataReviewError } from '../../core/financialDataReview.ts'

/** حجب العرض المتأثر وحده عند تعذر إثبات الرصيد مع إبقاء التنقل متاحاً. */
export class FinancialDataReviewBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null; resetKey?: string }> {
  state: { error: Error | null; resetKey?: string } = { error: null, resetKey: this.props.resetKey }
  static getDerivedStateFromError(error: Error) { return { error } }
  static getDerivedStateFromProps(props: { resetKey?: string }, state: { resetKey?: string }) {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null
  }
  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    if (!(error instanceof FinancialDataReviewError)) throw error
    return (
      <section dir="rtl" role="alert" className="m-4 border border-amber-500 bg-amber-50 p-5 text-amber-950 dark:bg-amber-950 dark:text-amber-100">
        <h2 className="text-lg font-bold">البيانات المالية تحتاج مراجعة</h2>
        <p className="mt-2 leading-7">{error.message}</p>
        <p className="mt-2">راجع المستند وقيده مع المحاسب أو استعد نسخة موثوقة قبل الاعتماد على الرصيد. لم تُعدَّل البيانات تلقائياً.</p>
        <button type="button" className="mt-4 border border-current px-3 py-2 font-bold" onClick={() => this.setState({ error: null })}>إعادة المحاولة</button>
      </section>
    )
  }
}
