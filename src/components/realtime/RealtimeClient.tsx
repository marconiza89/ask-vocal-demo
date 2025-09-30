'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

type RealtimeEvent = {
    type: string;
    [key: string]: any;
};

type ConnectOptions = {
    model?: string;
    enableMicrophone?: boolean; // se true, invia audio al modello
    enableAudioOut?: boolean;   // se true, riproduce l'audio del modello
};

export default function RealtimeClient() {
    const [connected, setConnected] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);
    const [transcript, setTranscript] = useState<string>('');
    const pcRef = useRef<RTCPeerConnection | null>(null);
    const dcRef = useRef<RTCDataChannel | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const remoteStreamRef = useRef<MediaStream | null>(null);
    const audioOutRef = useRef<HTMLAudioElement | null>(null);

    const log = useCallback((m: string) => {
        setLogs(prev => [m, ...prev].slice(0, 200));
    }, []);

    const fetchEphemeralSession = useCallback(async (model?: string) => {
        const url = model ? `/api/realtime/session?model=${encodeURIComponent(model)}` : '/api/realtime/session';
        const r = await fetch(url, { method: 'GET' });
        if (!r.ok) {
            throw new Error(`Failed to fetch session: ${r.status} ${await r.text()}`);
        }
        return r.json();
    }, []);

    const connect = useCallback(async (options?: ConnectOptions) => {
        if (pcRef.current) return;

        const model = options?.model;
        const enableMicrophone = options?.enableMicrophone ?? false;
        const enableAudioOut = options?.enableAudioOut ?? false;

        const session = await fetchEphemeralSession(model);
        const ephemeralKey: string = session?.client_secret?.value;
        if (!ephemeralKey) {
            throw new Error('Missing ephemeral key from session endpoint');
        }

        // PeerConnection
        const pc = new RTCPeerConnection();
        pcRef.current = pc;

        // DataChannel per eventi
        const dc = pc.createDataChannel('oai-events');
        dcRef.current = dc;

        dc.onopen = () => {
            log('DataChannel open');
            setConnected(true);
        };
        dc.onclose = () => {
            log('DataChannel closed');
            setConnected(false);
        };
        dc.onerror = (e) => {
            log(`DataChannel error: ${String(e)}`);
        };
        dc.onmessage = (e) => {
            try {
                const evt: RealtimeEvent = JSON.parse(e.data);

                // testo: copri sia response.delta con delta.type === 'output_text'
                // sia response.output_text.delta
                if (evt.type === 'response.delta' && evt.delta?.type === 'output_text') {
                    setTranscript(prev => prev + (evt.delta.text || ''));
                } else if (evt.type === 'response.output_text.delta') {
                    const chunk = evt.delta?.text ?? evt.delta ?? '';
                    setTranscript(prev => prev + (typeof chunk === 'string' ? chunk : ''));
                } else if (evt.type === 'response.completed') {
                    log('Response completed');
                } else if (evt.type === 'response.error') {
                    log(`Response error: ${JSON.stringify(evt.error)}`);
                }
            } catch {
                log(`Non-JSON message: ${e.data}`);
            }
        };

        // Audio OUT (remote)
        if (enableAudioOut) {
            const remoteStream = new MediaStream();
            remoteStreamRef.current = remoteStream;
            pc.ontrack = (event) => {
                const [stream] = event.streams;
                stream.getAudioTracks().forEach(track => remoteStream.addTrack(track));
                if (audioOutRef.current) {
                    audioOutRef.current.srcObject = remoteStream;
                    audioOutRef.current.play().catch(() => {
                        // se il browser blocca l’autoplay, l’utente può usare i controls
                    });
                }
            };

            // garantisce m=audio per ricezione
            pc.addTransceiver('audio', { direction: 'recvonly' });
        }

        // Audio IN (microfono)
        if (enableMicrophone) {
            const local = await navigator.mediaDevices.getUserMedia({ audio: true });
            localStreamRef.current = local;
            local.getTracks().forEach(track => pc.addTrack(track, local));
        }

        // Se non abbiamo né mic né audio out, aggiungiamo comunque un transceiver audio
        if (!enableMicrophone && !enableAudioOut) {
            pc.addTransceiver('audio', { direction: 'recvonly' });
        }

        // Crea SDP offer (senza opzioni deprecate)
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        // Scambio SDP con OpenAI Realtime
        const modelForUrl = encodeURIComponent(session?.model || model || 'gpt-4o-realtime-preview-2024-12-17');
        const resp = await fetch(`https://api.openai.com/v1/realtime?model=${modelForUrl}`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${ephemeralKey}`,
                'Content-Type': 'application/sdp',
                'OpenAI-Beta': 'realtime=v1',
            },
            body: offer.sdp,
        });

        if (!resp.ok) {
            const errText = await resp.text();
            throw new Error(`Realtime SDP exchange failed: ${resp.status} ${errText}`);
        }

        const answerSdp = await resp.text();
        await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

        log('WebRTC connected');
    }, [fetchEphemeralSession, log]);

    const disconnect = useCallback(() => {
        try {
            dcRef.current?.close();
            pcRef.current?.getSenders().forEach(s => s.track?.stop());
            pcRef.current?.close();
            localStreamRef.current?.getTracks().forEach(t => t.stop());
            remoteStreamRef.current?.getTracks().forEach(t => t.stop());
        } finally {
            dcRef.current = null;
            pcRef.current = null;
            localStreamRef.current = null;
            remoteStreamRef.current = null;
            setConnected(false);
            log('Disconnected');
        }
    }, [log]);

    const sendUserText = useCallback((text: string) => {
        const dc = dcRef.current;
        if (!dc || dc.readyState !== 'open') return;
        // Invia una richiesta di risposta testuale
        const msg = {
            type: 'response.create',
            response: {
                modalities: ['text'],
                instructions: text,
            },
        };
        dc.send(JSON.stringify(msg));
    }, []);

    const startVoiceResponse = useCallback((instructions: string) => {
        const dc = dcRef.current;
        if (!dc || dc.readyState !== 'open') return;
        const msg = {
            type: 'response.create',
            response: {
                modalities: ['audio', 'text'],
                instructions,
            },
        };
        dc.send(JSON.stringify(msg));
    }, []);

    useEffect(() => {
        return () => {
            // cleanup on unmount
            try { disconnect(); } catch { }
        };
    }, [disconnect]);

    return (
        <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                    onClick={() =>
                        connect({
                            enableMicrophone: true,  // metti true per voce in
                            enableAudioOut: true,    // metti true per voce out
                        }).catch(e => log(String(e)))
                    }
                    disabled={connected}
                >
                    Connect
                </button>
                <button onClick={disconnect} disabled={!connected}>
                    Disconnect
                </button>
                <button
                    onClick={() => {
                        const t = prompt('Scrivi un prompt testuale', 'Dimmi una curiosità sulle stelle');
                        if (t) {
                            setTranscript('');
                            sendUserText(t);
                        }
                    }}
                    disabled={!connected}
                >
                    Send text
                </button>
                <button
                    onClick={() => {
                        const t = prompt('Prompt voce (audio out, richiede connect con enableAudioOut=true)', 'Raccontami una barzelletta');
                        if (t) startVoiceResponse(t);
                    }}
                    disabled={!connected}
                >
                    Voice reply
                </button>
            </div>

            <div style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', padding: 8, border: '1px solid #ddd', borderRadius: 6 }}>
                {transcript || 'Output testuale progressivo...'}
            </div>

            <audio ref={audioOutRef} autoPlay controls />

            <div style={{ fontFamily: 'monospace', fontSize: 12, opacity: 0.8 }}>
                {logs.map((l, i) => (
                    <div key={i}>{l}</div>
                ))}
            </div>
        </div>
    );
}