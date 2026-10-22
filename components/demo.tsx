'use client';
import Image from 'next/image';

import { DitherField } from './dither-field';
import { SearchPanel, SearchResults, useSearch } from './search-view';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';

/** The page: Ultra Search's layout, the query on the left and the answer on the right. */
export function Demo() {
  const search = useSearch();
  return (
    <div className="playground">
      <header className="topbar">
        <div className="nav-label">
          <span className="mercury-brand">
            <Image
              src="/brand/inception-mark.svg"
              alt=""
              width={24}
              height={25}
              className="mercury-mark"
              priority
            />
            Mercury
          </span>
          <span className="brand-x" aria-label="by">
            ×
          </span>
          <Image
            src="/brand/tinyfish-logo-dark-color.svg"
            alt="TinyFish"
            width={132}
            height={30}
            className="brand-logo"
            priority
          />
        </div>
        <div className="nav-actions nav-models">
          <span>Search · TinyFish</span>
          <span>Rank · Mercury Decide</span>
          <span>Answer · Mercury 3</span>
        </div>
      </header>
      <main className="main-content">
        <ResizablePanelGroup orientation="horizontal" className="workspace">
          <ResizablePanel defaultSize={460} minSize={320} maxSize="45" className="workspace-inputs">
            <aside className="goal-panel" aria-label="Search">
              <SearchPanel state={search} />
            </aside>
          </ResizablePanel>
          <ResizableHandle withHandle className="workspace-divider" />
          <ResizablePanel className="workspace-output">
            <SearchResults state={search} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </main>
      <DitherField className="bottom-dither" rgb="255, 103, 0" alpha={0.65} />
    </div>
  );
}
