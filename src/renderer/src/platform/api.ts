import type { GptnApi } from '@shared/api'
import { createPreviewBridge } from './webBridge'

/**
 * Single access point to the privileged API exposed by the preload script.
 * When the renderer runs in a plain browser (design preview) a clearly labelled
 * fallback bridge is used instead, and `isDesktop` stays false so the UI can
 * tell the user that Gemini is only reachable from the desktop app.
 */
export const isDesktop = typeof window !== 'undefined' && typeof window.gptn === 'object' && window.gptn !== null

export const api: GptnApi = isDesktop ? window.gptn : createPreviewBridge()
