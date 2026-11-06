-- CreateTable
CREATE TABLE "LoginThrottle" (
    "key" TEXT NOT NULL,
    "failures" INTEGER NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "lockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoginThrottle_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "LoginThrottle_updatedAt_idx" ON "LoginThrottle"("updatedAt");

-- Keep new tables closed to Supabase's Data API roles (see 20261106070000_supabase_lockdown).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'ALTER TABLE public."LoginThrottle" ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON public."LoginThrottle" FROM anon, authenticated';
  END IF;
END
$$;
