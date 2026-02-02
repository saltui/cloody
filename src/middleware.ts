import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { hasPermission, getUserSecurityLevel } from '@/lib/rbac'

const SESSION_TIMEOUT = 7 * 24 * 60 * 60 * 1000 // 7일

// 클라이언트 IP 가져오기 (Edge 호환)
function getClientIP(request: NextRequest): string {
  const forwardedFor = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-real-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]
    || '127.0.0.1'
  return forwardedFor.trim()
}

// 보안 헤더 추가
function addSecurityHeaders(response: NextResponse): NextResponse {
  // XSS 방지
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-XSS-Protection', '1; mode=block')

  // 클릭재킹 방지
  response.headers.set('X-Frame-Options', 'DENY')

  // HTTPS 강제 (프로덕션)
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }

  // Referrer 정책
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')

  // 권한 정책 (카메라, 마이크 등 차단)
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')

  // CSP (Content Security Policy)
  response.headers.set('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:", // Next.js 필요 + heic2any worker
    "worker-src 'self' blob:", // heic2any Web Worker 허용
    "style-src 'self' 'unsafe-inline'", // Tailwind 필요
    "img-src 'self' data: blob: http://localhost:* https://*.r2.dev https://*.supabase.co",
    "media-src 'self' blob: http://localhost:* https://*.r2.dev", // 비디오 썸네일 + R2/MinIO 미디어
    "font-src 'self' data:",
    // Web3 RPC 엔드포인트 추가
    "connect-src 'self' http://localhost:* https://*.supabase.co https://*.r2.dev https://*.r2.cloudflarestorage.com https://rpc.sepolia.org https://*.infura.io https://*.alchemy.com wss://*.walletconnect.com wss://*.walletconnect.org https://*.walletconnect.com https://*.walletconnect.org https://sepolia.basescan.org https://basescan.org https://sepolia.etherscan.io",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '))

  return response
}

// Edge에서 토큰 검증 (사용자 기반 세션)
interface TokenValidation {
  valid: boolean
  reason?: 'expired' | 'ip_mismatch' | 'session_timeout' | 'invalid'
  needsRefresh?: boolean
  userId?: string
  email?: string
  orgId?: string
}

function validateToken(token: string | undefined, currentIp: string): TokenValidation {
  if (!token) return { valid: false, reason: 'invalid' }

  try {
    const [payloadStr] = token.split('.')
    if (!payloadStr) return { valid: false, reason: 'invalid' }

    // Base64URL 디코딩
    const base64 = payloadStr.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - base64.length % 4) % 4)
    const payload = JSON.parse(atob(padded))

    // 만료 시간 확인
    if (typeof payload.expiresAt !== 'number') return { valid: false, reason: 'invalid' }
    if (Date.now() > payload.expiresAt) return { valid: false, reason: 'expired' }

    // IP 바인딩 확인 - 비활성화 (모바일 네트워크에서 IP 변경이 잦음)
    // if (payload.ip && payload.ip !== currentIp) {
    //   return { valid: false, reason: 'ip_mismatch' }
    // }

    // 세션 타임아웃 확인
    if (payload.lastActivity) {
      const timeSinceLastActivity = Date.now() - payload.lastActivity
      if (timeSinceLastActivity > SESSION_TIMEOUT) {
        return { valid: false, reason: 'session_timeout' }
      }
      // 5분마다 토큰 갱신 필요
      if (timeSinceLastActivity > 5 * 60 * 1000) {
        return { valid: true, needsRefresh: true, userId: payload.userId, email: payload.email }
      }
    }

    return { valid: true, userId: payload.userId, email: payload.email, orgId: payload.orgId }
  } catch {
    return { valid: false, reason: 'invalid' }
  }
}

// 공개 경로 확인
function isPublicPath(pathname: string): boolean {
  const publicPaths = [
    '/login',
    '/verify-email',
    '/magic-link',
    '/reset-password',
    '/share',  // 공유 페이지
  ]
  return publicPaths.some(path => pathname.startsWith(path))
}

export async function middleware(request: NextRequest) {
  const sessionCookie = request.cookies.get('gallery_session')
  const clientIp = getClientIP(request)
  const tokenValidation = validateToken(sessionCookie?.value, clientIp)
  const isAuthenticated = tokenValidation.valid

  const pathname = request.nextUrl.pathname
  const isAuthPage = isPublicPath(pathname) || pathname === '/'
  const isAuthApi = pathname.startsWith('/api/auth')
  const isSessionRefreshApi = pathname === '/api/session/refresh'
  const isShareApi = pathname.startsWith('/api/share/') && request.method === 'GET'
  const isImageApi = pathname.startsWith('/api/image/')  // 이미지 프록시는 공개
  const isApi = pathname.startsWith('/api/')

  // 패스키 인증 API (로그인 시 사용)
  const isPasskeyAuthApi = pathname === '/api/passkey/authenticate'

  // API 인증 경로는 통과
  if (isAuthApi || isSessionRefreshApi || isShareApi || isImageApi || isPasskeyAuthApi) {
    return addSecurityHeaders(NextResponse.next())
  }

  // 다른 API는 인증 필요
  if (isApi && !isAuthenticated) {
    const errorMessage = tokenValidation.reason === 'ip_mismatch'
      ? 'IP 주소가 변경되었습니다. 다시 로그인해주세요.'
      : tokenValidation.reason === 'session_timeout'
      ? '세션이 만료되었습니다. 다시 로그인해주세요.'
      : 'Unauthorized'
    return NextResponse.json({ error: errorMessage, reason: tokenValidation.reason }, { status: 401 })
  }

  // RBAC 권한 확인 (인증된 요청에만 적용)
  if (isAuthenticated && tokenValidation.userId && tokenValidation.orgId) {
    const userId = tokenValidation.userId
    const orgId = tokenValidation.orgId

    // 권한이 필요한 경로 매핑
    type PermissionRoute = {
      route: string
      permission: Parameters<typeof hasPermission>[2]
    }

    const permissionRoutes: PermissionRoute[] = [
      { route: '/api/audit', permission: 'audit:view' },
      { route: '/api/retention', permission: 'retention:manage' },
      { route: '/api/disposal', permission: 'retention:manage' },
      { route: '/api/admin', permission: 'user:manage' },
      { route: '/settings/roles', permission: 'role:manage' },
      { route: '/settings/audit', permission: 'audit:view' },
    ]

    // 경로별 권한 확인
    for (const { route, permission } of permissionRoutes) {
      if (pathname.startsWith(route)) {
        const allowed = await hasPermission(userId, orgId, permission)
        if (!allowed) {
          if (isApi) {
            return NextResponse.json(
              { error: 'Forbidden: Insufficient permissions', required: permission },
              { status: 403 }
            )
          } else {
            return NextResponse.redirect(new URL('/drive', request.url))
          }
        }
        break
      }
    }
  }

  // API 요청에 사용자 ID, org ID, security level 헤더 추가
  if (isApi && isAuthenticated && tokenValidation.userId) {
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set('x-user-id', tokenValidation.userId)
    if (tokenValidation.email) {
      requestHeaders.set('x-user-email', tokenValidation.email)
    }
    if (tokenValidation.orgId) {
      requestHeaders.set('x-org-id', tokenValidation.orgId)

      // Security level 조회 및 헤더 추가
      try {
        const securityLevel = await getUserSecurityLevel(tokenValidation.userId, tokenValidation.orgId)
        requestHeaders.set('x-security-level', String(securityLevel))
      } catch {
        // Security level 조회 실패 시 기본값 0 사용
        requestHeaders.set('x-security-level', '0')
      }
    }

    const response = NextResponse.next({
      request: { headers: requestHeaders }
    })

    if (tokenValidation.needsRefresh) {
      response.headers.set('X-Session-Refresh', 'true')
    }

    return addSecurityHeaders(response)
  }

  // 로그인 안 된 상태에서 보호된 페이지 접근 시 로그인 페이지로
  if (!isAuthenticated && !isAuthPage) {
    const redirectUrl = new URL('/login', request.url)
    if (tokenValidation.reason) {
      redirectUrl.searchParams.set('reason', tokenValidation.reason)
    }
    return NextResponse.redirect(redirectUrl)
  }

  // 로그인 된 상태에서 로그인 페이지 접근 시 드라이브로
  if (isAuthenticated && (pathname === '/' || pathname === '/login')) {
    return NextResponse.redirect(new URL('/drive', request.url))
  }

  // 토큰 갱신 필요 시 헤더에 표시
  const response = addSecurityHeaders(NextResponse.next())
  if (tokenValidation.needsRefresh) {
    response.headers.set('X-Session-Refresh', 'true')
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.svg$|.*\\.png$|.*\\.ico$|.*\\.jpg$|.*\\.jpeg$|.*\\.webp$).*)'],
}
