# Claude Artifact Scheduler 設計

## 1. ゴール

同じClaudeアカウントで開いた複数端末から、共通の個人スケジュールを読み書きできるHTML Artifactを提供する。

- 実装はReact + TypeScript、スタイルはTailwind CSS
- Bun + Viteでローカルbuildする
- 実行物はGitへ含める `dist/index.html` 1ファイル
- React、JavaScript、CSSはbuild時に実行物へ内包する
- フロントエンドのみで、runtimeの外部依存とサーバーを持たない
- 永続化は個人スコープの `window.storage` だけ
- ローカル端末には予定・設定を永続化しない
- 同期は保存時、手動再取得、条件を満たすタブ復帰時に行う

## 2. 実行環境の境界

本番実行物には次を追加しない。

- サーバー、DB、独自認証
- 外部JavaScript、CSS、画像、フォント
- 外部APIへの予定送信
- `localStorage`、`sessionStorage`、IndexedDB、Cookieへの予定・設定保存
- 定期ポーリング
- `window.storage` の第2引数 `shared`

通常ブラウザでは `window.storage` が存在しない場合だけ、ページ内 `Map` を使う。プレビュー用データは再読み込みで消える。

### 2.1 ビルドと配布の境界

開発依存は `package.json` と `bun.lock` で管理する。`vite-plugin-singlefile` によりReact bundleとTailwind CSSを1つのHTMLへ内包し、`dist/` には `index.html` 以外を出力しない。

```text
src/ + index.html
        │ bun run build
        ▼
dist/index.html ── Gitへcommit ── GitHub repositoryから配布
```

- `dist/index.html` は生成物としてGitへ含め、直接編集しない。
- local pre-commit hookは `bun run verify` 後に生成物をstageする。
- local pre-push hookは再build後に未commit差分がないことを確認する。
- GitHub Actionsによるbuild差分checkは行わない。
- 実行時にはpackage manager、dev server、CDNを必要としない。

## 3. window.storageアダプター

本番では次の4メソッドをラップする。

```js
await window.storage.get(key)
await window.storage.set(key, value)
await window.storage.delete(key)
await window.storage.list(prefix)
```

APIの戻り値差異に備え、`get` は文字列または `{ value: string }`、`list` は文字列配列または `{ keys: [...] }` を正規化する。`set` の戻り値が `null` / `undefined`、または例外の場合は保存失敗とする。

### 3.1 未存在と取得失敗の区別

`get` は、未存在キーと通信失敗で同じ例外を返す可能性がある。読み込みは次の3状態で扱う。

1. `get` 成功: `found`
2. `get` 失敗後、`list(key)` 成功かつ完全一致キーなし: `absent`
3. `get` 失敗後、完全一致キーあり、または `list` も失敗: `uncertain`

`absent` だけを新しい空月として扱う。`uncertain` は画面を空で表示できるが、その月への保存を止める。これにより、通信障害中の空配列で既存月を上書きしない。

## 4. キーとスキーマ

```text
schedule:v1:2026-08
schedule:v1:2026-09
schedule:v1:meta
schedule:v1:2026-08:broken:1787558400000
```

月単位へ分割する理由:

1. 異なる月の編集を分離する
2. 1回の読み書きを小さく保つ
3. 破損・バックアップ・復旧を月単位に限定する

`v1` は固定のスキーマversionである。破壊的変更では既存キーを上書きせず、別versionと移行設計を用意する。

### 4.1 月データ

```ts
type MonthData = {
  schemaVersion: 1;
  updatedAt: number | null;
  updatedBy: string | null;
  events: ScheduleEvent[];
};

type ScheduleEvent = {
  id: string;
  date: string;          // ローカル時間基準 YYYY-MM-DD、キーの月と一致
  start: string | null;  // HH:mm。終日はnull
  end: string | null;
  title: string;
  memo: string;
  color: "blue" | "green" | "orange" | "pink" | "purple" | "gray";
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
};
```

日付文字列は `Date#getFullYear`、`getMonth`、`getDate` から組み立てる。UTC変換は使わない。

### 4.2 meta

```ts
type Meta = {
  schemaVersion: 1;
  deviceName: string;
  lastBackupAt: number | null;
  theme: "light" | "dark";
};
```

端末ローカル永続領域を使わないため、`deviceName` は厳密な端末IDではない。同一アカウントで共有される「次に保存する更新元ラベル」とする。

## 5. 画面内状態

Reactのstateとrefで管理する。永続データと保存制御の責務を分け、保存処理からは最新のrefを参照する。

- `currentMonth` / `selectedDate`
- `monthData` / `meta`
- `loadCertainty`
- `pendingOperations`
- `nextOperationId`
- `saveTimer` / `savePromise`
- `lastFetchedAt` / `lastVisibilityFetchAt`
- `status`

予定操作はまず画面内の `monthData` へ反映し、イベントの完全スナップショットを一意な操作ID付きで `pendingOperations` に積む。

## 6. マージ規則

イベントIDごとに比較する。

- 一方にしかないIDは維持する
- `updatedAt` が大きい方を採用する
- 同じ `updatedAt` で削除と通常データが競合した場合は削除を採用する
- それ以外の同値は後から適用したイベントを採用する
- フィールド単位のマージは行わない

削除は配列から外さず、`deleted: true` と新しい `updatedAt` を持つtombstoneにする。保存時点で30日を超えたtombstoneだけ物理削除する。

## 7. 保存アルゴリズム

```text
1. 保存開始時点のpending operationだけをスナップショット
2. 対象月を再取得し、found / absent / uncertainを判定
3. uncertainなら保存せず、入力とpendingを画面内に保持
4. remote eventsへスナップショットのeventをID単位でマージ
5. 30日超のtombstoneを除去
6. updatedAt / updatedByを更新
7. 月データ全体を1回のwindow.storage.setで保存
8. 成功した操作IDだけpendingから除去
9. 保存中に追加された操作があれば次回保存を予約
```

保存前に画面内の全イベントを無条件でremoteへ重ねない。保存開始後の追加入力は、先行保存の完了処理で消さず、次回のスナップショットへ残す。

### 7.1 保存契機

- 操作後800msのdebounce
- 月移動前
- 手動再読み込み前
- タブが非表示になった時
- 保存失敗後の「再試行」

保存失敗中は月移動を止める。`beforeunload` ではpendingまたは保存中なら離脱警告を出す。

## 8. 読み込みと再取得

- 初期表示で当月を1回取得
- 月移動はpendingのflush成功後に実施
- 手動再読み込みもflush成功後に実施
- タブ復帰時は、pendingと保存処理がなく、前回復帰取得から15秒以上なら現在月を1回取得
- 自動ポーリングは行わない

更新状態として、読み込み中、最新、保存待ち、保存中、保存完了、保存失敗を表示する。月キーの更新日時、更新元、ページの最終取得時刻も常に確認できるようにする。

## 9. 破損データ

月キーのJSON parseまたはスキーマ検証に失敗した場合:

1. 原文を `schedule:v1:YYYY-MM:broken:<epoch-ms>` へ保存
2. 退避成功時だけ正規月キーを空のv1スキーマへ初期化
3. 退避または初期化に失敗した場合は `uncertain` として保存停止
4. 退避キーまたは停止理由を画面へ表示

退避に失敗した状態で正規キーを空にしてはならない。

## 10. UI

### 月カレンダー

- 日曜始まりの7列
- 今日と選択日を区別
- 予定がある日に最大3個の色ドット
- 前月、翌月、今日、手動再読み込み
- 380px幅で横スクロールなし

### 日別予定

- 終日を先頭、その後は開始時刻順
- 時刻、タイトル、メモ、色を表示
- カード選択で編集

### 編集ダイアログ

- 表示月内の日付だけ選択可能
- 終日、開始・終了、タイトル、メモ、色
- 終了だけの入力、終了が開始以前、空タイトルを拒否
- `Cmd/Ctrl + Enter` で保存
- IME変換中のEnterを保存操作にしない
- フォーム要素は16px以上

### 設定とバックアップ

- 保存者ラベル、ライト / ダークテーマ
- prefix配下の全キーをJSONエクスポート
- エクスポート結果のクリップボードコピー
- 正規月キーだけのマージインポート

## 11. バックアップ形式

```json
{
  "format": "claude-artifact-scheduler-backup",
  "schemaVersion": 1,
  "exportedAt": 1787558400000,
  "values": {
    "schedule:v1:2026-08": "{...JSON文字列...}",
    "schedule:v1:meta": "{...JSON文字列...}"
  }
}
```

exportはbrokenキーを含めてprefix配下を保全する。importは正規月キーだけを検証・マージし、metaやbrokenキーで現行設定・月データを上書きしない。複数月の書き込みはAPI上のtransactionではないため、途中失敗時は完了月数を表示する。

## 12. 受け入れ条件

- 380pxとPC幅で主要操作ができ、横スクロールがない
- 終日・時刻あり予定を追加、編集、削除できる
- 同じ日に複数予定を時刻順で表示できる
- 保存失敗時に入力を保持し再試行できる
- 不確実な取得状態で空月を保存しない
- 別端末の異なるIDを保存時マージで消さない
- 削除tombstoneが古い通常イベントに負けない
- 破損原文を退避成功後だけ復旧する
- export / importで既存イベントを消さない
- `bun run verify` が成功し、`dist/` に `index.html` だけが生成される
- 実Artifactで閉じ直し、複数端末同期、障害系を確認する
