/** Shared composer-dock inject kept after the overlay drawer was replaced. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { DesktopComposerBranch } from './ComposerBranch.tsx'

/** Place the current git branch in the input dock, immediately above the composer card. */
export function injectDesktopComposerBranch(ctx: ClientContext): void {
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'desktop-composer-branch',
    order: 30,
  }, DesktopComposerBranch))
}
