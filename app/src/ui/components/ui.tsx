/** مكونات UI مشتركة — أزرار، مودال، حقول، توست */
import { useEffect, useState, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { X, Eye, EyeOff } from 'lucide-react'
import { create } from 'zustand'
import { PIN_MAX_LENGTH } from '../../core/auth.ts'

export function Btn({
  children, onClick, variant = 'primary', disabled, type = 'button', className = '',
}: {
  children: ReactNode; onClick?: () => void; disabled?: boolean
  variant?: 'primary' | 'ghost' | 'danger' | 'soft'; type?: 'button' | 'submit'; className?: string
}) {
  const styles = {
    primary: 'text-white bg-gradient-to-l from-brand-600 to-fuchsia-600 shadow-lg shadow-brand-500/25 hover:shadow-xl',
    ghost: 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800',
    danger: 'text-white bg-gradient-to-l from-rose-600 to-red-500 shadow-lg shadow-rose-500/25',
    soft: 'text-brand-700 dark:text-brand-300 bg-brand-500/10 hover:bg-brand-500/20',
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`px-4 py-2.5 rounded-xl text-sm font-bold transition-all duration-200 hover:scale-[1.03] active:scale-95 disabled:opacity-40 disabled:pointer-events-none ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  )
}

export function Field({
  label, children, hint,
}: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block text-[12px] font-bold text-slate-600 dark:text-slate-300 mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-slate-400 mt-1">{hint}</p>}
    </div>
  )
}

export const inputCls =
  'w-full px-3.5 py-2.5 rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-transparent text-sm text-slate-800 dark:text-white focus:border-brand-500 focus:outline-none transition-colors duration-200 placeholder:text-slate-300 dark:placeholder:text-slate-600'

/**
 * حقل كلمة سر موحد بعين إظهار/إخفاء (طلب المالك) — يُستخدم في كل شاشات
 * الأرقام السرية: الدخول، ملفي، المستخدمين، موافقة المشرف.
 * كلمة السر 8–32 خانة: أرقام وحروف ورموز (لا مسافات).
 */
export function PinInput({
  value, onChange, placeholder = 'كلمة السر', disabled, autoComplete = 'off', name, centered, onEnter, className = '',
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
  autoComplete?: string
  name?: string
  centered?: boolean
  onEnter?: () => void
  className?: string
}) {
  const [show, setShow] = useState(false)
  const keyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && onEnter) onEnter()
  }
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        autoComplete={autoComplete}
        name={name}
        dir="ltr"
        maxLength={PIN_MAX_LENGTH}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.replace(/\s/g, ''))}
        onKeyDown={keyDown}
        placeholder={placeholder}
        className={`${inputCls} !pl-10 ${centered ? 'text-center font-black' : ''} ${className}`}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow((s) => !s)}
        title={show ? 'إخفاء كلمة السر' : 'إظهار كلمة السر'}
        className="absolute left-2.5 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  )
}

export function Modal({
  open, onClose, title, children, wide,
}: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    if (open) window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])

  if (!open) return null
  /* بلاغ المالك: نوافذ منبثقة كانت تُغطى جزئياً خلف الهيدر — السبب أن الصفحات تُغلَّف بـ
     anim-in/anim-up (animation تنشئ stacking context) فيصبح z-50 محلياً داخل الصفحة ويعلوه
     هيدر sticky z-20 الخارجي. الحل الجذري: createPortal إلى <body> فيخرج المودال من أي سياق. */
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" dir="rtl">
      {/* إصلاح الظل الغريب: الحركة كانت مزدوجة (حاوية + لوحة) فيومض الـ blur — الآن التعتيم يتحرك وحده بلا blur متحرك */}
      <div className="absolute inset-0 bg-slate-900/55 anim-in" onClick={onClose} />
      <div className={`relative anim-pop w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto rounded-3xl bg-white dark:bg-card-dark shadow-2xl border border-slate-200 dark:border-slate-700`}>
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-white/90 dark:bg-card-dark/90 glass rounded-t-3xl">
          <h3 className="font-extrabold text-slate-800 dark:text-white">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-rose-500 transition-colors duration-200">
            <X size={18} />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

/* ─── توست ─── */
interface ToastState {
  msg: string | null
  kind: 'success' | 'error'
  show: (msg: string, kind?: 'success' | 'error') => void
  clear: () => void
}
export const useToast = create<ToastState>((set) => ({
  msg: null,
  kind: 'success',
  show: (msg, kind = 'success') => {
    set({ msg, kind })
    setTimeout(() => set({ msg: null }), 2600)
  },
  clear: () => set({ msg: null }),
}))

export function ToastHost() {
  const { msg, kind } = useToast()
  if (!msg) return null
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[120] anim-pop" dir="rtl">
      <div className={`px-5 py-3 rounded-2xl shadow-2xl text-sm font-bold text-white ${kind === 'success' ? 'bg-gradient-to-l from-emerald-600 to-teal-500' : 'bg-gradient-to-l from-rose-600 to-red-500'}`}>
        {kind === 'success' ? '✅ ' : '⚠️ '}{msg}
      </div>
    </div>
  )
}

export function EmptyState({ icon, title, sub }: { icon: string; title: string; sub: string }) {
  return (
    <div className="text-center py-16 anim-in">
      <div className="text-5xl mb-3">{icon}</div>
      <h3 className="font-extrabold text-slate-700 dark:text-slate-200">{title}</h3>
      <p className="text-sm text-slate-400 mt-1">{sub}</p>
    </div>
  )
}
