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
    const animationFrameRef = useRef<number | null>(null);
    const setAudioLevel = useAudioStore((state) => state.setAudioLevel);

    const log = useCallback((m: string) => {
        setLogs(prev => [m, ...prev].slice(0, 200));
    }, []);

    // Setup audio analyzer - chiamato DOPO che WebRTC è connesso
    const setupAudioAnalyzer = useCallback(async () => {
        // Aspetta che ci sia un srcObject valido
        if (!audioOutRef.current?.srcObject) {
            log('❌ No srcObject yet, retrying...');
            setTimeout(() => setupAudioAnalyzer(), 100);
            return;
        }
        
        // Se analyzer già esiste, non ricreare
        if (analyserRef.current) {
            log('⚠️ Analyzer already exists');
            return;
        }

        try {
            log('🎤 Creating audio analyzer...');
            
            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            audioContextRef.current = audioContext;
            log(`🔊 AudioContext state: ${audioContext.state}`);

            // Resume context se sospeso
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
                // log('✅ AudioContext resumed');
            }

            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 2048; // Più grande per time domain
            analyser.smoothingTimeConstant = 0.8;
            analyserRef.current = analyser;

            // Crea source dall'elemento audio
            const source = audioContext.createMediaElementSource(audioOutRef.current);
            source.connect(analyser);
            analyser.connect(audioContext.destination);
            
            // log('✅ Audio analyzer connected!');

            const bufferLength = analyser.fftSize;
            const dataArray = new Uint8Array(bufferLength);
            let frameCount = 0;

            const updateVolume = () => {
                if (!analyserRef.current) return;
                
                // Usa time domain invece di frequency
                analyserRef.current.getByteTimeDomainData(dataArray);
                
                // Calcola RMS (Root Mean Square) per volume più accurato
                let sum = 0;
                for (let i = 0; i < dataArray.length; i++) {
                    const normalized = (dataArray[i] - 128) / 128; // Normalizza a -1 to 1
                    sum += normalized * normalized;
                }
                const rms = Math.sqrt(sum / dataArray.length);
                
                // Log dettagliato ogni 30 frame (circa 0.5 secondi)
                // if (frameCount++ % 30 === 0) {
                //     log(`📊 Time domain - RMS: ${rms.toFixed(3)}, First values: ${dataArray[0]}, ${dataArray[1]}, ${dataArray[2]}`);
                // }
                
                // Scala il volume (RMS è di solito tra 0 e 0.5 per parlato normale)
                const normalizedVolume = Math.min(1, rms * 3);
                
                // Aggiorna store
                setAudioLevel(normalizedVolume);
                
                animationFrameRef.current = requestAnimationFrame(updateVolume);
            };

            updateVolume();
            // log('🎯 Volume monitoring active');
        } catch (error) {
            log(`❌ Audio analyzer error: ${error}`);
        }
    }, [log, setAudioLevel]);

    const stopAudioAnalyzer = useCallback(() => {
        if (animationFrameRef.current !== null) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }
        setAudioLevel(0);
    }, [setAudioLevel]);

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
                log('🎵 Received audio track from WebRTC');
                const [stream] = event.streams;
                const tracks = stream.getAudioTracks();
                log(`📡 Number of audio tracks: ${tracks.length}`);
                
                tracks.forEach(track => {
                    remoteStream.addTrack(track);
                    log(`🎧 Track state: ${track.readyState}, enabled: ${track.enabled}`);
                });
                
                if (audioOutRef.current) {
                    audioOutRef.current.srcObject = remoteStream;
                    // log('✅ Audio srcObject set');
                    
                    // Prova a fare play
                    audioOutRef.current.play()
                        .then(() => log('▶️ Audio playing'))
                        .catch(e => log(`⏸️ Audio play failed: ${e}`));
                    
                    // Setup analyzer DOPO aver settato srcObject
                    setTimeout(() => {
                        log('⏰ Starting analyzer setup...');
                        setupAudioAnalyzer();
                    }, 500);
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
            if (audioContextRef.current) {
                audioContextRef.current.close();
                audioContextRef.current = null;
            }
            analyserRef.current = null;
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

    // NON serve più ascoltare gli eventi play/pause/ended
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
            <div className='flex mt-8 gap-x-8 items-center justify-center'  >
                <button className='border w-32 border-green-800 rounded-lg p-4 '
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
                <button className='border w-32 border-red-800 rounded-lg p-4 ' onClick={disconnect} disabled={!connected}>
                    Disconnetti
                </button>
                {/* <button
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
                </button> */}
                {/* <button
                    onClick={() => {
                        const t = prompt('Prompt voce (audio out)', 'Raccontami una barzelletta');
                        if (t) startVoiceResponse(t);
                    }}
                    disabled={!connected}
                >
                    Voice reply
                </button> */}
            </div>

            {/* <div style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', padding: 8, border: '1px solid #ddd', borderRadius: 6 }}>
                {transcript || 'Output testuale progressivo...'}
            </div> */}

            <audio className='-z-999' ref={audioOutRef} autoPlay controls />

            <div style={{ fontFamily: 'monospace', fontSize: 12, opacity: 0.8 }}>
                {logs.map((l, i) => (
                    <div key={i}>{l}</div>
                ))}
            </div>
        </div>
    );
}