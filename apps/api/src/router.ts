import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { approvalsRouter } from "./routers/approvals";
import { discussionRouter } from "./routers/discussion";
import { authRouter } from "./routers/auth";
import { fieldRouter } from "./routers/field";
import { financeRouter } from "./routers/finance";
import { orgRouter } from "./routers/org";
import { payrollRouter } from "./routers/payroll";
import { projectsRouter } from "./routers/projects";
import { tasksRouter } from "./routers/tasks";
import { taxRouter } from "./routers/tax";
import { invitesRouter } from "./routers/invites";
import { teamRouter } from "./routers/team";
import { router } from "./trpc";

export const appRouter = router({
  auth: authRouter,
  org: orgRouter,
  projects: projectsRouter,
  tasks: tasksRouter,
  field: fieldRouter,
  approvals: approvalsRouter,
  payroll: payrollRouter,
  finance: financeRouter,
  tax: taxRouter,
  team: teamRouter,
  invites: invitesRouter,
  discussion: discussionRouter,
});

export type AppRouter = typeof appRouter;
export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;
