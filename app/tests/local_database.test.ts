import { describe, expect, it } from 'vitest'
import { MemoryLocalDatabase, migrateLocalSchema } from '../src/data/localDatabase.ts'
describe('قاعدة البيانات المحلية offline-first', () => {
 it('يثبت المعاملة الناجحة ويرجع الفاشلة كاملة', () => { let s:any={docs:[],journal:[],terminal:[]}; const db=new MemoryLocalDatabase(()=>s,v=>{s=v}); db.transaction(()=>{s.docs.push(1);s.journal.push(1);s.terminal.push(1)}); expect(s.docs).toEqual([1]); expect(()=>db.transaction(()=>{s.docs.push(2);throw new Error('قطع طاقة')})).toThrow(); expect(s.docs).toEqual([1]); expect(db.integrityCheck().ok).toBe(true) })
 it('ينسخ ويستعيد محلياً بلا شبكة',()=>{let s:any={balance:10};const db=new MemoryLocalDatabase(()=>s,v=>{s=v});const backup=db.snapshot();s.balance=0;db.restore(backup);expect(s.balance).toBe(10)})
 it('ينفذ migrations متسلسلة ويرفض الفجوة',()=>{const out=migrateLocalSchema({schemaVersion:1,x:1},2,[{from:1,to:2,migrate:s=>({...s,schemaVersion:2,x:2})}]);expect(out.x).toBe(2);expect(()=>migrateLocalSchema(out,3,[])).toThrow('مفقود')})
})
