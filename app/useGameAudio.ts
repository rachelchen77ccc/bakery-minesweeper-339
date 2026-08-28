"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SfxName = "reveal" | "flag" | "help" | "win" | "lose" | "click";

type AudioSettings = {
  musicEnabled: boolean;
  sfxEnabled: boolean;
  musicLoop: boolean;
  musicVolume: number;
  sfxVolume: number;
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

export function useGameAudio(gamePaused = false) {
  const [musicEnabled, setMusicEnabled] = useState(DEFAULT_SETTINGS.musicEnabled);
  const [sfxEnabled, setSfxEnabled] = useState(DEFAULT_SETTINGS.sfxEnabled);
  const [musicLoop, setMusicLoop] = useState(DEFAULT_SETTINGS.musicLoop);
  const [musicVolume, setMusicVolume] = useState(DEFAULT_SETTINGS.musicVolume);
  const [sfxVolume, setSfxVolume] = useState(DEFAULT_SETTINGS.sfxVolume);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);

  const bgmRef = useRef<HTMLAudioElement | null>(null);
  const sfxRef = useRef<Partial<Record<SfxName, HTMLAudioElement>>>({});
  const duckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unlockedRef = useRef(false);
  const duckFactorRef = useRef(1);
  const musicEnabledRef = useRef(musicEnabled);
  const sfxEnabledRef = useRef(sfxEnabled);
  const musicVolumeRef = useRef(musicVolume);
  const sfxVolumeRef = useRef(sfxVolume);

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
    const bgm = new Audio();
    bgm.preload = "none";
    bgm.loop = musicLoop;
    bgm.volume = musicVolume;
    bgmRef.current = bgm;

    return () => {
      bgm.pause();
      Object.values(sfxRef.current).forEach((sound) => sound?.pause());
      if (duckTimerRef.current) clearTimeout(duckTimerRef.current);
    };
  }, []);

  useEffect(() => {
    musicEnabledRef.current = musicEnabled;
    sfxEnabledRef.current = sfxEnabled;
    musicVolumeRef.current = musicVolume;
    sfxVolumeRef.current = sfxVolume;

    const bgm = bgmRef.current;
    if (bgm) {
      bgm.loop = musicLoop;
      bgm.volume = Math.min(1, musicVolume * duckFactorRef.current);
      if (!musicEnabled || gamePaused) bgm.pause();
      else if (unlockedRef.current) {
        if (!bgm.getAttribute("src")) bgm.src = `${AUDIO_ROOT}/bgm/bakery-loop.mp3`;
        void bgm.play().catch(() => undefined);
      }
    }

    if (settingsReady) {
      const settings: AudioSettings = { musicEnabled, sfxEnabled, musicLoop, musicVolume, sfxVolume };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }
  }, [gamePaused, musicEnabled, musicLoop, musicVolume, settingsReady, sfxEnabled, sfxVolume]);

  useEffect(() => {
    const handleVisibility = () => {
      const bgm = bgmRef.current;
      if (!bgm) return;
      if (document.hidden) bgm.pause();
      else if (!gamePaused && unlockedRef.current && musicEnabledRef.current) void bgm.play().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [gamePaused]);

  const unlockAudio = useCallback(() => {
    if (!unlockedRef.current) {
      unlockedRef.current = true;
      setAudioUnlocked(true);
    }
    const bgm = bgmRef.current;
    if (bgm && !gamePaused && musicEnabledRef.current && bgm.paused) {
      if (!bgm.getAttribute("src")) bgm.src = `${AUDIO_ROOT}/bgm/bakery-loop.mp3`;
      void bgm.play().catch(() => undefined);
    }
  }, [gamePaused]);

  const playSfx = useCallback((name: SfxName) => {
    if (!sfxEnabledRef.current) return;
    let sound = sfxRef.current[name];
    if (!sound) {
      sound = new Audio(`${AUDIO_ROOT}/sfx/${name}.mp3?v=${SFX_CACHE_VERSION}`);
      sound.preload = "none";
      sfxRef.current[name] = sound;
    }

    const mix = SFX_MIX[name];
    sound.pause();
    sound.currentTime = 0;
    sound.volume = Math.min(1, sfxVolumeRef.current * mix.gain);
    void sound.play().catch(() => undefined);

    const bgm = bgmRef.current;
    if (!bgm || !musicEnabledRef.current || mix.duck >= 1) return;
    if (duckTimerRef.current) clearTimeout(duckTimerRef.current);
    duckFactorRef.current = mix.duck;
    bgm.volume = Math.min(1, musicVolumeRef.current * mix.duck);
    duckTimerRef.current = setTimeout(() => {
      duckFactorRef.current = 1;
      if (bgmRef.current) bgmRef.current.volume = musicVolumeRef.current;
    }, mix.duration);
  }, []);

  return {
    audioUnlocked,
    musicEnabled,
    musicLoop,
    musicVolume,
    playSfx,
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
