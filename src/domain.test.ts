import { describe, expect, test } from "bun:test";
import {
  cleanExpiredTombstones,
  localDateString,
  mergeEvents,
  parseBackup,
  parseMonthData,
} from "./domain";
import { TOMBSTONE_RETENTION_MS, type ScheduleEvent } from "./types";

function event(overrides: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return {
    id: "event-1",
    date: "2026-08-25",
    start: null,
    end: null,
    title: "予定",
    memo: "",
    color: "blue",
    createdAt: 100,
    updatedAt: 100,
    deleted: false,
    ...overrides,
  };
}

describe("mergeEvents", () => {
  test("新しいupdatedAtを採用する", () => {
    expect(mergeEvents([event({ title: "古い" })], [event({ title: "新しい", updatedAt: 200 })])[0].title).toBe("新しい");
  });

  test("同時刻では入力順に関係なく削除を優先する", () => {
    const active = event();
    const deleted = event({ deleted: true });
    expect(mergeEvents([active], [deleted])[0].deleted).toBe(true);
    expect(mergeEvents([deleted], [active])[0].deleted).toBe(true);
  });

  test("異なるIDは両方残す", () => {
    expect(mergeEvents([event()], [event({ id: "event-2" })])).toHaveLength(2);
  });
});

test("30日を超えたtombstoneだけ掃除する", () => {
  const now = TOMBSTONE_RETENTION_MS + 1_000;
  const values = cleanExpiredTombstones([
    event({ id: "expired", deleted: true, updatedAt: 0 }),
    event({ id: "retained", deleted: true, updatedAt: now - TOMBSTONE_RETENTION_MS }),
    event({ id: "active", updatedAt: 0 }),
  ], now);
  expect(values.map((value) => value.id).sort()).toEqual(["active", "retained"]);
});

test("日付文字列をUTC変換せずローカル成分から作る", () => {
  expect(localDateString(new Date(2026, 7, 5, 23, 30))).toBe("2026-08-05");
});

describe("保存済みデータ検証", () => {
  test("更新時刻がないイベントを拒否する", () => {
    const invalid = event() as Partial<ScheduleEvent>;
    delete invalid.updatedAt;
    expect(() => parseMonthData(JSON.stringify({ schemaVersion: 1, updatedAt: 100, updatedBy: "PC", events: [invalid] }), "2026-08")).toThrow("更新時刻");
  });

  test("終了時刻だけのイベントを拒否する", () => {
    expect(() => parseMonthData(JSON.stringify({ schemaVersion: 1, updatedAt: 100, updatedBy: "PC", events: [event({ end: "11:00" })] }), "2026-08")).toThrow("終了時刻だけ");
  });

  test("対象月以外のイベントを拒否する", () => {
    expect(() => parseMonthData(JSON.stringify({ schemaVersion: 1, updatedAt: 100, updatedBy: "PC", events: [event({ date: "2026-09-01" })] }), "2026-08")).toThrow("月キー");
  });
});

test("バックアップは正規月キーだけを取り込む", () => {
  const month = JSON.stringify({ schemaVersion: 1, updatedAt: 100, updatedBy: "PC", events: [event()] });
  const parsed = parseBackup(JSON.stringify({
    format: "claude-artifact-scheduler-backup",
    schemaVersion: 1,
    exportedAt: 100,
    values: {
      "schedule:v1:2026-08": month,
      "schedule:v1:meta": "{}",
      "schedule:v1:2026-08:broken:100": "broken",
    },
  }));
  expect(parsed).toHaveLength(1);
  expect(parsed[0].month).toBe("2026-08");
});
