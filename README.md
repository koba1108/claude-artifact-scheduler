# Claude Artifact Scheduler

Claude Artifactの個人スコープ `window.storage` を使い、同じClaudeアカウントで開いた複数端末から予定を読み書きする、個人向け月間スケジュール管理アプリです。

開発はReact + TypeScript + Vite + Tailwind CSS + Bunで行い、本番成果物はGitへ含める [`dist/index.html`](./dist/index.html) 1ファイルです。ReactやCSSはビルド時に内包されるため、実行時のpackage install、独自サーバー、CDN、外部アセットは不要です。

## 実装済み

- モバイルファーストの月カレンダーと日別予定一覧
- 予定の追加・編集・論理削除
- 日付、開始・終了時刻、終日、タイトル、メモ、6色タグ
- 月単位の読み込みと保存
- 保存直前のread-modify-writeとイベントID単位のマージ
- 800msのdebounce、月移動・再取得・タブ非表示時の即時flush
- 保存中に追加された操作の次回保存への持ち越し
- 30日保持する削除tombstone
- 不確実な読み込み時の空上書き防止
- JSON破損時の原文退避と条件付き復旧
- 保存状態、更新日時、更新元、最終取得時刻
- 保存失敗時の入力保持、再試行、離脱警告
- ライト / ダークテーマ、保存者ラベル
- 全キーのJSONエクスポート、コピー、月単位マージインポート
- 通常ブラウザ向けの揮発性メモリプレビュー

## セットアップ

[Bun](https://bun.sh/)を用意し、checkout後に依存関係とローカルGit hookを設定します。

```bash
bun install --frozen-lockfile
bun run hooks:install
```

開発サーバー:

```bash
bun run dev
```

Viteが表示するローカルURLをブラウザで開きます。`window.storage` がないため、通常ブラウザではページ内の `Map` だけを使う「プレビューモード」になります。追加・編集・削除・入出力は確認できますが、再読み込みすると予定は消えます。

## ビルドと検証

```bash
bun run verify
```

この1コマンドでTypeScript型検査、Bunテスト、Viteビルド、生成物の静的検証を順に行います。生成先は `dist/index.html` です。

静的検証では次を確認します。

- `dist/` が完全な単一HTMLだけで、1MB未満
- JavaScriptとCSSがインライン化され、外部JavaScript、CSS、メディア、通信がない
- 端末側の永続ストレージ、Cookie、自動ポーリング、UTC日付変換を使っていない
- `window.storage` の4メソッドを個人スコープで呼ぶ
- 必須画面、保存・同期安全策、キー形式が存在する
- フォーム要素の文字サイズが16px以上

個別コマンドも利用できます。

```bash
bun run typecheck
bun test
bun run build
bun run validate
```

## ローカルhookとGitHub配布

このrepositoryではCIによるビルド差分checkを行いません。ローカルのhookを正とします。

- pre-commit: `bun run verify` を実行し、生成した `dist/index.html` をstageする
- pre-push: `bun run verify` を再実行し、生成物に未commit差分があればpushを止める

これにより、ソースとビルド済み成果物を同じcommitでGitHubへpushできます。利用者はGitHub repositoryをclone/downloadし、`dist/index.html` をそのまま取得できます。GitHub Pagesや専用配布サーバーは前提にしません。

## Claude Artifactで使う

1. GitHub repositoryの `dist/index.html` を取得する。
2. ファイルの全文をClaudeのHTML Artifactへ貼り付ける。
3. Artifactを開き、右上の設定から保存者ラベルを設定する。
4. 予定を追加し、「保存完了」と更新日時が表示されることを確認する。
5. 同じClaudeアカウントの別端末で同じArtifactを開く。
6. 他端末の変更は右上の再読み込みボタン、または15秒以上離れてからのタブ復帰で取得する。

予定と設定は `window.storage` だけへ保存します。第2引数の共有スコープは指定しません。端末側の永続ストレージ、Cookie、外部APIは使いません。

## 保存キー

| キー | 内容 |
|---|---|
| `schedule:v1:YYYY-MM` | 月ごとの予定、更新時刻、更新元 |
| `schedule:v1:meta` | 保存者ラベル、テーマ、最終バックアップ時刻 |
| `schedule:v1:YYYY-MM:broken:<epoch-ms>` | JSON破損時に退避した元文字列 |

月データの例:

```json
{
  "schemaVersion": 1,
  "updatedAt": 1787558400000,
  "updatedBy": "自宅PC",
  "events": [
    {
      "id": "sample-event-1",
      "date": "2026-08-25",
      "start": "10:00",
      "end": "11:00",
      "title": "定例ミーティング",
      "memo": "オンライン",
      "color": "blue",
      "createdAt": 1787558400000,
      "updatedAt": 1787558400000,
      "deleted": false
    }
  ]
}
```

## 同期とデータ保護

- 自動ポーリングは行いません。
- 保存前に対象月を再取得し、イベントIDごとに新しい `updatedAt` を採用します。
- 同時刻で削除と通常データが競合した場合は削除を優先します。
- 一方にしかないイベントは維持します。
- 同一イベントの同時編集はフィールド単位ではなくイベント単位の後勝ちです。
- 削除は `deleted: true` として30日保持し、古い端末からの復活を抑えます。
- `get` の失敗後に `list` でも未存在を確認できない場合、画面は空表示にできますが、その月全体の保存は止めます。
- JSON破損時は原文をbrokenキーへ退避し、退避成功後だけ正規キーを空スキーマへ復旧します。
- 端末時計のずれは補正しません。

詳細は [`docs/DESIGN.md`](./docs/DESIGN.md) を参照してください。

## バックアップ

設定画面の「バックアップを作成」で `schedule:v1:` 配下をJSONへ書き出します。インポートは正規の月キーだけを対象に、既存イベントを消さずIDと更新時刻でマージします。brokenキーを現行データへ戻しません。

## 現在の確認範囲

2026-08-25にReact版の型検査、14件のBunテスト、単一HTMLビルド、静的検証を実施しています。通常ブラウザの380px幅では、追加、時刻あり予定、空タイトル検証、月移動時flush、ダークテーマ、バックアップ作成、横スクロールなしを確認しています。

これらはAnthropic側の実 `window.storage` の証明ではありません。Artifactを閉じた後の永続性、実APIの例外・戻り値、同一アカウントの複数端末同期は、Claude Artifact実環境でのみ確認できます。実施結果と未確認項目は [`docs/TEST_PLAN.md`](./docs/TEST_PLAN.md) に記録します。

## 既知の制約

- プッシュ同期、定期ポーリング、端末時計補正はない
- 月をまたぐ1件の予定、繰り返し予定、通知、参加者は非対応
- 他ユーザー共有、外部カレンダー連携は非対応
- 保存者ラベルは端末固有ではなく、同一アカウント内で共有される
- 通常ブラウザのプレビューデータは再読み込みで消える

将来候補は [`docs/ROADMAP.md`](./docs/ROADMAP.md) に分離しています。P0の実環境確認が終わるまで追加機能を優先しません。

## リポジトリ構成

```text
.
├── src/                    # React / TypeScriptソースとBunテスト
├── index.html              # Viteの開発用entry
├── dist/index.html         # GitHubから配布する単一HTML
├── package.json
├── bun.lock
├── vite.config.ts
├── tsconfig.json
├── .githooks/              # ローカルpre-commit / pre-push
├── scripts/                # hook設定と生成物validator
├── docs/                   # 設計・テスト・ロードマップ
├── examples/
├── HANDOFF.md
├── AGENTS.md
└── mobile-preview.png
```
