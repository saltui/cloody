import { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID!
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID!
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY!
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME!

export const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
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
