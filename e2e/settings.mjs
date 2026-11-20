// Settings dialog check in real Electron: open, change accent and theme, Escape, reload, Tab trap.
// Run: npx electron-vite build && node e2e/settings.mjs
import { _electron as electron } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { linuxArgs } from './launch-args.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-share-e2e-'))
const check = (c, m) => {
  if (!c) throw new Error(`ASSERT: ${m}`)
  console.log(`ok - ${m}`)
}
const app = await electron.launch({
  args: [...linuxArgs, root],
  cwd: root,
  env: {
    ...process.env,
    PPT_SHARE_USER_DATA: userData,
    PPT_SKIP_TOUR: '1',
    PPT_SKIP_HOME: '1',
    ELECTRON_RENDERER_URL: ''
  }
})
try {
  const page = await app.firstWindow()
  await page.waitForSelector('header')
  const attr = (n) => page.evaluate((k) => document.documentElement.dataset[k], n)
  const LABEL = { local: 'Local device', omt: 'Network', both: 'Both' }
  const routeNow = () => page.evaluate(async () => (await window.api.getSettings()).audio.route)
  const checked = (tid) =>
    page.evaluate(
      (t) => document.querySelector(`[data-testid=${t}] [aria-checked=true]`)?.textContent ?? null,
      tid
    )
  const savedAudio = () =>
    JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).audio
  await page.click('button.gear')
  await page.waitForSelector('[data-testid=settings-dialog]')
  check(
    await page.evaluate(() => document.activeElement?.dataset.testid === 'settings-close'),
    'focus on close'
  )
  check(/\d/.test(await page.textContent('.about-line')), 'version shown')
  await page.click('[data-testid=accent-violet]')
  check((await attr('accent')) === 'violet', 'accent violet applied')
  await page.click('[data-testid=settings-theme] >> text=Light')
  check((await attr('theme')) === 'light', 'theme light applied')
  await page.click('[data-testid=accent-custom]')
  await page.fill('[data-testid=custom-accent-input]', '#ffee00')
  check(
    await page.evaluate(() => document.documentElement.style.getPropertyValue('--accent') !== ''),
    'custom accent sets variables'
  )
  await page.click('[data-testid=settings-reduce-motion]')
  check((await attr('reduceMotion')) !== undefined, 'reduce motion attr set')
  // Sound section: route and device mirror the Sound chip popover.
  await page.waitForSelector('[data-testid=settings-audio-device]')
  check((await checked('settings-audio-route')) === LABEL[await routeNow()], 'Settings route matches the saved route')
  await page.click('[data-testid=settings-audio-route] >> text=Both')
  await page.waitForFunction(async () => (await window.api.getSettings()).audio.route === 'both')
  check(savedAudio().route === 'both', 'route saved from Settings')
  await page.evaluate(() => window.api.patchAudio({ route: 'omt' }))
  await page.reload()
  await page.waitForSelector('header')
  check((await routeNow()) === 'omt', 'route from the API persists after reload')
  await page.click('button.gear')
  await page.waitForSelector('[data-testid=settings-audio-device]')
  check((await checked('settings-audio-route')) === 'Network', 'Settings shows the saved route')
  // A saved device that is not connected shows in both pickers.
  await page.evaluate(() => window.api.patchAudio({ deviceId: 'gone-device' }))
  await page.getByTestId('settings-audio-missing').waitFor()
  check(true, 'missing saved device warns in Settings')
  await page.evaluate(() => window.api.patchAudio({ deviceId: null, route: 'local' }))
  await page.getByTestId('settings-audio-missing').waitFor({ state: 'detached' })
  // Tab reaches the select.
  await page.focus('[data-testid=settings-reduce-motion]')
  let hitSelect = false
  for (let i = 0; i < 12 && !hitSelect; i++) {
    await page.keyboard.press('Tab')
    hitSelect = await page.evaluate(
      () => document.activeElement?.dataset.testid === 'settings-audio-device'
    )
  }
  check(hitSelect, 'Tab reaches the Output device select')
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab')
    const inside = await page.evaluate(() =>
      document.querySelector('[data-testid=settings-dialog]').contains(document.activeElement)
    )
    if (!inside)
      throw new Error(
        'ASSERT: focus left dialog ' +
          i +
          ' ' +
          (await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120)))
      )
  }
  console.log('ok - Tab stays inside')
  // A short window: the dialog stays inside it and its body scrolls (it used to run off the bottom).
  const win = await app.browserWindow(page)
  const size = await win.evaluate((w) => w.getSize())
  await win.evaluate((w) => w.setSize(1180, 640))
  await page.waitForFunction(() => window.innerHeight <= 640)
  const fit = await page.evaluate(() => {
    const d = document.querySelector('[data-testid=settings-dialog]').getBoundingClientRect()
    const body = document.querySelector('.settings-dialog .set-body')
    body.scrollTop = body.scrollHeight
    return {
      top: d.top,
      bottom: d.bottom,
      vh: window.innerHeight,
      scrolls: body.scrollHeight > body.clientHeight,
      moved: body.scrollTop > 0
    }
  })
  check(fit.top >= 0 && fit.bottom <= fit.vh, `dialog fits a short window (${JSON.stringify(fit)})`)
  check(fit.scrolls && fit.moved, 'settings body scrolls in a short window')
  await win.evaluate((w, [wd, ht]) => w.setSize(wd, ht), size)
  await page.keyboard.press('Escape')
  check((await page.locator('[data-testid=settings-dialog]').count()) === 0, 'Escape closes')
  check(
    await page.evaluate(() => document.activeElement?.classList.contains('gear')),
    'focus returns to gear'
  )
  await page.reload()
  await page.waitForSelector('header')
  check(
    (await attr('accent')) === 'custom' && (await attr('theme')) === 'light',
    'persists after reload'
  )
  check((await attr('reduceMotion')) !== undefined, 'reduce motion persists')
  await page.screenshot({ path: path.join(os.tmpdir(), 'settings-closed.png') })
  // New event opens a dialog: Escape cancels, a name + Enter creates and selects the event.
  const tabs = page.locator('[role=tab]')
  const before = await tabs.count()
  await page.click('.evtabs .newbtn')
  await page.waitForSelector('[data-testid=new-event-dialog]')
  check((await page.locator('.evtabs input').count()) === 0, 'no input in the tab bar')
  check(
    await page.evaluate(() => document.activeElement?.dataset.testid === 'new-event-name'),
    'name field focused'
  )
  await page.keyboard.press('Enter')
  check((await page.locator('[data-testid=new-event-error]').count()) === 1, 'empty name refused')
  await page.keyboard.press('Escape')
  check((await page.locator('[data-testid=new-event-dialog]').count()) === 0, 'Escape closes')
  check((await tabs.count()) === before, 'Escape creates nothing')
  // Focus returns in a timer after the dialog unmounts: poll, do not read it once.
  await page
    .waitForFunction(() => document.activeElement?.classList.contains('newbtn'), null, {
      timeout: 3000
    })
    .catch(() => {})
  check(
    await page.evaluate(() => document.activeElement?.classList.contains('newbtn')),
    'focus back on New'
  )
  await page.click('.evtabs .newbtn')
  await page.fill('[data-testid=new-event-name]', 'Annual gala')
  await page.screenshot({ path: path.join(os.tmpdir(), 'new-event-light.png') })
  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'))
  await page.screenshot({ path: path.join(os.tmpdir(), 'new-event-dark.png') })
  await page.evaluate(() => (document.documentElement.dataset.theme = 'light'))
  await page.keyboard.press('Escape')
  await page.click('.evtabs .newbtn')
  await page.fill('[data-testid=new-event-name]', '  Dialog Event  ')
  await page.press('[data-testid=new-event-name]', 'Enter')
  await page.locator('[data-testid=new-event-dialog]').waitFor({ state: 'detached' })
  check((await tabs.count()) === before + 1, 'event created as a tab')
  check(
    (await page.locator('[role=tab][aria-selected=true]').first().textContent()) === 'Dialog Event',
    'new event selected, name trimmed'
  )
  await page.click('button.gear')
  await page.screenshot({ path: path.join(os.tmpdir(), 'settings-open.png') })
  console.log('PASS')
} finally {
  await app.close()
}
