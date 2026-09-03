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

/** Delete one existing workspace file through the Desktop Host route.
 * @param path - absolute workspace file path.
 * @param signal - optional abort.
 */
export async function deleteDesktopWorkspaceFile(path: string, signal?: AbortSignal): Promise<void> {
  const requestInit: RequestInit = {
    method: 'DELETE',
    ...(signal === undefined ? {} : { signal }),
  }
  const response = await fetch(`${DESKTOP_WORKSPACE_FILE_PATH}?path=${encodeURIComponent(path)}`, requestInit)
  const value: unknown = await response.json()
  if (!response.ok || typeof value !== 'object' || value === null || !('deleted' in value) || value.deleted !== true) {
    throw new Error(errorMessage(value, 'Unable to delete file'))
  }
}

/** Create one missing workspace file or directory through the Desktop Host route.
 * @param path - absolute workspace path that must not already exist.
 * @param kind - file creates an empty UTF-8 file; directory creates one folder.
 * @param signal - optional abort.
 * @returns the confined path Host created.
 */
export async function createDesktopWorkspaceEntry(
  path: string,
  kind: 'file' | 'directory',
  signal?: AbortSignal,
): Promise<{ path: string, kind: 'file' | 'directory' }> {
  const response = await fetch(DESKTOP_WORKSPACE_FILE_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, kind }),
    ...(signal === undefined ? {} : { signal }),
  })
  const value: unknown = await response.json()
  if (
    !response.ok
    || typeof value !== 'object'
    || value === null
    || !('created' in value)
    || value.created !== true
    || !('path' in value)
    || typeof value.path !== 'string'
    || !('kind' in value)
    || (value.kind !== 'file' && value.kind !== 'directory')
  ) {
    throw new Error(errorMessage(value, 'Unable to create path'))
  }
  return { path: value.path, kind: value.kind }
}
