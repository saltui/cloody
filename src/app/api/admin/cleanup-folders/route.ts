import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { errorResponse } from '@/lib/response-utils'
import { ErrorCode } from '@/lib/errors'

// 의심스러운 폴더 패턴 (개발 관련 폴더들)
const SUSPICIOUS_PATTERNS = [
  /^\./, // .으로 시작하는 폴더 (.github, .vscode 등)
  /^node_modules$/i,
  /^__pycache__$/i,
  /^dist$/i,
  /^build$/i,
  /^\.next$/i,
  /^\.git$/i,
]

// 아이콘 라이브러리 폴더명들 (lucide 등)
const ICON_LIBRARY_FOLDERS = new Set([
  'abstract', 'accessibility', 'account', 'action', 'activity', 'add', 'address',
  'alert', 'alias', 'align', 'analytics', 'anchor', 'animate', 'annotation',
  'api', 'app', 'appearance', 'apple', 'application', 'archive', 'area',
  'arrow', 'arrows', 'article', 'aspect', 'asset', 'attach', 'attachment',
  'audio', 'auth', 'authentication', 'author', 'auto', 'avatar', 'award',
  'axis', 'baby', 'back', 'background', 'badge', 'bag', 'balance', 'ban',
  'band', 'bank', 'bar', 'base', 'baseline', 'basket', 'battery', 'bean',
  'bed', 'beer', 'bell', 'between', 'bicycle', 'bike', 'binary', 'bird',
  'bitcoin', 'blend', 'block', 'blog', 'bluetooth', 'board', 'body', 'bold',
  'bolt', 'bomb', 'bone', 'book', 'bookmark', 'boolean', 'boom', 'boot',
  'border', 'bot', 'both', 'bottle', 'bottom', 'bounce', 'box', 'brain',
  'branch', 'brand', 'bread', 'break', 'brick', 'bridge', 'briefcase', 'bring',
  'broadcast', 'browser', 'brush', 'bucket', 'budget', 'bug', 'build', 'building',
  'bulb', 'bullet', 'bus', 'business', 'button', 'cable', 'cache', 'cake',
  'calculator', 'calendar', 'call', 'camera', 'campaign', 'cancel', 'candy',
  'canvas', 'cap', 'caption', 'capture', 'car', 'card', 'care', 'carousel',
  'cart', 'case', 'cash', 'casino', 'cast', 'castle', 'cat', 'catalog',
  'category', 'caution', 'cell', 'center', 'chain', 'chair', 'challenge',
  'change', 'channel', 'chaos', 'chapter', 'character', 'charge', 'chart',
  'chat', 'check', 'checkbox', 'cheese', 'chef', 'chemical', 'cherry', 'chess',
])

export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id')

  if (!userId) {
    return errorResponse(ErrorCode.UNAUTHORIZED)
  }

  // Admin 권한 확인
  const { data: userData } = await supabase.from('users').select('is_admin').eq('id', userId).single()
  if (!userData?.is_admin) {
    return errorResponse(ErrorCode.FORBIDDEN, 'Admin access required')
  }

  try {
    // 해당 사용자의 모든 폴더 가져오기
    const { data: folders, error } = await supabase
      .from('folders')
      .select('id, name, created_at, parent_id')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })

    if (error) throw error

    // 의심스러운 폴더 필터링
    const suspiciousFolders = (folders || []).filter(folder => {
      const name = folder.name.toLowerCase()

      // 패턴 매칭
      if (SUSPICIOUS_PATTERNS.some(pattern => pattern.test(folder.name))) {
        return true
      }

      // 아이콘 라이브러리 폴더명
      if (ICON_LIBRARY_FOLDERS.has(name)) {
        return true
      }

      return false
    })

    return NextResponse.json({
      total: folders?.length || 0,
      suspicious: suspiciousFolders.length,
      folders: suspiciousFolders,
    })
  } catch (error) {
    console.error('Cleanup folders error:', error)
    return errorResponse(ErrorCode.INTERNAL_ERROR, 'Failed to fetch folders')
  }
}

// 의심스러운 폴더 삭제
export async function DELETE(request: NextRequest) {
  const userId = request.headers.get('x-user-id')

  if (!userId) {
    return errorResponse(ErrorCode.UNAUTHORIZED)
  }

  // Admin 권한 확인
  const { data: userData } = await supabase.from('users').select('is_admin').eq('id', userId).single()
  if (!userData?.is_admin) {
    return errorResponse(ErrorCode.FORBIDDEN, 'Admin access required')
  }

  try {
    const { folderIds } = await request.json()

    if (!folderIds || !Array.isArray(folderIds) || folderIds.length === 0) {
      return errorResponse(ErrorCode.INVALID_INPUT, 'folderIds is required')
    }

    // 해당 폴더들의 하위 폴더도 모두 찾기
    const allFolderIds = new Set<string>(folderIds)

    const findChildFolders = async (parentIds: string[]) => {
      const { data: children } = await supabase
        .from('folders')
        .select('id')
        .in('parent_id', parentIds)
        .eq('user_id', userId)

      if (children && children.length > 0) {
        const childIds = children.map(c => c.id)
        childIds.forEach(id => allFolderIds.add(id))
        await findChildFolders(childIds)
      }
    }

    await findChildFolders(folderIds)

    // 폴더 내 파일들 영구 삭제 (휴지통 거치지 않고)
    const { error: photosError } = await supabase
      .from('photos')
      .delete()
      .in('folder_id', Array.from(allFolderIds))
      .eq('user_id', userId)

    if (photosError) throw photosError

    // 폴더 영구 삭제
    const { error: foldersError } = await supabase
      .from('folders')
      .delete()
      .in('id', Array.from(allFolderIds))
      .eq('user_id', userId)

    if (foldersError) throw foldersError

    return NextResponse.json({
      success: true,
      deletedFolders: allFolderIds.size,
    })
  } catch (error) {
    console.error('Delete folders error:', error)
    return errorResponse(ErrorCode.INTERNAL_ERROR, 'Failed to delete folders')
  }
}
