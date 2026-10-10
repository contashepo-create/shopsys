/**
 * مفتاح الاسترداد على سطح المكتب (v1.0.22).
 *
 * لماذا منفصل عن «نقل سر التشفير» القديم؟ سطح المكتب يشفّر لقطات SQLite بمفتاح
 * الجهاز الذي تحفظه العملية الرئيسية (device.key.enc عبر DPAPI). السر القديم في
 * المتصفح (localStorage) لا يفكّ تلك اللقطات، فكان ملفه لا يستعيد شيئاً على جهاز
 * جديد. هنا الملف يحمل مفتاح الجهاز الحقيقي مغلّفاً بكلمة مرور (انظر desktop/keyRecovery.ts).
 *
 * التحقق من كلمة المرور وفك الملف يتمان في العملية الرئيسية (node:crypto)، فالواجهة
 * تعرض رسائلها كما تأتي.
 */
import { useEffect, useState } from 'react'
import { KeyRound, Download, Upload, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Btn, Modal, inputCls, useToast } from './ui.tsx'
import type { DesktopKeyRecoveryBridge } from '../../data/desktopBridge.ts'

export const KEY_RECOVERY_UI_MIN_PASSPHRASE = 10

export function desktopKeyRecoveryBridge(): DesktopKeyRecoveryBridge | null {
  return typeof window !== 'undefined' ? window.shopsysDesktop?.keyRecovery ?? null : null
}

const card = 'rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-5'

export function DesktopKeyRecoveryCard({ deviceId }: { deviceId: string }) {
  const bridge = desktopKeyRecoveryBridge()
  const toast = useToast()
  const [exportedAt, setExportedAt] = useState<string | null | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!bridge) return
    void bridge.status().then((s) => setExportedAt(s.exportedAt)).catch(() => setExportedAt(null))
  }, [bridge])

  if (!bridge) return null

  const runExport = async () => {
    if (pass !== pass2) { toast.show('تأكيد كلمة المرور غير مطابق', 'error'); return }
    setBusy(true)
    try {
      const result = await bridge.export({ passphrase: pass, deviceId })
      if (result.ok) {
        setExportedAt(new Date().toISOString())
        setOpen(false); setPass(''); setPass2('')
        toast.show('حُفظ ملف مفتاح الاسترداد — انقله إلى USB أو مكان آمن خارج هذا الجهاز 🔑')
      } else if (!result.canceled) {
        toast.show(result.reason ?? 'تعذّر التصدير', 'error')
      }
    } catch (err) {
      toast.show((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`anim-up ${card} space-y-4`} style={{ animationDelay: '30ms' }}>
      <div className="font-extrabold text-slate-800 dark:text-white flex items-center gap-2">
        <KeyRound size={17} className="text-amber-500" /> مفتاح الاسترداد
      </div>
      <div className="text-[12.5px] text-slate-500 dark:text-slate-400 leading-relaxed">
        بياناتك مشفّرة بمفتاح محفوظ على هذا الجهاز. إن فُقد هذا المفتاح (إعادة تثبيت Windows، تغيّر حساب المستخدم،
        أو جهاز جديد) لا تُقرأ النسخ الاحتياطية. صَدّر ملف مفتاح الاسترداد <b>مغلّفاً بكلمة مرور تختارها</b> واحفظه
        خارج هذا الجهاز. كلمة المرور لا تُحفظ في التطبيق.
      </div>
      {exportedAt === null && (
        <div className="rounded-xl bg-amber-500/10 p-3 text-[12px] text-amber-700 dark:text-amber-300 leading-relaxed flex gap-2">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          لم يُصدَّر ملف مفتاح الاسترداد بعد. صدّره الآن حتى لا تضيع بياناتك إن فُقد المفتاح.
        </div>
      )}
      {exportedAt && (
        <div className="rounded-xl bg-emerald-500/10 p-3 text-[12px] text-emerald-700 dark:text-emerald-300 flex gap-2">
          <CheckCircle2 size={15} className="shrink-0 mt-0.5" />
          آخر تصدير: {exportedAt.slice(0, 16).replace('T', ' ')} — كرّره بعد أي تغيير في الجهاز.
        </div>
      )}
      <Btn onClick={() => setOpen(true)} className="w-full"><KeyRound size={15} /> تصدير مفتاح الاسترداد بكلمة مرور</Btn>

      <Modal open={open} onClose={() => setOpen(false)} title="🔑 تصدير مفتاح الاسترداد">
        <div className="space-y-3">
          <div className="text-[12px] text-slate-500 dark:text-slate-400 leading-relaxed">
            الملف الناتج لا يُفتح إلا بكلمة المرور هذه. احفظه على USB أو في مكان لا يوجد فيه هذا الجهاز،
            واحفظ كلمة المرور في مكان منفصل عن الملف.
          </div>
          <label className="block text-[11px] font-bold text-slate-500">كلمة المرور ({KEY_RECOVERY_UI_MIN_PASSPHRASE} أحرف على الأقل)
            <input type="password" className={`${inputCls} mt-1`} value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
          </label>
          <label className="block text-[11px] font-bold text-slate-500">تأكيد كلمة المرور
            <input type="password" className={`${inputCls} mt-1`} value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="new-password" />
          </label>
          <Btn className="w-full" disabled={busy || pass.length < KEY_RECOVERY_UI_MIN_PASSPHRASE} onClick={() => { void runExport() }}>
            <Download size={15} /> {busy ? 'جارٍ الحفظ…' : 'اختر مكان الحفظ وصدّر'}
          </Btn>
        </div>
      </Modal>
    </div>
  )
}

/** استرداد المفتاح من شاشة «تعذّر فتح بياناتك» — يُعاد التشغيل بعد النجاح */
export function DesktopKeyRecoveryImport() {
  const bridge = desktopKeyRecoveryBridge()
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  if (!bridge) return null

  const runImport = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const result = await bridge.import({ passphrase: pass })
      if (result.ok) {
        setMessage({ kind: 'ok', text: 'استُرد المفتاح — يُعاد تشغيل تَحَكَّم لفتح بياناتك…' })
      } else if (!result.canceled) {
        setMessage({ kind: 'err', text: result.reason ?? 'تعذّر الاسترداد' })
      }
    } catch (err) {
      setMessage({ kind: 'err', text: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-700">
      <div className="text-[12px] text-slate-600 dark:text-slate-300 leading-relaxed">
        إن كان المفتاح قد فُقد (إعادة تثبيت Windows أو جهاز جديد) فاسترده من ملف مفتاح الاسترداد الذي صدّرته سابقاً.
        المفتاح الحالي يُحفظ جانباً ولا يُحذف.
      </div>
      <label className="block text-[11px] font-bold text-slate-500">كلمة مرور ملف الاسترداد
        <input type="password" className={`${inputCls} mt-1`} value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="off" />
      </label>
      <Btn variant="ghost" className="w-full" disabled={busy || !pass.trim()} onClick={() => { void runImport() }}>
        <Upload size={15} /> {busy ? 'جارٍ الاسترداد…' : 'اختيار ملف مفتاح الاسترداد'}
      </Btn>
      {message && (
        <div className={`text-[12px] leading-relaxed ${message.kind === 'ok' ? 'text-emerald-600' : 'text-rose-600 dark:text-rose-400'}`}>{message.text}</div>
      )}
    </div>
  )
}
