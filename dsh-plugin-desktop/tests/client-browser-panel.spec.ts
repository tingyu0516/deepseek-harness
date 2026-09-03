import { describe, expect, it } from 'vitest'
import { BROWSER_IFRAME_SANDBOX, parseBrowserPreviewUrl } from '../src/client/browser-preview-url.ts'

describe('browser preview URLs', () => {
  it('accepts http(s) and fills in a missing scheme', () => {
    expect(parseBrowserPreviewUrl('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000/')
    expect(parseBrowserPreviewUrl('https://example.com/app')).toBe('https://example.com/app')
    expect(parseBrowserPreviewUrl('127.0.0.1:5173')).toBe('http://127.0.0.1:5173/')
    expect(parseBrowserPreviewUrl('  localhost:8080/health  ')).toBe('http://localhost:8080/health')
  })

  it('rejects credentials, non-http schemes, and the current renderer origin', () => {
    expect(parseBrowserPreviewUrl('')).toBeUndefined()
    expect(parseBrowserPreviewUrl('javascript:alert(1)')).toBeUndefined()
    expect(parseBrowserPreviewUrl('file:///etc/passwd')).toBeUndefined()
    expect(parseBrowserPreviewUrl('ftp://example.com')).toBeUndefined()
    expect(parseBrowserPreviewUrl('data:text/html,hi')).toBeUndefined()
    expect(parseBrowserPreviewUrl('http://user:pass@127.0.0.1:3000')).toBeUndefined()
    expect(parseBrowserPreviewUrl('http://127.0.0.1:43120/session', 'http://127.0.0.1:43120')).toBeUndefined()
    expect(parseBrowserPreviewUrl('http://127.0.0.1:3000', 'http://127.0.0.1:43120')).toBe('http://127.0.0.1:3000/')
  })

  it('keeps the iframe sandbox flags scriptable without a webview tag', () => {
    expect(BROWSER_IFRAME_SANDBOX.split(' ')).toEqual(expect.arrayContaining([
      'allow-scripts',
      'allow-forms',
      'allow-same-origin',
    ]))
    expect(BROWSER_IFRAME_SANDBOX).not.toContain('allow-top-navigation')
  })
})
