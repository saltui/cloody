// 허용된 이메일 목록 (이 이메일만 가입/로그인 가능)
export const ALLOWED_EMAILS = new Set<string>([
  // @baerae.com 도메인만 허용
])

// 허용된 도메인 (이 도메인의 모든 이메일 가입 가능)
export const ALLOWED_DOMAINS = new Set([
  'baerae.com',
])

export function isEmailAllowed(email: string): boolean {
  const lowerEmail = email.toLowerCase()

  // 1. 개별 이메일 화이트리스트 확인
  if (ALLOWED_EMAILS.has(lowerEmail)) {
    return true
  }

  // 2. 도메인 화이트리스트 확인
  const domain = lowerEmail.split('@')[1]
  if (domain && ALLOWED_DOMAINS.has(domain)) {
    return true
  }

  return false
}
