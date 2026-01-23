import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const FROM_EMAIL = process.env.EMAIL_FROM || 'Cloody <noreply@cloody.app>'

// 이메일 전송 가능 여부 확인
export function isEmailConfigured(): boolean {
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS)
}

// Magic Link 이메일 전송
export async function sendMagicLinkEmail(
  email: string,
  token: string,
  displayName?: string | null
): Promise<boolean> {
  if (!isEmailConfigured()) {
    console.warn('Email not configured, skipping magic link email')
    return false
  }

  const magicLink = `${APP_URL}/magic-link?token=${token}`
  const name = displayName || email.split('@')[0]

  try {
    await transporter.sendMail({
      from: FROM_EMAIL,
      to: email,
      subject: 'Cloody 로그인 링크',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f9fafb; margin: 0; padding: 40px 20px;">
          <div style="max-width: 480px; margin: 0 auto; background: white; border-radius: 16px; padding: 40px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
            <div style="text-align: center; margin-bottom: 32px;">
              <div style="display: inline-block; width: 48px; height: 48px; background: linear-gradient(135deg, #7c3aed, #4f46e5); border-radius: 12px; margin-bottom: 16px;">
                <svg style="width: 28px; height: 28px; margin: 10px; color: white;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
                </svg>
              </div>
              <h1 style="color: #111827; font-size: 24px; font-weight: 700; margin: 0;">Cloody</h1>
            </div>

            <p style="color: #374151; font-size: 16px; line-height: 1.6; margin-bottom: 24px;">
              안녕하세요, <strong>${name}</strong>님!<br><br>
              아래 버튼을 클릭하여 Cloody에 로그인하세요.
            </p>

            <a href="${magicLink}" style="display: block; width: 100%; padding: 16px; background: linear-gradient(135deg, #7c3aed, #4f46e5); color: white; text-align: center; text-decoration: none; border-radius: 12px; font-weight: 600; font-size: 16px; margin-bottom: 24px;">
              로그인하기
            </a>

            <p style="color: #6b7280; font-size: 14px; line-height: 1.5; margin-bottom: 16px;">
              이 링크는 <strong>15분</strong> 동안만 유효합니다.<br>
              본인이 요청하지 않았다면 이 이메일을 무시하세요.
            </p>

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">

            <p style="color: #9ca3af; font-size: 12px; text-align: center;">
              버튼이 작동하지 않으면 아래 링크를 복사하여 브라우저에 붙여넣으세요:<br>
              <a href="${magicLink}" style="color: #7c3aed; word-break: break-all;">${magicLink}</a>
            </p>
          </div>
        </body>
        </html>
      `,
    })
    return true
  } catch (error) {
    console.error('Failed to send magic link email:', error)
    return false
  }
}

// 이메일 인증 이메일 전송
export async function sendVerificationEmail(
  email: string,
  token: string,
  displayName?: string | null
): Promise<boolean> {
  if (!isEmailConfigured()) {
    console.warn('Email not configured, skipping verification email')
    return false
  }

  const verifyLink = `${APP_URL}/verify-email?token=${token}`
  const name = displayName || email.split('@')[0]

  try {
    await transporter.sendMail({
      from: FROM_EMAIL,
      to: email,
      subject: 'Cloody 이메일 인증',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f9fafb; margin: 0; padding: 40px 20px;">
          <div style="max-width: 480px; margin: 0 auto; background: white; border-radius: 16px; padding: 40px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
            <div style="text-align: center; margin-bottom: 32px;">
              <div style="display: inline-block; width: 48px; height: 48px; background: linear-gradient(135deg, #7c3aed, #4f46e5); border-radius: 12px; margin-bottom: 16px;">
                <svg style="width: 28px; height: 28px; margin: 10px; color: white;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
                </svg>
              </div>
              <h1 style="color: #111827; font-size: 24px; font-weight: 700; margin: 0;">Cloody</h1>
            </div>

            <p style="color: #374151; font-size: 16px; line-height: 1.6; margin-bottom: 24px;">
              안녕하세요, <strong>${name}</strong>님!<br><br>
              Cloody 가입을 환영합니다. 아래 버튼을 클릭하여 이메일을 인증해 주세요.
            </p>

            <a href="${verifyLink}" style="display: block; width: 100%; padding: 16px; background: linear-gradient(135deg, #7c3aed, #4f46e5); color: white; text-align: center; text-decoration: none; border-radius: 12px; font-weight: 600; font-size: 16px; margin-bottom: 24px;">
              이메일 인증하기
            </a>

            <p style="color: #6b7280; font-size: 14px; line-height: 1.5; margin-bottom: 16px;">
              이 링크는 <strong>24시간</strong> 동안만 유효합니다.<br>
              본인이 가입하지 않았다면 이 이메일을 무시하세요.
            </p>

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">

            <p style="color: #9ca3af; font-size: 12px; text-align: center;">
              버튼이 작동하지 않으면 아래 링크를 복사하여 브라우저에 붙여넣으세요:<br>
              <a href="${verifyLink}" style="color: #7c3aed; word-break: break-all;">${verifyLink}</a>
            </p>
          </div>
        </body>
        </html>
      `,
    })
    return true
  } catch (error) {
    console.error('Failed to send verification email:', error)
    return false
  }
}

// 비밀번호 재설정 이메일 전송
export async function sendPasswordResetEmail(
  email: string,
  token: string,
  displayName?: string | null
): Promise<boolean> {
  if (!isEmailConfigured()) {
    console.warn('Email not configured, skipping password reset email')
    return false
  }

  const resetLink = `${APP_URL}/reset-password?token=${token}`
  const name = displayName || email.split('@')[0]

  try {
    await transporter.sendMail({
      from: FROM_EMAIL,
      to: email,
      subject: 'Cloody 비밀번호 재설정',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f9fafb; margin: 0; padding: 40px 20px;">
          <div style="max-width: 480px; margin: 0 auto; background: white; border-radius: 16px; padding: 40px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
            <div style="text-align: center; margin-bottom: 32px;">
              <div style="display: inline-block; width: 48px; height: 48px; background: linear-gradient(135deg, #7c3aed, #4f46e5); border-radius: 12px; margin-bottom: 16px;">
                <svg style="width: 28px; height: 28px; margin: 10px; color: white;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
                </svg>
              </div>
              <h1 style="color: #111827; font-size: 24px; font-weight: 700; margin: 0;">Cloody</h1>
            </div>

            <p style="color: #374151; font-size: 16px; line-height: 1.6; margin-bottom: 24px;">
              안녕하세요, <strong>${name}</strong>님!<br><br>
              비밀번호 재설정 요청을 받았습니다. 아래 버튼을 클릭하여 새 비밀번호를 설정하세요.
            </p>

            <a href="${resetLink}" style="display: block; width: 100%; padding: 16px; background: linear-gradient(135deg, #7c3aed, #4f46e5); color: white; text-align: center; text-decoration: none; border-radius: 12px; font-weight: 600; font-size: 16px; margin-bottom: 24px;">
              비밀번호 재설정
            </a>

            <p style="color: #6b7280; font-size: 14px; line-height: 1.5; margin-bottom: 16px;">
              이 링크는 <strong>1시간</strong> 동안만 유효합니다.<br>
              본인이 요청하지 않았다면 이 이메일을 무시하세요.
            </p>

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">

            <p style="color: #9ca3af; font-size: 12px; text-align: center;">
              버튼이 작동하지 않으면 아래 링크를 복사하여 브라우저에 붙여넣으세요:<br>
              <a href="${resetLink}" style="color: #7c3aed; word-break: break-all;">${resetLink}</a>
            </p>
          </div>
        </body>
        </html>
      `,
    })
    return true
  } catch (error) {
    console.error('Failed to send password reset email:', error)
    return false
  }
}
