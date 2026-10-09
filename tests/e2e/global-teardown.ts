import 'dotenv/config';
import { inArray, like, or } from 'drizzle-orm';
import { createDb } from '../../src/db/client';
import { dailyAssignments, drivers, routes } from '../../src/db/schema';

// Removes what the end-to-end tests create (routes coded E2E…, drivers named "E2E …") so the
// development database stays clean. Only touches rows with those test prefixes.
export default async function globalTeardown() {
  if (!process.env.DATABASE_URL) return;
  const db = createDb();
  try {
    await db.transaction(async (tx) => {
      const testRoutes = await tx.select({ id: routes.id }).from(routes).where(like(routes.code, 'E2E%'));
      const testDrivers = await tx.select({ id: drivers.id }).from(drivers).where(like(drivers.fullName, 'E2E %'));
      const routeIds = testRoutes.map((r) => r.id);
      const driverIds = testDrivers.map((d) => d.id);
      if (routeIds.length || driverIds.length) {
        await tx.delete(dailyAssignments).where(or(
          routeIds.length ? inArray(dailyAssignments.routeId, routeIds) : undefined,
          driverIds.length ? inArray(dailyAssignments.driverId, driverIds) : undefined,
        ));
      }
      if (routeIds.length) await tx.delete(routes).where(inArray(routes.id, routeIds));
      if (driverIds.length) await tx.delete(drivers).where(inArray(drivers.id, driverIds));
    });
  } finally {
    await db.$client.end();
  }
}
