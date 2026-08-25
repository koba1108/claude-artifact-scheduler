import { describe, expect, test } from "bun:test";
import { inspectStoredKeyWith, readMonthWith, type StorageAdapter } from "./storage";

function fakeAdapter(overrides: Partial<StorageAdapter> = {}): StorageAdapter {
  return {
    get: async () => {
      throw new Error("KEY_NOT_FOUND");
    },
    set: async () => ({ ok: true }),
    delete: async () => ({ ok: true }),
    list: async () => [],
    ...overrides,
  };
}

describe("inspectStoredKeyWith", () => {
  test("get失敗後に完全一致キーがなければ未作成と判断する", async () => {
    await expect(inspectStoredKeyWith(fakeAdapter(), "schedule:v1:2026-08")).resolves.toEqual({
      kind: "absent",
      raw: null,
    });
  });

  test("get失敗後も完全一致キーがあれば不確実として保存を止める", async () => {
    const key = "schedule:v1:2026-08";
    const result = await inspectStoredKeyWith(fakeAdapter({ list: async () => [key] }), key);
    expect(result.kind).toBe("uncertain");
  });

  test("listも失敗した場合は不確実として保存を止める", async () => {
    const result = await inspectStoredKeyWith(fakeAdapter({ list: async () => { throw new Error("offline"); } }), "schedule:v1:2026-08");
    expect(result.kind).toBe("uncertain");
  });
});

describe("readMonthWith", () => {
  test("破損原文を退避できた場合だけ正規キーを初期化する", async () => {
    const writes: Array<[string, string]> = [];
    const result = await readMonthWith(fakeAdapter({
      get: async () => "{broken-json",
      set: async (key, value) => {
        writes.push([key, value]);
        return { ok: true };
      },
    }), "2026-08", { now: () => 1234 });

    expect(result.certainty).toBe("known");
    expect(writes.map(([key]) => key)).toEqual([
      "schedule:v1:2026-08:broken:1234",
      "schedule:v1:2026-08",
    ]);
    expect(writes[0][1]).toBe("{broken-json");
  });

  test("破損原文の退避失敗時は正規キーを初期化しない", async () => {
    const writes: string[] = [];
    const result = await readMonthWith(fakeAdapter({
      get: async () => "{broken-json",
      set: async (key) => {
        writes.push(key);
        throw new Error("write failed");
      },
    }), "2026-08", { now: () => 1234 });

    expect(result.certainty).toBe("uncertain");
    expect(writes).toEqual(["schedule:v1:2026-08:broken:1234"]);
  });
});
