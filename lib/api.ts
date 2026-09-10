import {
  deleteSession,
  endShift,
  endWork,
  finishWork,
  flagFirstBreakPart,
  getCurrentShift,
  getCurrentStatus,
  getHistory,
  getSettings,
  setActivity,
  startShift,
  startWork,
  transitionActivity,
  updateSettings,
} from "./local-database";
import type { SessionType } from "./eu561";

type LocalResponse<T> = {
  ok: boolean;
  status: number;
  json: () => Promise<T>;
};

function success<T>(body: T, status = 200): LocalResponse<T> {
  return { ok: true, status, json: async () => body };
}

function failure(error: unknown, status = 400): LocalResponse<{ error: string }> {
  const message = error instanceof Error ? error.message : "Akcia sa nepodarila";
  return { ok: false, status, json: async () => ({ error: message }) };
}

async function respond<T>(operation: () => Promise<T>, wrap: (value: T) => object, status = 200) {
  try {
    return success(wrap(await operation()), status);
  } catch (error) {
    return failure(error);
  }
}

export const api = {
  trucking: {
    status: {
      $get: ({ query }: { query: { deviceId: string; timezoneOffsetMinutes?: string } }) =>
        respond(
          () => getCurrentStatus(query.deviceId, Number(query.timezoneOffsetMinutes ?? "0") || 0),
          (status) => ({ status }),
        ),
    },
    transition: {
      $post: ({ json }: { json: { deviceId: string; type: "driving" | "work"; timestamp?: string } }) =>
        respond(() => transitionActivity(json), (session) => ({ session }), 201),
    },
    work: {
      start: {
        $post: ({ json }: { json: { deviceId: string; timestamp?: string } }) =>
          respond(() => startWork(json), (session) => ({ session }), 201),
      },
      end: {
        $post: ({ json }: { json: { deviceId: string; timestamp?: string } }) =>
          respond(() => endWork(json), (session) => ({ session }), 201),
      },
    },
    "finish-work": {
      $post: ({ json }: { json: { deviceId: string; timestamp?: string } }) =>
        respond(() => finishWork(json), (session) => ({ session }), 201),
    },
    "set-activity": {
      $post: ({ json }: { json: { deviceId: string; type: SessionType; timestamp?: string } }) =>
        respond(() => setActivity(json), (session) => ({ session }), 201),
    },
    break: {
      "flag-first-part": {
        $post: ({ json }: { json: { deviceId: string } }) =>
          respond(() => flagFirstBreakPart(json.deviceId), (session) => ({ session })),
      },
    },
    history: {
      $get: ({ query }: { query: { deviceId: string; days?: string; from?: string } }) =>
        respond(() => getHistory(query), (sessions) => ({ sessions })),
    },
    sessions: {
      ":deviceId": {
        ":id": {
          $delete: ({ param }: { param: { deviceId: string; id: string } }) =>
            respond(
              () => deleteSession(param.deviceId, Number(param.id)),
              () => ({ ok: true }),
            ),
        },
      },
    },
    settings: {
      $get: ({ query }: { query: { deviceId: string } }) =>
        respond(() => getSettings(query.deviceId), (settings) => ({ settings })),
      $put: ({
        json,
      }: {
        json: {
          deviceId: string;
          extendedDrivingEnabled?: boolean;
          reducedRestEnabled?: boolean;
          pushToken?: string;
        };
      }) =>
        respond(
          () =>
            updateSettings(json.deviceId, {
              extendedDrivingEnabled: json.extendedDrivingEnabled,
              reducedRestEnabled: json.reducedRestEnabled,
              pushToken: json.pushToken,
            }),
          (settings) => ({ settings }),
        ),
    },
    shift: {
      start: {
        $post: ({
          json,
        }: {
          json: {
            deviceId: string;
            driverName?: string;
            plate?: string;
            startKm?: number;
            timestamp?: string;
          };
        }) => respond(() => startShift(json), (shift) => ({ shift }), 201),
      },
      end: {
        $post: ({ json }: { json: { deviceId: string; endKm?: number; timestamp?: string } }) =>
          respond(() => endShift(json), (shift) => ({ shift })),
      },
      current: {
        $get: ({ query }: { query: { deviceId: string } }) =>
          respond(() => getCurrentShift(query.deviceId), (shift) => ({ shift })),
      },
    },
  },
};
