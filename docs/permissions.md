# 権限の説明

Domain Guard が要求する権限と、その利用目的です。Chrome ウェブストアの審査では、各権限が機能に必要であることを説明する必要があります。

## `storage`

設定、ホワイトリスト、外観、Safe Browsing API キーを `chrome.storage.sync` に保存します。警告ページ用の解析結果と一時バイパスは `chrome.storage.session` に保存します。

- 設定を失わずに再利用するため
- Service Worker が停止しても、短時間の警告情報を引き継ぐため

## `tabs`

- 現在のタブの URL を取得して解析する（`GET_TAB_URL`）
- 危険な遷移を警告ページへ差し替える（`chrome.tabs.update`）
- タブごとのバッジを設定する（`chrome.action.setBadgeText`）
- 通知クリック時に対象タブを前面に出す

ページ本文や入力内容の読み取りには使用しません。

## `webNavigation`

メインフレームの遷移開始（`onBeforeNavigate`）を検知し、遷移前に URL を解析します。危険と判定した場合に警告ページへ切り替えるために必要です。履歴の読み取りや改ざんは行いません。

## `notifications`

危険と判定したページを開いた際に、OS のデスクトップ通知を表示します（設定で OFF 可能）。通知にはホスト名と判定のみを含め、URL 全体や個人情報は含めません。

## `https://safebrowsing.googleapis.com/*`

Google Safe Browsing API（`threatMatches:find`）を呼び出すために必要です。利用者が API キーを設定し、連携を有効にした場合のみ使用します。

## 要求しない権限

| 権限 | 理由 |
|---|---|
| `activeTab` / `scripting` | ページ内でスクリプトを実行しないため |
| `<all_urls>`（ホスト権限） | URL は `tabs` / `webNavigation` から取得でき、ページ内容は読まないため |
| `history` | 閲覧履歴を保存・参照しないため |
| `cookies` | Cookie を読み書きしないため |
| `webRequest` | 通信の傍受・改変をしないため |
| `clipboardWrite` | 警告ページのコピーはユーザー操作時の `navigator.clipboard` で行うため |

## データの流れ

```text
URL（タブ情報）
  │
  ├─ 端末内で解析 ──► バッジ / ポップアップ / 警告ページ
  │
  └─ Safe Browsing 有効時のみ ──► Google Safe Browsing API
```

開発者のサーバーへの送信はありません。詳細は [../PRIVACY.md](../PRIVACY.md) を参照してください。
