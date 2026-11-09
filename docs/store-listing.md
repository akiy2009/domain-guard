# Chrome ウェブストア掲載文（下書き）

## 基本情報

| 項目 | 内容 |
|---|---|
| 名前 | Domain Guard - 偽ドメイン検知 |
| 短い説明 | 偽ドメイン・フィッシングURLをリアルタイム検知。危険度と根拠を表示し、危険なサイトをブロックします。 |
| カテゴリ | プライバシーとセキュリティ |
| 言語 | 日本語（英語 UI も同梱） |
| プライバシーポリシー | `https://github.com/akiy2009/domain-guard/blob/main/PRIVACY.md` |
| ホームページ | `https://github.com/akiy2009/domain-guard` |
| サポート | `https://github.com/akiy2009/domain-guard/issues` |

短い説明は 132 文字以内です（上記は約 50 文字）。

## 詳細説明（日本語）

```text
Domain Guard は、フィッシング詐欺で使われる「偽ドメイン」をリアルタイムに検知する拡張機能です。

■ 主な機能
・タイポスクワティング（gooogle.com など）を検出
・数字置換（g00gle.com、paypa1.com）を検出
・キリル文字などを使った同形異義語攻撃（gоogle.com）を検出
・正規ドメインをサブドメインに埋め込む手口（paypal.com.evil.example）を検出
・危険度を 0〜100 のスコアと根拠で表示
・危険なサイトは警告ページでブロック（設定で無効化可能）
・ホワイトリスト、検知ルールの個別 ON/OFF、ライト/ダークテーマ
・Google Safe Browsing 連携（任意・API キーが必要）

■ 安心して使える設計
・解析はすべて端末内で完結し、開発者のサーバーへデータを送信しません
・ページ本文や入力内容を読むコンテンツスクリプトを使用しません
・Safe Browsing を有効にした場合のみ、対象 URL を Google に送信します
・広告・分析・トラッキングはありません

■ こんな場面で役立ちます
・メールや SMS のリンクを開く前の確認
・オンラインバンキング、決済、SNS の偽ログインページ対策
・不用意な入力による ID・パスワード・カード情報の漏えい防止

■ ご注意
判定は URL の特徴によるヒューリスティックな参考情報です。100% 正確ではなく、正規サイトが警告されることや、新しい手口を見逃すことがあります。パスワードやカード情報を入力する前に、必ずアドレスバーのドメインをご確認ください。

■ プライバシー
https://github.com/akiy2009/domain-guard/blob/main/PRIVACY.md
```

## Detailed description (English)

```text
Domain Guard detects fake, look-alike, and phishing domains in real time.

• Typosquatting, leetspeak, and homograph/IDN attacks
• Embedded-brand and userinfo (@) tricks
• Risk score (0–100) with human-readable reasons
• Warning page that blocks dangerous navigations
• Whitelist, per-rule toggles, light/dark theme
• Optional Google Safe Browsing integration

All analysis runs on-device. There is no developer server, no analytics, and no content script that reads page content. URLs are sent to Google only when Safe Browsing is explicitly enabled with an API key.

Detection is heuristic and for reference only. Always check the address bar before entering credentials.
```

## 権限の申請理由

Chrome ウェブストアの「権限の justification」欄には、次の要約を使用できます。詳細は [permissions.md](permissions.md)。

| 権限 | 理由 |
|---|---|
| `storage` | 設定・ホワイトリスト・警告情報を端末内に保存するため |
| `tabs` | 現在のタブの URL 取得、バッジ表示、警告ページへの切り替えのため |
| `webNavigation` | 遷移前に URL を検査し、危険なサイトをブロックするため |
| `notifications` | 危険検知時にデスクトップ通知を表示するため |
| `https://safebrowsing.googleapis.com/*` | 任意の Safe Browsing 照合のため |

## 単一目的の説明

> 閲覧中の URL を解析して偽ドメイン・フィッシングの危険度を判定し、利用者に警告すること。

## データ使用の申告

- 収集するデータ: なし（開発者サーバーへの送信なし）
- 認証情報: 収集しない
- 閲覧履歴: 収集しない（端末内の現在のタブ URL のみ解析）
- 外部送信: Safe Browsing 有効時のみ、対象 URL を Google へ送信
- リモートコード: 使用しない（すべて同梱スクリプト）
- 広告・分析: なし

## スクリーンショット案

1. 安全なサイトを開いたポップアップ（緑の「安全」）
2. 偽ドメインを検知したポップアップ（危険度と根拠の一覧）
3. 警告ページ（理由・対象 URL・「前のページに戻る」）
4. 設定画面（感度・ブロック・ルール）
5. 設定画面（外観・ダークテーマ）

推奨サイズ: 1280×800 または 640×400（PNG/JPEG、5 枚まで）。

## 審査チェックリスト

- [ ] `npm run check` が成功する
- [ ] `npm run build` で生成した ZIP をクリーンな Chrome プロファイルで読み込める
- [ ] 警告ページ・ポップアップ・設定画面が日本語で表示される
- [ ] 権限の justification が実際の利用と一致している
- [ ] プライバシーポリシーの URL が公開されている
- [ ] リモートコード・インラインスクリプトがない
- [ ] スクリーンショットに実在の個人情報が含まれていない
