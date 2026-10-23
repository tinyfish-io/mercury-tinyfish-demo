import { searchRequestSchema, type SearchEvent } from '@/lib/search';
import { missingConfig, runSearch } from '@/lib/server/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Streams the search's phases as newline-delimited JSON (see lib/search.ts).
export async function POST(req: Request) {
  const parsed = searchRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: 'Enter a query of up to 500 characters.' }, { status: 400 });
  const missing = missingConfig();
  if (missing)
    return Response.json({ error: `Search is not configured: ${missing}` }, { status: 503 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: SearchEvent) => {
        if (!req.signal.aborted) controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
      };
      try {
        await runSearch(parsed.data, emit, req.signal);
      } catch (e) {
        if (!req.signal.aborted)
          emit({ type: 'error', message: (e as Error).message.split('\n')[0] ?? 'Search failed.' });
      } finally {
        if (!req.signal.aborted) controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
