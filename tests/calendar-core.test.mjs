import test from "node:test";
import assert from "node:assert/strict";

import {
  addDays,
  dateFromISO,
  dateToISO,
  eventsOverlap,
  findNextOpenSlot,
  formatTime,
  formatWeekRange,
  getMonthMatrix,
  minutesFromTime,
  sameDay,
  startOfWeek,
  timeFromMinutes,
} from "../calendar-core.js";

test("strict ISO calendar dates round-trip in local time", () => {
  const leapDay = dateFromISO("2024-02-29");
  assert.equal(dateToISO(leapDay), "2024-02-29");
  assert.equal(leapDay.getHours(), 0);
  assert.throws(() => dateFromISO("2023-02-29"), RangeError);
  assert.throws(() => dateFromISO("07/23/2026"), RangeError);
});

test("addDays and Monday-first startOfWeek cross calendar boundaries", () => {
  const sunday = dateFromISO("2026-08-02");
  assert.equal(dateToISO(startOfWeek(sunday)), "2026-07-27");
  assert.equal(dateToISO(addDays(sunday, 1)), "2026-08-03");
  assert.equal(dateToISO(sunday), "2026-08-02", "input remains immutable");
});

test("sameDay ignores time but not the local calendar date", () => {
  const morning = dateFromISO("2026-07-23");
  const evening = new Date(morning);
  evening.setHours(23, 59);
  assert.equal(sameDay(morning, evening), true);
  assert.equal(sameDay(morning, addDays(evening, 1)), false);
});

test("time conversion clamps to one clock day", () => {
  assert.equal(minutesFromTime("9:30 AM"), 570);
  assert.equal(minutesFromTime("12:05 PM"), 725);
  assert.equal(minutesFromTime("25:00"), 1439);
  assert.equal(minutesFromTime(-20), 0);
  assert.equal(timeFromMinutes(90), "01:30");
  assert.equal(timeFromMinutes(2_000), "23:59");
});

test("human time supports 12-hour and 24-hour preferences", () => {
  assert.equal(formatTime("00:05"), "12:05 AM");
  assert.equal(formatTime("13:05"), "1:05 PM");
  assert.equal(formatTime("13:05", "24h"), "13:05");
  assert.equal(formatTime(720, { hour12: false }), "12:00");
});

test("week labels compress same-month ranges and preserve cross-year context", () => {
  assert.equal(formatWeekRange("2026-07-23"), "Jul 20 – 26, 2026");
  assert.equal(formatWeekRange("2025-12-31"), "Dec 29, 2025 – Jan 4, 2026");
});

test("month matrix is a six-week Monday-first grid with adjacent dates", () => {
  const matrix = getMonthMatrix("2026-08-14", { today: "2026-08-14" });
  assert.equal(matrix.length, 6);
  assert.ok(matrix.every((week) => week.length === 7));
  assert.equal(matrix[0][0].iso, "2026-07-27");
  assert.equal(matrix[5][6].iso, "2026-09-06");
  assert.equal(matrix[0][0].inCurrentMonth, false);
  assert.equal(matrix[1][0].inCurrentMonth, true);
  assert.equal(matrix.flat().find((cell) => cell.iso === "2026-08-14").isToday, true);
});

test("event overlap is half-open and date-aware", () => {
  assert.equal(eventsOverlap({ startMin: 60, endMin: 120 }, { start: 119, end: 180 }), true);
  assert.equal(eventsOverlap({ start: 60, end: 120 }, { start: 120, end: 180 }), false);
  assert.equal(
    eventsOverlap(
      { date: "2026-07-23", startTime: "09:00", endTime: "10:00" },
      { date: "2026-07-24", startTime: "09:30", endTime: "10:30" },
    ),
    false,
  );
  assert.equal(
    eventsOverlap(
      { date: "2026-07-23", startTime: "23:30", endTime: "00:30" },
      { date: "2026-07-24", startTime: "00:15", endTime: "01:00" },
    ),
    true,
  );
});

test("findNextOpenSlot merges conflicts and permits back-to-back scheduling", () => {
  const events = [
    { date: "2026-07-23", startTime: "09:00", endTime: "09:30" },
    { date: "2026-07-23", startMin: 555, endMin: 600 },
    { date: "2026-07-23", startTime: "11:00", endTime: "12:00" },
    { date: "2026-07-24", startTime: "08:00", endTime: "18:00" },
  ];
  assert.deepEqual(findNextOpenSlot(events, "2026-07-23", 60, 540, 1_020), {
    date: "2026-07-23",
    startMin: 600,
    endMin: 660,
    startTime: "10:00",
    endTime: "11:00",
    start: "10:00",
    end: "11:00",
  });
});

test("findNextOpenSlot clips overnight events and returns null without room", () => {
  const events = [
    { date: "2026-07-22", startTime: "23:30", endTime: "08:30" },
    { date: "2026-07-23", startTime: "08:30", endTime: "09:30" },
  ];
  const slot = findNextOpenSlot(events, "2026-07-23", 30, 480, 600);
  assert.equal(slot.startTime, "09:30");
  assert.equal(slot.endTime, "10:00");
  assert.equal(findNextOpenSlot(events, "2026-07-23", 31, 480, 600), null);
});

test("findNextOpenSlot keeps wall-clock minutes across daylight-saving changes", () => {
  const priorTimezone = process.env.TZ;
  process.env.TZ = "America/Chicago";
  try {
    const events = [
      { date: "2026-03-08", startTime: "08:00", endTime: "09:00" },
    ];
    const slot = findNextOpenSlot(events, "2026-03-08", 60, 480, 600);
    assert.equal(slot.startTime, "09:00");
  } finally {
    if (priorTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = priorTimezone;
  }
});
