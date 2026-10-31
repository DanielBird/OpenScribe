// What Claude returns for one session (PROJECTS.md §5.3). The descriptions reach the model through the JSON schema.
// Counts and lengths are left to the prompt and `check.ts`: structured outputs don't support them in the schema.
import type { SessionSummary } from '../../domain/summary';
import { z } from '../../lib/zod';

/**
 * Describes an array or a union without copying it. `.describe()` returns a copy that shares its inner schemas,
 * and zod then moves them into `$defs` behind `$ref`s; an inline schema is easier for the model to read.
 */
function described<T extends z.ZodType>(schema: T, description: string): T {
  z.globalRegistry.add(schema as z.ZodType, { description });
  return schema;
}

const turnIds = () =>
  described(z.array(z.string()), 'Ids of the turns that show this, e.g. "t12".');

const quotes = () =>
  described(
    z.array(
      z.object({
        turnId: z.string().describe('The one turn the quote is copied from.'),
        text: z.string().describe('Word for word; " … " marks words left out.'),
      }),
    ),
    "Up to 2 passages of the respondents' own words that support this; none if no passage does.",
  );

export const SummaryOutputSchema = z.object({
  title: z.string().describe('Under 80 characters.'),
  synopsis: z.string().describe('2–3 sentences.'),
  overview: z.string().describe('250–500 words.'),
  respondents: described(
    z.array(
      z.object({
        speakerId: described(
          z.string().nullable(),
          'The id from the Speakers line, or null for someone who is only mentioned.',
        ),
        label: z.string().describe('Their speaker label, exactly as written.'),
        attributes: described(
          z.array(
            z.object({
              field: z
                .string()
                .describe("A metadata field from the brief, or another detail's name."),
              value: z.string().describe('As the session states or clearly implies it.'),
              turnIds: turnIds(),
            }),
          ),
          "The brief's metadata fields first, then other details that matter.",
        ),
      }),
    ),
    'The people interviewed or observed, not the researchers.',
  ),
  researchQuestions: described(
    z.array(
      z.object({
        question: z.string().describe("The brief's wording."),
        finding: z.string().describe('What this session shows about the question.'),
        turnIds: turnIds(),
        quotes: quotes(),
      }),
    ),
    'One per research question in the brief, in its order.',
  ),
  themes: described(
    z.array(
      z.object({
        name: z.string().describe("Short; a name from the project's theme list if one fits."),
        description: z.string().describe('What the theme covers in this session.'),
        turnIds: turnIds(),
        isNew: z.boolean().describe('False when the name is one the project already uses.'),
        quotes: quotes(),
      }),
    ),
    '4–10 themes.',
  ),
}) satisfies z.ZodType<SessionSummary>;
