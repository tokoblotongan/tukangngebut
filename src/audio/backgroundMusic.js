/* backgroundMusic.js — musik latar ceria orisinal (Web Audio, tanpa file) */
const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);

const THEMES = {
  salatiga:  { bpm: 122, root: 60 },
  skyway:    { bpm: 130, root: 62 },
  mandalika: { bpm: 136, root: 65 },
};
// Progresi: I - vi - IV - V (offset akar, interval akor)
const BARS = [
  { r: 0,  c: [0, 4, 7] },
  { r: -3, c: [0, 3, 7] },
  { r: -7, c: [0, 4, 7] },
  { r: -5, c: [0, 4, 7] },
];
// Melodi pentatonik per bar (8 not per bar, null = diam), nilai = semitone dari akar
const MELODY = [
  [12, null, 16, null, 19, 16, null, 14],
  [12, null, 15, null, 19, 15, null, 12],
  [12, 14, 16, null, 21, null, 19, null],
  [14, null, 19, 16, 14, null, 12, null],
];

export function createBackgroundMusic({ ensureContext, getMaster, isMuted }) {
  const BASE_VOL = 0.11;
  let ac = null, bus = null, timer = null;
  let nextTime = 0, step = 0, running = false, paused = false;
  let theme = THEMES.salatiga, boost = false, kids = false;

  function vol() {
    if (isMuted?.()) return 0;
    return BASE_VOL * (kids ? 0.85 : 1) * (boost ? 1.15 : 1);
  }

  function ensureBus() {
    const nextAc = ensureContext?.();
    const master = getMaster?.();
    if (!nextAc || !master) return false;
    if (ac !== nextAc || !bus) {
      try { bus?.disconnect(); } catch {}
      ac = nextAc;
      bus = ac.createGain();
      bus.gain.value = running && !paused ? vol() : 0;
      bus.connect(master);
    }
    return true;
  }

  function tone(time, freq, dur, type = 'triangle', gainVal = 0.25, filterHz = 2200) {
    if (!ac || !bus) return;
    const osc = ac.createOscillator();
    const filter = ac.createBiquadFilter();
    const amp = ac.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterHz, time);

    const attack = Math.min(0.015, dur * 0.25);
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainVal), time + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    osc.connect(filter);
    filter.connect(amp);
    amp.connect(bus);

    osc.start(time);
    osc.stop(time + dur + 0.03);
  }

  function kick(time) {
    if (!ac || !bus) return;
    const osc = ac.createOscillator();
    const amp = ac.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(132, time);
    osc.frequency.exponentialRampToValueAtTime(44, time + 0.1);

    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.exponentialRampToValueAtTime(0.28, time + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + 0.12);

    osc.connect(amp);
    amp.connect(bus);

    osc.start(time);
    osc.stop(time + 0.14);
  }

  function stepDuration() {
    const bpm = theme.bpm * (boost ? 1.07 : 1);
    return (60 / bpm) / 2;
  }

  function playStep(time, s) {
    if (!ac || !bus || isMuted?.()) return;
    const barIdx = Math.floor(s / 8) % BARS.length;
    const beat = s % 8;
    const bar = BARS[barIdx];
    const root = theme.root;
    const stepDur = stepDuration();

    if (beat === 0 || beat === 4 || (boost && beat === 6)) {
      kick(time);
    }

    if (beat % 2 === 0) {
      tone(time, hz(root + bar.r - 12), stepDur * 1.35, 'triangle', 0.24, 900);
    } else {
      const chordTone = bar.c[((beat - 1) >> 1) % bar.c.length];
      tone(time, hz(root + bar.r + chordTone), stepDur * 0.85, 'sine', 0.13, 1800);
    }

    const mel = MELODY[barIdx][beat];
    if (mel !== null && mel !== undefined) {
      tone(
        time,
        hz(root + mel),
        stepDur * 1.45,
        kids ? 'sine' : 'triangle',
        0.26,
        kids ? 1900 : 2600
      );
    }
  }

  function schedule() {
    if (!running || paused || !ac || !bus) return;
    const lookahead = 0.12;
    const now = ac.currentTime;
    if (nextTime < now - 0.08) nextTime = now + 0.02;
    while (nextTime < now + lookahead) {
      playStep(nextTime, step++);
      nextTime += stepDuration();
    }
  }

  function refreshMute() {
    if (!bus || !ac) return;
    const t = ac.currentTime;
    bus.gain.cancelScheduledValues(t);
    bus.gain.setTargetAtTime(running && !paused ? vol() : 0, t, 0.05);
  }

  function start(arenaId = 'salatiga') {
    theme = THEMES[arenaId] || THEMES.salatiga;
    if (!ensureBus()) return;
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    running = true;
    paused = false;
    step = 0;
    nextTime = ac.currentTime + 0.04;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    refreshMute();
    schedule();
    timer = setInterval(schedule, 30);
  }

  function stop() {
    running = false;
    paused = false;
    boost = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (bus && ac) {
      const t = ac.currentTime;
      bus.gain.cancelScheduledValues(t);
      bus.gain.setTargetAtTime(0, t, 0.04);
    }
  }

  function pause() {
    if (!running || paused) return;
    paused = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (bus && ac) {
      const t = ac.currentTime;
      bus.gain.cancelScheduledValues(t);
      bus.gain.setTargetAtTime(0, t, 0.04);
    }
  }

  function resume() {
    if (!running || !paused) return;
    if (!ensureBus()) return;
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    paused = false;
    nextTime = ac.currentTime + 0.04;
    if (!timer) timer = setInterval(schedule, 30);
    refreshMute();
    schedule();
  }

  function duck(ms = 950) {
    if (!running || paused || !bus || !ac || isMuted?.()) return;
    const t = ac.currentTime;
    const target = vol();
    bus.gain.cancelScheduledValues(t);
    bus.gain.setTargetAtTime(target * 0.24, t, 0.04);
    bus.gain.setTargetAtTime(target, t + ms / 1000, 0.14);
  }

  function setBoost(on) {
    const next = !!on;
    if (boost === next) return;
    boost = next;
    refreshMute();
  }

  function setKidsMode(on) {
    const next = !!on;
    if (kids === next) return;
    kids = next;
    refreshMute();
  }

  function dispose() {
    stop();
    try { bus?.disconnect(); } catch {}
    bus = null;
    ac = null;
  }

  return {
    start,
    stop,
    pause,
    resume,
    duck,
    setBoost,
    setKidsMode,
    refreshMute,
    dispose,
  };
}
