import { db } from "../lib/db";
import { portfolioInsights } from "../services/jobCost";
import { financeProcedure, router } from "../trpc";

export const financeRouter = router({
  portfolio: financeProcedure.query(({ ctx }) => portfolioInsights(db(), ctx.auth.orgId)),
});
