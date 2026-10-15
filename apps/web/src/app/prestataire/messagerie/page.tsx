import type { Metadata } from 'next';
import { Messenger } from '@/components/messenger';

export const metadata: Metadata = { title: 'Messages' };

export default function MessagesPage() {
  return <Messenger />;
}
