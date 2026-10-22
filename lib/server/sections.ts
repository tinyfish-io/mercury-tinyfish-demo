// Cut a fetched page (markdown) into sections at its headings.
// A section = the heading path above it + the text until the next heading. Long sections are split at paragraph
// breaks; sections with almost no text (menus, empty headings) are dropped.

export type Section = {
  /** Unique across the whole search: r<position>.s<n>. */
  id: string;
  /** Search result it came from. */
  position: number;
  url: string;
  /** Page title. */
  title: string;
  /** "H1 / H2 / H3", empty before the first heading. */
  heading: string;
  text: string;
  snippetOnly?: boolean;
};

const MAX_SECTION = 2500; // chars; longer sections are split at paragraph breaks
const MIN_SECTION = 60; // chars of body text

export function splitMarkdown(md: string): { heading: string; text: string }[] {
  const out: { heading: string; text: string }[] = [];
  const path: string[] = [];
  let body: string[] = [];

  const flush = () => {
    const text = body
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    body = [];
    if (text.replace(/\s+/g, ' ').length < MIN_SECTION) return;
    const heading = path.filter(Boolean).join(' / ');
    for (const chunk of chunks(text)) out.push({ heading, text: chunk });
  };

  let inCode = false;
  for (const line of md.split('\n')) {
    if (/^\s*```/.test(line)) inCode = !inCode;
    const h = !inCode && line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flush();
      const level = h[1]?.length ?? 1;
      path.length = level; // drop deeper levels
      path[level - 1] = (h[2] ?? '').replace(/[*_`]/g, '').trim();
      continue;
    }
    body.push(line);
  }
  flush();
  return out;
}

function chunks(text: string): string[] {
  if (text.length <= MAX_SECTION) return [text];
  const out: string[] = [];
  let cur = '';
  for (const para of text.split(/\n\s*\n/)) {
    if (cur && cur.length + para.length > MAX_SECTION) {
      out.push(cur);
      cur = '';
    }
    // a single oversized paragraph (e.g. a huge table) is cut hard
    for (let i = 0; i < para.length; i += MAX_SECTION) {
      const piece = para.slice(i, i + MAX_SECTION);
      if (cur && cur.length + piece.length > MAX_SECTION) {
        out.push(cur);
        cur = '';
      }
      cur = cur ? `${cur}\n\n${piece}` : piece;
    }
  }
  if (cur) out.push(cur);
  return out;
}
