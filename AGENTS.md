# AGENTS.md

このリポジトリを変更するAIエージェントは、以下を必ず守ること。

## 最優先の制約

1. 本番実行物は `dist/index.html` 1ファイルとし、Gitへ含める。
2. 実装はReact + TypeScript、ビルドはVite、スタイルはTailwind CSS、package managerとスクリプト実行はBunを使う。
3. `dist/index.html` は生成物であり直接編集しない。`src/` などのソースを変更して `bun run build` で更新する。
4. 本番実行物へ外部JavaScript、CSS、画像、フォント、通信先を残さない。React等の依存はビルド時に単一HTMLへ内包する。
5. サーバーサイド処理を追加しない。
6. `localStorage`、`sessionStorage`、IndexedDB、Cookieへ予定・設定を保存しない。
7. 永続化は個人スコープの `window.storage` だけを使い、第2引数 `shared` は渡さない。
8. ストレージキーは `schedule:v1:` prefixを維持し、スキーマ変更は新versionの移行設計を伴わせる。
9. 月データは月単位の1キーへまとめ、イベントごとの細かいAPI呼び出しを増やさない。
10. `get` は必ず例外を捕捉し、`set` のnullと例外を保存失敗として扱う。
11. ユーザー入力を保存失敗時に画面上へ保持し、失われる条件を明示する。
12. UI文言は日本語、モバイル幅380pxを基準、inputのfont-sizeは16px以上とする。
13. 日付文字列はローカル時間の年月日から組み立て、UTC変換を使わない。
14. 自動ポーリング、外部通信、外部アセットを追加しない。

## ビルドと配布

- `bun.lock` をGitへ含め、通常は `bun install --frozen-lockfile` で再現する。
- `vite-plugin-singlefile` を維持し、`dist/` には `index.html` 以外を出力しない。
- GitHub Actionsでビルド差分を確認しない。ローカルのpre-commit / pre-push hookと `bun run verify` を正とする。
- 初回checkout後に `bun run hooks:install` を実行して `.githooks` を有効化する。
- 配布元はGitHub repositoryに含まれる `dist/index.html` とする。
- 依存追加・更新時は単一HTML、外部通信なし、ファイルサイズ上限、Bun lockfileを再検証する。

## データ整合性

- 日付はローカルタイム基準の `YYYY-MM-DD` 文字列で保持する。
- イベントIDは `crypto.randomUUID()` を優先する。
- 保存前に対象月を再取得してread-modify-writeする。
- イベントIDごとに `updatedAt` が新しい方を採用する。
- 削除は `deleted: true` のtombstoneで表し、30日後に掃除する。
- 月をまたぐイベントは追加しない。UIでも表示中の月に日付を制限する。
- JSON破損時は元文字列をbrokenキーへ退避してから復旧する。
- `get` の失敗時は `list` でキーの有無を補助確認する。未存在と判断できない場合は、その月の保存を止める。
- 破損データは退避に成功した場合だけ正規キーを空スキーマへ初期化する。
- 同じ更新時刻で削除と通常データが競合した場合は削除を優先する。
- 保存中に加わった操作は、完了済み操作と一緒に消さず次回保存へ残す。

## UI・操作

- 自動ポーリングを追加しない。
- 手動再読み込み、データ更新時刻、取得時刻、保存状態を常に確認できる状態を保つ。
- 日本語IME入力中のEnterを確定操作として扱わない。
- 保存は800ms程度でdebounceし、月移動・タブ非表示時はflushする。
- `window.storage` がないローカル環境では永続化しないメモリプレビューだけを提供する。

## 変更時の手順

1. `docs/DESIGN.md` と関連仕様を確認する。
2. `src/` と必要な設定・文書・テストを変更する。
3. `bun run verify` を実行し、`dist/index.html` を再生成・検証する。
4. `git diff --check` を実行する。
5. `dist/` が `index.html` 1ファイルだけであることを確認する。
6. 380px幅とPC幅で主要操作を手動確認する。
7. 実 `window.storage` に関係する変更は、Claude Artifact実機で未検証ならその旨をPRへ明記する。

## 禁止する変更例

- `dist/index.html` の手編集
- runtimeでCDNや外部アセットを参照する実装
- 月ごとではなくイベントごとに `window.storage.set` を呼ぶ設計
- 自動同期の定期ポーリング
- サーバー、DB、認証基盤の追加
- エラー時に空データを無言で保存して既存データを消す挙動
- 明示的な方針変更なしにGitHub Actionsのビルド必須checkを戻すこと
