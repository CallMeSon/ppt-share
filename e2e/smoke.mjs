// Smoke test of the built app in real Electron (Playwright).
// Run: npm run test:e2e   (builds first, then launches out/main/index.js)
import { _electron as electron } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { PDFDocument } from 'pdf-lib'
import { linuxArgs } from './launch-args.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const shot = path.join(root, '.superpowers/sdd/2026-10-06-ppt-share/task-6-smoke.png')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-share-e2e-'))

function check(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`)
  console.log(`ok - ${msg}`)
}

const frameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-share-frames-'))
const W = 1920
const H = 1080

const launchOptions = {
  args: [...linuxArgs, root],
  cwd: root,
  env: {
    ...process.env,
    PPT_SHARE_USER_DATA: userData,
    PPT_OUTPUT_DUMP: frameDir,
    PPT_SKIP_HOME: '1',
    ELECTRON_RENDERER_URL: ''
  }
}
const app = await electron.launch(launchOptions)
/** The app relaunched on the same user data by the restart check. */
let app2 = null

// --- Program output helpers ---
// Program is read back from the HDMI output window (capturePage: its own
// compositor). The main flow shows that window on a simulated second display
// (see startProbe), so one real screen is enough. Points are given in
// 1920×1080 frame coordinates and scaled to the captured size.
let dumpSeq = 0

/** Samples [r,g,b] at points of the HDMI window; `save` also writes it as PNG. */
async function dumpFrame(points, save = false) {
  // Playwright occasionally reports "Resulting promise was garbage collected"
  // when a main-process GC hits during evaluate; retry that.
  for (let attempt = 1; ; attempt++) {
    try {
      return await dumpFrameOnce(points, save)
    } catch (e) {
      if (attempt >= 3 || !/garbage collected/.test(String(e))) throw e
    }
  }
}

async function dumpFrameOnce(points, save) {
  const f = await app.evaluate(
    async ({ BrowserWindow }, [title, pts, fw, fh, png]) => {
      const w = BrowserWindow.getAllWindows().find(
        (x) => !x.isDestroyed() && x.getTitle() === title
      )
      if (!w) return null
      const img = await w.webContents.capturePage()
      const { width, height } = img.getSize()
      if (!width || !height) return null
      const bmp = img.toBitmap() // BGRA
      const px = pts.map(([x, y]) => {
        const sx = Math.min(width - 1, Math.floor((x * width) / fw))
        const sy = Math.min(height - 1, Math.floor((y * height) / fh))
        const i = (sy * width + sx) * 4
        return [bmp[i + 2], bmp[i + 1], bmp[i]]
      })
      return { width, height, px, png: png ? img.toPNG().toString('base64') : null }
    },
    [HDMI_TITLE, points, W, H, save]
  )
  if (!f) return null
  let file = null
  if (f.png) {
    file = path.join(frameDir, `output-${++dumpSeq}.png`)
    fs.writeFileSync(file, Buffer.from(f.png, 'base64'))
  }
  return { file, width: f.width, height: f.height, px: f.px }
}

const lum = ([r, g, b]) => Math.max(r, g, b)
const isBlack = (p) => lum(p) <= 8
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// Slide 2 of sample.pdf has a light-blue background (232,240,255); 1 and 3 are white.
const blue = (p) => p[0] < 245 && p[2] > 245

/** Polls output frames until `pred(px)` holds; returns the frame. */
async function waitFrame(points, pred, what, timeout = 5000) {
  const end = Date.now() + timeout
  let f = null
  while (Date.now() < end) {
    f = await dumpFrame(points)
    if (f && pred(f.px)) return f
    await sleep(150)
  }
  throw new Error(`ASSERT: ${what} (last frame: ${JSON.stringify(f?.px)})`)
}

/**
 * Runs in a renderer for `ms`: on every animation frame, records 1 if the
 * topmost visible slide layer has a decoded image, else 0. A 0 on any frame
 * is a black flash between two slides.
 */
function layerRecorder(sel, ms) {
  return new Promise((resolve) => {
    const frames = []
    const end = performance.now() + ms
    const tick = () => {
      // The topmost visible layer covers the rest (it has a black background).
      const top = [...document.querySelectorAll(sel)]
        .filter((l) => Number(getComputedStyle(l).opacity) > 0)
        .pop()
      const img = top?.querySelector('img')
      const cv = top?.querySelector('canvas')
      frames.push((img && img.complete && img.naturalWidth > 0) || (cv && cv.width > 0) ? 1 : 0)
      if (performance.now() < end) requestAnimationFrame(tick)
      else resolve(frames)
    }
    requestAnimationFrame(tick)
  })
}
const recorderSrc = (sel, ms) => `(${layerRecorder.toString()})(${JSON.stringify(sel)}, ${ms})`

/** Runs `action` (one slide change) and checks Program and HDMI never show a black frame. */
async function noBlackGap(win, action, what) {
  const ms = 900
  const operator = win.evaluate(recorderSrc('.screen .pgm-layer', ms))
  const hdmi = app.evaluate(
    ({ BrowserWindow }, [title, src]) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === title)
        .webContents.executeJavaScript(src),
    [HDMI_TITLE, recorderSrc('.output-layer', ms)]
  )
  await sleep(100)
  await action()
  const [op, out] = await Promise.all([operator, hdmi])
  check(
    op.length > 10 && op.every((n) => n >= 1) && out.length > 10 && out.every((n) => n >= 1),
    `${what}: no black frame between slides (Program ${op.length} frames, min ${Math.min(...op)}; HDMI ${out.length} frames, min ${Math.min(...out)})`
  )
}

/**
 * A PDF of full-page noise images: slow to decode, so a slide change that does
 * not wait for decoding shows a black frame (plain test pages decode in time).
 */
async function noisePdf(file, pages) {
  const pngs = await app.evaluate(({ nativeImage }, n) => {
    const w = 1920
    const h = 1080
    return Array.from({ length: n }, (_, k) => {
      const buf = Buffer.alloc(w * h * 4)
      for (let i = 0; i < buf.length; i += 4) {
        buf[i] = (Math.random() * 255) | 0
        buf[i + 1] = (Math.random() * 255) | 0
        buf[i + 2] = 120 + k * 40
        buf[i + 3] = 255
      }
      return nativeImage.createFromBitmap(buf, { width: w, height: h }).toPNG().toString('base64')
    })
  }, pages)
  const doc = await PDFDocument.create()
  for (const b64 of pngs) {
    const img = await doc.embedPng(Buffer.from(b64, 'base64'))
    doc.addPage([960, 540]).drawImage(img, { x: 0, y: 0, width: 960, height: 540 })
  }
  fs.writeFileSync(file, await doc.save())
}

/** Writes a solid-colour 16:9 PNG (the KV, KV_RGB) made in the main process, like noisePdf's pages. */
const KV_RGB = [220, 40, 160]
const isKv = (p) =>
  Math.abs(p[0] - KV_RGB[0]) < 25 &&
  Math.abs(p[1] - KV_RGB[1]) < 25 &&
  Math.abs(p[2] - KV_RGB[2]) < 25
async function kvPng(file) {
  const b64 = await app.evaluate(({ nativeImage }, rgb) => {
    const w = 1280
    const h = 720
    const buf = Buffer.alloc(w * h * 4)
    for (let i = 0; i < buf.length; i += 4) {
      buf[i] = rgb[2]
      buf[i + 1] = rgb[1]
      buf[i + 2] = rgb[0]
      buf[i + 3] = 255
    }
    return nativeImage.createFromBitmap(buf, { width: w, height: h }).toPNG().toString('base64')
  }, KV_RGB)
  fs.writeFileSync(file, Buffer.from(b64, 'base64'))
}

// Centre column above the "Halaman n" text (the exact centre is dark text).
const CENTRE = [W / 2, 300]
const GRID = []
for (let gx = 0; gx < 12; gx++) {
  for (let gy = 0; gy < 7; gy++) GRID.push([5 + gx * 173, 5 + gy * 178])
}
// A 4:3 slide in a 16:9 frame (1920×1080 coordinates) is 1440 wide: x 240..1679.
const BARS = [
  [10, 540],
  [230, 540],
  [1690, 540],
  [1910, 540]
]
const INSIDE_43 = [
  [250, 540],
  [1670, 540],
  [960, 20],
  [960, 1060]
]
// --- Drag and drop (Task 9) ---
// Playwright cannot start an OS-level drag from Explorer into Electron. The
// closest real path: real files are attached to a scratch <input type=file>
// (so they are path-backed File objects exactly like an Explorer drop, and
// webUtils.getPathForFile works), put into a DataTransfer, and dispatched as
// dragenter/dragover/drop DragEvents on the window. Reordering uses the same
// synthetic HTML5 drag events on the deck rows and thumbnails.

/** A DataTransfer holding real, path-backed files. */
async function filesTransfer(win, paths) {
  await win.evaluate(() => {
    if (document.getElementById('e2e-drop-src')) return
    const i = document.createElement('input')
    i.type = 'file'
    i.multiple = true
    i.id = 'e2e-drop-src'
    i.style.display = 'none'
    document.body.appendChild(i)
  })
  await win.setInputFiles('#e2e-drop-src', paths)
  return win.evaluateHandle(() => {
    const dt = new DataTransfer()
    for (const f of document.getElementById('e2e-drop-src').files) dt.items.add(f)
    return dt
  })
}

const fireDrag = (win, selector, type, dt) =>
  win.evaluate(
    ([sel, t, d]) =>
      document
        .querySelector(sel)
        .dispatchEvent(new DragEvent(t, { dataTransfer: d, bubbles: true, cancelable: true })),
    [selector, type, dt]
  )

/** HTML5 drag of element `from` onto element `to` (both CSS selectors). */
const dragOnto = (win, from, to) =>
  win.evaluate(
    ([f, t]) => {
      const a = document.querySelector(f)
      const b = document.querySelector(t)
      const dt = new DataTransfer()
      const fire = (el, type) =>
        el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }))
      fire(a, 'dragstart')
      fire(b, 'dragenter')
      fire(b, 'dragover')
      fire(b, 'drop')
      fire(a, 'dragend')
    },
    [from, to]
  )

const thumbs = (win) =>
  win.$$eval('[data-testid=strip] .th', (els) =>
    els.map((e) => {
      const img = e.querySelector('img')
      return {
        file: e.dataset.file,
        role: e.dataset.role ?? null,
        src: img?.getAttribute('src'),
        loaded: !!img && img.complete && img.naturalWidth > 0
      }
    })
  )

/** Colour of a stored slide image (by deck + file) at (10,10), read in main from disk. */
const fileCorner = (deckId, file) =>
  app.evaluate(
    ({ nativeImage }, p) => {
      const img = nativeImage.createFromPath(p)
      const bmp = img.toBitmap()
      const i = (10 * img.getSize().width + 10) * 4
      return [bmp[i + 2], bmp[i + 1], bmp[i]]
    },
    path.join(userData, 'decks', deckId, file)
  )

async function dragAndDropChecks(win, tally, pos, cap) {
  const overlay = win.getByTestId('drop-overlay')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-share-drop-'))
  const pdf = path.join(tmp, 'dropped.pdf')
  const txt = path.join(tmp, 'notes.txt')
  fs.copyFileSync(path.join(root, 'fixtures/sample.pdf'), pdf)
  fs.writeFileSync(txt, 'not a slide')
  const dropList = [pdf, txt]
  const pptE2E = process.env.PPT_E2E === '1'
  if (pptE2E) {
    // A copy of the fixture: never a user's own PowerPoint document.
    const pptx = path.join(tmp, 'dropped-pptx.pptx')
    fs.copyFileSync(path.join(root, 'fixtures/sample-4x3.pptx'), pptx)
    dropList.unshift(pptx)
  }

  try {
    // Overlay: counter-based, only for drags carrying Files.
    const dt = await filesTransfer(win, dropList)
    const resolved = await win.evaluate(
      (d) => [...d.files].map((f) => window.api.pathForFile(f)),
      dt
    )
    check(
      JSON.stringify(resolved) === JSON.stringify(dropList),
      `dropped files are path-backed like an Explorer drop (pathForFile: ${JSON.stringify(resolved)})`
    )
    check(!(await overlay.isVisible()), 'drop overlay hidden before a drag')
    await fireDrag(win, 'main', 'dragenter', dt)
    await overlay.waitFor({ state: 'visible' })
    await fireDrag(win, '.left', 'dragenter', dt)
    await fireDrag(win, 'main', 'dragleave', dt)
    check(await overlay.isVisible(), 'overlay stays while the drag moves between elements')
    await win.screenshot({ path: path.join(path.dirname(shot), 'task-9-overlay.png') })
    await fireDrag(win, '.left', 'dragleave', dt)
    await overlay.waitFor({ state: 'hidden' })
    check(true, 'overlay appears on dragenter with files and hides when the drag leaves')
    await dragOnto(
      win,
      '[data-testid=strip] .th:nth-child(1)',
      '[data-testid=strip] .th:nth-child(1)'
    )
    check(!(await overlay.isVisible()), 'reordering drags (no files) never show the overlay')

    // Drop: PDF imported into the active event, .txt becomes an "Unsupported" row.
    await fireDrag(win, 'main', 'dragenter', dt)
    await fireDrag(win, 'main', 'dragover', dt)
    await fireDrag(win, 'main', 'drop', dt)
    await overlay.waitFor({ state: 'hidden' })
    const errRow = win.getByTestId('import-error').filter({ hasText: 'notes.txt' })
    await errRow.waitFor({ timeout: 2000 })
    check(
      (await errRow.locator('.meta').textContent()) === 'Unsupported' &&
        /PPTX, PPT, PDF, image \(PNG, JPG, WebP, GIF, BMP, AVIF\), MP4, M4V, WebM, MOV, or MKV/.test(
          await errRow.locator('.msg').textContent()
        ),
      `unsupported file shows an error row: "${await errRow.textContent()}"`
    )
    const dropped = win.locator('.deck', { has: win.locator('.name', { hasText: /^dropped$/ }) })
    await dropped.locator('.meta', { hasText: '3 slides' }).waitFor({ timeout: 60_000 })
    check(true, 'dropped PDF imported as a 3-slide deck into the active event')
    if (pptE2E) {
      const pptDeck = win.locator('.deck:not(.busy) .name', { hasText: /^dropped-pptx$/ })
      await pptDeck.waitFor({ timeout: 180_000 })
      check(true, 'dropped PPTX imported through the queue')
    }
    // A folder goes through the same import path as a dropped folder: main's queue with
    // the folder's path (a real directory File cannot be synthesised here).
    const folderSrc = path.join(root, 'fixtures/video-deck')
    await win.evaluate(async (dir) => {
      const { eventId } = await window.api.getSession()
      await window.api.importDecks(eventId, [{ id: 'e2e-folder', path: dir }])
    }, folderSrc)
    const folderDeck = win.locator('.deck:not(.busy)', {
      has: win.locator('.name', { hasText: /^video-deck$/ })
    })
    await folderDeck.waitFor({ timeout: 30_000 })
    const folderDeckId = await folderDeck.getAttribute('data-deck-id')
    const folderMeta = JSON.parse(
      fs.readFileSync(path.join(userData, 'decks', folderDeckId, 'deck.json'), 'utf8')
    )
    check(
      folderMeta.source === 'folder' &&
        folderMeta.width === 640 &&
        folderMeta.slides.map((s) => s.video ?? '-').join() === '001.mp4,-,003.mp4,004.mp4,-' &&
        fs.existsSync(path.join(userData, 'decks', folderDeckId, '001.mp4')),
      `dropped folder imported as a 5-slide video deck (${JSON.stringify(folderMeta.slides)})`
    )
    await folderDeck.click({ button: 'right' })
    await win.getByTestId('deck-menu').getByRole('menuitem', { name: 'Remove deck…' }).click()
    await win.getByTestId('confirm-remove').getByRole('button', { name: 'Remove' }).click()
    await folderDeck.waitFor({ state: 'detached' })
    check(
      !fs.existsSync(path.join(userData, 'decks', folderDeckId)),
      'removing the folder deck deletes its PNGs and MP4s'
    )

    check((await tally.textContent()) === 'LIVE', 'dropping files does not change the output')
    await errRow.click()
    await errRow.waitFor({ state: 'detached' })
    check(true, 'clicking the error row removes it')

    // Reorder slides of the LIVE deck: move the live slide 2 (blue, 002.png) to the front.
    const sample = win.locator('.deck', { has: win.locator('.name', { hasText: /^sample$/ }) })
    const deckId = await sample.getAttribute('data-deck-id')
    check(
      (await pos.textContent()) === '02 / 03',
      'live deck "sample" on slide 2 before reordering'
    )
    const t0 = await thumbs(win)
    check(
      t0.map((t) => t.file).join() === '001.png,002.png,003.png' && t0[1].role === 'live',
      `thumbnails before: ${JSON.stringify(t0.map((t) => [t.file, t.role]))}`
    )
    await dragOnto(
      win,
      '[data-testid=strip] .th:nth-child(2)',
      '[data-testid=strip] .th:nth-child(1)'
    )
    await win.waitForFunction(
      () => document.querySelector('[data-testid=pos]')?.textContent === '01 / 03'
    )
    // The output must keep the same slide the whole time (never another image).
    for (let i = 0; i < 8; i++) {
      const f = await dumpFrame([[10, 10]])
      check(blue(f.px[0]), `output still shows the moved live slide (frame ${i + 1}/8)`)
      await sleep(100)
    }
    await win.waitForFunction(() =>
      [...document.querySelectorAll('[data-testid=strip] .th img')].every(
        (i) => i.complete && i.naturalWidth > 0
      )
    )
    const t1 = await thumbs(win)
    check(
      t1.map((t) => t.file).join() === '002.png,001.png,003.png' &&
        t1[0].role === 'live' &&
        t1.every(
          (t) => t.src === `slide://${deckId}/thumbs/${t.file.replace('.png', '.jpg')}` && t.loaded
        ),
      `thumbnails after: ${JSON.stringify(t1.map((t) => [t.file, t.role, t.src]))}`
    )
    const colours = []
    for (const t of t1) colours.push(await fileCorner(deckId, t.file))
    check(
      blue(colours[0]) && !blue(colours[1]) && !blue(colours[2]),
      `thumbnail images are the moved slides (corner colours ${JSON.stringify(colours)})`
    )
    const programSrc = await win.locator('.screen img').getAttribute('src')
    check(
      programSrc === `slide://${deckId}/${t1[0].file}` && (await tally.textContent()) === 'LIVE',
      `Program shows the same image as the live thumbnail (${programSrc})`
    )
    // The card swaps layers: wait until its top (last) image is the expected one.
    const wantNext = `slide://${deckId}/${t1[1].file}`
    await win.waitForFunction(
      (src) => [...document.querySelectorAll('.next-card img')].pop()?.getAttribute('src') === src,
      wantNext
    )
    check(
      (await cap.textContent()).includes('slide 2') &&
        (await win.locator('.next-card img').last().getAttribute('src')) === wantNext,
      'Next panel shows the new slide 2 (001.png)'
    )
    const widths = await win.evaluate(() => ({
      thumbs: [...document.querySelectorAll('[data-testid=strip] .th img')].map(
        (i) => i.naturalWidth
      ),
      program: document.querySelector('.screen img')?.naturalWidth
    }))
    check(
      widths.thumbs.length === 3 && widths.thumbs.every((w) => w > 0 && w <= 400),
      `strip thumbnails are small (naturalWidth ${JSON.stringify(widths.thumbs)})`
    )
    check(widths.program === 1920, `Program image is full size (naturalWidth ${widths.program})`)
    const saved = JSON.parse(
      fs.readFileSync(path.join(userData, 'decks', deckId, 'deck.json'), 'utf8')
    )
    check(
      saved.slides.map((s) => s.file).join() === '002.png,001.png,003.png',
      'new slide order saved in deck.json'
    )
    await win.screenshot({ path: path.join(path.dirname(shot), 'task-9-reorder.png') })

    // Navigation follows the new order: Space shows 001.png (white), ArrowLeft back to blue.
    await win.keyboard.press('Space')
    await win.waitForFunction(
      () => document.querySelector('[data-testid=pos]')?.textContent === '02 / 03'
    )
    await waitFrame([[10, 10]], (px) => !blue(px[0]) && lum(px[0]) > 200, 'Space shows 001.png')
    await win.keyboard.press('ArrowLeft')
    await waitFrame([[10, 10]], (px) => blue(px[0]), 'ArrowLeft shows 002.png again')
    check(true, 'Next/Prev follow the new slide order')

    // Moving a slide that is not live leaves the output alone.
    await dragOnto(
      win,
      '[data-testid=strip] .th:nth-child(3)',
      '[data-testid=strip] .th:nth-child(2)'
    )
    await win.waitForFunction(
      () =>
        [...document.querySelectorAll('[data-testid=strip] .th')]
          .map((e) => e.dataset.file)
          .join() === '002.png,003.png,001.png'
    )
    check(
      (await pos.textContent()) === '01 / 03' && blue((await dumpFrame([[10, 10]])).px[0]),
      'moving another slide keeps the live slide and position'
    )

    // Reorder decks: drag "dropped" (last ready deck) onto the first row.
    const names = () =>
      win.$$eval('[data-testid=decks] .deck:not(.busy):not(.err) .name', (e) =>
        e.map((x) => x.textContent)
      )
    const before = await names()
    const fromIdx = before.indexOf('dropped') + 1
    await dragOnto(
      win,
      `[data-testid=decks] > .deck-row:nth-child(${fromIdx}) > .deck`,
      '[data-testid=decks] > .deck-row:nth-child(1) > .deck'
    )
    await win.waitForFunction(
      () => document.querySelector('[data-testid=decks] .deck .name')?.textContent === 'dropped'
    )
    const after = await names()
    const events = JSON.parse(fs.readFileSync(path.join(userData, 'events.json'), 'utf8'))
    check(
      after[0] === 'dropped' &&
        after.length === before.length &&
        events[0].deckIds.length === after.length,
      `decks reordered: ${JSON.stringify(before)} -> ${JSON.stringify(after)} (saved)`
    )
    check(
      (await tally.textContent()) === 'LIVE' &&
        (await pos.textContent()) === '01 / 03' &&
        blue((await dumpFrame([[10, 10]])).px[0]),
      'reordering decks does not change the output or position'
    )

    // Delete the live deck: right-click → "Remove deck…" → inline confirmation.
    await sample.click({ button: 'right' })
    await win.getByTestId('deck-menu').getByRole('menuitem', { name: 'Remove deck…' }).click()
    const confirm = win.getByTestId('confirm-remove')
    await confirm.waitFor()
    check(
      (await confirm.textContent()).includes('Remove this deck?'),
      'inline confirmation "Remove this deck?" (no modal)'
    )
    await confirm.screenshot({ path: path.join(path.dirname(shot), 'task-9-confirm.png') })
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await sample.waitFor()
    check((await tally.textContent()) === 'LIVE', 'Cancel keeps the deck and the output')
    await sample.click({ button: 'right' })
    await win.getByRole('menuitem', { name: 'Remove deck…' }).click()
    await confirm.getByRole('button', { name: 'Remove' }).click()
    await win.waitForFunction(
      () => document.querySelector('[data-testid=tally]')?.textContent === 'STANDBY'
    )
    await sample.waitFor({ state: 'detached' })
    check(
      (await win.locator('.screen img').count()) === 0 &&
        (await win.locator('.screen .end-body .t').textContent()) === 'Standby',
      'Program shows the standby card, no image'
    )
    await waitFrame(GRID, (px) => px.every(isBlack), 'deleting the live deck blacks out the output')
    check(true, `deleting the live deck makes the output black (${GRID.length} sample points)`)
    check(
      !fs.existsSync(path.join(userData, 'decks', deckId)),
      'deleted deck folder is removed from disk'
    )
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

// --- HDMI output (Task 11) ---
const NO_SECOND =
  'No second display detected. Connect HDMI, then set Windows to Extend mode (Win+P, then Extend).'
const HDMI_TITLE = 'Bridgecast HDMI'
const hdmiDebug = () => app.evaluate(() => globalThis.__pptHdmi)
const hdmiWindows = () =>
  app.evaluate(
    ({ BrowserWindow }, title) =>
      BrowserWindow.getAllWindows()
        .filter((w) => !w.isDestroyed() && w.getTitle() === title)
        .map((w) => ({
          bounds: w.getBounds(),
          visible: w.isVisible(),
          focusable: w.isFocusable(),
          focused: w.isFocused(),
          onTop: w.isAlwaysOnTop(),
          offscreen: w.webContents.isOffscreen(),
          url: w.webContents.getURL()
        })),
    HDMI_TITLE
  )
const sameBounds = (a, b) =>
  a && b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
/**
 * The fake display is a corner of the real screen at an arbitrary DIP
 * position; at fractional scaling getBounds() reports the enclosing DIP rect
 * of the window's pixels, so it may be 1 DIP larger on each side.
 */
const nearBounds = (a, b) =>
  a &&
  b &&
  Math.abs(a.x - b.x) <= 1 &&
  Math.abs(a.y - b.y) <= 1 &&
  Math.abs(a.x + a.width - (b.x + b.width)) <= 1 &&
  Math.abs(a.y + a.height - (b.y + b.height)) <= 1

/** [r,g,b] at the top centre of the HDMI window, captured from its own compositor. */
const hdmiCentre = () =>
  app.evaluate(async ({ BrowserWindow }, title) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === title)
    const img = await w.webContents.capturePage()
    const { width, height } = img.getSize()
    if (!width || !height) return null
    const bmp = img.toBitmap()
    // Same spot as CENTRE: above the slide's dark "Halaman n" text.
    const i = (Math.floor((height * 300) / 1080) * width + Math.floor(width / 2)) * 4
    return [bmp[i + 2], bmp[i + 1], bmp[i]]
  }, HDMI_TITLE)

async function waitHdmiCentre(pred, what, timeout = 5000) {
  const end = Date.now() + timeout
  let px = null
  while (Date.now() < end) {
    px = await hdmiCentre()
    if (px && pred(px)) return px
    await sleep(150)
  }
  throw new Error(`ASSERT: ${what} (last ${JSON.stringify(px)})`)
}

const fakeDisplays = (list) => app.evaluate((_e, l) => globalThis.__pptHdmiFakeDisplays(l), list)

/**
 * Program probe for the main flow: a simulated 1920×1080 second display (a
 * 960×540 DIP corner of the real primary screen) with HDMI on it.
 */
const PROBE_ID = 515151
async function startProbe(win) {
  const p = await app.evaluate(({ screen }) => {
    const d = screen.getPrimaryDisplay()
    return { id: d.id, label: d.label, bounds: d.bounds }
  })
  const b = p.bounds
  await fakeDisplays([
    {
      id: p.id,
      label: p.label || 'Display 1',
      width: b.width,
      height: b.height,
      primary: true,
      bounds: b
    },
    {
      id: PROBE_ID,
      label: 'E2E OUTPUT',
      width: 1920,
      height: 1080,
      primary: false,
      bounds: { x: b.x + b.width - 960, y: b.y + b.height - 540, width: 960, height: 540 }
    }
  ])
  // Through the popover, like the operator: select the display, switch on.
  const pop = await openOutputPopover(win)
  const select = pop.getByLabel('Target display')
  await select.locator(`option[value="${PROBE_ID}"]`).waitFor({ state: 'attached' })
  await select.selectOption(String(PROBE_ID))
  await pop.getByTestId('hdmi-switch').click()
  await win.locator('[data-testid=hdmi-status][data-tone=ok]').waitFor({ timeout: 15_000 })
  check(true, 'HDMI output on a simulated second display for the Program checks')
}

/** Turns the probe off in the popover (its display id stays saved), back to the real displays. */
async function stopProbe(win) {
  const pop = await openOutputPopover(win)
  await pop.getByTestId('hdmi-switch').click()
  await win.locator('[data-testid=hdmi-status][data-tone=off]').waitFor({ timeout: 5000 })
  await win.keyboard.press('Escape')
  await fakeDisplays(null)
  check((await hdmiWindows()).length === 0, 'probe off: no HDMI window left')
}

const savedHdmi = () =>
  JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).hdmi

const savedAudio = () =>
  JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).audio

/**
 * Opens the popover of a header output chip (hdmi, omt, ndi, sound or canvas) and returns it.
 * Only one popover is open at a time; an open one for the same chip is reused.
 */
async function openOutputPopover(win, chip = 'hdmi') {
  const pop = win.locator(`[data-testid=output-popover][data-popover=${chip}]`)
  if (!(await pop.isVisible().catch(() => false))) {
    await win.getByTestId(`output-chip-${chip}`).click()
  }
  await pop.waitFor()
  return pop
}

/**
 * HDMI: header indicator, the popover section, validation in main, and the
 * window itself. With one real display the toggle shows the "not detected"
 * message; the window path is then driven by simulated displays (a fake
 * second display in a corner of the real screen).
 */
// --- Operator keyboard safety, visible action errors, keyboard reorder ---
async function behaviourChecks(win, tally, pos) {
  const posText = () => pos.textContent()
  const deckIds = () =>
    win.$$eval('[data-testid=decks] .deck[data-deck-id]', (els) => els.map((e) => e.dataset.deckId))
  const focusedDeck = () => win.evaluate(() => document.activeElement?.dataset?.deckId ?? null)

  // Make sure Next has somewhere to go, then park focus on the page body.
  // Prev is applied asynchronously (main, then the state broadcast); wait for it
  // so the starting position is settled (it is ignored when focus is in an input).
  const pBefore = await posText()
  await win.keyboard.press('ArrowLeft')
  await win
    .waitForFunction(
      (b) => document.querySelector('[data-testid=pos]')?.textContent !== b,
      pBefore,
      { timeout: 1000 }
    )
    .catch(() => undefined)
  await win.evaluate(() => document.activeElement?.blur())
  const p0 = await posText()
  const [cur, total] = p0.split(' / ').map(Number)
  // The transport bar zero-pads the position ('03 / 12').
  const [curText, totalText] = p0.split(' / ')
  const here = p0
  const nextPos = `${String(cur + 1).padStart(curText.length, '0')} / ${totalText}`
  check(cur >= 1 && cur < total, `behaviour checks start mid-deck (${p0})`)

  // 1. The event tabs own the keyboard: arrows never move the on-air slide.
  const eventTabs = win.getByRole('tablist', { name: 'Open events' }).locator('[role=tab]')
  const selTab = eventTabs.and(win.locator('[aria-selected=true]'))
  await selTab.focus()
  await win.keyboard.press('ArrowRight')
  await win.keyboard.press('ArrowLeft')
  await win.keyboard.press('Space') // activates the focused tab (already current): no Next
  await sleep(300)
  check((await posText()) === here, 'arrows and Space on an event tab keep the slide')
  check(
    await win.getByRole('tablist', { name: 'Open events' }).isVisible(),
    'open events are a tab list in the header'
  )
  await win.evaluate(() => document.activeElement?.blur())

  // Creating an event: Escape in the dialog cancels.
  const eventLabel = await selTab.textContent()
  const tabCount = await eventTabs.count()
  await win.click('.newbtn')
  await win.fill('[data-testid=new-event-name]', 'Not created')
  await win.keyboard.press('Escape')
  await win.locator('[data-testid=new-event-dialog]').waitFor({ state: 'detached' })
  check(
    (await selTab.textContent()) === eventLabel && (await eventTabs.count()) === tabCount,
    'Escape cancels the new event (no event created, selection kept)'
  )

  // 2. Held keys fire once: auto-repeat never skips slides.
  await win.evaluate(() => document.activeElement?.blur())
  await win.keyboard.down(' ')
  await win.keyboard.down(' ')
  await win.keyboard.down(' ')
  await win.keyboard.up(' ')
  await win.waitForFunction(
    (t) => document.querySelector('[data-testid=pos]')?.textContent === t,
    nextPos
  )
  await sleep(300)
  check(
    (await posText()) === nextPos,
    `a held Space advances exactly one slide (${here} -> ${nextPos})`
  )
  await win.evaluate(() => {
    for (let i = 0; i < 3; i++) {
      dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', repeat: true, bubbles: true })
      )
    }
  })
  await sleep(300)
  check((await posText()) === nextPos, 'synthetic repeated ArrowRight is ignored')

  // 3. Keyboard reorder of decks: Alt+Down moves the focused deck, focus follows, no Next.
  const idsBefore = await deckIds()
  check(idsBefore.length >= 2, `at least two decks to reorder (${idsBefore.length})`)
  const tallyBefore = await tally.textContent()
  // The library re-renders after earlier checks (reloadAll), and a key pressed while that happens
  // is lost (seen in about 1 of 3 runs). Focus the deck, press, and retry the press up to 3 times.
  let moved = false
  for (let attempt = 0; attempt < 3 && !moved; attempt++) {
    await win.locator(`[data-deck-id="${idsBefore[0]}"]`).focus()
    await win.waitForFunction((id) => document.activeElement?.dataset?.deckId === id, idsBefore[0])
    await sleep(400)
    await win.keyboard.press('Alt+ArrowDown')
    moved = await win
      .waitForFunction(
        (id) =>
          document.querySelector('[data-testid=decks] .deck[data-deck-id]')?.dataset.deckId !== id,
        idsBefore[0],
        { timeout: 4000 }
      )
      .then(
        () => true,
        () => false
      )
    if (!moved) console.log(`  (Alt+ArrowDown not applied, attempt ${attempt + 1})`)
  }
  check(moved, 'Alt+ArrowDown reorders the focused deck')
  const idsAfter = await deckIds()
  check(
    idsAfter[0] === idsBefore[1] && idsAfter[1] === idsBefore[0],
    'Alt+ArrowDown moves the focused deck one place down'
  )
  check((await focusedDeck()) === idsBefore[0], 'focus stays on the moved deck')
  check(
    (await posText()) === nextPos && (await tally.textContent()) === tallyBefore,
    'Alt+arrows on a deck never act as Prev/Next'
  )
  await win.getByText('Order saved').waitFor()
  check(true, 'a saved reorder shows the "Order saved" confirmation')
  await win.keyboard.press('Alt+ArrowUp')
  await win.waitForFunction((id) => {
    const first = document.querySelector('[data-testid=decks] .deck[data-deck-id]')
    return first?.dataset.deckId === id
  }, idsBefore[0])
  check((await focusedDeck()) === idsBefore[0], 'Alt+ArrowUp moves it back, focus kept')
  await win.waitForFunction(
    () => !document.querySelector('[data-testid=save-note]')?.textContent,
    null,
    { timeout: 6000 }
  )
  check(true, 'the confirmation clears by itself')

  // Deck context menu: arrows between items, Move down, disabled at the ends.
  await win.locator(`[data-deck-id="${idsBefore[0]}"]`).click({ button: 'right' })
  const dmenu = win.getByTestId('deck-menu')
  check(
    (await dmenu.getAttribute('aria-label')) === 'Deck menu',
    'deck menu has an accessible name'
  )
  check(
    await dmenu.getByRole('menuitem', { name: /Move up/ }).isDisabled(),
    'Move up is disabled on the first deck'
  )
  await win.keyboard.press('ArrowDown')
  check(
    /Move down/.test(await win.evaluate(() => document.activeElement?.textContent)),
    'ArrowDown goes from Rename to Move down'
  )
  await dmenu.getByRole('menuitem', { name: /Move down/ }).click()
  await win.waitForFunction((id) => {
    const first = document.querySelector('[data-testid=decks] .deck[data-deck-id]')
    return first?.dataset.deckId !== id
  }, idsBefore[0])
  check((await focusedDeck()) === idsBefore[0], 'menu move keeps focus on the moved deck')
  await win.keyboard.press('Alt+ArrowUp')
  await win.waitForFunction((id) => {
    const first = document.querySelector('[data-testid=decks] .deck[data-deck-id]')
    return first?.dataset.deckId === id
  }, idsBefore[0])

  // Keyboard reorder of slides in the strip, labels with roles.
  const files = () => win.$$eval('[data-testid=strip] .th', (els) => els.map((e) => e.dataset.file))
  const filesBefore = await files()
  const labels = await win.$$eval('[data-testid=strip] .th', (els) =>
    els.map((e) => e.getAttribute('aria-label'))
  )
  check(
    labels.includes(`Slide ${cur + 1}, live`),
    `thumbnail labels carry the role (${labels.join(' | ')})`
  )
  check(
    (await win.locator('footer[role=region]').getAttribute('aria-label')) === 'Slide strip',
    'the strip is a labelled region, not page contentinfo'
  )
  await win.locator('[data-testid=strip] .th').first().focus()
  await win.keyboard.press('Alt+ArrowRight')
  await win.waitForFunction(
    (f) => document.querySelector('[data-testid=strip] .th')?.dataset.file !== f,
    filesBefore[0]
  )
  const filesAfter = await files()
  check(
    filesAfter[1] === filesBefore[0] && filesAfter[0] === filesBefore[1],
    'Alt+ArrowRight moves the focused thumbnail one place right'
  )
  check(
    (await win.evaluate(() => document.activeElement?.dataset?.file)) === filesBefore[0],
    'focus stays on the moved thumbnail'
  )
  check((await posText()) === nextPos, 'Alt+arrows on a thumbnail never act as Prev/Next')
  await win.keyboard.press('Alt+ArrowLeft')
  await win.waitForFunction(
    (f) => document.querySelector('[data-testid=strip] .th')?.dataset.file === f,
    filesBefore[0]
  )
  await win.evaluate(() => document.activeElement?.blur())

  // 4. A failed action is visible. Main is made to reject program:dispatch (as a
  // disk or state error would); the notice names the problem, stays, and clears on
  // the next successful dispatch.
  await app.evaluate(({ ipcMain }) => {
    const h = ipcMain._invokeHandlers
    globalThis.__realDispatch = h.get('program:dispatch')
    h.set('program:dispatch', () => {
      throw new Error('Could not read the slide. Choose the deck again, then try again.')
    })
  })
  await win.keyboard.press('Space')
  const alert = win.getByTestId('action-error')
  await alert.waitFor()
  check(
    (await alert.getAttribute('role')) === 'alert' &&
      /Could not read the slide/.test(await alert.textContent()),
    "a failed Next shows a persistent role=alert notice with main's message"
  )
  check((await posText()) === nextPos, 'Program is unchanged after the failed action')
  await sleep(1500)
  check((await alert.count()) === 1, 'the notice stays until dismissed or the next success')
  await app.evaluate(({ ipcMain }) => {
    ipcMain._invokeHandlers.set('program:dispatch', globalThis.__realDispatch)
  })
  await win.keyboard.press('ArrowLeft')
  await alert.waitFor({ state: 'detached' })
  check(true, 'the notice clears on the next successful action')
  await win.keyboard.press('ArrowRight')
  await win.waitForFunction(
    (t) => document.querySelector('[data-testid=pos]')?.textContent === t,
    nextPos
  )
}

// --- Sections: add, drag, auto advance stops at the boundary, N / Shift+N, remove ---
async function sectionChecks(win, tally, pos) {
  const rowSel = '[data-testid=decks] .deck[data-deck-id]'
  const allSel = '[data-testid=decks] [data-deck-id], [data-testid=decks] [data-section-id]'
  const ids = () => win.$$eval(rowSel, (els) => els.map((e) => e.dataset.deckId))
  /** Deck and section ids in list order, as "d:<id>" / "s:<id>". */
  const order = () =>
    win.$$eval(allSel, (els) =>
      els.map((e) => (e.dataset.deckId ? `d:${e.dataset.deckId}` : `s:${e.dataset.sectionId}`))
    )
  const posText = () => pos.textContent()
  const liveDeck = () =>
    win.evaluate(() => document.querySelector('.deck.live')?.getAttribute('data-deck-id') ?? null)
  const waitLive = (id) =>
    win.waitForFunction(
      (d) => document.querySelector('.deck.live')?.getAttribute('data-deck-id') === d,
      id
    )
  const waitRow = (sel, index, key, val) =>
    win.waitForFunction(
      ([s, i, k, v]) => [...document.querySelectorAll(s)][i]?.dataset[k] === v,
      [allSel, index, key, val]
    )
  const autoOn = win.locator('[data-testid=auto-advance][aria-checked=true]')
  const autoOff = win.locator('[data-testid=auto-advance][aria-checked=false]')
  const firstSlide = () =>
    win.waitForFunction(() =>
      /^01 \//.test(document.querySelector('[data-testid=pos]')?.textContent ?? '')
    )

  // What Program shows, read back from the HDMI window (the probe is on here): a
  // 12x7 grid of colours, compared with a small tolerance.
  const SG = []
  for (let y = 0; y < 7; y++) for (let x = 0; x < 12; x++) SG.push([80 + x * 160, 60 + y * 150])
  const flat = (f) => f.px.flat()
  const sameFrame = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= 6)
  const settled = async () => {
    await sleep(900)
    return flat(await waitFrame(SG, () => true, 'Program frame'))
  }
  const [d0, d1, d2] = await ids()
  check(!!d2, 'sections: the event has at least three decks')
  const before = await order()
  check(
    (await win.locator('[data-testid=section-row]').count()) === 0,
    'sections: none to start with'
  )

  // Add section: a row in rename mode, name typed, Enter saves.
  await win.getByRole('button', { name: 'Add to this event' }).click()
  await win.getByRole('menuitem', { name: 'Add section' }).click()
  const nameInput = win.getByRole('textbox', { name: /^New name for section/ })
  await nameInput.waitFor()
  await nameInput.fill('Talk 2')
  await nameInput.press('Enter')
  await win.getByTestId('rename-section').waitFor({ state: 'detached' })
  const secRow = win.getByTestId('section-row')
  await secRow.waitFor()
  check(
    (await secRow.getAttribute('aria-label')) === 'Section Talk 2',
    'sections: the new section is named Talk 2'
  )
  const sid = await secRow.getAttribute('data-section-id')
  check(
    (await order()).join() === [...before, `s:${sid}`].join(),
    'sections: a new section lands at the end of the list'
  )

  // Drag the section above the third deck: decks 1 and 2 form the opening block.
  await dragOnto(win, `[data-section-id="${sid}"]`, `[data-deck-id="${d2}"]`)
  await waitRow(allSel, 2, 'sectionId', sid)
  check(
    (await order()).slice(0, 4).join() === [`d:${d0}`, `d:${d1}`, `s:${sid}`, `d:${d2}`].join(),
    'sections: dragging the section row puts it before the third deck'
  )
  // Drag deck 2 onto the section row (it ends up below it), then Alt+Up puts it back.
  await dragOnto(win, `[data-deck-id="${d1}"]`, `[data-section-id="${sid}"]`)
  await waitRow(allSel, 1, 'sectionId', sid)
  check(
    (await order()).slice(0, 4).join() === [`d:${d0}`, `s:${sid}`, `d:${d1}`, `d:${d2}`].join(),
    'sections: dragging a deck onto the section row moves it below the section'
  )
  await win.locator(`[data-deck-id="${d1}"]`).focus()
  await win.keyboard.press('Alt+ArrowUp')
  await waitRow(allSel, 1, 'deckId', d1)
  check(
    (await order()).slice(0, 4).join() === [`d:${d0}`, `d:${d1}`, `s:${sid}`, `d:${d2}`].join(),
    'sections: Alt+ArrowUp moves the deck back above the section'
  )
  await win.evaluate(() => document.activeElement?.blur())

  await win.getByRole('button', { name: /^Next section/ }).waitFor()
  await win.getByRole('button', { name: /^Prev section/ }).waitFor()
  check(true, 'sections: Prev section and Next section buttons show')

  // Reference frames: what Program shows for slide 1 of deck 1 and of deck 3.
  await win.locator(`[data-deck-id="${d0}"]`).click()
  await waitLive(d0)
  await firstSlide()
  const frameD0 = await settled()
  await win.locator(`[data-deck-id="${d2}"]`).click()
  await waitLive(d2)
  await firstSlide()
  const frameD2 = await settled()
  check(!sameFrame(frameD0, frameD2), 'sections: deck 1 and deck 3 look different on Program')

  // Auto advance ON; play deck 2 to its last slide; Space must stop at the boundary.
  await win.getByTestId('auto-advance').click()
  await autoOn.waitFor()
  await win.locator(`[data-deck-id="${d1}"]`).click()
  await waitLive(d1)
  for (let i = 0; i < 200; i++) {
    const [c, t] = (await posText()).split(' / ').map(Number)
    if (c >= t) break
    await win.keyboard.press('Space')
    await win.waitForFunction(
      (b) => document.querySelector('[data-testid=pos]')?.textContent !== b,
      `${c} / ${t}`
    )
  }
  const last = await posText()
  const [lc, lt] = last.split(' / ').map(Number)
  check(lc === lt, `sections: reached the last slide of deck 2 (${last})`)
  await win.evaluate(() => document.activeElement?.blur())
  const card = win.getByTestId('next-card')
  await win.waitForFunction(
    () => document.querySelector('[data-testid=next-card]')?.dataset.kind === 'sectionEnd'
  )
  const cardText = await card.textContent()
  check(
    /End of section/.test(cardText) && /Next section: Talk 2\. Press N\./.test(cardText),
    'sections: Up next shows "End of section" with the next section named'
  )
  const tallyBefore = await tally.textContent()
  const frameEnd = await settled()
  await win.keyboard.press('Space')
  await sleep(1000)
  check(
    sameFrame(frameEnd, flat(await dumpFrame(SG))),
    'sections: Program still shows the same slide after the blocked Space'
  )
  check(
    (await posText()) === last && (await liveDeck()) === d1,
    'sections: Space on the last slide of a section does not cross into the next one'
  )
  check((await tally.textContent()) === tallyBefore, 'sections: the output did not change')

  // N goes to the next section's first deck, Shift+N back to the first deck.
  await win.keyboard.press('n')
  await waitLive(d2)
  await firstSlide()
  await waitFrame(SG, (px) => sameFrame(px.flat(), frameD2), 'N puts deck 3 slide 1 on Program')
  check(true, 'sections: Program shows deck 3, slide 1 after N')
  check(
    (await liveDeck()) === d2 && /^01 \//.test(await posText()),
    'sections: N takes deck 3, slide 1, live'
  )
  await win.keyboard.press('Shift+N')
  await waitLive(d0)
  await firstSlide()
  await waitFrame(
    SG,
    (px) => sameFrame(px.flat(), frameD0),
    'Shift+N puts deck 1 slide 1 on Program'
  )
  check(true, 'sections: Program shows deck 1, slide 1 after Shift+N')
  check(
    (await liveDeck()) === d0 && /^01 \//.test(await posText()),
    'sections: Shift+N goes back to deck 1, slide 1, live'
  )

  // Remove the section: the row goes, every deck stays, order is as found.
  await win.getByTestId('section-more').click()
  await win.getByRole('menuitem', { name: /Remove section/ }).click()
  await win.getByTestId('section-row').waitFor({ state: 'detached' })
  check(
    (await order()).join() === before.join(),
    'sections: Remove section deletes only the row; decks and their order are unchanged'
  )
  check(
    (await win.getByRole('button', { name: /^Next section/ }).count()) === 0,
    'sections: the section buttons hide again'
  )

  // Leave the app as found: auto advance OFF.
  await win.getByTestId('auto-advance').click()
  await autoOff.waitFor()
  check(true, 'sections: auto advance restored to OFF')
}

async function hdmiChecks(win) {
  const hStatus = win.getByTestId('hdmi-status')
  check(
    (await hStatus.textContent()) === 'HDMI off' &&
      (await hStatus.getAttribute('data-tone')) === 'off',
    `header shows the HDMI indicator: "${await win.getByTestId('output-chip-hdmi').textContent()}"`
  )
  const real = await app.evaluate(({ screen }) => ({
    primary: screen.getPrimaryDisplay().id,
    all: screen.getAllDisplays().map((d) => ({ id: d.id, label: d.label, bounds: d.bounds }))
  }))
  console.log(`  displays on this machine: ${JSON.stringify(real.all)}`)

  const seen = await app.evaluate(() =>
    globalThis.__pptHdmi.displays.map(
      (d) => `${d.id} ${d.width}×${d.height} place ${JSON.stringify(d.place)}`
    )
  )
  console.log(`  HDMI sees: ${seen.join(' | ')}`)

  // Main refuses invalid input whatever the UI does.
  const reject = (h) =>
    win.evaluate(
      (x) =>
        window.api.setHdmi(x).then(
          () => 'ok',
          (e) => String(e.message)
        ),
      h
    )
  const primaryErr = await reject({ enabled: true, displayId: real.primary })
  check(
    /main display \(operator\) cannot be used/.test(primaryErr),
    `main refuses the primary display: "${primaryErr}"`
  )
  const badErr = await reject({ enabled: true, displayId: 1.5 })
  check(/not valid/.test(badErr), `main refuses a non-integer display id: "${badErr}"`)
  const goneErr = await reject({ enabled: true, displayId: 987654321 })
  check(/not connected/.test(goneErr), `main refuses an unknown display: "${goneErr}"`)

  const pop = await openOutputPopover(win)
  const section = pop.getByTestId('hdmi-section')
  const sw = section.getByTestId('hdmi-switch')
  const msg = section.getByTestId('hdmi-message')
  const select = section.getByLabel('Target display')

  if (real.all.length === 1) {
    console.log('  HDMI branch: single display (no second screen connected)')
    check((await msg.textContent()) === NO_SECOND, `one display: "${await msg.textContent()}"`)
    // aria-disabled (not disabled): a real click still lands, so force it like a user would.
    await sw.click({ force: true })
    await sleep(500)
    check(
      (await sw.getAttribute('aria-checked')) === 'false' &&
        (await msg.textContent()) === NO_SECOND &&
        (await hdmiWindows()).length === 0,
      'toggling HDMI with one display keeps it off, shows the message, creates no window'
    )
    check(
      (await reject({ enabled: true, displayId: null })).endsWith(`Error: ${NO_SECOND}`),
      'main refuses to enable HDMI with one display (same message)'
    )
    check(
      (await select.isDisabled()) &&
        (await select.locator('option').allTextContents()).some((t) =>
          t.endsWith('(main display, operator)')
        ),
      'display select is disabled and marks the primary as "(main display, operator)"'
    )
    await pop.screenshot({ path: path.join(path.dirname(shot), 'task-11-popover-single.png') })
  } else {
    console.log('  HDMI branch: a real second display is connected')
    await realHdmiChecks(win, pop, real)
  }

  await simulatedHdmiChecks(win, real)
}

/** Real second display: the window covers exactly its bounds and never takes focus. */
/** Win32 rects in device pixels: windows titled HDMI_TITLE (of this app) and every monitor. */
function winRects() {
  const script = `
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public class PptW {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [StructLayout(LayoutKind.Sequential)] public struct R { public int L, T, Ri, B; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
}
"@
[PptW]::SetProcessDpiAwarenessContext([IntPtr]-4) | Out-Null
$out = @()
[PptW]::EnumWindows({ param($h, $p)
  $sb = New-Object System.Text.StringBuilder 256
  [PptW]::GetWindowText($h, $sb, 256) | Out-Null
  if ($sb.ToString() -eq '${HDMI_TITLE}' -and [PptW]::IsWindowVisible($h)) {
    $r = New-Object PptW+R; [PptW]::GetWindowRect($h, [ref]$r) | Out-Null
    $script:out += "W $($r.L) $($r.T) $($r.Ri) $($r.B)"
  }
  $true }, [IntPtr]::Zero) | Out-Null
$out
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Screen]::AllScreens | % { "S $($_.Bounds.X) $($_.Bounds.Y) $($_.Bounds.Right) $($_.Bounds.Bottom)" }
`
  const lines = execFileSync('powershell', ['-NoProfile', '-Command', script])
    .toString()
    .trim()
    .split(/\r?\n/)
  const rect = (l) => {
    const [, x, y, r, b] = l.trim().split(' ').map(Number)
    return { x, y, width: r - x, height: b - y }
  }
  return {
    windows: lines.filter((l) => l.startsWith('W ')).map(rect),
    screens: lines.filter((l) => l.startsWith('S ')).map(rect)
  }
}

async function realHdmiChecks(win, pop, real) {
  const section = pop.getByTestId('hdmi-section')
  const target = real.all.find((d) => d.id !== real.primary)
  await section.getByLabel('Target display').selectOption(String(target.id))
  if ((await section.getByTestId('hdmi-switch').getAttribute('aria-checked')) !== 'true') {
    await section.getByTestId('hdmi-switch').click()
  }
  await win.locator('[data-testid=hdmi-status][data-tone=ok]').waitFor({ timeout: 15_000 })
  const [w] = await hdmiWindows()
  check(
    w && w.visible && !w.offscreen && sameBounds(w.bounds, target.bounds),
    `HDMI window covers real display ${target.id} exactly: ${JSON.stringify(w?.bounds)} vs ${JSON.stringify(target.bounds)}`
  )
  check(!w.focusable && !w.focused, 'HDMI window is not focusable and not focused')
  const shown = await section.getByLabel('Target display').locator('option:checked').textContent()
  check(
    (await section.getByTestId('hdmi-message').textContent()) === 'Live',
    `popover: Live on "${shown}"`
  )
  await pop.screenshot({ path: path.join(path.dirname(shot), 'task-11-popover-real.png') })
  // Program is STANDBY here (the live deck was deleted): black.
  const hdmiPx = await waitHdmiCentre(isBlack, 'real HDMI window shows Program (STANDBY: black)')
  check(true, `real HDMI window shows Program: ${JSON.stringify(hdmiPx)}`)
  // Real pixels: the window's Win32 rect equals the monitor's rect exactly.
  const px = winRects()
  console.log(`  Win32: ${JSON.stringify(px)}`)
  const hwndRect = px.windows[0]
  check(
    px.screens.some((r) => sameBounds(r, hwndRect)),
    `HDMI window covers a monitor pixel-exactly: window ${JSON.stringify(hwndRect)}, monitors ${JSON.stringify(px.screens)}`
  )
  await section.getByTestId('hdmi-switch').click()
  await win.locator('[data-testid=hdmi-status][data-tone=off]').waitFor({ timeout: 10_000 })
  check((await hdmiWindows()).length === 0, 'turning HDMI off destroys the window')
  await win.keyboard.press('Escape')
}

/** Window lifecycle with simulated displays (unplug, re-plug with a new id, resolution change). */
async function simulatedHdmiChecks(win, real) {
  const pos = win.getByTestId('pos')
  const primary = real.all.find((d) => d.id === real.primary)
  const fakePrimary = {
    id: primary.id,
    label: primary.label || 'Display 1',
    width: primary.bounds.width,
    height: primary.bounds.height,
    primary: true,
    bounds: primary.bounds
  }
  // The fake display is a 480×270 corner of the real screen: off-screen
  // coordinates are not mapped like a real display (Windows DPI conversion), so
  // the window covers that corner for a few seconds instead.
  const pb = primary.bounds
  const corner = (w, h, dx = 0) => ({
    x: pb.x + pb.width - w - dx,
    y: pb.y + pb.height - h,
    width: w,
    height: h
  })
  const proj = {
    id: 424242,
    label: 'E2E PROYEKTOR',
    width: 1280,
    height: 720,
    primary: false,
    bounds: corner(480, 270)
  }
  const fake = fakeDisplays

  // Something live on Program: deck "dropped", slide 1 (white).
  await win.locator('.deck', { has: win.locator('.name', { hasText: /^dropped$/ }) }).click()
  await win.waitForFunction(
    () => document.querySelector('[data-testid=pos]')?.textContent === '01 / 03'
  )
  await win.keyboard.press('Space')
  await win.waitForFunction(
    () => document.querySelector('[data-testid=tally]')?.textContent === 'LIVE'
  )

  try {
    await fake([fakePrimary, proj])
    const pop = await openOutputPopover(win)
    const section = pop.getByTestId('hdmi-section')
    const select = section.getByLabel('Target display')
    await select
      .locator('option', { hasText: 'E2E PROYEKTOR · 1280×720' })
      .waitFor({ state: 'attached' })
    const options = await select.locator('option').allTextContents()
    check(
      (await section.getByTestId('hdmi-message').textContent()) === 'Off',
      `a second display appears in the select (displays:changed): ${JSON.stringify(options)}`
    )
    if (savedHdmi()?.displayId != null) {
      // A display chosen earlier (the real one) is not connected in this simulation.
      check(
        options.includes('Saved display (not connected)') &&
          (await select.inputValue()) === String(savedHdmi().displayId),
        'the saved but missing display stays selected as "Saved display (not connected)"'
      )
      await select.selectOption(String(proj.id))
      await win.waitForFunction(() => document.querySelector('#hdmi-display')?.value)
    }
    check((await select.inputValue()) === String(proj.id), 'the simulated display is selected')
    await section.getByTestId('hdmi-switch').click()
    await win.locator('[data-testid=hdmi-status][data-tone=ok]').waitFor({ timeout: 15_000 })
    const d1 = await hdmiDebug()
    const [w1] = await hdmiWindows()
    check(
      w1 && w1.visible && !w1.offscreen && w1.onTop && w1.url.endsWith('#/output'),
      `HDMI window shown (visible, on top, renders #/output): ${JSON.stringify(w1)}`
    )
    check(
      nearBounds(w1.bounds, proj.bounds),
      `HDMI window covers the display bounds ${JSON.stringify(w1.bounds)} (display ${JSON.stringify(proj.bounds)})`
    )
    check(
      d1.plans.slice(-2).join() === 'create,show' && d1.ready,
      `shown only after output:ready (plans: ${d1.plans.join(' → ')})`
    )
    check(!w1.focusable && !w1.focused, 'HDMI window is not focusable and never focused')
    check(
      (await section.getByTestId('hdmi-message').textContent()) === 'Live' &&
        (await win.getByTestId('hdmi-status').textContent()) === 'HDMI live',
      'popover says "Live", header "HDMI live"'
    )
    check(savedHdmi().enabled && savedHdmi().displayId === proj.id, 'settings.json hdmi saved')
    await pop.screenshot({ path: path.join(path.dirname(shot), 'task-11-popover-showing.png') })
    await win.getByTestId('output-chip-hdmi').screenshot({
      path: path.join(path.dirname(shot), 'task-11-header.png')
    })

    // Program on HDMI; operator shortcuts keep working (focus never moved).
    await win.keyboard.press('Escape')
    await waitHdmiCentre((p) => lum(p) > 200, 'HDMI window shows the live slide')
    await win.keyboard.press('b')
    await win.waitForFunction(
      () => document.querySelector('[data-testid=tally]')?.textContent === 'BLACK'
    )
    await waitHdmiCentre(isBlack, 'B makes the HDMI window black')
    await win.keyboard.press('b')
    await win.waitForFunction(
      () => document.querySelector('[data-testid=tally]')?.textContent === 'LIVE'
    )
    // To slide 1 (white), then Space to slide 2 (light blue).
    while ((await pos.textContent()) !== '01 / 03') {
      const before = await pos.textContent()
      await win.keyboard.press('ArrowLeft')
      await win.waitForFunction(
        (b) => document.querySelector('[data-testid=pos]')?.textContent !== b,
        before
      )
    }
    await waitHdmiCentre((p) => lum(p) > 200 && !blue(p), 'ArrowLeft shows white slide 1 on HDMI')
    await win.keyboard.press('Space')
    await win.waitForFunction(
      () => document.querySelector('[data-testid=pos]')?.textContent === '02 / 03'
    )
    await waitHdmiCentre((p) => blue(p), 'Space takes slide 2 (blue) live on HDMI')
    check(true, 'B and Space in the operator window drive the HDMI window')

    // Realtime zoom: the HDMI window follows the operator's zoom, and the next take resets it.
    const hdmiZoom = () =>
      app.evaluate(({ BrowserWindow }, title) => {
        const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === title)
        return w.webContents.executeJavaScript(`(() => {
          const el = document.querySelector('[data-testid="output-zoom"]')
          return el ? { zoom: el.getAttribute('data-zoom'), transform: el.style.transform || 'none' } : null
        })()`)
      }, HDMI_TITLE)
    const waitHdmiZoom = async (pred, what, timeout = 5000) => {
      const end = Date.now() + timeout
      let z = null
      while (Date.now() < end) {
        z = await hdmiZoom()
        if (z && pred(z)) return z
        await sleep(100)
      }
      throw new Error(`ASSERT: ${what} (last ${JSON.stringify(z)})`)
    }
    const zoomBtn = (name) => win.getByRole('button', { name, exact: true })
    await zoomBtn('Zoom in').click()
    await zoomBtn('Zoom in').click()
    const z1 = await waitHdmiZoom(
      (z) => z.zoom === '1.56' && z.transform !== 'none',
      'two Zoom in clicks give data-zoom 1.56 and a transform on the HDMI window'
    )
    check(true, `HDMI window zoomed: ${JSON.stringify(z1)}`)
    await zoomBtn('Pan right').click()
    const z2 = await waitHdmiZoom(
      (z) => z.transform !== z1.transform,
      'Pan right changes the HDMI transform'
    )
    check(z2.zoom === '1.56', 'Pan right keeps the zoom at 1.56')
    await win.keyboard.press('Space')
    await win.waitForFunction(
      () => document.querySelector('[data-testid=pos]')?.textContent === '03 / 03'
    )
    await waitHdmiZoom(
      (z) => z.zoom === '1.00' && z.transform === 'none',
      'taking the next slide resets the HDMI zoom to 1.00 with no transform'
    )
    // Back to slide 2 (blue) for the checks that follow.
    await win.keyboard.press('ArrowLeft')
    await win.waitForFunction(
      () => document.querySelector('[data-testid=pos]')?.textContent === '02 / 03'
    )
    await waitHdmiCentre((p) => blue(p), 'ArrowLeft returns the HDMI window to slide 2 (blue)')

    // Unplug: hidden in place (not moved onto the operator screen), amber status.
    await fake([fakePrimary])
    await win.locator('[data-testid=hdmi-status][data-tone=warn]').waitFor({ timeout: 5000 })
    const [w2] = await hdmiWindows()
    check(
      w2 && !w2.visible && nearBounds(w2.bounds, proj.bounds),
      `unplugged: window hidden and not moved (${JSON.stringify(w2?.bounds)})`
    )
    const pop2 = await openOutputPopover(win)
    check(
      (await pop2.getByTestId('hdmi-message').textContent()) === 'Hidden, display not connected',
      'popover says "Hidden, display not connected"'
    )
    await win.keyboard.press('Escape')

    // Re-plugged with a new id (same model and size): shown again, id saved.
    const again = { ...proj, id: 424243, bounds: corner(480, 270, 100) }
    await fake([fakePrimary, again])
    await win.locator('[data-testid=hdmi-status][data-tone=ok]').waitFor({ timeout: 5000 })
    const [w3] = await hdmiWindows()
    check(
      w3.visible && nearBounds(w3.bounds, again.bounds) && savedHdmi().displayId === again.id,
      `re-plugged with a new id: shown again on its bounds, id ${savedHdmi().displayId} saved`
    )
    await waitHdmiCentre((p) => blue(p), 'after re-plug the HDMI window shows the current slide')

    // Resolution change (display-metrics-changed): bounds re-applied.
    const bigger = {
      ...again,
      width: 1920,
      height: 1080,
      bounds: corner(640, 360, 100)
    }
    await fake([fakePrimary, bigger])
    await sleep(300)
    const [w4] = await hdmiWindows()
    check(
      w4.visible && nearBounds(w4.bounds, bigger.bounds),
      `resolution change: bounds follow ${JSON.stringify(w4.bounds)}`
    )
    check(
      (await hdmiDebug()).creates === d1.creates,
      'one HDMI window through unplug, re-plug and resize (never rebuilt)'
    )

    // The window refuses to close; turning HDMI off destroys it.
    await app.evaluate(({ BrowserWindow }, t) => {
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === t)
        .close()
    }, HDMI_TITLE)
    await sleep(300)
    check((await hdmiWindows()).length === 1, 'HDMI window cannot be closed')
    const pop3 = await openOutputPopover(win)
    await pop3.getByTestId('hdmi-switch').click()
    await win.locator('[data-testid=hdmi-status][data-tone=off]').waitFor({ timeout: 5000 })
    check(
      (await hdmiWindows()).length === 0 && savedHdmi().enabled === false,
      'turning HDMI off destroys the window and saves enabled=false'
    )
    await win.keyboard.press('Escape')
  } finally {
    await fake(null)
  }
  check(
    (await win.getByTestId('hdmi-status').textContent()) === 'HDMI off',
    'back to the real displays: HDMI off'
  )
}

// --- Video slides (fixtures/video-deck) ---
// Each video: an 80 px square (640×360 page) moves from x 40 to 520 over ~1 s,
// then holds; the page's PNG is the last frame. In 1920×1080 frame coordinates
// the square's row is y 420..660, its start x 120..360, its end x 1560..1800.
const V_START = [240, 540]
const V_END = [1680, 540]
const V_PTS = [V_START, V_END, [960, 540], [60, 60], [1860, 1020]]
const V_SWEEP = Array.from({ length: 15 }, (_, i) => [120 + i * 120, 540])
const near = (p, rgb, tol = 60) => p.every((c, i) => Math.abs(c - rgb[i]) < tol)
const V_BG = [22, 24, 29]
const BLUE = [30, 91, 255]
const V_YELLOW = [255, 212, 0]
const isRed = ([r, g, b]) => r > 150 && g < 100 && b < 100
const isMagenta = ([r, g, b]) => r > 150 && g < 100 && b > 140
const sameFrame = (a, b) => a.px.every((p, i) => near(p, b.px[i], 12))

/** Runs `src` in the HDMI output renderer. */
const hdmiJs = (src) =>
  app.evaluate(
    ({ BrowserWindow }, [title, s]) =>
      BrowserWindow.getAllWindows()
        .find((w) => !w.isDestroyed() && w.getTitle() === title)
        .webContents.executeJavaScript(s),
    [HDMI_TITLE, src]
  )

/** The newest on-screen (not pending) output layer: its media element and state. */
const OUTPUT_TOP = `(() => {
  const l = [...document.querySelectorAll('.output-layer:not([data-state=pending])')].pop()
  const v = l?.querySelector('video')
  const i = l?.querySelector('img')
  return v
    ? { kind: 'video', src: v.getAttribute('src'), t: v.currentTime, ended: v.ended, paused: v.paused, muted: v.muted }
    : i ? { kind: 'image', src: i.getAttribute('src') } : null
})()`

async function waitOutputTop(pred, what, timeout = 10_000) {
  const end = Date.now() + timeout
  let top = null
  while (Date.now() < end) {
    top = await hdmiJs(OUTPUT_TOP)
    if (top && pred(top)) return top
    await sleep(100)
  }
  throw new Error(`ASSERT: ${what} (last ${JSON.stringify(top)})`)
}

/** Polls output frames back to back (no sleep) until `pred(px)`; returns the frame. */
async function firstFrame(points, pred, what, timeout = 5000) {
  const end = Date.now() + timeout
  let f = null
  while (Date.now() < end) {
    f = await dumpFrame(points)
    if (f && pred(f.px)) return f
  }
  throw new Error(`ASSERT: ${what} (last frame: ${JSON.stringify(f?.px)})`)
}

/**
 * Runs in the output renderer for `ms`: on every animation frame, records the
 * topmost visible layer's readiness (1 = decoded image or a video with its
 * frame, 0 = nothing to show), and whether a layer with `watch` in its video
 * src is ever on screen or playing.
 */
function videoRecorder(ms, watch) {
  return new Promise((resolve) => {
    const out = { frames: [], watchCreated: 0, watchShown: 0, watchPlaying: 0 }
    const seen = new WeakSet()
    const end = performance.now() + ms
    const tick = () => {
      const layers = [...document.querySelectorAll('.output-layer')]
      const top = layers.filter((l) => Number(getComputedStyle(l).opacity) > 0).pop()
      const v = top?.querySelector('video')
      const i = top?.querySelector('img')
      out.frames.push((v && v.readyState >= 2) || (i && i.complete && i.naturalWidth > 0) ? 1 : 0)
      for (const l of layers) {
        const w = l.querySelector('video')
        if (!w || !(w.getAttribute('src') ?? '').includes(watch)) continue
        if (!seen.has(w)) {
          seen.add(w)
          out.watchCreated++
        }
        if (l.dataset.state !== 'pending') out.watchShown++
        if (!w.paused) out.watchPlaying++
      }
      if (performance.now() < end) requestAnimationFrame(tick)
      else resolve(out)
    }
    requestAnimationFrame(tick)
  })
}
const videoRecorderSrc = (ms, watch) =>
  `(${videoRecorder.toString()})(${ms}, ${JSON.stringify(watch)})`

/** Imports fixtures/video-deck into the open event (a new deck id each time); returns its id and row. */
async function importVideoFixture(win, id) {
  const ids = () =>
    win.$$eval('[data-testid=decks] .deck[data-deck-id]', (els) => els.map((e) => e.dataset.deckId))
  const before = await ids()
  await win.evaluate(
    async ([dir, jobId]) => {
      const { eventId } = await window.api.getSession()
      await window.api.importDecks(eventId, [{ id: jobId, path: dir }])
    },
    [path.join(root, 'fixtures/video-deck'), id]
  )
  await win.waitForFunction(
    (b) =>
      [...document.querySelectorAll('[data-testid=decks] .deck[data-deck-id]:not(.busy)')].some(
        (e) => !b.includes(e.dataset.deckId)
      ),
    before,
    { timeout: 30_000 }
  )
  const deckId = (await ids()).find((d) => !before.includes(d))
  return { deckId, row: win.locator(`.deck[data-deck-id="${deckId}"]`) }
}

async function videoChecks(win, tally) {
  const waitPos = (p) =>
    win.waitForFunction((x) => document.querySelector('[data-testid=pos]')?.textContent === x, p)
  const tallyIs = (t) =>
    win.waitForFunction((x) => document.querySelector('[data-testid=tally]')?.textContent === x, t)
  const blur = () => win.evaluate(() => document.activeElement?.blur())
  const liveDeck = win.locator('.deck', {
    has: win.locator('.name', { hasText: /^Session 1: Introduction$/ })
  })

  const importVideoDeck = (id) => importVideoFixture(win, id)
  const { row: vDeck } = await importVideoDeck('e2e-video')
  check(true, 'video deck imported for the playback checks')

  // 1. Plays once from the first frame, then holds the last frame. The Cut from
  //    the noise slide to the video never passes through a black frame.
  await vDeck.click()
  let cutBlack = 0
  const first = await firstFrame(
    V_PTS,
    (px) => {
      if (px.every(isBlack)) cutBlack++
      return near(px[1], V_BG, 12) && near(px[3], V_BG, 12)
    },
    'video slide 1 reaches the output'
  )
  await blur()
  await waitPos('01 / 05')
  // The strip marks the video slides (1, 3, 4) and leaves the image slides (2, 5) alone.
  const thumbVideo = await win.$$eval('[data-testid=strip] .th', (els) =>
    els.map((e) => ({
      v: e.dataset.video ?? null,
      mark: !!e.querySelector('[aria-label="Video slide"]')
    }))
  )
  check(
    thumbVideo.length === 5 &&
      thumbVideo.every((t, i) =>
        [0, 2, 3].includes(i) ? t.v === 'true' && t.mark : t.v === null && !t.mark
      ),
    `strip thumbnails 1, 3 and 4 carry data-video and the play mark, 2 and 5 do not (${JSON.stringify(thumbVideo)})`
  )
  await win.getByTestId('strip').screenshot({ path: path.join(frameDir, 'video-strip.png') })
  check(
    !near(first.px[1], V_YELLOW) && cutBlack === 0,
    `video starts from its first frame, no black frame on the Cut (end point ${JSON.stringify(first.px[1])}, ${cutBlack} black captures)`
  )
  const top1 = await waitOutputTop(
    (t) => t.kind === 'video' && t.src.endsWith('/001.mp4') && t.ended,
    'video slide 1 plays to its end on the output'
  )
  const held = await dumpFrame(V_PTS)
  check(
    near(held.px[1], V_YELLOW) && near(held.px[0], V_BG),
    `after the end the square is at its last position (start ${JSON.stringify(held.px[0])}, end ${JSON.stringify(held.px[1])})`
  )
  await sleep(1000)
  const later = await dumpFrame(V_PTS)
  check(
    sameFrame(held, later),
    `video slide: first frame differs from the last, then it holds (${JSON.stringify(later.px)})`
  )
  const pgm = await win.evaluate(() => {
    const v = [...document.querySelectorAll('.screen .pgm-layer video')].pop()
    return v ? { muted: v.muted, src: v.getAttribute('src') } : null
  })
  check(
    !top1.muted && pgm?.muted === true && pgm.src.endsWith('/001.mp4'),
    `output plays with sound, the Program monitor plays the same video muted (${JSON.stringify(pgm)})`
  )

  // 1b. Audio (Task 5): the HDMI section lists the sound devices and mutes the
  //     output's video at once; the choice is saved in settings.json.
  const apop = await openOutputPopover(win, 'sound')
  const devSel = apop.getByTestId('audio-device')
  // The device list arrives asynchronously (enumerateDevices); a machine without
  // any audio output only ever has the Default option.
  await devSel
    .locator('option')
    .nth(1)
    .waitFor({ state: 'attached', timeout: 3000 })
    .catch(() => {})
  const devOpts = await devSel.locator('option').allTextContents()
  check(
    devOpts[0] === 'Default (Windows)',
    `audio device list starts with the Default option (${JSON.stringify(devOpts)})`
  )
  const realDevs = devOpts.filter((t) => t !== 'Default (Windows)')
  const unnamed = realDevs.filter((t) => /^Audio device \d+$/.test(t))
  console.log(
    `  audio outputs: ${realDevs.length} real device(s); labels ${unnamed.length === 0 ? 'readable' : `EMPTY for ${unnamed.length}`}: ${JSON.stringify(realDevs)}`
  )
  const muteSw = apop.getByTestId('audio-mute')
  check(
    (await muteSw.getAttribute('aria-checked')) === 'false',
    'Mute audio starts off (the output plays with sound)'
  )
  await muteSw.click()
  const topMuted = await waitOutputTop(
    (t) => t.kind === 'video' && t.muted === true,
    'Mute audio mutes the output video'
  )
  await win.waitForFunction(
    () =>
      document.querySelector('[data-testid=audio-mute]')?.getAttribute('aria-checked') === 'true'
  )
  check(
    topMuted.muted && savedAudio().muted === true,
    `Mute audio mutes the HDMI output's playing video at once and is saved (${JSON.stringify(savedAudio())})`
  )
  await muteSw.click()
  await waitOutputTop((t) => t.kind === 'video' && t.muted === false, 'Mute off unmutes the video')
  check(savedAudio().muted === false, 'Mute audio off unmutes the output video again')
  if (realDevs.length > 0) {
    // Route to the first real device: setSinkId must take it without an error. The
    // output's sound goes through one AudioContext (setSinkId on the context); only
    // when the context refuses the device is it tried on the <video> elements. The
    // context is private to the renderer, so its setSinkId calls are recorded.
    await hdmiJs(`(() => {
      const proto = AudioContext.prototype
      if (!proto.setSinkId || window.__sinkCalls) return
      const calls = (window.__sinkCalls = [])
      const orig = proto.setSinkId
      proto.setSinkId = function (id) {
        const call = { id, ok: null }
        calls.push(call)
        return orig.call(this, id).then(
          (r) => ((call.ok = true), r),
          (e) => ((call.ok = false), Promise.reject(e))
        )
      }
    })()`)
    const optValue = await devSel.locator('option').nth(1).getAttribute('value')
    // `since` is how many context calls existed before the step, so a record from an
    // earlier step cannot satisfy it. The elements' own sinkId is accepted only when
    // the context has no setSinkId at all. A refusal is not a route: elements in the
    // graph play through the context, so the next setSink must succeed on it.
    const sinkOf = () =>
      hdmiJs(`({
        hasCtx: !!window.__sinkCalls,
        calls: (window.__sinkCalls ?? []).map((c) => ({ id: c.id, ok: c.ok })),
        videos: [...document.querySelectorAll('.output-layer video')].map((v) => v.sinkId)
      })`)
    const waitSink = async (want, since) => {
      const end = Date.now() + 5000
      let got = null
      while (Date.now() < end) {
        got = await sinkOf()
        const fresh = got.calls.slice(since)
        const viaCtx = fresh.some((c) => c.id === want && c.ok === true)
        const viaVideos =
          !got.hasCtx && got.videos.length > 0 && got.videos.every((x) => x === want)
        if (viaCtx || viaVideos) {
          return { via: viaCtx ? 'context' : 'videos', ...got }
        }
        await sleep(100)
      }
      return null
    }
    const callsSoFar = async () => (await sinkOf()).calls.length
    let since = await callsSoFar()
    await devSel.selectOption(optValue)
    const sink = await waitSink(optValue, since)
    check(
      sink !== null && savedAudio().deviceId === optValue,
      `choosing an audio device routes the output sound to it via setSinkId (${realDevs[0]}: ${JSON.stringify(sink)})`
    )
    since = await callsSoFar()
    await devSel.selectOption('')
    const back = await waitSink('', since)
    check(
      back !== null && savedAudio().deviceId === null,
      `choosing Default (Windows) routes back to the default device (${JSON.stringify(back)})`
    )
  } else {
    console.log('  (no audio output device on this machine: setSinkId routing not exercised)')
  }
  // A saved device that is not connected: warning in the section, default sink on the output.
  await win.evaluate(() => window.api.setAudio({ deviceId: 'gone-device', muted: false }))
  const missing = apop.getByTestId('audio-missing')
  await missing.waitFor()
  check(
    (await missing.textContent()) ===
      'The saved audio device is not connected. Sound plays on the Windows default device.',
    'a saved audio device that is gone shows the warning in the HDMI section'
  )
  await win.evaluate(() => window.api.setAudio({ deviceId: null, muted: false }))
  await missing.waitFor({ state: 'detached' })
  // The output popovers close with Escape or a click outside.
  await blur()

  // 1c. A hidden output window is silent (I2). Unplugging the display hides the
  //     window, it is not closed, and its video would keep sounding on the
  //     default device. Showing it again follows the saved Mute again.
  const wired = (await hdmiDebug()).displays
  const hdmiVisible = async (want) => {
    const end = Date.now() + 8000
    while (Date.now() < end) {
      if ((await hdmiDebug()).visible === want) return
      await sleep(100)
    }
    throw new Error(`ASSERT: the HDMI window becomes ${want ? 'visible' : 'hidden'}`)
  }
  await fakeDisplays(wired.filter((d) => d.id !== PROBE_ID))
  await hdmiVisible(false)
  // A hidden window is silenced by the sound plan (OutputAudio disconnects the gain node from the
  // speakers; the root exposes it as data-local), not by the video element's own `muted`, which
  // only follows the saved Mute setting.
  const soundLocal = async (want, what) => {
    const end = Date.now() + 10_000
    let last = null
    while (Date.now() < end) {
      last = await hdmiJs(`document.querySelector('.output')?.getAttribute('data-local')`)
      if (last === String(want)) return
      await sleep(100)
    }
    throw new Error(`ASSERT: ${what} (data-local ${last})`)
  }
  await soundLocal(false, 'a hidden output window plays no sound')
  check(
    savedAudio().muted === false,
    `unplugged: the hidden output plays no sound though the saved Mute is off (${JSON.stringify(savedAudio())})`
  )
  await fakeDisplays(wired)
  await hdmiVisible(true)
  await soundLocal(true, 'the output plays sound again when shown with Mute off')
  await waitOutputTop(
    (t) => t.kind === 'video' && t.muted === false,
    'the output is unmuted again when shown with Mute off'
  )
  check(true, 'shown again with Mute off: the output video plays with sound again')
  await win.evaluate(() => window.api.setAudio({ deviceId: null, muted: true }))
  await waitOutputTop((t) => t.kind === 'video' && t.muted === true, 'Mute on before unplugging')
  await fakeDisplays(wired.filter((d) => d.id !== PROBE_ID))
  await hdmiVisible(false)
  await soundLocal(false, 'a hidden output window plays no sound with Mute on')
  await fakeDisplays(wired)
  await hdmiVisible(true)
  await sleep(500) // time for a wrong unmute to show up
  const stillMuted = await hdmiJs(OUTPUT_TOP)
  check(
    stillMuted.kind === 'video' && stillMuted.muted === true,
    'shown again with Mute on: the output video stays muted (follows the saved setting)'
  )
  await win.evaluate(() => window.api.setAudio({ deviceId: null, muted: false }))
  await waitOutputTop((t) => t.kind === 'video' && t.muted === false, 'Mute off again after 1c')

  // 2. Black, then Black off: straight back to the last frame (the poster), no replay.
  await win.keyboard.press('b')
  await tallyIs('BLACK')
  await waitFrame(V_PTS, (px) => px.every(isBlack), 'B blacks out the video slide')
  const tOff = Date.now()
  await win.keyboard.press('b')
  const back = await firstFrame(V_PTS, (px) => !px.every(isBlack), 'Black off shows a frame')
  const dt = Date.now() - tOff
  const top2 = await hdmiJs(OUTPUT_TOP)
  check(
    sameFrame(back, held) && dt <= 300 && top2?.kind === 'image' && top2.src.endsWith('/001.png'),
    `Black then Black off shows the last frame at once (${dt} ms, ${JSON.stringify(top2)})`
  )
  await tallyIs('LIVE')

  // 3. Next to the image slide, Prev back: a new take replays the animation.
  await win.keyboard.press('ArrowRight')
  await waitPos('02 / 05')
  await waitFrame([[960, 540]], (px) => near(px[0], BLUE), 'slide 2 (blue) on the output')
  await win.keyboard.press('ArrowLeft')
  await waitPos('01 / 05')
  const again = await firstFrame(
    V_PTS,
    (px) => near(px[3], V_BG, 30),
    'Prev shows video slide 1 again'
  )
  check(
    !near(again.px[1], V_YELLOW),
    `Prev then Next replays the animation (end point ${JSON.stringify(again.px[1])} on the first frame)`
  )
  await waitOutputTop(
    (t) => t.kind === 'video' && t.src.endsWith('/001.mp4') && t.ended,
    'the replay plays to its end'
  )

  // 4. A pending video superseded by Next (Review Focus 1), made deterministic:
  //    the output holds back slide 3's `loadeddata`, so its layer stays pending
  //    until the next Next. It must be stopped (paused, src dropped) and removed,
  //    never shown and never playing.
  await win.keyboard.press('ArrowRight')
  await waitPos('02 / 05')
  await waitFrame([[960, 540]], (px) => near(px[0], BLUE), 'slide 2 (blue) for the pending check')
  await hdmiJs(`(() => {
    const h = (window.__hold = { created: 0, shown: 0, playing: 0, removed: [], on: true })
    h.stopLoad = (e) => {
      if (h.on && (e.target.getAttribute?.('src') ?? '').endsWith('/003.mp4')) e.stopImmediatePropagation()
    }
    addEventListener('loadeddata', h.stopLoad, true)
    const seen = new Set()
    h.obs = new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.removedNodes) {
        const v = n.querySelector?.('video')
        if (v && seen.has(v)) h.removed.push({ paused: v.paused, src: v.getAttribute('src') })
      }
    })
    h.obs.observe(document.querySelector('.output'), { childList: true, subtree: true })
    const tick = () => {
      for (const l of document.querySelectorAll('.output-layer')) {
        const v = l.querySelector('video')
        if (!v || !(v.getAttribute('src') ?? '').endsWith('/003.mp4')) continue
        if (!seen.has(v)) { seen.add(v); h.created++ }
        if (l.dataset.state !== 'pending') h.shown++
        if (!v.paused) h.playing++
      }
      if (h.on) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })()`)
  await win.keyboard.press('ArrowRight')
  await waitPos('03 / 05')
  await win.waitForTimeout(400)
  const held3 = await hdmiJs(
    `[...document.querySelectorAll('.output-layer')].map((l) => [l.dataset.state, l.querySelector('video,img')?.getAttribute('src')])`
  )
  const stillBlue = await dumpFrame([[960, 540]])
  check(
    held3.some(([st, src]) => st === 'pending' && src?.endsWith('/003.mp4')) &&
      near(stillBlue.px[0], BLUE),
    `slide 3's video is held pending, slide 2 stays on the output (${JSON.stringify(held3)})`
  )
  await win.keyboard.press('ArrowRight')
  await waitPos('04 / 05')
  await waitFrame(V_SWEEP, (px) => px.some(isMagenta), 'slide 4 (magenta) after the pending one')
  await win.waitForTimeout(200)
  const hold = await hdmiJs(`(() => {
    const h = window.__hold
    h.on = false
    removeEventListener('loadeddata', h.stopLoad, true)
    h.obs.disconnect()
    return { created: h.created, shown: h.shown, playing: h.playing, removed: h.removed }
  })()`)
  check(
    hold.created === 1 &&
      hold.shown === 0 &&
      hold.playing === 0 &&
      hold.removed.length === 1 &&
      hold.removed[0].paused &&
      hold.removed[0].src === null,
    `a pending video superseded by Next is paused and removed, never shown or playing (${JSON.stringify(hold)})`
  )

  // 4b. A video that never loads (M5): slide 3's `loadeddata` is held back and
  //     stays held; after PENDING_VIDEO_MS (3 s) the layer gives up and shows
  //     slide 3's poster instead of keeping slide 4 up for ever. Its failure is
  //     logged by design, so console.error is captured here (not an error of the run).
  await hdmiJs(`(() => {
    const h = (window.__stuck = { logs: [], on: true })
    h.stopLoad = (e) => {
      if (h.on && (e.target.getAttribute?.('src') ?? '').endsWith('/003.mp4')) e.stopImmediatePropagation()
    }
    addEventListener('loadeddata', h.stopLoad, true)
    h.orig = console.error
    console.error = (...a) => h.logs.push(a.map(String).join(' '))
  })()`)
  const tStuck = Date.now()
  await win.keyboard.press('ArrowLeft')
  await waitPos('03 / 05')
  await waitOutputTop(
    (t) => t.kind === 'image' && t.src.endsWith('/003.png'),
    'a video that never loads gives up and shows its poster',
    8000
  )
  const stuckMs = Date.now() - tStuck
  const stuck = await hdmiJs(`(() => {
    const h = window.__stuck
    h.on = false
    removeEventListener('loadeddata', h.stopLoad, true)
    console.error = h.orig
    return {
      logs: h.logs,
      playing: [...document.querySelectorAll('.output-layer video')].filter((v) => !v.paused).length
    }
  })()`)
  check(
    stuckMs >= 2800 &&
      stuckMs < 6000 &&
      stuck.playing === 0 &&
      stuck.logs.length === 1 &&
      /\[video\] .*003\.mp4 failed, showing its poster/.test(stuck.logs[0]),
    `a video stuck pending for 3 s shows its poster, nothing plays (${stuckMs} ms, ${JSON.stringify(stuck)})`
  )
  await win.keyboard.press('ArrowRight')
  await waitPos('04 / 05')
  await waitFrame(
    V_SWEEP,
    (px) => px.some(isMagenta),
    'back on slide 4 (magenta) after the stuck video'
  )

  // 5. Rapid Next over a video slide: from slide 2, two Nexts within a few ms.
  //    Slide 3 (red) must never show or play; slide 4 does.
  await win.keyboard.press('ArrowLeft')
  await waitPos('03 / 05')
  await win.keyboard.press('ArrowLeft')
  await waitPos('02 / 05')
  await waitFrame([[960, 540]], (px) => near(px[0], BLUE), 'back on slide 2 (blue)')
  // The slide 3 video layer of the step before is removed a moment after slide 2 is on screen;
  // wait for it, or the recorder would count that leftover as a layer shown by the Nexts.
  for (
    let n = 0;
    n < 40 && (await hdmiJs(`document.querySelectorAll('.output-layer').length`)) > 1;
    n++
  )
    await sleep(50)
  // Hold slide 3's `loadeddata` back, so its video cannot load before the second Next lands.
  await hdmiJs(`(() => {
    const h = (window.__rapid = { on: true })
    h.stopLoad = (e) => {
      if (h.on && (e.target.getAttribute?.('src') ?? '').endsWith('/003.mp4')) e.stopImmediatePropagation()
    }
    addEventListener('loadeddata', h.stopLoad, true)
  })()`)
  const rec = hdmiJs(videoRecorderSrc(1500, '/003.mp4'))
  await sleep(100)
  await win.evaluate(() => {
    void window.api.dispatch({ type: 'next' })
    void window.api.dispatch({ type: 'next' })
  })
  await waitPos('04 / 05')
  let reds = 0
  let magenta = 0
  let samples = 0
  const sweepEnd = Date.now() + 1300
  while (Date.now() < sweepEnd) {
    const f = await dumpFrame(V_SWEEP)
    if (!f) continue
    samples++
    if (f.px.some(isRed)) reds++
    if (f.px.some(isMagenta)) magenta++
  }
  const r = await rec
  await hdmiJs(`(() => {
    removeEventListener('loadeddata', window.__rapid.stopLoad, true)
    window.__rapid.on = false
  })()`)
  check(
    reds === 0 && magenta > 0 && r.watchShown === 0 && r.watchPlaying === 0,
    `rapid Next over a video slide never shows it (${samples} frames: ${reds} red, ${magenta} magenta; slide 3 video created ${r.watchCreated}x, shown ${r.watchShown}, playing ${r.watchPlaying})`
  )

  // 6. Fade, video to video (Review Focus 2): slide 3 (red) to 4 (magenta).
  await win.keyboard.press('ArrowLeft')
  await waitPos('03 / 05')
  await waitOutputTop(
    (t) => t.kind === 'video' && t.src.endsWith('/003.mp4') && t.ended,
    'slide 3 plays to its end'
  )
  // Transition lives in the Controls tab.
  await win.getByRole('tab', { name: 'Controls' }).click()
  await win.getByRole('radio', { name: 'Fade' }).click()
  await blur()
  const fadeRec = hdmiJs(videoRecorderSrc(900, '/none'))
  await sleep(100)
  await win.keyboard.press('Space')
  let blackFrames = 0
  let fadeSamples = 0
  const fadeEnd = Date.now() + 400
  while (Date.now() < fadeEnd) {
    const f = await dumpFrame(GRID)
    if (!f) continue
    fadeSamples++
    if (f.px.every(isBlack)) blackFrames++
  }
  const fr = await fadeRec
  await waitPos('04 / 05')
  await waitFrame(V_SWEEP, (px) => px.some(isMagenta), 'Fade reaches slide 4 (magenta)')
  check(
    blackFrames === 0 && fr.frames.length > 10 && fr.frames.every((n) => n === 1),
    `fade video to video never shows black (${fadeSamples} captures, ${blackFrames} black; ${fr.frames.length} animation frames, min ${Math.min(...fr.frames)})`
  )
  await win.getByRole('radio', { name: 'Cut' }).click()
  await blur()

  // 7. Missing MP4 (runs last: it deletes 003.mp4): slide 3 shows its PNG.
  //    Chromium keeps media it already loaded in memory by URL (also across a
  //    reload), so this uses a fresh import of the deck whose 003.mp4 was never loaded.
  const { deckId: mId, row: mDeck } = await importVideoDeck('e2e-video-missing')
  fs.rmSync(path.join(userData, 'decks', mId, '003.mp4'))
  await mDeck.click()
  await blur()
  await waitPos('01 / 05')
  await win.keyboard.press('ArrowRight')
  await waitPos('02 / 05')
  await win.keyboard.press('ArrowRight')
  await waitPos('03 / 05')
  const png = await app.evaluate(
    ({ nativeImage }, [file, pts]) => {
      const img = nativeImage.createFromPath(file)
      const { width } = img.getSize()
      const bmp = img.toBitmap()
      return pts.map(([x, y]) => {
        const i = (Math.floor(y / 3) * width + Math.floor(x / 3)) * 4
        return [bmp[i + 2], bmp[i + 1], bmp[i]]
      })
    },
    [path.join(userData, 'decks', mId, '003.png'), V_PTS]
  )
  const top7 = await waitOutputTop(
    (t) => t.src.includes(mId) && t.src.endsWith('/003.png'),
    'missing MP4: the output layer is the poster image'
  )
  const poster = await waitFrame(
    V_PTS,
    (px) => px.every((p, i) => near(p, png[i], 12)),
    'missing MP4: the output shows the PNG'
  )
  check(
    isRed(poster.px[1]) && top7.kind === 'image',
    `missing MP4 shows the poster (${JSON.stringify(poster.px)} = PNG ${JSON.stringify(png)})`
  )

  // Back to the state the next checks expect: the renamed noise deck on 3 / 4, no video deck.
  await liveDeck.click()
  await blur()
  await waitPos('01 / 04')
  await win.keyboard.press('Space')
  await waitPos('02 / 04')
  await win.keyboard.press('Space')
  await waitPos('03 / 04')
  for (const row of [vDeck, mDeck]) {
    await row.click({ button: 'right' })
    await win.getByTestId('deck-menu').getByRole('menuitem', { name: 'Remove deck…' }).click()
    await win.getByTestId('confirm-remove').getByRole('button', { name: 'Remove' }).click()
    await row.waitFor({ state: 'detached' })
  }
  check((await tally.textContent()) === 'LIVE', 'video checks done, back on the noise deck')
  return { missingDeckId: mId }
}

// --- Video files imported directly (one file = one deck with one video slide) ---
/** ffmpeg on PATH, or null (the section is skipped with a clear log line). */
function ffmpegPath() {
  for (const bin of ['ffmpeg', 'ffmpeg.exe']) {
    try {
      execFileSync(bin, ['-version'], { stdio: 'ignore' })
      return bin
    } catch {
      // not on PATH
    }
  }
  return null
}

async function videoFileChecks(win) {
  const ffmpeg = ffmpegPath()
  if (!ffmpeg) {
    console.log('SKIP video file import: ffmpeg is not installed (its fixtures cannot be made).')
    return
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-share-video-file-'))
  const mp4 = path.join(dir, 'clip.mp4')
  const webm = path.join(dir, 'clip-webm.webm')
  execFileSync(ffmpeg, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=#1e3bff:s=640x360:d=2',
    '-pix_fmt',
    'yuv420p',
    mp4
  ])
  execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=#ffd400:s=640x360:d=2', webm])
  const fake = path.join(dir, 'fake.mp4')
  fs.writeFileSync(fake, 'this is not a video')
  const empty = path.join(dir, 'empty.mp4')
  fs.writeFileSync(empty, '')

  const decksNow = () =>
    win.$$eval('[data-testid=decks] .deck[data-deck-id]', (els) => els.map((e) => e.dataset.deckId))
  const namesNow = () =>
    win.$$eval('[data-testid=decks] .deck .name', (els) => els.map((e) => e.textContent))
  const errorsNow = () =>
    win.$$eval('[data-testid=import-error], .import-error', (els) => els.map((e) => e.textContent))

  const before = await decksNow()
  const beforeErrors = (await errorsNow()).length
  await win.evaluate(
    async ([files]) => {
      const { eventId } = await window.api.getSession()
      await window.api.importDecks(
        eventId,
        files.map((f, i) => ({ id: `e2e-video-file-${i}-${Date.now()}`, path: f }))
      )
    },
    [[mp4, webm, fake, empty]]
  )
  await win.waitForFunction(
    (b) =>
      [...document.querySelectorAll('[data-testid=decks] .deck[data-deck-id]:not(.busy)')].filter(
        (e) => !b.includes(e.dataset.deckId)
      ).length >= 2,
    before,
    { timeout: 60_000 }
  )
  const added = (await decksNow()).filter((d) => !before.includes(d))
  const names = await namesNow()
  check(added.length === 2, `two deck files become two decks (got ${added.length})`)
  check(
    names.includes('clip') && names.includes('clip-webm'),
    `decks are named after the files (${JSON.stringify(names)})`
  )

  // Each new deck has exactly one slide, with a play mark in the strip.
  await win.locator(`.deck[data-deck-id="${added[0]}"]`).click()
  await win.evaluate(() => document.activeElement?.blur())
  await win.waitForFunction(() => document.querySelector('[data-testid=pos]')?.textContent === '01 / 01')
  await win.keyboard.press('Space')
  await win.waitForFunction(
    () => document.querySelector('[data-testid=tally]')?.textContent === 'LIVE'
  )
  const top = await waitOutputTop((t) => t.kind === 'video', 'a direct video file plays on HDMI')
  check(top.kind === 'video', `the imported video file reaches the output (${top.src})`)

  // The poster PNG is the video's own size (640x360).
  const posterSize = await win.evaluate(async (deckId) => {
    const { eventId } = await window.api.getSession()
    const decks = await window.api.listDecks(eventId)
    const deck = decks.find((d) => d.id === deckId)
    return deck ? { width: deck.width, height: deck.height, slides: deck.slides.length } : null
  }, added[0])
  check(
    !!posterSize && posterSize.width === 640 && posterSize.height === 360 && posterSize.slides === 1,
    `the deck keeps the video size and one slide (${JSON.stringify(posterSize)})`
  )

  // A file renamed .mp4 that is not a video, and a 0-byte file, become error rows and no deck.
  const afterBad = await decksNow()
  const errors = await errorsNow()
  check(
    errors.length > beforeErrors,
    `the fake and empty files are refused with a message (${JSON.stringify(errors)})`
  )
  check(
    afterBad.length === added.length + before.length,
    'no deck was left behind for a refused video file'
  )

  // Remove the two decks so the following checks keep their deck list. The live one goes off
  // air with its deck, so put the deck that was live before this section back on air.
  for (const id of added) {
    const row = win.locator(`.deck[data-deck-id="${id}"]`)
    await row.click({ button: 'right' })
    await win.getByTestId('deck-menu').getByRole('menuitem', { name: 'Remove deck…' }).click()
    await win.getByTestId('confirm-remove').getByRole('button', { name: 'Remove' }).click()
    await row.waitFor({ state: 'detached' })
  }
  const back = win.locator('.deck', {
    has: win.locator('.name', { hasText: /^Session 1: Introduction$/ })
  })
  await back.click()
  await win.evaluate(() => document.activeElement?.blur())
  await win.waitForFunction(() => document.querySelector('[data-testid=pos]')?.textContent === '01 / 04')
  await win.keyboard.press('Space')
  await win.waitForFunction(() => document.querySelector('[data-testid=pos]')?.textContent === '02 / 04')
  await win.keyboard.press('Space')
  await win.waitForFunction(() => document.querySelector('[data-testid=pos]')?.textContent === '03 / 04')
  check(
    await win.waitForFunction(
      () => document.querySelector('[data-testid=tally]')?.textContent === 'LIVE',
      undefined,
      { timeout: 5000 }
    ),
    'video file checks done, the previous deck is live again'
  )
  fs.rmSync(dir, { recursive: true, force: true })
}

// --- Canvas, Fit and audio levels (2026-10-27) ---
// Read back from the HDMI output renderer: `.output-stage[data-canvas]`, the
// newest on-screen layer's `data-fit`, and `.output[data-gain]`.
const OUT_CANVAS = `document.querySelector('.output-stage')?.dataset.canvas ?? null`
const OUT_FIT = `[...document.querySelectorAll('.output-layer:not([data-state=pending])')].pop()?.dataset.fit ?? null`
const OUT_GAIN = `document.querySelector('.output')?.dataset.gain ?? null`
const CANVAS_INVALID_TEXT =
  'Use a width and height from 320 to 7680 pixels, at most 3840×2160 in total.'

/** Polls an expression in the HDMI renderer until it equals `want`. */
async function waitOut(src, want, what, timeout = 8000) {
  const end = Date.now() + timeout
  let got = null
  while (Date.now() < end) {
    got = await hdmiJs(src)
    if (got === want) return got
    await sleep(100)
  }
  throw new Error(`ASSERT: ${what} (wanted ${JSON.stringify(want)}, last ${JSON.stringify(got)})`)
}

/**
 * Canvas per machine and per event, Fit of the live deck, deck and master
 * volume: each is read back from the HDMI output. Runs with the probe on and
 * the noise deck live (image slide), and leaves the app as it found it.
 */
async function canvasAndLevelsChecks(win, tally) {
  const waitPos = (p) =>
    win.waitForFunction((x) => document.querySelector('[data-testid=pos]')?.textContent === x, p)
  const waitTally = (t) =>
    win.waitForFunction((x) => document.querySelector('[data-testid=tally]')?.textContent === x, t)
  const blur = () => win.evaluate(() => document.activeElement?.blur())
  const session = () => win.evaluate(() => window.api.getSession())
  const liveDeckId = () =>
    win.evaluate(() => document.querySelector('.deck.live')?.getAttribute('data-deck-id') ?? null)
  const { eventId } = await session()
  const pickEvent = async (name) => {
    // Tabs are not brought back after a restart: an event without a tab is opened from Home.
    const tab = win.locator('[role=tab]', { hasText: name })
    if ((await tab.count()) > 0) await tab.click({ timeout: 4000 })
    else {
      await win.getByTestId('home-btn').click()
      await win.getByTestId('home-card').filter({ hasText: name }).first().click({ timeout: 4000 })
    }
    await win.locator('[role=tab][aria-selected=true]', { hasText: name }).waitFor()
  }

  // 1. Canvas. Default 1920×1080; an event override applies at once, follows the
  //    event in and out, and a machine default outside the limits is refused.
  await waitOut(OUT_CANVAS, '1920x1080', 'the output starts on the default 1920x1080 canvas')
  check(true, 'output canvas is 1920x1080 by default')
  await win.evaluate((id) => window.api.setEventCanvas(id, { width: 3840, height: 1080 }), eventId)
  await waitOut(OUT_CANVAS, '3840x1080', 'an event canvas of 3840x1080 reaches the output')
  check(true, 'event canvas 3840x1080: the output stage switches to data-canvas="3840x1080"')
  // The canvas belongs to the event on air, not to the event being looked at (c114e0f): viewing
  // another event never changes the output.
  await pickEvent('Event Kedua')
  await sleep(600) // time for a wrong switch to reach the output
  check(
    (await hdmiJs(OUT_CANVAS)) === '3840x1080',
    'viewing another event keeps the on-air event canvas (3840x1080)'
  )
  await pickEvent('Smoke Event')
  await waitOut(OUT_CANVAS, '3840x1080', 'the on-air event keeps its 3840x1080 canvas')
  check(true, 'viewing the first event again: the output is still 3840x1080')
  const badDefault = await win.evaluate(() =>
    window.api.setDefaultCanvas({ width: 10, height: 10 }).then(
      () => 'ok',
      (e) => String(e.message)
    )
  )
  check(
    badDefault !== 'ok' && badDefault.includes(CANVAS_INVALID_TEXT),
    `a 10x10 machine canvas is refused with the exact message ("${badDefault}")`
  )
  await win.evaluate((id) => window.api.setEventCanvas(id, null), eventId)
  await waitOut(OUT_CANVAS, '1920x1080', 'removing the event canvas goes back to the default')
  check(true, 'event canvas removed (Use default): the output is 1920x1080 again')

  // 2. Fit of a live image slide (the noise deck): Fill, Stretch, then the KV is always Fit.
  // The library re-renders after the event switch: wait for the live row to be back.
  await win.locator('.deck.live').waitFor()
  const noiseId = await liveDeckId()
  check(
    !!noiseId && (await tally.textContent()) === 'LIVE',
    'an image slide is live for the Fit checks'
  )
  await waitOut(OUT_FIT, 'fit', 'a deck starts with Fit')
  await win.evaluate(([e, d]) => window.api.setDeckFit(e, d, 'fill'), [eventId, noiseId])
  await waitOut(OUT_FIT, 'fill', 'Fill reaches the live layer')
  await win.evaluate(([e, d]) => window.api.setDeckFit(e, d, 'stretch'), [eventId, noiseId])
  await waitOut(OUT_FIT, 'stretch', 'Stretch reaches the live layer')
  check(true, 'live image slide: Fit -> Fill -> Stretch updates the layer data-fit')
  const kvPath = path.join(frameDir, 'kv-fit.png')
  await kvPng(kvPath)
  await win.setInputFiles('[data-testid=kv-input]', kvPath)
  await win.locator('[data-testid=kv-thumb] img').waitFor({ timeout: 10_000 })
  await blur()
  await win.keyboard.press('k')
  await waitTally('KV')
  await waitFrame(GRID, (px) => px.every(isKv), 'KV on the output while the deck is Stretch')
  await waitOut(OUT_FIT, 'fit', 'the KV layer is always Fit')
  check(true, 'KV on: the top layer is data-fit="fit" though the deck is Stretch')
  await win.keyboard.press('k')
  await waitTally('LIVE')
  await waitOut(OUT_FIT, 'stretch', 'KV off returns to the Stretch slide')
  await win.evaluate(([e, d]) => window.api.setDeckFit(e, d, 'fit'), [eventId, noiseId])
  await waitOut(OUT_FIT, 'fit', 'Fit again')
  await win.getByTestId('kv-block').getByRole('button', { name: 'Remove' }).click()
  await win.locator('[data-testid=kv-thumb] img').waitFor({ state: 'detached' })
  check(true, 'KV off, deck back on Fit, test KV removed')

  // 3. Volume of a live video slide: deck 50 x master 50 = gain 0.25 without
  //    replaying the video (same <video>, same take); a muted deck is silent.
  const { deckId: vId, row: vRow } = await importVideoFixture(win, 'e2e-levels')
  await vRow.click()
  await blur()
  await waitPos('01 / 05')
  await waitOutputTop(
    (t) => t.kind === 'video' && t.src.endsWith('/001.mp4') && t.ended,
    'the video slide plays to its end before the volume changes'
  )
  await waitOut(OUT_GAIN, '1.00', 'full volume at the start')
  const takeBefore = (await session()).state.take
  await hdmiJs(`(() => {
    window.__levelsVideo = [...document.querySelectorAll('.output-layer video')].pop()
    return !!window.__levelsVideo
  })()`)
  // Same element, still connected, still at its end (a replay would reset it).
  const sameVideo = () =>
    hdmiJs(`(() => {
      const v = window.__levelsVideo
      return !!v && v.isConnected && v.ended && v.currentTime > 0.5 &&
        v === [...document.querySelectorAll('.output-layer video')].pop()
    })()`)
  check(await sameVideo(), 'the live video is marked on the output before the volume changes')
  await win.evaluate(() => window.api.setAudio({ deviceId: null, muted: false, masterVolume: 50 }))
  await win.evaluate(
    ([e, d]) => window.api.setDeckAudio(e, d, { volume: 50, muted: false }),
    [eventId, vId]
  )
  await waitOut(OUT_GAIN, '0.25', 'deck 50 and master 50 give gain 0.25')
  check(
    (await sameVideo()) && (await session()).state.take === takeBefore,
    `deck 50 x master 50: output gain 0.25, same <video> and take ${takeBefore} (no replay)`
  )
  await win.evaluate(
    ([e, d]) => window.api.setDeckAudio(e, d, { volume: 50, muted: true }),
    [eventId, vId]
  )
  await waitOut(OUT_GAIN, '0.00', 'a muted deck gives gain 0')
  check(
    (await sameVideo()) && (await session()).state.take === takeBefore,
    'deck muted: output gain 0.00, still the same <video> and take'
  )
  await win.evaluate(
    ([e, d]) => window.api.setDeckAudio(e, d, { volume: 100, muted: false }),
    [eventId, vId]
  )
  await win.evaluate(() => window.api.setAudio({ deviceId: null, muted: false, masterVolume: 100 }))
  await waitOut(OUT_GAIN, '1.00', 'volumes back to 100')
  check(
    (await sameVideo()) && (await session()).state.take === takeBefore,
    'volumes back to 100: output gain 1.00, same <video> and take'
  )

  // 4. Fit of the live video slide: Fill reaches the video layer, and it is the
  //    same <video> (not replayed) with the same take; then back to Fit.
  await win.evaluate(([e, d]) => window.api.setDeckFit(e, d, 'fill'), [eventId, vId])
  await waitOut(OUT_FIT, 'fill', 'Fill reaches the live video layer')
  check(
    (await sameVideo()) && (await session()).state.take === takeBefore,
    `live video slide: Fill sets data-fit="fill" on the video layer, same <video> and take ${takeBefore} (no replay)`
  )
  await win.evaluate(([e, d]) => window.api.setDeckFit(e, d, 'fit'), [eventId, vId])
  await waitOut(OUT_FIT, 'fit', 'Fit again on the video layer')
  check(
    (await sameVideo()) && (await session()).state.take === takeBefore,
    'live video slide: back to Fit, still the same <video> and take'
  )

  // Back to the state the next checks expect: the noise deck on 3 / 4, no video deck.
  await vRow.click({ button: 'right' })
  await win.getByTestId('deck-menu').getByRole('menuitem', { name: 'Remove deck…' }).click()
  await win.getByTestId('confirm-remove').getByRole('button', { name: 'Remove' }).click()
  await vRow.waitFor({ state: 'detached' })
  await win.locator(`.deck[data-deck-id="${noiseId}"]`).click()
  await blur()
  await waitPos('01 / 04')
  await win.keyboard.press('Space')
  await waitPos('02 / 04')
  await win.keyboard.press('Space')
  await waitPos('03 / 04')
  check(
    (await tally.textContent()) === 'LIVE',
    'canvas and level checks done, back on the noise deck'
  )
}

const errors = []
// A failed load names no URL in its text; add the resource's URL from the location.
const msgText = (m) => {
  const url = m.location()?.url
  return url && !m.text().includes(url) ? `${m.text()} (${url})` : m.text()
}
let failed = false
try {
  // The HDMI output window is checked for console errors too.
  app.on('window', (page) => {
    const isOutput = () => page.url().endsWith('#/output')
    page.on('console', (m) => {
      if (isOutput() && m.type() === 'error') errors.push(`[output] ${msgText(m)}`)
    })
    page.on('pageerror', (e) => {
      if (isOutput()) errors.push(`[output] ${e}`)
    })
  })
  const win = await app.firstWindow()
  win.on('console', (m) => {
    if (m.type() === 'error') errors.push(msgText(m))
  })
  win.on('pageerror', (e) => errors.push(String(e)))
  await win.waitForSelector('.app')

  // 1280×720 window: the Program panel and controls must stay on screen.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() !== 'Bridgecast HDMI')
    w.setMinimumSize(800, 500)
    w.setContentSize(1280, 720)
  })
  await win.waitForTimeout(500)
  console.log('viewport', await win.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]))

  const tally = win.getByTestId('tally')
  const pos = win.getByTestId('pos')
  const cap = win.locator('.next-card .cap')
  check((await tally.textContent()) === 'STANDBY', 'empty app shows STANDBY')
  check((await win.locator('footer').textContent()).includes('No slides yet'), 'empty strip')
  await startProbe(win)

  // Create an event through the event menu.
  await win.click('.newbtn')
  await win.fill('[data-testid=new-event-name]', 'Smoke Event')
  await win.press('[data-testid=new-event-name]', 'Enter')
  await win.locator('[role=tab][aria-selected=true]', { hasText: 'Smoke Event' }).waitFor()
  check(true, 'event created and selected')
  check(
    (await win.locator('.left').textContent()).includes('No decks in this event yet'),
    'empty library message'
  )

  // KV (key visual) while STANDBY: no KV, KV button disabled, output black;
  // upload -> the output shows the KV by itself (tally stays STANDBY); remove
  // -> button disabled and black again.
  const kvPath = path.join(frameDir, 'kv.png')
  await kvPng(kvPath)
  const kvBtn = win.locator('.transport button', { hasText: 'KV' })
  // The image on air in the Program monitor: the newest non-pending layer (a fading
  // layer counts, the pending one is not on screen yet).
  const ON_AIR =
    '.screen .pgm-layer[data-state="shown"] img, .screen .pgm-layer[data-state="fade"] img'
  const waitOnAirSrc = async (prefix, what) => {
    await win.waitForFunction(
      ([sel, pre]) => {
        const imgs = document.querySelectorAll(sel)
        const last = imgs[imgs.length - 1]
        return !!last && (last.getAttribute('src') ?? '').startsWith(pre)
      },
      [ON_AIR, prefix],
      { timeout: 10_000 }
    )
    check(true, what)
    return win.locator(ON_AIR).last().getAttribute('src')
  }
  const kvRemove = () => win.getByTestId('kv-block').getByRole('button', { name: 'Remove' })
  check(await kvBtn.isDisabled(), 'no KV: the KV button is disabled')
  check(
    (await win.getByTestId('kv-block').textContent()).includes('No KV yet'),
    'no KV: the library shows "No KV yet"'
  )
  await win.setInputFiles('[data-testid=kv-input]', kvPath)
  await win.locator('[data-testid=kv-thumb] img').waitFor({ timeout: 10_000 })
  await waitFrame(GRID, (px) => px.every(isKv), 'STANDBY shows the KV on the output')
  check(true, `STANDBY with a KV: the output shows the KV colour (${GRID.length} sample points)`)
  check((await tally.textContent()) === 'STANDBY', 'automatic KV keeps the STANDBY tally')
  check(!(await kvBtn.isDisabled()), 'with a KV: the KV button is enabled')
  await waitOnAirSrc('slide://kv/', 'Program monitor shows the KV at STANDBY too')
  // The automatic KV is on air, but it can still be removed: the standby goes black.
  check(!(await kvRemove().isDisabled()), 'KV on air at STANDBY: Remove is enabled')
  check(
    (await win.getByTestId('kv-hint').count()) === 0,
    'no hint: Remove always releases the KV'
  )
  // K at STANDBY with a KV: the output really leaves the KV (black, tally BLACK); K again brings it back.
  const tallyNow = async (t) =>
    win.waitForFunction((x) => document.querySelector('[data-testid=tally]')?.textContent === x, t)
  await win.keyboard.press('k')
  await tallyNow('BLACK')
  await waitFrame(GRID, (px) => px.every(isBlack), 'K at STANDBY makes the output black')
  check(
    (await kvBtn.getAttribute('aria-pressed')) === 'false',
    'K at STANDBY: KV button not pressed'
  )
  await win.keyboard.press('k')
  await tallyNow('KV')
  await waitFrame(GRID, (px) => px.every(isKv), 'K again brings the KV back at STANDBY')
  check((await kvBtn.getAttribute('aria-pressed')) === 'true', 'KV back: KV button pressed')
  await win.keyboard.press('k')
  await tallyNow('BLACK')
  check(!(await kvRemove().isDisabled()), 'KV off: Remove is enabled again')
  check((await win.getByTestId('kv-hint').count()) === 0, 'KV off: no hint')
  await kvRemove().click()
  await kvBtn.waitFor()
  await win.waitForFunction(
    () =>
      [...document.querySelectorAll('.transport button')].find((b) => b.textContent.includes('KV'))
        ?.disabled
  )
  await waitFrame(GRID, (px) => px.every(isBlack), 'removing the KV makes STANDBY black again')
  check(true, 'KV removed: button disabled and STANDBY black again')
  // Clear the Black left over from turning the KV off with K, so the next slide shows.
  await win.keyboard.press('b')
  await win.waitForFunction(
    () =>
      [...document.querySelectorAll('.transport button')]
        .find((b) => b.textContent.includes('Black'))
        ?.getAttribute('aria-pressed') === 'false'
  )
  await win.setInputFiles('[data-testid=kv-input]', path.join(root, 'fixtures/sample.pdf'))
  await win.getByTestId('kv-error').waitFor()
  check(
    (await win.getByTestId('kv-error').textContent()).includes('KV format is not supported'),
    'a non-image KV is refused with an inline error'
  )

  // Import the PDF through the Decks panel footer's file input (pdf.js in the renderer).
  await win.setInputFiles('[data-testid=file-input]', path.join(root, 'fixtures/sample.pdf'))
  await win
    .locator('.deck .meta', { hasText: '3 slides' })
    .waitFor({ timeout: 60_000 })
    .catch(async (e) => {
      console.error('library:', await win.locator('.left').textContent())
      throw e
    })
  check(true, 'PDF imported as a 3-slide deck')
  check((await pos.textContent()) === '01 / 03', 'position on slide 1 after import')
  check((await tally.textContent()) === 'STANDBY', 'import does not change the output')
  check(
    (await cap.textContent()).includes('slide 1'),
    'STANDBY: Next panel shows slide 1 (what Next takes)'
  )

  // First Space from STANDBY takes slide 1 live (no skip).
  await win.keyboard.press('Space')
  await win.waitForFunction(
    () => document.querySelector('[data-testid=tally]')?.textContent === 'LIVE'
  )
  check((await pos.textContent()) === '01 / 03', 'first Space takes slide 1 LIVE')
  check((await cap.textContent()).includes('slide 2'), 'Next panel then shows slide 2')
  // A PDF plays as vector: its layer is a canvas, not an image. Then the deck goes to still
  // images so the image checks below stay meaningful.
  await win.locator('.screen canvas').first().waitFor({ state: 'visible', timeout: 10_000 })
  check(true, 'a vector PDF is on air: .screen canvas is visible')
  {
    const { eventId: pdfEvent } = await win.evaluate(() => window.api.getSession())
    const pdfDecks = await win.evaluate((e) => window.api.listDecks(e), pdfEvent)
    for (const d of pdfDecks.filter((x) => x.playback === 'vector')) {
      await win.evaluate(([e, i]) => window.api.setDeckPlayback(e, i, 'images'), [pdfEvent, d.id])
    }
  }

  // Output: slide 1 (white 16:9 page) fills the 16:9 HDMI window.
  const f1 = await waitFrame(
    [CENTRE, [10, 10], [1910, 1070]],
    (px) => px.every((p) => lum(p) > 200),
    'output shows slide 1'
  )
  check(
    true,
    `16:9 slide fills the HDMI window (${f1.width}×${f1.height} px), centre ${JSON.stringify(f1.px[0])}`
  )

  await noBlackGap(win, () => win.keyboard.press('Space'), 'Next with Cut')
  await win.waitForFunction(
    () => document.querySelector('[data-testid=pos]')?.textContent === '02 / 03'
  )
  check((await tally.textContent()) === 'LIVE', 'Space puts the next slide LIVE')
  check((await cap.textContent()).includes('slide 3'), 'Next panel shows slide 3')
  await waitFrame([[10, 10]], (px) => blue(px[0]), 'output follows to slide 2')
  check(true, 'output follows Space to slide 2')
  const img = win.locator('.screen img')
  await img.waitFor()
  await win.waitForFunction(() => {
    const i = document.querySelector('.screen img')
    return i && i.complete && i.naturalWidth > 0
  })
  const natural = await img.evaluate((i) => [i.naturalWidth, i.naturalHeight])
  check(
    natural[0] === 1920 && natural[1] === 1080,
    `slide:// image loads at 1920×1080 (${natural})`
  )

  await win.keyboard.press('ArrowRight')
  await win.waitForFunction(
    () => document.querySelector('[data-testid=pos]')?.textContent === '03 / 03'
  )
  check((await cap.textContent()) === 'No next deck', 'end of deck in Next panel')
  await win.keyboard.press('ArrowLeft')
  await win.waitForFunction(
    () => document.querySelector('[data-testid=pos]')?.textContent === '02 / 03'
  )
  check(true, 'ArrowLeft goes back')

  await win.keyboard.press('f')
  await win.waitForFunction(
    () => document.querySelector('[data-testid=tally]')?.textContent === 'FROZEN'
  )
  check(true, 'F shows FROZEN')
  await waitFrame([[10, 10]], (px) => blue(px[0]), 'frozen output still slide 2')
  await win.keyboard.press('Space')
  await win.waitForFunction(
    () => document.querySelector('[data-testid=pos]')?.textContent === '03 / 03'
  )
  await sleep(800)
  const fz = await dumpFrame([[10, 10]])
  check(blue(fz.px[0]), `F then Space keeps the old frame (corner ${JSON.stringify(fz.px[0])})`)
  // Frozen, the right panel previews the position slide (Unfreeze does not take it live).
  check(
    (await cap.textContent()).includes('slide 3'),
    'frozen: Next panel previews the position slide'
  )
  check(
    /^0?3 \/ 0?3$/.test(await win.getByTestId('next-pos').textContent()),
    'frozen: Next panel shows the position'
  )
  check(
    (await win.locator('aside.right .ptl').textContent()) === 'Preview',
    'frozen: Next panel titled Preview'
  )
  // Unfreeze keeps the held slide (2, blue) live and returns the position to it.
  await win.keyboard.press('f')
  await win.waitForFunction(
    () => document.querySelector('[data-testid=tally]')?.textContent === 'LIVE'
  )
  await win.waitForFunction(
    () => document.querySelector('[data-testid=pos]')?.textContent === '02 / 03'
  )
  await sleep(800)
  const uf = await dumpFrame([[10, 10]])
  check(blue(uf.px[0]), 'unfreeze keeps slide 2 on the output; the position returns to 2 / 3')
  check(
    (await win.locator('aside.right .ptl').textContent()) === 'Up next',
    'unfrozen: Next panel title is back'
  )
  await win.keyboard.press('f')
  await win.waitForFunction(
    () => document.querySelector('[data-testid=tally]')?.textContent === 'FROZEN'
  )
  await win.keyboard.press('ArrowRight')
  await win.waitForFunction(
    () => document.querySelector('[data-testid=pos]')?.textContent === '03 / 03'
  )
  await win.keyboard.press('b')
  await win.waitForFunction(
    () => document.querySelector('[data-testid=tally]')?.textContent === 'BLACK'
  )
  check(true, 'B shows BLACK')
  await waitFrame(GRID, (px) => px.every(isBlack), 'B makes the output frame fully black')
  check(true, `B makes the output fully black (${GRID.length} sample points)`)
  await win.keyboard.press('b')
  await win.keyboard.press('f')
  await win.waitForFunction(
    () => document.querySelector('[data-testid=tally]')?.textContent === 'LIVE'
  )
  check(true, 'B and F again return to LIVE')
  await waitFrame([[10, 10]], (px) => blue(px[0]), 'output returns to slide 2 after B off')
  check(true, 'output shows slide 2 again after B off')

  // KV while a slide is LIVE (slide 2): K -> KV on the output and tally KV; B ->
  // black and KV off; K, K -> KV on and off again, back to the slide.
  await win.setInputFiles('[data-testid=kv-input]', kvPath)
  await win.locator('[data-testid=kv-thumb] img').waitFor({ timeout: 10_000 })
  check((await tally.textContent()) === 'LIVE', 'uploading a KV does not disturb LIVE')
  await waitFrame([[10, 10]], (px) => blue(px[0]), 'output still shows slide 2 after the KV upload')
  const tallyIs = (t) =>
    win.waitForFunction((x) => document.querySelector('[data-testid=tally]')?.textContent === x, t)
  const kvOn = () => kvBtn.getAttribute('aria-pressed')
  await win.keyboard.press('k')
  await tallyIs('KV')
  await waitFrame(GRID, (px) => px.every(isKv), 'K puts the KV on the output')
  check((await kvOn()) === 'true', 'K: KV button pressed')
  await waitOnAirSrc('slide://kv/', 'Program monitor shows exactly the KV on air')
  await win.keyboard.press('b')
  await tallyIs('BLACK')
  await waitFrame(GRID, (px) => px.every(isBlack), 'B over the KV makes the output black')
  check((await kvOn()) === 'false', 'B turns KV off')
  await win.keyboard.press('k')
  await tallyIs('KV')
  await waitFrame(GRID, (px) => px.every(isKv), 'K after B shows the KV again')
  check(
    (await win.locator('.transport button', { hasText: 'Black' }).getAttribute('aria-pressed')) ===
      'false',
    'K turns Black off'
  )
  await win.keyboard.press('k')
  await tallyIs('LIVE')
  await waitFrame([[10, 10]], (px) => blue(px[0]), 'K again returns to slide 2')
  check(true, 'K, B, K, K: KV and Black take turns and the slide comes back')
  // Switching event while the KV is forced on keeps the same KV image on the output.
  await win.keyboard.press('k')
  await tallyIs('KV')
  const kvSrc = await waitOnAirSrc('slide://kv/', 'forced KV on air before the event switch')
  await win.click('.newbtn')
  await win.fill('[data-testid=new-event-name]', 'Event KV')
  await win.press('[data-testid=new-event-name]', 'Enter')
  await win.locator('[role=tab][aria-selected=true]', { hasText: 'Event KV' }).waitFor()
  await tallyIs('KV')
  await waitFrame(GRID, (px) => px.every(isKv), 'switching event keeps the KV on the output')
  check(
    (await waitOnAirSrc(kvSrc, 'same KV image on air after the event switch')) === kvSrc,
    'the KV image on air is unchanged by the event switch'
  )
  await win.locator('[role=tab]', { hasText: 'Smoke Event' }).click()
  await win.locator('[role=tab][aria-selected=true]', { hasText: 'Smoke Event' }).waitFor()
  await tallyIs('KV')
  // A KV on air can be removed directly: the slide comes back and the image is released.
  check(!(await kvRemove().isDisabled()), 'KV on air while LIVE: Remove is enabled')
  check((await win.getByTestId('kv-hint').count()) === 0, 'KV on air while LIVE: no hint')
  await kvRemove().click()
  await tallyIs('LIVE')
  await waitFrame([[10, 10]], (px) => blue(px[0]), 'removing the KV on air returns to slide 2')
  // isDisabled() does not retry; the button follows the KV removal a moment later.
  await win.waitForFunction(
    () =>
      [...document.querySelectorAll('.transport button')].find((b) => b.textContent?.includes('KV'))
        ?.disabled === true
  )
  check(await kvBtn.isDisabled(), 'KV removed on air: KV button disabled, slide back on the output')

  // Layout at 1280×720: controls fully visible above the strip.
  const ctr = await win.locator('.transport').boundingBox()
  const foot = await win.locator('footer').boundingBox()
  check(
    ctr && foot && ctr.y + ctr.height <= foot.y,
    'transport and controls fit above the strip at 1280×720'
  )
  const stage = await win.locator('.stage-col').evaluate((e) => e.scrollHeight <= e.clientHeight)
  check(stage, 'stage column does not scroll at 1280×720')

  // Resizable panels: drag, double-click reset, persistence, keyboard.
  const widths = () =>
    win.evaluate(() => ({
      left: document.querySelector('.left').getBoundingClientRect().width,
      stage: document.querySelector('.stage-col').getBoundingClientRect().width
    }))
  const w0 = await widths()
  const grip = await win.getByTestId('splitter-left').boundingBox()
  const gx = grip.x + grip.width / 2
  const gy = grip.y + grip.height / 2
  await win.mouse.move(gx, gy)
  await win.mouse.down()
  await win.mouse.move(gx + 80, gy, { steps: 5 })
  await win.mouse.up()
  const w1 = await widths()
  check(
    Math.abs(w1.left - (w0.left + 80)) <= 2 && w1.stage < w0.stage,
    'dragging the deck splitter widens Decks and narrows Program'
  )
  check(
    await win.evaluate(() => !document.activeElement?.matches('.splitter')),
    'after a mouse drag the splitter does not keep focus (Space still means Next)'
  )
  await win.reload()
  await win.waitForSelector('.app')
  check(Math.abs((await widths()).left - w1.left) <= 1, 'panel width is restored after reload')
  // Narrowest Program column: every control stays visible (two rows), no sideways scroll.
  const g2 = await win.getByTestId('splitter-left').boundingBox()
  await win.mouse.move(g2.x + g2.width / 2, g2.y + g2.height / 2)
  await win.mouse.down()
  await win.mouse.move(g2.x + 900, g2.y + g2.height / 2, { steps: 5 })
  await win.mouse.up()
  const narrow = await win.evaluate(() => {
    const stage = document.querySelector('.stage-col')
    const box = stage.getBoundingClientRect()
    const btns = [...document.querySelectorAll('.transport button')].map((b) =>
      b.getBoundingClientRect()
    )
    return {
      width: box.width,
      sideways: stage.scrollWidth > stage.clientWidth,
      inside: btns.every((r) => r.left >= box.left - 1 && r.right <= box.right + 1)
    }
  })
  check(
    !narrow.sideways && narrow.inside,
    `narrow Program (${Math.round(narrow.width)}px): all controls visible, no sideways scroll`
  )
  await win.getByTestId('splitter-left').dblclick()
  check(Math.abs((await widths()).left - w0.left) <= 1, 'double-click resets the splitter')
  const posBefore = await pos.textContent()
  await win.getByTestId('splitter-strip').focus()
  await win.keyboard.press('ArrowUp')
  const sh = await win.evaluate(
    () => document.querySelector('footer').getBoundingClientRect().height
  )
  check(
    Math.abs(sh - 192) <= 1 && (await pos.textContent()) === posBefore,
    `ArrowUp on the strip splitter resizes it without changing slides (strip ${sh}px)`
  )
  await win.getByTestId('splitter-strip').dblclick()
  await win.locator('.stage-col').click({ position: { x: 40, y: 5 } })

  await win.screenshot({ path: shot })
  console.log(`screenshot: ${shot}`)

  // 4:3 deck (PDF, no PowerPoint needed): letterboxed with black bars, taken with a Fade.
  await win.setInputFiles('[data-testid=file-input]', path.join(root, 'fixtures/sample-4x3.pdf'))
  const deck43 = win.locator('.deck', { has: win.locator('.name', { hasText: 'sample-4x3' }) })
  await deck43.locator('.meta', { hasText: '2 slides' }).waitFor({ timeout: 60_000 })
  check(true, '4:3 PDF imported')
  // Transition lives in the Controls tab.
  await win.getByRole('tab', { name: 'Controls' }).click()
  await win.getByRole('radio', { name: 'Fade' }).click()
  await win.waitForFunction(
    () =>
      document.querySelector('[data-testid=right-panel] [role=radio][aria-checked=true]')
        ?.textContent === 'Fade'
  )
  // Sample where the left bar will be while the fade runs: blue slide 2 → black.
  const t0 = Date.now()
  await deck43.click()
  const seen = []
  while (Date.now() - t0 < 1000) {
    const f = await dumpFrame([[100, 540]])
    if (f) seen.push([Date.now() - t0, f.px[0][0]])
  }
  const mid = seen.filter(([, r]) => r > 20 && r < 215)
  check(
    mid.length > 0,
    `Fade shows intermediate frames (${mid.length} of ${seen.length} samples mid-way: ${JSON.stringify(mid.slice(0, 6))})`
  )
  const f43 = await waitFrame(
    [...BARS, ...INSIDE_43, CENTRE],
    (px) =>
      BARS.every((_, i) => isBlack(px[i])) && px.slice(BARS.length).every((p) => lum(p) > 200),
    '4:3 slide letterboxed'
  )
  check(
    true,
    `4:3 slide: black bars ${JSON.stringify(f43.px.slice(0, 4))}, content ${JSON.stringify(f43.px.slice(4))}`
  )
  const saved43 = await dumpFrame([CENTRE], true)
  fs.copyFileSync(saved43.file, path.join(path.dirname(shot), 'task-7-output-4x3.png'))
  await noBlackGap(win, () => win.keyboard.press('Space'), 'Next with Fade')
  await win.getByRole('radio', { name: 'Cut' }).click()
  // Back to the 16:9 deck at slide 2 for the remaining steps.
  await win.locator('.deck', { has: win.locator('.name', { hasText: /^sample$/ }) }).click()
  await win.waitForFunction(
    () => document.querySelector('[data-testid=pos]')?.textContent === '01 / 03'
  )
  await win.keyboard.press('Space')
  await win.waitForFunction(
    () => document.querySelector('[data-testid=pos]')?.textContent === '02 / 03'
  )

  // Auto advance (default off): a clicker cannot run into the next deck.
  const waitPos = (p) =>
    win.waitForFunction((x) => document.querySelector('[data-testid=pos]')?.textContent === x, p)
  const autoSw = win.getByTestId('auto-advance')
  const nextBtn = win.locator('.tbtn.next')
  const savedAuto = () =>
    JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).autoAdvance
  check((await autoSw.getAttribute('aria-checked')) === 'false', 'auto advance is off by default')
  await win.keyboard.press('PageDown') // clicker Next
  await waitPos('03 / 03')
  check(
    (await cap.textContent()) === 'Next stops here. Choose sample-4x3 to continue.' &&
      (await nextBtn.isDisabled()),
    `off: end of deck says Next stops, Next disabled ("${await cap.textContent()}")`
  )
  await win.keyboard.press('PageDown')
  await win.keyboard.press('Space')
  await sleep(300)
  check(
    (await pos.textContent()) === '03 / 03' &&
      (await win.locator('.deck.live .name').textContent()) === 'sample',
    'off: PageDown and Space on the last slide stay in the live deck'
  )
  await autoSw.click()
  await win.locator('[data-testid=auto-advance][aria-checked=true]').waitFor()
  check(
    (await cap.textContent()) === 'Next deck: sample-4x3' && !(await nextBtn.isDisabled()),
    'on: Next panel names the next deck, Next enabled'
  )
  await win.keyboard.press('PageDown')
  await waitPos('01 / 02')
  check(true, 'on: PageDown on the last slide goes on to the next deck')
  await win.keyboard.press('PageUp')
  await waitPos('03 / 03')
  check(true, 'on: PageUp on the first slide goes back to the previous deck')
  check(savedAuto() === true, 'auto advance saved in settings.json')
  await autoSw.click()
  await win.locator('[data-testid=auto-advance][aria-checked=false]').waitFor()
  check(savedAuto() === false, 'turning it off is saved too')
  await win.keyboard.press('PageUp')
  await waitPos('02 / 03')

  // Optional: PPTX through PowerPoint COM (needs PowerPoint installed).
  if (process.env.PPT_E2E === '1') {
    await win.setInputFiles('[data-testid=file-input]', path.join(root, 'fixtures/sample-4x3.pptx'))
    await win.locator('.deck.busy .meta', { hasText: 'Converting' }).waitFor()
    check(true, 'PPTX row shows Converting')
    await win
      .locator('.deck .name', { hasText: 'sample-4x3' })
      .and(win.locator('.deck:not(.busy) .name'))
      .waitFor({ timeout: 180_000 })
    check((await win.locator('.deck.err').count()) === 0, 'PPTX imported without error')
    check((await tally.textContent()) === 'LIVE', 'PPTX import does not change the output')
  }

  // Switching to a new (empty) event keeps the output as it is.
  await win.click('.newbtn')
  await win.fill('[data-testid=new-event-name]', 'Event Kedua')
  await win.press('[data-testid=new-event-name]', 'Enter')
  await win.locator('[role=tab][aria-selected=true]', { hasText: 'Event Kedua' }).waitFor()
  await win.locator('.empty-lib').waitFor()
  check((await tally.textContent()) === 'LIVE', 'output stays LIVE after switching event')
  await win.locator('[role=tab]', { hasText: 'Smoke Event' }).click()
  await win.waitForFunction(
    () => document.querySelector('[data-testid=pos]')?.textContent === '02 / 03'
  )
  check(true, 'switching back restores the position')

  // Theme toggle persists across reloads.
  await win.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Light' }).click()
  check(
    (await win.evaluate(() => document.documentElement.dataset.theme)) === 'light',
    'theme toggles to light'
  )
  await win.reload()
  await win.waitForSelector('.app')
  check(
    (await win.evaluate(() => document.documentElement.dataset.theme)) === 'light',
    'theme persists after reload'
  )

  // HDMI renderer crash: the window is rebuilt and shows the slide again.
  const before = (await hdmiDebug()).creates
  await app.evaluate(
    ({ BrowserWindow }, t) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === t)
        .webContents.forcefullyCrashRenderer(),
    HDMI_TITLE
  )
  const end = Date.now() + 10_000
  let after = await hdmiDebug()
  while (Date.now() < end) {
    after = await hdmiDebug()
    if (after.creates === before + 1 && after.visible && after.ready) break
    await sleep(200)
  }
  check(
    after.creates === before + 1 && after.visible,
    `HDMI window rebuilt after a renderer crash (creates ${before} -> ${after.creates})`
  )
  await waitFrame([[10, 10]], (px) => blue(px[0]), 'rebuilt HDMI window shows slide 2')
  const outputs = (await hdmiWindows()).length
  check(outputs === 1, `rebuilt output shows slide 2; single HDMI window (${outputs})`)

  await dragAndDropChecks(win, tally, pos, cap)

  // Heavy slides: Next never shows a black frame on Program or HDMI, Cut or Fade.
  const noise = path.join(frameDir, 'noise.pdf')
  await noisePdf(noise, 4)
  await win.setInputFiles('[data-testid=file-input]', noise)
  const noiseDeck = win.locator('.deck', { has: win.locator('.name', { hasText: /^noise$/ }) })
  // The row's .meta turns visibility:hidden while the pointer is over the row (the More button
  // takes its place), so wait for it to exist, not to be visible.
  await noiseDeck
    .locator('.meta', { hasText: '4 slides' })
    .waitFor({ state: 'attached', timeout: 120_000 })
  await noiseDeck.click()
  // From STANDBY the first Next takes slide 1 live.
  if ((await tally.textContent()) !== 'LIVE') await win.keyboard.press('Space')
  await win.waitForFunction(() =>
    document.querySelector('[data-testid=tally]')?.textContent?.includes('LIVE')
  )
  await sleep(800)
  await noBlackGap(win, () => win.keyboard.press('Space'), 'heavy slides, Next with Cut')
  // Transition lives in the Controls tab.
  await win.getByRole('tab', { name: 'Controls' }).click()
  await win.getByRole('radio', { name: 'Fade' }).click()
  await noBlackGap(win, () => win.keyboard.press('Space'), 'heavy slides, Next with Fade')
  await win.getByRole('radio', { name: 'Cut' }).click()

  // Up next card: pixels of the operator window for every capture while Next and Prev are
  // pressed on heavy slides. The card must never show the bare letterbox (black) between two
  // slides. A MutationObserver counts the image swaps and the card kinds seen, so a run in
  // which no key moved anything cannot pass.
  {
    const r = await win.evaluate(() => {
      const b = document.querySelector('[data-testid=next-card] .slide').getBoundingClientRect()
      return { x: b.x, y: b.y, w: b.width, h: b.height, iw: innerWidth, ih: innerHeight }
    })
    const pts = []
    for (let gx = 1; gx < 6; gx++) {
      for (let gy = 1; gy < 4; gy++) {
        pts.push([r.x + (r.w * gx) / 6, r.y + (r.h * gy) / 4])
      }
    }
    const posOf = () => win.getByTestId('pos').textContent()
    // Walks to the operator position `to` (clamped presses at the ends do nothing).
    const toPos = async (to, key) => {
      await win.evaluate(() => document.activeElement?.blur())
      for (let n = 0; n < 8 && (await posOf()) !== to; n++) {
        await win.keyboard.press(key)
        await sleep(400)
      }
      check((await posOf()) === to, `Up next check starts at ${to}`)
      await sleep(600)
    }
    const upNextRun = async (keys) => {
      const rec = app.evaluate(
        async ({ BrowserWindow }, [title, ps, iw, ih, ms]) => {
          const w = BrowserWindow.getAllWindows().find(
            (x) => !x.isDestroyed() && x.getTitle() !== title
          )
          const out = []
          const end = Date.now() + ms
          while (Date.now() < end) {
            const img = await w.webContents.capturePage()
            const { width, height } = img.getSize()
            const bmp = img.toBitmap()
            const lums = ps.map(([x, y]) => {
              const sx = Math.min(width - 1, Math.floor((x * width) / iw))
              const sy = Math.min(height - 1, Math.floor((y * height) / ih))
              const i = (sy * width + sx) * 4
              return Math.max(bmp[i], bmp[i + 1], bmp[i + 2])
            })
            out.push(Math.max(...lums))
          }
          return out
        },
        [HDMI_TITLE, pts, r.iw, r.ih, keys.length * 800 + 1200]
      )
      // Installed before any key: counts <img> additions and records the card kinds.
      await win.evaluate(() => {
        const card = document.querySelector('[data-testid=next-card]')
        const st = (window.__upNext = { swaps: 0, kinds: [card.dataset.kind] })
        st.mo = new MutationObserver((muts) => {
          for (const m of muts) {
            for (const n of m.addedNodes) {
              if (n.nodeName === 'IMG' || n.querySelector?.('img')) st.swaps++
            }
            if (m.type === 'attributes' && !st.kinds.includes(card.dataset.kind)) {
              st.kinds.push(card.dataset.kind)
            }
          }
        })
        st.mo.observe(card, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ['data-kind']
        })
      })
      await sleep(300)
      for (const k of keys) {
        await win.keyboard.press(k)
        await sleep(800)
      }
      const lums = await rec
      const st = await win.evaluate(() => {
        window.__upNext.mo.disconnect()
        return { swaps: window.__upNext.swaps, kinds: window.__upNext.kinds }
      })
      return { lums, ...st, black: lums.filter((l) => l <= 8).length }
    }

    // End card to slide: from the last slide (card = end of deck) back and forth.
    await toPos('04 / 04', 'ArrowRight')
    const e = await upNextRun(['ArrowLeft', 'ArrowLeft', 'ArrowRight', 'ArrowRight'])
    check(
      e.lums.length > 20 && e.swaps >= 1 && e.kinds.includes('end') && e.black === 0,
      `Up next card never flashes black from the end card (${e.lums.length} captures, ${e.black} black, min ${Math.min(...e.lums)}, ${e.swaps} swaps, kinds ${e.kinds})`
    )

    // Slide to slide: slide 1 live, the card shows slide 2; 2 > 3 > 4, then back. No end card.
    await toPos('01 / 04', 'ArrowLeft')
    const m = await upNextRun(['ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowLeft'])
    check(
      m.lums.length > 20 &&
        m.swaps >= 4 &&
        m.kinds.length === 1 &&
        m.kinds[0] === 'slide' &&
        m.black === 0,
      `Up next card never flashes black from slide to slide (${m.lums.length} captures, ${m.black} black, min ${Math.min(...m.lums)}, ${m.swaps} swaps, kinds ${m.kinds})`
    )
  }

  // Rename a deck: right-click > Rename, F2, Escape cancels, empty is refused.
  const noiseId = await noiseDeck.getAttribute('data-deck-id')
  // The options button (three dots) opens the same deck menu as right-click.
  await win
    .locator('.deck-row', { has: win.locator('.name', { hasText: /^noise$/ }) })
    .getByTestId('deck-more')
    .click()
  const viaDots = win.getByTestId('deck-menu')
  await viaDots.waitFor()
  check(
    (await viaDots.getByRole('menuitem').allTextContents()).some((t) => /Rename/.test(t)),
    'the three-dots button opens the deck menu (rename, remove)'
  )
  await win.keyboard.press('Escape')
  await viaDots.waitFor({ state: 'detached' })
  await noiseDeck.click({ button: 'right' })
  await win
    .getByTestId('deck-menu')
    .getByRole('menuitem', { name: /Rename/ })
    .click()
  const renameInput = win.getByTestId('rename-deck').locator('input')
  await renameInput.fill('Session 1: Introduction')
  await renameInput.press('Enter')
  const renamed = win.locator('.deck', {
    has: win.locator('.name', { hasText: /^Session 1: Introduction$/ })
  })
  await renamed.waitFor()
  const savedDeck = JSON.parse(
    fs.readFileSync(path.join(userData, 'decks', noiseId, 'deck.json'), 'utf8')
  )
  check(
    savedDeck.name === 'Session 1: Introduction' && savedDeck.slides.length === 4,
    'rename from the deck menu saves the new name, slides untouched'
  )
  await renamed.focus()
  await win.keyboard.press('F2')
  await renameInput.fill('Never mind')
  await renameInput.press('Escape')
  await renamed.waitFor()
  check((await win.getByTestId('rename-deck').count()) === 0, 'F2 opens rename, Escape cancels it')
  await renamed.focus()
  await win.keyboard.press('F2')
  await renameInput.fill('   ')
  await renameInput.press('Enter')
  const renameErr = win.getByTestId('rename-deck').getByRole('alert')
  await renameErr.waitFor()
  check(/empty/.test(await renameErr.textContent()), 'an empty name is refused with a message')
  await renameInput.press('Escape')
  await renamed.waitFor()

  const { missingDeckId } = await videoChecks(win, tally)
  await videoFileChecks(win)

  await canvasAndLevelsChecks(win, tally)

  await behaviourChecks(win, tally, pos)

  await sectionChecks(win, tally, pos)

  await stopProbe(win)

  await hdmiChecks(win)

  // The missing-MP4 check makes both windows log the failed video (by design),
  // naming that re-imported deck; the same file of any other deck is still an error.
  const missingMp4 = `${missingDeckId}/003.mp4`
  const relevant = errors.filter(
    (e) => !/Electron Security Warning/.test(e) && !e.includes(missingMp4)
  )
  check(
    relevant.length === 0,
    `no console errors${relevant.length ? ': ' + relevant.join(' | ') : ''}`
  )

  // Mute and the audio device persist across an app restart (same user data
  // folder). A real output device is chosen when this machine has one, else a
  // saved device that is not connected.
  const mpop = await openOutputPopover(win, 'sound')
  const mdev = mpop.getByTestId('audio-device')
  await mdev
    .locator('option')
    .nth(1)
    .waitFor({ state: 'attached', timeout: 3000 })
    .catch(() => {})
  const realOpts = (
    await mdev
      .locator('option')
      .evaluateAll((els) => els.map((e) => ({ v: e.value, off: e.disabled })))
  ).filter((o) => o.v !== '' && !o.off)
  const chosenDevice = realOpts[0]?.v ?? 'gone-device'
  if (realOpts.length > 0) await mdev.selectOption(chosenDevice)
  else await win.evaluate((id) => window.api.setAudio({ deviceId: id, muted: false }), chosenDevice)
  await win.waitForFunction(
    (id) => document.querySelector('[data-testid=audio-device]')?.value === id,
    chosenDevice
  )
  check(
    savedAudio().deviceId === chosenDevice,
    `audio device ${realOpts.length ? 'chosen' : '(not connected) saved'} before the restart`
  )
  await mpop.getByTestId('audio-mute').click()
  await win.waitForFunction(
    () =>
      document.querySelector('[data-testid=audio-mute]')?.getAttribute('aria-checked') === 'true'
  )
  check(savedAudio().muted === true, 'Mute audio on is written to settings.json')
  await app.close()
  app2 = await electron.launch(launchOptions)
  const win2 = await app2.firstWindow()
  await win2.waitForSelector('.app')
  await win2.getByTestId('output-chip-sound').click()
  const mute2 = win2.getByTestId('audio-mute')
  await mute2.waitFor()
  check(
    (await mute2.getAttribute('aria-checked')) === 'true',
    'Mute audio is still on after restarting the app'
  )
  const dev2 = win2.getByTestId('audio-device')
  await win2.waitForFunction(
    (id) => document.querySelector('[data-testid=audio-device]')?.value === id,
    chosenDevice
  )
  const dev2Text = await dev2.locator('option:checked').textContent()
  check(
    (await dev2.inputValue()) === chosenDevice &&
      (realOpts.length > 0
        ? dev2Text !== 'Default (Windows)'
        : dev2Text === 'Saved device (not connected)'),
    `the saved audio device is still selected after restarting the app (${JSON.stringify(dev2Text)})`
  )
} catch (e) {
  failed = true
  console.error(e)
  if (errors.length) console.error('console errors:', errors)
} finally {
  await app.close().catch(() => {}) // already closed by the restart check
  await app2?.close().catch(() => {})
  fs.rmSync(userData, { recursive: true, force: true })
  if (failed) console.error(`output frames kept in ${frameDir}`)
  else fs.rmSync(frameDir, { recursive: true, force: true })
}

// --- First run, launched WITHOUT PPT_SKIP_HOME on empty user data: Home opens first, and an
// event created from Home opens the console with that event ---
{
  const firstData = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-share-home-'))
  const firstApp = await electron.launch({
    args: [...linuxArgs, root],
    cwd: root,
    env: {
      ...process.env,
      PPT_SHARE_USER_DATA: firstData,
      PPT_SKIP_TOUR: '1',
      ELECTRON_RENDERER_URL: ''
    }
  })
  try {
    const win = await firstApp.firstWindow()
    await win.waitForSelector('.app')
    await win.getByTestId('home').waitFor()
    check(
      (await win.locator('.app').getAttribute('data-view')) === 'home',
      'a first run opens on Home, not the console'
    )
    check(
      (await win.locator('.hero-title').textContent())?.includes('Bridgecast') &&
        (await win.getByText('Welcome to').isVisible()),
      'Home opens with the Welcome hero and the Bridgecast logo'
    )
    check(await win.getByTestId('guide').isVisible(), 'Home shows the Getting started checklist')
    check(
      (await win.getByTestId('guide-step').first().getAttribute('data-done')) === 'false',
      'the first checklist step (Create an event) is not done yet'
    )
    await win.getByTestId('home-new').click()
    await win.fill('[data-testid=new-event-name]', 'Home Smoke Event')
    await win.press('[data-testid=new-event-name]', 'Enter')
    await win.getByTestId('home').waitFor({ state: 'detached' })
    check(
      (await win.locator('.app').getAttribute('data-view')) === 'console',
      'creating an event from Home shows the console'
    )
    check(
      await win.locator('.evtabs').getByText('Home Smoke Event').isVisible(),
      'the event created on Home is open in the console'
    )
  } catch (e) {
    failed = true
    console.error(e)
  } finally {
    await firstApp.close().catch(() => {})
    fs.rmSync(firstData, { recursive: true, force: true })
  }
}
// --- Live tab and Off air: the on-air event's tab has no ×, Delete ignores it, and Off air (Home
// banner, after a confirm) returns the output to STANDBY, never Black ---
{
  const offData = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-share-offair-'))
  const offApp = await electron.launch({
    args: [...linuxArgs, root],
    cwd: root,
    env: {
      ...process.env,
      PPT_SHARE_USER_DATA: offData,
      PPT_SKIP_TOUR: '1',
      ELECTRON_RENDERER_URL: ''
    }
  })
  try {
    const win = await offApp.firstWindow()
    await win.waitForSelector('.app')
    await win.getByTestId('home').waitFor()
    await win.getByTestId('home-new').click()
    await win.fill('[data-testid=new-event-name]', 'Off Air Event')
    await win.press('[data-testid=new-event-name]', 'Enter')
    await win.getByTestId('home').waitFor({ state: 'detached' })
    await win.setInputFiles('[data-testid=file-input]', path.join(root, 'fixtures/sample.pdf'))
    await win.locator('.deck .meta', { hasText: '3 slides' }).waitFor({ timeout: 60_000 })
    await win.keyboard.press('Space')
    await win.waitForFunction(
      () => document.querySelector('[data-testid=tally]')?.textContent === 'LIVE'
    )
    const session = () => win.evaluate(() => window.api.getSession())
    const live = win.locator('.otab[data-live]')
    check((await session()).state.shown !== null, 'a slide is on air')
    check((await live.count()) === 1, 'the on-air event has a live tab')
    check((await live.locator('.x').count()) === 0, 'the live tab has no × button')

    // Delete on the focused live tab does nothing.
    await live.locator('[role=tab]').focus()
    await win.keyboard.press('Delete')
    await sleep(300)
    check(
      (await live.count()) === 1 && (await session()).state.shown !== null,
      'Delete on the live tab leaves the tab and the output alone'
    )

    // Middle click on the live tab does nothing either.
    await live.click({ button: 'middle' })
    await sleep(300)
    check(
      (await live.count()) === 1 && (await session()).state.shown !== null,
      'a middle click on the live tab leaves the tab and the output alone'
    )

    // A mouse click on Fade does not keep the focus: the next arrow key is Next, not Cut.
    await win.getByRole('radio', { name: 'Fade' }).click()
    const before = (await session()).state.index
    await win.keyboard.press('ArrowRight')
    await win.waitForFunction(
      (i) => window.api.getSession().then((s) => s.state.index === i + 1),
      before
    )
    check(
      (await session()).state.transition === 'fade',
      'ArrowRight after a click on Fade takes the next slide and the transition stays Fade'
    )

    // The console header has Off air (not the Controls tab). Cancel keeps the output live.
    check(
      (await win.getByTestId('controls-offair').count()) === 0,
      'Controls has no Off air button'
    )
    await win.getByTestId('header-offair').click()
    const headConfirm = win.getByTestId('header-offair-confirm')
    await headConfirm.waitFor()
    await headConfirm.getByRole('button', { name: 'Cancel' }).click()
    await headConfirm.waitFor({ state: 'detached' })
    check(
      (await session()).state.shown !== null,
      'Cancel on the header Off air leaves the output live'
    )

    // Home shows the on-air banner. Cancel on the confirm keeps the output live.
    await win.getByTestId('home-btn').click()
    await win.getByTestId('home').waitFor()
    check(await win.getByTestId('home-onair').isVisible(), 'Home shows the on-air banner')
    await win.getByTestId('home-offair').click()
    const confirm = win.getByTestId('home-offair-confirm')
    await confirm.waitFor()
    check(
      (await confirm.textContent()).includes(
        'Take Off Air Event off air? The output goes to STANDBY.'
      ),
      'the confirm names the event and says the output goes to STANDBY'
    )
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await confirm.waitFor({ state: 'detached' })
    check(
      (await win.getByTestId('home-onair').isVisible()) && (await session()).state.shown !== null,
      'Cancel closes the confirm and leaves the output live'
    )

    // Off air: the banner goes, the output is STANDBY (not Black), and the tab is no longer live.
    await win.getByTestId('home-offair').click()
    await win.getByTestId('home-offair-yes').click()
    await win.getByTestId('home-onair').waitFor({ state: 'detached' })
    const off = (await session()).state
    check(
      off.shown === null && !off.black && (await live.count()) === 0,
      'Off air returns the output to STANDBY, not Black, and no tab is live'
    )

    // Back on the console the event is STANDBY, its tab has an × again and closing it works.
    await win.locator('.evtabs [role=tab]').first().click()
    await win.getByTestId('home').waitFor({ state: 'detached' })
    check(
      (await win.getByTestId('tally').textContent()) === 'STANDBY',
      'the console shows STANDBY after Off air'
    )
    const close = win.locator('.evtabs .otab .x')
    check((await close.count()) === 1, 'the tab after Off air has an × button')
    check(
      (await win.getByTestId('header-offair').count()) === 0,
      'the header has no Off air button while nothing is on air'
    )
    await win.locator('.evtabs .otab').click({ button: 'middle' })
    await win.locator('.evtabs [role=tab]').first().waitFor({ state: 'detached' })
    check(true, 'a middle click on the tab after Off air closes it')
  } catch (e) {
    failed = true
    console.error(e)
  } finally {
    await offApp.close().catch(() => {})
    fs.rmSync(offData, { recursive: true, force: true })
  }
}
console.log(failed ? 'SMOKE FAILED' : 'SMOKE PASSED')
process.exit(failed ? 1 : 0)
