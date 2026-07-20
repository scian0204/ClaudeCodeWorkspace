import * as Dialog from '@radix-ui/react-dialog';
import React from 'react';

export function Modal({ open, onOpenChange, title, children, width = 420 }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; children: React.ReactNode; width?: number;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-panel border border-line rounded-xl p-5 shadow-2xl z-50 max-w-[92vw] max-h-[86vh] overflow-auto scrolly"
          style={{ width }}>
          <Dialog.Title className="font-semibold mb-3 text-txt">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
