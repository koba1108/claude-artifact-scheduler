import { emptyMeta, emptyMonth, parseMeta, parseMonthData, monthKey } from "./domain";
import { META_KEY, type Meta, type MonthData, type WindowStorageKeys, type WindowStorageResult } from "./types";

const hasWindowStorage =
  typeof window !== "undefined" &&
  window.storage &&
  typeof window.storage.get === "function" &&
  typeof window.storage.set === "function" &&
  typeof window.storage.delete === "function" &&
  typeof window.storage.list === "function";

export const PREVIEW_MODE = !hasWindowStorage;
const previewMemory = new Map<string, string>();

function normalizeStorageValue(result: WindowStorageResult): string {
  if (typeof result === "string") return result;
  if (result && typeof result.value === "string") return result.value;
  throw new Error("ストレージから文字列を取得できませんでした。");
}

function normalizeStorageKeys(result: WindowStorageKeys): string[] {
  const source = Array.isArray(result) ? result : result && Array.isArray(result.keys) ? result.keys : null;
  if (!source) throw new Error("ストレージのキー一覧を取得できませんでした。");
  return source
    .map((entry) => (typeof entry === "string" ? entry : entry && entry.key))
    .filter((key): key is string => typeof key === "string");
}

export type StorageAdapter = {
  get(key: string): Promise<string>;
  set(key: string, value: string): Promise<unknown>;
  delete(key: string): Promise<unknown>;
  list(prefix: string): Promise<string[]>;
};

export const storageAdapter: StorageAdapter = {
  async get(key: string): Promise<string> {
    if (PREVIEW_MODE) {
      const value = previewMemory.get(key);
      if (value === undefined) throw new Error("KEY_NOT_FOUND");
      return value;
    }
    return normalizeStorageValue(await window.storage!.get(key));
  },

  async set(key: string, value: string): Promise<unknown> {
    if (PREVIEW_MODE) {
      previewMemory.set(key, value);
      return { key, value };
    }
    const result = await window.storage!.set(key, value);
    if (result === null || result === undefined) throw new Error("ストレージが保存成功を返しませんでした。");
    return result;
  },

  async delete(key: string): Promise<unknown> {
    if (PREVIEW_MODE) {
      previewMemory.delete(key);
      return { key, deleted: true };
    }
    const result = await window.storage!.delete(key);
    if (result === null || result === undefined) throw new Error("ストレージが削除成功を返しませんでした。");
    return result;
  },

  async list(prefix: string): Promise<string[]> {
    if (PREVIEW_MODE) return [...previewMemory.keys()].filter((key) => key.startsWith(prefix));
    return normalizeStorageKeys(await window.storage!.list(prefix));
  },
};

export type Inspection =
  | { kind: "found"; raw: string }
  | { kind: "absent"; raw: null }
  | { kind: "uncertain"; raw: null; error: unknown };

export async function inspectStoredKeyWith(adapter: StorageAdapter, key: string): Promise<Inspection> {
  try {
    return { kind: "found", raw: await adapter.get(key) };
  } catch (getError) {
    try {
      const keys = await adapter.list(key);
      if (!keys.includes(key)) return { kind: "absent", raw: null };
      return { kind: "uncertain", raw: null, error: getError };
    } catch (listError) {
      return { kind: "uncertain", raw: null, error: listError };
    }
  }
}

export async function inspectStoredKey(key: string): Promise<Inspection> {
  return inspectStoredKeyWith(storageAdapter, key);
}

export type MonthReadResult = {
  certainty: "known" | "uncertain";
  data: MonthData;
  notice: string | null;
};

type ReadMonthOptions = {
  repairCorruption?: boolean;
  now?: () => number;
};

export async function readMonthWith(
  adapter: StorageAdapter,
  month: string,
  options: ReadMonthOptions = {},
): Promise<MonthReadResult> {
  const { repairCorruption = true, now = Date.now } = options;
  const key = monthKey(month);
  const inspected = await inspectStoredKeyWith(adapter, key);
  if (inspected.kind === "absent") return { certainty: "known", data: emptyMonth(), notice: null };
  if (inspected.kind === "uncertain") {
    return {
      certainty: "uncertain",
      data: emptyMonth(),
      notice: "既存データの有無を確認できません。接続が戻るまで、この月は保存しません。",
    };
  }
  try {
    return { certainty: "known", data: parseMonthData(inspected.raw, month), notice: null };
  } catch (parseError) {
    if (!repairCorruption) throw parseError;
    const brokenKey = `${key}:broken:${now()}`;
    try {
      await adapter.set(brokenKey, inspected.raw);
    } catch {
      return {
        certainty: "uncertain",
        data: emptyMonth(),
        notice: "データ破損を検出しましたが退避できませんでした。元データを守るため初期化と保存を停止しています。",
      };
    }
    const repaired = emptyMonth();
    try {
      await adapter.set(key, JSON.stringify(repaired));
    } catch {
      return {
        certainty: "uncertain",
        data: repaired,
        notice: `破損データは ${brokenKey} へ退避しましたが、月データを初期化できませんでした。`,
      };
    }
    return {
      certainty: "known",
      data: repaired,
      notice: `破損データを ${brokenKey} へ退避し、この月を空の状態へ復旧しました。`,
    };
  }
}

export async function readMonth(month: string, options: ReadMonthOptions = {}): Promise<MonthReadResult> {
  return readMonthWith(storageAdapter, month, options);
}

export async function readMeta(): Promise<{ certainty: "known" | "uncertain"; data: Meta }> {
  const inspected = await inspectStoredKey(META_KEY);
  if (inspected.kind !== "found") {
    return { certainty: inspected.kind === "absent" ? "known" : "uncertain", data: emptyMeta() };
  }
  try {
    return { certainty: "known", data: parseMeta(inspected.raw) };
  } catch {
    return { certainty: "uncertain", data: emptyMeta() };
  }
}

export async function saveMetaPatch(current: Meta, patch: Partial<Meta>): Promise<Meta> {
  const inspected = await inspectStoredKey(META_KEY);
  if (inspected.kind === "uncertain") throw new Error("設定の既存状態を確認できませんでした。");
  const base = inspected.kind === "found" ? parseMeta(inspected.raw) : current;
  const next: Meta = {
    ...base,
    ...patch,
    schemaVersion: 1,
    deviceName: (patch.deviceName ?? base.deviceName).trim().slice(0, 40),
  };
  await storageAdapter.set(META_KEY, JSON.stringify(next));
  return next;
}
