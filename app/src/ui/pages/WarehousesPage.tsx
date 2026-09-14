/** شاشة المخازن */
import { useState } from 'react'
import { Warehouse, Plus, Trash2, Star } from 'lucide-react'
import { useDataStore } from '../../data/repo.ts'
import { Btn, inputCls, useToast } from '../components/ui.tsx'

export function WarehousesPage() {
  const { warehouses, addWarehouse, removeWarehouse } = useDataStore()
  const toast = useToast()
  const [name, setName] = useState('')

  return (
    <div className="max-w-2xl space-y-4">
      <div className="anim-up flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) {
              addWarehouse(name.trim())
              toast.show(`تم إنشاء مخزن «${name.trim()}»`)
              setName('')
            }
          }}
          placeholder="اسم المخزن الجديد… ثم Enter"
          className={inputCls}
        />
        <Btn
          onClick={() => {
            if (name.trim()) {
              addWarehouse(name.trim())
              toast.show(`تم إنشاء مخزن «${name.trim()}»`)
              setName('')
            }
          }}
          disabled={!name.trim()}
        >
          <span className="flex items-center gap-1.5"><Plus size={15} /> إضافة</span>
        </Btn>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {warehouses.map((w, i) => (
          <div
            key={w.id}
            style={{ animationDelay: `${i * 60}ms` }}
            className="anim-up group flex items-center gap-3 p-4 rounded-2xl bg-white dark:bg-card-dark border border-slate-200 dark:border-slate-800 hover:border-amber-400/50 hover:shadow-lg transition-all duration-200"
          >
            <span className="w-11 h-11 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center transition-transform duration-200 group-hover:scale-110">
              <Warehouse size={20} />
            </span>
            <div className="flex-1">
              <div className="font-bold text-slate-800 dark:text-white flex items-center gap-1.5">
                {w.nameAr}
                {w.isMain && <Star size={13} className="text-amber-400 fill-amber-400" />}
              </div>
              <div className="text-[11px] text-slate-400">{w.isMain ? 'المخزن الرئيسي — لا يُحذف' : 'مخزن فرعي'}</div>
            </div>
            {!w.isMain && (
              <button
                onClick={() => {
                  try { removeWarehouse(w.id); toast.show('تم حذف المخزن') }
                  catch (err) { toast.show((err as Error).message, 'error') }
                }}
                className="p-2 rounded-lg text-slate-300 hover:text-rose-500 hover:bg-rose-500/10 transition-all duration-200 opacity-0 group-hover:opacity-100"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-400">💡 التحويلات بين المخازن والجرد بالباركود قادمة في المرحلة 3 فوق نفس هذه البيانات.</p>
    </div>
  )
}
