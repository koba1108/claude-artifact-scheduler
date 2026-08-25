# Claude Artifact Scheduler 引き継ぎ

更新日: 2026-08-25
対象: `https://github.com/koba1108/claude-artifact-scheduler`

## 目的

Claude Artifact上で動作する個人向けスケジュール管理アプリを、ローカルで実装・検証・ビルドし、GitHub repositoryから単一HTMLとして配布する。

新しいrepositoryは作成しない。作業先は `koba1108/claude-artifact-scheduler` に統一する。

## 2026-08-25の方針変更

旧構成のルート `artifact.html` 直編集から、React + TypeScript + Vite + Tailwind CSS + Bunへ移行した。Viteのsingle-file buildにより、最終成果物は引き続き自己完結したHTML 1ファイルを維持する。

- ソース: `src/`
- 開発entry: `index.html`
- 配布物: `dist/index.html`
- package manager / script runner: Bun
- build: Vite + `vite-plugin-singlefile`
- style: Tailwind CSS
- CI build: なし
- build差分の防止: repository内のpre-commit / pre-push hook
- 配布: GitHub repositoryへ `dist/index.html` を含めてpush

## 現在の構成

- `src/App.tsx`: React UIと画面内保存制御
- `src/domain.ts`: 日付、検証、イベントマージ、tombstone、import解析
- `src/storage.ts`: 個人スコープ `window.storage` と安全な読み込み・破損復旧
- `src/*.test.ts`: Bunのdomain / storage unit test
- `dist/index.html`: JavaScriptとCSSを内包した本番成果物
- `vite.config.ts`: 単一HTMLのbuild設定
- `scripts/validate.mjs`: 生成物とソースの静的検証
- `scripts/install-hooks.sh`: `.githooks` の有効化
- `.githooks/pre-commit`: 検証、build、生成物stage
- `.githooks/pre-push`: 再検証、未commit生成差分の拒否
- `docs/DESIGN.md`: ストレージ、スキーマ、保存、マージ、復旧、buildの正本
- `docs/TEST_PLAN.md`: 通常ブラウザと実Artifactの受け入れ手順・記録

## 絶対条件

- 本番成果物は `dist/index.html` の単一ファイル
- 生成物を手編集せず、React / TypeScriptソースからbuildする
- 本番実行時の外部依存、CDN、外部アセット、サーバーを追加しない
- 予定・設定の永続化は個人スコープの `window.storage` だけ
- `window.storage` の第2引数 `shared` を渡さない
- ブラウザ側の永続ストレージやCookieを使わない
- 予定を外部APIへ送らない
- データは `schedule:v1:YYYY-MM` の月単位で保存
- 日付はローカル時間の `YYYY-MM-DD`。UTC変換を使わない
- 自動ポーリングを行わない
- 380px幅で横スクロールを起こさない

詳細は必ず `AGENTS.md` と `docs/DESIGN.md` を先に読む。

## データ消失を防ぐ要点

1. `get` 失敗後に `list` で完全一致キーがない場合だけ未作成月と判断する。
2. 既存状態が不確実なら空表示は許容するが、その月を保存しない。
3. 保存前に対象月を再取得し、イベントIDと `updatedAt` でread-modify-writeする。
4. 同時刻で削除と通常イベントが競合した場合は削除を優先する。
5. 削除tombstoneは30日保持する。
6. 破損原文はbrokenキーへの退避成功後だけ正規キーを初期化する。
7. 保存開始後に追加された操作は完了済み操作と一緒に消さない。
8. 保存失敗時は入力とpending operationを画面内に保持する。

## 初回セットアップと検証

```bash
bun install --frozen-lockfile
bun run hooks:install
bun run verify
git diff --check
```

`bun run verify` は型検査、14件のunit test、build、生成物validatorを実行する。期待するvalidatorの最終行は次のとおり。

```text
All validations passed.
```

通常ブラウザでは揮発性プレビューになる。再読み込みで予定が消えることは期待動作で、実Artifactの永続性を証明しない。

## Git運用

CIへbuild差分checkは置かない。hookはローカル設定なので、cloneごとに `bun run hooks:install` が必要。

- commit時に `dist/index.html` が自動再生成・stageされる。
- push時に同じ検証を再実行する。
- build後の `dist/index.html` に未commit差分があればpushを停止する。
- commit / push / PR作成は、それぞれ明示的な依頼範囲を守る。

## 実環境で優先確認する項目

- `window.storage` の未存在キーに対する例外と `list` の戻り値
- `set` 成功時の戻り値
- Artifactを閉じ直した後と最新版更新後の永続性
- 同じアカウントの複数端末参照
- 別イベント同時追加、同一イベント編集、削除復活防止
- 保存失敗時の入力保持と再試行
- 実データ相当のエクスポート / インポート

未確認項目を通常ブラウザの結果から推定で合格にしない。結果は `docs/TEST_PLAN.md` へ記録する。

## 作業開始順

1. `HANDOFF.md`
2. `AGENTS.md`
3. `README.md`
4. `docs/DESIGN.md`
5. `docs/TEST_PLAN.md`
6. `git status -sb`
7. `bun install --frozen-lockfile`
8. `bun run verify`
9. 380pxとPC幅の通常ブラウザQA
10. Claude Artifact実機と複数端末QA

P0の受け入れが終わるまで、繰り返し予定などへスコープを広げない。
