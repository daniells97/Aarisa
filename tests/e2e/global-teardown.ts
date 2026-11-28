import 'dotenv/config';
import { and, eq, inArray, like, or } from 'drizzle-orm';
import { createDb } from '../../src/db/client';
import {
  clientContacts, clients, operations, rateAgreements, rates, reportLayoutColumns, reportLayouts, revenueTypes, serviceTiers, serviceTypes,
  driverAffiliations, payAdjustments, driverAliases, driverClientCodes, drivers, payees, routeExecutions, routeOwnerships, routes, workRecords,
} from '../../src/db/schema';

// Removes what the end-to-end tests create (routes coded E2E…, drivers named "E2E …") so the
// development database stays clean. Only touches rows with those test prefixes.
export default async function globalTeardown() {
  if (!process.env.DATABASE_URL) return;
  const db = createDb();
  try {
    // Clients the new-client test creates (codes start with e2e_): their contract and everything set up for it.
    await db.transaction(async (tx) => {
      const ops = await tx.select({ id: operations.id, clientId: operations.clientId }).from(operations).where(like(operations.code, 'e2e%'));
      for (const op of ops) {
        const layouts = await tx.select({ id: reportLayouts.id }).from(reportLayouts).where(eq(reportLayouts.operationId, op.id));
        if (layouts.length) await tx.delete(reportLayoutColumns).where(inArray(reportLayoutColumns.layoutId, layouts.map((l) => l.id)));
        await tx.delete(reportLayouts).where(eq(reportLayouts.operationId, op.id));
        const svcs = await tx.select({ id: serviceTypes.id }).from(serviceTypes).where(eq(serviceTypes.operationId, op.id));
        if (svcs.length) {
          await tx.delete(rates).where(inArray(rates.serviceTypeId, svcs.map((x) => x.id)));
          await tx.delete(serviceTiers).where(inArray(serviceTiers.serviceTypeId, svcs.map((x) => x.id)));
        }
        await tx.delete(rateAgreements).where(eq(rateAgreements.operationId, op.id));
        await tx.delete(serviceTypes).where(eq(serviceTypes.operationId, op.id));
        await tx.delete(revenueTypes).where(eq(revenueTypes.operationId, op.id));
        await tx.delete(operations).where(eq(operations.id, op.id));
        await tx.delete(clientContacts).where(eq(clientContacts.clientId, op.clientId));
        await tx.delete(clients).where(eq(clients.id, op.clientId));
      }
    });
    await db.transaction(async (tx) => {
      const testRoutes = await tx.select({ id: routes.id }).from(routes).where(like(routes.code, 'E2E%'));
      const testDrivers = await tx.select({ id: drivers.id, payeeId: drivers.payeeId }).from(drivers).innerJoin(payees, eq(payees.id, drivers.payeeId))
        .where(and(eq(payees.payeeType, 'driver'), like(payees.displayName, 'E2E %')));
      const routeIds = testRoutes.map((r) => r.id);
      const driverIds = testDrivers.map((d) => d.id);
      if (routeIds.length || driverIds.length) {
        const ex = await tx.select({ id: routeExecutions.id }).from(routeExecutions).where(or(
          routeIds.length ? inArray(routeExecutions.routeId, routeIds) : undefined,
          driverIds.length ? inArray(routeExecutions.payeeId, testDrivers.map((d) => d.payeeId)) : undefined,
        ));
        if (ex.length) {
          await tx.delete(workRecords).where(inArray(workRecords.executionId, ex.map((e) => e.id)));
          await tx.delete(payAdjustments).where(inArray(payAdjustments.executionId, ex.map((e) => e.id)));
          await tx.delete(routeExecutions).where(inArray(routeExecutions.id, ex.map((e) => e.id)));
        }
      }
      if (routeIds.length) {
        await tx.delete(routeOwnerships).where(inArray(routeOwnerships.routeId, routeIds));
        await tx.delete(routes).where(inArray(routes.id, routeIds));
      }
      if (driverIds.length) {
        await tx.update(routes).set({ usualDriverId: null }).where(inArray(routes.usualDriverId, driverIds));
        for (const t of [driverAliases, driverClientCodes, driverAffiliations]) await tx.delete(t).where(inArray(t.driverId, driverIds));
        await tx.delete(drivers).where(inArray(drivers.id, driverIds));
        await tx.delete(payees).where(inArray(payees.id, testDrivers.map((d) => d.payeeId)));
      }
    });
  } finally {
    await db.$client.end();
  }
}
