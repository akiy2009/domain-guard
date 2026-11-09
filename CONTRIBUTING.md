# Contributing

Domain Guard へのコントリビューションを歓迎します。

## 開発環境

- Node.js 20 以降
- Chrome 110 以降（動作確認用）
- npm 依存パッケージはありません。`npm install` は不要です。

```bash
npm run check         # 構文チェック + テスト
npm run build         # 配布用 ZIP の生成
```

## 変更の流れ

1. Issue で目的・再現手順を共有してください（小さな修正は不要です）。
2. リポジトリを fork し、`main` から作業ブランチを作成します。
3. 変更を実装します。
4. `npm run check` を通します。
5. `chrome://extensions` で「パッケージ化されていない拡張機能を読み込む」から動作確認します。
6. Pull Request を作成し、変更内容・確認したブラウザ・テスト結果を記載します。

## コーディング規約

- ES Modules、2 スペースインデント、セミコロンあり。
- 実行時・開発時ともに外部 npm パッケージを追加しないでください。
- ユーザー向け文言は日本語で、簡潔かつ具体的に書いてください。
- DOM へ文字列を挿入するときは `textContent` / `createElement` を使い、`innerHTML` は使用しないでください。
- 新しい検知ルールを追加する場合は次を更新してください。
  - `lib/analyzer.js`（検知処理）
  - `lib/rules.js`（ID・説明・重要度・カテゴリ・`toggleable`）
  - `test/analyzer.test.mjs`（検知・誤検知のテスト）
  - `README.md` のルール表（必要に応じて）
- ブランドを追加する場合は `lib/brands.js` の `BRANDS` に正規ドメインを追加し、`test/brands.test.mjs` の主要ブランド一覧を更新してください。正規ドメインは必ず実在するものを確認してください。

## Public Suffix List

`lib/psl-data.js` は自動生成ファイルです。直接編集せず、次で再生成してください。

```bash
npm run psl
npm run psl:check
```

## テスト

```bash
npm test
```

テストは `test/*.test.mjs` に配置し、`node:test` と `node:assert/strict` を使用します。
解析結果のスコアは意図的に変更されることがあるため、テストでは絶対値だけでなく
「危険レベルである」「特定の finding を含む」といった性質も検証してください。

## コミットメッセージ

Conventional Commits 風の接頭辞を推奨します。

```text
feat: 新しい検知ルールを追加
fix: 警告ページの戻る動作を修正
docs: README を更新
test: PSL のテストを追加
chore: CI を更新
```

## 行動規範

互いを尊重し、建設的なフィードバックをお願いします。差別・嫌がらせ・個人情報の公開は禁止します。
