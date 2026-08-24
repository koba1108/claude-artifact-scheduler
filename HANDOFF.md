# Claude Artifact Scheduler 引き継ぎ

更新日: 2026-08-24
対象: `https://github.com/koba1108/claude-artifact-scheduler`

## 目的

Claude Artifact上で動作する個人向けスケジュール管理アプリを完成させ、静的検証、通常ブラウザQA、Claude Artifact実環境の受け入れ試験を行う。

新しいリポジトリは作成しない。作業先は `koba1108/claude-artifact-scheduler` に統一する。

## 現在の構成

- `artifact.html`: HTML、CSS、JavaScriptを含む本番成果物
- `README.md`: 利用方法、検証、制約、現在の確認範囲
- `AGENTS.md`: コーディングエージェント向け必須ルール
- `CLAUDE.md`: Claude Code向け入口
- `docs/DESIGN.md`: ストレージ、スキーマ、保存、マージ、復旧の正本
- `docs/TEST_PLAN.md`: 通常ブラウザと実Artifactの受け入れ手順・記録
- `docs/ROADMAP.md`: P0後の候補
- `scripts/validate.mjs`: 依存なし静的検証
- `.github/workflows/validate.yml`: Node.js 24のCI
- `examples/sample-export.json`: インポート確認用サンプル
- `mobile-preview.png`: 380px表示の参考画像

## 絶対条件

- 本番成果物は `artifact.html` の単一ファイル
- ビルド工程、package manager、フレームワーク、外部依存、サーバーを追加しない
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

## 検証

依存関係の導入は不要。

```bash
node scripts/validate.mjs
```

期待する最終行:

```text
All validations passed.
```

通常ブラウザでは揮発性プレビューになる。再読み込みで予定が消えることは期待動作で、実Artifactの永続性を証明しない。

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
6. `git status -sb` と現在のPR / CI
7. `node scripts/validate.mjs`
8. 380pxとPC幅の通常ブラウザQA
9. Claude Artifact実機と複数端末QA

P0の受け入れが終わるまで、繰り返し予定などへスコープを広げない。
