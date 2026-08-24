# claude-artifact-scheduler

Claude Artifact の `window.storage` を使い、同じClaudeアカウントで開いた複数端末から予定を共有する、サーバーレスの個人向けスケジュール管理アプリです。

実行物は [`index.html`](./index.html) 1ファイルだけです。HTML・CSS・JavaScriptをすべて内包し、ビルドや外部ライブラリを必要としません。

## 現在の実装範囲

設計ドキュメントの Phase 1〜3 を最初の実装へまとめています。

- 月カレンダー、日別予定一覧、追加・編集・削除
- 月単位の `window.storage` 読み書き
- 保存直前の read-modify-write
- イベントIDと `updatedAt` によるイベント単位マージ
- 論理削除と30日後のtombstone掃除
- 800ms debounce保存、画面遷移・タブ非表示時のflush
- 最終更新元、最終取得時刻、保存状態の表示
- 手動再読み込みとタブ復帰時の単発再取得
- 全キーのJSONエクスポート、月単位マージインポート
- JSON破損時の退避キー作成と空データへの復旧
- `window.storage` がない環境向けの揮発性メモリプレビュー

## Claude Artifactで使う

1. [`index.html`](./index.html) の内容をすべてコピーする。
2. ClaudeでHTML Artifactとして作成・更新する。
3. Artifactを開き、右下の設定から「保存者ラベル」を設定する。
4. 同じClaudeアカウントで別端末から同じArtifactを開く。
5. 別端末の変更は、右上の再読み込みボタンで取得する。

本番データは `window.storage` にだけ保存されます。`localStorage`、`sessionStorage`、IndexedDB、Cookieは使用しません。

## ローカルプレビュー

`index.html` をブラウザで開くだけで画面と操作を確認できます。

`window.storage` が存在しない環境では、ページ内の `Map` を使うプレビューモードに自動で切り替わります。データはメモリ上だけにあり、再読み込みやページ終了で消えます。プレビューのデータがClaude側へ送信されることもありません。

## 静的検証

Node.js以外の依存関係はありません。

```bash
node scripts/validate.mjs
```

検証内容:

- 単一HTML内のJavaScript構文
- 外部script・stylesheetがないこと
- `localStorage` / `sessionStorage` / IndexedDBを使っていないこと
- 必須の `window.storage` APIとキーprefixが実装されていること
- 5MB未満のArtifactファイルであること

Pull Requestでは同じ検証をGitHub Actionsで実行します。

## データキー

| キー | 内容 |
|---|---|
| `schedule:v1:YYYY-MM` | 月ごとの予定、更新時刻、更新元 |
| `schedule:v1:meta` | 保存者ラベル、最終バックアップ時刻 |
| `schedule:v1:YYYY-MM:broken:<epoch-ms>` | JSON破損時に退避した元データ |

月データの概略:

```json
{
  "schemaVersion": 1,
  "updatedAt": 1756000000000,
  "updatedBy": "スマホ",
  "events": [
    {
      "id": "a1b2c3",
      "date": "2026-08-25",
      "start": "10:00",
      "end": "11:00",
      "title": "定例MTG",
      "memo": "",
      "color": "blue",
      "createdAt": 1756000000000,
      "updatedAt": 1756000000000,
      "deleted": false
    }
  ]
}
```

## 同期モデル

- 自動ポーリングは行いません。
- 保存時は対象月を再取得し、イベントIDごとに新しい `updatedAt` を採用してから書き戻します。
- 同一イベントを同時編集した場合はイベント単位の後勝ちです。
- 削除は `deleted: true` として同期し、30日経過後の保存時に物理削除します。
- 月をまたぐ1件の予定は扱わず、月ごとに2件へ分けます。

## 保存者ラベルについて

端末固有の永続領域を使わないため、「スマホ」「自宅PC」のようなラベルを端末ごとに自動保持することはできません。現在は設計どおり `schedule:v1:meta` に保存するため、同じClaudeアカウント全体で共有される「現在の保存者ラベル」として扱います。

## リポジトリ構成

```text
.
├── index.html                 # Claude Artifactへ貼り付ける実行物
├── README.md                  # 利用・開発ガイド
├── AGENTS.md                  # AIエージェント向け実装ルール
├── CLAUDE.md                  # Claude Code向け入口
├── docs/
│   ├── design.md              # 設計と実装判断
│   └── manual-test.md         # 実機・複数端末テスト手順
├── scripts/
│   └── validate.mjs           # 依存なし静的検証
└── .github/workflows/
    └── validate.yml           # PR検証
```

## 検証上の注意

通常ブラウザのプレビューモードでは、追加・編集・削除、debounce保存、月移動、モーダル表示を確認できます。一方、Anthropic側の実 `window.storage`、同一アカウント複数端末、レート制限時の挙動はClaude Artifact上での実機確認が必要です。手順は [`docs/manual-test.md`](./docs/manual-test.md) にまとめています。
