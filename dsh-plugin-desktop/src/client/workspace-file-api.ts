/** Client fetch for the Desktop workspace file route. */

export const DESKTOP_WORKSPACE_FILE_PATH = '/api/desktop/workspace-file'

function errorMessage(value: unknown, fallback: string): string {
  return typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string'
    ? value.error
    : fallback
}

/** Read one UTF-8 workspace file from the Desktop Host route.
 * @param path - absolute workspace file path.
 * @param signal - optional abort for tab switches.
 * @returns the file contents.
 */
export async function requestDesktopWorkspaceFile(path: string, signal?: AbortSignal): Promise<string> {
  const requestInit: RequestInit = signal === undefined ? {} : { signal }
  const response = await fetch(`${DESKTOP_WORKSPACE_FILE_PATH}?path=${encodeURIComponent(path)}`, requestInit)
  const value: unknown = await response.json()
  if (!response.ok || typeof value !== 'object' || value === null || !('content' in value) || typeof value.content !== 'string') {
    throw new Error(errorMessage(value, 'Unable to read file'))
  }
  return value.content
}

/** Overwrite one existing UTF-8 workspace file through the Desktop Host route.
 * @param path - absolute workspace file path.
 * @param content - replacement UTF-8 text.
 * @param signal - optional abort.
 */
export async function saveDesktopWorkspaceFile(path: string, content: string, signal?: AbortSignal): Promise<void> {
  const response = await fetch(DESKTOP_WORKSPACE_FILE_PATH, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, content }),
    ...(signal === undefined ? {} : { signal }),
  })
  const value: unknown = await response.json()
  if (!response.ok || typeof value !== 'object' || value === null || !('saved' in value) || value.saved !== true) {
    throw new Error(errorMessage(value, 'Unable to save file'))
  }
}
