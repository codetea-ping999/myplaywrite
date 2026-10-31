// Open shared Muse spaces in a real browser and export what is visible:
//   out/<slug>/page.png   full-page screenshot
//   out/<slug>/page.pdf   printable copy
//   out/<slug>/content.md visible text + image links
//   out/<slug>/images/    images shown on the board
// Usage: node scripts/muse-export.mjs [urls.txt | URL ...] [--out out] [--headed]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const outRoot = option('--out', 'out');
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');

async function loadUrls() {
  const sources = positional.length ? positional : ['urls.txt'];
  const urls = [];
  for (const s of sources) {
    if (/^(https?|file):\/\//.test(s)) urls.push(s);
    else {
      const text = await readFile(s, 'utf8');
      urls.push(...text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')));
    }
  }
  return urls;
}

export function slugFor(url) {
  const u = new URL(url);
  const parts = u.pathname.split('/').filter(Boolean);
  return (parts.find((p) => p.startsWith('space')) || parts.at(-1) || u.hostname).replace(/[^\w-]/g, '_');
}

// Muse boards render lazily; scroll the page and every scrollable container.
async function revealAll(page) {
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const scrollables = [document.scrollingElement, ...document.querySelectorAll('*')].filter(
      (el) => el && el.scrollHeight > el.clientHeight + 50,
    );
    for (const el of scrollables.slice(0, 20)) {
      for (let y = 0; y < el.scrollHeight; y += el.clientHeight * 0.8) {
        el.scrollTop = y;
        await sleep(150);
      }
      el.scrollTop = 0;
    }
  });
}

async function revealFrame(frame) {
  await frame.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const boxes = [document.scrollingElement, ...document.querySelectorAll('*')].filter(
      (el) => el && el.scrollHeight > el.clientHeight + 50,
    );
    for (const el of boxes.slice(0, 20)) {
      for (let y = 0; y < el.scrollHeight; y += Math.max(el.clientHeight * 0.8, 200)) {
        el.scrollTop = y;
        await sleep(120);
      }
      el.scrollTop = 0;
    }
  });
}

async function exportOne(browser, url) {
  const dir = path.join(outRoot, slugFor(url));
  await mkdir(path.join(dir, 'images'), { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: 'ja-JP' });
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await revealAll(page);

  // Muse renders the shared board inside an iframe, so read every frame, not just the shell.
  const extract = () => {
    const seen = new Set();
    const lines = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const el = walker.currentNode.parentElement;
      const style = el && getComputedStyle(el);
      if (!el || style.display === 'none' || style.visibility === 'hidden') continue;
      if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue;
      const t = walker.currentNode.textContent.replace(/\s+/g, ' ').trim();
      if (t && !seen.has(t)) {
        seen.add(t);
        lines.push(t);
      }
    }
    const images = [...document.querySelectorAll('img')]
      .filter((img) => img.naturalWidth > 80 && img.naturalHeight > 80)
      .map((img) => ({ src: img.currentSrc || img.src, alt: img.alt || '' }));
    const links = [...document.querySelectorAll('a[href]')].map((a) => ({
      href: a.href,
      text: a.innerText.trim(),
    }));
    return { title: document.title, lines, images, links, height: document.documentElement.scrollHeight };
  };
  const data = { title: await page.title(), lines: [], images: [], links: [], frames: [] };
  const seenLines = new Set();
  for (const [i, frame] of page.frames().entries()) {
    try {
      await revealFrame(frame);
      const part = await frame.evaluate(extract);
      data.frames.push({ index: i, url: frame.url(), lines: part.lines.length, height: part.height });
      for (const l of part.lines) if (!seenLines.has(l)) { seenLines.add(l); data.lines.push(l); }
      data.images.push(...part.images);
      data.links.push(...part.links);
      await writeFile(path.join(dir, `frame-${i}.html`), await frame.content(), 'utf8');
    } catch {
      /* cross-origin or detached frame: skip */
    }
  }

  const saved = [];
  for (const [i, img] of data.images.entries()) {
    try {
      const res = await page.request.get(img.src);
      if (!res.ok()) continue;
      const type = res.headers()['content-type'] || '';
      const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
      const file = `images/${String(i + 1).padStart(3, '0')}.${ext}`;
      await writeFile(path.join(dir, file), await res.body());
      saved.push({ ...img, file });
    } catch {
      /* image may be a blob: or expired URL; screenshot still has it */
    }
  }

  const tallest = Math.min(Math.max(1000, ...data.frames.map((f) => f.height || 0)) + 200, 30000);
  await page.setViewportSize({ width: 1600, height: tallest });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(dir, 'page.png'), fullPage: true });
  await page.emulateMedia({ media: 'screen' });
  await page.pdf({ path: path.join(dir, 'page.pdf'), printBackground: true, width: '1600px', height: '1000px' })
    .catch(() => {}); // pdf() is Chromium headless only

  const md = [
    `# ${data.title || slugFor(url)}`,
    '',
    `- 取得元: ${url}`,
    `- 取得日時: ${new Date().toISOString()}`,
    `- HTTP: ${response ? response.status() : 'n/a'}`,
    '',
    `- フレーム: ${data.frames.map((f) => `#${f.index} ${f.lines}行/高さ${f.height}`).join(', ')}`,
    '',
    '## テキスト',
    '',
    ...data.lines.map((l) => `- ${l}`),
    '',
    '## 画像',
    '',
    ...(saved.length ? saved.map((s) => `![${s.alt}](${s.file})`) : ['（なし。page.png を参照）']),
    '',
    '## リンク',
    '',
    ...data.links.map((l) => `- [${l.text || l.href}](${l.href})`),
    '',
  ].join('\n');
  await writeFile(path.join(dir, 'content.md'), md, 'utf8');
  await page.close();
  return { url, dir, status: response?.status(), lines: data.lines.length, images: saved.length };
}

async function main() {
  const urls = await loadUrls();
  const browser = await chromium.launch({ headless: !flag('--headed') });
  const summary = [];
  for (const url of urls) {
    try {
      const r = await exportOne(browser, url);
      console.log(`OK  ${url} -> ${r.dir} (text ${r.lines}, images ${r.images}, HTTP ${r.status})`);
      summary.push(r);
    } catch (err) {
      console.error(`NG  ${url}: ${err.message.split('\n')[0]}`);
      summary.push({ url, error: err.message.split('\n')[0] });
    }
  }
  await mkdir(outRoot, { recursive: true });
  await writeFile(path.join(outRoot, 'summary.json'), JSON.stringify(summary, null, 2));
  await browser.close();
  process.exitCode = summary.some((s) => s.error) ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('muse-export.mjs')) {
  main();
}
