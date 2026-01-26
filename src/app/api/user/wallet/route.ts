import { NextRequest, NextResponse } from 'next/server'
import { updateWalletAddress, findUserById, findUserByWalletAddress } from '@/lib/user-auth'
import { verifyMessage } from 'viem'

// GET: 현재 연결된 지갑 주소 조회
export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id')

  if (!userId) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  }

  try {
    const user = await findUserById(userId)
    if (!user) {
      return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 })
    }

    return NextResponse.json({
      wallet_address: user.wallet_address,
    })
  } catch {
    return NextResponse.json({ error: '요청 처리 중 오류가 발생했습니다.' }, { status: 500 })
  }
}

// POST: 지갑 연결 (서명 검증 포함)
export async function POST(request: NextRequest) {
  const userId = request.headers.get('x-user-id')

  if (!userId) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  }

  try {
    const { wallet_address, signature, message } = await request.json()

    if (!wallet_address || !signature || !message) {
      return NextResponse.json({ error: '필수 정보가 누락되었습니다.' }, { status: 400 })
    }

    // 서명 검증
    const isValid = await verifyMessage({
      address: wallet_address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    })

    if (!isValid) {
      return NextResponse.json({ error: '서명 검증에 실패했습니다.' }, { status: 400 })
    }

    // 이미 다른 계정에 연결된 지갑인지 확인
    const existingUser = await findUserByWalletAddress(wallet_address)
    if (existingUser && existingUser.id !== userId) {
      return NextResponse.json({ error: '이 지갑은 이미 다른 계정에 연결되어 있습니다.' }, { status: 409 })
    }

    // 지갑 주소 저장 (소문자로 정규화)
    const success = await updateWalletAddress(userId, wallet_address.toLowerCase())

    if (!success) {
      return NextResponse.json({ error: '지갑 연결에 실패했습니다.' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      wallet_address: wallet_address.toLowerCase(),
    })
  } catch (err) {
    console.error('Wallet connection error:', err)
    return NextResponse.json({ error: '요청 처리 중 오류가 발생했습니다.' }, { status: 500 })
  }
}

// DELETE: 지갑 연결 해제
export async function DELETE(request: NextRequest) {
  const userId = request.headers.get('x-user-id')

  if (!userId) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  }

  try {
    const success = await updateWalletAddress(userId, null)

    if (!success) {
      return NextResponse.json({ error: '지갑 연결 해제에 실패했습니다.' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: '요청 처리 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
