import { S3Client, PutObjectCommand, DeleteObjectCommand, DeleteObjectsCommand, ListObjectsV2Command, GetObjectCommand, HeadObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const R2_ENDPOINT = process.env.R2_ENDPOINT // MinIO or custom S3 endpoint
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID!
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY!
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME!

// Support both Cloudflare R2 and MinIO/S3-compatible storage
const endpoint = R2_ENDPOINT || `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`

export const r2Client = new S3Client({
  region: 'auto',
  endpoint,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: !!R2_ENDPOINT, // Required for MinIO
})

export const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL!
export const BUCKET_NAME = R2_BUCKET_NAME

export async function uploadToR2(fileName: string, file: Buffer, contentType: string) {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: fileName,
    Body: file,
    ContentType: contentType,
  })

  await r2Client.send(command)
  return `${R2_PUBLIC_URL}/${fileName}`
}

export async function deleteFromR2(fileName: string) {
  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: fileName,
  })

  await r2Client.send(command)
}

function removeQueryAndHash(value: string): string {
  return value.split(/[?#]/, 1)[0]
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function extractR2KeyFromUrl(urlOrKey: string | null | undefined): string | null {
  if (!urlOrKey) return null

  const value = urlOrKey.trim()
  if (!value) return null

  const normalizedPublicBase = R2_PUBLIC_URL ? R2_PUBLIC_URL.replace(/\/+$/, '') : ''
  if (normalizedPublicBase && value.startsWith(`${normalizedPublicBase}/`)) {
    const key = removeQueryAndHash(value.slice(normalizedPublicBase.length + 1)).replace(/^\/+/, '')
    return key ? safeDecodeURIComponent(key) : null
  }

  if (!value.startsWith('http://') && !value.startsWith('https://')) {
    const rawKey = removeQueryAndHash(value).replace(/^\/+/, '')
    return rawKey ? safeDecodeURIComponent(rawKey) : null
  }

  try {
    const parsed = new URL(value)
    let key = parsed.pathname.replace(/^\/+/, '')

    if (parsed.hostname.endsWith('.r2.cloudflarestorage.com')) {
      const bucketPrefix = `${BUCKET_NAME}/`
      if (key.startsWith(bucketPrefix)) {
        key = key.slice(bucketPrefix.length)
      }
    }

    key = removeQueryAndHash(key).replace(/^\/+/, '')
    return key ? safeDecodeURIComponent(key) : null
  } catch {
    const rawKey = removeQueryAndHash(value).replace(/^\/+/, '')
    return rawKey ? safeDecodeURIComponent(rawKey) : null
  }
}

interface DeleteManyResult {
  requestedCount: number
  deletedCount: number
  failedCount: number
  failedKeys: string[]
}

export async function deleteManyFromR2(fileNames: string[]): Promise<DeleteManyResult> {
  const uniqueKeys = Array.from(
    new Set(
      fileNames
        .map((key) => key.trim())
        .filter((key) => key.length > 0)
    )
  )

  if (uniqueKeys.length === 0) {
    return {
      requestedCount: 0,
      deletedCount: 0,
      failedCount: 0,
      failedKeys: [],
    }
  }

  const failedKeys: string[] = []
  let deletedCount = 0
  const BATCH_SIZE = 1000

  for (let i = 0; i < uniqueKeys.length; i += BATCH_SIZE) {
    const chunk = uniqueKeys.slice(i, i + BATCH_SIZE)

    try {
      const command = new DeleteObjectsCommand({
        Bucket: BUCKET_NAME,
        Delete: {
          Objects: chunk.map((Key) => ({ Key })),
        },
      })

      const response = await r2Client.send(command)
      deletedCount += response.Deleted?.length || 0

      if (response.Errors && response.Errors.length > 0) {
        for (const error of response.Errors) {
          if (error.Key) failedKeys.push(error.Key)
        }
      }
    } catch {
      failedKeys.push(...chunk)
    }
  }

  return {
    requestedCount: uniqueKeys.length,
    deletedCount,
    failedCount: failedKeys.length,
    failedKeys,
  }
}

export async function getStorageUsage(): Promise<number> {
  let totalSize = 0
  let continuationToken: string | undefined

  do {
    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      ContinuationToken: continuationToken,
    })

    const response = await r2Client.send(command)

    if (response.Contents) {
      for (const object of response.Contents) {
        totalSize += object.Size || 0
      }
    }

    continuationToken = response.NextContinuationToken
  } while (continuationToken)

  return totalSize
}

// Signed URL 생성 (1시간 유효)
export async function getSignedImageUrl(fileName: string, expiresIn = 3600): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: fileName,
  })

  return getSignedUrl(r2Client, command, { expiresIn })
}

// 객체 메타데이터 가져오기 (파일 크기, Content-Type 등)
export async function getObjectMetadata(fileName: string) {
  const command = new HeadObjectCommand({
    Bucket: BUCKET_NAME,
    Key: fileName,
  })

  return r2Client.send(command)
}

// Range 요청을 지원하는 객체 가져오기
export async function getObjectWithRange(fileName: string, range?: string) {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: fileName,
    Range: range,
  })

  return r2Client.send(command)
}

// 객체 복사
export async function copyObject(sourceKey: string, destinationKey: string) {
  const command = new CopyObjectCommand({
    Bucket: BUCKET_NAME,
    CopySource: `${BUCKET_NAME}/${sourceKey}`,
    Key: destinationKey,
  })

  await r2Client.send(command)
  return `${R2_PUBLIC_URL}/${destinationKey}`
}

// 업로드용 Presigned URL 생성 (15분 유효)
export async function getPresignedUploadUrl(
  fileName: string,
  contentType: string,
  expiresIn = 900
): Promise<{ uploadUrl: string; publicUrl: string }> {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: fileName,
    ContentType: contentType,
  })

  const uploadUrl = await getSignedUrl(r2Client, command, { expiresIn })
  const publicUrl = `${R2_PUBLIC_URL}/${fileName}`

  return { uploadUrl, publicUrl }
}
