/**
 * قسم «جهات التأمين والتعاقد» — مكوّن مشترك بين الأنشطة الطبية.
 * كان مدموجاً داخل `LabReferrersPage` حصراً فلا تصل إدارة الجهات ولا
 * تحصيل المطالبات لأي نشاط آخر لا يملك وحدة `lab` (سد فجوة النشاط #12:
 * العيادة تحتاج نفس القدرة لزياراتها المؤمَّنة عبر `registerInsuredVisit`).
 * مُستخرَج بلا أي تغيير سلوكي عن النسخة الأصلية في LabPages.tsx.
 */
import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import { Btn, Field, inputCls, Modal, useToast } from './ui.tsx'
import { type TerminalPaymentDraft } from './TerminalPaymentPicker.tsx'
import { PaymentMethodPicker } from './PaymentMethodPicker.tsx'
import { DocSectionHead, DocOutcome } from './DocSection.tsx'

function useCur() {
  const { setup } = useAppStore()
  return (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }
}

export function InsuranceProvidersSection() {
  const { insuranceProviders, insuranceClaims, paymentTerminals, addInsuranceProvider, toggleInsuranceProvider, getClaimBalance, settleInsuranceClaims } = useDataStore()
  const cur = useCur()
  const toast = useToast()
  const fmt = (m: number) => formatMinor(m, cur, false)

  const [insOpen, setInsOpen] = useState(false)
  const [insName, setInsName] = useState('')
  const [insPercent, setInsPercent] = useState('80')
  const [insPhone, setInsPhone] = useState('')
  const saveIns = () => {
    try {
      addInsuranceProvider({ nameAr: insName, coveragePercent: Number(insPercent) || 0, phone: insPhone.trim() })
      toast.show('أُضيفت الجهة — ستظهر كخيار تغطية ✅')
      setInsOpen(false); setInsName(''); setInsPercent('80'); setInsPhone('')
    } catch (e) { toast.show((e as Error).message, 'error') }
  }
  const [claimTreasury, setClaimTreasury] = useState('1101')
  const [claimTerminal, setClaimTerminal] = useState<TerminalPaymentDraft>({ terminalId: '', providerReference: '', cardLast4: '' })
  const doSettleClaims = (id: number, name: string) => {
    try {
      const terminal = paymentTerminals.find((row) => row.id === claimTerminal.terminalId)
      const r = settleInsuranceClaims(id, terminal?.settlementAccountCode ?? claimTreasury, terminal ? { terminalId: terminal.id, providerReference: claimTerminal.providerReference.trim(), cardLast4: claimTerminal.cardLast4 || undefined } : undefined)
      toast.show(`حُصلت مطالبات ${name}: ${fmt(r.total)} عن ${r.count} مطالبة ✅`); setClaimTerminal({ terminalId: '', providerReference: '', cardLast4: '' })
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between pt-2">
        <h2 className="font-black flex items-center gap-2">🏥 جهات التأمين والتعاقد</h2>
        <div className="flex items-center gap-2">
          {insuranceProviders.length > 0 && <div className="space-y-1"><PaymentMethodPicker value={{ treasury: claimTreasury, terminalPayment: claimTerminal }} onChange={(value) => { setClaimTreasury(value.treasury); setClaimTerminal(value.terminalPayment) }} operation="receipt" /></div>}
          <Btn variant="soft" onClick={() => setInsOpen(true)}><Plus className="w-4 h-4" /> جهة جديدة</Btn>
        </div>
      </div>
      {insuranceProviders.length === 0 ? (
        <div className="text-[12px] text-slate-400 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-4 text-center">
          أضف شركة تأمين أو جهة تعاقد بنسبة تحملها — المريض يدفع نصيبه فقط، ونصيب الجهة يتجمع كمطالبات تُحصَّل دفعة واحدة
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <table className="w-full text-sm">
            <tbody>
              {insuranceProviders.map((pv) => {
                const balance = getClaimBalance(pv.id)
                const count = insuranceClaims.filter((c) => c.providerId === pv.id && !c.settled).length
                return (
                  <tr key={pv.id} className={`border-t border-slate-100 dark:border-slate-800 ${!pv.isActive ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-2.5 font-bold">{pv.nameAr}</td>
                    <td className="px-4 py-2.5 text-[12px]">تتحمل {pv.coveragePercent}٪</td>
                    <td className="px-4 py-2.5 font-black text-violet-600 tabular-nums">{balance > 0 ? `${fmt(balance)} (${count} مطالبة)` : 'لا مطالبات'}</td>
                    <td className="px-4 py-2.5 text-left">
                      <div className="flex gap-1 justify-end">
                        {balance > 0 && <Btn variant="soft" onClick={() => doSettleClaims(pv.id, pv.nameAr)}>تحصيل الكل</Btn>}
                        <button onClick={() => toggleInsuranceProvider(pv.id)} className="text-[11px] font-bold text-slate-400 hover:text-amber-600 px-2">{pv.isActive ? 'تعطيل' : 'تفعيل'}</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={insOpen} onClose={() => setInsOpen(false)} title="جهة تأمين / تعاقد جديدة" subtitle="ملف تعاقد: نسبة تحمّل الجهة وما يدفعه المريض نقداً">
        <div className="space-y-3"><DocSectionHead step="١" title="الجهة ونسبة تحمّلها وشروط التحصيل" hint="حصة الجهة ذمة عليها لا نقدية في الخزينة" />
          <Field label="اسم الجهة *"><input value={insName} onChange={(e) => setInsName(e.target.value)} placeholder="شركة مصر للتأمين…" className={inputCls} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="نسبة التحمل ٪ *" hint="ما تتحمله الجهة من الفاتورة"><input value={insPercent} onChange={(e) => setInsPercent(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
            <Field label="هاتف"><input value={insPhone} onChange={(e) => setInsPhone(e.target.value)} className={inputCls} dir="ltr" /></Field>
          </div>
          <DocOutcome>الأثر: <b>لا قيد</b> عند التعاقد — ومع كل زيارة/طلب مؤمَّن يتوزع الإيراد: حصة المريض تحصيلاً نقدياً وحصة الجهة ذمةً على <b>1110 مطالبات تأمين</b> باسمها حتى التحصيل.</DocOutcome>
          <Btn onClick={saveIns} className="w-full" disabled={!insName.trim() || !insPercent}>إضافة الجهة</Btn>
        </div>
      </Modal>
    </div>
  )
}
