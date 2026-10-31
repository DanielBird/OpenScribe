// The only place that imports 'zod' directly (enforced by ESLint). See DECISIONS.md T8.
// zod 4 compiles object parsers with `new Function` and probes for eval support when an object schema is
// *constructed*. Our CSP forbids eval, so the probe would log a CSP violation. Turning on jitless mode here,
// before any schema module is evaluated, avoids the probe. Every schema module imports `z` from this file,
// so this always runs first.
import { config, z } from 'zod';

config({ jitless: true });

export { z };
