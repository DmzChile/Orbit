import type { Settings } from "./model";
export function inQuietHours(settings: Settings, now = new Date()) {
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: settings.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  const start = settings.quietStart,
    end = settings.quietEnd;
  return start === end
    ? false
    : start < end
      ? time >= start && time < end
      : time >= start || time < end;
}
