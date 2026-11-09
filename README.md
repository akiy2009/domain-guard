# Domain Guard — 偽ドメイン検知

[![CI](https://github.com/akiy2009/domain-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/akiy2009/domain-guard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

フィッシング詐欺で使われる **偽ドメイン（なりすまし URL）** を、閲覧中のページに対してリアルタイムに解析する Chrome 拡張機能です。Manifest V3・日本語 UI・外部サーバー不要で動作します。

- タイポスクワティング、同形異義語（IDN）攻撃、正規ドメインの埋め込みを検出
- Public Suffix List（PSL）で `co.jp` / `github.io` などのドメイン境界を正しく判定
- 危険度スコア（0–100）と根拠をポップアップに表示
- 危険なサイトは警告ページでブロック（設定で無効化可能）
- ホワイトリスト、検知ルールの個別 ON/OFF、外観カスタマイズ
- Google Safe Browsing 連携（任意・API キーが必要）

> [!IMPORTANT]
> 本拡張機能の判定はヒューリスティックによる**参考情報**です。100% 正確ではなく、正規サイトが警告される（誤検知）ことや、新しい手口を見逃すことがあります。パスワードやカード情報を入力する前に、必ずアドレスバーのドメインを確認してください。

## 目次

- [インストール](#インストール)
- [使い方](#使い方)
- [検知できる攻撃パターン](#検知できる攻撃パターン)
- [危険度スコア](#危険度スコア)
- [設定](#設定)
- [Google Safe Browsing（任意）](#google-safe-browsing任意)
- [プライバシーと権限](#プライバシーと権限)
- [開発](#開発)
- [ディレクトリ構成](#ディレクトリ構成)
- [既知の制限](#既知の制限)
- [ライセンス](#ライセンス)

## インストール

### Chrome ウェブストア

準備中です。公開後はストアのページからインストールできます。

### 開発者モード（ソースから）

1. このリポジトリを取得します。

   ```bash
   git clone https://github.com/akiy2009/domain-guard.git
   ```

2. Chrome で `chrome://extensions` を開きます。
3. 右上の「**デベロッパーモード**」を ON にします。
4. 「**パッケージ化されていない拡張機能を読み込む**」をクリックし、`domain-guard` フォルダを選択します。
5. ツールバーの Domain Guard アイコンをピン留めします。

対応バージョン: **Chrome 110 以降**（Manifest V3 / `chrome.storage.session` を使用）。

## 使い方

| 操作 | 内容 |
|---|---|
| ページを開く | http/https のページを自動解析し、アイコンにバッジ（`OK` `!` `!!` `!!!` `危`）を表示 |
| アイコンをクリック | 危険度、登録ドメイン、検出された特徴と解説を表示 |
| 「再解析」 | キャッシュを無視して再チェック |
| 「信頼済みに追加」 | 現在の登録ドメインをホワイトリストへ追加（危険判定時は確認あり） |
| 設定（⚙） | 検知感度、ブロック、通知、Safe Browsing、ルール、外観などを変更 |

「危険」と判定されたページを開こうとすると、警告ページに切り替わります。内容を確認したうえで「危険を承知で開く」を選ぶと、**同じ登録ドメインへのアクセスが 2 分間だけ**許可されます。

## 検知できる攻撃パターン

| ルール | 例 |
|---|---|
| 数字置換（リート表記） | `g00gle.com` `paypa1.com` |
| タイポスクワティング | `gooogle.com` `arnazon.com` |
| 同形異義語（キリル文字など） | `gоogle.com`（`о` がキリル文字） |
| punycode の偽装 | `xn--pypal-4ve.com` |
| 正規ドメインの埋め込み | `paypal.com.evil-example.com` `www.google.co.jp.fake-site.net` |
| ブランド名の無断使用 | `secure-paypal-login.top` |
| URL 内の `@` 偽装 | `https://google.com@evil-phish.com/` |
| 制御文字・双方向文字 | 見えない文字でアドレス表示を偽装 |
| IP アドレス直指定 | `http://192.168.10.5/login.php` |
| 高リスク TLD | `.tk` `.ml` `.zip` `.mov` `.top` `.xyz` など |
| 誘導キーワード | `login` `verify` `account` `bank` などを含むドメイン |
| 無料ホスティング | `*.herokuapp.com` `*.vercel.app` `*.github.io` など |
| 短縮 URL | `bit.ly` `t.co` など |
| ドメイン構造 | 深いサブドメイン、過剰なハイフン・数字、長すぎるホスト名、異常ポート |
| HTTP 通信 | 暗号化なし（ログイン関連語句がある場合は加点） |
| Google Safe Browsing（任意） | 既知のフィッシング・マルウェア URL |

## 危険度スコア

各ルールの加点を合計し、感度係数（緩い 0.6 / 標準 1.0 / 厳しい 1.4）を掛けて 0–100 に丸めます。確度の高いなりすまし（数字置換・同形異義語・正規ドメイン埋め込みなど）は、感度に関係なく **最低 70** になる下限を設けています。

| スコア | 判定 | 目安 |
|---:|---|---|
| 0 | 安全 | 問題なし |
| 1–24 | ほぼ安全 | 軽微な兆候 |
| 25–44 | 要注意 | 内容を確認 |
| 45–69 | 危険の可能性大 | 個人情報の入力前に確認 |
| 70–100 | 危険 | 警告ページでブロック（設定時） |

ホワイトリストに登録したドメインとそのサブドメインは、すべての検知より優先して「安全」と判定します。

## 設定

ツールバーのアイコン → ⚙、または `chrome://extensions` → Domain Guard → 「拡張機能のオプション」で開きます。

| 設定 | 説明 |
|---|---|
| 検知機能 | 全体の ON/OFF |
| 検知の感度 | 緩い / 標準 / 厳しい |
| 危険なサイトのブロック | 「危険」判定時に警告ページへ切り替える |
| デスクトップ通知 | 危険検知時に OS 通知を表示 |
| Safe Browsing | API キーを使って Google のデータベースと照合 |
| 検知ルール | ルールごとに ON/OFF（常時有効のルールを除く） |
| ホワイトリスト | 信頼するドメインの追加・削除（最大 500 件） |
| 外観 | テーマ（端末設定 / ライト / ダーク）、アクセント色、判定色 |
| データ管理 | 設定のエクスポート / インポート / 初期化（API キーはエクスポートされません） |
| URL チェッカー | 実際に開かずに URL を解析 |

ホワイトリストには URL、IDN、`*.example.com` 形式のワイルドカードを入力できます。`com` や `co.jp` などの公開サフィックス全体、IP アドレス、単一ラベルは登録できません。

## Google Safe Browsing（任意）

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成します。
2. 「Safe Browsing API」を有効化し、API キーを発行します。
3. 設定画面で API キーを入力し、「API キーをテスト」を押します。成功すると連携が ON になります。

キー未設定でもヒューリスティック解析はすべて動作します。Safe Browsing を有効にすると、解析対象の URL が Google に送信されます（詳細は [PRIVACY.md](PRIVACY.md)）。

## プライバシーと権限

- 開発者のサーバーは存在せず、解析結果を外部へ送信しません。
- ページ本文を読むコンテンツスクリプトは使用しません。
- Safe Browsing を有効にした場合のみ、対象 URL を Google に送信します。
- 設定は `chrome.storage.sync`、警告情報と一時バイパスは `chrome.storage.session` に保存します。

権限の詳細は [docs/permissions.md](docs/permissions.md)、プライバシーポリシーは [PRIVACY.md](PRIVACY.md) を参照してください。

## 開発

Node.js 20 以降が必要です。**実行時・開発時の npm 依存パッケージはありません。**

```bash
npm test              # node:test によるユニットテスト
npm run lint:syntax   # 全 JS/JSON の構文チェック（ESM として検証）
npm run check         # 構文チェック + テスト
npm run build         # dist/ に配布用フォルダと ZIP を生成
npm run psl           # Public Suffix List を更新
npm run psl:check     # 生成済み PSL が最新か確認（ネットワーク使用）
```

### 配布用 ZIP

```bash
npm run build
# dist/domain-guard-1.1.0.zip
```

ZIP には `manifest.json`、`background.js`、`lib/`、`popup/`、`options/`、`warning/`、`icons/`、`_locales/` のみが含まれます。テスト・ツール・ドキュメントは含まれません。

### 構成

```text
domain-guard/
├── manifest.json          # Manifest V3
├── background.js          # Service Worker（解析・バッジ・通知・ブロック）
├── lib/
│   ├── analyzer.js        # 解析エンジン（スコアリング）
│   ├── brands.js          # ブランド辞書・リスク TLD・キーワード
│   ├── psl.js             # Public Suffix List マッチャー
│   ├── psl-data.js        # 生成済み PSL データ（自動生成）
│   ├── punycode.js        # punycode デコーダー
│   ├── rules.js           # ルールメタデータ
│   ├── settings.js        # 設定の正規化・保存
│   ├── theme.js           # 配色・テーマ
│   └── utils.js           # 距離計算・文字種・IP 判定など
├── popup/                 # ポップアップ UI
├── options/               # 設定画面
├── warning/               # 警告ページ
├── icons/                 # 16/32/48/128 px
├── _locales/              # ja / en
├── test/                  # node:test
├── tools/                 # ビルド・構文チェック・PSL 更新・アイコン生成
└── docs/                  # 設計・権限・ストア掲載文
```

設計の詳細は [docs/architecture.md](docs/architecture.md) を参照してください。

## 既知の制限

- ヒューリスティック判定のため、未知の手口や、ブランド辞書にないサービスへのなりすましは検出できない場合があります。
- 日本語・英語の主要サービスを中心としたブランド辞書です。追加は `lib/brands.js` で行えます。
- ホワイトリストに登録したドメインは、そのサブドメインも含めて警告されません。信頼できると確認できた場合のみ登録してください。
- Safe Browsing の可用性・精度は Google のサービスに依存します。
- 警告ページの「危険を承知で開く」は 2 分間の一時的なバイパスです。再度アクセスすると警告が出ます。

## コントリビューション

[CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。脆弱性の報告は [SECURITY.md](SECURITY.md) へお願いします。

## ライセンス

[MIT License](LICENSE)

同梱の Public Suffix List データは Mozilla Public License 2.0 の下で提供されています（[publicsuffix.org](https://publicsuffix.org/)）。
