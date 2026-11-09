import * as Astronomy from 'astronomy-engine';

// Symbolic layer (plan: report §4.4). Positions are astronomy; the industry-to-planet table is a cultural convention,
// not evidence of any price effect. All of this module is local computation (astronomy-engine) — no network.
// The only axis that needs a remote source is a_next_event_days / a_event_count_7d (lib/eye/cosmyday.ts).

export type Planet = 'Sun' | 'Moon' | 'Mercury' | 'Venus' | 'Mars' | 'Jupiter' | 'Saturn' | 'Uranus' | 'Neptune' | 'Pluto';

const BODY: Record<Planet, Astronomy.Body> = {
    Sun: Astronomy.Body.Sun,
    Moon: Astronomy.Body.Moon,
    Mercury: Astronomy.Body.Mercury,
    Venus: Astronomy.Body.Venus,
    Mars: Astronomy.Body.Mars,
    Jupiter: Astronomy.Body.Jupiter,
    Saturn: Astronomy.Body.Saturn,
    Uranus: Astronomy.Body.Uranus,
    Neptune: Astronomy.Body.Neptune,
    Pluto: Astronomy.Body.Pluto,
};

const RETROGRADE_CAPABLE: Planet[] = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'];

const DAY_MS = 86_400_000;

// Normalise degrees into [0, 360).
export const norm360 = (deg: number): number => ((deg % 360) + 360) % 360;

// Geocentric ecliptic lon/lat from a true geodesic vector.
const geoEcliptic = (planet: Planet, date: Date) => Astronomy.Ecliptic(Astronomy.GeoVector(BODY[planet], date, true));
const geoLongitude = (planet: Planet, date: Date) => geoEcliptic(planet, date).elon;
export function eclipticLongitude(planet: Planet, date: Date): number {
    return geoLongitude(planet, date);
}

/** Geocentric ecliptic latitude in degrees. */
export function eclipticLatitude(planet: Planet, date: Date): number {
    return geoEcliptic(planet, date).elat;
}

// Observer at the Earth centre (lat/lon 0) — geocentric approximation, error << 1 arcminute for declination.
const EARTH_CENTRE = new Astronomy.Observer(0, 0, 0);

/** Apparent geocentric declination in degrees (equatorial latitude, J2000 precessed to date=false is fine here). */
export function declination(planet: Planet, date: Date): number {
    return Astronomy.Equator(BODY[planet], date, EARTH_CENTRE, false, true).dec;
}

/**
 * Apparent geocentric ecliptic speed over one day, in deg/day, wrapped to (-180, 180).
 * Negative = retrograde. Sun/Moon move forward only.
 */
export function dailySpeed(planet: Planet, date: Date): number {
    const next = new Date(date.getTime() + DAY_MS);
    return ((geoLongitude(planet, next) - geoLongitude(planet, date) + 540) % 360) - 180;
}

// Geocentric ecliptic longitude falling over one day = apparent retrograde motion. The Sun and Moon never do.
export function isRetrograde(planet: Planet, date: Date): boolean {
    if (!RETROGRADE_CAPABLE.includes(planet)) return false;
    return dailySpeed(planet, date) < 0;
}

export function retrogradePlanets(date: Date): Planet[] {
    return RETROGRADE_CAPABLE.filter((p) => isRetrograde(p, date));
}

export interface MoonState {
    phaseAngle: number; // 0 new, 90 first quarter, 180 full, 270 last quarter
    illumination: number; // 0..1
    name: string;
    /** Current lunar zodiac sign (tropical), from the Moon's geocentric ecliptic longitude. */
    sign: string;
    /** Degrees inside the current sign, 0..30. */
    signDegree: number;
    /** Degrees from exact new moon; >180 is waning. */
    ageDays: number;
}

const MOON_NAMES = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];

export function moonState(date: Date): MoonState {
    const phaseAngle = Astronomy.MoonPhase(date);
    const illumination = Astronomy.Illumination(Astronomy.Body.Moon, date).phase_fraction;
    // Eight 45-degree buckets centred on the principal phases.
    const name = MOON_NAMES[Math.floor(((phaseAngle + 22.5) % 360) / 45)];
    const moonLon = norm360(geoLongitude('Moon', date));
    const ageDays = phaseAngle / 360 * 29.53;
    return { phaseAngle, illumination, name, sign: zodiacSign(moonLon), signDegree: norm360(moonLon) % 30, ageDays };
}

// Tropical zodiac. Mirrors the traditional sign assignment used by Swiss Ephemeris calculators.
export const ZODIAC_SIGNS = [
    'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
    'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',
] as const;

export type ZodiacSign = (typeof ZODIAC_SIGNS)[number];

/** Tropical zodiac sign from a geocentric ecliptic longitude in degrees. */
export function zodiacSign(longitudeDeg: number): string {
    return ZODIAC_SIGNS[Math.floor(norm360(longitudeDeg) / 30)] ?? 'Aries';
}

/** Degrees inside the current sign, 0..30. */
export function signDegree(longitudeDeg: number): number {
    return norm360(longitudeDeg) % 30;
}

// Order matters: the first matching rule wins ("Biotechnology" must not fall into "tech").
const RULER_RULES: [Planet, RegExp][] = [
    ['Pluto', /uranium|waste|nuclear|coal|exchange/i],
    ['Neptune', /oil|gas|chemical|pharma|biotech|shipping|marine/i],
    ['Mercury', /software|telecom|communication|media|logistics|transport|airline|information|internet/i],
    ['Mars', /defen[cs]e|machinery|aerospace|engineering|automobile|auto /i],
    ['Venus', /apparel|textile|luxury|cosmetic|beauty|leisure|entertainment|hotel|restaurant|gaming|casino/i],
    ['Saturn', /real estate|mining|metal|steel|building|construction|agricultur|paper|forest/i],
    ['Jupiter', /bank|financ|insurance|capital|asset|health|medical|hospital|education|legal|life sciences/i],
    ['Moon', /food|beverage|retail|consumer|household|water|packag|distribut/i],
    ['Sun', /gold|conglomerate|government/i],
    ['Uranus', /tech|semiconductor|electronic|computer|electric|utilit|renewable|solar/i],
];

// Traditional sector-to-planet correspondence, matched against Finnhub's own industry label.
export function rulerForIndustry(industry: string | null | undefined): Planet | null {
    if (!industry) return null;
    for (const [planet, pattern] of RULER_RULES) if (pattern.test(industry)) return planet;
    return null;
}
