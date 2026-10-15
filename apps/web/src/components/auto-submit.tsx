'use client';
import { useEffect } from 'react';

// Envoie directement le formulaire de connexion : /connexion mène tout de suite à la page de connexion (le bouton reste en secours)
export function AutoSubmit({ formId }: { formId: string }) {
  useEffect(() => {
    (document.getElementById(formId) as HTMLFormElement | null)?.requestSubmit();
  }, [formId]);
  return null;
}
