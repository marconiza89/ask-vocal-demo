import { create } from 'zustand';

interface AudioStore {
    audioLevel: number; // 0-1
    setAudioLevel: (level: number) => void;
}

export const useAudioStore = create<AudioStore>((set) => ({
    audioLevel: 0,
    setAudioLevel: (level) => {
        set({ audioLevel: level });
        console.log('Audio level set to', level);
    },
    
}));