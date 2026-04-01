import { useState, useRef, useEffect, useCallback } from "react";

// ─── DONNÉES ─────────────────────────────────────────────────────────────────

const NOTES = {
  0: { en: 'E',   fr: 'Mi',   freq: 329.63 },
  1: { en: 'F',   fr: 'Fa',   freq: 349.23 },
  2: { en: 'G',   fr: 'Sol',  freq: 392.00 },
  3: { en: 'A',   fr: 'La',   freq: 440.00 },
  4: { en: 'B',   fr: 'Si',   freq: 493.88 },
  5: { en: 'C',   fr: 'Do',   freq: 523.25 },
  6: { en: 'D+',  fr: 'Ré+',  freq: 622.25 },
  7: { en: 'E+',  fr: 'Mi+',  freq: 698.46 },
  8: { en: 'F+',  fr: 'Fa+',  freq: 739.99 },
  9: { en: 'G+',  fr: 'Sol+', freq: 830.61 },
};

const COLORS = [
  '#7B68EE','#5B9BD5','#48CAE4','#52B788',
  '#F4A261','#E9C46A','#F77F00','#E63946','#C77DFF','#9B2226'
];

const LDA_MAP = {
  'a':0,'é':6,
  'o':0,'n':1,'d':2,'j':3,'k':4,'s':5,'r':6,'p':7,'y':8,'x':9,
  't':1,'m':2,'v':3,'z':4,
};
const GAMME_SET = new Set(['o','n','d','j','k','s','r','p','y','x']);

const EXAMPLES = [
  { label: 'Frayeur',            lda: 'PéHEs TaKEn PaREk',                effect: 'Peur (30s)' },
  { label: 'Apaisement',         lda: 'PéHEs TaKEn PaREj',                effect: 'Calme, no offensif' },
  { label: 'Soins Magiques',     lda: 'PéHEs VaVEr KaHEd RéV',            effect: 'Soigne 2 PV' },
  { label: 'Animation des morts',lda: 'PéVEo TaKEd RéVEy',                effect: 'État vivant' },
  { label: 'Prière de soins',    lda: 'VaZEo KaHEj PéHEs VaVEr KaHEj RéV',effect: 'Soigne 3×3 PV' },
  { label: 'Onde de choc',       lda: 'PéKEy VaJEy VéMEy VaJEy VéMEn',   effect: 'Propulsion + Renversement' },
  { label: 'Rappel à la vie',    lda: 'VaVEx ZaKEy RéV',                  effect: 'Ressuscite' },
];

// ─── PARSEURS ─────────────────────────────────────────────────────────────────

function parseLDA(text) {
  const out = [];
  const chars = [...text];
  let i = 0, wordStart = true;
  while (i < chars.length) {
    const c = chars[i], cl = c.toLowerCase();
    if (/\s/.test(c)) {
      if (out.length && !out[out.length - 1].rest) out.push({ rest: true, char: '𝄽', wordStart: false });
      wordStart = true; i++; continue;
    }
    if (cl === 'h') { i++; continue; }
    if (c === 'E' && i + 1 < chars.length && GAMME_SET.has(chars[i + 1].toLowerCase())) {
      const nc = chars[i + 1];
      out.push({ rest: false, char: `E${nc}`, num: LDA_MAP[nc.toLowerCase()], wordStart });
      wordStart = false; i += 2; continue;
    }
    if (LDA_MAP.hasOwnProperty(cl)) {
      out.push({ rest: false, char: c, num: LDA_MAP[cl], wordStart });
      wordStart = false; i++; continue;
    }
    i++;
  }
  while (out.length && out[out.length - 1].rest) out.pop();
  return out;
}

function parseEN(text) {
  const M = { E:0,F:1,G:2,A:3,B:4,C:5,'D+':6,'E+':7,'F+':8,'G+':9 };
  return text.trim().split(/\s+/).map((tok, i) => {
    if (tok === '𝄽' || tok === '-' || tok.toUpperCase() === 'REST') return { rest: true, char: '𝄽', wordStart: false };
    const num = M[tok] ?? M[tok.toUpperCase()];
    if (num !== undefined) return { rest: false, char: tok, num, wordStart: i === 0 };
    return null;
  }).filter(Boolean);
}

function parseFR(text) {
  const M = { MI:0, FA:1, SOL:2, LA:3, SI:4, DO:5, 'RÉ+':6, 'MI+':7, 'FA+':8, 'SOL+':9 };
  return text.trim().split(/\s+/).map((tok, i) => {
    if (tok === '𝄽') return { rest: true, char: '𝄽', wordStart: false };
    const num = M[tok.toUpperCase()];
    if (num !== undefined) return { rest: false, char: tok, num, wordStart: i === 0 };
    return null;
  }).filter(Boolean);
}

// ─── MOTEUR AUDIO ─────────────────────────────────────────────────────────────

let _ctx = null, _master = null;
const _nodes = [];

function getCtx() {
  if (!_ctx) {
    _ctx = new (window.AudioContext || window.webkitAudioContext)();
    _master = _ctx.createGain();
    _master.gain.value = 0.72;
    _master.connect(_ctx.destination);
  }
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

function track(n) { _nodes.push(n); return n; }

function killAll() {
  _nodes.forEach(n => { try { n.stop(0); } catch(e) {} });
  _nodes.length = 0;
}

function setVolume(v) { if (_master) _master.gain.setTargetAtTime(v, _ctx.currentTime, 0.05); }

// Piano — harmoniques multiples + déclin exponentiel
function piano(freq, t, dur) {
  const c = getCtx(), g = c.createGain();
  g.connect(_master);
  [[1,1,'triangle'],[2,.45,'sine'],[3,.25,'sine'],[4,.12,'sine'],[6,.06,'sine']].forEach(([h,a,tp]) => {
    const o = track(c.createOscillator()); o.type = tp; o.frequency.value = freq * h;
    const hg = c.createGain(); hg.gain.value = a;
    o.connect(hg); hg.connect(g); o.start(t); o.stop(t + dur + 2.5);
  });
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.55, t + 0.007);
  g.gain.exponentialRampToValueAtTime(0.35, t + 0.08);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur + 2.0);
}

// Guitare — Karplus-Strong (corde pincée)
function guitar(freq, t, dur) {
  const c = getCtx(), sr = c.sampleRate;
  const bl = Math.round(sr / freq);
  const total = Math.ceil(sr * (dur + 2.5));
  const buf = c.createBuffer(1, total, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < bl; i++) d[i] = Math.random() * 2 - 1;
  for (let i = bl; i < total; i++) d[i] = 0.499 * (d[i - bl] + (i - bl + 1 < total ? d[i - bl + 1] : 0));
  const src = track(c.createBufferSource()); src.buffer = buf;
  const g = c.createGain();
  g.gain.setValueAtTime(0.9, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur + 2.0);
  src.connect(g); g.connect(_master);
  src.start(t); src.stop(t + dur + 2.5);
}

// Flûte — sinus + vibrato LFO + 2e harmonique douce
function flute(freq, t, dur) {
  const c = getCtx();
  const osc = track(c.createOscillator()); osc.type = 'sine'; osc.frequency.value = freq;
  const osc2 = track(c.createOscillator()); osc2.type = 'sine'; osc2.frequency.value = freq * 2;
  const lfo = track(c.createOscillator()); lfo.type = 'sine'; lfo.frequency.value = 5.5;
  const lfoG = c.createGain(); lfoG.gain.value = freq * 0.013;
  lfo.connect(lfoG); lfoG.connect(osc.frequency);
  const o2g = c.createGain(); o2g.gain.value = 0.14; osc2.connect(o2g);
  // Léger bruit de souffle
  const noise = track(c.createOscillator()); noise.type = 'sawtooth'; noise.frequency.value = freq * 7;
  const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = freq * 7; nf.Q.value = 0.3;
  const ng = c.createGain(); ng.gain.value = 0.03; noise.connect(nf); nf.connect(ng);
  const g = c.createGain();
  osc.connect(g); o2g.connect(g); ng.connect(g); g.connect(_master);
  g.gain.setValueAtTime(0.001, t);
  g.gain.exponentialRampToValueAtTime(0.42, t + 0.11);
  g.gain.setValueAtTime(0.42, t + Math.max(0.12, dur - 0.1));
  g.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.08);
  [osc, osc2, lfo, noise].forEach(o => { o.start(t); o.stop(t + dur + 0.2); });
}

// Drone de fond
let _droneOsc = null;
function startDrone(freq) {
  stopDrone();
  const c = getCtx();
  _droneOsc = c.createOscillator(); _droneOsc.type = 'sine';
  _droneOsc.frequency.value = freq / 2;
  const g = c.createGain(); g.gain.value = 0.17;
  _droneOsc.connect(g); g.connect(_master); _droneOsc.start();
}
function updateDrone(freq) {
  if (_droneOsc) _droneOsc.frequency.setTargetAtTime(freq / 2, getCtx().currentTime, 0.15);
}
function stopDrone() {
  if (_droneOsc) { try { _droneOsc.stop(); } catch(e) {} _droneOsc = null; }
}

function playNote(freq, t, dur, inst) {
  if (!freq) return;
  if (inst === 'piano') piano(freq, t, dur);
  else if (inst === 'guitar') guitar(freq, t, dur);
  else flute(freq, t, dur);
}

// ─── COMPOSANT ────────────────────────────────────────────────────────────────

export default function App() {
  const [mode, setMode] = useState('lda');
  const [input, setInput] = useState('PéHEs TaKEn PaREk');
  const [tokens, setTokens] = useState([]);
  const [playing, setPlaying] = useState(false);
  const [curIdx, setCurIdx] = useState(-1);
  const [bpm, setBpm] = useState(80);
  const [inst, setInst] = useState('piano');
  const [drone, setDrone] = useState(false);
  const [volume, setVolume] = useState(72);
  const [showRef, setShowRef] = useState(false);
  const [showExamples, setShowExamples] = useState(false);

  const timerRef = useRef(null);
  const playingRef = useRef(false);

  const parse = useCallback((txt, md) => {
    const t = txt ?? input, m = md ?? mode;
    const toks = m === 'lda' ? parseLDA(t) : m === 'en' ? parseEN(t) : parseFR(t);
    setTokens(toks);
    return toks;
  }, [input, mode]);

  useEffect(() => { parse(); }, []);

  const stop = useCallback(() => {
    playingRef.current = false;
    clearInterval(timerRef.current);
    killAll(); stopDrone();
    setPlaying(false); setCurIdx(-1);
  }, []);

  const playTokens = useCallback((toks) => {
    const notes = toks ?? tokens;
    if (!notes.filter(t => !t.rest).length) return;
    const c = getCtx();
    setVolume(volume / 100);
    const spb = 60 / bpm;
    const now = c.currentTime + 0.08;
    notes.forEach((tok, i) => {
      if (tok.rest) return;
      const freq = NOTES[tok.num]?.freq;
      if (freq) playNote(freq, now + i * spb, spb * 0.82, inst);
    });
    if (drone) {
      const first = notes.find(t => !t.rest);
      if (first) startDrone(NOTES[first.num].freq);
    }
    playingRef.current = true;
    setPlaying(true);
    const t0 = Date.now();
    timerRef.current = setInterval(() => {
      if (!playingRef.current) return;
      const idx = Math.floor((Date.now() - t0) / 1000 / spb);
      if (idx >= notes.length) { stop(); return; }
      setCurIdx(idx);
      if (drone) {
        for (let i = idx; i >= 0; i--) {
          if (notes[i] && !notes[i].rest && notes[i].wordStart) {
            updateDrone(NOTES[notes[i].num].freq); break;
          }
        }
      }
    }, 50);
  }, [tokens, bpm, inst, drone, volume, stop]);

  const handlePlay = () => {
    if (playing) { stop(); return; }
    playTokens(parse());
  };

  const loadExample = ex => {
    setMode('lda');
    setInput(ex.lda);
    setTokens(parseLDA(ex.lda));
    setShowExamples(false);
  };

  const hasPlayable = tokens.some(t => !t.rest);

  // ─── Rendu ────────────────────────────────────────────────────────────────

  const gold = '#d4af37', bg = '#0d0d1a', card = 'rgba(255,255,255,.04)', border = 'rgba(212,175,55,.18)';

  const pill = (active, extra = {}) => ({
    padding: '6px 14px', borderRadius: '20px', border: 'none', cursor: 'pointer', fontSize: '12px',
    backgroundColor: active ? gold : card,
    color: active ? bg : '#e8d5a3',
    fontWeight: active ? 'bold' : 'normal',
    transition: 'all .15s',
    ...extra,
  });

  const sectionStyle = { backgroundColor: card, borderRadius: '12px', padding: '14px', border: `1px solid ${border}`, marginBottom: '12px' };
  const labelStyle = { margin: '0 0 8px', fontSize: '10px', color: 'rgba(212,175,55,.6)', letterSpacing: '2px', textTransform: 'uppercase' };

  return (
    <div style={{ fontFamily: "'Georgia', serif", backgroundColor: bg, color: '#e8d5a3', minHeight: '100vh', padding: '16px', boxSizing: 'border-box' }}>

      {/* ── En-tête ── */}
      <div style={{ textAlign: 'center', marginBottom: '20px', paddingBottom: '16px', borderBottom: `1px solid ${border}` }}>
        <div style={{ fontSize: '28px', marginBottom: '4px' }}>𝄞</div>
        <h1 style={{ margin: 0, fontSize: '22px', color: gold, letterSpacing: '3px', fontWeight: 'normal' }}>
          MUSIQUE DES ÂMES
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: '11px', color: 'rgba(232,213,163,.45)', letterSpacing: '3px' }}>
          SIMULATEUR LDA · RÉDEMPTION GN
        </p>
      </div>

      {/* ── Sélecteur de mode ── */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        {[['lda','🌀 LDA Paroles'],['en','🎵 Notes EN'],['fr','🎶 Notes FR']].map(([id, label]) => (
          <button key={id} style={pill(mode === id)} onClick={() => { setMode(id); parse(input, id); }}>{label}</button>
        ))}
        <button
          style={{ ...pill(false), marginLeft: 'auto', border: `1px solid rgba(212,175,55,.3)`, color: gold, backgroundColor: 'transparent' }}
          onClick={() => setShowExamples(!showExamples)}>
          📖 Sorts
        </button>
      </div>

      {/* ── Sorts exemples ── */}
      {showExamples && (
        <div style={{ ...sectionStyle, padding: '12px' }}>
          <p style={labelStyle}>Sorts disponibles</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {EXAMPLES.map(ex => (
              <button key={ex.label} onClick={() => loadExample(ex)}
                style={{ padding: '5px 10px', borderRadius: '16px', border: `1px solid rgba(212,175,55,.3)`, cursor: 'pointer', fontSize: '11px', backgroundColor: 'rgba(212,175,55,.1)', color: '#e8d5a3', textAlign: 'left' }}>
                <span style={{ fontWeight: 'bold' }}>{ex.label}</span>
                <span style={{ color: 'rgba(232,213,163,.5)', marginLeft: '6px', fontSize: '10px' }}>{ex.effect}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Zone de saisie ── */}
      <div style={{ marginBottom: '12px' }}>
        <textarea
          value={input}
          onChange={e => { setInput(e.target.value); parse(e.target.value); }}
          placeholder={mode === 'lda' ? 'Ex: PéHEs TaKEn PaREk' : mode === 'en' ? 'Ex: E+ D+ C 𝄽 F E B F 𝄽 E+ E D+ B' : 'Ex: Mi+ Ré+ Do 𝄽 Fa Mi Si Fa 𝄽 Mi+ Mi Ré+ Si'}
          style={{ width: '100%', boxSizing: 'border-box', padding: '12px', borderRadius: '8px', backgroundColor: 'rgba(255,255,255,.05)', border: `1px solid rgba(212,175,55,.35)`, color: '#e8d5a3', fontSize: '15px', fontFamily: 'Georgia, serif', resize: 'vertical', minHeight: '60px', outline: 'none', letterSpacing: '1px' }}
        />
        {mode === 'lda' && <p style={{ margin: '4px 0 0', fontSize: '10px', color: 'rgba(232,213,163,.35)' }}>
          💡 H est silencieux · Espace = repos (𝄽) · Majuscule E + consonne = gamme (Ex, Ek, Es…)
        </p>}
      </div>

      {/* ── Visualisation des notes ── */}
      <div style={{ marginBottom: '14px' }}>
        <p style={labelStyle}>Partitions</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', padding: '12px', backgroundColor: 'rgba(0,0,0,.35)', borderRadius: '8px', minHeight: '70px', alignItems: 'center' }}>
          {tokens.length === 0 && <span style={{ color: 'rgba(255,255,255,.2)', fontSize: '13px' }}>Saisir du texte pour voir les notes…</span>}
          {tokens.map((tok, i) => {
            const active = i === curIdx;
            const color = tok.rest ? '#444' : COLORS[tok.num];
            const noteLabel = tok.rest ? '𝄽' : NOTES[tok.num]?.en;
            return (
              <div key={i} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                padding: '6px 8px', borderRadius: '6px', minWidth: '36px', cursor: 'default',
                backgroundColor: active ? `${color}44` : 'rgba(255,255,255,.04)',
                border: `1px solid ${active ? color : 'rgba(255,255,255,.1)'}`,
                transform: active ? 'scale(1.18) translateY(-3px)' : tok.rest ? 'scale(.95)' : 'scale(1)',
                transition: 'all .07s ease',
                boxShadow: active ? `0 4px 16px ${color}55` : 'none',
                opacity: tok.rest ? .5 : 1,
              }}>
                <span style={{ fontSize: '9px', color: 'rgba(255,255,255,.4)', lineHeight: 1, marginBottom: '2px' }}>{tok.char}</span>
                <span style={{ fontSize: '13px', color: active ? color : tok.rest ? '#555' : '#e8d5a3', fontWeight: 'bold', lineHeight: 1 }}>{noteLabel}</span>
                <span style={{ fontSize: '8px', color: 'rgba(255,255,255,.3)', lineHeight: 1, marginTop: '2px' }}>{tok.rest ? '' : tok.num}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Tableau d'analyse (mode LDA) ── */}
      {mode === 'lda' && tokens.length > 0 && (
        <div style={{ marginBottom: '14px' }}>
          <p style={labelStyle}>Analyse</p>
          <div style={{ overflowX: 'auto', backgroundColor: 'rgba(0,0,0,.3)', borderRadius: '8px', padding: '10px 12px' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: '11px', whiteSpace: 'nowrap' }}>
              <tbody>
                {[
                  { label: 'Décortication', vals: tokens.map(t => t.char) },
                  { label: 'Numérotation',  vals: tokens.map(t => t.rest ? '' : t.num) },
                  { label: 'Notes EN',      vals: tokens.map(t => t.rest ? '𝄽' : NOTES[t.num]?.en) },
                  { label: 'Notes FR',      vals: tokens.map(t => t.rest ? '𝄽' : NOTES[t.num]?.fr) },
                ].map(row => (
                  <tr key={row.label}>
                    <td style={{ color: 'rgba(212,175,55,.55)', paddingRight: '12px', paddingTop: '3px', paddingBottom: '3px', fontSize: '9px', letterSpacing: '1px', textTransform: 'uppercase', userSelect: 'none' }}>{row.label}</td>
                    {row.vals.map((v, i) => {
                      const active = i === curIdx;
                      const color = tokens[i]?.rest ? '#555' : COLORS[tokens[i]?.num] || '#888';
                      return (
                        <td key={i} style={{
                          padding: '3px 7px', textAlign: 'center', borderRadius: '4px',
                          color: active ? color : tokens[i]?.rest ? '#444' : '#c8b8a0',
                          backgroundColor: active && !tokens[i]?.rest ? `${color}22` : 'transparent',
                          fontWeight: active ? 'bold' : 'normal',
                          transition: 'all .07s',
                        }}>{v}</td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Contrôles de lecture ── */}
      <div style={sectionStyle}>
        {/* Bouton + BPM + Volume + Drone */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
          <button onClick={handlePlay} disabled={!hasPlayable}
            style={{ padding: '10px 24px', borderRadius: '24px', border: 'none', cursor: hasPlayable ? 'pointer' : 'not-allowed', fontWeight: 'bold', fontSize: '15px',
              backgroundColor: playing ? '#e63946' : gold, color: bg,
              opacity: hasPlayable ? 1 : .4, transition: 'all .2s', boxShadow: playing ? '0 0 20px #e6394655' : `0 0 20px ${gold}33` }}>
            {playing ? '⏹ Arrêter' : '▶ Jouer'}
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flex: 1, minWidth: '140px' }}>
            <span style={{ fontSize: '9px', color: 'rgba(232,213,163,.45)', letterSpacing: '1px', whiteSpace: 'nowrap' }}>BPM</span>
            <input type="range" min="30" max="220" value={bpm} onChange={e => setBpm(+e.target.value)} style={{ flex: 1, accentColor: gold }} />
            <span style={{ fontSize: '14px', minWidth: '30px', color: gold, fontWeight: 'bold' }}>{bpm}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', minWidth: '120px' }}>
            <span style={{ fontSize: '9px', color: 'rgba(232,213,163,.45)', letterSpacing: '1px' }}>VOL</span>
            <input type="range" min="0" max="100" value={volume} onChange={e => { setVolume(+e.target.value); setVolume(+e.target.value); if (_master) _master.gain.setTargetAtTime(+e.target.value / 100, getCtx().currentTime, 0.05); }} style={{ flex: 1, accentColor: gold }} />
            <span style={{ fontSize: '13px', minWidth: '28px', color: 'rgba(232,213,163,.6)' }}>{volume}%</span>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px', color: drone ? gold : 'rgba(232,213,163,.35)', userSelect: 'none' }}>
            <input type="checkbox" checked={drone} onChange={e => setDrone(e.target.checked)} style={{ accentColor: gold }} />
            𝄽 Drone
          </label>
        </div>

        {/* Instruments */}
        <div>
          <p style={{ ...labelStyle, marginBottom: '8px' }}>Instrument</p>
          <div style={{ display: 'flex', gap: '8px' }}>
            {[
              ['piano',  '🎹', 'Piano',   'Clavier des Âmes'],
              ['guitar', '🎸', 'Guitare', 'Cordes du Destin'],
              ['flute',  '🪈', 'Flûte',   "Souffle de l'Âme"],
            ].map(([id, icon, name, sub]) => (
              <button key={id} onClick={() => setInst(id)}
                style={{ flex: 1, padding: '10px 4px', borderRadius: '10px', border: `1px solid ${inst === id ? 'rgba(212,175,55,.55)' : 'rgba(255,255,255,.08)'}`,
                  cursor: 'pointer', backgroundColor: inst === id ? 'rgba(212,175,55,.18)' : 'rgba(255,255,255,.03)',
                  color: inst === id ? gold : 'rgba(232,213,163,.4)', transition: 'all .2s', textAlign: 'center' }}>
                <div style={{ fontSize: '20px', marginBottom: '3px' }}>{icon}</div>
                <div style={{ fontSize: '12px', fontWeight: inst === id ? 'bold' : 'normal' }}>{name}</div>
                <div style={{ fontSize: '9px', opacity: .6, marginTop: '2px', fontStyle: 'italic' }}>{sub}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Table de correspondance ── */}
      <button onClick={() => setShowRef(!showRef)}
        style={{ width: '100%', padding: '9px', borderRadius: '8px', border: `1px solid rgba(212,175,55,.2)`,
          backgroundColor: 'transparent', color: 'rgba(212,175,55,.6)', cursor: 'pointer', fontSize: '12px', marginBottom: '8px', letterSpacing: '1px' }}>
        {showRef ? '▲' : '▼'} &nbsp;Table de correspondance LDA
      </button>

      {showRef && (
        <div style={sectionStyle}>
          <p style={labelStyle}>Chiffres → Notes</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: '5px', marginBottom: '18px' }}>
            {Object.entries(NOTES).map(([num, n]) => (
              <div key={num} style={{ padding: '7px', borderRadius: '8px', textAlign: 'center', backgroundColor: `${COLORS[+num]}18`, border: `1px solid ${COLORS[+num]}30` }}>
                <div style={{ color: COLORS[+num], fontWeight: 'bold', fontSize: '15px' }}>{num}</div>
                <div style={{ color: '#e8d5a3', fontSize: '12px' }}>{n.en}</div>
                <div style={{ color: 'rgba(232,213,163,.55)', fontSize: '10px' }}>{n.fr}</div>
                <div style={{ color: 'rgba(232,213,163,.3)', fontSize: '9px' }}>{n.freq} Hz</div>
              </div>
            ))}
          </div>

          <p style={labelStyle}>Lettres LDA → Chiffres</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', fontSize: '11px' }}>
            {/* Voyelles */}
            <div>
              <p style={{ margin: '0 0 6px', color: 'rgba(255,255,255,.3)', fontSize: '9px', letterSpacing: '1px' }}>VOYELLES</p>
              {[['a',0],['é',6]].map(([l,n]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 8px', borderRadius: '5px', backgroundColor: 'rgba(255,255,255,.04)', marginBottom: '3px' }}>
                  <span style={{ color: '#c8b8e8', fontWeight: 'bold', fontSize: '15px' }}>{l}</span>
                  <span style={{ color: COLORS[n], fontSize: '11px' }}>{n} · {NOTES[n].fr}</span>
                </div>
              ))}
            </div>

            {/* Consonnes */}
            <div>
              <p style={{ margin: '0 0 6px', color: 'rgba(255,255,255,.3)', fontSize: '9px', letterSpacing: '1px' }}>CONSONNES (seul ou E+C)</p>
              {[['o / Eo',0],['n / En',1],['d / Ed',2],['j / Ej',3],['k / Ek',4],['s / Es',5],['r / Er',6],['p / Ep',7],['y / Ey',8],['x / Ex',9]].map(([l,n]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 8px', borderRadius: '4px', backgroundColor: 'rgba(255,255,255,.04)', marginBottom: '2px' }}>
                  <span style={{ color: '#8bd3c7', fontSize: '11px' }}>{l}</span>
                  <span style={{ color: COLORS[n], fontWeight: 'bold' }}>{n}</span>
                </div>
              ))}
            </div>

            {/* Extras + Spéciaux */}
            <div>
              <p style={{ margin: '0 0 6px', color: 'rgba(255,255,255,.3)', fontSize: '9px', letterSpacing: '1px' }}>CONSONNES EXTRA</p>
              {[['t',1],['m',2],['v',3],['z',4]].map(([l,n]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 8px', borderRadius: '5px', backgroundColor: 'rgba(255,255,255,.04)', marginBottom: '3px' }}>
                  <span style={{ color: '#f4a261', fontWeight: 'bold', fontSize: '15px' }}>{l}</span>
                  <span style={{ color: COLORS[n], fontSize: '11px' }}>{n} · {NOTES[n].fr}</span>
                </div>
              ))}
              <p style={{ margin: '12px 0 6px', color: 'rgba(255,255,255,.3)', fontSize: '9px', letterSpacing: '1px' }}>SPÉCIAUX</p>
              {[['H','silencieux, ignoré'],['espace','𝄽 repos entre mots']].map(([k,v]) => (
                <div key={k} style={{ padding: '4px 8px', borderRadius: '4px', backgroundColor: 'rgba(255,255,255,.04)', marginBottom: '3px', display: 'flex', gap: '8px' }}>
                  <span style={{ color: gold, fontWeight: 'bold', minWidth: '30px' }}>{k}</span>
                  <span style={{ color: 'rgba(232,213,163,.5)', fontSize: '10px' }}>{v}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginTop: '14px', padding: '10px 12px', borderRadius: '8px', backgroundColor: 'rgba(212,175,55,.07)', border: `1px solid rgba(212,175,55,.15)`, fontSize: '10px', color: 'rgba(232,213,163,.5)', lineHeight: 1.6 }}>
            ⚙ <strong style={{ color: 'rgba(212,175,55,.7)' }}>Règle du drone :</strong> La 1ère note de chaque mot est maintenue en fond (à l'octave inférieur) jusqu'au mot suivant.<br/>
            ⚙ <strong style={{ color: 'rgba(212,175,55,.7)' }}>Gamme variable :</strong> La gamme peut changer selon la note zéro. Ré = gamme par défaut.
          </div>
        </div>
      )}

      <div style={{ textAlign: 'center', marginTop: '8px', fontSize: '10px', color: 'rgba(232,213,163,.2)', letterSpacing: '1px' }}>
        Rédemption GN · Langue des Âmes
      </div>
    </div>
  );
}
