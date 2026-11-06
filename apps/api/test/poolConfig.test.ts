import { poolConfig } from "@timepeace/db";
import { describe, expect, it } from "vitest";

describe("database TLS config", () => {
  it("verifies Supabase hosts against the Supabase root CA and drops URL sslmode overrides", () => {
    const c = poolConfig("postgresql://postgres.ref:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require&uselibpqcompat=true");
    expect(c.ssl?.rejectUnauthorized).toBe(true);
    expect(c.ssl?.ca).toContain("BEGIN CERTIFICATE");
    expect(c.connectionString).not.toMatch(/sslmode|uselibpqcompat/);
    expect(poolConfig("postgresql://u:p@db.ref.supabase.co:5432/postgres").ssl).toBeDefined();
  });

  it("leaves other hosts alone", () => {
    const url = "postgresql://timepeace@localhost:5433/timepeace_test?sslmode=disable";
    expect(poolConfig(url)).toEqual({ connectionString: url });
  });
});
