'use client';

import { useState } from 'react';
import { FileText, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ChatRegister } from './chat-register';
import { RegisterForm } from './register-form';

const MODES = [
  { id: 'form', label: 'Formulaire', icon: FileText },
  { id: 'chat', label: 'Chat rapide', icon: MessageCircle },
] as const;

// Deux façons de s'inscrire, même API et mêmes règles de validation
export function SignupSwitch() {
  const [mode, setMode] = useState<'form' | 'chat'>('form');
  return (
    <>
      <div role="tablist" aria-label="Mode d'inscription" className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-secondary p-1">
        {MODES.map(({ id, label, icon: Icon }) => (
          <button key={id} role="tab" type="button" aria-selected={mode === id} onClick={() => setMode(id)}
            className={cn('flex h-10 items-center justify-center gap-2 rounded-lg text-sm font-medium transition', mode === id ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>
      {mode === 'form' ? <RegisterForm /> : <ChatRegister />}
    </>
  );
}
