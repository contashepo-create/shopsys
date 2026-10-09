import { saveRegistration, sanitizeRegistration } from '/home/user/shopsys/tools/devbot/src/registrations.js'
import { getNotificationsForDevice } from '/home/user/shopsys/tools/devbot/src/adminPanel.js'
const mem = () => { const m = new Map(); return { get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v) }, list: async ({ prefix }) => ({ keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name, metadata: null })), list_complete: true }) , _m: m } }
// (أ) كتابة فوق سجل موجود بلا توثيق
const kv = mem(); const cfg = { kv }
const dev = 'SHOP-ABCD-EFGH-JKLM'
const honest = sanitizeRegistration({ deviceId: dev, shopName: 'محل الأمانة', ownerName: 'أحمد', phone: '01012345678', email: 'a@x.com', plan: 'basic', activityId: 'retail' })
const first = await saveRegistration(cfg, honest)
const attacker = sanitizeRegistration({ deviceId: dev, shopName: 'محل مزيف', ownerName: 'مجهول', phone: '01000000000', email: 'evil@x.com', plan: 'trial', activityId: 'retail' })
const second = await saveRegistration(cfg, attacker)
console.log('A) isNew on overwrite =', second.isNew, '| stored shopName =', second.record.shopName, '| stored phone =', second.record.phone, '| firstSeenAt kept =', second.record.firstSeenAt === first.record.firstSeenAt)
// (ب) سقف 50 تنبيهاً: تنبيه حرج قديم يسقط؟
const kv2 = mem(); const cfg2 = { kv: kv2 }
const old = { id: 'CRIT-1', level: 'critical', title: 'تحديث أمني إلزامي', body: 'حدّث فوراً', createdAt: '2026-01-01T00:00:00Z', requiresAck: true }
const infos = Array.from({ length: 50 }, (_, i) => ({ id: 'INFO-' + i, level: 'info', body: 'إعلان ' + i, createdAt: `2026-02-${String((i % 28) + 1).padStart(2, '0')}T00:00:${String(i % 60).padStart(2, '0')}Z` }))
kv2._m.set('notices:global', JSON.stringify([old, ...infos]))
const got = await getNotificationsForDevice(cfg2, dev)
console.log('B) notices delivered =', got.length, '| critical CRIT-1 delivered =', got.some(n => n.id === 'CRIT-1'))
