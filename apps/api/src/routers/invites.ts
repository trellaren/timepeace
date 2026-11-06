import { acceptInviteInput } from "@timepeace/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { db } from "../lib/db";
import { acceptInvite, inviteEmail, previewInvite } from "../services/invites";
import { assertLoginAllowed, recordLoginFailure } from "../services/loginThrottle";
import { publicProcedure, router } from "../trpc";

/** Public endpoints behind the invite link. The token is the only credential. */
export const invitesRouter = router({
  preview: publicProcedure.input(z.object({ token: z.string().min(20).max(200) })).query(({ input }) => previewInvite(db(), input.token)),

  accept: publicProcedure.input(acceptInviteInput).mutation(async ({ ctx, input }) => {
    // Joining with an existing account checks its password, so it shares the sign-in limits.
    // Failures are recorded outside the transaction, which rolls back on a wrong password.
    const ip = ctx.ip ?? "unknown";
    const email = await inviteEmail(db(), input.token);
    if (email) await assertLoginAllowed(db(), email, ip);
    try {
      return await db().$transaction((tx) => acceptInvite(tx, input));
    } catch (e) {
      if (email && e instanceof TRPCError && e.code === "UNAUTHORIZED") await recordLoginFailure(db(), email, ip);
      throw e;
    }
  }),
});
