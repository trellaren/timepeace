import { acceptInviteInput } from "@timepeace/shared";
import { z } from "zod";
import { db } from "../lib/db";
import { acceptInvite, previewInvite } from "../services/invites";
import { publicProcedure, router } from "../trpc";

/** Public endpoints behind the invite link. The token is the only credential. */
export const invitesRouter = router({
  preview: publicProcedure.input(z.object({ token: z.string().min(20).max(200) })).query(({ input }) => previewInvite(db(), input.token)),
  accept: publicProcedure.input(acceptInviteInput).mutation(({ input }) => db().$transaction((tx) => acceptInvite(tx, input))),
});
