import { PartyQuickPicker } from '../components/KeyboardPickers.tsx'
/**
 * وحدة تقارير المعدات (طلب المالك): نفس نمط مركز تقارير المقاولات —
 * لوحة الأسطول (ربحية كل معدة) · معدة بعينه (عقودها وتكاليفها وساعاتها
 * وذممها) · ذمم عملاء التأجير ومتابعة التحصيل — بتصدير CSV لكل جدول.
 * البطاقة نفسها من النواة الخالصة equipmentReportCard (قابلة للفحص ببوابة).
 */
import { useMemo, useState } from 'react'
import { FileSpreadsheet, BarChart3, Users, Tractor, Clock } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor } from '../../core/money.ts'
import { EQUIPMENT_COST_LABELS, usageHours, equipmentReportCard, type EquipmentCostKind } from '../../core/rentalMeter.ts'
import { toCsv } from '../../core/security.ts'
import { usePersistedSectionView } from '../components/SectionViewPreference.ts'
import { EmptyState } from '../components/ui.tsx'

const card = 'rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-700'

function downloadCsv(rows: readonly Record<string, unknown>[], filename: string) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function EquipmentReportsPage() {
  const { equipment, rentalContracts, equipmentCosts, operatorShifts, customers, getOpenClientInvoices } = useDataStore()
  const { setup } = useAppStore()
  const cur = useMemo(
    () => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' },
    [setup.countryCode],
  )
  const fmt = (m: number) => formatMinor(m, cur, false)
  const [tab, setTab] = usePersistedSectionView('equipment-reports', 'fleet', ['fleet', 'equipment', 'dues'] as const)
  const [equipmentId, setEquipmentId] = useState('')

  /** بطاقة التقرير الخالصة لكل معدة — من النواة مباشرة */
  const cards = useMemo(() => equipment.map((eq) => {
    const contracts = rentalContracts.filter((c) => c.equipmentId === eq.id)
    const costs = equipmentCosts.filter((c) => c.equipmentId === eq.id)
    const shiftHours = operatorShifts
      .filter((s) => s.equipmentId === eq.id && s.startReading != null && s.endReading != null)
      .reduce((a, s) => a + usageHours(s.startReading, s.endReading), 0)
    const report = equipmentReportCard({
      contracts: contracts.map((c) => ({
        days: c.days, status: c.status, extraMinor: c.extraMinor,
        rateType: c.rateType ?? 'daily', startReading: c.startReading, endReading: c.endReading,
        totals: { rentMinor: c.totals.rentMinor, depositMinor: c.totals.depositMinor },
      })),
      costs: costs.map((c) => ({ amountMinor: c.amountMinor })),
      shiftHours,
    })
    return { equipment: eq, report, contracts, costs }
  }), [equipment, rentalContracts, equipmentCosts, operatorShifts])

  /** المفتوح من عقود الإيجار لكل معدة: من دفتر التوزيع (docKey = rental:<id>) */
  const openByEquipment = useMemo(() => {
    const settled = new Map<string, number>()
    for (const c of rentalContracts) {
      if (c.customerId == null) continue
      for (const inv of getOpenClientInvoices(c.customerId)) {
        if (inv.docKey === `rental:${c.id}`) settled.set(`rental:${c.id}`, inv.settledMinor)
      }
    }
    return new Map(equipment.map((eq) => {
      const open = rentalContracts
        .filter((c) => c.equipmentId === eq.id && c.customerId != null)
        .reduce((sum, c) => {
          const due = c.totals.collectCreditMinor - (c.refundedMinor ?? 0)
          return sum + Math.max(0, due - (settled.get(`rental:${c.id}`) ?? 0))
        }, 0)
      return [eq.id, open]
    }))
  }, [equipment, rentalContracts, getOpenClientInvoices])

  const totals = useMemo(() => ({
    revenue: cards.reduce((a, r) => a + r.report.revenueMinor, 0),
    costs: cards.reduce((a, r) => a + r.report.costsMinor, 0),
    profit: cards.reduce((a, r) => a + r.report.profitMinor, 0),
    hours: cards.reduce((a, r) => a + r.report.hours, 0),
    deposits: cards.reduce((a, r) => a + r.report.depositsHeldMinor, 0),
    open: cards.reduce((a, r) => a + (openByEquipment.get(r.equipment.id) ?? 0), 0),
    active: cards.reduce((a, r) => a + r.report.activeContracts, 0),
  }), [cards, openByEquipment])

  /* ═══ تبويب: معدة بعينه ═══ */
  const selected = cards.find((r) => r.equipment.id === Number(equipmentId)) ?? null
  const selectedShifts = selected ? operatorShifts.filter((s) => s.equipmentId === selected.equipment.id) : []
  const selectedOpenDocs = selected
    ? rentalContracts
        .filter((c) => c.equipmentId === selected.equipment.id && c.customerId != null)
        .flatMap((c) => getOpenClientInvoices(c.customerId!).filter((inv) => inv.docKey === `rental:${c.id}` && inv.dueMinor - inv.settledMinor > 0))
    : []

  /* ═══ تبويب: ذمم عملاء التأجير ═══ */
  const renterDues = useMemo(() => {
    const byClient = new Map<number, { nameAr: string; contractsCount: number; revenueMinor: number; openMinor: number }>()
    for (const c of rentalContracts) {
      if (c.customerId == null) continue
      const row = byClient.get(c.customerId) ?? { nameAr: customers.find((x) => x.id === c.customerId)?.nameAr ?? '—', contractsCount: 0, revenueMinor: 0, openMinor: 0 }
      row.contractsCount += 1
      row.revenueMinor += c.totals.rentMinor + c.extraMinor
      byClient.set(c.customerId, row)
    }
    for (const [customerId, row] of byClient) {
      for (const inv of getOpenClientInvoices(customerId)) {
        if (inv.docKey.startsWith('rental:')) row.openMinor += inv.dueMinor - inv.settledMinor
      }
    }
    return [...byClient.entries()].map(([customerId, row]) => ({ customerId, ...row })).sort((a, b) => b.openMinor - a.openMinor)
  }, [rentalContracts, customers, getOpenClientInvoices])

  const kpi = (label: string, value: string, tone = 'text-slate-800 dark:text-slate-100') => (
    <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3 text-center"><div className="text-[10px] text-slate-400 font-bold">{label}</div><div className={`font-black text-[15px] ${tone}`}>{value}</div></div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-black flex items-center gap-2"><BarChart3 className="w-6 h-6 text-teal-500" /> وحدة تقارير المعدات</h1>
        <div className="flex gap-1.5">
          {([['fleet', 'لوحة الأسطول'], ['equipment', 'معدة بعينها'], ['dues', 'ذمم عملاء التأجير']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} className={`px-3 py-1.5 rounded-lg text-[12px] font-bold transition-all ${tab === id ? 'bg-teal-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>{label}</button>
          ))}
        </div>
      </div>

      {equipment.length === 0 ? (
        <EmptyState icon="🚜" title="لا معدات بعد" sub="أضف معداتك من قسم «المعدات» ثم أجرِ عقود الإيجار — كل التقارير تُبنى تلقائياً من القيود" />
      ) : (
        <>
          {/* ═══ KPIs إجمالية دائمة ═══ */}
          <div className="grid grid-cols-3 sm:grid-cols-7 gap-2">
            {kpi('إيراد الأسطول', fmt(totals.revenue))}
            {kpi('مصاريف التشغيل', fmt(totals.costs), 'text-rose-600')}
            {kpi('أرباح الأسطول', fmt(totals.profit), totals.profit >= 0 ? 'text-emerald-600' : 'text-rose-600')}
            {kpi('ساعات تشغيل', `${totals.hours}`, 'text-sky-600')}
            {kpi('عقود نشطة', `${totals.active}`, 'text-teal-600')}
            {kpi('تأمينات محتجزة', fmt(totals.deposits), 'text-amber-600')}
            {kpi('ذمم مفتوحة', fmt(totals.open), 'text-rose-600')}
          </div>

          {/* ═══ ① لوحة الأسطول ═══ */}
          {tab === 'fleet' && (
            <div className="anim-up space-y-3">
              <div className="flex justify-end">
                <button onClick={() => downloadCsv(cards.map((r) => ({
                  'المعدة': r.equipment.nameAr, 'الكود': r.equipment.code || '—',
                  'الإيراد': fmt(r.report.revenueMinor), 'مصاريف التشغيل': fmt(r.report.costsMinor),
                  'الربح': fmt(r.report.profitMinor), 'ساعات': r.report.hours,
                  'ربح الساعة': r.report.profitPerHourMinor != null ? fmt(r.report.profitPerHourMinor) : '—',
                  'عقود': r.report.contractsCount, 'نشطة': r.report.activeContracts,
                  'وحدات محجوزة': r.report.rentedUnits, 'تأمينات محتجزة': fmt(r.report.depositsHeldMinor),
                  'ذمم مفتوحة': fmt(openByEquipment.get(r.equipment.id) ?? 0),
                })), `تقرير-أسطول-المعدات-${new Date().toISOString().slice(0, 10)}.csv`)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[12px] font-bold hover:bg-emerald-700 transition-all"><FileSpreadsheet size={14} /> تصدير الأسطول CSV</button>
              </div>
              <div className={`${card} overflow-x-auto`}>
                <table className="w-full text-[12.5px]">
                  <thead className="bg-teal-500/10 text-teal-700 dark:text-teal-300">
                    <tr>{['المعدة', 'إيراد', 'مصاريف', 'ربح', 'ربح الساعة', 'ساعات', 'عقود (نشطة)', 'تأمينات محتجزة', 'ذمم مفتوحة'].map((h) => <th key={h} className="px-3 py-2.5 text-right font-bold whitespace-nowrap">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {cards.map(({ equipment: eq, report: r }) => (
                      <tr key={eq.id} className="border-t border-slate-100 dark:border-slate-800 hover:bg-teal-500/5 transition-colors">
                        <td className="px-3 py-2.5 font-black whitespace-nowrap"><Tractor size={13} className="inline ml-1 text-teal-500" /> {eq.nameAr}<span className="block text-[10.5px] font-bold text-slate-400">{eq.code || `#${eq.id}`}</span></td>
                        <td className="px-3 py-2.5 font-bold whitespace-nowrap">{fmt(r.revenueMinor)}</td>
                        <td className="px-3 py-2.5 text-rose-600 font-bold whitespace-nowrap">{fmt(r.costsMinor)}</td>
                        <td className={`px-3 py-2.5 font-black whitespace-nowrap ${r.profitMinor >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(r.profitMinor)}</td>
                        <td className="px-3 py-2.5 font-bold whitespace-nowrap text-sky-600">{r.profitPerHourMinor != null ? fmt(r.profitPerHourMinor) : '—'}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{r.hours}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{r.contractsCount} <span className="text-teal-600 font-bold">({r.activeContracts})</span></td>
                        <td className="px-3 py-2.5 text-amber-600 font-bold whitespace-nowrap">{fmt(r.depositsHeldMinor)}</td>
                        <td className="px-3 py-2.5 font-bold whitespace-nowrap">{openByEquipment.get(eq.id) ? <span className="text-rose-600">{fmt(openByEquipment.get(eq.id)!)}</span> : <span className="text-emerald-600">✓</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ═══ ② معدة بعينها ═══ */}
          {tab === 'equipment' && (
            <div className="anim-up space-y-3">
              <div className={`${card} p-4`}>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-64 flex-1"><PartyQuickPicker parties={equipment.map((eq) => ({ id: eq.id, nameAr: `${eq.code || `#${eq.id}`} — ${eq.nameAr}` }))} value={equipmentId ? Number(equipmentId) : 0} onChange={(id) => setEquipmentId(id ? String(id) : '')} cashLabel="اختر معدة" label="بحث المعدة" cashValue={0} /></div>
                  {selected && (
                    <button onClick={() => downloadCsv([
                      { 'البند': 'إيراد الإيجار + التجاوز', 'القيمة': fmt(selected.report.revenueMinor) },
                      { 'البند': 'مصاريف التشغيل', 'القيمة': fmt(selected.report.costsMinor) },
                      ...(Object.keys(EQUIPMENT_COST_LABELS) as EquipmentCostKind[]).map((k) => ({ 'البند': `مصاريف — ${EQUIPMENT_COST_LABELS[k]}`, 'القيمة': fmt(selected.costs.filter((c) => c.kind === k).reduce((a, c) => a + c.amountMinor, 0)) })),
                      { 'البند': 'الربح', 'القيمة': fmt(selected.report.profitMinor) },
                      { 'البند': 'ساعات التشغيل الموثقة', 'القيمة': selected.report.hours },
                      { 'البند': 'ربح الساعة', 'القيمة': selected.report.profitPerHourMinor != null ? fmt(selected.report.profitPerHourMinor) : '—' },
                      { 'البند': 'العقود (نشطة)', 'القيمة': `${selected.report.contractsCount} (${selected.report.activeContracts})` },
                      { 'البند': 'الوحدات المحجوزة', 'القيمة': selected.report.rentedUnits },
                      { 'البند': 'تأمينات محتجزة', 'القيمة': fmt(selected.report.depositsHeldMinor) },
                      { 'البند': 'ذمم مفتوحة', 'القيمة': fmt(openByEquipment.get(selected.equipment.id) ?? 0) },
                    ], `تقرير-${selected.equipment.code || `معدة-${selected.equipment.id}`}.csv`)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-[12px] font-bold hover:bg-emerald-700 transition-all"><FileSpreadsheet size={14} /> تصدير بطاقة المعدة</button>
                  )}
                </div>
              </div>

              {!selected ? (
                <EmptyState icon="🚜" title="اختر معدة" sub="بطاقة كاملة: الإيراد والمصاريف والربح وساعات التشغيل والعقود والتأمينات المحتجزة والذمم" />
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                    {kpi('الإيراد', fmt(selected.report.revenueMinor))}
                    {kpi('المصاريف', fmt(selected.report.costsMinor), 'text-rose-600')}
                    {kpi('الربح', fmt(selected.report.profitMinor), selected.report.profitMinor >= 0 ? 'text-emerald-600' : 'text-rose-600')}
                    {kpi('ربح الساعة', selected.report.profitPerHourMinor != null ? fmt(selected.report.profitPerHourMinor) : '—', 'text-sky-600')}
                    {kpi('ساعات موثقة', `${selected.report.hours}`, 'text-sky-600')}
                    {kpi('عقود (نشطة)', `${selected.report.contractsCount} (${selected.report.activeContracts})`, 'text-teal-600')}
                    {kpi('وحدات محجوزة', `${selected.report.rentedUnits}`)}
                    {kpi('تأمينات محتجزة', fmt(selected.report.depositsHeldMinor), 'text-amber-600')}
                    {kpi('ذمم مفتوحة', fmt(openByEquipment.get(selected.equipment.id) ?? 0), 'text-rose-600')}
                    {kpi('قراءة العدّاد', `${selected.equipment.meterReading}`)}
                  </div>

                  <div className="grid grid-cols-5 gap-1.5 text-center">
                    {(Object.keys(EQUIPMENT_COST_LABELS) as EquipmentCostKind[]).map((k) => (
                      <div key={k} className="rounded-xl bg-slate-500/5 p-2"><div className="text-[10px] text-slate-500">{EQUIPMENT_COST_LABELS[k]}</div><div className="font-bold text-[12px]">{fmt(selected.costs.filter((c) => c.kind === k).reduce((a, c) => a + c.amountMinor, 0))}</div></div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {selected.contracts.length > 0 && (
                      <div className={`${card} overflow-hidden`}>
                        <div className="px-4 py-2.5 text-[12px] font-black text-slate-500 border-b border-slate-100 dark:border-slate-800">العقود ({selected.contracts.length})</div>
                        <table className="w-full text-[12px]">
                          <tbody>
                            {[...selected.contracts].reverse().map((c) => (
                              <tr key={c.id} className="border-b border-slate-50 dark:border-slate-800/50">
                                <td className="px-3 py-2 font-bold">{c.contractNumber}</td>
                                <td className="px-3 py-2 text-slate-400 text-[11px]">{c.date.slice(0, 10)}</td>
                                <td className="px-3 py-2">{c.days} × {fmt(c.dailyRateMinor)}</td>
                                {c.extraMinor > 0 && <td className="px-3 py-2 text-violet-600">+{fmt(c.extraMinor)}</td>}
                                <td className={`px-3 py-2 font-bold text-left ${c.status === 'active' ? 'text-teal-600' : 'text-slate-400'}`}>{fmt(c.totals.grandMinor + c.extraMinor)}</td>
                                <td className="px-3 py-2 text-[10.5px]">{c.status === 'active' ? 'نشط' : 'مُقفل'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {selectedOpenDocs.length > 0 && (
                      <div className={`${card} overflow-hidden`}>
                        <div className="px-4 py-2.5 text-[12px] font-black text-slate-500 border-b border-slate-100 dark:border-slate-800">ذمم الإيجار المفتوحة — تُسدَّد من سند قبض/تحصيل العميل</div>
                        <table className="w-full text-[12px]">
                          <tbody>
                            {selectedOpenDocs.map((inv) => (
                              <tr key={inv.docKey} className="border-b border-slate-50 dark:border-slate-800/50">
                                <td className="px-3 py-2 font-bold">{inv.docLabel}</td>
                                <td className="px-3 py-2 text-slate-400 text-[11px]">{inv.date.slice(0, 10)}</td>
                                <td className="px-3 py-2 text-slate-500">محصّل {fmt(inv.settledMinor)}</td>
                                <td className="px-3 py-2 font-black text-rose-600 text-left">{fmt(inv.dueMinor - inv.settledMinor)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {selected.costs.length > 0 && (
                      <div className={`${card} overflow-hidden`}>
                        <div className="px-4 py-2.5 text-[12px] font-black text-slate-500 border-b border-slate-100 dark:border-slate-800">مصاريف التشغيل ({selected.costs.length})</div>
                        <table className="w-full text-[12px]">
                          <tbody>
                            {[...selected.costs].reverse().slice(0, 8).map((c) => (
                              <tr key={c.id} className="border-b border-slate-50 dark:border-slate-800/50">
                                <td className="px-3 py-2">{EQUIPMENT_COST_LABELS[c.kind]} — {c.description}</td>
                                <td className="px-3 py-2 text-slate-400 text-[11px]">{c.date.slice(0, 10)}</td>
                                <td className="px-3 py-2 font-bold text-rose-600 text-left">{fmt(c.amountMinor)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {selectedShifts.length > 0 && (
                      <div className={`${card} overflow-hidden`}>
                        <div className="px-4 py-2.5 text-[12px] font-black text-slate-500 border-b border-slate-100 dark:border-slate-800 flex items-center gap-1"><Clock size={13} /> وردانيات المشغلين ({selectedShifts.length})</div>
                        <table className="w-full text-[12px]">
                          <tbody>
                            {[...selectedShifts].reverse().slice(0, 8).map((s) => (
                              <tr key={s.id} className="border-b border-slate-50 dark:border-slate-800/50">
                                <td className="px-3 py-2 font-bold">{s.operatorName}</td>
                                <td className="px-3 py-2 text-slate-400 text-[11px]">{s.date.slice(0, 10)}</td>
                                <td className="px-3 py-2 text-slate-500">{s.startReading} ← {s.endReading}</td>
                                <td className="px-3 py-2 font-bold text-sky-600 text-left">{usageHours(s.startReading, s.endReading)} س</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ═══ ③ ذمم عملاء التأجير ═══ */}
          {tab === 'dues' && (
            <div className="anim-up space-y-3">
              <div className="text-[12px] text-slate-500">
                متابعة تحصيل الإيجار: لكل عميل — عقوده وإيراده وما زال مفتوحاً من مستحقاته (تُطفأ من سند القبض أو تحصيل العميل FIFO).
              </div>
              <div className="flex justify-end">
                <button onClick={() => downloadCsv(renterDues.map((row) => ({
                  'العميل': row.nameAr, 'العقود': row.contractsCount, 'الإيراد': fmt(row.revenueMinor), 'ذمم مفتوحة': fmt(row.openMinor),
                })), `ذمم-عملاء-التأجير-${new Date().toISOString().slice(0, 10)}.csv`)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[12px] font-bold hover:bg-emerald-700 transition-all"><FileSpreadsheet size={14} /> تصدير الذمم CSV</button>
              </div>
              <div className={`${card} overflow-x-auto`}>
                <table className="w-full text-[12.5px]">
                  <thead className="bg-rose-500/10 text-rose-700 dark:text-rose-300">
                    <tr>{['العميل', 'العقود', 'إيراد الإيجار', 'ذمم مفتوحة'].map((h, i) => <th key={i} className="px-3 py-2.5 text-right font-bold">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {renterDues.map((row) => (
                      <tr key={row.customerId} className="border-t border-slate-100 dark:border-slate-800 hover:bg-rose-500/5 transition-colors">
                        <td className="px-3 py-2.5 font-bold flex items-center gap-1.5"><Users size={13} className="text-slate-400" /> {row.nameAr}</td>
                        <td className="px-3 py-2.5">{row.contractsCount}</td>
                        <td className="px-3 py-2.5 font-bold text-teal-600">{fmt(row.revenueMinor)}</td>
                        <td className={`px-3 py-2.5 font-black ${row.openMinor > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{row.openMinor > 0 ? fmt(row.openMinor) : '✓ مسددة'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
