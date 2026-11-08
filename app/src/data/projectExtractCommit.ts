import { useDataStore, useRawDataStore } from './repo.ts'
import { withInvoiceCommitLock } from './invoiceCommitLock.ts'

type Snapshot = Pick<ReturnType<typeof useDataStore.getState>, 'activeBranchId' | 'projects' | 'boqItems' | 'projectExtracts' | 'projectSurveys' | 'projectExtractDrafts' | 'clientAdvances' | 'changeOrders'>

/** أساس المعاينة كما عُرض، لا أساس يُؤخذ بعد انتظار القفل. */
export function projectExtractFingerprint(state: Snapshot, projectId: number): string {
  return JSON.stringify({
    branch: state.activeBranchId,
    project: state.projects.find(row => row.id === projectId),
    boq: state.boqItems.filter(row => row.projectId === projectId),
    extracts: state.projectExtracts.filter(row => row.projectId === projectId),
    surveys: state.projectSurveys.filter(row => row.projectId === projectId),
    drafts: state.projectExtractDrafts.filter(row => row.projectId === projectId),
    advances: state.clientAdvances.filter(row => row.projectId === projectId),
    changes: state.changeOrders.filter(row => row.projectId === projectId),
  })
}

/** التغيير المحلي حدث لكن تأكيد حفظه لم يكتمل؛ لا يجوز إعادة محاولة الترحيل تلقائياً. */
export class ProjectCommitUnconfirmedError<T> extends Error {
  readonly result: T
  constructor(result: T, cause: unknown) {
    super('نُفذ الترحيل محلياً لكن تعذر تأكيد الحفظ — راجع المستخلص والدفتر قبل أي محاولة أخرى', { cause })
    this.result = result
  }
}

export async function withProjectExtractCommit<T>(projectId: number, expectedFingerprint: string, commit: () => T): Promise<T> {
  let completed = false
  let result: T
  try {
    return await withInvoiceCommitLock(async () => { await useRawDataStore.persist.rehydrate() }, () => {
      if (projectExtractFingerprint(useDataStore.getState(), projectId) !== expectedFingerprint) throw new Error('تغير المشروع أو مستخلصاته أو دفعاته منذ المعاينة — راجع البيانات ثم أعد المحاولة')
      result = commit()
      completed = true
      return result
    })
  } catch (error) {
    if (completed) throw new ProjectCommitUnconfirmedError(result!, error)
    throw error
  }
}
