import { describe, it, expect } from "vitest";
import { callAIProvider, type AIProviderName } from "@/lib/ai-provider";

/**
 * Integration tests for AI providers.
 *
 * The suite follows the provider configured in .env (AI_PROVIDER, default
 * "gemini") and only runs tests for that provider, skipping all others.
 * These tests call real APIs and require valid API keys in environment.
 * Run with: npx vitest run __tests__/ai-provider.integration.test.ts
 */

const configuredProvider = ((process.env.AI_PROVIDER as AIProviderName) || "gemini") as AIProviderName;

function hasKey(provider: AIProviderName): boolean {
    switch (provider) {
        case "gemini":
            return Boolean(process.env.GEMINI_API_KEY);
        case "minimax":
            return Boolean(process.env.MINIMAX_API_KEY);
        case "siray":
            return Boolean(process.env.SIRAY_API_KEY);
        case "openrouter":
            return Boolean(process.env.OPENROUTER_API_KEY);
    }
}

describe.skipIf(configuredProvider !== "gemini" || !hasKey("gemini"))(
    "Gemini integration",
    () => {
        it("generates a response from Gemini", async () => {
            const result = await callAIProvider("Reply with exactly: GEMINI_OK", "gemini");
            expect(result).toBeTruthy();
            expect(typeof result).toBe("string");
            expect(result.length).toBeGreaterThan(0);
        }, 30_000);
    }
);

describe.skipIf(configuredProvider !== "minimax" || !hasKey("minimax"))(
    "MiniMax integration",
    () => {
        it("generates a response from the configured MiniMax model", async () => {
            const result = await callAIProvider(
                "Reply with exactly: MINIMAX_OK",
                "minimax"
            );
            expect(result).toBeTruthy();
            expect(typeof result).toBe("string");
            expect(result.length).toBeGreaterThan(0);
        }, 30_000);

        it("handles a longer prompt", async () => {
            const result = await callAIProvider(
                "Summarize in one sentence: The stock market is a platform for buying and selling shares of publicly traded companies.",
                "minimax"
            );
            expect(result).toBeTruthy();
            expect(typeof result).toBe("string");
            expect(result.length).toBeGreaterThan(10);
        }, 30_000);

        it("generates HTML content for email personalization", async () => {
            const result = await callAIProvider(
                'Generate a single HTML <p> tag with a brief personalized welcome message for a tech investor. Return only the HTML, no markdown.',
                "minimax"
            );
            expect(result).toBeTruthy();
            expect(typeof result).toBe("string");
            expect(result.length).toBeGreaterThan(0);
        }, 30_000);
    }
);

describe.skipIf(configuredProvider !== "siray" || !hasKey("siray"))(
    "Siray integration",
    () => {
        it("generates a response from Siray", async () => {
            const result = await callAIProvider("Reply with exactly: SIRAY_OK", "siray");
            expect(result).toBeTruthy();
            expect(typeof result).toBe("string");
            expect(result.length).toBeGreaterThan(0);
        }, 30_000);
    }
);

describe.skipIf(configuredProvider !== "openrouter" || !hasKey("openrouter"))(
    "OpenRouter integration",
    () => {
        it("generates a response from OpenRouter", async () => {
            const result = await callAIProvider(
                "Reply with exactly: OPENROUTER_OK",
                "openrouter"
            );
            expect(result).toBeTruthy();
            expect(typeof result).toBe("string");
            expect(result.length).toBeGreaterThan(0);
        }, 30_000);
    }
);
