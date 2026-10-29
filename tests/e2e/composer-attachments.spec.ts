import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve as resolvePath, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { test, expect, openSessionAtCwd } from './harness/browser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolvePath(__dirname, 'fixtures', 'long-running.jsonl');
const TEST_CWD = '/tmp/outpost-e2e-composer-attachments';
const STDIN_LOG = join(mkdtempSync(join(tmpdir(), 'outpost-e2e-stdin-')), 'stdin.jsonl');

// A solid-colour PNG, built by hand so the test needs no image library.
function png(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x40)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Walks JPEG segments to the start-of-frame marker, which carries the pixel dimensions.
function jpegSize(buf: Buffer): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1]!;
    if (marker >= 0xc0 && marker <= 0xc3) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

test.use({
  daemonOpts: { fixturePath: FIXTURE, extraEnv: { OUTPOST_TEST_STDIN_LOG: STDIN_LOG } },
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

test.beforeAll(() => {
  mkdirSync(TEST_CWD, { recursive: true });
});

test('a photo goes inline and a file goes to disk by path, from the phone composer', async ({ daemon, outpostPage }) => {
  await openSessionAtCwd(outpostPage, daemon, TEST_CWD);
  const composer = outpostPage.locator('.sv-composer');
  await expect(composer).toBeVisible({ timeout: 10_000 });

  // Bigger than the 1568px Claude reads at, so it has to be downscaled on the way.
  await outpostPage.locator('.sv-attach-input').setInputFiles([
    { name: 'IMG_0042.png', mimeType: 'image/png', buffer: png(3000, 2000) },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('remember the milk') },
  ]);
  const tray = outpostPage.locator('.sv-attachments');
  await expect(tray.locator('img')).toHaveCount(1);
  await expect(tray).toContainText('notes.txt');
  // Attachments alone are something to send.
  await expect(outpostPage.locator('.sv-send')).toHaveClass(/\barmed\b/);

  await composer.tap();
  await outpostPage.keyboard.type('what is this');
  await outpostPage.locator('.sv-send').tap();

  // The sent message shows the photo and the file; the tray empties.
  const sent = outpostPage.locator('.msg.user').last();
  await expect(sent.locator('img.msg-attachment-thumb')).toHaveCount(1);
  await expect(sent).toContainText('notes.txt');
  await expect(sent).toContainText('what is this');
  await expect(tray).toBeHidden();

  // What claude actually received on stdin.
  await expect.poll(() => { try { return readFileSync(STDIN_LOG, 'utf8'); } catch { return ''; } }).toContain('"image"');
  const line = readFileSync(STDIN_LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((m) => m.type === 'user');
  const [image, text] = line.message.content;
  expect(image.type).toBe('image');
  expect(image.source.media_type).toBe('image/jpeg'); // re-encoded, not the raw PNG
  const jpeg = Buffer.from(image.source.data, 'base64');
  expect(jpeg.subarray(0, 2).toString('hex')).toBe('ffd8');
  expect(jpegSize(jpeg)).toEqual({ width: 1568, height: 1045 });
  expect(text.type).toBe('text');
  expect(text.text).toMatch(/^what is this\n\n\[Attached file: (\S+notes\.txt) \(text\/plain, 17 B\)\]$/);
  const path = /\[Attached file: (\S+) /.exec(text.text)![1]!;
  expect(path.startsWith(join(daemon.runtimeDir, 'uploads') + '/')).toBe(true);
  expect(readFileSync(path, 'utf8')).toBe('remember the milk');
});

test('a removed attachment is not sent', async ({ daemon, outpostPage }) => {
  await openSessionAtCwd(outpostPage, daemon, TEST_CWD);
  await expect(outpostPage.locator('.sv-composer')).toBeVisible({ timeout: 10_000 });
  await outpostPage.locator('.sv-attach-input').setInputFiles([
    { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('a') },
  ]);
  const tray = outpostPage.locator('.sv-attachments');
  await expect(tray).toContainText('a.txt');
  await tray.locator('.sv-attachment-remove').tap();
  await expect(tray).toBeHidden();
  // Nothing left to send.
  await expect(outpostPage.locator('.sv-send')).not.toHaveClass(/\barmed\b/);
});

// Spreadsheet cells and Keynote put text/plain and an image rendition on the clipboard together
test('a paste attaches an image only when there is no text to paste instead', async ({ daemon, outpostPage }) => {
  await openSessionAtCwd(outpostPage, daemon, TEST_CWD);
  await expect(outpostPage.locator('.sv-composer')).toBeVisible({ timeout: 10_000 });
  const paste = (withText: boolean) => outpostPage.evaluate((withText) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([1, 2, 3])], 'clip.png', { type: 'image/png' }));
    if (withText) dt.setData('text/plain', 'A1\tB1');
    const e = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    document.querySelector('.sv-composer')!.dispatchEvent(e);
    return e.defaultPrevented;
  }, withText);
  const tray = outpostPage.locator('.sv-attachments');

  expect(await paste(true)).toBe(false);
  await expect(tray).toBeHidden();

  expect(await paste(false)).toBe(true);
  await expect(tray).toContainText('clip.png');
});

test('the tray refuses what would push a message past its total, and says why', async ({ daemon, outpostPage }) => {
  await openSessionAtCwd(outpostPage, daemon, TEST_CWD);
  await expect(outpostPage.locator('.sv-composer')).toBeVisible({ timeout: 10_000 });
  const elevenMb = (name: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.alloc(11 * 1024 * 1024, 0x61) });
  await outpostPage.locator('.sv-attach-input').setInputFiles([elevenMb('a.log'), elevenMb('b.log'), elevenMb('c.log')]);
  const tray = outpostPage.locator('.sv-attachments');
  await expect(tray.locator('.sv-attachment-error')).toHaveText('Attachments are limited to 30 MB per message.', { timeout: 15_000 });
  await expect(tray.locator('.sv-attachment')).toHaveCount(2);
});
