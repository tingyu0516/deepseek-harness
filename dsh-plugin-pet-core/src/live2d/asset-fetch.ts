/** Intercept `fetch` so the official Cubism sample can load from the injected table. */

declare global {
  interface Window {
    __DSH_PET_LIVE2D_ASSETS?: Record<string, string>
    __DSH_PET_FETCH_HOOKED?: boolean
  }
}

function decodeBase64(data: string): ArrayBuffer {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

function normalizeUrl(url: string): string {
  const trimmed = url.split('?')[0] ?? url
  try {
    return decodeURIComponent(trimmed).replace(/\\/gu, '/')
  } catch {
    return trimmed.replace(/\\/gu, '/')
  }
}

/** Match a fetch URL against keys in the in-memory Live2D asset table. */
export function resolvePetAssetKey(url: string): string | undefined {
  const table = window.__DSH_PET_LIVE2D_ASSETS
  if (table === undefined) return undefined
  const path = normalizeUrl(url)
  if (Object.prototype.hasOwnProperty.call(table, path)) return path
  for (const key of Object.keys(table)) {
    if (path === key || path.endsWith(`/${key}`) || path.endsWith(key)) return key
  }
  const base = path.split('/').pop()
  if (base !== undefined && Object.prototype.hasOwnProperty.call(table, base)) return base
  return undefined
}

/** Replace `window.fetch` with a table lookup. Native fetch is never used. */
export function installPetAssetFetchHook(): void {
  if (window.__DSH_PET_FETCH_HOOKED) return
  window.__DSH_PET_FETCH_HOOKED = true
  window.fetch = (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url
    const key = resolvePetAssetKey(url)
    const table = window.__DSH_PET_LIVE2D_ASSETS
    if (key === undefined || table === undefined) {
      return Promise.reject(new Error(`live2d asset missing: ${url}`))
    }
    const body = decodeBase64(table[key] ?? '')
    return Promise.resolve(new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'application/octet-stream' },
    }))
  }
}
