import type { GptnApi } from '@shared/api'

declare global {
  interface Window {
    gptn: GptnApi
  }
}

export {}
