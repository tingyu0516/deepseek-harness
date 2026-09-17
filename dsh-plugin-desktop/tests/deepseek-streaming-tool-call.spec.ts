import type { AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { MessageId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import {
  DeepSeekAdapter,
  resolveAdapterOptions,
} from '@deepseek-ai/dsh-llm-deepseek'
import { afterEach, describe, expect, it, vi } from 'vitest'

function sseResponse(events: readonly Record<string, unknown>[]): Response {
  const body = events
    .map(event => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`)
    .join('')
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

describe('DeepSeek streaming tool calls', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the tool identity from content_block_start and concatenates JSON argument deltas', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      {
        type: 'message_start',
        message: { id: 'msg_1', model: 'deepseek-v4-pro', usage: { input_tokens: 10, output_tokens: 1 } },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'call_web_search', name: 'web_search', input: {} },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"query":' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '"AI news today"}' },
      },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } },
      { type: 'message_stop' },
    ])))

    const connection = resolveAdapterOptions({
      baseURL: 'https://example.test/v1',
      thinking: 'disabled',
    })
    const adapter = new DeepSeekAdapter({
      options: () => connection,
      resolveApiKey: async () => 'test-key',
      resolveUserId: () => 'test-user' as AnonymousUserId,
      prepareExtensions: async () => ({ fields: {}, accept: async () => {} }),
    })
    const chunks: StreamChunk[] = []

    for await (const chunk of adapter.stream({
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      messages: [{
        id: MessageId('message-user'),
        role: 'user',
        content: [{ type: 'text', text: 'Search today AI news' }],
        source: { kind: 'user' },
      }],
      tools: [{
        name: 'web_search',
        description: 'Search the web',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      }],
    })) chunks.push(chunk)

    expect(chunks.find(chunk => chunk.type === 'block-end')).toMatchObject({
      block: {
        type: 'tool-call',
        id: 'call_web_search',
        name: 'web_search',
        arguments: '{"query":"AI news today"}',
      },
    })
    expect(chunks.at(-1)).toMatchObject({
      type: 'finish',
      reason: { kind: 'tool-calls' },
    })
  })
})
