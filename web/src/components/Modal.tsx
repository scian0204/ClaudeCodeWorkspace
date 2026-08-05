import * as Dialog from '@radix-ui/react-dialog';
import React from 'react';

// `fullscreen` trades the fixed `width` for (almost) the whole viewport — for content a 420–560px
// dialog crops, like a diff or a commit graph. `titleExtra` is the right end of the title row, which
// is where the caller's own toggle for that goes.
export function Modal({ open, onOpenChange, title, children, width = 420, fullscreen = false, titleExtra }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: React.ReactNode; children: React.ReactNode;
  width?: number; fullscreen?: boolean; titleExtra?: React.ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content
          className={`fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-panel border border-line rounded-xl p-5 shadow-2xl z-50 overflow-auto scrolly ${
            fullscreen ? 'w-[96vw] h-[94vh] max-w-none max-h-none' : 'max-w-[92vw] max-h-[86vh]'}`}
          style={fullscreen ? undefined : { width }}>
          <div className="flex items-center gap-2 mb-3">
            <Dialog.Title className="font-semibold text-txt min-w-0 truncate">{title}</Dialog.Title>
            {titleExtra && <div className="ml-auto shrink-0">{titleExtra}</div>}
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
