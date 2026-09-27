export interface ReleaseEvidence { typecheck: boolean; testsPassed: number; testsFailed: number; build: boolean; lintErrors: number; integrity: boolean; backupRestore: boolean; fiscalRollover: boolean; reconciliationClose: boolean }
export interface ReleaseDecision { ready: boolean; blockers: string[] }
export function assessReleaseReadiness(e: ReleaseEvidence): ReleaseDecision {
 const blockers:string[]=[]
 if(!e.typecheck) blockers.push('فحص الأنواع فاشل')
 if(e.testsFailed>0||e.testsPassed<1) blockers.push('الاختبارات غير مكتملة')
 if(!e.build) blockers.push('بناء الإنتاج فاشل')
 if(e.lintErrors>0) blockers.push('توجد أخطاء lint')
 if(!e.integrity) blockers.push('فحص سلامة البيانات فاشل')
 if(!e.backupRestore) blockers.push('النسخ الاحتياطي والاستعادة غير مثبتين')
 if(!e.fiscalRollover) blockers.push('إقفال وفتح السنة الجديدة غير مثبت')
 if(!e.reconciliationClose) blockers.push('إقفال مطابقة المدفوعات غير مثبت')
 return {ready:blockers.length===0,blockers}
}
