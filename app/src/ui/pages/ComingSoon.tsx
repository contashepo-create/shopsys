import { Hammer } from 'lucide-react'

export function ComingSoon({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="anim-pop flex flex-col items-center justify-center py-24 text-center">
      <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-brand-500/15 to-fuchsia-500/15 flex items-center justify-center mb-5">
        <Hammer size={36} className="text-brand-500" />
      </div>
      <h2 className="text-xl font-extrabold text-slate-800 dark:text-white mb-2">{title}</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md leading-relaxed">
        هذه الشاشة قادمة في <b className="text-brand-600 dark:text-brand-400">{phase}</b> حسب خارطة طريق وثيقة التصميم — البناء يتم مرحلة فوق مرحلة على نفس النواة.
      </p>
    </div>
  )
}
