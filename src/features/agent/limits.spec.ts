import { describe, expect, it } from 'vitest';
import {
  agentBudgetLimits,
  BUDGET_LEVELS,
  DEFAULT_AGENT_LIMITS,
  estimateTokens,
  READING_LEVELS,
  readingHours,
} from './limits';

describe('agentBudgetLimits (D48)', () => {
  it('keeps the budgets as they were at Medium', () => {
    expect(DEFAULT_AGENT_LIMITS).toEqual({
      toolCalls: 30,
      transcriptTokens: 250_000,
      summaryTokens: 75_000,
      maxIterations: 35,
    });
  });

  it.each(BUDGET_LEVELS)('splits reading 10 : 3 at %s, using all of it', (level) => {
    const { transcriptTokens, summaryTokens } = agentBudgetLimits('medium', level);
    expect(transcriptTokens + summaryTokens).toBe(READING_LEVELS[level]);
    expect(summaryTokens / transcriptTokens).toBeCloseTo(3 / 10, 10);
  });

  it('sets the tool calls and the reading apart, with the backstop five above the calls', () => {
    expect(agentBudgetLimits('low', 'high')).toEqual({
      toolCalls: 15,
      transcriptTokens: 500_000,
      summaryTokens: 150_000,
      maxIterations: 20,
    });
    expect(agentBudgetLimits('high', 'low')).toEqual({
      toolCalls: 60,
      transcriptTokens: 125_000,
      summaryTokens: 37_500,
      maxIterations: 65,
    });
  });

  it('shows the reading levels as 10, 20 and 40 hours', () => {
    expect(BUDGET_LEVELS.map(readingHours)).toEqual([10, 20, 40]);
  });
});

describe('estimateTokens', () => {
  it('counts about 3.5 characters a token in English, German or Spanish text', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('I put them on the charger.')).toBe(Math.ceil(26 / 3.5));
    expect(estimateTokens('Lo pongo en el cargador.')).toBe(Math.ceil(24 / 3.5));
  });

  it('counts a token for each Chinese, Japanese or Korean character', () => {
    expect(estimateTokens('毎晩充電します')).toBe(7);
    expect(estimateTokens('침대 옆에서 충전해요')).toBe(Math.ceil(9 + 2 / 3.5));
    // Mixed text: the dense characters, then the rest at 3.5 a token.
    expect(estimateTokens('Oticonの充電器')).toBe(Math.ceil(4 + 6 / 3.5));
  });
});
