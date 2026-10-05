import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("./prisma", () => ({ prisma: {} }));
const { CLIP_JOBS_CHECKSUM, CLIP_JOBS_MIGRATION, CLIP_JOBS_STATEMENTS, applyClipJobsMigration } = await import("./ensureSchema");

const file = readFileSync(path.join(__dirname, "../../prisma/migrations", CLIP_JOBS_MIGRATION, "migration.sql"), "utf8");

describe("Clips self-migration", () => {
  it("runs exactly the SQL of the Prisma migration, with Prisma's checksum", () => {
    const statements = file
      .split("\n")
      .filter((l) => !l.startsWith("--"))
      .join("\n")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    expect(CLIP_JOBS_STATEMENTS.map((s) => s.trim())).toEqual(statements);
    expect(CLIP_JOBS_CHECKSUM).toBe(createHash("sha256").update(file).digest("hex"));
  });

  const fakeDb = (state: { table: boolean; enumType: boolean; tracked: boolean }) => {
    const executed: string[] = [];
    return {
      executed,
      db: {
        $queryRawUnsafe: vi.fn(async (sql: string) => {
          if (sql.includes('"ClipJob"')) return [{ exists: state.table }];
          if (sql.includes("pg_type")) return [{ hasEnum: state.enumType }];
          return [{ tracked: state.tracked }];
        }),
        $executeRawUnsafe: vi.fn(async (sql: string) => {
          executed.push(sql);
          return 0;
        }),
      },
    };
  };

  it("only (re)records the migration when the table exists", async () => {
    const { db, executed } = fakeDb({ table: true, enumType: true, tracked: true });
    await expect(applyClipJobsMigration(db as never)).resolves.toBe(false);
    expect(executed).toHaveLength(1);
    expect(executed[0]).toContain("WHERE NOT EXISTS");
  });

  it("creates everything and records the migration", async () => {
    const { db, executed } = fakeDb({ table: false, enumType: false, tracked: true });
    await expect(applyClipJobsMigration(db as never)).resolves.toBe(true);
    expect(executed).toHaveLength(5);
    expect(executed[4]).toContain("_prisma_migrations");
  });

  it("skips an enum left by a half-applied run", async () => {
    const { db, executed } = fakeDb({ table: false, enumType: true, tracked: false });
    await applyClipJobsMigration(db as never);
    expect(executed).toHaveLength(3);
    expect(executed[0]).toMatch(/^CREATE TABLE/);
  });
});
