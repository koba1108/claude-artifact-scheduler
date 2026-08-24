# スケジュール管理Artifact 設計

## 1. ゴール

同じClaudeアカウントで開いた複数端末から、共通の個人スケジュールを読み書きできるHTML Artifactを提供する。

- 実行物は `index.html` の単一ファイル
- フロントエンドのみ
- 永続化はAnthropic側の `window.storage`
- ローカル端末には予定データを残さない
- 同期は保存時と明示的な再取得時に行う

## 2. 実行環境の制約

- HTML、CSS、JavaScriptを1ファイルへ内包する
- ビルドなし
- 外部ライブラリなし
- `localStorage` / `sessionStorage` / IndexedDB / Cookieは不使用
- サーバーサイド処理なし
- 定期ポーリングなし
- `window.storage` の第2引数 `shared` は常に省略する

## 3. window.storage アダプター

本番では次の4メソッドをそのままラップする。

```js
await window.storage.get(key)
await window.storage.set(key, value)
await window.storage.delete(key)
await window.storage.list(prefix)
```

通常ブラウザでの表示確認用に、`window.storage` が存在しないときだけページ内の `Map` を使う。これは永続化せず、ページ再読み込みで消える。

### エラーの前提

`get` の例外から「キー未作成」と「通信失敗」を確実に区別できないため、読み込み時は空データと警告表示へフォールバックする。保存時は再度getしてから書くが、API自体にcompare-and-swapがないため完全な排他制御はできない。

## 4. キー設計

```text
schedule:v1:2026-08
schedule:v1:2026-09
schedule:v1:meta
schedule:v1:2026-08:broken:1756000000000
```

月単位へ分割する理由:

1. 異なる月を別端末で編集したときに衝突しない
2. 読み書きするJSONを小さく保てる
3. バックアップと復旧を月ごとに実行できる

`v1` はスキーマversionであり、破壊的変更時は既存キーを上書きせず `v2` 移行処理を設計する。

## 5. 月データ

```ts
type MonthData = {
  schemaVersion: 1;
  updatedAt: number | null;
  updatedBy: string | null;
  events: ScheduleEvent[];
};

type ScheduleEvent = {
  id: string;
  date: string;          // YYYY-MM-DD。キーの月と一致
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

### meta

```ts
type Meta = {
  schemaVersion: 1;
  deviceName: string | null;
  lastBackupAt: number | null;
};
```

端末ローカルの永続領域を禁止しているため、`deviceName` は厳密には端末固有ではない。同じアカウント全体で共有される「現在の保存者ラベル」として扱う。

## 6. 状態管理

外部状態管理ライブラリは使わず、ページ内の単一 `state` オブジェクトで管理する。

主な状態:

- `currentMonth`
- `selectedDate`
- `monthData`
- `meta`
- `pendingOperations`
- `lastFetchedAt`
- `status`
- `saveTimer` / `savePromise`

予定の追加・更新・削除はまずメモリへ反映し、イベントのスナップショットをpending operationとして積む。800ms後に保存する。

## 7. 保存アルゴリズム

```text
1. 保存対象月をwindow.storage.get
2. JSONを検証し、失敗した場合はbrokenキーへ退避
3. remote eventsと画面上のlocal eventsをイベントIDでマージ
4. pending operationを適用
5. deleted=trueかつ30日経過したtombstoneを除去
6. updatedAt / updatedByを更新
7. 月データ全体を1回のwindow.storage.setで保存
8. 成功したoperationだけpendingから除去
```

イベントマージ規則:

- 同じIDは `updatedAt` が大きい方
- 片方にしかないIDは残す
- 同値の場合は後から適用した値
- 削除も通常イベントと同じく `updatedAt` で競合解決

同一イベントを複数端末で同時編集した場合はフィールド単位ではなくイベント単位の後勝ちとする。

## 8. 読み込みと月移動

- 初期表示は当月キーをget
- 月移動前にpendingをflush
- 保存失敗中は月移動せず、入力を現在画面へ保持
- 再読み込みボタンではpendingをflushしてからget
- タブが非表示になるとflush
- タブ復帰時は、pendingがなく前回の復帰取得から15秒以上経過していればgetを1回だけ行う

## 9. 削除

画面上の削除操作では配列から除外せず、次のように更新する。

```js
{
  ...event,
  deleted: true,
  updatedAt: Date.now()
}
```

これにより、別端末の古い配列とのマージで削除済み予定が復活するのを防ぐ。30日経過後、次回保存時に物理削除する。

## 10. 画面

### 月カレンダー

- 日曜始まり7列
- 日曜・土曜を色分け
- 今日と選択日を区別
- 予定がある日に最大3個の色付きドット
- 前月、翌月、今日、再読み込み

### 日ビュー

- 選択日の予定件数
- 終日、開始時刻の順でソート
- 時刻、タイトル、メモ、色を表示
- タップで編集

### 編集モーダル

- 日付は表示中の月だけ選択可能
- 終日、開始・終了、タイトル、メモ、色
- 同一キー内に保つため月をまたぐ日付変更は不可
- `Cmd/Ctrl + Enter` で保存
- IME変換中のEnterは無視

### 設定・バックアップ

- 保存者ラベル
- prefix配下の全キーをJSONエクスポート
- 月データをイベントID・更新時刻でマージインポート

## 11. 同期ステータス

常に次を表示する。

- 操作状態: 読み込み中、保存待ち、保存中、保存完了、保存失敗
- 月キーの `updatedAt` と `updatedBy`
- このページが最後にgetした時刻
- 保存失敗時の再試行ボタン
- 未保存のまま閉じると失われる警告

## 12. 破損データ

月キーのJSONがparseまたはschema検証に失敗した場合:

1. 元の文字列を `schedule:v1:YYYY-MM:broken:<epoch-ms>` へ保存
2. 元キーを空のv1月データで初期化
3. 退避キーを画面へ表示
4. 退避自体が失敗した場合は強い警告を表示

## 13. バックアップ形式

```json
{
  "format": "claude-artifact-scheduler-backup",
  "schemaVersion": 1,
  "exportedAt": 1756000000000,
  "values": {
    "schedule:v1:2026-08": "{...JSON文字列...}",
    "schedule:v1:meta": "{...JSON文字列...}"
  }
}
```

exportは壊れた退避キーも含め、prefix配下をそのまま保全する。importは正規の月キーだけをマージ対象とし、brokenキーを現行データへ戻さない。

## 14. 受け入れ条件

- 380px幅で横スクロールしない
- iOSで入力時の自動ズームを起こさない
- 終日・時刻あり予定を登録、編集、削除できる
- 再読み込み後も実 `window.storage` 上のデータが復元される
- 別端末で追加した異なるIDの予定が保存時マージで消えない
- 削除tombstoneが別端末とのマージで復活しない
- 保存失敗時に再試行でき、画面を閉じるまで入力を保持する
- exportしたJSONをimportして月データを復元できる
- `node scripts/validate.mjs` が成功する
