export const STORAGE_PREFIX = "schedule:v1:";
export const META_KEY = `${STORAGE_PREFIX}meta`;
export const SAVE_DEBOUNCE_MS = 800;
export const TAB_REFRESH_MIN_MS = 15_000;
export const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
export const MAX_MONTH_BYTES = 4.5 * 1024 * 1024;

export const COLORS = ["blue", "green", "orange", "pink", "purple", "gray"] as const;
export type EventColor = (typeof COLORS)[number];

export type ScheduleEvent = {
  id: string;
  date: string;
  start: string | null;
  end: string | null;
  title: string;
  memo: string;
  color: EventColor;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
};

export type MonthData = {
  schemaVersion: 1;
  updatedAt: number | null;
  updatedBy: string | null;
  events: ScheduleEvent[];
};

export type Meta = {
  schemaVersion: 1;
  deviceName: string;
  lastBackupAt: number | null;
  theme: "light" | "dark";
};

export type LoadCertainty = "loading" | "known" | "uncertain";
export type SaveStatus = "loading" | "idle" | "waiting" | "saving" | "saved" | "error";

export type PendingOperation = {
  id: number;
  month: string;
  event: ScheduleEvent;
};

export type Backup = {
  format: "claude-artifact-scheduler-backup";
  schemaVersion: 1;
  exportedAt: number;
  values: Record<string, string>;
};

export type WindowStorageResult = { key?: string; value?: string; shared?: boolean } | string;
export type WindowStorageKeys = { keys?: Array<string | { key?: string }>; shared?: boolean } | Array<string | { key?: string }>;

declare global {
  interface Window {
    storage?: {
      get(key: string): Promise<WindowStorageResult>;
      set(key: string, value: string): Promise<unknown>;
      delete(key: string): Promise<unknown>;
      list(prefix: string): Promise<WindowStorageKeys>;
    };
  }
}
