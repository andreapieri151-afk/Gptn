import type { Plugin } from 'vite'

/**
 * Content Security Policy used by packaged builds (and by the browser preview).
 *
 * The renderer never talks to the network — every privileged operation goes
 * through IPC — so remote origins, eval and inline scripts are all forbidden.
 * `file:` is listed alongside `'self'` because the packaged window is loaded
 * from the file protocol, where the document origin is opaque.
 *
 * It is injected only when building: the dev server needs inline scripts for the
 * React refresh preamble, so development runs without a meta CSP.
 */
export const PRODUCTION_CSP = [
  "default-src 'none'",
  "script-src 'self' file:",
  "style-src 'self' 'unsafe-inline' file:",
  "img-src 'self' data: file:",
  "font-src 'self' file:",
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "form-action 'none'",
  "base-uri 'none'"
].join('; ')

export function productionCspPlugin(): Plugin {
  return {
    name: 'gptn:production-csp',
    apply: 'build',
    // head-prepend matters: a meta CSP only applies to the markup that follows it,
    // so the policy must come before the application bundle.
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: PRODUCTION_CSP },
          injectTo: 'head-prepend'
        }
      ]
    }
  }
}
