/* =====================================================================
   soundManager.js — Synthesizer Web Audio API "Klakson Telolet Basuri"
   Menghasilkan suara klakson angin multi-nada khas bus/angkot Nusantara:
   dual detuned sawtooth + square oscillator melalui BiquadFilterNode
   hangat (~1100 Hz, Q ~ 3) dengan 3 pola melodi ceria & flourish stunt.
   ===================================================================== */

export const HORN_VOLUME = 0.28;

/** @typedef {{ freq: number, dur: number, gap?: number }} TeloletNote */

/**
 * 3 pola melodi Klakson Telolet Basuri dalam tangga nada mayor cerah:
 * 0: Klasik viral "Te-lo-let te-lo-let te-lo-let!"
 * 1: Variasi ceria "Om Telolet Om" fanfare
 * 2: Variasi ngebut naik-turun Nusantara
 * @type {readonly (readonly TeloletNote[])[]}
 */
export const TELOLET_PATTERNS = [
  // Pola 1: C5 - E5 - G5 - E5 - C5 - G5 - A5 - G5 (klasik "Te-lo-let te-lo-let te-lo-let!")
  [
    { freq: 523.25, dur: 0.11, gap: 0.025 }, // C5
    { freq: 659.25, dur: 0.11, gap: 0.025 }, // E5
    { freq: 783.99, dur: 0.17, gap: 0.055 }, // G5
    { freq: 659.25, dur: 0.10, gap: 0.025 }, // E5
    { freq: 523.25, dur: 0.10, gap: 0.025 }, // C5
    { freq: 783.99, dur: 0.12, gap: 0.025 }, // G5
    { freq: 880.00, dur: 0.13, gap: 0.025 }, // A5
    { freq: 783.99, dur: 0.25, gap: 0.04 },  // G5
  ],
  // Pola 2: Variasi ritmis cepat "Basuri Pantura"
  [
    { freq: 783.99, dur: 0.095, gap: 0.025 }, // G5
    { freq: 783.99, dur: 0.095, gap: 0.025 }, // G5
    { freq: 880.00, dur: 0.13,  gap: 0.035 }, // A5
    { freq: 783.99, dur: 0.11,  gap: 0.025 }, // G5
    { freq: 659.25, dur: 0.10,  gap: 0.025 }, // E5
    { freq: 523.25, dur: 0.10,  gap: 0.025 }, // C5
    { freq: 587.33, dur: 0.11,  gap: 0.025 }, // D5
    { freq: 659.25, dur: 0.12,  gap: 0.025 }, // E5
    { freq: 783.99, dur: 0.24,  gap: 0.04 },  // G5
  ],
  // Pola 3: Variasi ceria menanjak "Tanjakan Salatiga"
  [
    { freq: 523.25, dur: 0.10, gap: 0.025 }, // C5
    { freq: 587.33, dur: 0.10, gap: 0.025 }, // D5
    { freq: 659.25, dur: 0.12, gap: 0.03 },  // E5
    { freq: 783.99, dur: 0.15, gap: 0.045 }, // G5
    { freq: 659.25, dur: 0.10, gap: 0.025 }, // E5
    { freq: 783.99, dur: 0.11, gap: 0.025 }, // G5
    { freq: 880.00, dur: 0.12, gap: 0.025 }, // A5
    { freq: 1046.5, dur: 0.26, gap: 0.04 },  // C6
  ],
];

/** Flourish nada tinggi "TO-LE-LOT!" saat mendarat dari Barrel Roll */
const FLOURISH_NOTES = [
  { freq: 783.99, dur: 0.095, gap: 0.02 }, // G5 - "TO"
  { freq: 987.77, dur: 0.095, gap: 0.02 }, // B5 - "LE"
  { freq: 1046.5, dur: 0.13,  gap: 0.02 }, // C6 - "LOT"
  { freq: 1318.5, dur: 0.28,  gap: 0.03 }, // E6 - "!"
];

/**
 * Membuat synthesizer Telolet Basuri yang terhubung ke AudioContext game.
 * @param {{
 *   ensureContext: () => AudioContext | null,
 *   getMaster: () => GainNode | null,
 *   isMuted: () => boolean,
 * }} deps
 */
export function createTeloletSynthesizer({ ensureContext, getMaster, isMuted }) {
  let lastTriggerMs = 0;
  let lastPatternIdx = -1;
  /** @type {Array<{ stop: () => void }>} */
  const activeVoices = [];

  function stopActiveVoices() {
    while (activeVoices.length > 0) {
      const v = activeVoices.pop();
      try { v?.stop(); } catch {}
    }
  }

  /**
   * Mensintesis satu nada klakson angin brassy:
   * dual detuned sawtooth + square → warm lowpass BiquadFilterNode (~1100Hz, Q ~ 3).
   */
  function playAirHornNote(ac, master, startTime, freq, dur, volume = 0.22, filterFreq = 1100) {
    const oscSaw = ac.createOscillator();
    const oscSq = ac.createOscillator();
    const sqMix = ac.createGain();
    const filter = ac.createBiquadFilter();
    const amp = ac.createGain();

    // Dual detuned oscillators untuk tekstur klakson angin multi-corong
    oscSaw.type = 'sawtooth';
    oscSaw.frequency.setValueAtTime(freq, startTime);
    oscSaw.detune.setValueAtTime(-7, startTime);

    oscSq.type = 'square';
    oscSq.frequency.setValueAtTime(freq, startTime);
    oscSq.detune.setValueAtTime(8, startTime);
    sqMix.gain.setValueAtTime(0.45, startTime);

    // Filter hangat khas horn angin (~1100 Hz, Q ~ 3) dengan sapuan attack cepat
    filter.type = 'lowpass';
    filter.Q.setValueAtTime(3.0, startTime);
    filter.frequency.setValueAtTime(filterFreq * 0.82, startTime);
    filter.frequency.exponentialRampToValueAtTime(filterFreq * 1.15, startTime + 0.018);
    filter.frequency.exponentialRampToValueAtTime(filterFreq, startTime + Math.max(0.04, dur * 0.7));

    // Crisp attack + resonant release
    const attack = Math.min(0.015, dur * 0.25);
    const sustainEnd = Math.max(startTime + attack + 0.01, startTime + dur - 0.045);
    const releaseEnd = startTime + dur + 0.045;

    amp.gain.setValueAtTime(0.0001, startTime);
    amp.gain.exponentialRampToValueAtTime(volume, startTime + attack);
    amp.gain.setValueAtTime(volume * 0.88, sustainEnd);
    amp.gain.exponentialRampToValueAtTime(0.0001, releaseEnd);

    oscSaw.connect(filter);
    oscSq.connect(sqMix);
    sqMix.connect(filter);
    filter.connect(amp);
    amp.connect(master);

    oscSaw.start(startTime);
    oscSq.start(startTime);
    oscSaw.stop(releaseEnd + 0.02);
    oscSq.stop(releaseEnd + 0.02);

    const handle = {
      stop() {
        const now = ac.currentTime;
        amp.gain.cancelScheduledValues(now);
        amp.gain.setTargetAtTime(0.0001, now, 0.015);
        try {
          oscSaw.stop(now + 0.05);
          oscSq.stop(now + 0.05);
        } catch {}
      },
    };
    activeVoices.push(handle);
    oscSaw.onended = () => {
      const idx = activeVoices.indexOf(handle);
      if (idx !== -1) activeVoices.splice(idx, 1);
    };
  }

  /**
   * Memainkan salah satu dari 3 pola melodi Klakson Telolet Basuri secara acak.
   * @param {number} [patternIndex] - Opsional paksa indeks pola 0..2
   */
  function playTeloletHorn(patternIndex) {
    if (isMuted?.()) return false;
    const ac = ensureContext?.();
    const master = getMaster?.();
    if (!ac || !master) return false;
    if (ac.state === 'suspended') ac.resume().catch(() => {});

    const nowMs = performance.now();
    if (nowMs - lastTriggerMs < 240) return false;
    lastTriggerMs = nowMs;

    stopActiveVoices();

    let idx = typeof patternIndex === 'number'
      ? Math.abs(Math.floor(patternIndex)) % TELOLET_PATTERNS.length
      : Math.floor(Math.random() * TELOLET_PATTERNS.length);
    if (typeof patternIndex !== 'number' && TELOLET_PATTERNS.length > 1 && idx === lastPatternIdx) {
      idx = (idx + 1 + Math.floor(Math.random() * (TELOLET_PATTERNS.length - 1))) % TELOLET_PATTERNS.length;
    }
    lastPatternIdx = idx;

    const seq = TELOLET_PATTERNS[idx];
    let t = ac.currentTime + 0.01;
    for (const note of seq) {
      playAirHornNote(ac, master, t, note.freq, note.dur, HORN_VOLUME, 1100);
      t += note.dur + (note.gap ?? 0.025);
    }
    return true;
  }

  /**
   * Memainkan flourish klakson nada tinggi "TO-LE-LOT!" saat mendarat dari Barrel Roll.
   */
  function playTeloletFlourish() {
    if (isMuted?.()) return false;
    const ac = ensureContext?.();
    const master = getMaster?.();
    if (!ac || !master) return false;
    if (ac.state === 'suspended') ac.resume().catch(() => {});

    stopActiveVoices();
    let t = ac.currentTime + 0.01;
    for (const note of FLOURISH_NOTES) {
      playAirHornNote(ac, master, t, note.freq, note.dur, HORN_VOLUME, 1380);
      t += note.dur + (note.gap ?? 0.02);
    }
    return true;
  }

  /**
   * Suara peluit jatuh komikal + hembusan angin saat kendaraan keluar jalur ke jurang.
   */
  function playAbyssWhistle() {
    if (isMuted?.()) return false;
    const ac = ensureContext?.();
    const master = getMaster?.();
    if (!ac || !master) return false;
    if (ac.state === 'suspended') ac.resume().catch(() => {});

    const now = ac.currentTime + 0.01;
    const dur = 0.65;
    const osc = ac.createOscillator();
    const osc2 = ac.createOscillator();
    const gain = ac.createGain();
    const g2 = ac.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1180, now);
    osc.frequency.exponentialRampToValueAtTime(185, now + dur);

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(590, now);
    osc2.frequency.exponentialRampToValueAtTime(110, now + dur);
    g2.gain.setValueAtTime(0.32, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.20, now + 0.03);
    gain.gain.setValueAtTime(0.165, now + dur * 0.65);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur + 0.04);

    osc.connect(gain);
    osc2.connect(g2);
    g2.connect(gain);
    gain.connect(master);

    osc.start(now);
    osc2.start(now);
    osc.stop(now + dur + 0.06);
    osc2.stop(now + dur + 0.06);
    return true;
  }

  /**
   * Suara whoosh naik cerah saat berhasil melibas putaran vertikal 360°.
   */
  function playLoopWhoosh() {
    if (isMuted?.()) return false;
    const ac = ensureContext?.();
    const master = getMaster?.();
    if (!ac || !master) return false;
    if (ac.state === 'suspended') ac.resume().catch(() => {});

    const notes = [523.25, 659.25, 783.99, 1046.5];
    let t = ac.currentTime + 0.01;
    for (const freq of notes) {
      playAirHornNote(ac, master, t, freq, 0.095, 0.15, 1450);
      t += 0.075;
    }
    return true;
  }

  /**
   * Suara whoosh api emas saat menembus Fire Ring di udara.
   */
  function playFireRing() {
    if (isMuted?.()) return false;
    const ac = ensureContext?.();
    const master = getMaster?.();
    if (!ac || !master) return false;
    if (ac.state === 'suspended') ac.resume().catch(() => {});

    const now = ac.currentTime + 0.01;
    const notes = [587.33, 880.0, 1174.66, 1567.98];
    let t = now;
    for (const freq of notes) {
      playAirHornNote(ac, master, t, freq, 0.08, 0.14, 1750);
      t += 0.055;
    }
    return true;
  }

  /**
   * Suara "bonk-klontang" plastik ceria saat menabrak tong atau kerucut mainan.
   */
  function playSmashProp() {
    if (isMuted?.()) return false;
    const ac = ensureContext?.();
    const master = getMaster?.();
    if (!ac || !master) return false;
    if (ac.state === 'suspended') ac.resume().catch(() => {});

    const now = ac.currentTime + 0.005;
    const osc = ac.createOscillator();
    const osc2 = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(340, now);
    osc.frequency.exponentialRampToValueAtTime(115, now + 0.16);
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(520, now);
    osc2.frequency.exponentialRampToValueAtTime(210, now + 0.14);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.20, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

    osc.connect(gain);
    osc2.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc2.start(now);
    osc.stop(now + 0.2);
    osc2.stop(now + 0.2);
    return true;
  }

  /**
   * Fanfare podium kemenangan saat melewati garis finis Checkered Flag!
   */
  function playVictoryFanfare() {
    if (isMuted?.()) return false;
    const ac = ensureContext?.();
    const master = getMaster?.();
    if (!ac || !master) return false;
    if (ac.state === 'suspended') ac.resume().catch(() => {});

    const notes = [
      { freq: 523.25, dur: 0.11, gap: 0.02 },
      { freq: 659.25, dur: 0.11, gap: 0.02 },
      { freq: 783.99, dur: 0.12, gap: 0.03 },
      { freq: 1046.5, dur: 0.34, gap: 0.04 },
    ];
    let t = ac.currentTime + 0.01;
    for (const n of notes) {
      playAirHornNote(ac, master, t, n.freq, n.dur, 0.18, 1550);
      t += n.dur + n.gap;
    }
    return true;
  }

  function dispose() {
    stopActiveVoices();
  }

  return {
    playTeloletHorn,
    playTeloletFlourish,
    playAbyssWhistle,
    playLoopWhoosh,
    playFireRing,
    playSmashProp,
    playVictoryFanfare,
    dispose,
  };
}
