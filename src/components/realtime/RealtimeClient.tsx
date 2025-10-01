'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAudioStore } from '../r3f/UseAudio';

type RealtimeEvent = {
    type: string;
    [key: string]: any;
};

type ConnectOptions = {
    model?: string;
    enableMicrophone?: boolean;
    enableAudioOut?: boolean;
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
    
    // Audio analysis refs
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const animationFrameRef = useRef<number | null>(null);
    const setAudioLevel = useAudioStore((state) => state.setAudioLevel);

    const log = useCallback((m: string) => {
        setLogs(prev => [m, ...prev].slice(0, 200));
    }, []);

    // Setup audio analyzer - ora usa MediaStream direttamente
    const setupAudioAnalyzer = useCallback(async (stream: MediaStream) => {
        // Cleanup precedente se esiste
        if (analyserRef.current) {
            // log('⚠️ Cleaning up previous analyzer');
            stopAudioAnalyzer();
        }

        try {
            // log('🎤 Creating audio analyzer from MediaStream...');
            
            // Verifica che lo stream abbia tracce audio
            const audioTracks = stream.getAudioTracks();
            if (audioTracks.length === 0) {
                // log('❌ No audio tracks in stream');
                return;
            }
            // log(`✅ Found ${audioTracks.length} audio track(s)`);

            // Crea o riusa AudioContext
            if (!audioContextRef.current) {
                const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
                audioContextRef.current = new AudioContextClass();
            }
            
            const audioContext = audioContextRef.current;
            
            // Resume se necessario
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
                // log('✅ AudioContext resumed');
            }

            // Crea analyzer con settings ottimizzati per speech
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256; // Più piccolo per risposta più veloce
            analyser.smoothingTimeConstant = 0.3; // Meno smoothing per più reattività
            analyser.minDecibels = -90;
            analyser.maxDecibels = -10;
            analyserRef.current = analyser;

            // Crea source dal MediaStream invece che dall'elemento audio
            const source = audioContext.createMediaStreamSource(stream);
            sourceRef.current = source;
            source.connect(analyser);
            // Non connettere a destination per evitare feedback
            
            // log('✅ Audio analyzer connected to stream!');

            // Buffer per l'analisi
            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            let silenceCounter = 0;
            const SILENCE_THRESHOLD = 10; // frames di silenzio prima di settare a 0

            const updateVolume = () => {
                if (!analyserRef.current) return;
                
                // Usa frequency data che è più affidabile per il volume
                analyserRef.current.getByteFrequencyData(dataArray);
                
                // Calcola la media pesata (più peso alle frequenze vocali 85-255 Hz)
                let sum = 0;
                let count = 0;
                
                // Focus sulle frequenze vocali (circa indici 2-20 per speech)
                for (let i = 2; i < Math.min(20, dataArray.length); i++) {
                    sum += dataArray[i];
                    count++;
                }
                
                // Media normalizzata
                const average = count > 0 ? (sum / count) / 255 : 0;
                
                // Applica una curva per rendere il volume più naturale
                const scaledVolume = Math.pow(average, 0.8) * 2; // Esponente < 1 per più sensibilità
                const normalizedVolume = Math.min(1, scaledVolume);
                
                // Gestione del silenzio con isteresi
                if (normalizedVolume < 0.01) {
                    silenceCounter++;
                    if (silenceCounter > SILENCE_THRESHOLD) {
                        setAudioLevel(0);
                    }
                } else {
                    silenceCounter = 0;
                    setAudioLevel(normalizedVolume);
                }
                
                // Log dettagliato ogni secondo circa
                if (Math.random() < 0.016) { // ~1 volta al secondo a 60fps
                    const maxValue = Math.max(...Array.from(dataArray));
                    // log(`📊 Audio: avg=${average.toFixed(3)}, scaled=${normalizedVolume.toFixed(3)}, max=${maxValue}`);
                }
                
                animationFrameRef.current = requestAnimationFrame(updateVolume);
            };

            // Inizia il monitoring
            updateVolume();
            // log('🎯 Volume monitoring active on stream');
            
        } catch (error) {
            // log(`❌ Audio analyzer error: ${error}`);
            console.error('Audio analyzer error:', error);
        }
    }, [log, setAudioLevel]);

    const stopAudioAnalyzer = useCallback(() => {
        // Stop animation frame
        if (animationFrameRef.current !== null) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }
        
        // Disconnect source
        if (sourceRef.current) {
            try {
                sourceRef.current.disconnect();
            } catch (e) {
                // Ignore disconnect errors
            }
            sourceRef.current = null;
        }
        
        // Reset analyzer
        analyserRef.current = null;
        
        // Reset audio level
        setAudioLevel(0);
        
        // log('🛑 Audio analyzer stopped');
    }, [setAudioLevel, log]);

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
                log('Received audio track from WebRTC');
                const [stream] = event.streams;
                const tracks = stream.getAudioTracks();
                // log(`📡 Number of audio tracks: ${tracks.length}`);
                
                tracks.forEach(track => {
                    remoteStream.addTrack(track);
                    log(` Track state: ${track.readyState}, enabled: ${track.enabled}`);
                });
                
                // Set audio element source
                if (audioOutRef.current) {
                    audioOutRef.current.srcObject = remoteStream;
                    // log('✅ Audio element srcObject set');
                    
                    // Play audio
                    audioOutRef.current.play()
                        .then(() => {
                            // log('▶️ Audio playing');
                            // Setup analyzer direttamente con lo stream
                            setupAudioAnalyzer(remoteStream);
                        })
                        .catch(e => log(`⏸️ Audio play failed: ${e}`));
                }
            };

            pc.addTransceiver('audio', { direction: 'recvonly' });
        }

        // Audio IN (microfono)
        if (enableMicrophone) {
            const local = await navigator.mediaDevices.getUserMedia({ audio: true });
            localStreamRef.current = local;
            local.getTracks().forEach(track => pc.addTrack(track, local));
        }

        // Se non abbiamo né mic né audio out
        if (!enableMicrophone && !enableAudioOut) {
            pc.addTransceiver('audio', { direction: 'recvonly' });
        }

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

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
    }, [fetchEphemeralSession, log, setupAudioAnalyzer]);

    const disconnect = useCallback(() => {
        try {
            stopAudioAnalyzer();
            dcRef.current?.close();
            pcRef.current?.getSenders().forEach(s => s.track?.stop());
            pcRef.current?.close();
            localStreamRef.current?.getTracks().forEach(t => t.stop());
            remoteStreamRef.current?.getTracks().forEach(t => t.stop());
            
            // Pulisci audio context
            if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
                audioContextRef.current.close();
                audioContextRef.current = null;
            }
        } finally {
            dcRef.current = null;
            pcRef.current = null;
            localStreamRef.current = null;
            remoteStreamRef.current = null;
            setConnected(false);
            log('Disconnected');
        }
    }, [log, stopAudioAnalyzer]);

    const sendUserText = useCallback((text: string) => {
        const dc = dcRef.current;
        if (!dc || dc.readyState !== 'open') return;
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

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            try { 
                stopAudioAnalyzer();
                disconnect(); 
            } catch { }
        };
    }, [disconnect, stopAudioAnalyzer]);

    return (
        <div className='text-neutral-100 flex flex-col items-center justify-center ' style={{ display: 'grid', gap: 8 }}>
            <div className='flex mt-8 gap-x-8 items-center justify-center'>
                <button className='border bg-blue-800/20 w-32 border-blue-800 rounded-lg p-4'
                    onClick={() =>
                        connect({
                            enableMicrophone: true,
                            enableAudioOut: true,
                        }).catch(e => log(String(e)))
                    }
                    disabled={connected}
                >
                    Connetti
                </button>
                <button className='border bg-red-800/20 w-32 border-red-800 rounded-lg p-4' onClick={disconnect} disabled={!connected}>
                    Disconnetti
                </button>
            </div>

            <audio className='-z-999' ref={audioOutRef} autoPlay controls />

            <div style={{ fontFamily: 'monospace', fontSize: 12, opacity: 0.8 }}>
                {logs.map((l, i) => (
                    <div key={i}>{l}</div>
                ))}
            </div>
        </div>
    );
}