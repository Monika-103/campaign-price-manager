// Date-and-time helpers shared by every form that schedules something
// (campaigns and discounts).

// Times offered for a start and end, every 30 minutes. Polaris has no time
// field, and a fixed list keeps offers on tidy boundaries (18:00, not 17:53).
// The end list closes with 23:59 so an offer can run to the very end of a day.
export const TIMES = Array.from({ length: 48 }, (_, index) => {
  const hours = String(Math.floor(index / 2)).padStart(2, "0");
  return `${hours}:${index % 2 === 0 ? "00" : "30"}`;
});
export const END_TIMES = [...TIMES, "23:59"];

export function timeLabel(time) {
  const [hours, minutes] = time.split(":").map(Number);
  const suffix = hours < 12 ? "AM" : "PM";
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

// Combines a date and a time into an exact moment, read in the merchant's own
// timezone -- "18:00" means 18:00 where they are, not where the server is.
export function toMoment(date, time) {
  if (!date) return "";
  const moment = new Date(`${date}T${time}:00`);
  return Number.isNaN(moment.getTime()) ? "" : moment.toISOString();
}

// Reads a moment sent by one of those forms back on the server.
export function parseMoment(value) {
  if (!value) return null;
  const moment = new Date(String(value));
  return Number.isNaN(moment.getTime()) ? null : moment;
}
