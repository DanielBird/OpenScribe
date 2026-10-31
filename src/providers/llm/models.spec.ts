import { describe, expect, it } from 'vitest';
import {
  estimateCostUsd,
  isProjectModel,
  PROJECT_MODELS,
  projectModelLabel,
  projectProviderOf,
} from './models';

const usage = {
  inputTokens: 100_000,
  outputTokens: 10_000,
  cacheReadTokens: 1_000_000,
  cacheWriteTokens: 50_000,
};

describe('estimateCostUsd', () => {
  it('prices Sonnet 5.5 and Opus 5.5 usage', () => {
    // 0.1 × $2 + 0.01 × $10 + 1 × $0.20 + 0.05 × $2.50
    expect(estimateCostUsd('claude-sonnet-5-5', usage)).toBeCloseTo(0.625, 10);
    // 0.1 × $4 + 0.01 × $20 + 1 × $0.20 + 0.05 × $5
    expect(estimateCostUsd('claude-opus-5-5', usage)).toBeCloseTo(1.05, 10);
  });

  it('prices Gemini 3.8 Flash and Gemini 4 Argon usage, with no cache writes', () => {
    const gemini = { ...usage, cacheWriteTokens: 0 };
    // 0.1 × $1.50 + 0.01 × $7.50 + 1 × $0.15
    expect(estimateCostUsd('gemini-3.8-flash', gemini)).toBeCloseTo(0.375, 10);
    // 0.1 × $4 + 0.01 × $20 + 1 × $0.20
    expect(estimateCostUsd('gemini-4-argon', gemini)).toBeCloseTo(0.8, 10);
  });

  it('prices every project model', () => {
    for (const { id } of PROJECT_MODELS.options) expect(estimateCostUsd(id, usage)).not.toBeNull();
  });

  it('has no price for an unknown model', () => {
    expect(estimateCostUsd('gemini-9-ultra', usage)).toBeNull();
  });
});

describe('project models', () => {
  it.each([
    ['claude-sonnet-5-5', 'claude', 'Sonnet 5.5'],
    ['claude-opus-5-5', 'claude', 'Opus 5.5'],
    ['gemini-3.8-flash', 'gemini', 'Gemini 3.8 Flash'],
    ['gemini-4-argon', 'gemini', 'Gemini 4 Argon'],
  ] as const)('%s is a %s model labelled "%s"', (id, provider, label) => {
    expect(isProjectModel(id)).toBe(true);
    expect(projectProviderOf(id)).toBe(provider);
    expect(projectModelLabel(id)).toBe(label);
  });

  it('lists exactly those, with Sonnet 5.5 the default', () => {
    expect(PROJECT_MODELS.options.map((o) => o.id)).toEqual([
      'claude-sonnet-5-5',
      'claude-opus-5-5',
      'gemini-3.8-flash',
      'gemini-4-argon',
    ]);
    expect(PROJECT_MODELS.default).toBe('claude-sonnet-5-5');
  });

  it('reads an unknown id as Claude, labelled with the id itself', () => {
    expect(isProjectModel('gemini-9-ultra')).toBe(false);
    expect(projectProviderOf('gemini-9-ultra')).toBe('claude');
    expect(projectModelLabel('gemini-9-ultra')).toBe('gemini-9-ultra');
  });
});
