import { supabase } from './supabase'

export type Permission =
  | 'document:read'
  | 'document:write'
  | 'document:delete'
  | 'document:share'
  | 'document:download'
  | 'document:print'
  | 'folder:create'
  | 'folder:delete'
  | 'user:manage'
  | 'role:manage'
  | 'audit:view'
  | 'retention:manage'
  | 'security:manage'

export interface Role {
  id: string
  orgId: string
  name: string
  permissions: Permission[]
}

// 사용자의 역할 조회
export async function getUserRole(userId: string, orgId: string): Promise<Role | null> {
  try {
    const { data, error } = await supabase
      .from('user_roles')
      .select('role_id, roles(id, org_id, name, permissions)')
      .eq('user_id', userId)
      .eq('roles.org_id', orgId)
      .single()

    if (error || !data) {
      return null
    }

    const role = data.roles as unknown as {
      id: string
      org_id: string
      name: string
      permissions: Permission[]
    }

    return {
      id: role.id,
      orgId: role.org_id,
      name: role.name,
      permissions: role.permissions || [],
    }
  } catch (error) {
    console.error('Get user role failed:', error)
    return null
  }
}

// 특정 권한 확인
export async function hasPermission(
  userId: string,
  orgId: string,
  permission: Permission
): Promise<boolean> {
  const role = await getUserRole(userId, orgId)
  if (!role) {
    return false
  }

  return role.permissions.includes(permission)
}

// 사용자의 보안 등급 조회
export async function getUserSecurityLevel(userId: string, orgId: string): Promise<number> {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('security_level')
      .eq('id', userId)
      .eq('org_id', orgId)
      .single()

    if (error || !data) {
      return 0 // 기본 보안 등급
    }

    return data.security_level || 0
  } catch (error) {
    console.error('Get user security level failed:', error)
    return 0
  }
}

// 문서 접근 가능 여부 확인
export async function canAccessDocument(
  userId: string,
  docSecurityLevel: number,
  orgId: string
): Promise<boolean> {
  const userSecurityLevel = await getUserSecurityLevel(userId, orgId)
  return userSecurityLevel >= docSecurityLevel
}

// 권한 확인 미들웨어 헬퍼 (권한 없으면 예외 발생)
export async function checkPermission(
  userId: string,
  orgId: string,
  permission: Permission
): Promise<void> {
  const allowed = await hasPermission(userId, orgId, permission)

  if (!allowed) {
    throw new Error(`Permission denied: ${permission}`)
  }
}
