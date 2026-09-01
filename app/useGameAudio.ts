"use client";

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

export type SfxName = "reveal" | "flag" | "help" | "win" | "lose" | "click";
// bgm is an array — the mini-tool zip embeds every BGM track it has (see
// scripts/package-minitool.mjs) so playback can rotate between them instead
// of always looping a single clip.
type EmbeddedAudioMap = { bgm: string[] } & Record<SfxName, string>;

type AudioSettings = {
  musicEnabled: boolean;
  sfxEnabled: boolean;
  musicLoop: boolean;
  musicVolume: number;
  sfxVolume: number;
};

type AudioWindow = Window & {
  __BAKERY_AUDIO__?: EmbeddedAudioMap;
  __BAKERY_AUDIO_LOADING__?: Promise<EmbeddedAudioMap>;
  webkitAudioContext?: typeof AudioContext;
};

const AUDIO_ROOT = "audio";
const SFX_CACHE_VERSION = "20260828-2";
const STORAGE_KEY = "bakery-audio-settings";
const DEFAULT_SETTINGS: AudioSettings = {
  musicEnabled: true,
  sfxEnabled: true,
  musicLoop: true,
  musicVolume: 0.22,
  sfxVolume: 0.72,
};

const SFX_MIX: Record<SfxName, { gain: number; duck: number; duration: number }> = {
  reveal: { gain: 0.92, duck: 0.72, duration: 360 },
  flag: { gain: 0.9, duck: 0.68, duration: 360 },
  help: { gain: 0.96, duck: 0.48, duration: 570 },
  win: { gain: 1, duck: 0.08, duration: 2150 },
  lose: { gain: 0.95, duck: 0.2, duration: 700 },
  click: { gain: 0.82, duck: 1, duration: 180 },
};

const SFX_NAMES = Object.keys(SFX_MIX) as SfxName[];

// Extra variants are optional — files that don't exist yet just 404 silently
// and playback falls back to the base (no-suffix) file, so this is safe to
// ship before the matching audio assets exist.
const SFX_VARIANT_SUFFIXES = ["", "-b", "-c"];
const BGM_TRACK_BASENAMES = ["bakery-loop", "bakery-loop-2", "bakery-loop-3", "bakery-loop-4"];

function pickRandomBgmTrack() {
  return BGM_TRACK_BASENAMES[Math.floor(Math.random() * BGM_TRACK_BASENAMES.length)];
}

function embeddedAudioBundlePath() {
  return document.documentElement.dataset.audioBundle ?? "";
}

function loadEmbeddedAudioData() {
  const audioWindow = window as AudioWindow;
  if (audioWindow.__BAKERY_AUDIO__) return Promise.resolve(audioWindow.__BAKERY_AUDIO__);
  if (audioWindow.__BAKERY_AUDIO_LOADING__) return audioWindow.__BAKERY_AUDIO_LOADING__;

  const bundlePath = embeddedAudioBundlePath();
  if (!bundlePath) return Promise.reject(new Error("No embedded audio bundle configured"));

  audioWindow.__BAKERY_AUDIO_LOADING__ = new Promise<EmbeddedAudioMap>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = bundlePath;
    script.async = true;
    script.addEventListener("load", () => {
      if (audioWindow.__BAKERY_AUDIO__) resolve(audioWindow.__BAKERY_AUDIO__);
      else reject(new Error("Embedded audio bundle did not initialize"));
    }, { once: true });
    script.addEventListener("error", () => reject(new Error("Embedded audio bundle failed to load")), { once: true });
    document.head.append(script);
  });
  return audioWindow.__BAKERY_AUDIO_LOADING__;
}

function decodeBase64Audio(base64: string) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function useGameAudioController(gamePaused = false) {
  const [musicEnabled, setMusicEnabled] = useState(DEFAULT_SETTINGS.musicEnabled);
  const [sfxEnabled, setSfxEnabled] = useState(DEFAULT_SETTINGS.sfxEnabled);
  const [musicLoop, setMusicLoop] = useState(DEFAULT_SETTINGS.musicLoop);
  const [musicVolume, setMusicVolume] = useState(DEFAULT_SETTINGS.musicVolume);
  const [sfxVolume, setSfxVolume] = useState(DEFAULT_SETTINGS.sfxVolume);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);

  const embeddedModeRef = useRef(false);
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  const sfxRef = useRef<Partial<Record<SfxName, HTMLAudioElement[]>>>({});
  const webAudioRef = useRef<AudioContext | null>(null);
  const webBgmGainRef = useRef<GainNode | null>(null);
  const webBgmSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const webBgmStartingRef = useRef<Promise<void> | null>(null);
  const webBuffersRef = useRef<Partial<Record<SfxName, AudioBuffer>>>({});
  const webBgmBuffersRef = useRef<AudioBuffer[]>([]);
  const startEmbeddedBgmRef = useRef<() => void>(() => undefined);
  const webSfxSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const duckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warmIdleRef = useRef<number | null>(null);
  const sfxWarmScheduledRef = useRef(false);
  const unlockedRef = useRef(false);
  const duckFactorRef = useRef(1);
  const gamePausedRef = useRef(gamePaused);
  const musicEnabledRef = useRef(musicEnabled);
  const sfxEnabledRef = useRef(sfxEnabled);
  const musicLoopRef = useRef(musicLoop);
  const musicVolumeRef = useRef(musicVolume);
  const sfxVolumeRef = useRef(sfxVolume);

  const ensureWebAudioContext = useCallback(() => {
    let context = webAudioRef.current;
    if (!context) {
      const audioWindow = window as AudioWindow;
      const AudioContextClass = window.AudioContext ?? audioWindow.webkitAudioContext;
      if (!AudioContextClass) throw new Error("Web Audio is unavailable");
      context = new AudioContextClass();
      const bgmGain = context.createGain();
      bgmGain.connect(context.destination);
      webAudioRef.current = context;
      webBgmGainRef.current = bgmGain;
    }
    if (context.state === "suspended") void context.resume().catch(() => undefined);
    return context;
  }, []);

  const updateWebBgmGain = useCallback(() => {
    const context = webAudioRef.current;
    const gain = webBgmGainRef.current;
    if (!context || !gain) return;
    const volume = musicEnabledRef.current && !gamePausedRef.current
      ? Math.min(1, musicVolumeRef.current * duckFactorRef.current)
      : 0;
    gain.gain.setValueAtTime(volume, context.currentTime);
  }, []);

  const decodeEmbeddedAudio = useCallback(async (name: SfxName) => {
    const cached = webBuffersRef.current[name];
    if (cached) return cached;
    const context = ensureWebAudioContext();
    const audioData = await loadEmbeddedAudioData();
    const buffer = await context.decodeAudioData(decodeBase64Audio(audioData[name]));
    webBuffersRef.current[name] = buffer;
    return buffer;
  }, [ensureWebAudioContext]);

  const decodeEmbeddedBgmBuffers = useCallback(async () => {
    if (webBgmBuffersRef.current.length) return webBgmBuffersRef.current;
    const context = ensureWebAudioContext();
    const audioData = await loadEmbeddedAudioData();
    const buffers = await Promise.all(audioData.bgm.map((track) => context.decodeAudioData(decodeBase64Audio(track))));
    webBgmBuffersRef.current = buffers;
    return buffers;
  }, [ensureWebAudioContext]);

  // Embedded bgm sources never natively loop — "循环播放" is implemented as
  // picking a fresh random track each time the current one ends, so the
  // mini-tool zip rotates through all its BGM instead of repeating one clip.
  const startEmbeddedBgm = useCallback(() => {
    if (webBgmSourceRef.current || webBgmStartingRef.current || gamePausedRef.current || !musicEnabledRef.current) return;
    ensureWebAudioContext();
    webBgmStartingRef.current = (async () => {
      const context = ensureWebAudioContext();
      const buffers = await decodeEmbeddedBgmBuffers();
      if (webBgmSourceRef.current || gamePausedRef.current || !musicEnabledRef.current || !buffers.length) return;
      const source = context.createBufferSource();
      source.buffer = buffers[Math.floor(Math.random() * buffers.length)];
      source.connect(webBgmGainRef.current!);
      source.addEventListener("ended", () => {
        if (webBgmSourceRef.current !== source) return;
        webBgmSourceRef.current = null;
        if (musicLoopRef.current && musicEnabledRef.current && !gamePausedRef.current) startEmbeddedBgmRef.current?.();
      });
      webBgmSourceRef.current = source;
      updateWebBgmGain();
      source.start();
    })().catch(() => undefined).finally(() => {
      webBgmStartingRef.current = null;
    });
  }, [decodeEmbeddedBgmBuffers, ensureWebAudioContext, updateWebBgmGain]);
  useEffect(() => {
    startEmbeddedBgmRef.current = startEmbeddedBgm;
  }, [startEmbeddedBgm]);

  const duckBgm = useCallback((factor: number, duration: number) => {
    if (!musicEnabledRef.current || factor >= 1) return;
    if (duckTimerRef.current) clearTimeout(duckTimerRef.current);
    duckFactorRef.current = factor;
    if (bgmRef.current) bgmRef.current.volume = Math.min(1, musicVolumeRef.current * factor);
    updateWebBgmGain();
    duckTimerRef.current = setTimeout(() => {
      duckFactorRef.current = 1;
      if (bgmRef.current) bgmRef.current.volume = musicVolumeRef.current;
      updateWebBgmGain();
    }, duration);
  }, [updateWebBgmGain]);

  const warmSfx = useCallback(() => {
    if (sfxWarmScheduledRef.current) return;
    sfxWarmScheduledRef.current = true;
    const warm = () => {
      if (embeddedModeRef.current) {
        void Promise.all(SFX_NAMES.map((name) => decodeEmbeddedAudio(name))).catch(() => undefined);
        return;
      }
      SFX_NAMES.forEach((name) => {
        if (sfxRef.current[name]) return;
        sfxRef.current[name] = SFX_VARIANT_SUFFIXES.map((suffix, variantIndex) => {
          const sound = new Audio(`${AUDIO_ROOT}/sfx/${name}${suffix}.mp3?v=${SFX_CACHE_VERSION}`);
          // Only eagerly fetch the guaranteed base clip; extra variants are
          // loaded on demand the first time they're actually picked to play,
          // so a project with no variant files yet doesn't spam 404s upfront.
          sound.preload = variantIndex === 0 ? "auto" : "none";
          if (variantIndex === 0) sound.load();
          return sound;
        });
      });
    };
    if ("requestIdleCallback" in window) warmIdleRef.current = window.requestIdleCallback(warm, { timeout: 1200 });
    else warmTimerRef.current = setTimeout(warm, 220);
  }, [decodeEmbeddedAudio]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<AudioSettings>;
        if (typeof parsed.musicEnabled === "boolean") setMusicEnabled(parsed.musicEnabled);
        if (typeof parsed.sfxEnabled === "boolean") setSfxEnabled(parsed.sfxEnabled);
        if (typeof parsed.musicLoop === "boolean") setMusicLoop(parsed.musicLoop);
        if (typeof parsed.musicVolume === "number") setMusicVolume(Math.min(1, Math.max(0, parsed.musicVolume)));
        if (typeof parsed.sfxVolume === "number") setSfxVolume(Math.min(1, Math.max(0, parsed.sfxVolume)));
      }
    } catch {
      // Keep friendly defaults if older device storage cannot be parsed.
    }
    setSettingsReady(true);
  }, []);

  useEffect(() => {
    embeddedModeRef.current = Boolean(embeddedAudioBundlePath());
    if (!embeddedModeRef.current) {
      const bgm = new Audio();
      bgm.preload = "none";
      bgm.loop = musicLoopRef.current;
      bgm.volume = musicVolumeRef.current;
      // Non-looping playback rotates to a fresh random track instead of just stopping.
      bgm.addEventListener("ended", () => {
        if (!musicEnabledRef.current || gamePausedRef.current) return;
        bgm.src = `${AUDIO_ROOT}/bgm/${pickRandomBgmTrack()}.mp3`;
        void bgm.play().catch(() => undefined);
      });
      // Extra tracks may not exist yet — fall back to the guaranteed base track.
      bgm.addEventListener("error", () => {
        if (bgm.src.endsWith("/bakery-loop.mp3")) return;
        bgm.src = `${AUDIO_ROOT}/bgm/bakery-loop.mp3`;
        if (musicEnabledRef.current && !gamePausedRef.current && unlockedRef.current) void bgm.play().catch(() => undefined);
      });
      bgmRef.current = bgm;
    }
    return () => {
      bgmRef.current?.pause();
      Object.values(sfxRef.current).forEach((sounds) => sounds?.forEach((sound) => sound.pause()));
      webBgmSourceRef.current?.stop();
      webSfxSourcesRef.current.forEach((source) => source.stop());
      if (webAudioRef.current) void webAudioRef.current.close().catch(() => undefined);
      if (duckTimerRef.current) clearTimeout(duckTimerRef.current);
      if (warmTimerRef.current) clearTimeout(warmTimerRef.current);
      if (warmIdleRef.current !== null && "cancelIdleCallback" in window) window.cancelIdleCallback(warmIdleRef.current);
    };
  }, []);

  useEffect(() => {
    gamePausedRef.current = gamePaused;
    musicEnabledRef.current = musicEnabled;
    sfxEnabledRef.current = sfxEnabled;
    musicLoopRef.current = musicLoop;
    musicVolumeRef.current = musicVolume;
    sfxVolumeRef.current = sfxVolume;

    if (embeddedModeRef.current) {
      if (webBgmSourceRef.current) webBgmSourceRef.current.loop = musicLoop;
      updateWebBgmGain();
      const context = webAudioRef.current;
      if (context) {
        if (gamePaused) void context.suspend().catch(() => undefined);
        else if (unlockedRef.current) {
          void context.resume().catch(() => undefined);
          if (musicEnabled) startEmbeddedBgm();
        }
      }
    } else {
      const bgm = bgmRef.current;
      if (bgm) {
        bgm.loop = musicLoop;
        bgm.volume = Math.min(1, musicVolume * duckFactorRef.current);
        if (!musicEnabled || gamePaused) bgm.pause();
        else if (unlockedRef.current) {
          if (!bgm.getAttribute("src")) bgm.src = `${AUDIO_ROOT}/bgm/${pickRandomBgmTrack()}.mp3`;
          void bgm.play().catch(() => undefined);
        }
      }
    }
    if (settingsReady) {
      const settings: AudioSettings = { musicEnabled, sfxEnabled, musicLoop, musicVolume, sfxVolume };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }
  }, [gamePaused, musicEnabled, musicLoop, musicVolume, settingsReady, sfxEnabled, sfxVolume, startEmbeddedBgm, updateWebBgmGain]);

  useEffect(() => {
    const handleVisibility = () => {
      if (embeddedModeRef.current) {
        const context = webAudioRef.current;
        if (!context) return;
        if (document.hidden) void context.suspend().catch(() => undefined);
        else if (!gamePausedRef.current && unlockedRef.current) {
          void context.resume().catch(() => undefined);
          startEmbeddedBgm();
        }
        return;
      }
      const bgm = bgmRef.current;
      if (!bgm) return;
      if (document.hidden) bgm.pause();
      else if (!gamePausedRef.current && unlockedRef.current && musicEnabledRef.current) void bgm.play().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [startEmbeddedBgm]);

  const unlockAudio = useCallback(() => {
    if (!unlockedRef.current) {
      unlockedRef.current = true;
      setAudioUnlocked(true);
    }
    if (embeddedModeRef.current) {
      try {
        ensureWebAudioContext();
        startEmbeddedBgm();
      } catch {
        // The settings UI remains available if a very old WebView lacks Web Audio.
      }
    } else {
      const bgm = bgmRef.current;
      if (bgm && !gamePausedRef.current && musicEnabledRef.current && bgm.paused) {
        if (!bgm.getAttribute("src")) bgm.src = `${AUDIO_ROOT}/bgm/${pickRandomBgmTrack()}.mp3`;
        void bgm.play().catch(() => undefined);
      }
    }
    warmSfx();
  }, [ensureWebAudioContext, startEmbeddedBgm, warmSfx]);

  const preloadAudio = useCallback(() => {
    if (embeddedAudioBundlePath()) void loadEmbeddedAudioData().catch(() => undefined);
  }, []);

  const playSfx = useCallback((name: SfxName) => {
    if (!sfxEnabledRef.current) return;
    const mix = SFX_MIX[name];
    if (embeddedModeRef.current) {
      try {
        const context = ensureWebAudioContext();
        void decodeEmbeddedAudio(name).then((buffer) => {
          if (!sfxEnabledRef.current || gamePausedRef.current) return;
          const source = context.createBufferSource();
          const gain = context.createGain();
          source.buffer = buffer;
          gain.gain.value = Math.min(1, sfxVolumeRef.current * mix.gain);
          source.connect(gain);
          gain.connect(context.destination);
          source.addEventListener("ended", () => webSfxSourcesRef.current.delete(source));
          webSfxSourcesRef.current.add(source);
          source.start();
          duckBgm(mix.duck, mix.duration);
        }).catch(() => undefined);
      } catch {
        // Ignore audio on WebViews without Web Audio rather than blocking the game.
      }
      return;
    }

    let sounds = sfxRef.current[name];
    if (!sounds) {
      sounds = SFX_VARIANT_SUFFIXES.map((suffix) => {
        const sound = new Audio(`${AUDIO_ROOT}/sfx/${name}${suffix}.mp3?v=${SFX_CACHE_VERSION}`);
        sound.preload = "none";
        return sound;
      });
      sfxRef.current[name] = sounds;
    }
    const base = sounds[0];
    const sound = sounds[Math.floor(Math.random() * sounds.length)];
    sound.pause();
    // eslint-disable-next-line react-hooks/immutability -- HTMLAudioElement playback state is imperative by design; this is exactly what refs are for.
    sound.currentTime = 0;
    sound.volume = Math.min(1, sfxVolumeRef.current * mix.gain);
    void sound.play().catch(() => {
      // The variant file may not exist yet — fall back to the guaranteed base clip.
      if (sound === base) return;
      base.pause();
      base.currentTime = 0;
      base.volume = sound.volume;
      void base.play().catch(() => undefined);
    });
    duckBgm(mix.duck, mix.duration);
  }, [decodeEmbeddedAudio, duckBgm, ensureWebAudioContext]);

  return {
    audioUnlocked,
    musicEnabled,
    musicLoop,
    musicVolume,
    playSfx,
    preloadAudio,
    setMusicEnabled,
    setMusicLoop,
    setMusicVolume,
    setSfxEnabled,
    setSfxVolume,
    sfxEnabled,
    sfxVolume,
    unlockAudio,
  };
}

type GameAudioApi = ReturnType<typeof useGameAudioController>;
type SharedGameAudio = GameAudioApi & { setSharedPaused: Dispatch<SetStateAction<boolean>> };
const GameAudioContext = createContext<SharedGameAudio | null>(null);

export function GameAudioProvider({ children }: { children: ReactNode }) {
  const [sharedPaused, setSharedPaused] = useState(false);
  const audio = useGameAudioController(sharedPaused);
  return createElement(GameAudioContext.Provider, { value: { ...audio, setSharedPaused } }, children);
}

export function useGameAudio(gamePaused = false) {
  const shared = useContext(GameAudioContext);
  const setSharedPaused = shared?.setSharedPaused;
  useEffect(() => {
    if (!setSharedPaused) return;
    setSharedPaused(gamePaused);
    return () => setSharedPaused(false);
  }, [gamePaused, setSharedPaused]);
  if (!shared) throw new Error("useGameAudio must be used inside GameAudioProvider");
  return shared as GameAudioApi;
}
