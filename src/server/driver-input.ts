import { z } from 'zod';

/** What the driver form sends, from Drivers and rates and from Daily operations alike. */
export const driverInput = z.object({
  fullName: z.string().max(120),
  hovershipCode: z.string().max(20).nullable(),
  contractorId: z.string().uuid().nullable(),
  phone: z.string().max(30).nullable(),
  aliases: z.array(z.string().max(80)).max(20),
  active: z.boolean(),
  worksTforce: z.boolean().optional(),
  worksHovership: z.boolean().optional(),
  email: z.string().max(200).nullable().optional(),
  address: z.string().max(300).nullable().optional(),
  legalName: z.string().max(160).nullable().optional(),
  licenseNumber: z.string().max(40).nullable().optional(),
  emergencyName: z.string().max(120).nullable().optional(),
  emergencyPhone: z.string().max(30).nullable().optional(),
});
