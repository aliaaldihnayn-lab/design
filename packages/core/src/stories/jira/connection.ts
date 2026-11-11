import type { JiraClient } from './client'

/** The Jira site a host has connected, which the stories' tools and the app sync through. */
export interface JiraConnection {
  /** The site's address, such as `https://example.atlassian.net`. */
  site: string
  client: JiraClient
  /** The project stories go to when the document has not chosen one. */
  defaultProjectKey?: string
}

let active: JiraConnection | null = null

/**
 * Sets the connection the tools use, or clears it with null. The app sets it from Settings,
 * the MCP server from its environment; credentials stay with the host, never in a document.
 */
export function setJiraConnection(connection: JiraConnection | null): void {
  active = connection
}

export function getJiraConnection(): JiraConnection | null {
  return active
}
