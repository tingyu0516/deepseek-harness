/** Parse an address-bar value into a previewable http(s) URL. */

export const BROWSER_PREVIEW_PLACEHOLDER = 'http://127.0.0.1:3000'

/** iframe sandbox flags that keep preview pages scriptable without a webview tag. */
export const BROWSER_IFRAME_SANDBOX = [
  'allow-scripts',
  'allow-forms',
  'allow-same-origin',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
].join(' ')

const HAS_HTTP_SCHEME = /^https?:\/\//iu
const HAS_OTHER_AUTHORITY_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//u
const BLOCKED_SCHEME = /^(javascript|data|blob|vbscript|mailto|about|file|ftp|ws|wss):/iu

function previewCandidate(input: string): string | undefined {
  if (HAS_HTTP_SCHEME.test(input)) return input
  if (HAS_OTHER_AUTHORITY_SCHEME.test(input) || BLOCKED_SCHEME.test(input)) return undefined
  return `http://${input}`
}

/**
 * Accept only http(s) URLs. A missing scheme becomes http. Credentials, the
 * current renderer origin, and every other protocol are rejected.
 *
 * @param input - raw address-bar text
 * @param currentOrigin - renderer origin that must not be nested in the iframe
 * @returns a normalized href, or undefined when the value is not previewable
 */
export function parseBrowserPreviewUrl(input: string, currentOrigin?: string): string | undefined {
  const trimmed = input.trim()
  if (trimmed === '') return undefined
  const candidate = previewCandidate(trimmed)
  if (candidate === undefined) return undefined
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return undefined
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  if (url.username !== '' || url.password !== '') return undefined
  if (currentOrigin !== undefined && currentOrigin !== '') {
    try {
      if (url.origin === new URL(currentOrigin).origin) return undefined
    } catch {
      return undefined
    }
  }
  return url.href
}
