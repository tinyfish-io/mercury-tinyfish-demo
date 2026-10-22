// One search, end to end: TinyFish Search (with page text when `deep`), Mercury Decide scores every section, then
// Mercury 3 writes the answer from the top sections while Decide picks the single best one. Each phase is emitted
// as soon as it ends.
import type { SearchEvent, SearchRequest, SearchResult } from '../search';
import { hasKey, streamAnswer } from './inception';
import {
  pickBest,
  scoreSections,
  sectionsOf,
  type RankableResult,
  type ScoredSection,
} from './relevance';

const SEARCH_URL = process.env.TINYFISH_SEARCH_URL || 'https://api.search.tinyfish.ai';
const SEARCH_TIMEOUT_MS = 20_000; // page text makes this the slowest phase; a stall must still end the stream
const PICK_FROM = 10; // sections the best-section choice picks among
const ANSWER_SOURCES = 8; // sections Mercury 3 writes the answer from
const MIN_RELEVANCE = 0.15; // below this a section is noise, unless nothing scores higher

const ANSWER_SYSTEM = `You answer web search queries using only the numbered sources you are given.
Lead with the direct answer in one or two sentences. Add short supporting detail (a few bullets or a small table) only when it helps.
Cite every factual claim with its source number in square brackets, like [2]. Never cite a number that is not listed.
If the sources do not answer the query, say what they do cover in one sentence.
Use Markdown. Do not mention "sources" or "the provided text"; just answer.`;

type SearchApiResult = SearchResult & RankableResult;

export function searchKey(): string | undefined {
  return process.env.TINYFISH_API_KEY || process.env.SEARCH_API_KEY || undefined;
}

export function missingConfig(): string | undefined {
  if (!searchKey()) return 'TINYFISH_API_KEY is not set.';
  if (!hasKey()) return 'INCEPTION_API_KEY is not set.';
  return undefined;
}

export async function runSearch(
  input: SearchRequest,
  emit: (e: SearchEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const started = Date.now();
  const { deep, ...args } = input;
  const url = new URL(SEARCH_URL);
  for (const [k, v] of Object.entries(args)) if (v) url.searchParams.set(k, v);
  if (deep) url.searchParams.set('fetch', '{}'); // inline page text for the ranking to read

  const res = await fetch(url, {
    headers: { 'X-API-Key': searchKey() ?? '' },
    signal: AbortSignal.any([signal, AbortSignal.timeout(SEARCH_TIMEOUT_MS)]),
  });
  if (!res.ok) {
    emit({ type: 'error', message: `TinyFish Search failed (HTTP ${res.status}).` });
    return;
  }
  const body = (await res.json()) as { query: string; results: SearchApiResult[] };
  const searchMs = Date.now() - started;
  emit({
    type: 'results',
    query: body.query,
    // Page text stays server-side: it is for the ranking and the answer only.
    results: body.results.map(({ fetch: _fetch, ...r }) => r),
    sections: body.results.filter((r) => r.fetch?.text).length,
    search_ms: searchMs,
  });

  const tRank = Date.now();
  let ranked: ScoredSection[] = [];
  let rankingError: string | undefined;
  let calls = 0;
  try {
    const rel = await scoreSections(input.query, body.results);
    ranked = rel.sections;
    calls = rel.requests;
  } catch (e) {
    rankingError = (e as Error).message.split('\n')[0];
  }
  const scores: Record<string, number> = {};
  for (const s of ranked) scores[s.position] = Math.max(scores[s.position] ?? 0, s.relevance);
  // Without a ranking, Mercury 3 still answers, from the search snippets in TinyFish's order.
  const sources = ranked.length ? answerSources(ranked) : unrankedSources(body.results);
  emit({
    type: 'ranked',
    sources: sources.map(({ n, s }) => ({
      n,
      title: s.title,
      url: s.url,
      heading: s.heading,
      relevance: s.relevance,
    })),
    scores,
    decide_calls: calls,
    ...(rankingError ? { ranking_error: rankingError } : {}),
    rank_ms: Date.now() - tRank,
  });

  // The pick only decides which passage to show; the answer does not wait for it.
  const top = ranked.slice(0, PICK_FROM);
  const pick = pickBest(input.query, top)
    .then((p) =>
      emit({ type: 'best', best: p?.best ?? null, decide_calls: calls + (top.length > 1 ? 1 : 0) }),
    )
    .catch(() => emit({ type: 'best', best: null, decide_calls: calls + 1 }));

  const tAnswer = Date.now();
  let steps = 0;
  let answerError: string | undefined;
  if (sources.length === 0) {
    answerError = 'Nothing to write an answer from.';
  } else {
    try {
      const out = await streamAnswer({
        system: ANSWER_SYSTEM,
        user: answerPrompt(input.query, sources),
        onStep: (text) => emit({ type: 'answer', text }),
        signal,
      });
      steps = out.steps;
    } catch (e) {
      answerError = (e as Error).message.split('\n')[0];
    }
  }
  const answerMs = Date.now() - tAnswer;
  await pick;
  emit({
    type: 'done',
    answer_ms: answerMs,
    answer_steps: steps,
    ...(answerError ? { answer_error: answerError } : {}),
    total_ms: Date.now() - started,
  });
}

/** The sections Mercury 3 reads: the most relevant, numbered for citation. */
function answerSources(ranked: ScoredSection[]) {
  const strong = ranked.filter((s) => s.relevance >= MIN_RELEVANCE);
  const pool = strong.length ? strong : ranked.slice(0, 3);
  return pool.slice(0, ANSWER_SOURCES).map((s, i) => ({ n: i + 1, s }));
}

function unrankedSources(results: RankableResult[]) {
  return results
    .flatMap((r) => sectionsOf(r).filter((s) => s.snippetOnly))
    .slice(0, ANSWER_SOURCES)
    .map((s, i) => ({ n: i + 1, s: { ...s, relevance: 0 } }));
}

function answerPrompt(query: string, sources: { n: number; s: ScoredSection }[]): string {
  const blocks = sources.map(({ n, s }) =>
    [`[${n}] ${s.title}${s.heading ? ` › ${s.heading}` : ''}`, s.url, s.text].join('\n'),
  );
  return `Query: ${query}\n\nSources:\n\n${blocks.join('\n\n---\n\n')}`;
}
