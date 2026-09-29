import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// Reuse one client across hot reloads in dev; each Vercel function instance gets its own.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function getClient(): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and add your Supabase URL.");
  }
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  // Cache in production too: warm serverless invocations reuse the instance and its pool.
  globalForPrisma.prisma = client;
  return client;
}

/**
 * Created on first use rather than at import, so `next build` (which imports route modules)
 * and unit tests don't need database credentials.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getClient();
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
