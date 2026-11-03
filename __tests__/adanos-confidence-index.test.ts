import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    aggregateMci,
    type MciWeights,
    DEFAULT_MCI_WEIGHTS,
} from '@/lib/adanos/confidence-index';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('aggregateMci', () => {
    it('returns null when no sources have any data', () => {
        const result = aggregateMci([]);
        expect(result.mci).toBeNull();
        expect(result.sources).toBe(0);
    });

    it('computes MCI from sentiment-only sources', () => {
        const signals = [
            {
                source: 'reddit',
                buzzChange: null,
                sentiment: 0.6,
                prediction: null,
            },
            {
                source: 'news',
                buzzChange: null,
                sentiment: -0.2,
                prediction: null,
            },
        ];

        const result = aggregateMci(signals);

        // attention has no data → dropped; prediction has no data → dropped.
        // Only sentiment remains, weight renormalised to 1.
        expect(result.components.sentiment.value).toBeCloseTo(0.2, 6);
        expect(result.components.sentiment.weight).toBe(1);
        expect(result.components.attention.value).toBeNull();
        expect(result.components.prediction.value).toBeNull();
        expect(result.mci).toBeCloseTo(50 + 50 * 0.2, 6); // 60
        expect(result.sources).toBe(2);
    });

    it('computes MCI with attention, sentiment and prediction', () => {
        const signals = [
            {
                source: 'reddit',
                buzzChange: 0.5,
                sentiment: 0.4,
                prediction: null,
            },
            {
                source: 'polymarket',
                buzzChange: null,
                sentiment: null,
                prediction: 0.2,
            },
        ];

        const result = aggregateMci(signals, DEFAULT_MCI_WEIGHTS);

        // attention=0.5 w=0.2, sentiment=0.4 w=0.4, prediction=0.2 w=0.4
        // weighted = 0.1 + 0.16 + 0.08 = 0.34 → MCI = 50 + 17 = 67
        expect(result.components.attention.value).toBe(0.5);
        expect(result.components.sentiment.value).toBe(0.4);
        expect(result.components.prediction.value).toBe(0.2);
        expect(result.mci).toBeCloseTo(67, 6);
    });

    it('clamps the weighted sum to [-1, 1]', () => {
        const signals = [
            {
                source: 'reddit',
                buzzChange: 1,
                sentiment: 1,
                prediction: null,
            },
            {
                source: 'polymarket',
                buzzChange: null,
                sentiment: null,
                prediction: 1,
            },
        ];

        const result = aggregateMci(signals, DEFAULT_MCI_WEIGHTS);
        expect(result.mci).toBeCloseTo(100, 6); // clamped at max
    });

    it('normalises weights when only some components are present', () => {
        const weights: MciWeights = { attention: 0.5, sentiment: 0.3, prediction: 0.2 };
        const signals = [
            {
                source: 'reddit',
                buzzChange: 1,
                sentiment: null,
                prediction: null,
            },
        ];

        const result = aggregateMci(signals, weights);
        // Only attention present → weight renormalised to 1.
        expect(result.components.attention.weight).toBe(1);
        expect(result.components.sentiment.weight).toBe(0);
        expect(result.components.prediction.weight).toBe(0);
        expect(result.mci).toBeCloseTo(100, 6);
    });

    it('averages multiple signals per component', () => {
        const signals = [
            {
                source: 'reddit',
                buzzChange: null,
                sentiment: 0.8,
                prediction: null,
            },
            {
                source: 'x',
                buzzChange: null,
                sentiment: 0.0,
                prediction: null,
            },
            {
                source: 'news',
                buzzChange: null,
                sentiment: -0.8,
                prediction: null,
            },
        ];

        const result = aggregateMci(signals);
        expect(result.components.sentiment.value).toBeCloseTo(0, 6);
        expect(result.components.sentiment.contributing).toBe(3);
        expect(result.mci).toBeCloseTo(50, 6);
    });

    it('ignores null signals when averaging a component', () => {
        const signals = [
            {
                source: 'reddit',
                buzzChange: null,
                sentiment: 1,
                prediction: null,
            },
            {
                source: 'x',
                buzzChange: null,
                sentiment: null,
                prediction: null,
            },
        ];

        const result = aggregateMci(signals);
        expect(result.components.sentiment.value).toBe(1);
        expect(result.components.sentiment.contributing).toBe(1);
    });
});
