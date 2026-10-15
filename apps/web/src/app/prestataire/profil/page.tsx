import type { Metadata } from 'next';
import { TemplatesCard } from '@/components/templates-card';
import { ProfileEditor } from './profile-editor';

export const metadata: Metadata = { title: 'Mon profil' };

export default function ProviderProfilePage() {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-2xl font-bold">Mon profil et mes documents</h1>
      <ProfileEditor />
      <div className="mt-6"><TemplatesCard /></div>
    </div>
  );
}
