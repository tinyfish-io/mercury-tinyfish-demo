import { z } from 'zod';

// POST /api/search answers with a stream of newline-delimited JSON events, one per phase as it finishes:
// `results` (TinyFish Search), `ranked` (Mercury Decide's section scores), then `best` (Decide's pick) and `answer`
// (Mercury 3, the whole text at each diffusion step) side by side, then `done`. `error` ends the stream early.

const resultSchema = z.object({
  position: z.number(),
  title: z.string(),
  url: z.string(),
  snippet: z.string().nullish(),
  site_name: z.string().nullish(),
  date: z.string().nullish(),
});
export type SearchResult = z.infer<typeof resultSchema>;

const bestSchema = z.object({
  title: z.string(),
  url: z.string(),
  heading: z.string().nullish(),
  text: z.string(),
  probability: z.number(),
});
export type BestSection = z.infer<typeof bestSchema>;

/** A section handed to Mercury 3; the answer cites it as [n]. */
const sourceSchema = z.object({
  n: z.number(),
  title: z.string(),
  url: z.string(),
  heading: z.string(),
  relevance: z.number(),
});
export type Source = z.infer<typeof sourceSchema>;

export const searchEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('results'),
    query: z.string(),
    results: z.array(resultSchema),
    sections: z.number(),
    search_ms: z.number(),
  }),
  z.object({
    type: z.literal('ranked'),
    sources: z.array(sourceSchema),
    /** Highest section relevance per result position. */
    scores: z.record(z.string(), z.number()),
    decide_calls: z.number(),
    ranking_error: z.string().optional(),
    rank_ms: z.number(),
  }),
  /** The best-section pick, which runs alongside the answer and can land before, during or after it. */
  z.object({ type: z.literal('best'), best: bestSchema.nullable(), decide_calls: z.number() }),
  z.object({ type: z.literal('answer'), text: z.string() }),
  z.object({
    type: z.literal('done'),
    answer_ms: z.number(),
    answer_steps: z.number(),
    answer_error: z.string().optional(),
    total_ms: z.number(),
  }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type SearchEvent = z.infer<typeof searchEventSchema>;

export const searchRequestSchema = z.object({
  query: z.string().trim().min(1).max(500),
  location: z.string().trim().max(200).optional(),
  language: z.string().trim().max(200).optional(),
  include_domains: z.string().trim().max(200).optional(),
  deep: z.boolean().optional(),
});
export type SearchRequest = z.infer<typeof searchRequestSchema>;

/** What the Options section can narrow a search by; blank means "not set". */
export type SearchOptions = {
  location: string;
  language: string;
  include_domains: string;
  deep: boolean;
};
export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  location: '',
  language: '',
  include_domains: '',
  // On by default: Mercury 3 writes a better answer from whole sections than from snippets.
  deep: true,
};

/** The request body: the query, and only the options that were set. */
export function searchRequest(query: string, o: SearchOptions): SearchRequest {
  return {
    query: query.trim(),
    ...(o.location.trim() ? { location: o.location.trim() } : {}),
    ...(o.language.trim() ? { language: o.language.trim() } : {}),
    ...(o.include_domains.trim()
      ? { include_domains: o.include_domains.replace(/\s+/g, '').replace(/,+/g, ',') }
      : {}),
    ...(o.deep ? { deep: true } : {}),
  };
}

/** How sure the ranking is about the best section. */
export function confidence(p: number): { label: string; percent: number; sure: boolean } {
  return {
    label: p >= 0.5 ? 'Confident' : 'Best guess',
    percent: Math.round(p * 100),
    sure: p >= 0.5,
  };
}

/** A result's host without "www.", for the source line under its title. */
export function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Turns the answer's [n] citations into markdown links to source n; unknown numbers stay as written. */
export function linkCitations(text: string, sources: Source[]): string {
  const byN = new Map(sources.map((s) => [s.n, s.url]));
  return text.replace(/\[(\d+)\](?!\()/g, (m, n: string) => {
    const url = byN.get(Number(n));
    return url ? `[${n}](${url})` : m;
  });
}

/** Searches a new user can run with one click. */
export const SEARCH_EXAMPLES = [
  { title: 'Shipping prices', query: 'FedEx One Rate medium box price' },
  { title: 'Release news', query: 'latest Node.js LTS release date' },
  { title: 'A quick fact', query: 'how long is the Golden Gate Bridge' },
  { title: 'Compare tools', query: 'playwright vs puppeteer differences' },
];
