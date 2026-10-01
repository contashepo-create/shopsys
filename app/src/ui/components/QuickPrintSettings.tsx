/**
 * إعدادات الطباعة السريعة المشتركة (طلب المالك): نفس اللوحة تظهر داخل نافذة
 * المعاينة الحية وداخل نافذة «إعدادات الطباعة» المنبثقة من الفاتورة —
 * ورق · لون القالب · التذييل · مفاتيح الإظهار · نمط الفاتورة الكبيرة.
 * كل تغيير يُكتب في إعدادات الطباعة مباشرة، والمعاينة الحية تتحدث فوراً.
 */
import { useAppStore } from '../../stores/app.store.ts'
import type { PaperWidth } from '../../core/receipt.ts'

export function QuickPrintSettings({ wide = false }: { wide?: boolean }) {
  const receipt = useAppStore((s) => s.receipt)
  const updateReceipt = useAppStore((s) => s.updateReceipt)
  return (
    <div className="thermal-preview-quick-body" dir="rtl">
      <div className="thermal-preview-quick-grid">
        <label>
          عرض الورق
          <select
            className="thermal-preview-quick-input"
            data-quick-paper
            value={receipt.paperWidth}
            disabled={wide}
            onChange={(event) => updateReceipt({ paperWidth: event.target.value as PaperWidth })}
          >
            <option value="80">رول 80mm</option>
            <option value="58">رول 58mm</option>
          </select>
        </label>
        <label>
          لون القالب
          <input type="color" className="thermal-preview-quick-color" data-quick-accent value={receipt.accentColor} onChange={(event) => updateReceipt({ accentColor: event.target.value })} />
        </label>
        <label className="thermal-preview-quick-wide">
          تذييل الفاتورة
          <input className="thermal-preview-quick-input" data-quick-footer value={receipt.footerText} onChange={(event) => updateReceipt({ footerText: event.target.value })} />
        </label>
      </div>
      <div className="thermal-preview-quick-toggles">
        {([
          ['showLogo', 'الشعار'],
          ['showDate', 'التاريخ'],
          ['showOperator', 'القائم بالطباعة'],
          ['showTaxSummary', 'ملخص الضريبة'],
          ['showFooter', 'التذييل'],
          ...(wide ? ([['showWords', 'المبلغ كتابة'], ['showSignatures', 'التوقيعات']] as const) : []),
        ] as const).map(([key, labelAr]) => (
          <label key={key} className="thermal-preview-quick-toggle">
            <input
              type="checkbox"
              data-quick-toggle={key}
              checked={receipt[key] === true}
              onChange={(event) => updateReceipt({ [key]: event.target.checked })}
            />
            {labelAr}
          </label>
        ))}
      </div>
      {wide && (
        <label className="thermal-preview-quick-style">
          نمط الفاتورة الكبيرة
          <select
            className="thermal-preview-quick-input"
            data-quick-a4style
            value={receipt.a4Style}
            onChange={(event) => updateReceipt({ a4Style: event.target.value as typeof receipt.a4Style })}
          >
            <option value="modern">عصري</option>
            <option value="classic">كلاسيكي</option>
            <option value="compact">مضغوط</option>
            <option value="elegant">أنيق</option>
            <option value="royal">فخم</option>
          </select>
        </label>
      )}
      <label className="thermal-preview-quick-style" style={{ marginTop: '.2rem' }}>
        حجم خط الإيصال الحراري
        <select
          className="thermal-preview-quick-input"
          data-quick-fontscale
          value={receipt.fontScale ?? 'normal'}
          onChange={(event) => updateReceipt({ fontScale: event.target.value as 'normal' | 'large' })}
        >
          <option value="normal">عادي</option>
          <option value="large">كبير وعريض (طلب المالك)</option>
        </select>
      </label>
    </div>
  )
}
