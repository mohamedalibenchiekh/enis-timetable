import { NextPage } from 'next';
import { ChangelogPanel } from '@/components/ChangelogPanel';

export default function NouveautesPage() {
  return (
    <main style={{ padding: '24px', maxWidth: '800px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '20px', marginBottom: '16px' }}>Nouveautés</h1>
      <ChangelogPanel />
    </main>
  );
}
