/**
 * بوابة الاتفاقية والخصوصية (v1.0.8 — طلب المالك؛ v1.0.22: موافقات منفصلة + الرفض):
 *  • gate  = عرض إلزامي أول استخدام (أو مستخدم قديم لم يوافق بعد) — لا دخول بلا موافقة.
 *  • page  = عرض دائم للمراجعة (من صفحة «حول» أو الإعدادات).
 * تُسجَّل الموافقة بالإصدار والتاريخ في المتجر (app.store.legal) وتظهر مجدداً
 * عند تحديث إصدار الاتفاقية.
 */
import { useState } from 'react'
import { Check, FileText, ShieldCheck, Scale, X } from 'lucide-react'
import { useAppStore } from '../stores/app.store.ts'
import { EULA, PRIVACY, LEGAL_VERSION, LEGAL_CONSENT_CHECKBOXES } from '../core/legal.ts'

function LegalBody({ doc }: { doc: typeof EULA }) {
  return (
    <div className="space-y-4">
      <div className="text-[12.5px] text-slate-600 dark:text-slate-300 leading-relaxed border-r-4 border-brand-400/60 pr-3">{doc.introAr}</div>
      {doc.sections.map((section) => (
        <div key={section.id} className="space-y-1.5">
          <div className="font-extrabold text-[13px] text-slate-800 dark:text-white">{section.titleAr}</div>
          {section.bodyAr.map((line, i) => (
            <p key={i} className="text-[12.5px] text-slate-600 dark:text-slate-400 leading-relaxed">• {line}</p>
          ))}
        </div>
      ))}
    </div>
  )
}

export function LegalGate() {
  const acceptLegal = useAppStore((s) => s.acceptLegal)
  const [tab, setTab] = useState<'eula' | 'privacy'>('eula')
  const [consents, setConsents] = useState<Record<string, boolean>>({})
  const [declined, setDeclined] = useState(false)
  const allChecked = LEGAL_CONSENT_CHECKBOXES.every((c) => consents[c.id])

  if (declined) {
    return (
      <div dir="rtl" className="min-h-screen bg-slate-100 dark:bg-slate-950 flex items-center justify-center p-4">
        <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-4 anim-pop">
          <div className="flex items-center gap-2 font-black text-lg text-slate-800 dark:text-white"><X size={20} className="text-rose-500" /> لم تُوافق على الاتفاقية</div>
          <p className="text-[13px] text-slate-600 dark:text-slate-300 leading-relaxed">
            لن يعمل البرنامج دون موافقتك على الاتفاقية وسياسة الخصوصية، ولن يُحفظ شيء ولن يُرسل شيء إلى المطوّر.
            لإكمال الإلغاء: أغلق البرنامج، ثم ألغِ تثبيته من إعدادات ويندوز ← التطبيقات ← تحكّم ← إلغاء التثبيت.
          </p>
          <p className="text-[12px] text-slate-500 dark:text-slate-400 leading-relaxed">
            إن غيّرت رأيك فأعد تشغيل البرنامج وراجع الاتفاقية ثم وافق عليها.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setDeclined(false)}
              className="flex-1 px-4 py-2.5 rounded-2xl text-sm font-bold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800"
            >
              رجوع للاتفاقية
            </button>
            <button
              onClick={() => { window.close() }}
              className="flex-1 px-4 py-2.5 rounded-2xl text-sm font-black text-white bg-rose-600 hover:bg-rose-700"
            >
              إغلاق البرنامج
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div dir="rtl" className="min-h-screen bg-slate-100 dark:bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl rounded-3xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden anim-pop">
        <div className="bg-gradient-to-l from-brand-600 to-fuchsia-600 p-5 text-white">
          <div className="flex items-center gap-2 font-black text-lg"><Scale size={20} /> اتفاقية الاستخدام والخصوصية</div>
          <div className="text-[12px] opacity-90 mt-1">مطلوب قبولها مرة واحدة قبل استخدام التطبيق — إصدار {LEGAL_VERSION}</div>
        </div>

        <div className="flex gap-1 p-3 border-b border-slate-100 dark:border-slate-800">
          <button onClick={() => setTab('eula')} className={`flex-1 px-4 py-2 rounded-xl text-[12.5px] font-bold flex items-center justify-center gap-1.5 ${tab === 'eula' ? 'bg-brand-500/10 text-brand-600' : 'text-slate-400'}`}><FileText size={14} /> {EULA.titleAr}</button>
          <button onClick={() => setTab('privacy')} className={`flex-1 px-4 py-2 rounded-xl text-[12.5px] font-bold flex items-center justify-center gap-1.5 ${tab === 'privacy' ? 'bg-brand-500/10 text-brand-600' : 'text-slate-400'}`}><ShieldCheck size={14} /> {PRIVACY.titleAr}</button>
        </div>

        <div className="p-5 max-h-[40vh] overflow-y-auto">
          <LegalBody doc={tab === 'eula' ? EULA : PRIVACY} />
        </div>

        <div className="p-5 border-t border-slate-100 dark:border-slate-800 space-y-3">
          {LEGAL_CONSENT_CHECKBOXES.map((c) => (
            <label key={c.id} className="flex items-start gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={!!consents[c.id]}
                onChange={(e) => setConsents((prev) => ({ ...prev, [c.id]: e.target.checked }))}
                className="mt-0.5 w-5 h-5 accent-violet-600 rounded"
              />
              <span className="text-[12.5px] font-bold text-slate-700 dark:text-slate-200 leading-relaxed">{c.label}</span>
            </label>
          ))}
          <button
            disabled={!allChecked}
            onClick={() => acceptLegal()}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-2xl text-sm font-black text-white bg-gradient-to-l from-violet-600 to-fuchsia-600 shadow-lg shadow-violet-500/30 hover:scale-[1.01] active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:active:scale-100"
          >
            <Check size={17} /> أوافق على كل ما سبق — ابدأ استخدام تحكّم
          </button>
          <button
            onClick={() => setDeclined(true)}
            className="w-full px-6 py-2.5 rounded-2xl text-[12.5px] font-bold text-rose-600 border border-rose-200 dark:border-rose-900 hover:bg-rose-50 dark:hover:bg-rose-950/30"
          >
            لا أوافق — عرض طريقة إلغاء التثبيت
          </button>
          <div className="text-[10.5px] text-slate-400 text-center">تُوثَّق موافقتك (الإصدار والتاريخ) محلياً على جهازك، ويمكنك مراجعة الاتفاقية دائماً من صفحة «حول».</div>
        </div>
      </div>
    </div>
  )
}

export function LegalPage() {
  const legal = useAppStore((s) => s.legal)
  const [tab, setTab] = useState<'eula' | 'privacy'>('eula')
  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="flex items-center justify-between p-5 bg-gradient-to-l from-brand-600/10 to-fuchsia-600/10 border-b border-slate-100 dark:border-slate-800">
          <div className="font-extrabold text-slate-800 dark:text-white flex items-center gap-2"><Scale size={17} className="text-brand-500" /> الاتفاقية والخصوصية — إصدار {LEGAL_VERSION}</div>
          {legal && <div className="text-[11px] text-emerald-600 font-bold">وافق عليها في {legal.acceptedAt.slice(0, 10)} ✓</div>}
        </div>
        <div className="flex gap-1 p-3 border-b border-slate-100 dark:border-slate-800">
          <button onClick={() => setTab('eula')} className={`flex-1 px-4 py-2 rounded-xl text-[12.5px] font-bold ${tab === 'eula' ? 'bg-brand-500/10 text-brand-600' : 'text-slate-400'}`}>{EULA.titleAr}</button>
          <button onClick={() => setTab('privacy')} className={`flex-1 px-4 py-2 rounded-xl text-[12.5px] font-bold ${tab === 'privacy' ? 'bg-brand-500/10 text-brand-600' : 'text-slate-400'}`}>{PRIVACY.titleAr}</button>
        </div>
        <div className="p-6 max-h-[60vh] overflow-y-auto">
          <LegalBody doc={tab === 'eula' ? EULA : PRIVACY} />
        </div>
      </div>
    </div>
  )
}
