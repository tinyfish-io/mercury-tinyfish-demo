// Section relevance, ported from Ultra's Jev ranker to Mercury Decide (same question shapes). Every section of
// every fetched page gets one noul, "does this section help answer the query?". One request per page (split
// further when a page is long): state = query + page + its sections, questions = one noul per section. Requests
// run in parallel; sections are then sorted by that probability. The search snippet is always a candidate too.
// pickBest: one choice over the top sections (mixed across pages) picks the single best one.
import { choice, decide, noul, type ChoiceAnswer, type NoulAnswer } from './inception';
import { splitMarkdown, type Section } from './sections';

// Decide's latency follows request size, not question count: a 57k-char request took ~2s, 10k ones ~0.7s. Small
// requests all in parallel finish sooner for the same total tokens.
const MAX_STATE_CHARS = 10000;
// Pages past their first sections are mostly history, references and footers that never win; long pages
// (Wikipedia: 50 sections) would otherwise fan out into dozens of calls.
const MAX_SECTIONS_PER_PAGE = 12;

/** The parts of a TinyFish Search result the ranker reads. */
export type RankableResult = {
  position: number;
  url: string;
  title: string;
  snippet?: string;
  fetch?: { title?: string; text?: string } | null;
};

export type ScoredSection = Section & { relevance: number };
export type Relevance = {
  sections: ScoredSection[];
  requests: number;
  tokens: number;
  errors: string[];
};
export type BestSection = {
  title: string;
  url: string;
  heading: string;
  text: string;
  probability: number;
};

export function sectionsOf(r: RankableResult): Section[] {
  const base = { position: r.position, url: r.url, title: r.fetch?.title || r.title };
  // The snippet is always a candidate: it is the search engine's own pick of the relevant passage, and the
  // fetched text is often a homepage rather than the result page.
  const snippet: Section[] = r.snippet
    ? [{ ...base, id: `r${r.position}.s0`, heading: '', text: r.snippet, snippetOnly: true }]
    : [];
  const parts = r.fetch?.text ? splitMarkdown(r.fetch.text).slice(0, MAX_SECTIONS_PER_PAGE) : [];
  return [...snippet, ...parts.map((p, i) => ({ ...base, id: `r${r.position}.s${i + 1}`, ...p }))];
}

function batches(sections: Section[]): Section[][] {
  const out: Section[][] = [];
  let cur: Section[] = [];
  let size = 0;
  for (const s of sections) {
    const n = s.heading.length + s.text.length + 40;
    if (cur.length && size + n > MAX_STATE_CHARS) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(s);
    size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

async function scoreBatch(query: string, batch: Section[]) {
  const first = batch[0];
  if (!first) return { scored: [], tokens: 0 };
  const sections: Record<string, string> = {};
  const questions: Record<string, ReturnType<typeof noul>> = {};
  batch.forEach((s, i) => {
    const key = `s${i + 1}`;
    sections[key] = s.heading ? `## ${s.heading}\n${s.text}` : s.text;
    questions[s.id] = noul(
      `Does \`sections.${key}\` contain information that helps answer \`query\`?`,
      {
        true: 'The section states facts, steps, data, or explanation that answer the query or lead directly to the answer',
        false:
          'The section is off-topic, navigation, boilerplate, an ad, or only mentions the subject without useful information',
      },
    );
  });
  const res = await decide(
    {
      query,
      page: {
        title: first.title,
        url: first.url,
        // Only when the batch is all snippet: the snippet leads every page, so `first` alone would mislabel
        // batches that also hold fetched sections.
        ...(batch.every((s) => s.snippetOnly)
          ? { note: 'this is the search snippet for the page' }
          : {}),
      },
      sections,
    },
    questions,
  );
  return {
    scored: batch.map((s) => ({
      ...s,
      relevance: (res.answers[s.id] as NoulAnswer | undefined)?.noul ?? 0,
    })),
    tokens: res.usage?.input_tokens ?? 0,
  };
}

export async function scoreSections(query: string, results: RankableResult[]): Promise<Relevance> {
  const work = results.flatMap((r) => batches(sectionsOf(r)));
  const errors: string[] = [];
  const done = await Promise.all(
    work.map((b) =>
      scoreBatch(query, b).catch((e: unknown) => {
        errors.push(`${b[0]?.url ?? '?'}: ${(e as Error).message.split('\n')[0]}`);
        return { scored: b.map((s) => ({ ...s, relevance: 0 })), tokens: 0 };
      }),
    ),
  );
  if (work.length > 0 && errors.length === work.length)
    throw new Error(`Mercury Decide was unavailable (${errors[0]})`);
  return {
    sections: done.flatMap((d) => d.scored).sort((a, b) => b.relevance - a.relevance),
    requests: work.length,
    tokens: done.reduce((n, d) => n + d.tokens, 0),
    errors,
  };
}

/** One choice over the given sections (the top of the relevance list): which single section best answers the query. */
export async function pickBest(
  query: string,
  top: ScoredSection[],
): Promise<{ best: BestSection; tokens: number } | undefined> {
  const only = top[0];
  if (!only) return undefined;
  const asBest = (s: ScoredSection, probability: number): BestSection => ({
    title: s.title,
    url: s.url,
    heading: s.heading,
    text: s.text,
    probability,
  });
  if (top.length === 1) return { best: asBest(only, only.relevance), tokens: 0 };
  const sections: Record<string, { source: string; url: string; heading: string; text: string }> =
    {};
  const criteria: Record<string, null> = {};
  top.forEach((s, i) => {
    sections[`c${i + 1}`] = { source: s.title, url: s.url, heading: s.heading, text: s.text };
    criteria[`c${i + 1}`] = null;
  });
  const res = await decide(
    { query, sections },
    { best: choice('Which entry in `sections` best answers `query`?', criteria) },
  );
  const a = res.answers.best as ChoiceAnswer | undefined;
  const s = a && top[Number(a.choice.slice(1)) - 1];
  if (!a || !s) return undefined;
  return { best: asBest(s, a.probabilities[a.choice] ?? 0), tokens: res.usage?.input_tokens ?? 0 };
}
