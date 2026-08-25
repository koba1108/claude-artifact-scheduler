import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  byteLength,
  cleanExpiredTombstones,
  dateFromMonth,
  dateKey,
  daysInMonth,
  emptyMeta,
  emptyMonth,
  localDateString,
  mergeEvents,
  monthFromDate,
  monthKey,
  parseBackup,
  randomId,
  sortEvents,
} from "./domain";
import { PREVIEW_MODE, inspectStoredKey, readMeta, readMonth, saveMetaPatch, storageAdapter } from "./storage";
import {
  COLORS,
  MAX_MONTH_BYTES,
  SAVE_DEBOUNCE_MS,
  STORAGE_PREFIX,
  TAB_REFRESH_MIN_MS,
  type Backup,
  type EventColor,
  type LoadCertainty,
  type Meta,
  type MonthData,
  type PendingOperation,
  type SaveStatus,
  type ScheduleEvent,
} from "./types";

const COLOR_DOT: Record<EventColor, string> = {
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  orange: "bg-orange-500",
  pink: "bg-pink-500",
  purple: "bg-violet-500",
  gray: "bg-slate-500",
};

const COLOR_RING: Record<EventColor, string> = {
  blue: "border-blue-500 bg-blue-50 dark:bg-blue-950/40",
  green: "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40",
  orange: "border-orange-500 bg-orange-50 dark:bg-orange-950/40",
  pink: "border-pink-500 bg-pink-50 dark:bg-pink-950/40",
  purple: "border-violet-500 bg-violet-50 dark:bg-violet-950/40",
  gray: "border-slate-500 bg-slate-50 dark:bg-slate-800/60",
};

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const STATUS_LABELS: Record<SaveStatus, string> = {
  loading: "読み込み中",
  idle: "最新の状態",
  waiting: "保存待ち",
  saving: "保存中",
  saved: "保存完了",
  error: "保存失敗",
};

type EventDraft = {
  date: string;
  allDay: boolean;
  start: string;
  end: string;
  title: string;
  memo: string;
  color: EventColor;
};

const dateFormatter = new Intl.DateTimeFormat("ja-JP", { month: "long", day: "numeric", weekday: "short" });
const timeFormatter = new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

function formatStoredTime(value: number | null): string {
  return value ? timeFormatter.format(new Date(value)) : "—";
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function App() {
  const today = useMemo(() => new Date(), []);
  const initialMonth = monthFromDate(today);
  const initialDate = localDateString(today);

  const [currentMonth, setCurrentMonth] = useState(initialMonth);
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [monthData, setMonthData] = useState<MonthData>(emptyMonth);
  const [meta, setMeta] = useState<Meta>(emptyMeta);
  const [certainty, setCertainty] = useState<LoadCertainty>("loading");
  const [status, setStatus] = useState<SaveStatus>("loading");
  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [eventDraft, setEventDraft] = useState<EventDraft>({
    date: initialDate,
    allDay: true,
    start: "",
    end: "",
    title: "",
    memo: "",
    color: "blue",
  });
  const [eventError, setEventError] = useState("");

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDeviceName, setSettingsDeviceName] = useState("");
  const [settingsTheme, setSettingsTheme] = useState<Meta["theme"]>("light");
  const [settingsError, setSettingsError] = useState("");
  const [exportOutput, setExportOutput] = useState("");
  const [importInput, setImportInput] = useState("");

  const monthRef = useRef(currentMonth);
  const monthDataRef = useRef(monthData);
  const metaRef = useRef(meta);
  const certaintyRef = useRef(certainty);
  const pendingRef = useRef<PendingOperation[]>([]);
  const nextOperationIdRef = useRef(1);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savePromiseRef = useRef<Promise<boolean> | null>(null);
  const lastVisibilityFetchRef = useRef(0);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushRef = useRef<(reason?: string) => Promise<boolean>>(async () => true);
  const loadMonthRef = useRef<(month: string, announce?: boolean) => Promise<void>>(async () => undefined);
  const composingRef = useRef(false);

  const showToast = useCallback((message: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = setTimeout(() => setToast(null), 3_200);
  }, []);

  const updateMeta = useCallback((next: Meta) => {
    metaRef.current = next;
    setMeta(next);
  }, []);

  const updateMonthData = useCallback((next: MonthData) => {
    monthDataRef.current = next;
    setMonthData(next);
  }, []);

  const updateCertainty = useCallback((next: LoadCertainty) => {
    certaintyRef.current = next;
    setCertainty(next);
  }, []);

  const updatePending = useCallback((next: PendingOperation[]) => {
    pendingRef.current = next;
    setPendingCount(next.length);
  }, []);

  const setSyncStatus = useCallback((next: SaveStatus, detail: string | null = null) => {
    setStatus(next);
    setStatusDetail(detail);
  }, []);

  const loadMonth = useCallback(
    async (month: string, announce = false) => {
      setSyncStatus("loading");
      setWarning(null);
      const result = await readMonth(month);
      if (month !== monthRef.current) return;
      updateMonthData(result.data);
      updateCertainty(result.certainty);
      const fetchedAt = Date.now();
      setLastFetchedAt(fetchedAt);
      lastVisibilityFetchRef.current = fetchedAt;
      if (result.certainty === "uncertain") setSyncStatus("error", "取得状態が不明です");
      else setSyncStatus("idle");
      setWarning(result.notice);
      if (announce) showToast(result.certainty === "known" ? "最新の予定を取得しました。" : "予定を安全に取得できませんでした。");
    },
    [setSyncStatus, showToast, updateCertainty, updateMonthData],
  );
  loadMonthRef.current = loadMonth;

  const writeMonth = useCallback(async (month: string, operations: PendingOperation[]): Promise<MonthData> => {
    const latest = await readMonth(month);
    if (latest.certainty !== "known") throw new Error("既存データを確認できないため保存を停止しました。");
    const now = Date.now();
    const nextData: MonthData = {
      schemaVersion: 1,
      updatedAt: now,
      updatedBy: metaRef.current.deviceName.trim() || "名前未設定",
      events: cleanExpiredTombstones(mergeEvents(latest.data.events, operations.map((operation) => operation.event)), now),
    };
    const raw = JSON.stringify(nextData);
    if (byteLength(raw) >= MAX_MONTH_BYTES) {
      throw new Error("この月のデータが保存上限に近づいています。バックアップ後に予定を整理してください。");
    }
    await storageAdapter.set(monthKey(month), raw);
    return nextData;
  }, []);

  async function flushPending(reason = "manual"): Promise<boolean> {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;

    if (savePromiseRef.current) {
      const previousResult = await savePromiseRef.current;
      if (!previousResult && reason !== "debounce") return false;
      if (reason !== "debounce" && pendingRef.current.length > 0) return flushPending(reason);
      return previousResult;
    }

    const month = monthRef.current;
    const snapshot = pendingRef.current.filter((operation) => operation.month === month);
    if (snapshot.length === 0) return true;
    if (certaintyRef.current !== "known") {
      setSyncStatus("error", "取得状態が不明なため保存していません");
      setWarning("接続を確認して再読み込みしてください。既存の月データを空で上書きしないため、入力は画面内に保持しています。");
      return false;
    }

    const savedIds = new Set(snapshot.map((operation) => operation.id));
    setSyncStatus("saving");
    const promise = (async () => {
      try {
        const savedData = await writeMonth(month, snapshot);
        const remaining = pendingRef.current.filter((operation) => !savedIds.has(operation.id));
        updatePending(remaining);
        if (monthRef.current === month) {
          const unsavedEvents = remaining.filter((operation) => operation.month === month).map((operation) => operation.event);
          updateMonthData({
            ...savedData,
            events: cleanExpiredTombstones(mergeEvents(savedData.events, unsavedEvents), Date.now()),
          });
          updateCertainty("known");
        }
        setWarning(null);
        setSyncStatus("saved");
        if (remaining.some((operation) => operation.month === month)) {
          setSyncStatus("waiting");
          saveTimerRef.current = setTimeout(() => void flushRef.current("debounce"), SAVE_DEBOUNCE_MS);
        }
        return true;
      } catch (error) {
        setSyncStatus("error");
        setWarning(`${errorMessage(error, "予定を保存できませんでした。")} 入力はこの画面に保持しています。`);
        return false;
      }
    })();
    savePromiseRef.current = promise;
    const result = await promise;
    if (savePromiseRef.current === promise) savePromiseRef.current = null;
    return result;
  }
  flushRef.current = flushPending;

  const enqueueOperation = useCallback(
    (event: ScheduleEvent) => {
      updateMonthData({ ...monthDataRef.current, events: mergeEvents(monthDataRef.current.events, [event]) });
      updatePending([
        ...pendingRef.current,
        { id: nextOperationIdRef.current++, month: monthRef.current, event: { ...event } },
      ]);
      setSyncStatus("waiting");
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => void flushRef.current("debounce"), SAVE_DEBOUNCE_MS);
    },
    [setSyncStatus, updateMonthData, updatePending],
  );

  const navigateToMonth = useCallback(
    async (nextMonth: string, selectedDay = 1) => {
      if (!(await flushRef.current("navigation"))) {
        showToast("未保存の予定があるため、月移動を停止しました。");
        return;
      }
      monthRef.current = nextMonth;
      setCurrentMonth(nextMonth);
      setSelectedDate(dateKey(nextMonth, Math.min(Math.max(selectedDay, 1), daysInMonth(nextMonth))));
      updateMonthData(emptyMonth());
      updateCertainty("loading");
      await loadMonthRef.current(nextMonth);
    },
    [showToast, updateCertainty, updateMonthData],
  );

  const shiftMonth = useCallback(
    (delta: number) => {
      const date = dateFromMonth(monthRef.current);
      const selectedDay = Number(selectedDate.slice(-2));
      date.setMonth(date.getMonth() + delta);
      void navigateToMonth(monthFromDate(date), selectedDay);
    },
    [navigateToMonth, selectedDate],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      const metaResult = await readMeta();
      if (!active) return;
      updateMeta(metaResult.data);
      if (metaResult.certainty === "uncertain") setWarning("設定データを安全に取得できませんでした。予定データの読み込みは続行します。");
      await loadMonthRef.current(monthRef.current);
    })();
    return () => {
      active = false;
    };
  }, [updateMeta]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", meta.theme === "dark");
  }, [meta.theme]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (pendingRef.current.length > 0) void flushRef.current("hidden");
        return;
      }
      const now = Date.now();
      if (pendingRef.current.length === 0 && !savePromiseRef.current && now - lastVisibilityFetchRef.current >= TAB_REFRESH_MIN_MS) {
        void loadMonthRef.current(monthRef.current);
      }
    };
    const onPageHide = () => {
      if (pendingRef.current.length > 0) void flushRef.current("pagehide");
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (pendingRef.current.length > 0 || savePromiseRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const visibleEvents = useMemo(
    () => sortEvents(monthData.events.filter((event) => !event.deleted && event.date === selectedDate)),
    [monthData.events, selectedDate],
  );

  const calendarCells = useMemo(() => {
    const date = dateFromMonth(currentMonth);
    const firstWeekday = new Date(date.getFullYear(), date.getMonth(), 1).getDay();
    const count = Math.ceil((firstWeekday + daysInMonth(currentMonth)) / 7) * 7;
    return Array.from({ length: count }, (_, index) => {
      const day = index - firstWeekday + 1;
      if (day < 1 || day > daysInMonth(currentMonth)) return null;
      const key = dateKey(currentMonth, day);
      return { day, key, events: monthData.events.filter((event) => !event.deleted && event.date === key) };
    });
  }, [currentMonth, monthData.events]);

  const openEventDialog = (event?: ScheduleEvent) => {
    setEditingEventId(event?.id ?? null);
    setEventDraft({
      date: event?.date ?? selectedDate,
      allDay: event ? event.start === null : true,
      start: event?.start ?? "",
      end: event?.end ?? "",
      title: event?.title ?? "",
      memo: event?.memo ?? "",
      color: event?.color ?? "blue",
    });
    setEventError("");
    setEventDialogOpen(true);
  };

  const closeEventDialog = () => {
    setEventDialogOpen(false);
    setEditingEventId(null);
    setEventError("");
  };

  const saveEventDraft = () => {
    const title = eventDraft.title.trim();
    const start = eventDraft.allDay ? null : eventDraft.start || null;
    const end = eventDraft.allDay ? null : eventDraft.end || null;
    if (!eventDraft.date.startsWith(`${currentMonth}-`)) return setEventError("表示中の月の日付を選んでください。");
    if (!title) return setEventError("タイトルを入力してください。");
    if (end && !start) return setEventError("終了時刻を入れる場合は開始時刻も入力してください。");
    if (start && end && end <= start) return setEventError("終了時刻は開始時刻より後にしてください。");
    const now = Date.now();
    const existing = editingEventId ? monthDataRef.current.events.find((event) => event.id === editingEventId) : undefined;
    const event: ScheduleEvent = {
      id: existing?.id ?? randomId(),
      date: eventDraft.date,
      start,
      end,
      title,
      memo: eventDraft.memo.trim(),
      color: eventDraft.color,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      deleted: false,
    };
    setSelectedDate(event.date);
    enqueueOperation(event);
    closeEventDialog();
    showToast(existing ? "予定を更新しました。" : "予定を追加しました。");
  };

  const deleteEditingEvent = () => {
    const existing = monthDataRef.current.events.find((event) => event.id === editingEventId);
    if (!existing || !window.confirm(`「${existing.title}」を削除しますか？`)) return;
    enqueueOperation({ ...existing, deleted: true, updatedAt: Date.now() });
    closeEventDialog();
    showToast("予定を削除しました。");
  };

  const handleEventKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const composing = event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || composingRef.current;
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !composing) {
      event.preventDefault();
      saveEventDraft();
    }
  };

  const openSettings = () => {
    setSettingsDeviceName(metaRef.current.deviceName);
    setSettingsTheme(metaRef.current.theme);
    setSettingsError("");
    setSettingsOpen(true);
  };

  const saveSettings = async () => {
    setSettingsError("");
    try {
      const next = await saveMetaPatch(metaRef.current, { deviceName: settingsDeviceName, theme: settingsTheme });
      updateMeta(next);
      showToast("設定を保存しました。");
    } catch (error) {
      setSettingsError(errorMessage(error, "設定を保存できませんでした。"));
    }
  };

  const exportBackup = async () => {
    setSettingsError("");
    try {
      const backupAt = Date.now();
      const nextMeta = await saveMetaPatch(metaRef.current, { lastBackupAt: backupAt });
      updateMeta(nextMeta);
      const keys = await storageAdapter.list(STORAGE_PREFIX);
      const values: Record<string, string> = {};
      for (const key of [...keys].sort()) {
        const inspected = await inspectStoredKey(key);
        if (inspected.kind === "found") values[key] = inspected.raw;
        else if (inspected.kind === "uncertain") throw new Error(`${key} を安全に取得できませんでした。`);
      }
      const backup: Backup = {
        format: "claude-artifact-scheduler-backup",
        schemaVersion: 1,
        exportedAt: backupAt,
        values,
      };
      setExportOutput(JSON.stringify(backup, null, 2));
      showToast(`${Object.keys(values).length}キーのバックアップを作成しました。`);
    } catch (error) {
      setSettingsError(errorMessage(error, "バックアップを作成できませんでした。"));
    }
  };

  const copyBackup = async () => {
    if (!exportOutput) return setSettingsError("先にバックアップを作成してください。");
    try {
      await navigator.clipboard.writeText(exportOutput);
      showToast("バックアップJSONをコピーしました。");
    } catch {
      setSettingsError("自動コピーできませんでした。欄内の内容を手動でコピーしてください。");
    }
  };

  const importBackup = async () => {
    setSettingsError("");
    let months: ReturnType<typeof parseBackup>;
    try {
      months = parseBackup(importInput);
    } catch (error) {
      return setSettingsError(errorMessage(error, "JSONを解析できませんでした。"));
    }
    if (!window.confirm(`${months.length}か月分を既存データへマージします。続けますか？`)) return;
    if (!(await flushRef.current("import"))) return setSettingsError("未保存の予定があるため、インポートを停止しました。");
    let completed = 0;
    try {
      for (const item of months) {
        const existing = await readMonth(item.month);
        if (existing.certainty !== "known") throw new Error(`${item.month} の既存データを確認できませんでした。`);
        const now = Date.now();
        const merged: MonthData = {
          schemaVersion: 1,
          updatedAt: now,
          updatedBy: metaRef.current.deviceName.trim() || "インポート",
          events: cleanExpiredTombstones(mergeEvents(existing.data.events, item.data.events), now),
        };
        const raw = JSON.stringify(merged);
        if (byteLength(raw) >= MAX_MONTH_BYTES) throw new Error(`${item.month} のデータ量が上限に近づいています。`);
        await storageAdapter.set(monthKey(item.month), raw);
        completed += 1;
      }
      await loadMonthRef.current(monthRef.current);
      setImportInput("");
      showToast(`${completed}か月分をマージしました。`);
    } catch (error) {
      setSettingsError(`${errorMessage(error, "インポートに失敗しました。")}（${completed}/${months.length}か月完了）`);
    }
  };

  const monthDate = dateFromMonth(currentMonth);
  const statusColor = status === "error" ? "bg-rose-500" : status === "saving" || status === "waiting" ? "bg-amber-500" : "bg-emerald-500";
  const selectedDateLabel = dateFormatter.format(new Date(`${selectedDate}T00:00:00`));

  return (
    <div className="min-h-screen bg-slate-100 px-3 py-3 text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100 sm:px-5 sm:py-5">
      <div className="mx-auto max-w-6xl space-y-3 sm:space-y-4">
        <header className="overflow-hidden rounded-3xl border border-white/70 bg-white shadow-[0_18px_60px_rgba(15,23,42,.08)] dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 px-4 py-4 text-white sm:px-6">
            <div>
              <p className="text-xs font-bold tracking-[.18em] text-blue-100">CLAUDE ARTIFACT</p>
              <h1 className="mt-0.5 text-xl font-black tracking-tight sm:text-2xl">スケジュール</h1>
            </div>
            <div className="flex items-center gap-2">
              <button className="icon-button-on-color" type="button" onClick={() => void (async () => (await flushRef.current("reload")) && loadMonthRef.current(monthRef.current, true))()} aria-label="予定を再読み込み">↻</button>
              <button className="icon-button-on-color" type="button" onClick={openSettings} aria-label="設定を開く">⚙</button>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 px-3 py-3 sm:px-6">
            <button className="icon-button" type="button" onClick={() => shiftMonth(-1)} aria-label="前月">‹</button>
            <div className="min-w-0 text-center">
              <p className="text-lg font-black tabular-nums">{monthDate.getFullYear()}年 {monthDate.getMonth() + 1}月</p>
              <button className="mt-0.5 text-xs font-bold text-blue-600 hover:underline dark:text-blue-400" type="button" onClick={() => void navigateToMonth(monthFromDate(today), today.getDate())}>今日へ戻る</button>
            </div>
            <button className="icon-button" type="button" onClick={() => shiftMonth(1)} aria-label="翌月">›</button>
          </div>
        </header>

        {PREVIEW_MODE && <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100">プレビューモードです。予定はページを再読み込みすると消えます。</div>}
        {warning && <div role="alert" className="rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-100">{warning}</div>}

        <main className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,.85fr)] lg:gap-4">
          <section className="min-w-0 rounded-3xl border border-white/80 bg-white p-3 shadow-[0_18px_60px_rgba(15,23,42,.07)] dark:border-slate-800 dark:bg-slate-900 sm:p-5">
            <div className="grid grid-cols-7 px-1 pb-2 text-center text-xs font-black text-slate-400">
              {WEEKDAYS.map((day, index) => <span className={index === 0 ? "text-rose-500" : index === 6 ? "text-blue-500" : ""} key={day}>{day}</span>)}
            </div>
            <div className="grid grid-cols-7 gap-1" role="grid" aria-label={`${monthDate.getMonth() + 1}月のカレンダー`}>
              {calendarCells.map((cell, index) => cell ? (
                <button
                  type="button"
                  key={cell.key}
                  onClick={() => setSelectedDate(cell.key)}
                  aria-label={`${monthDate.getMonth() + 1}月${cell.day}日、予定${cell.events.length}件`}
                  className={`aspect-square min-w-0 rounded-2xl border p-1 text-sm font-bold transition focus:outline-none focus:ring-2 focus:ring-blue-500 ${selectedDate === cell.key ? "border-blue-500 bg-blue-600 text-white shadow-lg shadow-blue-600/20" : localDateString(today) === cell.key ? "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-200" : "border-transparent hover:border-slate-200 hover:bg-slate-50 dark:hover:border-slate-700 dark:hover:bg-slate-800"}`}
                >
                  <span>{cell.day}</span>
                  <span className="mt-1 flex h-1.5 justify-center gap-0.5" aria-hidden="true">
                    {cell.events.slice(0, 3).map((event) => <span key={event.id} className={`h-1.5 w-1.5 rounded-full ${selectedDate === cell.key ? "bg-white" : COLOR_DOT[event.color]}`} />)}
                  </span>
                </button>
              ) : <span key={`blank-${index}`} aria-hidden="true" />)}
            </div>
          </section>

          <section className="min-w-0 rounded-3xl border border-white/80 bg-white p-4 shadow-[0_18px_60px_rgba(15,23,42,.07)] dark:border-slate-800 dark:bg-slate-900 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-black tracking-widest text-slate-400">選択中</p>
                <h2 className="mt-1 text-xl font-black">{selectedDateLabel}</h2>
                <p className="mt-0.5 text-sm font-semibold text-slate-500 dark:text-slate-400">{visibleEvents.length}件の予定</p>
              </div>
              <button className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-2xl font-light text-white shadow-lg shadow-blue-600/25 transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:ring-offset-slate-900" type="button" onClick={() => openEventDialog()} aria-label="予定を追加">＋</button>
            </div>

            <div className="mt-4 space-y-2">
              {visibleEvents.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center dark:border-slate-700">
                  <p className="font-black">予定はありません</p>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">＋ボタンから、この日の予定を追加できます。</p>
                </div>
              ) : visibleEvents.map((event) => (
                <button key={event.id} type="button" onClick={() => openEventDialog(event)} className={`flex w-full min-w-0 items-center gap-3 rounded-2xl border-l-4 p-3 text-left transition hover:-translate-y-0.5 hover:shadow-md ${COLOR_RING[event.color]}`}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-black">{event.title}</span>
                    {event.memo && <span className="mt-0.5 block truncate text-sm text-slate-500 dark:text-slate-400">{event.memo}</span>}
                  </span>
                  <span className="shrink-0 rounded-xl bg-white/80 px-2.5 py-1.5 text-xs font-black tabular-nums text-slate-600 dark:bg-slate-950/40 dark:text-slate-300">{event.start === null ? "終日" : event.end ? `${event.start}–${event.end}` : event.start}</span>
                </button>
              ))}
            </div>
          </section>
        </main>

        <section className="grid gap-3 rounded-3xl border border-white/80 bg-white p-4 shadow-[0_18px_60px_rgba(15,23,42,.07)] dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-[minmax(180px,.7fr)_minmax(0,1.3fr)] sm:p-5">
          <div className="flex items-center gap-3">
            <span className={`h-3 w-3 shrink-0 rounded-full ${statusColor}`} aria-hidden="true" />
            <div>
              <p className="font-black">{statusDetail ?? STATUS_LABELS[status]}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">未保存 {pendingCount}件</p>
            </div>
            {status === "error" && pendingCount > 0 && <button className="ml-auto rounded-xl bg-rose-600 px-3 py-2 text-sm font-bold text-white" type="button" onClick={() => void flushRef.current("retry")}>再試行</button>}
          </div>
          <dl className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-2xl bg-slate-50 p-2.5 dark:bg-slate-800"><dt className="font-bold text-slate-400">月データ更新</dt><dd className="mt-1 truncate font-black">{formatStoredTime(monthData.updatedAt)}</dd></div>
            <div className="rounded-2xl bg-slate-50 p-2.5 dark:bg-slate-800"><dt className="font-bold text-slate-400">更新元</dt><dd className="mt-1 truncate font-black">{monthData.updatedBy || "—"}</dd></div>
            <div className="rounded-2xl bg-slate-50 p-2.5 dark:bg-slate-800"><dt className="font-bold text-slate-400">最終取得</dt><dd className="mt-1 truncate font-black">{formatStoredTime(lastFetchedAt)}</dd></div>
          </dl>
        </section>
      </div>

      {eventDialogOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="event-dialog-title" onKeyDown={handleEventKeyDown} onCompositionStart={() => { composingRef.current = true; }} onCompositionEnd={() => { composingRef.current = false; }}>
          <div className="modal-panel max-w-xl">
            <div className="modal-header"><h2 id="event-dialog-title" className="text-xl font-black">{editingEventId ? "予定を編集" : "予定を追加"}</h2><button className="icon-button" type="button" onClick={closeEventDialog} aria-label="閉じる">×</button></div>
            <div className="space-y-4 p-4 sm:p-5">
              <label className="field-label">日付<input className="field-input" type="date" min={`${currentMonth}-01`} max={dateKey(currentMonth, daysInMonth(currentMonth))} value={eventDraft.date} onChange={(event) => { const value = event.currentTarget.value; setEventDraft((current) => ({ ...current, date: value })); }} /></label>
              <label className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3 font-bold dark:bg-slate-800"><input className="h-5 w-5 accent-blue-600" type="checkbox" checked={eventDraft.allDay} onChange={(event) => { const checked = event.currentTarget.checked; setEventDraft((current) => ({ ...current, allDay: checked, start: checked ? "" : current.start, end: checked ? "" : current.end })); }} />終日の予定</label>
              <div className="grid grid-cols-2 gap-3"><label className="field-label">開始時刻<input className="field-input" type="time" disabled={eventDraft.allDay} value={eventDraft.start} onChange={(event) => { const value = event.currentTarget.value; setEventDraft((current) => ({ ...current, start: value })); }} /></label><label className="field-label">終了時刻<input className="field-input" type="time" disabled={eventDraft.allDay} value={eventDraft.end} onChange={(event) => { const value = event.currentTarget.value; setEventDraft((current) => ({ ...current, end: value })); }} /></label></div>
              <label className="field-label">タイトル<input autoFocus className="field-input" type="text" maxLength={120} value={eventDraft.title} onChange={(event) => { const value = event.currentTarget.value; setEventDraft((current) => ({ ...current, title: value })); }} /></label>
              <label className="field-label">メモ<textarea className="field-input min-h-24 resize-y" maxLength={2000} value={eventDraft.memo} onChange={(event) => { const value = event.currentTarget.value; setEventDraft((current) => ({ ...current, memo: value })); }} /></label>
              <fieldset><legend className="field-label">色</legend><div className="mt-2 flex flex-wrap gap-2">{COLORS.map((color) => <button type="button" key={color} aria-label={color} aria-pressed={eventDraft.color === color} onClick={() => setEventDraft((current) => ({ ...current, color }))} className={`h-10 w-10 rounded-2xl border-4 transition ${COLOR_DOT[color]} ${eventDraft.color === color ? "border-slate-900 scale-110 dark:border-white" : "border-transparent"}`} />)}</div></fieldset>
              {eventError && <p role="alert" className="text-sm font-bold text-rose-600 dark:text-rose-400">{eventError}</p>}
            </div>
            <div className="modal-footer">{editingEventId && <button className="button-danger mr-auto" type="button" onClick={deleteEditingEvent}>削除</button>}<button className="button-secondary" type="button" onClick={closeEventDialog}>キャンセル</button><button className="button-primary" type="button" onClick={saveEventDraft}>保存</button></div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="settings-dialog-title">
          <div className="modal-panel max-w-2xl">
            <div className="modal-header"><div><p className="text-xs font-black tracking-widest text-blue-600 dark:text-blue-400">SETTINGS</p><h2 id="settings-dialog-title" className="text-xl font-black">設定とバックアップ</h2></div><button className="icon-button" type="button" onClick={() => setSettingsOpen(false)} aria-label="閉じる">×</button></div>
            <div className="max-h-[70vh] space-y-6 overflow-y-auto p-4 sm:p-5">
              <section className="space-y-3"><h3 className="font-black">表示と更新元</h3><label className="field-label">保存者ラベル<input className="field-input" type="text" maxLength={40} placeholder="例: 自宅PC" value={settingsDeviceName} onChange={(event) => setSettingsDeviceName(event.target.value)} /></label><div className="grid grid-cols-2 gap-2"><button className={`theme-choice ${settingsTheme === "light" ? "theme-choice-selected" : ""}`} type="button" onClick={() => setSettingsTheme("light")}>☀ ライト</button><button className={`theme-choice ${settingsTheme === "dark" ? "theme-choice-selected" : ""}`} type="button" onClick={() => setSettingsTheme("dark")}>☾ ダーク</button></div><button className="button-primary" type="button" onClick={() => void saveSettings()}>設定を保存</button></section>
              <section className="space-y-3 border-t border-slate-200 pt-5 dark:border-slate-700"><div><h3 className="font-black">バックアップを書き出す</h3><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">予定内容を含むため、共有先に注意してください。</p></div><div className="flex flex-wrap gap-2"><button className="button-primary" type="button" onClick={() => void exportBackup()}>バックアップを作成</button><button className="button-secondary" type="button" onClick={() => void copyBackup()}>コピー</button></div><textarea className="field-input min-h-32 font-mono text-xs" readOnly value={exportOutput} placeholder="作成したJSONがここに表示されます" /><p className="text-xs font-bold text-slate-500 dark:text-slate-400">最終バックアップ: {formatStoredTime(meta.lastBackupAt)}</p></section>
              <section className="space-y-3 border-t border-slate-200 pt-5 dark:border-slate-700"><div><h3 className="font-black">バックアップを取り込む</h3><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">既存予定は消さず、月・予定ID単位でマージします。</p></div><textarea className="field-input min-h-32 font-mono text-xs" value={importInput} onChange={(event) => setImportInput(event.target.value)} placeholder="バックアップJSONを貼り付け" /><button className="button-secondary" type="button" onClick={() => void importBackup()}>マージインポート</button></section>
              {settingsError && <p role="alert" className="rounded-2xl bg-rose-50 p-3 text-sm font-bold text-rose-700 dark:bg-rose-950/50 dark:text-rose-200">{settingsError}</p>}
            </div>
            <div className="modal-footer"><button className="button-primary" type="button" onClick={() => setSettingsOpen(false)}>完了</button></div>
          </div>
        </div>
      )}

      {toast && <div role="status" className="fixed bottom-5 left-1/2 z-[70] max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-2xl bg-slate-950 px-4 py-3 text-center text-sm font-bold text-white shadow-2xl dark:bg-white dark:text-slate-950">{toast}</div>}
    </div>
  );
}
