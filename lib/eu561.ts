// Practical EU 561/2006 helper calculations.
// This is not a certified tachograph. It provides driver-facing guidance from recorded
// activities and deliberately requires an explicit rest activity for break credit.

export type SessionType = "driving" | "availability" | "work" | "rest";

export interface RawSession {
  id: number;
  type: SessionType;
  startTime: Date;
  endTime: Date | null;
  breakFirstPart: boolean;
}

export interface DriverSettings {
  extendedDrivingEnabled: boolean;
  reducedRestEnabled: boolean;
}

export const LIMITS = {
  CONTINUOUS_DRIVING: 4.5 * 3600,
  BREAK_REQUIRED: 45 * 60,
  BREAK_FIRST_PART: 15 * 60,
  BREAK_SECOND_PART: 30 * 60,
  DAILY_DRIVING_NORMAL: 9 * 3600,
  DAILY_DRIVING_EXTENDED: 10 * 3600,
  EXTENDED_DRIVING_DAYS_PER_WEEK: 2,
  DAILY_REST_NORMAL: 11 * 3600,
  DAILY_REST_REDUCED: 9 * 3600,
  WEEKLY_DRIVING: 56 * 3600,
  BIWEEKLY_DRIVING: 90 * 3600,
  WEEKLY_REST_NORMAL: 45 * 3600,
  WEEKLY_REST_REDUCED: 24 * 3600,
  WEEKLY_REST_DUE_AFTER: 6 * 24 * 3600,
  WEEKLY_REST_WARNING_BEFORE: 24 * 3600,
  COMPENSATION_WARNING_BEFORE: 7 * 24 * 3600,
};

export type BreakState = "none" | "firstPending" | "firstDone";

function dur(session: RawSession, now: Date): number {
  const end = session.endTime ?? now;
  return Math.max(0, (end.getTime() - session.startTime.getTime()) / 1000);
}

function overlapSeconds(session: RawSession, rangeStart: Date, rangeEnd: Date, now: Date): number {
  const sessionEnd = session.endTime ?? now;
  const start = session.startTime > rangeStart ? session.startTime : rangeStart;
  const end = sessionEnd < rangeEnd ? sessionEnd : rangeEnd;
  return end > start ? (end.getTime() - start.getTime()) / 1000 : 0;
}

function startOfCalendarWeek(value: Date, timezoneOffsetMinutes: number): Date {
  // Convert the driver's local wall-clock time to a UTC-shaped Date, find local Monday 00:00,
  // then convert that wall-clock boundary back to a real UTC instant.
  const localWallClock = new Date(value.getTime() - timezoneOffsetMinutes * 60_000);
  localWallClock.setUTCHours(0, 0, 0, 0);
  const daysSinceMonday = (localWallClock.getUTCDay() + 6) % 7;
  localWallClock.setUTCDate(localWallClock.getUTCDate() - daysSinceMonday);
  return new Date(localWallClock.getTime() + timezoneOffsetMinutes * 60_000);
}

type WeeklyRestKind = "regular" | "reduced";

type WeeklyRestRecord = {
  startTime: Date;
  endTime: Date;
  durationSeconds: number;
  kind: WeeklyRestKind;
  weekStart: Date;
};

type CompensationDebt = {
  seconds: number;
  createdAt: Date;
  deadline: Date;
};

type RestInterval = {
  startTime: Date;
  endTime: Date;
  durationSeconds: number;
};

/**
 * Article 8(6) of Regulation (EC) 561/2006, in the ordinary (non-derogation)
 * case. A weekly rest must begin within six 24-hour periods of the previous
 * weekly rest. In two consecutive calendar weeks there must be two regular
 * weekly rests, or one regular and one reduced (at least 24 h). A reduction is
 * due in one block by the end of the third following week and is attached to a
 * rest of at least nine hours.
 *
 * The special rules for international goods work and occasional passenger
 * services require facts that this offline app does not record. The guardian is
 * intentionally conservative until those facts are explicitly modelled.
 */
function computeWeeklyRestGuardian(sessionsAsc: RawSession[], now: Date, timezoneOffsetMinutes: number) {
  const intervals: RestInterval[] = [];

  for (const session of sessionsAsc) {
    if (session.type !== "rest") continue;
    const endTime = session.endTime ?? now;
    if (endTime <= session.startTime) continue;

    const previous = intervals.at(-1);
    // A zero-gap rest-to-rest transition remains one uninterrupted rest period.
    if (previous && session.startTime <= previous.endTime) {
      previous.endTime = endTime > previous.endTime ? endTime : previous.endTime;
      previous.durationSeconds = (previous.endTime.getTime() - previous.startTime.getTime()) / 1000;
    } else {
      intervals.push({
        startTime: session.startTime,
        endTime,
        durationSeconds: (endTime.getTime() - session.startTime.getTime()) / 1000,
      });
    }
  }

  const weeklyRests: WeeklyRestRecord[] = [];
  const outstandingDebts: CompensationDebt[] = [];

  for (const rest of intervals) {
    const kind: WeeklyRestKind | null =
      rest.durationSeconds >= LIMITS.WEEKLY_REST_NORMAL
        ? "regular"
        : rest.durationSeconds >= LIMITS.WEEKLY_REST_REDUCED
          ? "reduced"
          : null;

    // A compensation must be a single block. Reserve the part that is already
    // used as the underlying daily/weekly rest, then settle only whole debts.
    const baseRest = kind === "regular"
      ? LIMITS.WEEKLY_REST_NORMAL
      : kind === "reduced"
        ? LIMITS.WEEKLY_REST_REDUCED
        : rest.durationSeconds >= LIMITS.DAILY_REST_REDUCED
          ? LIMITS.DAILY_REST_REDUCED
          : rest.durationSeconds;
    let availableCompensation = Math.max(0, rest.durationSeconds - baseRest);

    for (let index = 0; index < outstandingDebts.length;) {
      const debt = outstandingDebts[index];
      if (availableCompensation < debt.seconds) {
        index += 1;
        continue;
      }
      availableCompensation -= debt.seconds;
      outstandingDebts.splice(index, 1);
    }

    if (!kind) continue;
    const weekStart = startOfCalendarWeek(rest.startTime, timezoneOffsetMinutes);
    weeklyRests.push({ ...rest, kind, weekStart });

    // Add this reduction after using the interval's spare time, so a shortened
    // weekly rest never (incorrectly) compensates its own reduction.
    if (kind === "reduced") {
      outstandingDebts.push({
        seconds: LIMITS.WEEKLY_REST_NORMAL - rest.durationSeconds,
        createdAt: rest.endTime,
        // End of the third week following the week in which it was reduced.
        deadline: new Date(weekStart.getTime() + 4 * 7 * 24 * 3600 * 1000),
      });
    }
  }

  const currentWeekStart = startOfCalendarWeek(now, timezoneOffsetMinutes);
  const previousWeekStart = new Date(currentWeekStart.getTime() - 7 * 24 * 3600 * 1000);
  const weekKey = (value: Date) => value.toISOString();
  const restsByWeek = new Map<string, WeeklyRestRecord[]>();
  for (const rest of weeklyRests) {
    const key = weekKey(rest.weekStart);
    const existing = restsByWeek.get(key) ?? [];
    existing.push(rest);
    restsByWeek.set(key, existing);
  }

  const summary = (weekStart: Date) => {
    const rests = restsByWeek.get(weekKey(weekStart)) ?? [];
    return {
      total: rests.length,
      hasRegular: rests.some((rest) => rest.kind === "regular"),
      hasReduced: rests.some((rest) => rest.kind === "reduced"),
    };
  };

  const currentWeek = summary(currentWeekStart);
  const previousWeek = summary(previousWeekStart);
  // If this week already has a reduction (or the previous week did), the other
  // week in the consecutive pair must contain a regular 45-hour rest.
  const nextRequiredKind: WeeklyRestKind =
    currentWeek.hasRegular ? "reduced" : currentWeek.hasReduced || previousWeek.hasReduced ? "regular" : "reduced";

  const firstTrackedWeek = sessionsAsc.length
    ? startOfCalendarWeek(sessionsAsc[0].startTime, timezoneOffsetMinutes)
    : currentWeekStart;
  let twoWeekViolation = false;
  for (
    let pairStart = firstTrackedWeek;
    pairStart.getTime() + 14 * 24 * 3600 * 1000 <= now.getTime();
    pairStart = new Date(pairStart.getTime() + 7 * 24 * 3600 * 1000)
  ) {
    const first = summary(pairStart);
    const second = summary(new Date(pairStart.getTime() + 7 * 24 * 3600 * 1000));
    const total = first.total + second.total;
    const hasRegular = first.hasRegular || second.hasRegular;
    if (total < 2 || !hasRegular) twoWeekViolation = true;
  }

  const lastWeeklyRest = weeklyRests.at(-1) ?? null;
  const trackingStart = sessionsAsc[0]?.startTime ?? now;
  const weeklyRestStartDeadline = new Date(
    (lastWeeklyRest?.endTime ?? trackingStart).getTime() + LIMITS.WEEKLY_REST_DUE_AFTER * 1000,
  );
  const activeRest = intervals.at(-1);
  const restIsActive =
    activeRest !== undefined &&
    sessionsAsc.at(-1)?.type === "rest" &&
    sessionsAsc.at(-1)?.endTime === null;
  const weeklyRestStartedInTime = !!(
    restIsActive && activeRest && activeRest.startTime.getTime() <= weeklyRestStartDeadline.getTime()
  );
  const secondsUntilWeeklyRestDeadline =
    (weeklyRestStartDeadline.getTime() - now.getTime()) / 1000;
  const weeklyRestOverdue = secondsUntilWeeklyRestDeadline < 0 && !weeklyRestStartedInTime;
  const weeklyRestWarning =
    !weeklyRestOverdue &&
    !weeklyRestStartedInTime &&
    secondsUntilWeeklyRestDeadline <= LIMITS.WEEKLY_REST_WARNING_BEFORE;

  const oldestDebt = outstandingDebts[0] ?? null;
  const compensationSeconds = outstandingDebts.reduce((total, debt) => total + debt.seconds, 0);
  const compensationOverdue = outstandingDebts.some((debt) => debt.deadline <= now);
  const compensationWarning = outstandingDebts.some(
    (debt) => debt.deadline > now && debt.deadline.getTime() - now.getTime() <= LIMITS.COMPENSATION_WARNING_BEFORE * 1000,
  );

  return {
    lastWeeklyRest: lastWeeklyRest
      ? {
          startTime: lastWeeklyRest.startTime.toISOString(),
          endTime: lastWeeklyRest.endTime.toISOString(),
          durationSeconds: lastWeeklyRest.durationSeconds,
          kind: lastWeeklyRest.kind,
        }
      : null,
    weeklyRestStartDeadline: weeklyRestStartDeadline.toISOString(),
    weeklyRestRemainingSeconds: Math.max(0, secondsUntilWeeklyRestDeadline),
    weeklyRestWarning,
    weeklyRestOverdue,
    weeklyRestStartedInTime,
    weeklyRestDue: weeklyRestWarning || weeklyRestOverdue,
    nextWeeklyRestKind: nextRequiredKind,
    nextWeeklyRestRequiredSeconds:
      nextRequiredKind === "regular" ? LIMITS.WEEKLY_REST_NORMAL : LIMITS.WEEKLY_REST_REDUCED,
    weeklyRestTwoWeekViolation: twoWeekViolation,
    weeklyRestNeedsRegular: nextRequiredKind === "regular",
    compensationSeconds,
    compensationNextSeconds: oldestDebt?.seconds ?? 0,
    compensationDeadline: oldestDebt?.deadline.toISOString() ?? null,
    compensationOverdue,
    compensationWarning,
  };
}

export function computeStatus(
  sessionsAsc: RawSession[],
  settings: DriverSettings,
  now = new Date(),
  timezoneOffsetMinutes = 0,
) {
  const dailyDrivingLimit = settings.extendedDrivingEnabled
    ? LIMITS.DAILY_DRIVING_EXTENDED
    : LIMITS.DAILY_DRIVING_NORMAL;
  const dailyRestThreshold = settings.reducedRestEnabled
    ? LIMITS.DAILY_REST_REDUCED
    : LIMITS.DAILY_REST_NORMAL;
  const weeklyGuardian = computeWeeklyRestGuardian(sessionsAsc, now, timezoneOffsetMinutes);

  if (sessionsAsc.length === 0) {
    return {
      now: now.toISOString(),
      currentSession: null as null | { id: number; type: SessionType; startTime: string; elapsedSeconds: number },
      continuousDrivingSeconds: 0,
      continuousDrivingLimit: LIMITS.CONTINUOUS_DRIVING,
      breakOverdue: false,
      needsBreakSoon: false,
      breakAccumSeconds: 0,
      breakRequiredSeconds: LIMITS.BREAK_REQUIRED,
      breakRemainingSeconds: LIMITS.BREAK_REQUIRED,
      breakState: "none" as BreakState,
      breakFirstPartAccumSeconds: 0,
      breakFirstPartRequiredSeconds: LIMITS.BREAK_FIRST_PART,
      breakSecondPartAccumSeconds: 0,
      breakSecondPartRequiredSeconds: LIMITS.BREAK_SECOND_PART,
      canFlagFirstPart: false,
      breaksCompletedToday: 0,
      hasDrivenToday: false,
      activeBreakSlot: 1 as 1 | 2,
      secondBreakAvailable: settings.extendedDrivingEnabled,
      dailyDrivingSeconds: 0,
      dailyDrivingLimit,
      dailyLimitExceeded: false,
      dailyLimitWarning: false,
      dayStart: now.toISOString(),
      weeklyDrivingSeconds: 0,
      weeklyDrivingLimit: LIMITS.WEEKLY_DRIVING,
      biweeklyDrivingSeconds: 0,
      biweeklyDrivingLimit: LIMITS.BIWEEKLY_DRIVING,
      biweeklyLimitExceeded: false,
      weekStart: startOfCalendarWeek(now, timezoneOffsetMinutes).toISOString(),
      extendedDrivingDaysUsed: 0,
      extendedDrivingDaysLimit: LIMITS.EXTENDED_DRIVING_DAYS_PER_WEEK,
      extendedDrivingDaysRemaining: LIMITS.EXTENDED_DRIVING_DAYS_PER_WEEK,
      lastDailyRest: null,
      ...weeklyGuardian,
      restProgress: null,
      settings,
    };
  }

  let lastDailyRest: { endTime: Date; durationSeconds: number } | null = null;
  let lastWeeklyRest: { endTime: Date; durationSeconds: number } | null = null;

  for (const session of sessionsAsc) {
    if (session.type !== "rest" || !session.endTime) continue;
    const duration = dur(session, now);
    if (duration >= LIMITS.DAILY_REST_REDUCED) {
      lastDailyRest = { endTime: session.endTime, durationSeconds: duration };
    }
    if (duration >= LIMITS.WEEKLY_REST_REDUCED) {
      lastWeeklyRest = { endTime: session.endTime, durationSeconds: duration };
    }
  }

  const dayStart = lastDailyRest ? lastDailyRest.endTime : sessionsAsc[0].startTime;

  let continuousDriving = 0;
  let breakState: BreakState = "none";
  let breakAccum = 0;
  let firstPartAccum = 0;
  let secondPartAccum = 0;
  let breaksCompletedSinceDayStart = 0;
  let hasDrivenSinceDayStart = false;
  let hasDrivenSinceLastBreak = false;

  const resetInProgressBlock = () => {
    breakAccum = 0;
    if (breakState === "firstPending") {
      breakState = "none";
      firstPartAccum = 0;
    } else if (
      breakState === "firstDone" &&
      secondPartAccum > 0 &&
      secondPartAccum < LIMITS.BREAK_SECOND_PART
    ) {
      // The second part must be one uninterrupted block of at least 30 minutes.
      secondPartAccum = 0;
    }
  };

  const completeBreak = () => {
    continuousDriving = 0;
    breakState = "none";
    breakAccum = 0;
    firstPartAccum = 0;
    secondPartAccum = 0;
    hasDrivenSinceLastBreak = false;
    breaksCompletedSinceDayStart += 1;
  };

  for (const session of sessionsAsc) {
    const duration = dur(session, now);

    if (session.type === "driving") {
      resetInProgressBlock();
      continuousDriving += duration;
      hasDrivenSinceDayStart = true;
      hasDrivenSinceLastBreak = true;
    } else if (session.type === "rest") {
      if (hasDrivenSinceLastBreak) {
        if (breakState === "none" && session.breakFirstPart) {
          breakState = "firstPending";
          firstPartAccum = 0;
        }

        if (breakState === "firstPending") {
          firstPartAccum += duration;
          if (firstPartAccum >= LIMITS.BREAK_FIRST_PART) {
            const overflow = firstPartAccum - LIMITS.BREAK_FIRST_PART;
            firstPartAccum = LIMITS.BREAK_FIRST_PART;
            breakState = "firstDone";
            secondPartAccum = overflow;
            if (secondPartAccum >= LIMITS.BREAK_SECOND_PART) completeBreak();
          }
        } else if (breakState === "firstDone") {
          secondPartAccum += duration;
          if (secondPartAccum >= LIMITS.BREAK_SECOND_PART) completeBreak();
        } else {
          breakAccum += duration;
          if (breakAccum >= LIMITS.BREAK_REQUIRED) {
            completeBreak();
          } else if (breakAccum >= LIMITS.BREAK_FIRST_PART) {
            breakState = "firstDone";
            firstPartAccum = LIMITS.BREAK_FIRST_PART;
            secondPartAccum = breakAccum - LIMITS.BREAK_FIRST_PART;
            breakAccum = 0;
          }
        }
      }

      if (session.endTime && duration >= LIMITS.DAILY_REST_REDUCED) {
        continuousDriving = 0;
        breakState = "none";
        breakAccum = 0;
        firstPartAccum = 0;
        secondPartAccum = 0;
        breaksCompletedSinceDayStart = 0;
        hasDrivenSinceDayStart = false;
        hasDrivenSinceLastBreak = false;
      }
    } else {
      // Work and availability are not automatically treated as recuperation breaks.
      resetInProgressBlock();
    }
  }

  const activeBreakSlot: 1 | 2 = breaksCompletedSinceDayStart >= 1 ? 2 : 1;
  const secondBreakAvailable = settings.extendedDrivingEnabled;

  let dailyDrivingSeconds = 0;
  for (const session of sessionsAsc) {
    if (session.type === "driving") {
      dailyDrivingSeconds += overlapSeconds(session, dayStart, now, now);
    }
  }

  const weekStart = startOfCalendarWeek(now, timezoneOffsetMinutes);
  const previousWeekStart = new Date(weekStart.getTime() - 7 * 24 * 3600 * 1000);
  let weeklyDrivingSeconds = 0;
  let biweeklyDrivingSeconds = 0;

  for (const session of sessionsAsc) {
    if (session.type !== "driving") continue;
    weeklyDrivingSeconds += overlapSeconds(session, weekStart, now, now);
    biweeklyDrivingSeconds += overlapSeconds(session, previousWeekStart, now, now);
  }

  let segmentDriving = 0;
  let segmentEnd = sessionsAsc[0].startTime;
  let extendedDrivingDaysUsed = 0;

  const countSegment = () => {
    if (segmentEnd >= weekStart && segmentDriving > LIMITS.DAILY_DRIVING_NORMAL) {
      extendedDrivingDaysUsed += 1;
    }
  };

  for (const session of sessionsAsc) {
    if (session.type === "driving") {
      segmentDriving += dur(session, now);
      segmentEnd = session.endTime ?? now;
    }
    if (session.type === "rest" && session.endTime && dur(session, now) >= LIMITS.DAILY_REST_REDUCED) {
      segmentEnd = session.endTime;
      countSegment();
      segmentDriving = 0;
    }
  }
  segmentEnd = now;
  countSegment();

  const extendedDrivingDaysRemaining = Math.max(
    0,
    LIMITS.EXTENDED_DRIVING_DAYS_PER_WEEK - extendedDrivingDaysUsed,
  );

  const last = sessionsAsc[sessionsAsc.length - 1];
  const currentSession =
    last.endTime === null
      ? {
          id: last.id,
          type: last.type,
          startTime: last.startTime.toISOString(),
          elapsedSeconds: dur(last, now),
        }
      : null;

  let restProgress: null | {
    elapsedSeconds: number;
    dailyRestThreshold: number;
    weeklyRestThreshold: number;
    satisfiesDaily: boolean;
    satisfiesWeekly: boolean;
  } = null;

  if (currentSession?.type === "rest") {
    restProgress = {
      elapsedSeconds: currentSession.elapsedSeconds,
      dailyRestThreshold,
      weeklyRestThreshold: LIMITS.WEEKLY_REST_REDUCED,
      satisfiesDaily: currentSession.elapsedSeconds >= dailyRestThreshold,
      satisfiesWeekly: currentSession.elapsedSeconds >= LIMITS.WEEKLY_REST_REDUCED,
    };
  }

  const breakProgressSeconds =
    breakState === "firstDone"
      ? LIMITS.BREAK_FIRST_PART + secondPartAccum
      : breakState === "firstPending"
        ? firstPartAccum
        : breakAccum;

  return {
    now: now.toISOString(),
    currentSession,
    continuousDrivingSeconds: continuousDriving,
    continuousDrivingLimit: LIMITS.CONTINUOUS_DRIVING,
    breakOverdue: continuousDriving >= LIMITS.CONTINUOUS_DRIVING,
    needsBreakSoon:
      currentSession?.type === "driving" &&
      LIMITS.CONTINUOUS_DRIVING - continuousDriving <= 30 * 60 &&
      LIMITS.CONTINUOUS_DRIVING - continuousDriving > 0,
    breakAccumSeconds: breakProgressSeconds,
    breakRequiredSeconds: LIMITS.BREAK_REQUIRED,
    breakRemainingSeconds: Math.max(0, LIMITS.BREAK_REQUIRED - breakProgressSeconds),
    breakState,
    breakFirstPartAccumSeconds: firstPartAccum,
    breakFirstPartRequiredSeconds: LIMITS.BREAK_FIRST_PART,
    breakSecondPartAccumSeconds: secondPartAccum,
    breakSecondPartRequiredSeconds: LIMITS.BREAK_SECOND_PART,
    canFlagFirstPart:
      breakState === "none" && currentSession?.type === "rest" && hasDrivenSinceLastBreak,
    breaksCompletedToday: breaksCompletedSinceDayStart,
    hasDrivenToday: hasDrivenSinceDayStart,
    activeBreakSlot,
    secondBreakAvailable,
    dailyDrivingSeconds,
    dailyDrivingLimit,
    dailyLimitExceeded: dailyDrivingSeconds >= dailyDrivingLimit,
    dailyLimitWarning: dailyDrivingLimit - dailyDrivingSeconds <= 3600 && dailyDrivingLimit - dailyDrivingSeconds > 0,
    dayStart: dayStart.toISOString(),
    weeklyDrivingSeconds,
    weeklyDrivingLimit: LIMITS.WEEKLY_DRIVING,
    biweeklyDrivingSeconds,
    biweeklyDrivingLimit: LIMITS.BIWEEKLY_DRIVING,
    biweeklyLimitExceeded: biweeklyDrivingSeconds >= LIMITS.BIWEEKLY_DRIVING,
    weekStart: weekStart.toISOString(),
    extendedDrivingDaysUsed,
    extendedDrivingDaysLimit: LIMITS.EXTENDED_DRIVING_DAYS_PER_WEEK,
    extendedDrivingDaysRemaining,
    lastDailyRest: lastDailyRest
      ? { endTime: lastDailyRest.endTime.toISOString(), durationSeconds: lastDailyRest.durationSeconds }
      : null,
    ...weeklyGuardian,
    restProgress,
    settings,
  };
}
