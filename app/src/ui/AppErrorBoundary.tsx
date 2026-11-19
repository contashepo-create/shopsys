import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react'
import { logEvent } from '../core/applog.ts'

interface Props { children: ReactNode }
interface State { error: Error | null; incidentId: string | null }

function incidentId(): string {
  try {
    const bytes = crypto.getRandomValues(new Uint8Array(4))
    return `ERR-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()}`
  } catch {
    return `ERR-${Date.now().toString(36).toUpperCase()}`
  }
}

/**
 * آخر خط دفاع مرئي عند تعطل شجرة React.
 * لا يعرض stack trace أو بيانات العميل، ويسجل معرفاً قصيراً يرسله العميل للدعم.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, incidentId: null }

  static getDerivedStateFromError(error: Error): State {
    return { error, incidentId: incidentId() }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const component = info.componentStack?.trim().split('\n')[0]?.trim() ?? 'unknown-component'
    logEvent('error', `React boundary ${this.state.incidentId ?? 'ERR-UNKNOWN'}: ${error.name}: ${error.message} @ ${component}`)
  }

  private retry = (): void => this.setState({ error: null, incidentId: null })

  render(): ReactNode {
    if (!this.state.error) return this.props.children

    return (
      <main dir="rtl" className="min-h-screen bg-slate-950 text-white grid place-items-center p-5" role="alert">
        <section className="w-full max-w-xl rounded-3xl border border-rose-400/25 bg-slate-900 p-7 sm:p-10 shadow-2xl text-center">
          <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-rose-500/15 text-rose-300">
            <AlertTriangle size={34} aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-black">حدث خطأ غير متوقع</h1>
          <p className="mt-3 leading-7 text-slate-300">
            بياناتك لم تُحذف. حاول إعادة فتح الشاشة، وإن تكرر الخطأ أرسل رقم التتبع إلى الدعم الفني.
          </p>
          <p className="mt-5 inline-block rounded-xl bg-black/25 px-4 py-2 font-mono text-sm text-amber-200" dir="ltr">
            {this.state.incidentId}
          </p>
          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={this.retry} className="flex items-center justify-center gap-2 rounded-xl bg-cyan-600 px-5 py-3 font-bold hover:bg-cyan-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300">
              <RotateCcw size={18} aria-hidden="true" /> إعادة فتح الشاشة
            </button>
            <button type="button" onClick={() => window.location.reload()} className="flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-5 py-3 font-bold hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
              <RefreshCw size={18} aria-hidden="true" /> إعادة تشغيل التطبيق
            </button>
          </div>
        </section>
      </main>
    )
  }
}

/**
 * حدّ خطأ **على مستوى الصفحة** لا التطبيق.
 *
 * لماذا: الحدّ العام (`AppErrorBoundary`) يُستبدل الشجرة كلها — أي خطأ في شاشة
 * واحدة (حقل ناقص، صف بلا مفتاح، بيانات قديمة) يمحو الشريط الجانبي ويجبر المالك
 * على إعادة التشغيل، فيفقد عمله في بقية الشاشات. هذا الحدّ يُبقي الغلاف حياً
 * ويعرض بطاقة داخل مكان الصفحة وحدها مع زر إرجاع فوري.
 *
 * `FinancialDataReviewBoundary` يُعيد رفع ما ليس خطأ مالي مراجعةً عن قصد، فيصل إلى
 * هنا — وهو المسار المقصود: بيانات تحتاج مراجعة ≠ شاشة تحتاج إعادة تشغيل.
 */
export class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null, incidentId: null }

  static getDerivedStateFromError(error: Error): State {
    return { error, incidentId: incidentId() }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const component = info.componentStack?.trim().split('\n')[0]?.trim() ?? 'unknown-component'
    logEvent('error', `Page boundary ${this.state.incidentId ?? 'ERR-UNKNOWN'}: ${error.name}: ${error.message} @ ${component}`)
  }

  private retry = (): void => this.setState({ error: null, incidentId: null })

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <section dir="rtl" role="alert" data-page-error-boundary className="m-4 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-5 text-amber-900 dark:text-amber-200">
        <h2 className="text-base font-bold">تعذّر عرض هذه الشاشة</h2>
        <p className="mt-2 text-[13px] leading-6">
          بقية التطبيق يعمل — الشريط الجانبي والأقسام الأخرى سليمة. أعد المحاولة، وإن تكرر الخطأ أرسل الرقم
          <b className="mx-1 font-mono">{this.state.incidentId}</b>
          للدعم مع اسم الشاشة.
        </p>
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={this.retry} className="rounded-xl bg-amber-600 px-3 py-2 text-[12px] font-bold text-white">إعادة المحاولة</button>
        </div>
      </section>
    )
  }
}
