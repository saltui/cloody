// 허용된 이메일 목록 (이 이메일만 가입/로그인 가능)
export const ALLOWED_EMAILS = new Set([
  'jdnfree@icloud.com',
  'jongin715@naver.com',
  'salt@baerae.com',
])

export function isEmailAllowed(email: string): boolean {
  return ALLOWED_EMAILS.has(email.toLowerCase())
}
