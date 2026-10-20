/**
 * واجهة مندوب التوصيل المبسَّطة (سد فجوة مستقبلية #1 — النشاط #6: أجهزة
 * كهربائية): شاشة وحيدة الغرض تعرض لمندوب/فريق توصيل بعينه مهامه المعلَّقة
 * (مجدوَلة/جارٍ التنفيذ) المأخوذة من نفس `DeliveryJob` الذي تجدوله شاشة
 * التقارير، مع إمكانية بدء التنفيذ أو تأكيد التسليم بتوقيع رقمي — بإعادة
 * استخدام مكوّن `SignaturePad` نفسه من محرك الصيانة. لا تتبع موقع حي (يتطلب
 * بنية خارجية خارج نطاق تطبيق أوفلاين أحادي المنشأة).
 */
import { useMemo, useState } from 'react'
import { Truck, CheckCircle2, PlayCircle } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { SignaturePad } from '../components/SignaturePad.tsx'
import { Btn, Modal, inputCls, useToast, EmptyState } from '../components/ui.tsx'


export function DeliveryTasksPage() {
  const { deliveryJobs, sales, setDeliveryStatus, completeDeliveryWithSignature } = useDataStore()
  const toast = useToast()
  const [assignee, setAssignee] = useState('')
  const [signingId, setSigningId] = useState<number | null>(null)

  const myTasks = useMemo(
    () =>
      deliveryJobs
        .filter((j) => j.status !== 'done')
        .filter((j) => !assignee.trim() || (j.assignedTo ?? '').trim() === assignee.trim())
        .map((j) => ({ job: j, sale: sales.find((s) => s.id === j.saleId) }))
        .sort((a, b) => a.job.scheduledAt.localeCompare(b.job.scheduledAt)),
    [deliveryJobs, sales, assignee],
  )

  return (
    <div className="space-y-4 anim-up">
      <div className="flex items-center gap-2">
        <Truck className="text-brand-600" size={22} />
        <h1 className="text-lg font-black text-slate-800 dark:text-white">مهام التوصيل اليوم (مندوب/فريق)</h1>
      </div>
      <div className="max-w-xs">
        <label className="text-[11px] font-bold text-slate-500 block mb-1">اسمك (المندوب/الفريق)</label>
        <input value={assignee} onChange={(e) => setAssignee(e.target.value)} className={inputCls} placeholder="اتركه فارغاً لعرض كل المهام المعلَّقة" />
      </div>

      {myTasks.length === 0 ? (
        <EmptyState icon="🚚" title="لا مهام توصيل معلَّقة" sub="كل الطلبات المجدولة لك مكتملة، أو لم تُجدول مهام بعد من شاشة التقارير" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {myTasks.map(({ job, sale }) => (
            <div key={job.id} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2">
              <div className="font-black text-slate-800 dark:text-white">{sale?.invoiceNumber ?? `فاتورة #${job.saleId}`}</div>
              <div className="text-[12px] text-slate-500" dir="ltr">{job.scheduledAt}</div>
              {job.notes && <div className="text-[11px] text-slate-400">{job.notes}</div>}
              <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${job.status === 'scheduled' ? 'bg-sky-500/10 text-sky-600' : 'bg-amber-500/10 text-amber-600'}`}>
                {job.status === 'scheduled' ? 'مجدوَل' : 'جارٍ التنفيذ'}
              </span>
              <div className="flex items-center gap-2 pt-1">
                {job.status === 'scheduled' && (
                  <Btn variant="soft" onClick={() => setDeliveryStatus(job.id, 'in_progress')} className="text-[12px]">
                    <PlayCircle size={14} className="ml-1" /> بدء التنفيذ
                  </Btn>
                )}
                <Btn onClick={() => setSigningId(job.id)} className="text-[12px]">
                  <CheckCircle2 size={14} className="ml-1" /> تأكيد التسليم
                </Btn>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={signingId !== null} onClose={() => setSigningId(null)} title="توقيع العميل لتأكيد الاستلام">
        {signingId !== null && (
          <SignaturePad
            onCancel={() => setSigningId(null)}
            onSave={(dataUrl) => {
              try {
                completeDeliveryWithSignature(signingId, dataUrl)
                toast.show('تم تأكيد التسليم ✓')
                setSigningId(null)
              } catch (e) {
                toast.show((e as Error).message, 'error')
              }
            }}
          />
        )}
      </Modal>
    </div>
  )
}
