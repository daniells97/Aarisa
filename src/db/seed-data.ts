// Master data for a fresh database. Rates come from docs/spec.md §5.1 (open question 1).
export const RATES_EFFECTIVE_FROM = '2026-06-01';

export const OPERATIONS = [
  { code: 'hovership', name: 'Hovership', payCycle: 'biweekly', cycleAnchor: '2026-06-08', paymentTermsDays: 21 },
  { code: 'tforce', name: 'T-Force', payCycle: 'weekly', cycleAnchor: '2026-06-15', paymentTermsDays: 30 },
] as const;

type Unit = 'package' | 'stop' | 'piece' | 'job';
export const SERVICE_TYPES: {
  operation: 'hovership' | 'tforce'; code: string; name: string; nameEs: string; unit: Unit;
  fromReport: boolean; requiresOrderNumber?: boolean; requiresNote?: boolean;
}[] = [
  { operation: 'hovership', code: 'hovership_packages', nameEs: 'Paquetes Hovership', name: 'Hovership packages', unit: 'package', fromReport: true },
  { operation: 'hovership', code: 'stat', nameEs: 'Parada stat', name: 'Stat stop', unit: 'stop', fromReport: true },
  { operation: 'hovership', code: 'pharma_pickup', nameEs: 'Recogida de farmacia', name: 'Pharma pickup', unit: 'job', fromReport: false },
  { operation: 'tforce', code: 'ecommerce', nameEs: 'E-commerce', name: 'E-commerce', unit: 'piece', fromReport: true },
  { operation: 'tforce', code: 'pickup', nameEs: 'Pickup', name: 'Pickup', unit: 'job', fromReport: false },
  { operation: 'tforce', code: 'grainger', nameEs: 'Grainger', name: 'Grainger', unit: 'job', fromReport: false },
  { operation: 'tforce', code: 'recovery_route', nameEs: 'Ruta de recuperación', name: 'Recovery route', unit: 'job', fromReport: false, requiresOrderNumber: true },
  { operation: 'tforce', code: 'other', nameEs: 'Otro', name: 'Other', unit: 'job', fromReport: false, requiresNote: true },
];

export const RATES: { service: string; tier: 't1_3' | 't4' | null; client: number | null; driver: number | null }[] = [
  { service: 'hovership_packages', tier: 't1_3', client: 300, driver: 250 },
  { service: 'hovership_packages', tier: 't4', client: 200, driver: 175 },
  { service: 'stat', tier: null, client: 1000, driver: 500 },
  { service: 'pharma_pickup', tier: null, client: 5000, driver: null }, // driver rate to confirm
];

export const CONTRACTORS = ['Puma'];
