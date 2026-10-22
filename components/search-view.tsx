'use client';
import { useRef, useState } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { CopyButton } from './copy-button';
import { Icon } from './icon';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ShimmerButton } from '@/components/ui/shimmer-button';
import {
  confidence,
  DEFAULT_SEARCH_OPTIONS,
  hostname,
  linkCitations,
  SEARCH_EXAMPLES,
  searchEventSchema,
  searchRequest,
  type BestSection,
  type SearchOptions,
  type SearchResult,
  type Source,
} from '@/lib/search';

/** Where the search is: each phase ends with an event from the stream. */
type Status = 'idle' | 'searching' | 'ranking' | 'answering' | 'done' | 'error';

type Found = {
  query: string;
  results: SearchResult[];
  pages: number;
  search_ms: number;
  best?: BestSection | null;
  sources?: Source[];
  scores?: Record<string, number>;
  decide_calls?: number;
  ranking_error?: string;
  rank_ms?: number;
  answer: string;
  answer_steps: number;
  answer_ms?: number;
  answer_error?: string;
  total_ms?: number;
};

export function useSearch() {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<SearchOptions>(DEFAULT_SEARCH_OPTIONS);
  const [status, setStatus] = useState<Status>('idle');
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped by every search; events of a superseded search are dropped and its stream cancelled.
  const gen = useRef(0);
  const abort = useRef<AbortController | null>(null);

  async function search(q: string = query) {
    if (!q.trim()) return;
    const my = ++gen.current;
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setQuery(q);
    setStatus('searching');
    setFound(null);
    setError(null);
    const live = () => gen.current === my;
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(searchRequest(q, options)),
        signal: ctl.signal,
      });
      if (!res.ok || !res.body) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(json?.error ?? `Search failed (HTTP ${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done || !live()) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const parsed = searchEventSchema.safeParse(JSON.parse(line));
          if (!parsed.success) continue;
          const e = parsed.data;
          if (e.type === 'error') throw new Error(e.message);
          if (e.type === 'results') {
            setFound({
              query: e.query,
              results: e.results,
              pages: e.sections,
              search_ms: e.search_ms,
              answer: '',
              answer_steps: 0,
            });
            setStatus('ranking');
          } else if (e.type === 'ranked') {
            setFound((f) => f && { ...f, ...e });
            setStatus('answering');
          } else if (e.type === 'best') {
            setFound((f) => f && { ...f, best: e.best, decide_calls: e.decide_calls });
          } else if (e.type === 'answer') {
            setFound((f) => f && { ...f, answer: e.text, answer_steps: f.answer_steps + 1 });
          } else {
            setFound((f) => f && { ...f, ...e });
            setStatus('done');
          }
        }
      }
      // A stream that ends without `done` (the server went away) still leaves what arrived on screen.
      if (live()) setStatus('done');
    } catch (e) {
      if (!live() || ctl.signal.aborted) return;
      setError((e as Error).message);
      setStatus('error');
    }
  }

  return { query, setQuery, options, setOptions, status, found, error, search };
}
export type SearchState = ReturnType<typeof useSearch>;

const busy = (s: Status) => s === 'searching' || s === 'ranking' || s === 'answering';

/** Left side: the query, the collapsed options and one-click examples. */
export function SearchPanel({ state }: { state: SearchState }) {
  const { query, setQuery, options, setOptions, status } = state;
  const loading = busy(status);
  const submitDisabled = !query.trim() || loading;
  const set = (patch: Partial<SearchOptions>) => setOptions((o) => ({ ...o, ...patch }));
  const narrowed = [
    options.location.trim() && `from ${options.location.trim()}`,
    options.include_domains.trim() && 'domains',
    !options.deep && 'snippets only',
  ].filter(Boolean);
  return (
    <form
      className="goal-form search-form"
      onSubmit={(event) => {
        event.preventDefault();
        void state.search();
      }}
    >
      <h1 className="goal-heading">What do you want to find?</h1>
      <label className="sr-only" htmlFor="search-query">
        Search query
      </label>
      <div className="prompt-box">
        <Textarea
          className="h-[96px] min-h-[96px] resize-none field-sizing-fixed text-[13px] leading-relaxed md:text-[13px]"
          id="search-query"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          maxLength={500}
          placeholder="Search the live web…"
          autoFocus
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              if (!submitDisabled) void state.search();
            }
          }}
        />
        <div className="prompt-meta">
          <span>Enter to search · Shift+Enter for a new line</span>
        </div>
      </div>
      <details className="goal-options">
        <summary>
          Options
          {narrowed.length > 0 && (
            <span className="goal-options-hint"> · {narrowed.join(', ')}</span>
          )}
        </summary>
        <div className="search-options-grid">
          <div>
            <label className="field-label url-label" htmlFor="search-location">
              Location
            </label>
            <Input
              id="search-location"
              className="h-[39px] text-[13px] md:text-[13px]"
              placeholder="e.g. US"
              value={options.location}
              onChange={(e) => set({ location: e.target.value })}
            />
          </div>
          <div>
            <label className="field-label url-label" htmlFor="search-language">
              Language
            </label>
            <Input
              id="search-language"
              className="h-[39px] text-[13px] md:text-[13px]"
              placeholder="e.g. en"
              value={options.language}
              onChange={(e) => set({ language: e.target.value })}
            />
          </div>
        </div>
        <label className="field-label url-label" htmlFor="search-domains">
          Only these domains <span>Comma-separated, optional</span>
        </label>
        <div className="url-input">
          <Icon name="globe" />
          <Input
            id="search-domains"
            className="h-[39px] pl-9 text-[13px] md:text-[13px]"
            placeholder="e.g. fedex.com, ups.com"
            value={options.include_domains}
            onChange={(e) => set({ include_domains: e.target.value })}
          />
        </div>
        <label className="search-deep">
          <input
            type="checkbox"
            checked={options.deep}
            onChange={(e) => set({ deep: e.target.checked })}
          />
          <span>
            Read pages deeply
            <small>
              Mercury Decide ranks every section of each result page, not just the snippets, and
              Mercury 3 answers from them.
            </small>
          </span>
        </label>
      </details>
      <ShimmerButton
        type="submit"
        disabled={submitDisabled}
        shimmerColor="#ff6700"
        shimmerSize="2px"
        shimmerDuration="3s"
        borderRadius="8px"
        background={submitDisabled ? '#1a1a1a' : '#ff9b57'}
        className="goal-shimmer mt-5 h-[42px] w-full gap-2.5 px-4 py-0 text-[13px]"
      >
        <span>{loading ? 'Searching…' : 'Search'}</span>
        <Icon name="search" size={14} />
      </ShimmerButton>
      <div className="examples" aria-label="Example searches">
        <div className="section-label examples-label">Try one</div>
        <div className="examples-grid">
          {SEARCH_EXAMPLES.map((e) => (
            <button
              key={e.title}
              type="button"
              className="example-card"
              disabled={loading}
              onClick={() => void state.search(e.query)}
            >
              <span className="example-title">
                <Icon name="search" size={11} /> {e.title}
              </span>
              <span className="example-goal">{e.query}</span>
            </button>
          ))}
        </div>
      </div>
    </form>
  );
}

/** Right side: Mercury 3's answer on top, Mercury Decide's best passage, then every result. */
export function SearchResults({ state }: { state: SearchState }) {
  const { status, found, error } = state;
  return (
    <section className="search-output" aria-label="Search results" aria-live="polite">
      {status === 'idle' && (
        <div className="search-empty">
          <Icon name="search" size={22} />
          <p>
            TinyFish searches and reads the live web. Mercury Decide ranks every passage, and
            Mercury 3 writes the answer.
          </p>
        </div>
      )}
      {status === 'error' && (
        <div className="search-summary search-error" role="alert">
          <div className="section-label">Search failed</div>
          <p>{error}</p>
        </div>
      )}
      {status !== 'idle' && status !== 'error' && <Pipeline status={status} found={found} />}
      {status !== 'idle' && status !== 'error' && <Answer status={status} found={found} />}
      {found?.best && <BestPassage best={found.best} />}
      {found && <Stats found={found} />}
      {status === 'searching' && <PendingResults />}
      {found && <Results found={found} />}
    </section>
  );
}

/** The three phases as chips, each with its time once it is done. */
function Pipeline({ status, found }: { status: Status; found: Found | null }) {
  const order: Status[] = ['searching', 'ranking', 'answering', 'done'];
  const at = order.indexOf(status);
  const steps = [
    { label: 'TinyFish Search', ms: found?.search_ms },
    { label: 'Mercury Decide', ms: found?.rank_ms },
    { label: 'Mercury 3', ms: found?.answer_ms },
  ];
  return (
    <ol className="pipeline" aria-label="Progress">
      {steps.map((s, i) => {
        const state = i < at ? 'is-done' : i === at ? 'is-active' : '';
        return (
          <li key={s.label} className={`pipeline-step ${state}`}>
            <span className="pipeline-dot" aria-hidden="true" />
            <span>{s.label}</span>
            {s.ms !== undefined && <span className="pipeline-ms">{s.ms} ms</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** Links open in a new tab; a bare number is a citation and gets the chip look. */
const MARKDOWN_COMPONENTS: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={/^\d+$/.test(String(children)) ? 'cite' : undefined}
    >
      {children}
    </a>
  ),
};

function Answer({ status, found }: { status: Status; found: Found | null }) {
  const sources = found?.sources ?? [];
  const writing = status === 'answering';
  const text = found?.answer ?? '';
  const waiting =
    status === 'searching'
      ? 'Searching the live web with TinyFish…'
      : status === 'ranking'
        ? `Mercury Decide is ranking ${found?.results.length ?? 0} results…`
        : 'Mercury 3 is writing the answer…';
  if (status === 'done' && !text)
    return (
      <div className="search-summary search-summary-missing">
        <div className="section-label">No answer</div>
        <p>
          {found?.answer_error ?? found?.ranking_error ?? 'Nothing stood out as an answer.'} The
          results are below.
        </p>
      </div>
    );
  return (
    <article className="search-summary">
      <div className="search-summary-head">
        <span className="section-label">Answer</span>
        <span className="search-confidence model-chip">Mercury 3</span>
        {writing && text && (
          <span className="search-confidence diffusing">
            denoising · step {found?.answer_steps}
          </span>
        )}
        {status === 'done' && text && <CopyButton text={text} />}
      </div>
      {text ? (
        <div className={`answer-body search-summary-body${writing ? ' is-diffusing' : ''}`}>
          <Markdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
            {linkCitations(text, sources)}
          </Markdown>
        </div>
      ) : (
        <>
          <div className="search-waiting">{waiting}</div>
          <div className="answer-skeleton" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </>
      )}
      {status === 'done' && text && sources.length > 0 && (
        <ol className="answer-sources" aria-label="Sources">
          {sources.map((s) => (
            <li key={s.n}>
              <a href={s.url} target="_blank" rel="noreferrer" title={s.heading || s.title}>
                <span className="cite">{s.n}</span>
                {hostname(s.url)}
              </a>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

/** The single passage Mercury Decide picked, as Ultra Search shows it. */
function BestPassage({ best }: { best: BestSection }) {
  const c = confidence(best.probability);
  return (
    <details className="search-summary best-passage">
      <summary className="search-summary-head">
        <span className="section-label">Best passage</span>
        <span className="search-confidence model-chip">Mercury Decide</span>
        <span className={`search-confidence${c.sure ? ' is-sure' : ''}`}>
          {c.label} · {c.percent}%
        </span>
        <Icon name="chevron" size={12} />
      </summary>
      <a className="search-summary-source" href={best.url} target="_blank" rel="noreferrer">
        <span className="search-summary-title">
          {best.title}
          {best.heading ? <span> › {best.heading}</span> : null}
        </span>
        <span className="search-host">{hostname(best.url)}</span>
      </a>
      <div className="answer-body search-summary-body">
        <Markdown remarkPlugins={[remarkGfm]}>{best.text}</Markdown>
      </div>
    </details>
  );
}

function Stats({ found }: { found: Found }) {
  return (
    <div className="search-stats">
      <span>
        {found.results.length} results for “{found.query}”
        {found.pages > 0 ? ` · ${found.pages} pages read` : ''}
      </span>
      {found.total_ms !== undefined && (
        <span>
          {found.decide_calls ?? 0} Decide calls · total {found.total_ms} ms
        </span>
      )}
    </div>
  );
}

function PendingResults() {
  return (
    <ol className="search-results" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <li key={i} className="search-result search-result-pending">
          <div className="answer-skeleton">
            <span />
            <span />
          </div>
        </li>
      ))}
    </ol>
  );
}

function Results({ found }: { found: Found }) {
  if (found.results.length === 0)
    return <p className="search-none">No results. Try fewer words or remove the domain filter.</p>;
  return (
    <ol className="search-results">
      {found.results.map((r) => {
        const score = found.scores?.[r.position];
        return (
          <li key={`${r.position}-${r.url}`} className="search-result">
            <div className="search-result-main">
              <a href={r.url} target="_blank" rel="noreferrer" className="search-result-title">
                {r.title}
              </a>
              <div className="search-result-meta">
                <span className="search-host">{hostname(r.url)}</span>
                {r.date && <span>{r.date}</span>}
              </div>
              {r.snippet && <p className="search-result-snippet">{r.snippet}</p>}
            </div>
            {score !== undefined && (
              <span
                className={`relevance${score >= 0.5 ? ' is-sure' : ''}`}
                title="Mercury Decide: best section's relevance"
              >
                {Math.round(score * 100)}%
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
