import {
  jiraConnectionSchema,
  jiraForwardResponseSchema,
  jiraOAuthAuthorizationSchema,
  jiraOAuthTokenSchema,
  type JiraOAuthToken,
  type JiraConnectionInput,
  type JiraConnectionStatus,
  type JiraForwardRequest,
  type JiraForwardResponse
} from '#cloud/contract'
import type { CloudAPI } from '#cloud/server/api'
import type { hc } from 'hono/client'
import * as v from 'valibot'

import { parseResponse, responseBody, type CloudClientDiagnostic } from './response'

const connectionResponseSchema = v.object({
  connection: v.nullable(jiraConnectionSchema),
  /** Whether the server can connect Jira through Atlassian's OAuth 2.0 (3LO). */
  oauth: v.optional(v.boolean(), false)
})

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
    /** The connection with whether the server offers connecting through OAuth. */
    async getJiraIntegration(): Promise<{
      connection: JiraConnectionStatus | null
      oauth: boolean
    }> {
      return parseResponse(jira.$get(), connectionResponseSchema, onDiagnostic)
    },
    /** Atlassian's consent page, which sends the person back to the server when they allow it. */
    async authorizeJiraOAuth(): Promise<string> {
      const response = await parseResponse(
        jira.oauth.authorize.$post(),
        jiraOAuthAuthorizationSchema,
        onDiagnostic
      )
      return response.url
    },
    /** A current access token for `api.atlassian.com/ex/jira/{cloudId}`, refreshed as needed. */
    async jiraOAuthToken(): Promise<JiraOAuthToken> {
      return parseResponse(jira.oauth.token.$get(), jiraOAuthTokenSchema, onDiagnostic)
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
