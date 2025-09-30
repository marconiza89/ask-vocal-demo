import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

const DEFAULT_MODEL =
    process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-12-17';

export async function GET(req: NextRequest) {
    try {
        const url = new URL(req.url);
        const model = url.searchParams.get('model') || DEFAULT_MODEL;

        if (!process.env.OPENAI_API_KEY) {
            return NextResponse.json(
                { error: 'Missing OPENAI_API_KEY' },
                { status: 500 }
            );
        }

        const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json',
                'OpenAI-Beta': 'realtime=v1',
            },
            body: JSON.stringify({
                model,
                voice: 'verse',                  // audio out dal modello
                modalities: ['text', 'audio'],   // abilita testo+audio
                turn_detection: {                // il server capisce quando smetti di parlare
                    type: 'server_vad',
                    threshold: 0.5,
                    prefix_padding_ms: 300,
                    silence_duration_ms: 700
                },
                // Opzionale:
                instructions: 'Sei un concierge virtuale del Grand Hotel Mattei di Ravenna rispondi sempre nella lingua usata dall utente usa un linguaggio breve colloquiale cordiale e professionale non fornire informazioni false e non scrivere codice informazioni hotel parcheggio gratis wi fi hotspot libero camere con minibar tv satellitare e Sky check in dalle ore 14 00 check out entro le ore 11 00 non e presente una spa in hotel gestione richieste se l utente chiede cosa visitare a Ravenna proponi velocemente alcune attrazioni e tour e offri di inviare link ufficiali se chiede un luogo specifico da visitare fornisci indicazioni semplici per raggiungerlo dall hotel e offri di inviare indicazioni dettagliate se chiede parchi tematici o divertimento indirizza al menu Parchi e offri consigli pratici se chiede eventi spettacoli o cose da fare in date specifiche informa che gli aggiornamenti sono nel menu FlashLink e proponi eventuali tour se la richiesta riguarda cibo o vino descrivi l offerta gastronomica e consiglia dove mangiare su richiesta se chiede spiagge o bagni indirizza al menu Bagni e offri suggerimenti se c e un emergenza sanitaria indirizza al menu Emergenza e invita a contattare subito la reception se chiede spa o centri benessere ricorda che non e presente in albergo e proponi strutture esterne su richiesta se chiede noleggi o trasferimenti auto moto taxi ncc biciclette offri organizzazione tramite reception se chiede bus o treni indirizza al menu Trasporti e aiuta con le opzioni migliori per richieste non previste fai una domanda di chiarimento e indirizza alla sezione piu utile del sito come Camere Ristorante Offerte Come raggiungerci Sale meeting Contatti'
            }),
        });

        if (!r.ok) {
            const err = await r.text();
            return NextResponse.json(
                { error: 'OpenAI session error', details: err },
                { status: r.status }
            );
        }

        const data = await r.json();
        // data contiene client_secret.value = token effimero
        return NextResponse.json(data);
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || 'Unknown error' }, { status: 500 });
    }
}