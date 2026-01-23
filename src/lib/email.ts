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

// 공통 이메일 템플릿 (Toss Blue Theme)
function getEmailTemplate(content: { title: string; greeting: string; message: string; buttonText: string; buttonUrl: string; footer: string; linkNote?: string }) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta name="color-scheme" content="dark">
      <meta name="supported-color-schemes" content="dark">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif; background-color: #0d1117; margin: 0; padding: 40px 20px;">
      <div style="max-width: 420px; margin: 0 auto;">
        <!-- Card -->
        <div style="background: linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 32px; position: relative; overflow: hidden;">
          <!-- Glow Effect -->
          <div style="position: absolute; top: -100px; right: -100px; width: 200px; height: 200px; background: radial-gradient(circle, rgba(49,130,246,0.15) 0%, transparent 70%); pointer-events: none;"></div>

          <!-- Logo -->
          <div style="text-align: center; margin-bottom: 28px;">
            <div style="display: inline-block; width: 44px; height: 44px; background: linear-gradient(135deg, rgba(49,130,246,0.2) 0%, rgba(69,147,252,0.2) 100%); border: 1px solid rgba(49,130,246,0.3); border-radius: 12px; margin-bottom: 12px; line-height: 44px;">
              <span style="color: #58a6ff; font-size: 20px;">☁</span>
            </div>
            <h1 style="color: #f0f6fc; font-size: 20px; font-weight: 600; margin: 0; letter-spacing: -0.02em;">Cloody</h1>
          </div>

          <!-- Title -->
          <h2 style="color: #f0f6fc; font-size: 18px; font-weight: 500; text-align: center; margin: 0 0 20px 0;">${content.title}</h2>

          <!-- Message -->
          <p style="color: #8b949e; font-size: 14px; line-height: 1.6; margin: 0 0 24px 0; text-align: center;">
            ${content.greeting}<br><br>
            ${content.message}
          </p>

          <!-- Button -->
          <a href="${content.buttonUrl}" style="display: block; width: 100%; padding: 14px 0; background: linear-gradient(135deg, #1b64da 0%, #3182f6 50%, #58a6ff 100%); color: white; text-align: center; text-decoration: none; border-radius: 10px; font-weight: 500; font-size: 14px; margin-bottom: 20px; box-shadow: 0 0 20px rgba(49,130,246,0.3);">
            ${content.buttonText}
          </a>

          <!-- Footer Note -->
          <p style="color: #6e7681; font-size: 12px; line-height: 1.5; margin: 0 0 16px 0; text-align: center;">
            ${content.footer}
          </p>

          <!-- Divider -->
          <hr style="border: none; border-top: 1px solid rgba(255,255,255,0.06); margin: 20px 0;">

          <!-- Link Fallback -->
          <p style="color: #6e7681; font-size: 11px; text-align: center; margin: 0; word-break: break-all;">
            ${content.linkNote || '버튼이 작동하지 않으면 아래 링크를 복사하세요:'}<br>
            <a href="${content.buttonUrl}" style="color: #58a6ff;">${content.buttonUrl}</a>
          </p>
        </div>

        <!-- Bottom Text -->
        <p style="color: #6e7681; font-size: 11px; text-align: center; margin-top: 24px;">
          Secure • Private • Simple
        </p>
      </div>
    </body>
    </html>
  `
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
      subject: 'Cloody 로그인',
      html: getEmailTemplate({
        title: '로그인 링크',
        greeting: `안녕하세요, <span style="color: #58a6ff;">${name}</span>님`,
        message: '아래 버튼을 클릭하여 Cloody에 로그인하세요.',
        buttonText: '로그인하기',
        buttonUrl: magicLink,
        footer: '이 링크는 <strong style="color: #a0a0b0;">15분</strong> 동안 유효합니다.<br>본인이 요청하지 않았다면 이 이메일을 무시하세요.',
      }),
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
      html: getEmailTemplate({
        title: '이메일 인증',
        greeting: `안녕하세요, <span style="color: #58a6ff;">${name}</span>님`,
        message: 'Cloody 가입을 환영합니다!<br>아래 버튼을 클릭하여 이메일을 인증해 주세요.',
        buttonText: '이메일 인증하기',
        buttonUrl: verifyLink,
        footer: '이 링크는 <strong style="color: #a0a0b0;">24시간</strong> 동안 유효합니다.<br>본인이 가입하지 않았다면 이 이메일을 무시하세요.',
      }),
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
      html: getEmailTemplate({
        title: '비밀번호 재설정',
        greeting: `안녕하세요, <span style="color: #58a6ff;">${name}</span>님`,
        message: '비밀번호 재설정 요청을 받았습니다.<br>아래 버튼을 클릭하여 새 비밀번호를 설정하세요.',
        buttonText: '비밀번호 재설정',
        buttonUrl: resetLink,
        footer: '이 링크는 <strong style="color: #a0a0b0;">1시간</strong> 동안 유효합니다.<br>본인이 요청하지 않았다면 이 이메일을 무시하세요.',
      }),
    })
    return true
  } catch (error) {
    console.error('Failed to send password reset email:', error)
    return false
  }
}
