"use client";

import type { RouterOutputs } from "@timepeace/api-client";
import { useEffect, useRef } from "react";
import { TaskDiscussion } from "./TaskDiscussion";
import { StatusBadge } from "./ui";

type Task = RouterOutputs["projects"]["get"]["tasks"][number];

/**
 * A task's details and discussion in a side panel over the project page. Its URL is
 * /projects/[id]?task=[taskId], so a manager can send someone straight to it.
 */
export function TaskPanel({ task, phaseName, showDiscussion, onClose }: { task: Task; phaseName: string | null; showDiscussion: boolean; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector('[aria-label="Photo"]') && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end" style={{ background: "rgb(0 0 0 / 0.35)" }} onClick={onClose}>
      <aside role="dialog" aria-modal aria-label={`Task: ${task.title}`} className="flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-line bg-canvas shadow-xl" onClick={(e) => e.stopPropagation()}>
        <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-line bg-surface px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-ink">{task.title}</h2>
            <p className="mt-0.5 text-sm text-muted">
              {[phaseName, task.costCode && `${task.costCode.code} ${task.costCode.name}`, task.estimatedMinutes ? `${Math.round(task.estimatedMinutes / 60)} hrs est.` : null].filter(Boolean).join(" · ")}
            </p>
          </div>
          <button ref={close} onClick={onClose} aria-label="Close" className="rounded-md px-2 py-1 text-lg leading-none text-muted hover:bg-surface-3 hover:text-ink">
            ×
          </button>
        </header>

        <div className="space-y-2 border-b border-line bg-surface px-5 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={task.status} />
            {task.assignments.length > 0 ? (
              <span className="text-ink-2">{task.assignments.map((a) => a.user.name).join(", ")}</span>
            ) : (
              <span className="text-muted">Not assigned</span>
            )}
          </div>
          {task.statusNote && <p className="text-warning-ink">{task.statusNote}</p>}
          {task.description && <p className="whitespace-pre-wrap text-ink-2">{task.description}</p>}
          {task.materialRequests.map((m) => (
            <p key={m.id} className="text-xs text-muted">
              Needs: {m.quantity ? `${m.quantity} × ` : ""}
              {m.description} <StatusBadge status={m.status} />
            </p>
          ))}
        </div>

        <div className="flex-1 px-5 py-4">
          {showDiscussion ? (
            <>
              <h3 className="mb-3 text-sm font-semibold text-ink">Discussion</h3>
              <TaskDiscussion taskId={task.id} />
            </>
          ) : (
            <p className="text-sm text-muted">Task discussions are for the crew and managers.</p>
          )}
        </div>
      </aside>
    </div>
  );
}
