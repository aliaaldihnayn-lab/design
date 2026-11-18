import { readStoragePreferences } from '../preferences'
import { DEFAULT_DRIVE_CLIENT_ID, DRIVE_CLIENT_ID_FIELD, DRIVE_PICKER_KEY_FIELD } from './adapter'
import { driveAccessToken, GOOGLE_DOCS_SCOPE } from './auth'

/**
 * The Google Picker, for choosing a Doc from Drive instead of pasting its link. It needs the
 * Docs token, a browser API key from the owner's Cloud project (the Drive storage preferences),
 * and the project number, which is the OAuth client id's leading digits.
 * https://developers.google.com/drive/picker/guides/overview
 */
const GAPI_SCRIPT = 'https://apis.google.com/js/api.js'
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document'

/** The part of `google.picker` the module uses, from the reference above. */
export interface GooglePickerAPI {
  ViewId: { DOCUMENTS: string }
  Action: { PICKED: string; CANCEL: string }
  DocsView: new (viewId: string) => { setMimeTypes(mimeTypes: string): unknown }
  PickerBuilder: new () => GooglePickerBuilder
}

interface GooglePickerBuilder {
  addView(view: unknown): GooglePickerBuilder
  setOAuthToken(token: string): GooglePickerBuilder
  setDeveloperKey(key: string): GooglePickerBuilder
  setAppId(appId: string): GooglePickerBuilder
  setLocale(locale: string): GooglePickerBuilder
  setCallback(callback: (data: GooglePickerResult) => void): GooglePickerBuilder
  build(): { setVisible(visible: boolean): void }
}

/** `ResponseObject`: https://developers.google.com/drive/picker/reference/picker.responseobject */
export interface GooglePickerResult {
  action: string
  docs?: { id: string; mimeType?: string }[]
}

interface GoogleAPILoader {
  load(name: 'picker', done: () => void): void
}

function pickerAPI(): GooglePickerAPI | null {
  const google: unknown = Reflect.get(window, 'google')
  if (typeof google !== 'object' || google === null || !('picker' in google)) return null
  return google.picker as GooglePickerAPI
}

function apiLoader(): GoogleAPILoader | null {
  const gapi: unknown = Reflect.get(window, 'gapi')
  if (typeof gapi !== 'object' || gapi === null || !('load' in gapi)) return null
  return gapi as GoogleAPILoader
}

let loading: Promise<GooglePickerAPI> | null = null

function loadPicker(): Promise<GooglePickerAPI> {
  const ready = pickerAPI()
  if (ready) return Promise.resolve(ready)
  loading ??= new Promise<GooglePickerAPI>((resolve, reject) => {
    const loaded = () => {
      const loader = apiLoader()
      if (!loader) return reject(new Error('Google Picker did not load'))
      loader.load('picker', () => {
        const api = pickerAPI()
        if (api) resolve(api)
        else reject(new Error('Google Picker did not load'))
      })
    }
    if (apiLoader()) {
      loaded()
      return
    }
    const script = document.createElement('script')
    script.src = GAPI_SCRIPT
    script.async = true
    script.onload = loaded
    script.onerror = () => reject(new Error('Could not reach Google Picker'))
    document.head.append(script)
  })
  loading.catch(() => {
    loading = null
  })
  return loading
}

/** The API key and project the Picker needs, or null when the owner has not set a key. */
export function googlePickerSettings(): { apiKey: string; clientId: string; appId: string } | null {
  const preferences = readStoragePreferences('google-drive')
  const apiKey = preferences[DRIVE_PICKER_KEY_FIELD]?.trim()
  if (!apiKey) return null
  const clientId = preferences[DRIVE_CLIENT_ID_FIELD]?.trim() || DEFAULT_DRIVE_CLIENT_ID
  return { apiKey, clientId, appId: /^\d+/.exec(clientId)?.[0] ?? '' }
}

/** The Doc a Picker response chose, or null when the person cancelled. */
export function pickedDocumentId(api: GooglePickerAPI, result: GooglePickerResult): string | null {
  if (result.action !== api.Action.PICKED) return null
  return result.docs?.at(0)?.id ?? null
}

/**
 * Opens the Picker on the person's Docs and resolves with the chosen Doc's id, or null. Call it
 * from a click: the sign-in popup may open first.
 */
export async function pickGoogleDocument(
  locale: string,
  load: () => Promise<GooglePickerAPI> = loadPicker
): Promise<string | null> {
  const settings = googlePickerSettings()
  if (!settings) throw new Error('Google Picker needs an API key in Google Drive settings')
  const [api, token] = await Promise.all([
    load(),
    driveAccessToken(settings.clientId, true, GOOGLE_DOCS_SCOPE)
  ])
  return new Promise((resolve) => {
    const view = new api.DocsView(api.ViewId.DOCUMENTS)
    view.setMimeTypes(GOOGLE_DOC_MIME)
    let builder = new api.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(settings.apiKey)
      .setLocale(locale)
      .setCallback((result) => {
        if (result.action === api.Action.PICKED || result.action === api.Action.CANCEL) {
          resolve(pickedDocumentId(api, result))
        }
      })
    if (settings.appId) builder = builder.setAppId(settings.appId)
    builder.build().setVisible(true)
  })
}
