import RealtimeClient from '@/components/realtime/RealtimeClient';

export default function Page() {
return (
<main style={{ maxWidth: 760, margin: '40px auto', padding: 16 }}>
<h1>OpenAI Realtime Demo</h1>
<RealtimeClient />
</main>
);
}