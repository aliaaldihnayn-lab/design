import type { Page } from '@playwright/test'

/** A tool call the scripted model makes, one per step. */
export interface ScriptedToolCall {
  toolName: string
  input: Record<string, unknown>
}

const DEFAULT_CALLS: ScriptedToolCall[] = [
  { toolName: 'render', input: { jsx: '<Frame name="Card" w={120} h={80} />' } }
]

/**
 * Replaces the chat transport with the app's own tool loop, driven by a scripted model, so
 * replies run real tools, edit the document, and save the conversation as in production.
 * Each request makes `calls` in turn, by default creating a frame named `Card` with `render`,
 * then answers "Done". The text of the latest request is kept in `data-last-model-request` on
 * the root element, and the tool results the model was sent in `data-model-tool-results`.
 */
export async function injectToolLoopTransport(
  page: Page,
  calls: ScriptedToolCall[] = DEFAULT_CALLS
): Promise<void> {
  await page.evaluate(async (script) => {
    const transportsPath = '/src/app/ai/transports/tool-loop.ts'
    const { createToolLoopTransport } = await import(transportsPath)
    const api = window.lawha
    const store = api?.getStore?.()
    if (!api?.setChatTransport || !store) throw new Error('Chat transport override not available')

    const usage = {
      inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 1, text: 1, reasoning: undefined }
    }
    type PromptMessage = { role: string; content: unknown }
    const textOf = (message: PromptMessage | undefined) =>
      Array.isArray(message?.content)
        ? message.content.map((part: { text?: string }) => part.text ?? '').join('')
        : String(message?.content ?? '')

    let calls = 0
    let step = 0
    const model = {
      specificationVersion: 'v4',
      provider: 'scripted',
      modelId: 'scripted',
      supportedUrls: {},
      doGenerate() {
        throw new Error('The scripted model only streams')
      },
      async doStream({ prompt }: { prompt: PromptMessage[] }) {
        const last = prompt.at(-1)
        const answering = last?.role === 'tool'
        if (!answering) {
          const request = prompt.findLast((message) => message.role === 'user')
          document.documentElement.dataset.lastModelRequest = textOf(request)
          step = 0
        } else {
          const results = prompt.filter((message) => message.role === 'tool')
          document.documentElement.dataset.modelToolResults = JSON.stringify(
            results.map((message) => message.content)
          )
        }
        const id = `call-${++calls}`
        const next = script[step++]
        const chunks = next
          ? [
              { type: 'stream-start', warnings: [] },
              {
                type: 'tool-call',
                toolCallId: id,
                toolName: next.toolName,
                input: JSON.stringify(next.input)
              },
              { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage }
            ]
          : [
              { type: 'stream-start', warnings: [] },
              { type: 'text-start', id },
              { type: 'text-delta', id, delta: 'Done' },
              { type: 'text-end', id },
              { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage }
            ]
        return {
          stream: new ReadableStream({
            start(controller) {
              for (const chunk of chunks) controller.enqueue(chunk)
              controller.close()
            }
          })
        }
      }
    }

    api.setChatTransport(() =>
      createToolLoopTransport({
        store,
        providerID: 'openai',
        model,
        effectiveModelID: 'scripted',
        maxOutputTokens: 1000,
        thinkingLevel: () => 'default'
      })
    )
  }, calls)
}
