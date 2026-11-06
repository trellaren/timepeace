import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC, type RouterOutputs } from "@timepeace/api-client";
import { FieldError, fieldReducer, initialFieldState, type FieldEffect, type FieldEvent, type FieldState, type OutboxOp, type TaskStatus } from "@timepeace/shared";
import * as Crypto from "expo-crypto";
import * as Network from "expo-network";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, AppState } from "react-native";
import superjson from "superjson";
import { kv, outboxFor } from "./db";
import { currentGeo } from "./geo";
import { flushOutbox, type OutboxRow } from "./outbox";
import { useSession } from "./session";
import { trpcClient, uploadReceipt } from "./trpc";

export type MyDay = RouterOutputs["field"]["myDay"];
export type DayTask = MyDay["tasks"][number];
type ExpensePayload = Extract<OutboxOp, { type: "expense.create" }>["payload"];

interface FieldCtx {
  day: MyDay | undefined;
  dayLoading: boolean;
  refresh: () => Promise<void>;
  /** Clock state (paid shift + optional running task). */
  field: FieldState;
  /** Running task timer, if any (shorthand for field.task). */
  timer: FieldState["task"];
  clockIn: (projectId?: string | null) => Promise<void>;
  clockOut: () => Promise<void>;
  startBreak: () => Promise<void>;
  endBreak: () => Promise<void>;
  /** Start/switch to a task. Clocks in first if needed: task time always sits inside a paid shift. */
  start: (task: DayTask) => Promise<void>;
  /** Stop the task timer; you stay clocked in (and paid). */
  stop: () => Promise<void>;
  setStatus: (task: DayTask, status: "DONE" | "BLOCKED" | "IN_PROGRESS", note?: string) => Promise<void>;
  requestMaterials: (task: DayTask, description: string, quantity?: string) => Promise<void>;
  addExpense: (p: Omit<ExpensePayload, "expenseId">, localReceiptUri: string | null) => Promise<void>;
  sync: { pending: number; rejected: OutboxRow[]; syncing: boolean; offline: boolean; lastSyncAt: Date | null };
  syncNow: () => Promise<void>;
  dismissRejected: (seq: number) => Promise<void>;
}

const Ctx = createContext<FieldCtx>(null as never);
const now = () => new Date().toISOString();
const uuid = () => Crypto.randomUUID();

export function FieldProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  // Mounted only while signed in (keyed by user in the root layout).
  const userId = session!.user.id;
  const userName = session!.user.name;
  const store = useMemo(() => outboxFor({ id: userId, name: userName }), [userId, userName]);
  const trpc = useTRPC();
  const qc = useQueryClient();
  const dayQuery = useQuery(trpc.field.myDay.queryOptions());
  const [cachedDay, setCachedDay] = useState<MyDay>();
  const [field, setField] = useState<FieldState>(initialFieldState);
  const [sync, setSync] = useState<FieldCtx["sync"]>({ pending: 0, rejected: [], syncing: false, offline: false, lastSyncAt: null });
  const flushing = useRef(false);
  const fieldRef = useRef<FieldState>(initialFieldState);
  fieldRef.current = field;

  // Restore offline state.
  useEffect(() => {
    kv.get<FieldState>("field").then((f) => {
      if (f) {
        fieldRef.current = f;
        setField(f);
      }
    });
    kv.get<string>("myDay").then((s) => s && setCachedDay(superjson.parse<MyDay>(s)));
  }, []);

  const saveField = useCallback(async (f: FieldState) => {
    fieldRef.current = f;
    setField(f);
    await kv.set("field", f);
  }, []);

  const refreshCounts = useCallback(async () => {
    const [c, rejected] = await Promise.all([store.count(), store.rejected()]);
    setSync((s) => ({ ...s, pending: c.pending, rejected }));
    return c;
  }, [store]);

  // Persist the last good My Day; adopt the server's running timer when nothing is queued locally.
  useEffect(() => {
    const d = dayQuery.data;
    if (!d) return;
    kv.set("myDay", superjson.stringify(d));
    setCachedDay(d);
    refreshCounts().then((c) => {
      if (c.pending === 0) {
        saveField({ shift: d.shift ?? null, task: d.running && d.running.taskId ? { ...d.running, taskId: d.running.taskId } : null });
      }
    });
  }, [dayQuery.data, refreshCounts, saveField]);

  const syncNow = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    setSync((s) => ({ ...s, syncing: true }));
    try {
      const r = await flushOutbox({ store, send: (ops) => trpcClient.field.sync.mutate({ ops }), uploadReceipt });
      setSync((s) => ({ ...s, offline: !!r.offlineError, lastSyncAt: r.offlineError ? s.lastSyncAt : new Date() }));
      if (r.sent > 0) await qc.invalidateQueries({ queryKey: trpc.field.pathKey() });
    } finally {
      flushing.current = false;
      setSync((s) => ({ ...s, syncing: false }));
      await refreshCounts();
    }
  }, [qc, trpc, refreshCounts, store]);

  // Triggers: startup, every 30s, network regained, app foregrounded.
  useEffect(() => {
    syncNow();
    const interval = setInterval(syncNow, 30_000);
    const net = Network.addNetworkStateListener((s) => s.isInternetReachable && syncNow());
    const app = AppState.addEventListener("change", (s) => s === "active" && syncNow());
    return () => {
      clearInterval(interval);
      net.remove();
      app.remove();
    };
  }, [syncNow]);

  const enqueue = useCallback(
    async (ops: OutboxOp[], receiptUri: string | null = null) => {
      for (const op of ops) await store.enqueue(op, op.type === "expense.create" ? receiptUri : null);
      await refreshCounts();
      void syncNow();
    },
    [refreshCounts, syncNow, store],
  );

  /** Optimistically patch a task in the cached My Day. */
  const patchTask = useCallback(
    (taskId: string, status: TaskStatus, note?: string | null) => {
      const update = (d?: MyDay) => d && { ...d, tasks: d.tasks.map((t) => (t.id === taskId ? { ...t, status, statusNote: note ?? t.statusNote } : t)) };
      qc.setQueryData(trpc.field.myDay.queryKey(), update);
      setCachedDay(update);
    },
    [qc, trpc],
  );

  /** Run a clock transition locally, then queue its ops (with a location stamp on clock/timer changes). */
  const dispatch = useCallback(
    async (event: FieldEvent, extra: OutboxOp[] = []) => {
      let result: { state: FieldState; effects: FieldEffect[] };
      try {
        result = fieldReducer(fieldRef.current, event, uuid);
      } catch (e) {
        if (e instanceof FieldError) {
          Alert.alert("Can't do that", e.message);
          return;
        }
        throw e;
      }
      await saveField(result.state);
      const needsGeo = result.effects.some((e) => e.type === "shift.clockIn" || e.type === "shift.clockOut" || e.type === "time.start");
      const geo = needsGeo ? await currentGeo() : null;
      const ops = result.effects.map((e): OutboxOp => {
        switch (e.type) {
          case "shift.clockIn":
          case "shift.clockOut":
          case "time.start":
          case "time.stop":
            return { ...e, opId: uuid(), payload: { ...e.payload, geo } } as OutboxOp;
          default:
            return { ...e, opId: uuid() };
        }
      });
      await enqueue([...ops, ...extra]);
    },
    [saveField, enqueue],
  );

  const value = useMemo<FieldCtx>(
    () => ({
      day: dayQuery.data ?? cachedDay,
      dayLoading: dayQuery.isLoading && !cachedDay,
      refresh: async () => {
        await syncNow();
        await dayQuery.refetch();
      },
      field,
      timer: field.task,
      clockIn: (projectId) => dispatch({ type: "CLOCK_IN", at: now(), projectId: projectId ?? null }),
      clockOut: () => dispatch({ type: "CLOCK_OUT", at: now() }),
      startBreak: () => dispatch({ type: "BREAK_START", at: now() }),
      endBreak: () => dispatch({ type: "BREAK_END", at: now() }),
      async start(task) {
        if (task.status === "TODO") patchTask(task.id, "IN_PROGRESS");
        await dispatch({ type: "TASK_START", at: now(), taskId: task.id, projectId: task.project.id });
      },
      stop: () => dispatch({ type: "TASK_STOP", at: now() }),
      async setStatus(task, status, note) {
        patchTask(task.id, status, note);
        const statusOp: OutboxOp = { opId: uuid(), type: "task.status", at: now(), payload: { taskId: task.id, status, note: note ?? null } };
        // Finishing or blocking the running task stops its timer (you stay clocked in).
        if (fieldRef.current.task?.taskId === task.id && status !== "IN_PROGRESS") await dispatch({ type: "TASK_STOP", at: now() }, [statusOp]);
        else await enqueue([statusOp]);
      },
      async requestMaterials(task, description, quantity) {
        const label = `${quantity ? `${quantity} × ` : ""}${description}`;
        patchTask(task.id, "NEEDS_MATERIALS", `Needs: ${label}`);
        const ops: OutboxOp[] = [
          { opId: uuid(), type: "material.request", at: now(), payload: { requestId: uuid(), taskId: task.id, description, quantity: quantity || null } },
          { opId: uuid(), type: "task.status", at: now(), payload: { taskId: task.id, status: "NEEDS_MATERIALS", note: label } },
        ];
        if (fieldRef.current.task?.taskId === task.id) await dispatch({ type: "TASK_STOP", at: now() }, ops);
        else await enqueue(ops);
      },
      async addExpense(p, receiptUri) {
        await enqueue([{ opId: uuid(), type: "expense.create", at: now(), payload: { ...p, expenseId: uuid() } }], receiptUri);
      },
      sync,
      syncNow,
      async dismissRejected(seq) {
        await store.dismiss(seq);
        await refreshCounts();
      },
    }),
    [dayQuery, cachedDay, field, sync, syncNow, patchTask, enqueue, dispatch, refreshCounts, store],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useField = () => useContext(Ctx);
