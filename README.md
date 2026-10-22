# Mercury × TinyFish

Live web search, ranked by [Mercury Decide](https://docs.inceptionlabs.ai/capabilities/decisions) and answered by
[Mercury 3](https://www.inceptionlabs.ai/blog/introducing-mercury-3), on top of TinyFish Search.

## How it works

1. **Search: TinyFish.** One call to TinyFish Search returns the results and, with "Read pages deeply" on, each
   page's text as markdown.
2. **Rank: Mercury Decide.** Pages are cut into sections at their headings. Every section gets a yes/no question,
   "does this help answer the query?", one request per page, all in parallel. One more `choice` question picks the
   single best section of the top 10.
3. **Answer: Mercury 3.** The top sections go to Mercury 3, which writes a short answer with `[n]` citations. It
   streams in diffusion mode, so you watch the whole answer denoise into place.

Each phase streams to the page as soon as it ends, with its time.

## Run it

Needs Node 24.

```sh
cp .env.example .env.local   # add TINYFISH_API_KEY and INCEPTION_API_KEY
npm install
npm run dev                  # http://localhost:3000
```

## Code

- `lib/server/pipeline.ts`: the three phases, end to end.
- `lib/server/relevance.ts`: section scoring and best-section pick with Mercury Decide.
- `lib/server/sections.ts`: splits a page's markdown into sections.
- `lib/server/inception.ts`: Mercury Decide and Mercury 3 API calls.
- `app/api/search/route.ts`: streams the phases as newline-delimited JSON.
- `components/search-view.tsx`: the search form and results.

## License

MIT
