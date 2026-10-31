import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { describe, expect, it } from 'vitest';
import { z } from '../../lib/zod';
import { SummaryOutputSchema } from './schema';

type Node = Record<string, unknown>;

/** Every schema object in `schema`, with its path. */
function nodes(schema: unknown, path = '$'): { path: string; node: Node }[] {
  if (typeof schema !== 'object' || schema === null) return [];
  if (Array.isArray(schema)) return schema.flatMap((s, i) => nodes(s, `${path}[${i}]`));
  const node = schema as Node;
  return [
    { path, node },
    ...Object.entries(node).flatMap(([key, value]) => nodes(value, `${path}.${key}`)),
  ];
}

/** Keywords that Claude's structured outputs don't support (the `claude-api` skill). */
const UNSUPPORTED = [
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'maxItems',
  'uniqueItems',
  'pattern',
  'patternProperties',
];

describe('SummaryOutputSchema', () => {
  it('uses no keyword that structured outputs reject', () => {
    const found = nodes(z.toJSONSchema(SummaryOutputSchema)).flatMap(({ path, node }) =>
      UNSUPPORTED.filter((k) => k in node).map((k) => `${path}.${k}`),
    );
    expect(found).toEqual([]);
  });

  it('sends an inline schema with closed objects and a description on every field', () => {
    const sent = betaZodOutputFormat(SummaryOutputSchema).schema;
    const all = nodes(sent);
    const text = JSON.stringify(sent);
    expect(text).not.toMatch(/\$ref|\$defs|minItems/);
    // A type list counts towards the API's limit of 16 union-typed fields per request; this is the only one.
    expect(text).toContain('"speakerId":{"type":["string","null"]');
    expect(text.match(/"type":\[|"anyOf"/g)).toHaveLength(1);

    const objects = all.filter(({ node }) => node.type === 'object');
    // The summary, a respondent, an attribute, a finding, a theme, and a quote under each of the last two.
    expect(objects).toHaveLength(7);
    for (const { path, node } of objects) expect(node.additionalProperties, path).toBe(false);

    const undescribed = objects.flatMap(({ path, node }) =>
      Object.entries(node.properties as Record<string, Node>)
        .filter(([, field]) => typeof field.description !== 'string')
        .map(([name]) => `${path}.${name}`),
    );
    expect(undescribed).toEqual([]);
  });

  it('accepts a reply with a respondent who is only mentioned', () => {
    const reply = {
      title: 'P07 – home visit, Hamburg',
      synopsis: 'A visit.',
      overview: 'Long text.',
      respondents: [{ speakerId: null, label: 'Her husband', attributes: [] }],
      researchQuestions: [],
      themes: [],
    };
    expect(SummaryOutputSchema.parse(reply)).toEqual(reply);
  });
});
