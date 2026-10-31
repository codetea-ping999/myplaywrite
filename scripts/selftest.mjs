// Offline check: export a local fixture page and verify outputs exist.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'muse-selftest-'));
const fixture = path.join(dir, 'space-test.html');
writeFileSync(fixture, `<!doctype html><meta charset="utf-8"><title>テストボード</title>
<div style="height:3000px">競輪メモ：番手有利<br>地元選手は強い</div><a href="https://example.com">参考</a>`);
const out = path.join(dir, 'out');
execFileSync('node', ['scripts/muse-export.mjs', `file://${fixture}`, '--out', out], { stdio: 'inherit' });
const md = readFileSync(path.join(out, 'space-test_html', 'content.md'), 'utf8');
for (const want of ['テストボード', '番手有利', '地元選手は強い', 'example.com']) {
  if (!md.includes(want)) throw new Error(`content.md missing: ${want}`);
}
if (!existsSync(path.join(out, 'space-test_html', 'page.png'))) throw new Error('page.png missing');
console.log('selftest passed');
