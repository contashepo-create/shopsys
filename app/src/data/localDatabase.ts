export interface LocalDatabase {
  transaction<T>(work: () => T): T
  snapshot(): string
  restore(snapshot: string): void
  integrityCheck(): { ok: boolean; message: string }
}
/** محاكي معاملات محلي مطابق لعقد SQLite/Electron؛ يُستخدم في الاختبارات والمتصفح حتى توصيل native adapter. */
export class MemoryLocalDatabase implements LocalDatabase {
  private readonly read: () => unknown
  private readonly write: (value: unknown) => void
  constructor(read: () => unknown, write: (value: unknown) => void) { this.read = read; this.write = write }
  transaction<T>(work: () => T): T {
    const before = this.snapshot()
    try { return work() } catch (error) { this.restore(before); throw error }
  }
  snapshot(): string { return JSON.stringify(this.read()) }
  restore(snapshot: string): void {
    let parsed: unknown
    try { parsed = JSON.parse(snapshot) } catch { throw new Error('النسخة الاحتياطية غير صالحة') }
    this.write(parsed)
  }
  integrityCheck() {
    try { JSON.parse(this.snapshot()); return { ok: true, message: 'قاعدة البيانات سليمة' } }
    catch { return { ok: false, message: 'تعذر تسلسل قاعدة البيانات المحلية' } }
  }
}
export interface SchemaMigration<T> { from: number; to: number; migrate: (state: T) => T }
export function migrateLocalSchema<T extends { schemaVersion: number }>(state: T, target: number, migrations: readonly SchemaMigration<T>[]): T {
  let current = structuredClone(state)
  while (current.schemaVersion < target) {
    const step = migrations.find(m => m.from === current.schemaVersion && m.to === current.schemaVersion + 1)
    if (!step) throw new Error(`ترحيل مفقود من الإصدار ${current.schemaVersion}`)
    current = step.migrate(current)
    if (current.schemaVersion !== step.to) throw new Error('الترحيل لم يحدّث إصدار المخطط')
  }
  return current
}
