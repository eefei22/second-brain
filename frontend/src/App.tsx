import { useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { LeftPanel } from "./components/LeftPanel.js";
import { Canvas } from "./components/Canvas.js";
import { NoteDetail } from "./components/NoteDetail.js";

export default function App() {
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  // Bumped whenever Canvas resolves/defers a fragment, so LeftPanel knows to
  // refetch (domains/notes/uncategorized/queue) instead of showing stale data
  // for anything captured after its initial load or last expand.
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <PanelGroup direction="horizontal" className="h-screen w-screen bg-neutral-900">
      <Panel defaultSize={22} minSize={15} collapsible>
        <LeftPanel onOpenNote={setOpenNoteId} refreshKey={refreshKey} />
      </Panel>

      <PanelResizeHandle className="w-1 bg-neutral-800 hover:bg-neutral-600 transition" />

      <Panel defaultSize={openNoteId ? 48 : 78} minSize={30}>
        <Canvas onChanged={() => setRefreshKey((k) => k + 1)} />
      </Panel>

      {openNoteId && (
        <>
          <PanelResizeHandle className="w-1 bg-neutral-800 hover:bg-neutral-600 transition" />
          <Panel defaultSize={30} minSize={20} collapsible>
            <NoteDetail noteId={openNoteId} onClose={() => setOpenNoteId(null)} />
          </Panel>
        </>
      )}
    </PanelGroup>
  );
}
