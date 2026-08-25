import { describe, expect, test } from "bun:test";
import { buildSchedulerUrl, parseSchedulerView } from "./navigation";

describe("parseSchedulerView", () => {
  test("月・日付・編集中の予定をURLから復元する", () => {
    expect(parseSchedulerView("?month=2026-09&date=2026-09-12&panel=event&event=event-1", "2026-08-25")).toEqual({
      month: "2026-09",
      date: "2026-09-12",
      panel: "event",
      eventId: "event-1",
    });
  });

  test("不正な値は安全な既定値へ戻す", () => {
    expect(parseSchedulerView("?month=2026-13&date=2026-02-31&panel=unknown", "2026-08-25")).toEqual({
      month: "2026-08",
      date: "2026-08-25",
      panel: null,
      eventId: null,
    });
  });

  test("別月で日付が省略された場合は月初を選ぶ", () => {
    expect(parseSchedulerView("?month=2026-09", "2026-08-25").date).toBe("2026-09-01");
  });

  test("存在しない日付は表示月の月初へ戻す", () => {
    expect(parseSchedulerView("?month=2026-02&date=2026-02-31", "2026-08-25").date).toBe("2026-02-01");
  });
});

test("buildSchedulerUrlは無関係なqueryとhashを維持する", () => {
  expect(buildSchedulerUrl("https://example.test/artifact?source=share#calendar", {
    month: "2026-09",
    date: "2026-09-12",
    panel: "settings",
    eventId: null,
  })).toBe("/artifact?source=share&month=2026-09&date=2026-09-12&panel=settings#calendar");
});
