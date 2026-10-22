import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Geist, Source_Serif_4 } from 'next/font/google';
// Global styles are intentionally loaded for their side effects.
// oxlint-disable-next-line import/no-unassigned-import
import './globals.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' });
// The answer is set in a serif so it reads as a document, apart from the UI chrome around it.
const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  weight: ['400', '600'],
  style: ['normal', 'italic'],
  variable: '--font-source-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Mercury × TinyFish',
  description: 'Live web search by TinyFish, ranked by Mercury Decide and answered by Mercury 3.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${sourceSerif.variable} dark`}>
      <body>{children}</body>
    </html>
  );
}
