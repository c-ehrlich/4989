import { useCallback, useEffect, useRef, useState } from "react";

const CHANNEL = "freegaku-4989";
const PROTOCOL_VERSION = 3;
const REQUEST_TIMEOUT_MS = 90_000;

export type FreegakuPhase =
  | "idle"
  | "checking-anki"
  | "capturing"
  | "updating-anki";

export type FreegakuMinePayload = {
  mode: "update" | "basic";
  front?: string;
  lines: string[];
  selectedText: string;
  targetOverride?: FreegakuMiningTarget;
  capture: {
    startMs: number;
    endMs: number;
    imageMs: number;
  };
  video: {
    id: string;
    title: string;
    author: string;
    startSec: number;
    url: string;
  };
};

export type FreegakuMiningTarget = {
  noteId: number;
  word: string;
};

export type FreegakuTargetMismatch = {
  ok: false;
  code: "target-word-mismatch";
  error: string;
  target: FreegakuMiningTarget;
};

type FreegakuFailure =
  | FreegakuTargetMismatch
  | { ok: false; error: string; code?: undefined };

export type FreegakuMineResult =
  | { ok: true; word: string }
  | FreegakuFailure;

export type FreegakuTargetCheckResult =
  | { ok: true; target: FreegakuMiningTarget }
  | FreegakuFailure;

type FreegakuResult = FreegakuMineResult | FreegakuTargetCheckResult;

type PendingRequest = {
  resolve: (result: FreegakuResult) => void;
  timeoutId: number;
};

export function useFreegaku() {
  const [available, setAvailable] = useState(false);
  const [phase, setPhase] = useState<FreegakuPhase>("idle");
  const pendingRequestsRef = useRef(new Map<string, PendingRequest>());

  useEffect(() => {
    const pendingRequests = pendingRequestsRef.current;
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== window || event.origin !== window.location.origin) {
        return;
      }
      if (!isFreegakuResponse(event.data)) return;

      if (event.data.type === "ready") {
        setAvailable(true);
        return;
      }
      const pending = pendingRequests.get(event.data.requestId);
      if (!pending) return;

      if (event.data.type === "status") {
        setPhase(event.data.phase);
        return;
      }

      window.clearTimeout(pending.timeoutId);
      pendingRequests.delete(event.data.requestId);
      setPhase("idle");
      pending.resolve(event.data.result);
    };

    window.addEventListener("message", handleMessage);
    window.postMessage(
      {
        channel: CHANNEL,
        version: PROTOCOL_VERSION,
        source: "4989",
        type: "probe",
      },
      window.location.origin,
    );

    return () => {
      window.removeEventListener("message", handleMessage);
      for (const pending of pendingRequests.values()) {
        window.clearTimeout(pending.timeoutId);
        pending.resolve({ ok: false, error: "The 4989 page was closed." });
      }
      pendingRequests.clear();
    };
  }, []);

  const sendRequest = useCallback(
    <T extends FreegakuResult>(
      request:
        | { type: "mine"; payload: FreegakuMinePayload }
        | { type: "target-check"; lines: string[] },
      timeoutError: string,
    ): Promise<T> => {
      if (!available) {
        return Promise.resolve({
          ok: false,
          error: "Freegaku is not connected. Install or reload the extension, then reload this page.",
        } as T);
      }

      const requestId = createRequestId();
      setPhase("checking-anki");
      return new Promise<T>((resolve) => {
        const timeoutId = window.setTimeout(() => {
          pendingRequestsRef.current.delete(requestId);
          setPhase("idle");
          resolve({
            ok: false,
            error: timeoutError,
          } as T);
        }, REQUEST_TIMEOUT_MS);
        pendingRequestsRef.current.set(requestId, {
          resolve: (result) => resolve(result as T),
          timeoutId,
        });
        window.postMessage(
          {
            channel: CHANNEL,
            version: PROTOCOL_VERSION,
            source: "4989",
            requestId,
            ...request,
          },
          window.location.origin,
        );
      });
    },
    [available],
  );

  const mine = useCallback(
    (payload: FreegakuMinePayload) =>
      sendRequest<FreegakuMineResult>(
        { type: "mine", payload },
        "Freegaku did not finish the card update in time.",
      ),
    [sendRequest],
  );

  const checkTarget = useCallback(
    (lines: string[]) =>
      sendRequest<FreegakuTargetCheckResult>(
        { type: "target-check", lines },
        "Freegaku did not finish checking the latest card in time.",
      ),
    [sendRequest],
  );

  return { available, checkTarget, mine, phase };
}

type FreegakuResponse =
  | { type: "ready" }
  | {
      type: "status";
      requestId: string;
      phase: Exclude<FreegakuPhase, "idle">;
    }
  | { type: "result"; requestId: string; result: FreegakuResult };

function isFreegakuResponse(value: unknown): value is FreegakuResponse {
  if (!isRecord(value)) return false;
  if (
    value.channel !== CHANNEL ||
    value.version !== PROTOCOL_VERSION ||
    value.source !== "freegaku"
  ) {
    return false;
  }
  if (value.type === "ready") return true;
  if (typeof value.requestId !== "string") return false;
  if (value.type === "status") {
    return (
      value.phase === "checking-anki" ||
      value.phase === "capturing" ||
      value.phase === "updating-anki"
    );
  }
  if (value.type !== "result" || !isRecord(value.result)) return false;
  if (value.result.ok === true) {
    return typeof value.result.word === "string" || isMiningTarget(value.result.target);
  }
  if (value.result.ok !== false || typeof value.result.error !== "string") {
    return false;
  }
  if (value.result.code === undefined) return true;
  return (
    value.result.code === "target-word-mismatch" &&
    isMiningTarget(value.result.target)
  );
}

function isMiningTarget(value: unknown): value is FreegakuMiningTarget {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.noteId) &&
    (value.noteId as number) > 0 &&
    typeof value.word === "string" &&
    value.word.length > 0 &&
    value.word.length <= 10_000
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function createRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}
