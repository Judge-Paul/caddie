import { randomUUID } from 'node:crypto'

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'

export class StorageError extends Error {
  readonly status: 404 | 502 | 503

  constructor(message: string, status: 404 | 502 | 503 = 503) {
    super(message)
    this.name = 'StorageError'
    this.status = status
  }
}

type StorageConfig = {
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  endpoint: string
}

const globalStore = globalThis as typeof globalThis & {
  __caddieStorage?: { fingerprint: string; client: S3Client } | null
}

function config(): StorageConfig {
  const accountId = process.env.R2_ACCOUNT_ID?.trim()
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim()
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim()
  const bucket = process.env.R2_BUCKET?.trim()
  const endpoint =
    process.env.R2_ENDPOINT?.trim() ||
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '')

  if (!accessKeyId || !secretAccessKey || !bucket || !endpoint) {
    throw new StorageError(
      'Object storage is not configured. Add R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET to .env.local.',
      503,
    )
  }

  return { accessKeyId, secretAccessKey, bucket, endpoint }
}

export function storageConfigured() {
  try {
    config()
    return true
  } catch {
    return false
  }
}

function client(settings: StorageConfig) {
  const fingerprint = `${settings.endpoint}:${settings.bucket}:${settings.accessKeyId}`
  if (globalStore.__caddieStorage?.fingerprint === fingerprint) {
    return globalStore.__caddieStorage.client
  }

  const next = new S3Client({
    region: 'auto',
    endpoint: settings.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })
  globalStore.__caddieStorage = { fingerprint, client: next }
  return next
}

function failure(error: unknown, action: string): StorageError {
  if (error instanceof StorageError) return error
  const message = error instanceof Error ? error.message : ''
  console.error(`[storage] ${action} failed`, { message })
  return new StorageError(`Object storage could not ${action}. Try again.`, 502)
}

export async function putObject(
  key: string,
  body: Uint8Array,
  contentType: string,
) {
  const settings = config()
  try {
    await client(settings).send(
      new PutObjectCommand({
        Bucket: settings.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: 'private, no-store',
      }),
    )
  } catch (error) {
    throw failure(error, 'store that file')
  }
}

export async function getObject(key: string) {
  const settings = config()
  try {
    const response = await client(settings).send(
      new GetObjectCommand({
        Bucket: settings.bucket,
        Key: key,
      }),
    )
    if (!response.Body) {
      throw new StorageError('That file is empty.', 404)
    }
    return Buffer.from(await response.Body.transformToByteArray())
  } catch (error) {
    if (error instanceof StorageError) throw error
    const name = error instanceof Error ? error.name : ''
    if (name === 'NoSuchKey' || name === 'NotFound') {
      throw new StorageError('That file is not available.', 404)
    }
    throw failure(error, 'read that file')
  }
}

export async function copyObject(sourceKey: string, destinationKey: string) {
  const settings = config()
  try {
    await client(settings).send(
      new CopyObjectCommand({
        Bucket: settings.bucket,
        CopySource: `${settings.bucket}/${sourceKey}`,
        Key: destinationKey,
        MetadataDirective: 'COPY',
      }),
    )
  } catch (error) {
    throw failure(error, 'copy that file')
  }
}

export async function deleteObject(key: string) {
  let settings: StorageConfig
  try {
    settings = config()
  } catch {
    return
  }
  try {
    await client(settings).send(
      new DeleteObjectCommand({
        Bucket: settings.bucket,
        Key: key,
      }),
    )
  } catch (error) {
    console.error('[storage] delete failed', {
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

export function baseCvKey(userId: string, kind: 'docx' | 'pdf') {
  return `users/${userId}/base-cv/${randomUUID()}.${kind}`
}

export function applicationCvKey(
  userId: string,
  applicationId: string,
  kind: 'docx' | 'pdf',
) {
  return `users/${userId}/applications/${applicationId}/${randomUUID()}.${kind}`
}
