/**
 * الأرصدة الافتتاحية — بوابة الانتقال للبرنامج بأرصدة قائمة (v1.0.4).
 *
 * المتجر المنتقل يثبّت: ديون العملاء والموردين، النقدية، سلف الموظفين،
 * **المخزون بالتقييم المادي (كمية × تكلفة وحدة — نمط QuickBooks/Odoo)**،
 * وأي حساب عام آخر بالشجرة — كل رصيد بقيد متوازن مقابل رأس المال 3101.
 *
 * نمط العالمية (Xero/Odoo/QuickBooks): لوحة التوازن تعرض الأصول الافتتاحية
 * مقابل الالتزامات ورأس المال المحتسب، و«إعلان رأس المال» يرحّل أي فرق
 * لأرباح مرحّلة 3102 — فلا تختلط الأرباح المتراكمة برأس المال المدفوع.
 */
import { useMemo, useState } from 'react'
import { Scale, Users, Truck, PiggyBank, HandCoins, CheckCircle2, Package, BookOpen, Landmark } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { useAppStore } from '../../stores/app.store.ts'
import { getCountry } from '../../core/countries.ts'
import { formatMinor, toMinor } from '../../core/money.ts'
import { openingKey, summarizeOpeningBalances, OPENING_COVERED_SYSTEM_KEYS, type OpeningKind } from '../../core/openingBalances.ts'
import { STANDARD_COA, accountNature } from '../../core/ledger.ts'
import { Btn, inputCls, useToast } from '../components/ui.tsx'

const TABS: { id: OpeningKind; nameAr: string; icon: typeof Users; hint: string }[] = [
  { id: 'customer', nameAr: 'العملاء', icon: Users, hint: 'المديونيات القائمة لك على العملاء قبل البرنامج — قيد: عملاء 1104 / رأس المال' },
  { id: 'supplier', nameAr: 'الموردون', icon: Truck, hint: 'الديون القائمة عليك للموردين — قيد: رأس المال / موردون 2101' },
  { id: 'treasury', nameAr: 'الخزائن والبنوك', icon: PiggyBank, hint: 'النقدية الفعلية بالأدراج والحسابات يوم البدء — قيد: الخزينة / رأس المال' },
  { id: 'employee_advance', nameAr: 'سلف الموظفين', icon: HandCoins, hint: 'سلف قائمة لم تُخصم بعد — قيد: سلف 1107 / رأس المال' },
  { id: 'item_stock', nameAr: 'المخزون الافتتاحي', icon: Package, hint: 'بضاعة أول المدة بالتقييم المادي: اختر الصنف ثم أدخل الكمية وتكلفة الوحدة — القيمة = كمية × تكلفة (تُثبَّت دفترياً بقيد 1103/3101 وفعلياً برصيد الصنف معاً، فلا يتباعد المخزون عن الدفتر أبداً). الخدمات لا تدخل هنا' },
  { id: 'account', nameAr: 'حسابات عامة', icon: BookOpen, hint: 'رصيد افتتاحي لأي حساب آخر بالشجرة (أصول ثابتة، مصاريف مترحلة، التزامات…): الاتجاه بطبيعة الحساب تلقائياً — حسابات العملاء/الموردون/السلف/الخزائن/المخزون لها تبويباتها المخصصة، ورأس المال 3101 هو الطرف المقابل لكل افتتاحي فلا يقبل رصيداً من هنا' },
]

export function OpeningBalancesPage() {
  const { customers, suppliers, employees, treasuries, items, journal, openingBalances, openingItems, openingDeclaredCapitalMinor, setOpeningBalance, setOpeningItemStock, declareOpeningCapital } = useDataStore()
  const { setup } = useAppStore()
  const toast = useToast()
  const cur = useMemo(() => (setup.countryCode && getCountry(setup.countryCode)?.currency) || { code: 'EGP', symbol: 'ج.م', decimals: 2 as const, name: '' }, [setup.countryCode])
  const fmt = (m: number) => formatMinor(m, cur, false)

  const [tab, setTab] = useState<OpeningKind>('customer')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [capitalDraft, setCapitalDraft] = useState('')
  const meta = TABS.find((t) => t.id === tab)!

  /* ═══ لوحة التوازن (نمط Xero/Odoo) ═══ */
  const natureByAccountCode = useMemo(
    () => Object.fromEntries(STANDARD_COA.map((a) => [a.code, accountNature(a.rootType)])),
    [],
  )
  const summary = useMemo(() => summarizeOpeningBalances(openingBalances, natureByAccountCode), [openingBalances, natureByAccountCode])
  /* رصيد 3101 الدفتري الحقيقي — يشمل ترحيلات إعلان رأس المال السابقة (3101↔3102)
     فيختلف عن «المحتسب من الافتتاحيات» بعد أول إعلان: هذا هو المعروض للمالك */
  const capitalLedgerMinor = useMemo(() => {
    let balance = 0
    for (const e of journal) for (const l of e.lines) if (l.accountCode === '3101') balance += l.credit - l.debit
    return balance
  }, [journal])

  const declareCapital = () => {
    const raw = capitalDraft.trim()
    if (!raw) return
    try {
      declareOpeningCapital(toMinor(raw, cur.decimals))
      setCapitalDraft('')
      toast.show(`أُعلن رأس المال — رصيد 3101 صار مطابقاً، وأي فرق عن المحتسب رُحِّل لأرباح مرحّلة 3102 ✓`)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  const rows = useMemo(() => {
    if (tab === 'customer') return customers.map((c) => ({ refId: c.id as string | number, nameAr: c.nameAr }))
    if (tab === 'supplier') return suppliers.map((s) => ({ refId: s.id as string | number, nameAr: s.nameAr }))
    if (tab === 'treasury') return treasuries.map((t) => ({ refId: t.code as string | number, nameAr: t.nameAr }))
    if (tab === 'account') {
      // كل حساب قابل للترحيل بلا نوع افتتاحي مخصص وبلا رأس المال (الطرف المقابل)
      return STANDARD_COA
        .filter((a) => a.isPostable && !(a.systemKey && OPENING_COVERED_SYSTEM_KEYS.has(a.systemKey)) && a.code !== '3101' && a.code !== '3102')
        .map((a) => ({
          refId: a.code as string | number,
          nameAr: `${a.code} — ${a.nameAr}`,
          natureAr: accountNature(a.rootType) === 'debit' ? 'مدين' : 'دائن',
        }))
    }
    if (tab === 'item_stock') {
      // التقييم المادي: الأصناف الفعلية فقط (بلا خدمات) — الكمية والتكلفة أساس الإدخال
      return items
        .filter((it) => it.isActive !== false && !it.isService)
        .map((it) => ({
          refId: it.id as string | number,
          nameAr: it.nameAr,
          currentQty: it.stockQty ?? 0,
          currentCost: it.costMinor ?? 0,
          detail: openingItems[it.id],
        }))
    }
    return employees.map((e) => ({ refId: e.id as string | number, nameAr: e.nameAr }))
  }, [tab, customers, suppliers, treasuries, employees, items, openingItems])

  const totalPosted = useMemo(
    () => rows.reduce((a, r) => a + (openingBalances[openingKey(tab, r.refId)] ?? 0), 0),
    [rows, openingBalances, tab],
  )

  const save = (refId: string | number, nameAr: string) => {
    const key = openingKey(tab, refId)
    const raw = drafts[key]
    if (raw == null || raw.trim() === '') return
    try {
      setOpeningBalance({ kind: tab, refId, amountMinor: toMinor(raw, cur.decimals), label: nameAr })
      setDrafts((d) => { const n = { ...d }; delete n[key]; return n })
      toast.show(`ثُبّت الرصيد الافتتاحي لـ«${nameAr}» بقيد متوازن مقابل رأس المال ✓`)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  /* تثبيت المخزون بالتقييم المادي: كمية × تكلفة وحدة */
  const saveItemStock = (itemId: number, nameAr: string) => {
    const qtyRaw = drafts[`qty:${itemId}`]?.trim()
    const costRaw = drafts[`cost:${itemId}`]?.trim()
    if (qtyRaw == null && costRaw == null) return
    try {
      const detail = openingItems[itemId]
      const qty = qtyRaw != null && qtyRaw !== '' ? Number(qtyRaw) : (detail?.qty ?? 0)
      const unitCostMinor = costRaw != null && costRaw !== '' ? toMinor(costRaw, cur.decimals) : (detail?.unitCostMinor ?? 0)
      if (!Number.isFinite(qty)) throw new Error('الكمية غير صحيحة')
      setOpeningItemStock({ itemId, qty, unitCostMinor })
      setDrafts((d) => { const n = { ...d }; delete n[`qty:${itemId}`]; delete n[`cost:${itemId}`]; return n })
      toast.show(`ثُبّت المخزون الافتتاحي لـ«${nameAr}»: ${qty} × ${fmt(unitCostMinor)} = ${fmt(Math.round(qty * unitCostMinor))} — الكمية والدفتر معاً ✓`)
    } catch (e) { toast.show((e as Error).message, 'error') }
  }

  return (
    <div className="space-y-4">
      <div className="anim-up flex items-start justify-between gap-4 flex-wrap">
        <p className="text-[12px] text-slate-400 max-w-xl leading-relaxed">
          <Scale size={14} className="inline -mt-0.5 ml-1" />
          لمن ينتقل للبرنامج بأرصدة قائمة: ثبّت كل رصيد بقيد متوازن مقابل <b>رأس المال 3101</b> فيبقى المركز المالي متزناً من أول يوم.
          التعديل لاحقاً يرحّل <b>قيد الفرق فقط</b> ولا يمس أي قيد قديم. المخزون يسجَّل <b>مادياً</b> (كمية × تكلفة) فيثبت الصنف والدفتر معاً.
        </p>
        <div className="rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 px-4 py-3 text-center">
          <div className="text-[10px] text-slate-400 font-bold">إجمالي المثبت — {meta.nameAr}</div>
          <div className="text-lg font-black text-brand-600">{fmt(totalPosted)} {cur.symbol}</div>
        </div>
      </div>

      {/* ═══ لوحة التوازن وإعلان رأس المال (نمط العالمية) ═══ */}
      <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 p-4" data-opening-balance-panel>
        <div className="flex items-center gap-2 mb-3">
          <Landmark size={16} className="text-amber-500" />
          <h2 className="font-black text-[13px]">توازن الميزانية الافتتاحية وإعلان رأس المال</h2>
          <span className="text-[10.5px] text-slate-400">نمط البرامج العالمية: الأصول مقابل الالتزامات، والفرق رأس مال — وأي فائض تعلنه يرحَّل لأرباح مرحّلة 3102</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
          <div className="rounded-xl bg-sky-500/[0.06] border border-sky-500/15 p-3">
            <div className="text-[10px] font-bold text-sky-600">أصول افتتاحية (مدين)</div>
            <div className="text-[15px] font-black text-sky-700 dark:text-sky-300">{fmt(summary.debitMinor)}</div>
          </div>
          <div className="rounded-xl bg-amber-500/[0.06] border border-amber-500/15 p-3">
            <div className="text-[10px] font-bold text-amber-600">التزامات افتتاحية (دائن)</div>
            <div className="text-[15px] font-black text-amber-700 dark:text-amber-300">{fmt(summary.creditMinor)}</div>
          </div>
          <div className="rounded-xl bg-emerald-500/[0.06] border border-emerald-500/15 p-3">
            <div className="text-[10px] font-bold text-emerald-600">رأس المال (رصيد 3101 الدفتري)</div>
            <div className="text-[15px] font-black text-emerald-700 dark:text-emerald-300">{fmt(capitalLedgerMinor)}</div>
          </div>
          <div className="rounded-xl bg-slate-500/[0.06] border border-slate-500/15 p-3">
            <div className="text-[10px] font-bold text-slate-500">رأس المال المعلن</div>
            <div className="text-[15px] font-black text-slate-700 dark:text-slate-200">
              {openingDeclaredCapitalMinor != null ? fmt(openingDeclaredCapitalMinor) : <span className="text-slate-300 dark:text-slate-600">—</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <input
            value={capitalDraft}
            onChange={(e) => setCapitalDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && declareCapital()}
            className={`${inputCls} !py-1.5 !text-[12px] w-44`}
            dir="ltr"
            placeholder={openingDeclaredCapitalMinor != null ? fmt(openingDeclaredCapitalMinor) : 'رأس المال المدفوع فعلاً…'}
            aria-label="رأس المال المعلن"
          />
          <Btn variant="soft" onClick={declareCapital} disabled={!capitalDraft.trim()}>إعلان رأس المال</Btn>
          <span className="text-[10.5px] text-slate-400">
            {openingDeclaredCapitalMinor == null
              ? 'اختياري: لو رأس مالك الحقيقي يختلف عن المحتسب، الفرق أرباح متراكمة يرحّلها الزر لـ3102 بقيد متوازن.'
              : capitalLedgerMinor !== openingDeclaredCapitalMinor
                ? `رصيد 3101 الحالي ${fmt(capitalLedgerMinor)} — أعد الإعلان ليطابق رأس مالك الحقيقي ويُرحَّل الفرق لـ3102`
                : 'رصيد 3101 مطابق لرأس المال المعلن ✓ — أصول افتتاحية ' + fmt(summary.debitMinor) + ' مقابل التزامات ' + fmt(summary.creditMinor)}
          </span>
        </div>
      </div>

      <div className="anim-up flex gap-1.5 flex-wrap">
        {TABS.map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[12px] font-bold border-2 transition-all duration-200 ${
                tab === t.id ? 'border-brand-500/60 bg-brand-500/10 text-brand-600' : 'border-slate-200 dark:border-slate-700 text-slate-400 hover:border-slate-300'
              }`}
            >
              <Icon size={14} /> {t.nameAr}
            </button>
          )
        })}
      </div>

      <p className="text-[11.5px] text-slate-400">{meta.hint}</p>

      <div className="anim-up rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-[12.5px]">لا سجلات — أضف {meta.nameAr} أولاً من شاشتهم</div>
        ) : tab === 'item_stock' ? (
          /* ═══ جدول التقييم المادي: كمية × تكلفة وحدة ═══ */
          <table className="w-full text-[12.5px]" data-opening-items-table>
            <thead>
              <tr className="text-right text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <th className="px-4 py-2.5">الصنف</th>
                <th className="px-4 py-2.5">الرصيد الحالي</th>
                <th className="px-4 py-2.5">الافتتاحي المثبّت</th>
                <th className="px-4 py-2.5 w-24">الكمية</th>
                <th className="px-4 py-2.5 w-32">تكلفة الوحدة ({cur.symbol})</th>
                <th className="px-4 py-2.5 w-32">القيمة = كمية × تكلفة</th>
                <th className="px-4 py-2.5 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const item = r as { refId: number; nameAr: string; currentQty: number; currentCost: number; detail?: { qty: number; unitCostMinor: number } }
                const qtyDraft = drafts[`qty:${item.refId}`]
                const costDraft = drafts[`cost:${item.refId}`]
                const qty = qtyDraft != null && qtyDraft !== '' ? Number(qtyDraft) : (item.detail?.qty ?? 0)
                const costMinor = costDraft != null && costDraft !== '' ? toMinor(costDraft, cur.decimals) : (item.detail?.unitCostMinor ?? 0)
                const computed = Number.isFinite(qty) ? Math.round(qty * costMinor) : 0
                return (
                  <tr key={String(item.refId)} data-opening-item-row={item.refId} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">{item.nameAr}</td>
                    <td className="px-4 py-2 text-slate-500" dir="ltr">{item.currentQty} × {fmt(item.currentCost)}</td>
                    <td className="px-4 py-2">
                      {item.detail ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600 font-bold"><CheckCircle2 size={13} /> {item.detail.qty} × {fmt(item.detail.unitCostMinor)} = {fmt(Math.round(item.detail.qty * item.detail.unitCostMinor))}</span>
                      ) : (
                        <span className="text-slate-300 dark:text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <input
                        value={qtyDraft ?? ''}
                        onChange={(e) => setDrafts((d) => ({ ...d, [`qty:${item.refId}`]: e.target.value }))}
                        onKeyDown={(e) => e.key === 'Enter' && saveItemStock(item.refId, item.nameAr)}
                        className={`${inputCls} !py-1.5 !text-[12px]`}
                        dir="ltr"
                        inputMode="decimal"
                        placeholder={String(item.detail?.qty ?? item.currentQty ?? 0)}
                        aria-label={`كمية ${item.nameAr}`}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        value={costDraft ?? ''}
                        onChange={(e) => setDrafts((d) => ({ ...d, [`cost:${item.refId}`]: e.target.value }))}
                        onKeyDown={(e) => e.key === 'Enter' && saveItemStock(item.refId, item.nameAr)}
                        className={`${inputCls} !py-1.5 !text-[12px]`}
                        dir="ltr"
                        inputMode="decimal"
                        placeholder={fmt(item.detail?.unitCostMinor ?? item.currentCost ?? 0)}
                        aria-label={`تكلفة وحدة ${item.nameAr}`}
                      />
                    </td>
                    <td className="px-4 py-2 font-black text-slate-700 dark:text-slate-200" dir="ltr">{fmt(computed)}</td>
                    <td className="px-4 py-2">
                      <Btn variant="soft" onClick={() => saveItemStock(item.refId, item.nameAr)} disabled={(qtyDraft == null || qtyDraft === '') && (costDraft == null || costDraft === '')}>تثبيت</Btn>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-right text-[10px] text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <th className="px-4 py-2.5">الاسم</th>
                <th className="px-4 py-2.5">الرصيد المثبت</th>
                <th className="px-4 py-2.5 w-44">رصيد جديد ({cur.symbol})</th>
                <th className="px-4 py-2.5 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const key = openingKey(tab, r.refId)
                const posted = openingBalances[key] ?? 0
                return (
                  <tr key={key} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">{r.nameAr}{(r as { natureAr?: string }).natureAr && <span className={`text-[10px] font-bold ${(r as { natureAr?: string }).natureAr === 'مدين' ? 'text-sky-600' : 'text-amber-600'}`}> ({(r as { natureAr?: string }).natureAr})</span>}</td>
                    <td className="px-4 py-2">
                      {posted > 0 ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600 font-bold"><CheckCircle2 size={13} /> {fmt(posted)}</span>
                      ) : (
                        <span className="text-slate-300 dark:text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <input
                        value={drafts[key] ?? ''}
                        onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                        onKeyDown={(e) => e.key === 'Enter' && save(r.refId, r.nameAr)}
                        className={`${inputCls} !py-1.5 !text-[12px]`}
                        dir="ltr"
                        placeholder={posted > 0 ? fmt(posted) : '0'}
                      />
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <Btn variant="soft" onClick={() => save(r.refId, r.nameAr)} disabled={!drafts[key]?.trim()}>تثبيت</Btn>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
