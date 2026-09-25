import {describe,expect,it} from 'vitest'
import {evaluateNasqFormula,exportNasqCsv,materializeNasqSheet,summarizeNasq,type NasqSheet} from '../src/core/nasq.ts'
const sheet:NasqSheet={nameAr:'ربحية',columns:[{key:'sales',labelAr:'المبيعات'},{key:'cost',labelAr:'التكلفة'},{key:'profit',labelAr:'الربح',formula:'[sales]-[cost]'}],rows:[{sales:100,cost:40},{sales:80,cost:50}]}
describe('نَسَق NASQ',()=>{it('يحسب الأعمدة المرئية',()=>expect(materializeNasqSheet(sheet).rows.map(r=>r.profit)).toEqual([60,30]));it('يلخص ويربط بالتصدير',()=>{expect(summarizeNasq(sheet,'profit')).toMatchObject({sum:90,average:45});expect(exportNasqCsv(sheet)).toContain('"الربح"')});it('يرفض الشيفرة والدوال غير الآمنة',()=>expect(()=>evaluateNasqFormula('globalThis.alert(1)',{})).toThrow('غير مسموح'))})
