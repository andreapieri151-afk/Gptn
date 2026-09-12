import { constants as fsConstants } from 'node:fs'
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { safeStorage } from 'electron'
import type { SecretStorageKind, SecretsStatus } from '@shared/types'
import { AppError, ErrorCode } from '@shared/errors'

const FILE_NAME = 'credentials.bin'

export function maskApiKey(key: string): string {
  if (!key) return ''
  const visible = key.slice(-4)
  const head = key.slice(0, 4)
  return `${head}${'•'.repeat(Math.max(6, Math.min(12, key.length - 8)))}${visible}`
}

/**
 * Stores the Gemini API key with the strongest protection available on the host.
 *
 * macOS: `safeStorage` encrypts with a key held in the login Keychain
 * (Keychain item "GPTN Safe Storage"), so the secret is never written in clear text.
 * If encryption is unavailable the key is kept in memory only for the current
 * session and the UI tells the user that it will not be persisted.
 */
export class SecretStore {
  private readonly file: string
  private cache: string | null = null
  private cacheLoaded = false
  private memoryOnly: string | null = null

  constructor(userDataPath: string) {
    this.file = join(userDataPath, FILE_NAME)
  }

  encryptionAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  storageKind(): SecretStorageKind {
    return this.encryptionAvailable() ? 'keychain' : 'memory'
  }

  async setApiKey(rawKey: string): Promise<void> {
    const key = rawKey.trim()
    if (!key) {
      await this.clearApiKey()
      return
    }
    if (!this.encryptionAvailable()) {
      this.memoryOnly = key
      this.cache = key
      this.cacheLoaded = true
      return
    }
    try {
      const encrypted = safeStorage.encryptString(key)
      await mkdir(dirname(this.file), { recursive: true })
      await writeFile(this.file, encrypted, { mode: 0o600 })
      this.cache = key
      this.cacheLoaded = true
      this.memoryOnly = null
    } catch (error) {
      throw new AppError({
        code: ErrorCode.SECRET_STORAGE_UNAVAILABLE,
        title: 'Could not store the API key',
        message:
          'GPTN could not encrypt the API key with the macOS Keychain. The key was not saved — try again.',
        detail: (error as Error).message,
        retryable: true
      })
    }
  }

  async getApiKey(): Promise<string | null> {
    if (this.cacheLoaded) return this.cache ?? this.memoryOnly
    this.cacheLoaded = true
    if (!this.encryptionAvailable()) {
      this.cache = null
      return this.memoryOnly
    }
    try {
      await access(this.file, fsConstants.F_OK)
    } catch {
      this.cache = null
      return null
    }
    try {
      const buffer = await readFile(this.file)
      this.cache = safeStorage.decryptString(buffer)
      return this.cache
    } catch {
      // Corrupted or unreadable secret: treat as absent instead of crashing.
      this.cache = null
      return null
    }
  }

  async clearApiKey(): Promise<void> {
    this.cache = null
    this.cacheLoaded = true
    this.memoryOnly = null
    await rm(this.file, { force: true })
  }

  async status(): Promise<SecretsStatus> {
    const key = await this.getApiKey()
    return {
      hasApiKey: !!key,
      maskedKey: key ? maskApiKey(key) : null,
      storage: this.storageKind(),
      encryptionAvailable: this.encryptionAvailable()
    }
  }

  get filePath(): string {
    return this.file
  }
}
