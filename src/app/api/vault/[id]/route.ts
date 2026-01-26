import { NextRequest, NextResponse } from 'next/server'
import { getVaultDocument, processApproval } from '@/lib/vault'
import { supabase } from '@/lib/supabase'
import { verifyMessage } from 'viem'

function getClientIP(request: NextRequest): string {
  const forwardedFor = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-real-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]
    || '127.0.0.1'
  return forwardedFor.trim()
}

// GET: 문서 상세 조회
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = request.headers.get('x-user-id')
  const userEmail = request.headers.get('x-user-email')

  if (!userId || !userEmail) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  }

  const { id } = await params

  try {
    const document = await getVaultDocument(id)

    if (!document) {
      return NextResponse.json({ error: '문서를 찾을 수 없습니다.' }, { status: 404 })
    }

    // 접근 권한 확인: 소유자이거나 승인자
    const isOwner = document.owner_id === userId
    const isApprover = document.approvals?.some(
      a => a.approver_email.toLowerCase() === userEmail.toLowerCase()
    )

    if (!isOwner && !isApprover) {
      return NextResponse.json({ error: '접근 권한이 없습니다.' }, { status: 403 })
    }

    return NextResponse.json({ document, isOwner, isApprover })
  } catch (error) {
    console.error('Get vault document error:', error)
    return NextResponse.json({ error: '문서 조회에 실패했습니다.' }, { status: 500 })
  }
}

// POST: 승인/거절 처리 (지갑 서명 검증 포함)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = request.headers.get('x-user-id')
  const userEmail = request.headers.get('x-user-email')

  if (!userId || !userEmail) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  }

  const { id } = await params
  const ip = getClientIP(request)
  const userAgent = request.headers.get('user-agent') || undefined

  try {
    const { decision, comment, walletAddress, signature, signedMessage, timestamp } = await request.json()

    if (!decision || !['approved', 'rejected'].includes(decision)) {
      return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 })
    }

    // 지갑 서명 검증
    if (!walletAddress || !signature || !signedMessage) {
      return NextResponse.json({ error: '지갑 서명이 필요합니다.' }, { status: 400 })
    }

    // 사용자의 등록된 지갑 주소 확인
    const { data: user } = await supabase
      .from('users')
      .select('wallet_address')
      .eq('id', userId)
      .single()

    if (!user?.wallet_address) {
      return NextResponse.json({ error: '계정에 연결된 지갑이 없습니다.' }, { status: 400 })
    }

    if (user.wallet_address.toLowerCase() !== walletAddress.toLowerCase()) {
      return NextResponse.json({ error: '등록된 지갑과 다른 지갑입니다.' }, { status: 400 })
    }

    // 타임스탬프 검증 (10분 이내)
    const signatureAge = Date.now() - timestamp
    if (signatureAge > 10 * 60 * 1000) {
      return NextResponse.json({ error: '서명이 만료되었습니다. 다시 시도해주세요.' }, { status: 400 })
    }

    // 서명 검증
    try {
      const isValid = await verifyMessage({
        address: walletAddress as `0x${string}`,
        message: signedMessage,
        signature: signature as `0x${string}`,
      })

      if (!isValid) {
        return NextResponse.json({ error: '서명 검증에 실패했습니다.' }, { status: 400 })
      }
    } catch (verifyError) {
      console.error('Signature verification error:', verifyError)
      return NextResponse.json({ error: '서명 검증에 실패했습니다.' }, { status: 400 })
    }

    const result = await processApproval({
      documentId: id,
      approverEmail: userEmail,
      decision,
      comment,
      ipAddress: ip,
      userAgent,
      walletAddress,
      signature,
    })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      documentStatus: result.documentStatus,
    })
  } catch (error) {
    console.error('Process approval error:', error)
    return NextResponse.json({ error: '처리에 실패했습니다.' }, { status: 500 })
  }
}

// DELETE: 문서 삭제 (소유자만)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = request.headers.get('x-user-id')

  if (!userId) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  }

  const { id } = await params

  try {
    // 소유권 확인
    const { data: document } = await supabase
      .from('vault_documents')
      .select('owner_id')
      .eq('id', id)
      .single()

    if (!document) {
      return NextResponse.json({ error: '문서를 찾을 수 없습니다.' }, { status: 404 })
    }

    if (document.owner_id !== userId) {
      return NextResponse.json({ error: '삭제 권한이 없습니다.' }, { status: 403 })
    }

    // 승인 기록 삭제
    await supabase.from('vault_approvals').delete().eq('document_id', id)

    // 문서 삭제
    await supabase.from('vault_documents').delete().eq('id', id)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete vault document error:', error)
    return NextResponse.json({ error: '삭제에 실패했습니다.' }, { status: 500 })
  }
}
