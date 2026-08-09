import { randomUUID } from "node:crypto";

const REQUEST_EVENT = "subagents:rpc:v1:request";
const REPLY_PREFIX = "subagents:rpc:v1:reply:";

export interface EventBus {
  on(event: string, handler: (value: unknown) => void): (() => void) | void;
  emit(event: string, value: unknown): void;
}

export type SubagentRpcMethod = "ping" | "status" | "spawn" | "steer" | "interrupt" | "stop" | "resume";

interface RpcSuccess {
  version: 1;
  requestId: string;
  success: true;
  data: unknown;
}

interface RpcFailure {
  version: 1;
  requestId: string;
  success: false;
  error: { code: string; message: string };
}

type RpcReply = RpcSuccess | RpcFailure;

function isReply(value: unknown, requestId: string): value is RpcReply {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const reply = value as Partial<RpcReply>;
  return reply.version === 1 && reply.requestId === requestId && typeof reply.success === "boolean";
}

export function callSubagentRpc<T = { text: string; details?: unknown }>(
  events: EventBus,
  method: SubagentRpcMethod,
  params: Record<string, unknown>,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const requestId = randomUUID();
  const replyEvent = `${REPLY_PREFIX}${requestId}`;
  const timeoutMs = options.timeoutMs ?? 15_000;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let unsubscribe: (() => void) | void;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      unsubscribe?.();
      callback();
    };
    const onAbort = () => finish(() => reject(new Error("pi-subagents RPC request was aborted.")));
    const timer = setTimeout(
      () => finish(() => reject(new Error(`pi-subagents RPC '${method}' timed out after ${timeoutMs}ms. Is pi-subagents loaded?`))),
      timeoutMs,
    );
    timer.unref?.();

    unsubscribe = events.on(replyEvent, (value) => {
      if (!isReply(value, requestId)) return;
      if (value.success) finish(() => resolve(value.data as T));
      else finish(() => reject(new Error(`pi-subagents RPC ${value.error.code}: ${value.error.message}`)));
    });
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) return onAbort();

    events.emit(REQUEST_EVENT, {
      version: 1,
      requestId,
      method,
      params,
      source: { extension: "pi-subagents-workflows" },
    });
  });
}
