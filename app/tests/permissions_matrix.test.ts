import { describe, expect, it } from 'vitest'
import { CRUD_MATRIX, crudMatrixForModules, rolesWithOverrides } from '../src/core/permissions.ts'

describe('employee category CRUD matrix', () => {
  it('describes all CRUD columns and keeps unsupported operations explicit', () => {
    expect(CRUD_MATRIX.length).toBeGreaterThan(0)
    for (const row of CRUD_MATRIX) {
      expect(Object.keys(row.permissions).sort()).toEqual(['create', 'delete', 'read', 'update'])
    }
    expect(CRUD_MATRIX.find((row) => row.id === 'reports')?.permissions.delete).toEqual([])
    expect(CRUD_MATRIX.find((row) => row.id === 'inventory')?.permissions.delete).toEqual(['inv.item.delete'])
  })

  it('filters specialized rows by enabled activity modules', () => {
    expect(crudMatrixForModules([]).map((row) => row.id)).toEqual(['customers', 'employees', 'accounting', 'reports', 'settings'])
    expect(crudMatrixForModules(['logistics']).some((row) => row.id === 'fleet')).toBe(true)
    expect(crudMatrixForModules(['cars']).some((row) => row.id === 'fleet')).toBe(true)
  })

  it('keeps custom employee categories assignable through the existing role resolver', () => {
    const roles = rolesWithOverrides({ custom_1: ['inv.view'] }, [{ id: 'custom_1', nameAr: 'مشرف المخزن' }])
    expect(roles.find((role) => role.id === 'custom_1')).toMatchObject({ nameAr: 'مشرف المخزن', permissions: ['inv.view'], isSystem: false })
  })
})
