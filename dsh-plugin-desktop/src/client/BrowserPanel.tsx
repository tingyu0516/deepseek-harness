/** Sandboxed http(s) preview for a local or remote service. */
import { RefreshCw } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import {
  BROWSER_IFRAME_SANDBOX,
  BROWSER_PREVIEW_PLACEHOLDER,
  parseBrowserPreviewUrl,
} from './browser-preview-url.ts'

/** Right-sidebar Browser tab: address bar plus a sandboxed iframe. */
export function DesktopBrowserPanel() {
  const [draft, setDraft] = useState(BROWSER_PREVIEW_PLACEHOLDER)
  const [src, setSrc] = useState<string>()
  const [error, setError] = useState<string>()
  const [frameKey, setFrameKey] = useState(0)

  const go = (event?: FormEvent): void => {
    event?.preventDefault()
    const origin = typeof window === 'undefined' ? undefined : window.location.origin
    const parsed = parseBrowserPreviewUrl(draft, origin)
    if (parsed === undefined) {
      setError('Enter an http or https URL. This app cannot be previewed here.')
      return
    }
    setError(undefined)
    setDraft(parsed)
    setSrc(parsed)
  }

  return (
    <div className="dshDesktopBrowser">
      <form className="dshDesktopBrowserToolbar" onSubmit={go}>
        <input
          className="dshDesktopBrowserAddress"
          type="text"
          value={draft}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          aria-label="Browser address"
          placeholder={BROWSER_PREVIEW_PLACEHOLDER}
          onChange={event => setDraft(event.target.value)}
        />
        <button type="submit">Go</button>
        <button
          type="button"
          aria-label="Reload"
          title="Reload"
          disabled={src === undefined}
          onClick={() => { if (src !== undefined) setFrameKey(key => key + 1) }}
        >
          <RefreshCw size={14} aria-hidden="true" />
        </button>
      </form>
      {error !== undefined && <div className="dshDesktopBrowserError" role="alert">{error}</div>}
      {src === undefined ? (
        <div className="dshDesktopBrowserEmpty">Enter a local service URL to preview it here.</div>
      ) : (
        <iframe
          key={frameKey}
          className="dshDesktopBrowserFrame"
          title="Service preview"
          src={src}
          sandbox={BROWSER_IFRAME_SANDBOX}
          referrerPolicy="no-referrer"
        />
      )}
    </div>
  )
}
