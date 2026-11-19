import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import type { ApprovalAction } from '../src/core/projectOps.ts'

/**
 * خطّافات طلب اعتماد المستندات: `markDocApprovalPosted` و`deleteDocApproval`
 * و`assertApproved`.
 *
 * هذه الأسطح أُضيفت على فرع موازٍ وعادت إلى الشجرة عند الدمج؛ وتركها بلا أي استدعاء
 * كان يعني أن بوابة «تغطية الأسطح» تحمرّ — والحل من الجذر هو اختبار حقيقي، لا استثناء
 * في البوابة. الاختبار يثبت أيضاً أن الحارس لا يستهلك موافقة قبل التنفيذ (وإلا صار
 * كل مستند ثانٍ يُرفض لأن الموافقة استُهلكت في الفحص).
 */

const original = useRawDataStore.getState()
const app = useAppStore.getState()
const S = () => useRawDataStore.getState()

beforeEach(() => {
  const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'contracting' as const, modules: ['contracting'] as never, allowNegativeTreasury: true }
  useAppStore.setState({ ...app, setup, companySetup: setup, fiscalYears: [] })
  useRawDataStore.setState({
    ...original,
    branches: [], activeBranchId: null, currentUserId: null,
    customers: [], projects: [], boqItems: [], projectSurveys: [], projectExtracts: [], projectCosts: [],
    clientAdvances: [], journal: [], approvalFlows: [], approvalRequests: [], changeOrders: [],
    subContracts: [], subCertificates: [], subAdvances: [], employees: [], items: [], warehouses: [],
    serials: [], batches: [], materialRequisitions: [], stockMoves: [], transfers: [], purchases: [],
    sales: [], saleReturns: [], purchaseReturns: [], productionOrders: [], processingOrders: [],
    docApprovals: [],
  } as never)
})

afterEach(() => {
  useRawDataStore.setState(original)
  useAppStore.setState(app)
})

describe('خطّافات اعتماد المستندات', () => {
  it('طلب اعتماد جديد يبدأ معلّقاً بلا مستند مرحّل', () => {
    const req = S().submitDocForApproval({
      kind: 'sale', title: 'فاتورة 1', partyName: 'عميل', amountMinor: 5000,
      payload: JSON.stringify({ draftId: 91 }), requestedBy: null, requestedByName: 'الكاشير',
    })
    expect(req.status).toBe('pending')
    expect(req.postedDocumentId).toBeNull()
    expect(S().docApprovals).toHaveLength(1)
  })

  it('markDocApprovalPosted يربط الطلب بمستنده ويرفض المعرّف المجهول وإعادة الربط', () => {
    const a = S().submitDocForApproval({
      kind: 'sale', title: 'أ', partyName: 'عميل', amountMinor: 1000,
      payload: JSON.stringify({ draftId: 1 }), requestedBy: null, requestedByName: 'ك',
    })
    const b = S().submitDocForApproval({
      kind: 'purchase', title: 'ب', partyName: 'مورد', amountMinor: 2000,
      payload: JSON.stringify({ draftId: 2 }), requestedBy: null, requestedByName: 'ك',
    })
    S().markDocApprovalPosted(a.id, 777)
    expect(S().docApprovals.find((row) => row.id === a.id)?.postedDocumentId).toBe(777)
    expect(S().docApprovals.find((row) => row.id === b.id)?.postedDocumentId).toBeNull()

    // العيب القديم: كتابة صامتة على طلب غير موجود / معرّف مستند فاسد
    expect(() => S().markDocApprovalPosted(9999, 5)).toThrow(/غير موجود/)
    expect(() => S().markDocApprovalPosted(a.id, 0)).toThrow(/غير صالح/)
    expect(() => S().markDocApprovalPosted(a.id, 1.5)).toThrow(/غير صالح/)
    // الربط مرة واحدة: لا يُنقل طلب من مستند إلى آخر بعد الترحيل
    expect(() => S().markDocApprovalPosted(a.id, 888)).toThrow(/مستند آخر/)
    expect(S().docApprovals.find((row) => row.id === a.id)?.postedDocumentId).toBe(777)
    // الاستدعاء المتطابق غير ضار (إعادة محاولة بعد انقطاع)
    expect(() => S().markDocApprovalPosted(a.id, 777)).not.toThrow()
  })

  it('deleteDocApproval يحذف المرفوض المعلّق فقط ويحمي المستند المرحّل', () => {
    const kept = S().submitDocForApproval({
      kind: 'sale', title: 'مرفوض', partyName: 'عميل', amountMinor: 1000,
      payload: JSON.stringify({ draftId: 1 }), requestedBy: null, requestedByName: 'ك',
    })
    const posted = S().submitDocForApproval({
      kind: 'sale', title: 'مرحّل', partyName: 'عميل', amountMinor: 1500,
      payload: JSON.stringify({ draftId: 2 }), requestedBy: null, requestedByName: 'ك',
    })
    S().markDocApprovalPosted(posted.id, 42)

    // معرّف مجهول: كان يُمرّ صامتاً بلا أثر
    expect(() => S().deleteDocApproval(4242)).toThrow(/غير موجود/)
    // مستند رُحّل: حذف طلبه يمحو أثر الاعتماد
    expect(() => S().deleteDocApproval(posted.id)).toThrow(/رُحّل/)
    expect(S().docApprovals.map((row) => row.id)).toEqual([kept.id, posted.id])

    S().deleteDocApproval(kept.id)
    expect(S().docApprovals.map((row) => row.id)).toEqual([posted.id])
    expect(S().docApprovals[0].postedDocumentId).toBe(42)
  })

  it('assertApproved يجد الموافقة المعتمدة ويستهلكها مرة واحدة فقط', () => {
    const action: ApprovalAction = 'project_extract'
    S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
    const project = S().addProject({ nameAr: 'مشروع', clientName: 'عميل', clientId: S().customers[0].id, contractValueMinor: 1000000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })

    S().setApprovalFlow(action, [{ roleAr: 'مدير', employeeId: null }], true)
    // مسار نشط بلا طلب معتمد ⇒ يرمي ولا يستهلك شيئاً
    expect(() => S().assertApproved(action, project.id, 'مستخلص')).toThrow(/اعتماد/)
    expect(S().approvalRequests).toHaveLength(0)

    const req = S().requestApproval(action, 'اعتماد', project.id)
    expect(() => S().assertApproved(action, project.id, 'مستخلص')).toThrow(/اعتماد/)
    S().decideApproval(req.id, 'approved', 'المالك')

    // الحارس يستهلك الموافقة نفسها (لا يتركها للتنفيذ) — لذلك يُستدعى مرة واحدة
    S().assertApproved(action, project.id, 'مستخلص')
    expect(S().approvalRequests.find((r) => r.id === req.id)?.consumedAt).toBeTruthy()
    // الاستهلاك مرة واحدة: الاستدعاء الثاني لا يجد موافقة حرة فيرتد
    expect(() => S().assertApproved(action, project.id, 'مستخلص')).toThrow(/اعتماد/)
  })

  it('الحد المالي للمسار يسمح بالمرور تحت العتبة دون موافقة', () => {
    const action: ApprovalAction = 'project_extract'
    S().addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
    const project = S().addProject({ nameAr: 'مشروع', clientName: 'عميل', clientId: S().customers[0].id, contractValueMinor: 100000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
    S().setApprovalFlow(action, [{ roleAr: 'مدير', employeeId: null }], true, 50000)
    expect(() => S().assertApproved(action, project.id, 'مستخلص صغير', 10000)).not.toThrow()
    expect(() => S().assertApproved(action, project.id, 'مستخلص كبير', 60000)).toThrow()
  })
})
