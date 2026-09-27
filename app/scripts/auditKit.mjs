/**
 * auditKit.mjs — عدة التدقيق المحاسبي (المرحلة 0 من خطة التدقيق الشامل).
 *
 * توفّر:
 *   1) `freshCase(...)`  — متجر بيانات **نظيف تماماً** لكل حالة اختبار (نشاط + دولة + ضريبة + وحدات مطعَّمة)،
 *      بعزل حقيقي عبر استيراد نسخة مستقلة من repo.ts لكل حالة (query cache-busting).
 *   2) `checkInvariants(...)` — فاحص **الثوابت العشرة** (AGENTS.md §3.5) على حالة المتجر كاملة.
 *   3) `expectReject(...)` — إثبات الثابت العاشر: الرفض بنص عربي **بلا أي أثر جزئي** على الحالة.
 *
 * الاستعمال داخل أي سكربت verify_*.mjs:
 *   import { freshCase, assertInvariants, expectReject } from './auditKit.mjs'
 *   const c = await freshCase({ activityId: 'grocery' })
 *   ... عمليات ...
 *   assertInvariants('بعد البيع', c)
 *
 * ملاحظة إلزامية: استورد هذا الملف **قبل** أي استيراد لـrepo.ts — فهو الذي يركّب بدائل المتصفح.
 */

// ————————————————————————————————————————————————————————————————
// 0) بدائل المتصفح (localStorage/window) — تُركَّب مرة واحدة عند أول استيراد
// ————————————————————————————————————————————————————————————————
const mem = new Map()
if (!globalThis.localStorage) {
  globalThis.localStorage = {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
    clear: () => mem.clear(),
    key: (i) => [...mem.keys()][i] ?? null,
    get length() { return mem.size },
  }
}
if (!globalThis.window) {
  globalThis.window = { localStorage: globalThis.localStorage, addEventListener: () => {}, dispatchEvent: () => true }
}
if (!globalThis.navigator) globalThis.navigator = { onLine: true, language: 'ar' }

const url = (rel) => new URL(rel, import.meta.url).href

const { useAppStore } = await import(url('../src/stores/app.store.ts'))
const { STANDARD_COA } = await import(url('../src/core/ledger.ts'))
const { treasuryAccounts } = await import(url('../src/core/treasury.ts'))
const { ACTIVITY_TEMPLATES, ALL_MODULES, effectiveModules } = await import(url('../src/core/activities.ts'))

export { STANDARD_COA, ACTIVITY_TEMPLATES, ALL_MODULES, effectiveModules, useAppStore }

/** كل الأنشطة المعرّفة (29) */
export const ACTIVITY_IDS = ACTIVITY_TEMPLATES.map((a) => a.id)

let caseCounter = 0

/**
 * متجر نظيف لحالة تدقيق واحدة.
 * @returns {Promise<{id:number, activityId:string, modules:string[], st:Function, store:object, coa:object[], label:string}>}
 */
export async function freshCase({
  activityId = 'general',
  countryCode = 'EG',
  vatPercent = 14,
  taxInclusive = true,
  extraModules = [],
  allowNegativeTreasury = true,
  requireOpenShiftForSales = false,
  fiscalYears = [{ id: 1, nameAr: 'سنة 2026', startDate: '2026-01-01', endDate: '2026-12-31', status: 'open' }],
  plan = 'pro',
  seed = true,
} = {}) {
  const tpl = ACTIVITY_TEMPLATES.find((a) => a.id === activityId)
  if (!tpl) throw new Error(`نشاط غير معروف في عدة التدقيق: ${activityId}`)
  caseCounter += 1

  // حالة تطبيق نظيفة لهذه الحالة (app.store مشترك بطبيعته — نضبطه قبل تحميل repo)
  useAppStore.setState({
    setup: {
      ...useAppStore.getState().setup,
      done: true,
      countryCode,
      activityId,
      vatPercent,
      taxInclusive,
      allowNegativeTreasury,
      requireOpenShiftForSales,
      extraModules: [...extraModules],
    },
    license: { plan, extraModules: [...extraModules] },
    fiscalYears: fiscalYears.map((f) => ({ ...f })),
  })

  // متجر بيانات مستقل تماماً لهذه الحالة
  globalThis.localStorage.removeItem('shopsys-data')
  const mod = await import(url(`../src/data/repo.ts?auditCase=${caseCounter}`))
  const store = mod.useDataStore
  const st = () => store.getState()

  // تثبيت واقعي: نفس ما تفعله شاشة الإعداد بعد اختيار النشاط (تصنيف عام + مخزن رئيسي)
  if (seed !== false) store.getState().seed(tpl.features ?? [])

  const modules = effectiveModules(activityId, extraModules)
  return {
    id: caseCounter,
    activityId,
    label: `${tpl.nameAr} (${activityId})`,
    modules,
    st,
    store,
    get coa() { return fullCoaOf(st()) },
  }
}

/** شجرة الحسابات الفعلية لهذه الحالة: القياسية + الخزائن + الحسابات المخصصة */
export function fullCoaOf(state) {
  const custom = (state.customAccounts ?? []).map((a) => ({ ...a, isPostable: a.isPostable !== false }))
  return [...STANDARD_COA, ...treasuryAccounts(state.treasuries ?? []), ...custom]
}

/** رصيد حساب من دفتر اليومية (مدين − دائن) */
export function balanceOf(journal, code) {
  let bal = 0
  for (const e of journal) for (const l of e.lines) if (l.accountCode === code) bal += (l.debit || 0) - (l.credit || 0)
  return bal
}

/** مجموع أرصدة مجموعة حسابات ببادئة (مثل '11' أو '4') */
export function balanceOfPrefix(journal, prefix) {
  let bal = 0
  for (const e of journal) for (const l of e.lines) if (String(l.accountCode).startsWith(prefix)) bal += (l.debit || 0) - (l.credit || 0)
  return bal
}

const ROOT_OF = (code) => String(code)[0]

// ————————————————————————————————————————————————————————————————
// فاحص الثوابت العشرة
// ————————————————————————————————————————————————————————————————
/**
 * يفحص الثوابت العشرة على حالة المتجر.
 * @returns {{errors: string[], warnings: string[], stats: object}}
 */
export function checkInvariants(caseOrState, opts = {}) {
  const state = typeof caseOrState?.st === 'function' ? caseOrState.st() : caseOrState
  const errors = []
  const warnings = []
  const journal = state.journal ?? []
  const coa = fullCoaOf(state)
  const byCode = new Map(coa.map((a) => [a.code, a]))
  const inventoryOffsetMinor = opts.inventoryOffsetMinor ?? 0
  const allowNegativeTreasury = opts.allowNegativeTreasury ?? useAppStore.getState().setup?.allowNegativeTreasury ?? false

  // ——— ث1: التوازن المطلق ———
  for (const e of journal) {
    const d = e.lines.reduce((s, l) => s + (l.debit || 0), 0)
    const c = e.lines.reduce((s, l) => s + (l.credit || 0), 0)
    if (d !== c) errors.push(`ث1 قيد #${e.entryNumber} (${e.sourceType}) غير متزن: مدين ${d} ≠ دائن ${c}`)
    if (e.lines.filter((l) => (l.debit || 0) !== 0 || (l.credit || 0) !== 0).length < 2) {
      errors.push(`ث1 قيد #${e.entryNumber} (${e.sourceType}) بطرف واحد فقط`)
    }
  }

  // ——— ث2: نظافة السطر ———
  for (const e of journal) {
    const debited = new Set()
    const credited = new Set()
    for (const l of e.lines) {
      const dr = l.debit || 0
      const cr = l.credit || 0
      if (dr > 0 && cr > 0) errors.push(`ث2 قيد #${e.entryNumber}: سطر ${l.accountCode} مدين ودائن معاً`)
      if (dr < 0 || cr < 0) errors.push(`ث2 قيد #${e.entryNumber}: مبلغ سالب على ${l.accountCode} (${dr}/${cr})`)
      if (!Number.isInteger(dr) || !Number.isInteger(cr)) errors.push(`ث2 قيد #${e.entryNumber}: مبلغ كسري على ${l.accountCode} (${dr}/${cr})`)
      const acc = byCode.get(l.accountCode)
      if (!acc) errors.push(`ث2 قيد #${e.entryNumber}: حساب غير موجود في الشجرة (${l.accountCode})`)
      else if (acc.isPostable === false) errors.push(`ث2 قيد #${e.entryNumber}: ترحيل على حساب تجميعي (${l.accountCode})`)
      if (dr > 0) debited.add(l.accountCode)
      if (cr > 0) credited.add(l.accountCode)
    }
    for (const code of debited) {
      // مسموح في قيود التسوية المجمّعة (جرد/تصنيع) — تنبيه لا خطأ
      if (credited.has(code)) warnings.push(`ث2 قيد #${e.entryNumber} (${e.sourceType}): حساب ${code} مدين ودائن في القيد نفسه`)
    }
  }

  // ——— ث3: لا قيد يتيم (مصدر + سنة مفتوحة) ———
  const years = useAppStore.getState().fiscalYears ?? []
  for (const e of journal) {
    if (!e.sourceType) errors.push(`ث3 قيد #${e.entryNumber} بلا sourceType`)
    if (e.sourceId == null) warnings.push(`ث3 قيد #${e.entryNumber} (${e.sourceType}) بلا sourceId`)
    if (!e.date || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) errors.push(`ث3 قيد #${e.entryNumber} بتاريخ غير صالح (${e.date})`)
    else if (years.length) {
      // القيود التاريخية داخل السنة المقفلة مشروعة — هي التي أُقفلت.
      // المخالفة الحقيقية: قيد أُنشئ بعد لحظة الإقفال وحمل تاريخاً داخل السنة المقفلة (ترحيل بأثر رجعي).
      const closed = years.find((y) => y.status === 'closed' && e.date >= y.startDate && e.date <= y.endDate)
      if (closed) {
        const closingEntry = journal.find((x) => x.sourceType === 'year_closing' && x.date >= closed.startDate && x.date <= closed.endDate)
        const closedAt = closingEntry?.createdAt ?? null
        if (closedAt && e.sourceType !== 'year_closing' && (e.createdAt ?? '') > closedAt) {
          errors.push(`ث3 قيد #${e.entryNumber} (${e.sourceType}) رُحِّل بأثر رجعي داخل سنة مقفلة «${closed.nameAr}»`)
        }
      }
    }
    if (!e.createdBy) warnings.push(`ث3 قيد #${e.entryNumber} بلا منشئ (createdBy)`)
  }

  // ——— ث4: ترقيم متصل ———
  const numbers = journal.map((e) => e.entryNumber)
  const uniq = new Set(numbers)
  if (uniq.size !== numbers.length) errors.push(`ث4 أرقام قيود مكررة (${numbers.length - uniq.size} تكرار)`)
  const sorted = [...numbers].sort((a, b) => a - b)
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] !== i + 1) { errors.push(`ث4 فجوة في ترقيم القيود عند الرقم ${i + 1} (وجد ${sorted[i]})`); break }
  }
  for (const [coll, field] of [['sales', 'invoiceNumber'], ['purchases', 'invoiceNumber'], ['vouchers', 'voucherNumber']]) {
    const rows = state[coll] ?? []
    const nums = rows.map((r) => r[field]).filter(Boolean)
    if (new Set(nums).size !== nums.length) errors.push(`ث4 ترقيم مستندات مكرر في ${coll}.${field}`)
  }

  // ——— ث5: المخزون الدفتري = المقوَّم ———
  const items = state.items ?? []
  const valued = items.reduce((s, it) => s + Math.round((it.stockQty || 0) * (it.costMinor || 0)), 0)
  const book = balanceOf(journal, '1103')
  const tolerance = Math.max(items.length, 1)
  if (Math.abs(book - (valued - inventoryOffsetMinor)) > tolerance) {
    errors.push(`ث5 المخزون: دفتر 1103 = ${book} بينما التقييم = ${valued} (إزاحة افتتاحية ${inventoryOffsetMinor})`)
  }

  // ——— ث6: معادلة الميزانية ———
  let assets = 0, liabilities = 0, equity = 0, revenue = 0, expenses = 0
  for (const e of journal) {
    for (const l of e.lines) {
      const net = (l.debit || 0) - (l.credit || 0)
      switch (ROOT_OF(l.accountCode)) {
        case '1': assets += net; break
        case '2': liabilities -= net; break
        case '3': equity -= net; break
        case '4': revenue -= net; break
        case '5': expenses += net; break
        default: warnings.push(`ث6 كود حساب خارج الجذور 1..5: ${l.accountCode}`)
      }
    }
  }
  if (assets !== liabilities + equity + (revenue - expenses)) {
    errors.push(`ث6 معادلة الميزانية مكسورة: أصول ${assets} ≠ خصوم ${liabilities} + ملكية ${equity} + (إيراد ${revenue} − مصروف ${expenses})`)
  }

  // ——— ث7: مطابقة الأطراف ———
  if (typeof state.getCustomerBalance === 'function') {
    const sumCustomers = (state.customers ?? []).reduce((s, c) => s + state.getCustomerBalance(c.id), 0)
    const book1104 = balanceOf(journal, '1104')
    if (sumCustomers !== book1104) errors.push(`ث7 العملاء: دفتر 1104 = ${book1104} بينما مجموع كشوف العملاء = ${sumCustomers}`)
  }
  if (typeof state.getSupplierBalance === 'function') {
    const sumSuppliers = (state.suppliers ?? []).reduce((s, v) => s + state.getSupplierBalance(v.id), 0)
    const book2101 = -balanceOf(journal, '2101')
    if (sumSuppliers !== book2101) errors.push(`ث7 الموردون: دفتر 2101 = ${book2101} بينما مجموع كشوف الموردين = ${sumSuppliers}`)
  }

  // ——— ث8: النقدية ———
  for (const t of state.treasuries ?? []) {
    const bal = balanceOf(journal, t.code)
    if (bal < 0 && !allowNegativeTreasury) errors.push(`ث8 رصيد سالب في «${t.nameAr}» (${t.code}) = ${bal} بلا تفعيل السماح`)
  }

  // ——— ث9: لا تعديل صامت ———
  const byId = new Map(journal.map((e) => [e.id, e]))
  for (const e of journal) {
    if (e.reversesEntryId != null) {
      const orig = byId.get(e.reversesEntryId)
      if (!orig) errors.push(`ث9 قيد عاكس #${e.entryNumber} يشير إلى قيد غير موجود (${e.reversesEntryId})`)
      else if (orig.reversedByEntryId !== e.id) errors.push(`ث9 القيد #${orig.entryNumber} لا يحمل إشارة عكسه (#${e.entryNumber})`)
    }
    if (e.reversedByEntryId != null && !byId.has(e.reversedByEntryId)) {
      errors.push(`ث9 القيد #${e.entryNumber} يشير إلى عاكس غير موجود (${e.reversedByEntryId})`)
    }
  }

  const stats = {
    entries: journal.length,
    lines: journal.reduce((s, e) => s + e.lines.length, 0),
    sourceTypes: [...new Set(journal.map((e) => e.sourceType))],
    accounts: [...new Set(journal.flatMap((e) => e.lines.map((l) => l.accountCode)))].sort(),
    totalDebit: journal.reduce((s, e) => s + e.lines.reduce((x, l) => x + (l.debit || 0), 0), 0),
  }
  return { errors, warnings, stats }
}

/** يرمي استثناءً عربياً مفصلاً إذا كُسر أي ثابت */
export function assertInvariants(label, caseOrState, opts = {}) {
  const { errors, warnings, stats } = checkInvariants(caseOrState, opts)
  if (errors.length) {
    throw new Error(`❌ ثوابت مكسورة عند «${label}»:\n  - ${errors.join('\n  - ')}`)
  }
  if (opts.strictWarnings && warnings.length) {
    throw new Error(`⚠️ تنبيهات ثوابت عند «${label}»:\n  - ${warnings.join('\n  - ')}`)
  }
  return stats
}

/** لقطة مختصرة للحالة — لمقارنة «لا أثر جزئي» بعد الرفض */
export function snapshot(c) {
  const s = typeof c?.st === 'function' ? c.st() : c
  return JSON.stringify({
    journal: (s.journal ?? []).length,
    lines: (s.journal ?? []).reduce((x, e) => x + e.lines.length, 0),
    sales: (s.sales ?? []).length,
    purchases: (s.purchases ?? []).length,
    vouchers: (s.vouchers ?? []).length,
    stock: (s.items ?? []).map((i) => [i.id, i.stockQty, i.costMinor]),
    cash: (s.treasuries ?? []).map((t) => [t.code, balanceOf(s.journal ?? [], t.code)]),
  })
}

/**
 * ث10 — الرفض الذري: العملية ترمي نصاً عربياً ولا تترك أي أثر جزئي.
 * @param {string} label وصف الحالة
 * @param {object} c حالة freshCase
 * @param {Function} fn العملية المتوقع رفضها
 * @param {RegExp} [pattern] نمط اختياري في نص الرسالة
 */
export function expectReject(label, c, fn, pattern) {
  const before = snapshot(c)
  let thrown = null
  try { fn() } catch (err) { thrown = err }
  if (!thrown) throw new Error(`ث10 «${label}»: العملية نجحت وكان يجب أن تُرفض`)
  const msg = String(thrown.message || thrown)
  if (!/[\u0600-\u06FF]/.test(msg)) throw new Error(`ث10 «${label}»: رسالة الرفض ليست عربية: ${msg}`)
  if (pattern && !pattern.test(msg)) throw new Error(`ث10 «${label}»: نص الرفض «${msg}» لا يطابق ${pattern}`)
  const after = snapshot(c)
  if (before !== after) throw new Error(`ث10 «${label}»: الرفض ترك أثراً جزئياً في الحالة\n  قبل: ${before}\n  بعد: ${after}`)
  return msg
}

// ————————————————————————————————————————————————————————————————
// أدوات بناء سريعة لحالات التدقيق (تقلل تكرار الكود في كل مرحلة)
// ————————————————————————————————————————————————————————————————
export function addSimpleItem(c, { nameAr, priceMinor, unit = 'قطعة', isService = false, extra = {} }) {
  c.st().addItem({
    nameAr, categoryId: null, unit, priceMinor, barcode: '', sku: '', isActive: true,
    trackExpiry: false, trackSerial: false, soldByWeight: false, isService,
    minSalePriceMinor: 0, costMinor: 0, stockQty: 0, ...extra,
  })
  const items = c.st().items
  return items[items.length - 1]
}

export function addParty(c, kind, nameAr) {
  if (kind === 'customer') {
    c.st().addCustomer({ nameAr, phone: '', taxNumber: '', address: '', notes: '', isActive: true, creditLimitMinor: 0 })
    const list = c.st().customers
    return list[list.length - 1]
  }
  c.st().addSupplier({ nameAr, phone: '', taxNumber: '', address: '', notes: '', isActive: true })
  const list = c.st().suppliers
  return list[list.length - 1]
}

/** طابع طباعة موحد لنتيجة بوابة */
export function reporter(title) {
  let pass = 0
  return {
    ok(msg) { pass++; console.log('  ✓', msg) },
    section(msg) { console.log(`\n${msg}`) },
    done(extra = '') {
      console.log(`\n✅ ${title}: ${pass} فحصاً ناجحاً ${extra}`.trim())
      return pass
    },
    get count() { return pass },
  }
}
