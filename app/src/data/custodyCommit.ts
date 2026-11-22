import type { useRawDataStore } from './repo.ts'

/** بصمة محافظة لما قد يؤثر في قرار حركة عهدة مباشرة؛ ليست قفلاً بحد ذاتها. */
export function custodyCommitFingerprint(state: ReturnType<typeof useRawDataStore.getState>, fileId: number): string {
  return JSON.stringify({
    // الصفر يمثل فتح ملف جديد، ورقم الملف التالي يعتمد على مجموعة الملفات كلها.
    file: fileId === 0 ? state.custodyFiles : state.custodyFiles.filter(row => row.id === fileId),
    transactions: state.custodyTxs.filter(row => row.fileId === fileId),
    journal: state.journal, employees: state.employees, projects: state.projects,
    treasuries: state.treasuries, branches: state.branches, activeBranchId: state.activeBranchId,
    currentUserId: state.currentUserId, loggedOut: state.loggedOut, appUsers: state.appUsers,
    roleOverrides: state.roleOverrides, branchRoleOverrides: state.branchRoleOverrides, customRoles: state.customRoles,
    customAccounts: state.customAccounts,
  })
}
