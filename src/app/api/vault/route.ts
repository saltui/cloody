import { NextRequest, NextResponse } from 'next/server'
import { createVaultDocument, getMyVaultDocuments, getEmailDomain, isSameDomain } from '@/lib/vault'
import { supabase } from '@/lib/supabase'

// GET: 내 Vault 문서 목록
export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id')
  const userEmail = request.headers.get('x-user-email')

  if (!userId || !userEmail) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  }

  try {
    const documents = await getMyVaultDocuments(userId, userEmail)
    return NextResponse.json({ documents })
  } catch (error) {
    console.error('Get vault documents error:', error)
    return NextResponse.json({ error: '문서 조회에 실패했습니다.' }, { status: 500 })
  }
}

// POST: 새 Vault 문서 생성
export async function POST(request: NextRequest) {
  const userId = request.headers.get('x-user-id')
  const userEmail = request.headers.get('x-user-email')

  if (!userId || !userEmail) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { fileId, title, description, requiredApprovals, approverEmails, restrictDomain, registerOnChain, fileHash } = body

    if (!fileId || !title || !approverEmails?.length) {
      return NextResponse.json({ error: '필수 항목이 누락되었습니다.' }, { status: 400 })
    }

    // 파일 존재 확인 및 소유권 확인
    const { data: file } = await supabase
      .from('photos')
      .select('id, user_id')
      .eq('id', fileId)
      .single()

    if (!file) {
      return NextResponse.json({ error: '파일을 찾을 수 없습니다.' }, { status: 404 })
    }

    if (file.user_id !== userId) {
      return NextResponse.json({ error: '파일에 대한 권한이 없습니다.' }, { status: 403 })
    }

    // 도메인 제한 확인
    const ownerDomain = getEmailDomain(userEmail)

    if (restrictDomain) {
      // 승인자들이 같은 도메인인지 확인
      for (const email of approverEmails) {
        if (!isSameDomain(userEmail, email)) {
          return NextResponse.json({
            error: `${email}은(는) 같은 조직(@${ownerDomain})이 아닙니다.`
          }, { status: 400 })
        }
      }
    }

    const { document, error } = await createVaultDocument({
      fileId,
      ownerId: userId,
      title,
      description,
      requiredApprovals: requiredApprovals || approverEmails.length,
      approverEmails,
      allowedDomain: restrictDomain ? ownerDomain : undefined,
      fileHash: registerOnChain ? fileHash : undefined,
    })

    if (error || !document) {
      return NextResponse.json({ error: error || '문서 생성에 실패했습니다.' }, { status: 500 })
    }

    // TODO: 승인자들에게 이메일 발송

    return NextResponse.json({ document })
  } catch (error) {
    console.error('Create vault document error:', error)
    return NextResponse.json({ error: '문서 생성에 실패했습니다.' }, { status: 500 })
  }
}
