/* =====================================================================
   howToPlay.js — Panduan singkat "Cara Bermain" bergaya diorama hangat
   (Fredoka, krem, amber, oranye) dengan deteksi otomatis keyboard/sentuh,
   opsi "Jangan tampilkan lagi", dan pintasan tombol ?.
   ===================================================================== */

const KEY = 'juragan.howto.seen';

const STEPS = [
  {
    icon: '🏁',
    title: 'Finish 1.500 m',
    text: 'Balapan 1.500 meter menuju podium juara bersama tiga lawan seru!',
    keys: [],
    touch: '',
  },
  {
    icon: '↔️',
    title: 'Belok Kiri Kanan',
    text: 'Mobil jalan sendiri. Tinggal arahkan ke kiri atau kanan!',
    keys: ['←', '→', 'A', 'D'],
    touch: 'Tekan tombol ◀ / ▶ di layar',
  },
  {
    icon: '🌀',
    title: 'Terbang dan Putar',
    text: 'Lompat di tanjakan oranye, lalu putar di udara biar ngebut!',
    keys: ['←', '→'],
    touch: 'Tahan ◀ / ▶ saat melompat',
  },
  {
    icon: '⚡',
    title: 'Cari Turbo',
    text: 'Injak pad biru, lewati cincin api, atau putari loop 360°!',
    keys: [],
    touch: '',
  },
  {
    icon: '🎺',
    title: 'Telolet',
    text: 'Bunyikan klakson Telolet Basuri dan kumpulkan koin serta buah segar!',
    keys: ['H'],
    touch: 'Ketuk tombol 🎺 di bawah',
  },
  {
    icon: '❤️',
    title: 'Nyawa dan Jeda',
    text: 'Hati-hati rintangan! Tekan jeda kapan saja kalau mau istirahat sebentar.',
    keys: ['P', 'Esc'],
    touch: 'Ketuk tombol ⏸ di kanan atas',
  },
];

const CSS = `
[hidden]{display:none!important}
.htp{position:fixed;inset:0;z-index:60;display:grid;place-items:center;padding:16px;
  background:rgba(59,47,47,.48);backdrop-filter:blur(6px);animation:htpFade .26s ease-out both}
.htp[hidden]{display:none!important}
.htp-card{width:min(580px,100%);max-height:92vh;overflow-y:auto;background:var(--jg-paper,#fff8eb);
  color:var(--jg-ink,#3b2f2f);font-family:var(--jg-body,"Plus Jakarta Sans",system-ui,sans-serif);
  border:2px solid var(--jg-line,rgba(59,47,47,.16));border-radius:24px;padding:24px;
  box-shadow:0 18px 44px rgba(122,72,20,.30);animation:htpPop .38s cubic-bezier(.2,.9,.3,1.25) both}
.htp h2{font-family:var(--jg-disp,"Fredoka",sans-serif);font-weight:700;font-size:clamp(24px,4.5vw,32px);text-align:center;line-height:1.1;margin:0}
.htp h2 em{font-style:normal;color:var(--jg-red,#e5484d)}
.htp-sub{text-align:center;font-size:13px;font-weight:700;color:var(--jg-soft,#6b5a52);margin:6px 0 18px}
.htp-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
.htp-step{background:#fff;border:2px solid var(--jg-line,rgba(59,47,47,.14));border-radius:18px;padding:14px 13px;
  text-align:center;animation:htpPop .4s calc(.08s + var(--i)*.06s) cubic-bezier(.2,.9,.3,1.25) both}
.htp-ico{font-size:38px;line-height:1;display:block;margin-bottom:8px;filter:drop-shadow(0 3px 4px rgba(122,72,20,.22))}
.htp-step h3{font-family:var(--jg-disp,"Fredoka",sans-serif);font-weight:600;font-size:16px;margin:0 0 5px;color:var(--jg-ink,#3b2f2f)}
.htp-step p{font-size:12px;font-weight:500;line-height:1.5;color:var(--jg-soft,#6b5a52);margin:0}
.htp-keys{margin-top:9px;display:flex;gap:5px;justify-content:center;flex-wrap:wrap;font-size:12px;font-weight:800}
.htp-keys kbd{background:var(--jg-paper,#fff8eb);color:var(--jg-ink,#3b2f2f);border:1.5px solid rgba(59,47,47,.26);
  border-bottom-width:4px;border-radius:8px;padding:3px 10px;font-family:inherit;line-height:1.2}
.htp-keys span{background:rgba(62,99,221,.12);color:#2f4db3;border-radius:10px;padding:4px 10px}
.htp-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:18px;flex-wrap:wrap}
.htp-foot label{min-height:40px;font-size:12.5px;font-weight:700;color:var(--jg-soft,#6b5a52);display:inline-flex;gap:8px;align-items:center;cursor:pointer;user-select:none}
.htp-foot input[type="checkbox"]{width:18px;height:18px;accent-color:var(--jg-orange,#f76b15);cursor:pointer}
.htp-go{font-family:var(--jg-disp,"Fredoka",sans-serif);font-weight:600;font-size:17px;color:#fff;border:0;
  border-radius:16px;padding:12px 26px;min-height:44px;cursor:pointer;background:linear-gradient(135deg,#ffc53d,#f76b15);
  box-shadow:0 5px 0 #c2510c,0 10px 20px rgba(122,72,20,.25);transition:transform .12s,box-shadow .12s;white-space:nowrap}
.htp-go:hover{transform:translateY(-1px)}
.htp-go:active{transform:translateY(3px);box-shadow:0 2px 0 #c2510c}
.htp-go:focus-visible,.htp-fab:focus-visible,.htp-foot input:focus-visible{outline:3px solid var(--jg-blue,#3e63dd);outline-offset:3px}
.htp-fab{position:fixed;right:16px;top:16px;z-index:30;width:44px;height:44px;border-radius:50%;
  border:2px solid var(--jg-line,rgba(59,47,47,.16));background:var(--jg-surface,rgba(255,248,235,.92));
  color:var(--jg-ink,#3b2f2f);font-family:var(--jg-disp,"Fredoka",sans-serif);font-size:21px;font-weight:700;cursor:pointer;
  box-shadow:0 10px 26px rgba(122,72,20,.22);transition:transform .15s}
.htp-fab:hover{transform:scale(1.08) rotate(-6deg)}
@keyframes htpFade{from{opacity:0}to{opacity:1}}
@keyframes htpPop{from{opacity:0;transform:scale(.88) translateY(12px)}to{opacity:1;transform:none}}
@media (max-width:520px){
  .htp-card{padding:18px 16px}
  .htp-grid{grid-template-columns:1fr}
  .htp-foot{flex-direction:column-reverse;align-items:stretch}
  .htp-go{width:100%}
}
@media (prefers-reduced-motion:reduce){
  .htp,.htp-card,.htp-step{animation:none!important;transition:none!important}
}
`;

function readSeen() {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

function writeSeen(val) {
  try {
    localStorage.setItem(KEY, val ? '1' : '0');
  } catch {}
}

export function initHowToPlay({ onOpen, onClose, autoShow = true, showFab = true } = {}) {
  let style = document.getElementById('htp-styles');
  let createdStyle = false;
  if (!style) {
    style = document.createElement('style');
    style.id = 'htp-styles';
    style.textContent = CSS;
    document.head.appendChild(style);
    createdStyle = true;
  }

  const touch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

  const root = document.createElement('div');
  root.className = 'htp';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'htp-title');
  root.innerHTML = `
    <div class="htp-card">
      <h2 id="htp-title">CARA <em>BERMAIN</em></h2>
      <p class="htp-sub">Gampang banget, ayo ngebut di Nusantara!</p>
      <div class="htp-grid">
        ${STEPS.map((s, i) => `
          <div class="htp-step" style="--i:${i}">
            <span class="htp-ico" aria-hidden="true">${s.icon}</span>
            <h3>${s.title}</h3>
            <p>${s.text}</p>
            ${touch
              ? (s.touch ? `<div class="htp-keys"><span>${s.touch}</span></div>` : '')
              : (s.keys.length ? `<div class="htp-keys">${s.keys.map((k) => `<kbd>${k}</kbd>`).join('')}</div>` : '')}
          </div>`).join('')}
      </div>
      <div class="htp-foot">
        <label><input type="checkbox" id="htp-never"> Jangan tampilkan lagi</label>
        <button type="button" class="htp-go" id="htp-go">Mengerti! 👍</button>
      </div>
    </div>`;
  document.body.appendChild(root);

  let fab = null;
  if (showFab) {
    fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'htp-fab';
    fab.textContent = '?';
    fab.title = 'Cara bermain (?)';
    fab.setAttribute('aria-label', 'Cara bermain');
    document.body.appendChild(fab);
  }

  const never = /** @type {HTMLInputElement} */ (root.querySelector('#htp-never'));
  const go = /** @type {HTMLButtonElement} */ (root.querySelector('#htp-go'));
  let lastFocused = null;

  function open() {
    if (!root.hidden) return;
    lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    root.hidden = false;
    never.checked = readSeen();
    requestAnimationFrame(() => go.focus());
    onOpen?.();
  }

  function close() {
    if (root.hidden) return;
    root.hidden = true;
    writeSeen(never.checked);
    onClose?.();
    if (lastFocused && document.contains(lastFocused)) {
      lastFocused.focus();
    }
    lastFocused = null;
  }

  function openIfUnseen() {
    if (!readSeen()) open();
  }

  const onBackdropClick = (e) => {
    if (e.target === root) close();
  };

  const onKeyDown = (e) => {
    const t = /** @type {HTMLElement | null} */ (e.target);
    const inInput = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

    if (!root.hidden) {
      if (e.key === 'Tab') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (document.activeElement === never) go.focus();
        else never.focus();
        return;
      }
      if (e.key === 'Escape' || e.code === 'Space' || e.key === ' ' || (e.key === 'Enter' && t !== never)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        close();
        return;
      }
      if (e.key === 'Enter' && t === never) {
        e.preventDefault();
        e.stopImmediatePropagation();
        never.checked = !never.checked;
      }
      return;
    }

    if (!inInput && e.key === '?') {
      e.preventDefault();
      e.stopImmediatePropagation();
      open();
    }
  };

  go.addEventListener('click', close);
  fab?.addEventListener('click', open);
  root.addEventListener('click', onBackdropClick);
  window.addEventListener('keydown', onKeyDown, true);

  if (autoShow) openIfUnseen();

  function dispose() {
    go.removeEventListener('click', close);
    fab?.removeEventListener('click', open);
    root.removeEventListener('click', onBackdropClick);
    window.removeEventListener('keydown', onKeyDown, true);
    root.remove();
    fab?.remove();
    if (createdStyle) style?.remove();
  }

  return {
    open,
    close,
    openIfUnseen,
    get isOpen() { return !root.hidden; },
    dispose,
  };
}
