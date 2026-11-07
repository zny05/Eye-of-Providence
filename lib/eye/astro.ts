import * as Astronomy from 'astronomy-engine';

// Symbolic layer (plan: report §4.4). Positions are astronomy; the industry-to-planet table is a cultural convention,
// not evidence of any price effect.
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

const geoLongitude = (planet: Planet, date: Date) => Astronomy.Ecliptic(Astronomy.GeoVector(BODY[planet], date, true)).elon;

// Geocentric ecliptic longitude falling over one day = apparent retrograde motion. The Sun and Moon never do.
export function isRetrograde(planet: Planet, date: Date): boolean {
    if (!RETROGRADE_CAPABLE.includes(planet)) return false;
    const next = new Date(date.getTime() + 86_400_000);
    const delta = ((geoLongitude(planet, next) - geoLongitude(planet, date) + 540) % 360) - 180;
    return delta < 0;
}

export function retrogradePlanets(date: Date): Planet[] {
    return RETROGRADE_CAPABLE.filter((p) => isRetrograde(p, date));
}

export interface MoonState {
    phaseAngle: number; // 0 new, 90 first quarter, 180 full, 270 last quarter
    illumination: number; // 0..1
    name: string;
}

const MOON_NAMES = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];

export function moonState(date: Date): MoonState {
    const phaseAngle = Astronomy.MoonPhase(date);
    const illumination = Astronomy.Illumination(Astronomy.Body.Moon, date).phase_fraction;
    // Eight 45-degree buckets centred on the principal phases.
    const name = MOON_NAMES[Math.floor(((phaseAngle + 22.5) % 360) / 45)];
    return { phaseAngle, illumination, name };
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
