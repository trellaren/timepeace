import type { Role } from "@timepeace/shared";
import { TRPCError, initTRPC } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import type { AuthInfo, Context } from "./context";

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;

export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.auth) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { auth: ctx.auth as AuthInfo } });
});

export const MANAGER_ROLES: Role[] = ["OWNER", "MANAGER"];
export const FINANCE_ROLES: Role[] = ["OWNER", "MANAGER", "ACCOUNTANT"];
export const PAYROLL_ROLES: Role[] = ["OWNER", "HR"];

export function roleProcedure(roles: Role[]) {
  return authedProcedure.use(({ ctx, next }) => {
    if (!roles.includes(ctx.auth.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: `Requires one of: ${roles.join(", ")}` });
    }
    return next();
  });
}

export const managerProcedure = roleProcedure(MANAGER_ROLES);
export const financeProcedure = roleProcedure(FINANCE_ROLES);
export const payrollProcedure = roleProcedure(PAYROLL_ROLES);
