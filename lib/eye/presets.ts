import type { BrushState } from '@/lib/eye/types';

export interface EyePreset {
    id: string;
    label: string;
    brushes: BrushState;
}

const atLeast = (lo: number): BrushState[string] => [{ kind: 'range', lo, hi: 100 }];

// Presets are just visible brush rules; applying one shows its chips so the user can edit them.
export const STOCK_PRESETS: EyePreset[] = [
    { id: 'growth-fair-quality', label: 'High growth + fair value + high quality', brushes: { k_growth: atLeast(70), k_value: atLeast(40), k_quality: atLeast(60) } },
    { id: 'cheap-quality', label: 'Cheap and high quality', brushes: { k_value: atLeast(60), k_quality: atLeast(60) } },
    { id: 'momentum-leaders', label: 'Momentum leaders', brushes: { k_momentum: atLeast(70) } },
    { id: 'strong-but-pricey', label: 'Strong momentum but expensive', brushes: { k_momentum: atLeast(70), k_value: [{ kind: 'range', lo: 0, hi: 30 }] } },
];

export const INDUSTRY_PRESETS: EyePreset[] = [
    { id: 'rate-sensitive', label: 'Rate-sensitive (RATE weight ≥ 25)', brushes: { w_rate: [{ kind: 'range', lo: 25, hi: 100 }] } },
    { id: 'cost-driven', label: 'Input-cost driven (COST weight ≥ 25)', brushes: { w_cost: [{ kind: 'range', lo: 25, hi: 100 }] } },
    { id: 'policy-driven', label: 'Policy driven (POLICY weight ≥ 20)', brushes: { w_policy: [{ kind: 'range', lo: 20, hi: 100 }] } },
    { id: 'demand-led', label: 'Demand led (DEM weight ≥ 30)', brushes: { w_dem: [{ kind: 'range', lo: 30, hi: 100 }] } },
];
