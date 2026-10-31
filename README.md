# myplaywrite

Playwright（ブラウザ自動操作）で共有ページを開き、AIや人が読みやすい形（md / png / pdf）に書き出すスクリプト集です。
最初の用途は、競輪予想AI（[KEIRIN-Intelligence](https://github.com/codetea-ping999/KEIRIN-Intelligence)）用に、Museで共有された予想ノウハウのボードを書き出すことです。

## 使い方

Node.js 18以上が必要です。

```bash
npm install
npx playwright install chromium   # 初回だけ
npm run muse                      # urls.txt に書いた Muse のURLをすべて書き出す
node scripts/muse-export.mjs https://muse.ai/s/...   # URLを直接指定
node scripts/muse-export.mjs urls.txt --headed       # ブラウザ画面を表示して確認しながら
```

出力は `out/<スペース名>/` に入ります。

| ファイル | 中身 |
|---|---|
| `content.md` | ボード上の文字、画像、リンクの一覧 |
| `page.png` | ページ全体のスクリーンショット |
| `page.pdf` | 印刷用のPDF |
| `images/` | ボードに貼られている画像 |
| `out/summary.json` | 各URLの成功・失敗 |

`content.md` と `images/` を共有してもらえれば、KEIRIN-Intelligence 側で予想の項目に落とし込みます。

## 動作確認

```bash
npm test   # ネットに出ずに、手元のテスト用ページで書き出しを確認
```

## 注意

- 開くのは、共有リンクをもらったページだけです。サイト全体を巡回したり、ログインが必要なページを取りにいったりはしません。
- Claude のクラウド環境から実行する場合、`muse.ai` へのアクセスが環境のネットワーク設定で許可されている必要があります。
