import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'

import {
  CLOUD_TEST_DATABASE_URL,
  startCloudTestServer,
  type CloudTestServer
} from '#tests/helpers/cloud/server'

test.skip(!CLOUD_TEST_DATABASE_URL, 'Cloud browser tests need LAWHA_TEST_DATABASE_URL')
test.describe.configure({ mode: 'serial' })

const PREFERENCES = {
  name: 'lawha:preferences:v1',
  value: JSON.stringify({ version: 1, onboarding: { aiSetup: 'done' } })
}

type Person = { name: string; email: string; password: string }
const alice: Person = { name: 'Alice', email: 'alice@example.test', password: 'alice-password-1' }
const bob: Person = { name: 'Bob', email: 'bob@example.test', password: 'bob-password-1' }

let server: CloudTestServer
let aliceContext: BrowserContext
let alicePage: Page
let bobContext: BrowserContext
let bobPage: Page

async function newContext(browser: Browser, origin: string) {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [{ origin, localStorage: [PREFERENCES] }] }
  })
  return { context, page: await context.newPage() }
}

/**
 * Creates the person's account with the form on `page` and opens the link in the email that
 * confirms it in a new tab of the same browser, which it returns.
 */
async function createAccount(page: Page, person: Person): Promise<Page> {
  await page.getByRole('button', { name: 'Create an account' }).click()
  await page.getByLabel('Name').fill(person.name)
  await page.getByLabel('Email').fill(person.email)
  await page.getByLabel('Password', { exact: true }).fill(person.password)
  await page.getByLabel('Repeat password').fill(person.password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
  let link: string | undefined
  await expect
    .poll(async () => {
      const email = await server.latestEmail(person.email)
      link = email?.links.find((url) => url.includes('/verify-email'))
      return link
    })
    .toBeTruthy()
  const tab = await page.context().newPage()
  await tab.goto(link ?? '')
  return tab
}

/** Signs up from an editor on another address: a code the server's pages approve. */
async function signUpWithDeviceCode(context: BrowserContext, page: Page, person: Person) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Sign in…' }).click()
  await page.getByText('Your team’s server').click()
  await page.getByLabel('Server address').fill(server.url)
  await page.getByRole('button', { name: 'Continue' }).click()
  const approval = context.waitForEvent('page')
  await page.getByRole('button', { name: 'Continue with email' }).click()
  const portal = await approval
  const verified = await createAccount(portal, person)
  // The link signs them in on the server's pages, which then ask to approve the code.
  await verified.getByRole('button', { name: 'Approve' }).click()
  await expect(verified.getByRole('heading', { name: 'You’re signed in' })).toBeVisible()
  await verified.close()
  await portal.close()
}

test.beforeAll(async ({ browser, baseURL }) => {
  test.setTimeout(300_000)
  server = await startCloudTestServer({
    editorOrigin: new URL(baseURL ?? '').origin,
    databaseURL: CLOUD_TEST_DATABASE_URL ?? ''
  })
  ;({ context: aliceContext, page: alicePage } = await newContext(
    browser,
    new URL(baseURL ?? '').origin
  ))
  ;({ context: bobContext, page: bobPage } = await newContext(browser, server.url))
})

test.afterAll(async () => {
  await aliceContext.close()
  await bobContext.close()
  await server.close()
})

const roomTree = (page: Page) => page.getByRole('tree', { name: 'Rooms you can enter' })

test('an owner makes a room with a restricted sub-room and a design in it', async () => {
  test.setTimeout(300_000)
  await signUpWithDeviceCode(aliceContext, alicePage, alice)
  await alicePage.getByRole('button', { name: 'Rooms' }).click()
  await alicePage.getByRole('button', { name: 'New room' }).first().click()
  await alicePage.getByLabel('Room name').fill('Team')
  await alicePage.getByRole('button', { name: 'Create room' }).click()
  await expect(roomTree(alicePage).getByRole('treeitem', { name: /Team/ })).toBeVisible()

  const room = alicePage.getByTestId('room-page')
  await room.getByTestId('room-new').click()
  await alicePage.getByRole('menuitem', { name: 'New sub-room' }).click()
  await alicePage.getByLabel('Room name').fill('Secret')
  await alicePage.getByRole('checkbox', { name: 'Only people invited here' }).check()
  await alicePage.getByRole('button', { name: 'Create room' }).click()
  await expect(roomTree(alicePage).getByRole('treeitem', { name: /Secret/ })).toBeVisible()
  await expect(room.getByRole('heading', { name: 'Secret' })).toBeVisible()

  await room.getByTestId('room-new').click()
  await alicePage.getByRole('menuitem', { name: 'New design' }).click()
  // The design opens in its own tab; Home still lists it in the room.
  await expect(alicePage.getByRole('tab', { name: /Untitled/ })).toBeVisible()
  await alicePage.getByRole('tab').first().click()
  await expect(room.getByRole('heading', { name: 'Secret' })).toBeVisible()
  await expect(room.getByText('Untitled')).toBeVisible()
})

test('an invited member joins the room but never sees its restricted sub-room', async () => {
  test.setTimeout(300_000)
  const room = alicePage.getByTestId('room-page')
  await roomTree(alicePage).getByRole('button', { name: 'Team', exact: true }).click()
  await expect(room.getByRole('heading', { name: 'Team' })).toBeVisible()
  await room.getByTestId('room-members').click()
  const members = alicePage.getByRole('dialog')
  await members.getByLabel('Email address').fill(bob.email)
  await members.getByRole('button', { name: 'Invite', exact: true }).click()
  await expect(members.getByRole('button', { name: 'Copy invitation link' })).toBeVisible()
  await members.getByRole('button', { name: 'Done' }).click()

  let link: string | undefined
  await expect
    .poll(async () => {
      const email = await server.latestEmail(bob.email)
      link = email?.links.find((url) => url.includes('/invitations/'))
      return link
    })
    .toBeTruthy()

  // Bob follows the email to the server's own editor, which signs him in on its pages.
  await bobPage.goto(link ?? '')
  await bobPage.getByRole('button', { name: 'Sign in to open' }).click()
  // The editor's own form signs him up, and finishes signing in once the email is confirmed.
  const verified = await createAccount(bobPage, bob)
  await expect(verified.getByRole('heading', { name: 'Email verified' })).toBeVisible()
  await verified.close()
  await bobPage.bringToFront()
  await bobPage.getByRole('button', { name: 'Continue' }).click()
  await bobPage.getByRole('button', { name: 'Join room' }).click()
  await bobPage.getByRole('button', { name: 'Rooms' }).click()
  await expect(roomTree(bobPage).getByRole('treeitem', { name: /Team/ })).toBeVisible()
  await expect(roomTree(bobPage).getByRole('treeitem', { name: /Secret/ })).toHaveCount(0)
  await roomTree(bobPage).getByRole('button', { name: 'Team', exact: true }).click()
  const bobRoom = bobPage.getByTestId('room-page')
  await expect(bobRoom.getByRole('heading', { name: 'Team' })).toBeVisible()
  await expect(bobRoom.getByText('Secret')).toHaveCount(0)
})

test('people in the same room see each other there', async () => {
  const hereNow = (page: Page) => page.getByRole('list', { name: 'In this room now' })
  await expect(hereNow(alicePage).getByRole('listitem')).toHaveCount(2, { timeout: 30_000 })
  await expect(hereNow(bobPage).getByRole('listitem')).toHaveCount(2, { timeout: 30_000 })
})
