// Session identity helpers. A "session" is one gym visit: a timestamp-based
// master id shared by every set logged during that visit (see ARCHITECTURE.md,
// "The data contract"). All values are LOCAL time so the id reads like the wall
// clock at the gym.

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// ISO 8601 date "YYYY-MM-DD" for a given local Date (defaults to now).
export function localDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// A session: a stable id like "2026-06-30T18:05" plus the visit's date. The date
// is captured once at start and reused for every set, so a session that crosses
// midnight still files all its sets under the day it began.
export interface Session {
  id: string;
  date: string;
}

// Start a new session, stamped from the current local time.
export function startSession(d: Date = new Date()): Session {
  const date = localDate(d);
  const id = `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return { id, date };
}
