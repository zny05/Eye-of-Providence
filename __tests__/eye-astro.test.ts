import { describe, expect, it } from 'vitest';
import { isRetrograde, moonState, retrogradePlanets, rulerForIndustry } from '@/lib/eye/astro';

const utc = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe('retrograde detection', () => {
    // Mercury stations: retrograde 2025-03-15 to 2025-04-07 and 2025-11-09 to 2025-11-29.
    it('flags Mercury inside and outside its 2025 retrograde windows', () => {
        expect(isRetrograde('Mercury', utc('2025-03-25'))).toBe(true);
        expect(isRetrograde('Mercury', utc('2025-11-20'))).toBe(true);
        expect(isRetrograde('Mercury', utc('2025-05-15'))).toBe(false);
        expect(isRetrograde('Mercury', utc('2025-09-01'))).toBe(false);
    });

    it('never reports the Sun or Moon as retrograde', () => {
        expect(isRetrograde('Sun', utc('2025-03-25'))).toBe(false);
        expect(isRetrograde('Moon', utc('2025-03-25'))).toBe(false);
    });

    it('lists retrograde planets', () => {
        expect(retrogradePlanets(utc('2025-03-25'))).toContain('Mercury');
        expect(retrogradePlanets(utc('2025-03-25'))).not.toContain('Sun' as never);
    });
});

describe('moonState', () => {
    it('matches known new and full moons', () => {
        expect(moonState(new Date('2025-01-29T12:36:00Z')).name).toBe('New moon');
        expect(moonState(new Date('2025-01-29T12:36:00Z')).illumination).toBeLessThan(0.01);
        expect(moonState(new Date('2025-02-12T13:53:00Z')).name).toBe('Full moon');
        expect(moonState(new Date('2025-02-12T13:53:00Z')).illumination).toBeGreaterThan(0.99);
    });

    it('names a waxing phase between new and full', () => {
        expect(moonState(new Date('2025-02-05T12:00:00Z')).name).toMatch(/^(Waxing|First)/);
    });
});

describe('rulerForIndustry', () => {
    it('maps by convention and keeps biotech out of the generic tech rule', () => {
        expect(rulerForIndustry('Biotechnology')).toBe('Neptune');
        expect(rulerForIndustry('Technology')).toBe('Uranus');
        expect(rulerForIndustry('Banking')).toBe('Jupiter');
        expect(rulerForIndustry('Retail')).toBe('Moon');
        expect(rulerForIndustry('Metals & Mining')).toBe('Saturn');
        expect(rulerForIndustry('Software')).toBe('Mercury');
    });

    it('returns null when nothing matches', () => {
        expect(rulerForIndustry('Zzz')).toBeNull();
        expect(rulerForIndustry(null)).toBeNull();
    });
});
