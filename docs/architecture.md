# アーキテクチャ

## 全体像

```text
[ページ遷移]
   │
   ├─ chrome.webNavigation.onBeforeNavigate ──► background.js
   │        │                                      │
   │        │                                      ├─ analyzeTabUrl()  (lib/analyzer.js)
   │        │                                      ├─ checkSafeBrowsing()（任意）
   │        │                                      ├─ 警告データを storage.session へ
   │        │                                      └─ 危険なら warning.html へ差し替え
   │        │
   │        └─ chrome.tabs.onUpdated ──────────► バッジ・通知の更新
   │
   └─ ツールバー
        └─ popup/popup.html ──► background.js へ ANALYZE / GET_TAB_URL
                                  │
                                  └─ 解析結果を描画

[設定画面] options/options.html ──► lib/settings.js ──► chrome.storage.sync
```

コンテンツスクリプトは使用しません。ページの DOM や入力内容にはアクセスせず、URL と設定だけで判定します。

## 主要モジュール

| モジュール | 役割 |
|---|---|
| `lib/analyzer.js` | URL を正規化し、各ルールを評価して `findings[]` とスコアを生成 |
| `lib/psl.js` / `lib/psl-data.js` | Public Suffix List による公開サフィックス・登録ドメイン判定 |
| `lib/brands.js` | 正規ブランド、一般語トークン、リスク TLD、無料ホスティング、短縮 URL、誘導語 |
| `lib/punycode.js` | `xn--` ラベルのデコード（表示用） |
| `lib/utils.js` | レーベンシュタイン距離、リート/同形異義語の折りたたみ、文字種、IP/プライベート判定 |
| `lib/rules.js` | ルール ID・重要度・説明・カテゴリ・ON/OFF 可否 |
| `lib/settings.js` | 設定の既定値、正規化、ホワイトリスト検証、保存 |
| `lib/theme.js` | テーマ解決、配色、コントラストに応じた文字色 |
| `background.js` | 解析の実行、キャッシュ、バッジ、通知、ブロック、メッセージ処理 |
| `popup/` | 現在のタブの判定と根拠、ホワイトリスト操作 |
| `options/` | 設定、ルール、ホワイトリスト、URL チェッカー、データ管理 |
| `warning/` | ブロック時の警告、理由表示、コピー、報告、一時バイパス |

## 解析パイプライン

1. `new URL()` で URL をパース。失敗、または `http:` / `https:` 以外は即時に危険または対象外として扱う。
2. ホスト名を小文字化し、IP アドレス・プライベートホストを判定。
3. PSL から公開サフィックスと登録可能ドメイン（eTLD+1）を取得。
4. ホワイトリストに一致すれば、その時点で `safe` を返す。
5. なりすまし・難読化・ドメイン構造・TLD・誘導語・通信の各ルールを評価。
6. 加点を合計し、感度係数を適用。危険度の高い finding があれば下限 70 を適用。
7. 重大度順に並べ、`findings[]` と `score` / `level` を返す。
8. Safe Browsing が有効なら照合し、一致時はスコア 100・危険としてマージ。

### 誤検知を抑える設計

- **タイポスクワット**は編集距離 1 のみ。先頭文字が一致する場合に限定。
- 数字置換・同形異義語は、ブランドの登録ドメインと比較して判定。
- `apple` `line` `office` `live` などの一般語は `GENERIC_BRAND_TOKENS` とし、単独では危険にしない。
- 正規ブランドのドメイン（およびそのサブドメイン）では、誘導語による減点を行わない。
- `github.io` など公開サフィックス自体は、ブランド名の埋め込みとして扱わない。
- HTTP 単体はスコア 0 の情報表示。ログイン関連語句がある場合のみ加点。
- ホワイトリストはすべての判定に優先。

## ブロックとバイパス

```text
onBeforeNavigate(url)
  ├─ http/https 以外 / サブフレーム / 警告ページ自身 → 無視
  ├─ 設定が無効 or ブロック無効 → 無視
  ├─ 登録ドメインがバイパス中 → 無視
  ├─ 解析（キャッシュ利用）
  │    └─ danger 以外 → 何もしない
  ├─ 遷移前の URL を控える（戻る用）
  ├─ 警告データを storage.session に保存
  └─ chrome.tabs.update(tabId, warning.html?url=...&score=...&host=...&back=...)
```

- 解析中に別の URL へ遷移した場合は、`pendingNavigations` の URL 比較で競合を防ぎます。
- バイパスは登録ドメイン単位で `BYPASS_TTL = 2 分`。`storage.session` に保存し、期限切れは都度削除します。
- 警告データは `warn:<url>` キーで保存し、10 分を超えたものを掃除します。
- 警告ページの「前のページに戻る」は、遷移前に控えた安全な URL（`back`）へ戻ります。取得できない場合は `about:blank` へ移動します。

## キャッシュ

- Service Worker のメモリに最大 300 件、TTL 5 分で保持。
- Map の挿入順を利用した簡易 LRU。
- 設定変更時（`chrome.storage.onChanged`）に全消去。
- ポップアップの「再解析」は `force: true` でキャッシュを無視。

## 設定と状態

| 保存先 | 内容 | 寿命 |
|---|---|---|
| `chrome.storage.sync` | 設定、ホワイトリスト、外観、API キー | 永続（Chrome 同期） |
| `chrome.storage.session` | 警告データ、バイパス | ブラウザ終了まで / TTL |
| Service Worker メモリ | 解析キャッシュ、通知先 | SW 停止まで |

`lib/settings.js` はすべての入力を正規化します。ストレージから読み込んだ値が壊れていても、既定値へフォールバックします。

## セキュリティ上の考慮

- Manifest V3 の CSP は `script-src 'self'; object-src 'self'`。リモートスクリプトなし。
- すべての UI は `textContent` / `createElement` で構築し、`innerHTML` を使用しません。
- 警告ページの対象 URL は `URLSearchParams` で受け取り、表示時にテキストとして扱います。
- 外部リンクは `rel="noopener noreferrer"`、`target="_blank"`。
- メッセージ送信元が自身の拡張機能 ID であることを確認します。
- Safe Browsing API キーは設定画面から取得し、外部へは Google 以外に送信しません。エクスポートには含めません。

## テスト戦略

- `test/analyzer.test.mjs`: 正規サイトの安全判定、代表的な偽装パターン、誤検知の回帰、ホワイトリスト、ルール無効化、感度、Safe Browsing マージ。
- `test/psl.test.mjs`: 公開サフィックス、例外規則、登録ドメイン、IP。
- `test/utils.test.mjs`: 距離、文字種、制御文字、プライベートホスト、punycode。
- `test/settings.test.mjs`: 正規化、検証、ホワイトリスト、公開設定、storage。
- `test/brands.test.mjs`: ブランド辞書・TLD・キーワードの形式と重複。
- `test/project.test.mjs`: manifest とファイル参照、HTML の安全性、import 解決、DOM ID の整合、依存パッケージなし。

`tools/check-syntax.mjs` は各ファイルを `.mjs` としてコピーしてから `node --check` します。これは Node が `.js` を CommonJS として解釈し、ESM の構文エラーを見逃すのを防ぐためです。
