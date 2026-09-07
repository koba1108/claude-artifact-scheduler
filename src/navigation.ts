import { dateKey, daysInMonth } from "./domain";

export type ViewPanel = "event" | "settings" | null;

export type SchedulerView = {
  month: string;
  date: string;
  panel: ViewPanel;
  eventId: string | null;
};

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function isValidMonth(value: string | null): value is string {
  return Boolean(value && MONTH_PATTERN.test(value));
}

function isValidDate(value: string | null, month: string): value is string {
  if (!value || !DATE_PATTERN.test(value) || !value.startsWith(`${month}-`)) return false;
  const day = Number(value.slice(-2));
  return day >= 1 && day <= daysInMonth(month) && value === dateKey(month, day);
}

export function parseSchedulerView(search: string, fallbackDate: string): SchedulerView {
  const params = new URLSearchParams(search);
  const fallbackMonth = fallbackDate.slice(0, 7);
  const requestedMonth = params.get("month");
  const month = isValidMonth(requestedMonth) ? requestedMonth : fallbackMonth;
  const requestedDate = params.get("date");
  const date = isValidDate(requestedDate, month)
    ? requestedDate
    : month === fallbackMonth
      ? fallbackDate
      : dateKey(month, 1);
  const requestedPanel = params.get("panel");
  const panel: ViewPanel = requestedPanel === "event" || requestedPanel === "settings" ? requestedPanel : null;
  const requestedEventId = params.get("event");
  const eventId = panel === "event" && requestedEventId && requestedEventId.length <= 160 ? requestedEventId : null;

  return { month, date, panel, eventId };
}

export function buildSchedulerUrl(href: string, view: SchedulerView): string {
  const url = new URL(href);
  url.searchParams.set("month", view.month);
  url.searchParams.set("date", view.date);

  if (view.panel) url.searchParams.set("panel", view.panel);
  else url.searchParams.delete("panel");

  if (view.panel === "event" && view.eventId) url.searchParams.set("event", view.eventId);
  else url.searchParams.delete("event");

  return `${url.pathname}${url.search}${url.hash}`;
}
