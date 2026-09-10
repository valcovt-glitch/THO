import assert from "node:assert/strict";
import test from "node:test";
import { computeStatus, LIMITS, type RawSession } from "./eu561.ts";

const settings = { extendedDrivingEnabled: true, reducedRestEnabled: false };
const base = new Date("2026-07-06T06:00:00.000Z");

function session(
  id: number,
  type: RawSession["type"],
  startSeconds: number,
  durationSeconds: number,
  breakFirstPart = false,
): RawSession {
  return {
    id,
    type,
    startTime: new Date(base.getTime() + startSeconds * 1000),
    endTime: new Date(base.getTime() + (startSeconds + durationSeconds) * 1000),
    breakFirstPart,
  };
}

function status(sessions: RawSession[]) {
  const lastEnd = sessions.at(-1)?.endTime ?? base;
  return computeStatus(sessions, settings, new Date((lastEnd?.getTime() ?? base.getTime()) + 1000));
}

test("work does not count as the 45-minute driving break", () => {
  const result = status([
    session(1, "driving", 0, 4.5 * 3600),
    session(2, "work", 4.5 * 3600, 45 * 60),
  ]);

  assert.equal(result.breaksCompletedToday, 0);
  assert.equal(result.continuousDrivingSeconds, 4.5 * 3600);
  assert.equal(result.breakAccumSeconds, 0);
});

test("availability does not count as a recuperation break", () => {
  const result = status([
    session(1, "driving", 0, 3600),
    session(2, "availability", 3600, 45 * 60),
  ]);

  assert.equal(result.breaksCompletedToday, 0);
  assert.equal(result.continuousDrivingSeconds, 3600);
});

test("one uninterrupted 45-minute rest resets continuous driving", () => {
  const result = status([
    session(1, "driving", 0, 4.5 * 3600),
    session(2, "rest", 4.5 * 3600, 45 * 60),
  ]);

  assert.equal(result.breaksCompletedToday, 1);
  assert.equal(result.continuousDrivingSeconds, 0);
  assert.equal(result.breakRemainingSeconds, 45 * 60);
});

test("exactly 15 minutes followed later by an uninterrupted 30 minutes completes a split break", () => {
  const result = status([
    session(1, "driving", 0, 2 * 3600),
    session(2, "rest", 2 * 3600, 15 * 60),
    session(3, "driving", 2 * 3600 + 15 * 60, 30 * 60),
    session(4, "rest", 2.5 * 3600 + 15 * 60, 30 * 60),
  ]);

  assert.equal(result.breaksCompletedToday, 1);
  assert.equal(result.continuousDrivingSeconds, 0);
});

test("an interrupted second part must restart from zero", () => {
  const result = status([
    session(1, "driving", 0, 2 * 3600),
    session(2, "rest", 2 * 3600, 15 * 60),
    session(3, "driving", 2 * 3600 + 15 * 60, 10 * 60),
    session(4, "rest", 2 * 3600 + 25 * 60, 20 * 60),
    session(5, "work", 2 * 3600 + 45 * 60, 5 * 60),
    session(6, "rest", 2 * 3600 + 50 * 60, 10 * 60),
  ]);

  assert.equal(result.breaksCompletedToday, 0);
  assert.equal(result.breakState, "firstDone");
  assert.equal(result.breakSecondPartAccumSeconds, 10 * 60);
});

test("a second break cannot complete without new driving after the first break", () => {
  const result = status([
    session(1, "driving", 0, 3600),
    session(2, "rest", 3600, 45 * 60),
    session(3, "availability", 3600 + 45 * 60, 60),
    session(4, "rest", 3600 + 46 * 60, 45 * 60),
  ]);

  assert.equal(result.breaksCompletedToday, 1);
});

test("current calendar week starts on Monday UTC and biweekly total spans two calendar weeks", () => {
  const monday = new Date("2026-07-06T00:00:00.000Z");
  const result = computeStatus(
    [
      {
        id: 1,
        type: "driving",
        startTime: new Date("2026-07-05T20:00:00.000Z"),
        endTime: new Date("2026-07-05T22:00:00.000Z"),
        breakFirstPart: false,
      },
      {
        id: 2,
        type: "driving",
        startTime: new Date("2026-07-06T08:00:00.000Z"),
        endTime: new Date("2026-07-06T10:00:00.000Z"),
        breakFirstPart: false,
      },
    ],
    settings,
    new Date("2026-07-10T12:00:00.000Z"),
  );

  assert.equal(result.weekStart, monday.toISOString());
  assert.equal(result.weeklyDrivingSeconds, 2 * 3600);
  assert.equal(result.biweeklyDrivingSeconds, 4 * 3600);
});

test("calendar week boundary follows the driver's timezone offset", () => {
  const result = computeStatus([], settings, new Date("2026-07-05T22:30:00.000Z"), -120);
  assert.equal(result.weekStart, "2026-07-05T22:00:00.000Z"); // Monday 00:00 in UTC+2
});

function restAt(id: number, start: string, durationHours: number, open = false): RawSession {
  const startTime = new Date(start);
  return {
    id,
    type: "rest",
    startTime,
    endTime: open ? null : new Date(startTime.getTime() + durationHours * 3600 * 1000),
    breakFirstPart: false,
  };
}

test("a reduced weekly rest creates an exact compensation debt and deadline", () => {
  const result = computeStatus(
    [restAt(1, "2026-07-11T06:00:00.000Z", 24)],
    settings,
    new Date("2026-07-13T12:00:00.000Z"),
  );

  assert.equal(result.lastWeeklyRest?.kind, "reduced");
  assert.equal(result.compensationSeconds, 21 * 3600);
  assert.equal(result.compensationNextSeconds, 21 * 3600);
  // Reduced in the week beginning 6 July: compensation is due before 3 August.
  assert.equal(result.compensationDeadline, "2026-08-03T00:00:00.000Z");
  assert.equal(result.nextWeeklyRestKind, "regular");
  assert.equal(result.nextWeeklyRestRequiredSeconds, LIMITS.WEEKLY_REST_NORMAL);
});

test("weekly compensation is only cleared by one sufficiently long attached rest block", () => {
  const result = computeStatus(
    [
      restAt(1, "2026-07-11T06:00:00.000Z", 24), // owes 21 h
      restAt(2, "2026-07-18T06:00:00.000Z", 60), // 45 h regular + 15 h spare: not enough
      restAt(3, "2026-07-25T06:00:00.000Z", 66), // 45 h regular + 21 h compensation
    ],
    settings,
    new Date("2026-07-29T12:00:00.000Z"),
  );

  assert.equal(result.compensationSeconds, 0);
  assert.equal(result.compensationDeadline, null);
});

test("two reduced weekly rests in consecutive completed weeks are flagged in ordinary mode", () => {
  const result = computeStatus(
    [
      restAt(1, "2026-07-11T06:00:00.000Z", 24),
      restAt(2, "2026-07-18T06:00:00.000Z", 24),
    ],
    settings,
    new Date("2026-07-27T12:00:00.000Z"),
  );

  assert.equal(result.weeklyRestTwoWeekViolation, true);
});

test("an ongoing weekly rest that started before the six-period deadline is not overdue", () => {
  const result = computeStatus(
    [
      restAt(1, "2026-07-06T00:00:00.000Z", 24),
      restAt(2, "2026-07-11T23:00:00.000Z", 0, true),
    ],
    settings,
    new Date("2026-07-12T12:00:00.000Z"),
  );

  assert.equal(result.weeklyRestStartedInTime, true);
  assert.equal(result.weeklyRestOverdue, false);
});
