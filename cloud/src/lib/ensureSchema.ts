import { prisma } from "./prisma";

/**
 * Self-applying migration for the Clips table.
 *
 * Production deploys only run `prisma migrate deploy` when the Vercel build command was
 * overridden as the guide describes; without it a new table is simply missing and the page
 * crashes. This creates it on first use instead, with exactly the SQL of
 * prisma/migrations/20261006090000_clip_jobs (a test keeps the two identical), and records the
 * migration the way Prisma does so a later `migrate deploy` skips it.
 */

export const CLIP_JOBS_MIGRATION = "20261006090000_clip_jobs";
export const CLIP_JOBS_CHECKSUM = "1d3451cc9c31692c5bce9291b4614fa101360a37884ccdfbb6d531e2ee7e9d0b";

export const CLIP_JOBS_STATEMENTS = [
  `CREATE TYPE "ClipJobStatus" AS ENUM ('REVIEW', 'RENDERING', 'DONE', 'FAILED')`,
  `CREATE TABLE "ClipJob" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "sourceTitle" TEXT NOT NULL,
    "durationSeconds" INTEGER,
    "status" "ClipJobStatus" NOT NULL DEFAULT 'REVIEW',
    "moments" JSONB NOT NULL,
    "layout" TEXT NOT NULL DEFAULT 'crop',
    "burnCaptions" BOOLEAN NOT NULL DEFAULT true,
    "momentSource" TEXT NOT NULL DEFAULT 'transcript',
    "renderRunId" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClipJob_pkey" PRIMARY KEY ("id")
)`,
  `CREATE INDEX "ClipJob_channelId_createdAt_idx" ON "ClipJob"("channelId", "createdAt")`,
  `ALTER TABLE "ClipJob" ADD CONSTRAINT "ClipJob_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
];

type Db = Pick<typeof prisma, "$queryRawUnsafe" | "$executeRawUnsafe">;

/** Returns true when it created the table. Recording the migration is retried on every call. */
export async function applyClipJobsMigration(db: Db = prisma): Promise<boolean> {
  const [{ exists }] = await db.$queryRawUnsafe<Array<{ exists: boolean }>>(`SELECT to_regclass('public."ClipJob"') IS NOT NULL AS "exists"`);
  if (!exists) await createClipJobTable(db);
  await recordMigration(db);
  return !exists;
}

async function createClipJobTable(db: Db) {
  const [{ hasEnum }] = await db.$queryRawUnsafe<Array<{ hasEnum: boolean }>>(
    `SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ClipJobStatus') AS "hasEnum"`,
  );
  // One statement per call: the Supabase transaction pooler rejects multi-statement queries.
  for (const [i, sql] of CLIP_JOBS_STATEMENTS.entries()) {
    if (i === 0 && hasEnum) continue;
    await db.$executeRawUnsafe(sql);
  }
}

async function recordMigration(db: Db) {
  const [{ tracked }] = await db.$queryRawUnsafe<Array<{ tracked: boolean }>>(`SELECT to_regclass('public."_prisma_migrations"') IS NOT NULL AS "tracked"`);
  if (tracked) {
    await db.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       SELECT gen_random_uuid()::text, $1::varchar, now(), $2::varchar, NULL, NULL, now(), 1
       WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $2::varchar)`,
      CLIP_JOBS_CHECKSUM,
      CLIP_JOBS_MIGRATION,
    );
  }
}

let ready: Promise<unknown> | null = null;

/** Make sure the Clips table exists; cheap after the first call in a server instance. */
export function ensureClipSchema(): Promise<unknown> {
  ready ??= applyClipJobsMigration().catch((error) => {
    ready = null; // try again on the next request
    throw error;
  });
  return ready;
}
