import type { Metadata } from 'next';
import { NotificationPreferences } from './preferences';

export const metadata: Metadata = { title: 'Notifications' };

export default function NotificationsPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">Vous êtes toujours prévenu dans l&apos;application. Choisissez ici ce que vous recevez aussi par email.</p>
      <NotificationPreferences />
    </div>
  );
}
