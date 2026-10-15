'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';

export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;

const side = cva('fixed z-50 bg-background p-4 shadow-lg focus:outline-none', {
  variants: {
    side: {
      bottom: 'inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-xl border-t pb-[max(1rem,env(safe-area-inset-bottom))]',
      right: 'inset-y-0 right-0 w-80 max-w-[85vw] overflow-y-auto border-l',
    },
  },
  defaultVariants: { side: 'bottom' },
});

/** Panneau modal : tiroir du bas sur mobile (filtres, menus), latéral sur grand écran. Accessible (focus piégé, Échap). */
export function SheetContent({ className, side: s, title, children, ...p }: Dialog.DialogContentProps & VariantProps<typeof side> & { title: string }) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <Dialog.Content className={cn(side({ side: s }), className)} aria-describedby={undefined} {...p}>
        <div className="mb-4 flex items-center justify-between">
          <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
          <Dialog.Close className="rounded-md p-2 hover:bg-accent" aria-label="Fermer"><X className="size-4" /></Dialog.Close>
        </div>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  );
}
