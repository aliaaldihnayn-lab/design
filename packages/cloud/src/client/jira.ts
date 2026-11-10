import {
  jiraConnectionSchema,
  jiraForwardResponseSchema,
  type JiraConnectionInput,
  type JiraConnectionStatus,
  type JiraForwardRequest,
  type JiraForwardResponse
} from '#cloud/contract'
import type { CloudAPI } from '#cloud/server/api'
import type { hc } from 'hono/client'
import * as v from 'valibot'

import { parseResponse, responseBody, type CloudClientDiagnostic } from './response'

const connectionResponseSchema = v.object({ connection: v.nullable(jiraConnectionSchema) })

/** The person's Jira site, which the server keeps and calls for them. */
export function createJiraRequests(
  client: ReturnType<typeof hc<CloudAPI>>,
  onDiagnostic?: CloudClientDiagnostic
) {
  const jira = client.integrations.jira
  return {
    async getJiraConnection(): Promise<JiraConnectionStatus | null> {
      const response = await parseResponse(jira.$get(), connectionResponseSchema, onDiagnostic)
      return response.connection
    },
    /** Rejects with a `CloudAPIError` when Jira refuses the email and token or cannot be reached. */
    async connectJira(input: JiraConnectionInput): Promise<JiraConnectionStatus | null> {
      const response = await parseResponse(
        jira.$put({ json: input }),
        connectionResponseSchema,
        onDiagnostic
      )
      return response.connection
    },
    async disconnectJira(): Promise<void> {
      await responseBody(await jira.$delete(), onDiagnostic)
    },
    async forwardJiraRequest(request: JiraForwardRequest): Promise<JiraForwardResponse> {
      return parseResponse(
        jira.request.$post({ json: request }),
        jiraForwardResponseSchema,
        onDiagnostic
      )
    }
  }
}
