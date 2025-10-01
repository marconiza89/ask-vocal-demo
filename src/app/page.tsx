import RealtimeClient from '@/components/realtime/RealtimeClient';
import Image from 'next/image';
export default function Page() {
    return (
        <div className='flex flex-col  items-center justify-center' style={{ maxWidth: 760,  padding: 16 }}>
            <Image
                src="/ASK.png"
                alt="Logo"
                width={160}
                height={160}
                style={{ marginBottom: 12 }}
            />
            <h1 className='text-neutral-200 font-thin font-sans' >REALTIME DEMO</h1>
            <RealtimeClient />
        </div>
    );
}