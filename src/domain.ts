import {
  COLORS,
  TOMBSTONE_RETENTION_MS,
  type Backup,
  type EventColor,
  type Meta,
  type MonthData,
  type ScheduleEvent,
} from "./types";

export function emptyMonth(): MonthData {
  return { schemaVersion: 1, updatedAt: null, updatedBy: null, events: [] };
}

export function emptyMeta(): Meta {
  return { schemaVersion: 1, deviceName: "", lastBackupAt: null, theme: "light" };
}

export function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function localDateString(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function monthFromDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

export function dateFromMonth(month: string, day = 1): Date {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(year, monthNumber - 1, day);
}

export function dateKey(month: string, day: number): string {
  return `${month}-${pad(day)}`;
}

export function monthKey(month: string): string {
  return `schedule:v1:${month}`;
}

export function daysInMonth(month: string): number {
  const date = dateFromMonth(month);
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

export function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function randomId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  if (typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
  }
  return `event-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function cloneEvent(event: ScheduleEvent): ScheduleEvent {
  return { ...event };
}

export function chooseEvent(left: ScheduleEvent | undefined, right: ScheduleEvent | undefined): ScheduleEvent {
  if (!left && !right) throw new Error("比較する予定がありません。");
  if (!left) return cloneEvent(right as ScheduleEvent);
  if (!right) return cloneEvent(left);
  if (right.updatedAt > left.updatedAt) return cloneEvent(right);
  if (right.updatedAt < left.updatedAt) return cloneEvent(left);
  if (right.deleted !== left.deleted) return cloneEvent(right.deleted ? right : left);
  return cloneEvent(right);
}

export function mergeEvents(...collections: ScheduleEvent[][]): ScheduleEvent[] {
  const byId = new Map<string, ScheduleEvent>();
  for (const events of collections) {
    for (const event of events) byId.set(event.id, chooseEvent(byId.get(event.id), event));
  }
  return [...byId.values()];
}

export function cleanExpiredTombstones(events: ScheduleEvent[], now: number): ScheduleEvent[] {
  return events.filter((event) => !event.deleted || now - event.updatedAt <= TOMBSTONE_RETENTION_MS);
}

export function sortEvents(events: ScheduleEvent[]): ScheduleEvent[] {
  return [...events].sort((left, right) => {
    if (left.start === null && right.start !== null) return -1;
    if (left.start !== null && right.start === null) return 1;
    const timeOrder = (left.start ?? "").localeCompare(right.start ?? "");
    return timeOrder || left.title.localeCompare(right.title, "ja");
  });
}

function isValidTimestamp(value: unknown): value is number;
function isValidTimestamp(value: unknown, nullable: true): value is number | null;
function isValidTimestamp(value: unknown, nullable = false): value is number | null {
  return (nullable && value === null) || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function isTime(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value));
}

function isColor(value: unknown): value is EventColor {
  return typeof value === "string" && (COLORS as readonly string[]).includes(value);
}

export function validateEvent(value: unknown, expectedMonth: string): ScheduleEvent {
  if (!value || typeof value !== "object") throw new Error("予定の形式が不正です。");
  const event = value as Record<string, unknown>;
  if (typeof event.id !== "string" || event.id.length < 1 || event.id.length > 160) throw new Error("予定IDが不正です。");
  if (typeof event.date !== "string" || !new RegExp(`^${expectedMonth}-\\d{2}$`).test(event.date)) throw new Error("予定の日付と月キーが一致しません。");
  const parsedDate = new Date(`${event.date}T00:00:00`);
  if (Number.isNaN(parsedDate.getTime()) || localDateString(parsedDate) !== event.date) throw new Error("予定の日付が不正です。");
  if (!isTime(event.start) || !isTime(event.end)) throw new Error("予定時刻が不正です。");
  if (event.end !== null && event.start === null) throw new Error("終了時刻だけの予定は保存できません。");
  if (event.start !== null && event.end !== null && event.end <= event.start) throw new Error("予定の終了時刻が開始時刻以前です。");
  if (typeof event.title !== "string" || !event.title.trim() || event.title.length > 120) throw new Error("予定タイトルが不正です。");
  if (typeof event.memo !== "string" || event.memo.length > 2000) throw new Error("予定メモが不正です。");
  if (!isColor(event.color)) throw new Error("予定色が不正です。");
  if (!isValidTimestamp(event.createdAt) || !isValidTimestamp(event.updatedAt)) throw new Error("予定の更新時刻が不正です。");
  if (typeof event.deleted !== "boolean") throw new Error("予定の削除状態が不正です。");
  return {
    id: event.id,
    date: event.date,
    start: event.start,
    end: event.end,
    title: event.title,
    memo: event.memo,
    color: event.color,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    deleted: event.deleted,
  };
}

export function parseMonthData(raw: string, month: string): MonthData {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.events)) throw new Error("月データのスキーマが不正です。");
  if (!isValidTimestamp(parsed.updatedAt, true)) throw new Error("月データの更新時刻が不正です。");
  if (!(parsed.updatedBy === null || typeof parsed.updatedBy === "string")) throw new Error("月データの更新元が不正です。");
  return {
    schemaVersion: 1,
    updatedAt: parsed.updatedAt,
    updatedBy: parsed.updatedBy,
    events: parsed.events.map((event) => validateEvent(event, month)),
  };
}

export function parseMeta(raw: string): Meta {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (!parsed || parsed.schemaVersion !== 1) throw new Error("設定データの形式が不正です。");
  return {
    schemaVersion: 1,
    deviceName: typeof parsed.deviceName === "string" ? parsed.deviceName.slice(0, 40) : "",
    lastBackupAt: isValidTimestamp(parsed.lastBackupAt, true) ? parsed.lastBackupAt : null,
    theme: parsed.theme === "dark" ? "dark" : "light",
  };
}

export function parseBackup(text: string): Array<{ month: string; data: MonthData }> {
  const backup = JSON.parse(text) as Partial<Backup>;
  if (
    !backup ||
    backup.format !== "claude-artifact-scheduler-backup" ||
    backup.schemaVersion !== 1 ||
    !backup.values ||
    typeof backup.values !== "object"
  ) {
    throw new Error("対応していないバックアップ形式です。");
  }
  const months: Array<{ month: string; data: MonthData }> = [];
  for (const [key, raw] of Object.entries(backup.values)) {
    const match = key.match(/^schedule:v1:(\d{4}-\d{2})$/);
    if (!match) continue;
    if (typeof raw !== "string") throw new Error(`${key} の値が文字列ではありません。`);
    months.push({ month: match[1], data: parseMonthData(raw, match[1]) });
  }
  if (months.length === 0) throw new Error("取り込める月データがありません。");
  return months;
}
