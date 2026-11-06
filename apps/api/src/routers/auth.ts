import { loginInput } from "@timepeace/shared";
import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { db } from "../lib/db";
import { startSession } from "../services/session";
import { authedProcedure, publicProcedure, router } from "../trpc";

// Compared against when the email doesn't exist so response timing doesn't reveal accounts.
const DUMMY_HASH = bcrypt.hashSync("timing-equalizer", 10);

export const authRouter = router({
  login: publicProcedure.input(loginInput).mutation(async ({ input }) => {
    const user = await db().user.findUnique({
      where: { email: input.email },
      include: { memberships: { where: { active: true }, include: { org: true }, orderBy: { createdAt: "asc" } } },
    });
    const ok = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
    const membership = user?.memberships[0];
    if (!user || !ok || !membership) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password" });

    return startSession(db(), user, membership);
  }),

  me: authedProcedure.query(async ({ ctx }) => {
    const org = await db().organization.findUniqueOrThrow({ where: { id: ctx.auth.orgId } });
    return {
      user: { id: ctx.auth.userId, name: ctx.auth.name, email: ctx.auth.email },
      role: ctx.auth.role,
      org: { id: org.id, name: org.name, timezone: org.timezone },
    };
  }),

  logout: authedProcedure.mutation(async ({ ctx }) => {
    await db().session.delete({ where: { id: ctx.auth.sessionId } });
    return { ok: true };
  }),
});
