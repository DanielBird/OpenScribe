/**
 * A graphics card's label wherever DeScribe names it: Settings' **Run on**, a failure's message and **Ran on**. The
 * first card with a name is the name alone; a later one with the same name gets its place, "NVIDIA RTX A2000 (2)", so
 * two identical cards can be told apart (Phase 37; audit GPU-6). `nth` counts the earlier cards with that name, from 0.
 */
export function cardLabel(card: { name: string; nth: number }): string {
  return card.nth === 0 ? card.name : `${card.name} (${card.nth + 1})`;
}
