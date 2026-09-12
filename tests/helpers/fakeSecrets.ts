import type { SecretStore } from '@main/store/secrets'
import type { SecretsStatus } from '@shared/types'

/** In-memory stand-in for the Keychain-backed secret store. */
export function fakeSecrets(initialKey: string | null = 'test-key'): SecretStore {
  let key = initialKey
  const store = {
    encryptionAvailable: () => true,
    storageKind: () => 'keychain' as const,
    async getApiKey() {
      return key
    },
    async setApiKey(next: string) {
      key = next.trim() || null
    },
    async clearApiKey() {
      key = null
    },
    async status(): Promise<SecretsStatus> {
      return {
        hasApiKey: !!key,
        maskedKey: key ? `${key.slice(0, 4)}••••${key.slice(-4)}` : null,
        storage: 'keychain',
        encryptionAvailable: true
      }
    },
    get filePath() {
      return '/tmp/gptn-credentials.bin'
    }
  }
  return store as unknown as SecretStore
}
