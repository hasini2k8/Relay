// RELAY web: landing page motion + the Family Care Pot dashboard.
import * as R from './relay.js';
import { LANGS, applyStatic, getLang, has, setLang, speechLang, t } from './i18n.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SITE = `${location.origin}${location.pathname}`;

// =====================================================================
// Storage (per browser). Keys are testnet keys; see README for limits.
// =====================================================================
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem(`relay.web.${k}`);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(`relay.web.${k}`, JSON.stringify(v));
    } catch {}
  },
};

const S = {
  ids: store.get('ids', []), // [{ name, secret }]
  active: store.get('active', 0),
  contacts: store.get('contacts', {}), // address -> name (shops, hospitals…)
  proposals: store.get('proposals', []), // [{ xdr, potId, createdAt }]
  fiat: store.get('fiat', 'INR'),
  zoom: store.get('zoom', 1),
  gs: store.get('gs', { hidden: false, shared: false }), // getting-started checklist
  unit: 'XLM', // amount entry unit in modals: 'XLM' | 'FIAT'
  prices: {},
  wallet: null,
  pots: [],
  potId: null,
  ledger: null,
  pending: [],
  loading: false,
  error: null,
  openProposal: null,
  lastHtml: '',
};

const kp = () => (S.ids[S.active] ? R.fromSecret(S.ids[S.active].secret) : null);
const me = () => kp()?.publicKey();
const saveIds = () => {
  store.set('ids', S.ids);
  store.set('active', S.active);
};
const saveProposals = () => store.set('proposals', S.proposals);
const saveContact = (address, name) => {
  S.contacts[address] = name;
  store.set('contacts', S.contacts);
};

// =====================================================================
// Formatting
// =====================================================================
const SYM = { INR: '₹', USD: 'US$', CAD: 'CA$', GBP: '£', AED: 'AED ' };
const xlm = (n) => `${Number(n).toLocaleString('en-IN', { maximumFractionDigits: n < 1 ? 4 : 2 })} XLM`;
const fiat = (n) => {
  const p = S.prices[S.fiat];
  if (!p) return '';
  const v = n * p;
  return `${SYM[S.fiat]}${v.toLocaleString(S.fiat === 'INR' ? 'en-IN' : 'en-GB', { maximumFractionDigits: v < 10 ? 2 : 0 })}`;
};
const locale = () => ({ en: 'en-GB', hi: 'hi-IN', ta: 'ta-IN' })[getLang()] ?? 'en-GB';
const when = (iso) => new Date(iso).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const day = (secs) => new Date(secs * 1000).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
const short = (a) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const errText = (e) => (e?.code && has(`err_${e.code}`) ? t(`err_${e.code}`) : e?.message || String(e));

const COLORS = ['#0E4D5C', '#B5452F', '#5A3A8C', '#2F6B2F', '#8A4B00', '#1F4E8C'];
const colorFor = (seed) => {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
};
const initials = (name) =>
  [...String(name).replace(/\(.*?\)/g, '').trim()]
    .join('')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => [...w][0]?.toUpperCase() ?? '')
    .join('') || '?';
const avatar = (name, seed, cls = '', tick = false) =>
  `<span class="avatar ${cls}" style="--c:${colorFor(seed)}" title="${esc(name)}" aria-hidden="true">${esc(initials(name))}${
    tick ? '<span class="tick"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4"><path d="M20 6 9 17l-5-5"/></svg></span>' : ''
  }</span>`;

const PURPOSES = [
  ['💊', 'p_medicine'],
  ['🏥', 'p_hospital'],
  ['🛒', 'p_groceries'],
  ['🏠', 'p_rent'],
  ['💡', 'p_bills'],
  ['🧑‍⚕️', 'p_caregiver'],
];
const purposeEmoji = (p) => {
  const s = String(p).toLowerCase();
  if (/medic|pharm|bp|tablet|दवा|மருந்/.test(s)) return '💊';
  if (/hospit|doctor|clinic|scan|अस्पताल|மருத்துவமனை/.test(s)) return '🏥';
  if (/grocer|food|kirana|राशन|மளிகை/.test(s)) return '🛒';
  if (/rent|किराया|வாடகை/.test(s)) return '🏠';
  if (/bill|electric|water|phone|बिल|கட்டண/.test(s)) return '💡';
  if (/care|nurse|maid|help|देखभाल|பராமரிப்/.test(s)) return '🧑‍⚕️';
  return '🧾';
};

const currentPot = () => S.pots.find((p) => p.id === S.potId) ?? null;
const nameFor = (address, pot) => {
  if (!address) return '—';
  const m = (pot ?? currentPot())?.members.find((x) => x.address === address);
  if (m) return m.name;
  if (S.contacts[address]) return S.contacts[address];
  const id = S.ids.find((x) => R.fromSecret(x.secret).publicKey() === address);
  if (id) return id.name;
  const p = S.pots.find((x) => x.id === address);
  if (p) return p.name;
  return short(address);
};

// =====================================================================
// Toasts, modal, confetti, speech
// =====================================================================
function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 400);
  }, 4600);
}

const modal = $('#modal');
function openModal(title, body) {
  modal.innerHTML = `<div class="modal-head"><h2>${title}</h2><button class="x" data-act="close" aria-label="${esc(t('close'))}">✕</button></div><div class="modal-body">${body}</div>`;
  if (!modal.open) modal.showModal();
  $('input, select, button.chip', modal)?.focus();
}
const closeModal = () => modal.open && modal.close();
modal.addEventListener('click', (e) => {
  if (e.target === modal) closeModal();
});

function speak(text) {
  if (!('speechSynthesis' in window)) return toast(text);
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = speechLang();
  speechSynthesis.speak(u);
}

function confetti() {
  if (reduced) return;
  const c = $('#confetti');
  const ctx = c.getContext('2d');
  c.width = innerWidth * devicePixelRatio;
  c.height = innerHeight * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);
  const cols = ['#F2A33A', '#E5604D', '#1B6B45', '#5A3A8C', '#2E8BA0', '#0E4D5C'];
  const parts = Array.from({ length: 160 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 200,
    y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 14,
    vy: -Math.random() * 14 - 4,
    w: 6 + Math.random() * 6,
    h: 8 + Math.random() * 8,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    c: cols[(Math.random() * cols.length) | 0],
  }));
  let n = 0;
  (function frame() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.35;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.globalAlpha = Math.max(0, 1 - n / 160);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (++n < 170) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, innerWidth, innerHeight);
  })();
  setTimeout(() => ctx.clearRect(0, 0, innerWidth, innerHeight), 4000);
}

// Count numbers up from their previous value.
const shown = new Map();
const xlmUnit = (n, unit) => `${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}${unit}`;
function animateCounts(root) {
  for (const el of $$('[data-count]', root)) {
    const key = el.dataset.key;
    const to = Number(el.dataset.count);
    const from = shown.get(key) ?? 0;
    shown.set(key, to);
    const unit = ' XLM';
    if (reduced || from === to || document.hidden) {
      el.textContent = xlmUnit(to, unit);
      continue;
    }
    // Background tabs pause animation frames; make sure the real value always lands.
    setTimeout(() => (el.textContent = xlmUnit(to, unit)), 1100);
    const t0 = performance.now();
    (function tick(now) {
      const k = Math.max(0, Math.min(1, (now - t0) / 900)); // rAF time can precede t0
      el.textContent = xlmUnit(from + (to - from) * (1 - Math.pow(1 - k, 3)), unit);
      if (k < 1) requestAnimationFrame(tick);
    })(t0);
  }
}

function growBars(root) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      for (const el of $$('[data-w]', root)) el.style.width = `${el.dataset.w}%`;
      for (const el of $$('[data-dash]', root)) el.style.strokeDasharray = el.dataset.dash.replace(' ', 'px ') + 'px';
      for (const el of $$('[data-offset]', root)) el.style.strokeDashoffset = `${el.dataset.offset}px`;
    }),
  );
}

function qrSvg(text, cell = 3) {
  try {
    const q = window.qrcode(0, 'L');
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: cell, margin: 2, scalable: true });
  } catch {
    return '';
  }
}

// =====================================================================
// Language
// =====================================================================
function fillLangSelects() {
  for (const sel of $$('select[data-change="lang"]')) {
    sel.innerHTML = LANGS.map((l) => `<option value="${l.code}" ${l.code === getLang() ? 'selected' : ''}>${l.label}</option>`).join('');
  }
}
function changeLang(code) {
  setLang(code);
  applyStatic();
  fillLangSelects();
  demoCard.reset();
  if (!$('#appRoot').hidden) renderApp(true);
}

// =====================================================================
// Install (PWA)
// =====================================================================
let installEvt = null;
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function syncInstall() {
  const installed = standalone() || store.get('installed', false);
  $('#installBtn').hidden = installed;
  $('#installedPill').hidden = !installed;
}
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvt = e;
});
addEventListener('appinstalled', () => {
  store.set('installed', true);
  syncInstall();
  toast(t('dl_installed'), 'ok');
});
async function install() {
  if (installEvt) {
    installEvt.prompt();
    const { outcome } = await installEvt.userChoice;
    installEvt = null;
    if (outcome === 'accepted') {
      store.set('installed', true);
      syncInstall();
    }
    return;
  }
  // No prompt available (iPhone/Safari, Firefox, or already installed): show the manual steps.
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  openModal(
    t('dl_install_t'),
    `<img src="assets/phone.svg" alt="" style="width:140px;margin:0 auto" />
     <div class="dl-step"><span class="os" aria-hidden="true">${ios ? '📱' : '🤖'}</span><div><b>${t(ios ? 'dl_ios_t' : 'dl_android_t')}</b><span>${t(ios ? 'dl_ios_p' : 'dl_android_p')}</span></div></div>
     <button class="btn btn-primary" data-act="close">${t('got_it')}</button>`,
  );
}

// =====================================================================
// Landing page motion
// =====================================================================
const demoCard = (() => {
  let phase = 0;
  const steps = () => $$('#stepList li');
  const rows = () => $$('#demoCard .demo-row');
  const set = (p) => {
    const meter = $('#demoMeter');
    const count = $('#demoCount');
    const status = $('#demoStatus');
    steps().forEach((s, k) => s.classList.toggle('on', k === Math.min(p, 3)));
    const r = rows();
    if (p === 0) {
      r.forEach((x) => {
        x.classList.remove('ok');
        $('.state', x).textContent = t('demo_waiting');
      });
      meter.classList.remove('full');
      $('i', meter).style.width = '0%';
      count.textContent = t('demo_count', { n: 0 });
      status.className = 'demo-status';
      status.textContent = t('demo_st_wait');
    } else if (p === 1) {
      r[0].classList.add('ok');
      $('.state', r[0]).textContent = t('demo_asked');
      $('i', meter).style.width = '50%';
      count.textContent = t('demo_count', { n: 1 });
      status.textContent = t('demo_st_shared');
    } else if (p === 2) {
      r[2].classList.add('ok');
      $('.state', r[2]).textContent = t('demo_approved');
      $('i', meter).style.width = '100%';
      meter.classList.add('full');
      count.textContent = t('demo_count', { n: 2 });
    } else if (p === 3) {
      status.className = 'demo-status paid';
      status.textContent = t('demo_st_paid');
    }
  };
  return {
    tick() {
      set(phase++ % 5);
    },
    reset() {
      phase = 0;
      set(0);
      phase = 1;
    },
  };
})();

function initLanding() {
  const nav = $('#nav');
  addEventListener('scroll', () => nav.classList.toggle('scrolled', scrollY > 10), { passive: true });

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries)
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
    },
    { threshold: 0.12 },
  );
  $$('.reveal').forEach((el) => io.observe(el));

  // Floating activity toasts over the hero illustration.
  const msgs = [
    ['A', '#B5452F', 'ht1'],
    ['P', '#0E4D5C', 'ht2'],
    ['M', '#5A3A8C', 'ht3'],
    ['P', '#0E4D5C', 'ht4'],
    ['A', '#B5452F', 'ht5'],
  ];
  let i = 0;
  const box = $('#heroToasts');
  const push = () => {
    if (document.hidden || $('#landing').hidden) return;
    const [ini, c, k] = msgs[i++ % msgs.length];
    const el = document.createElement('div');
    el.className = 'mini-toast';
    el.innerHTML = `<span class="avatar sm" style="--c:${c}">${ini}</span><div><b>${esc(t(`${k}_t`))}</b><small>${esc(t(`${k}_s`))}</small></div>`;
    box.prepend(el);
    const all = $$('.mini-toast', box);
    if (all.length > 2) {
      const last = all[all.length - 1];
      last.classList.add('out');
      setTimeout(() => last.remove(), 400);
    }
  };
  push();
  setTimeout(push, 1200);
  setInterval(push, 3200);

  demoCard.reset();
  setInterval(() => demoCard.tick(), 2000);

  $('#siteQr').innerHTML = qrSvg(SITE, 3);
  syncInstall();
}

// =====================================================================
// Routing
// =====================================================================
function route() {
  const h = location.hash || '#/';
  const inApp = h.startsWith('#/app');
  $('#landing').hidden = inApp;
  $('#appRoot').hidden = !inApp;
  document.title = inApp ? 'RELAY · Family dashboard' : 'RELAY · Family Care Pots';
  if (!inApp) return;
  const m = h.match(/#\/app\/pot\/(G[A-Z2-7]{55})/);
  if (m) S.potId = m[1];
  if (/[?&]demo=1/.test(h)) {
    history.replaceState(null, '', `${location.pathname}#/app`);
    if (!S.ids.length) return startDemo();
  }
  renderApp(true);
  refresh();
}

// A request link: ?proposal=<signed transaction>. Pull it out of the address bar.
(function readLink() {
  const x = new URLSearchParams(location.search).get('proposal');
  if (x) {
    S.openProposal = x;
    history.replaceState(null, '', `${location.pathname}#/app`);
  }
})();

// =====================================================================
// Data
// =====================================================================
let refreshing = null;
async function refresh() {
  if (!kp() || refreshing) return refreshing;
  refreshing = (async () => {
    S.loading = true;
    try {
      const pk = me();
      const [w, ids] = await Promise.all([R.getWallet(pk), R.myPots(pk)]);
      S.wallet = w;
      S.pots = await Promise.all(ids.map((id) => R.getPot(id)));
      if (!S.pots.some((p) => p.id === S.potId)) S.potId = S.pots[0]?.id ?? null;
      const pot = currentPot();
      if (pot) {
        S.ledger = await R.ledger(pot);
        const mine = S.proposals.filter((p) => p.potId === pot.id);
        const inspected = await Promise.all(mine.map((p) => R.inspectProposal(p.xdr).catch(() => null)));
        const dead = inspected.filter((p) => p && (p.status === 'stale' || p.status === 'expired')).map((p) => p.xdr);
        if (dead.length) {
          S.proposals = S.proposals.filter((p) => !dead.includes(p.xdr));
          saveProposals();
        }
        S.pending = inspected.filter((p) => p && (p.status === 'waiting' || p.status === 'ready'));
      } else {
        S.ledger = null;
        S.pending = [];
      }
      S.error = null;
    } catch (e) {
      S.error = errText(e);
    } finally {
      S.loading = false;
      refreshing = null;
      renderApp();
    }
  })();
  return refreshing;
}

async function act(btn, fn) {
  const label = btn?.innerHTML;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="spin"></span> ${esc(t('working'))}`;
  }
  try {
    await fn();
  } catch (e) {
    const msg = errText(e);
    toast(msg, 'bad');
    const slot = $('.err-slot', modal);
    if (slot && modal.open) slot.innerHTML = `<div class="err" role="alert">${esc(msg)}</div>`;
  } finally {
    if (btn && btn.isConnected) {
      btn.disabled = false;
      btn.innerHTML = label;
    }
  }
}

// Amount fields can be typed in XLM or in the chosen local currency.
function readAmount() {
  const raw = Number(String($('#amt')?.value ?? '').replace(/,/g, '').replace(/[^\d.]/g, ''));
  if (!raw || raw <= 0) return 0;
  if (S.unit === 'FIAT' && S.prices[S.fiat]) return Math.round((raw / S.prices[S.fiat]) * 1e7) / 1e7;
  return raw;
}
const amountField = () => `
  <div class="f" style="display:grid;gap:6px;font-weight:700">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
      <label for="amt">${t('amount')}</label>
      ${S.prices[S.fiat] ? `<span class="unit-pick" role="group" aria-label="${esc(t('amount_in'))}"><button type="button" data-act="unit" data-v="XLM" aria-pressed="${S.unit === 'XLM'}">XLM</button><button type="button" data-act="unit" data-v="FIAT" aria-pressed="${S.unit === 'FIAT'}">${SYM[S.fiat].trim()}</button></span>` : ''}
    </div>
    <input class="input" id="amt" inputmode="decimal" placeholder="0" autocomplete="off" style="font-size:24px;font-weight:700" />
  </div>`;
function amountHint(extra = '') {
  const x = readAmount();
  if (!x) return extra;
  return S.unit === 'FIAT' ? `${t('equals', { v: xlm(x) })}${extra ? ` · ${extra}` : ''}` : fiat(x) ? `≈ ${fiat(x)}${extra ? ` · ${extra}` : ''}` : extra;
}

// =====================================================================
// App rendering
// =====================================================================
const root = $('#appRoot');

function renderApp(force = false) {
  if ($('#appRoot').hidden) return;
  document.documentElement.style.setProperty('--zoom', S.zoom);
  if (!S.ids.length) return renderOnboard();
  const html = shell();
  if (!force && html === S.lastHtml) return;
  S.lastHtml = html;
  const y = scrollY;
  root.innerHTML = html;
  fillLangSelects();
  scrollTo(0, y);
  animateCounts(root);
  growBars(root);
}

function shell() {
  const pk = me();
  return `
  <div class="app">
    <aside class="side">
      <a class="brand" href="#/"><img src="assets/logo.svg" alt="" />RELAY</a>
      <div>
        <h4>${t('you_are')}</h4>
        <div class="who-card">
          ${avatar(S.ids[S.active].name, pk)}
          <div style="flex:1;min-width:0">
            <label class="sr-only" for="whoSel">${t('switch_label')}</label>
            <select id="whoSel" data-change="who">
              ${S.ids.map((x, i) => `<option value="${i}" ${i === S.active ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
              <option value="new">${t('add_wallet')}</option>
            </select>
            <small>${S.ids.length > 1 ? t('switch_hint') : short(pk)}</small>
          </div>
        </div>
      </div>
      <div>
        <h4>${t('family_pots')}</h4>
        <nav aria-label="${esc(t('family_pots'))}">
          ${
            S.pots.length
              ? S.pots
                  .map(
                    (p) => `<button class="pot-link ${p.id === S.potId ? 'active' : ''}" data-act="pot" data-id="${p.id}" aria-current="${p.id === S.potId}">
                <span class="ic">❤</span><span style="flex:1;min-width:0"><b>${esc(p.name)}</b><small>${xlm(p.spendable)} · ${p.approvals}/${p.members.length}</small></span></button>`,
                  )
                  .join('')
              : S.loading && !S.wallet
                ? '<div class="skel" style="height:56px"></div>'
                : `<p style="color:var(--soft);font-size:14px;margin:4px 0">${t('no_pots_side')}</p>`
          }
        </nav>
        <button class="btn btn-ghost btn-sm" style="width:100%;margin-top:10px" data-act="newPot">${t('start_pot_plus')}</button>
        <button class="btn btn-text btn-sm" style="width:100%;margin-top:4px" data-act="invite">${t('invite_family')}</button>
      </div>
      <div style="display:grid;gap:12px">
        <label style="display:grid;gap:6px"><h4 style="margin:0">🌐 ${t('language')}</h4>
          <select class="input" data-change="lang" style="min-height:44px"></select></label>
        <div><h4>${t('text_size')}</h4>
          <div class="size-pick" role="group" aria-label="${esc(t('text_size'))}">
            ${[
              [1, 'A'],
              [1.15, 'A+'],
              [1.3, 'A++'],
            ]
              .map(([z, l]) => `<button data-act="zoom" data-v="${z}" aria-pressed="${S.zoom === z}" style="font-size:${13 * z}px">${l}</button>`)
              .join('')}
          </div></div>
        <label style="display:grid;gap:6px"><h4 style="margin:0">${t('show_in')}</h4>
          <select class="input" data-change="fiat" style="min-height:44px">
            ${Object.keys(SYM).map((c) => `<option ${c === S.fiat ? 'selected' : ''}>${c}</option>`).join('')}
          </select></label>
      </div>
      <div class="wallet-card">
        <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;opacity:.8;font-weight:800">${t('my_wallet')}</div>
        <div class="bal">${S.wallet ? xlm(S.wallet.spendable) : '…'}</div>
        <div class="addr">${pk}</div>
        <div class="row">
          <button class="btn btn-sm" data-act="copy" data-text="${pk}">${t('copy_address')}</button>
          <button class="btn btn-sm" data-act="topup">${t('test_xlm')}</button>
        </div>
      </div>
    </aside>
    <main class="main" id="main">${S.openProposal ? proposalPage() : mainView()}</main>
  </div>`;
}

function renderOnboard() {
  S.lastHtml = '';
  root.innerHTML = `
  <div class="onboard">
    <div class="art-side">
      <div style="max-width:440px;text-align:center">
        <img src="assets/amma.svg" alt="" style="width:300px;margin:0 auto 10px;filter:drop-shadow(0 20px 40px rgba(0,0,0,.3))" />
        <h2 style="font-family:var(--display);font-weight:600;font-size:38px;line-height:1.15;margin:0 0 12px">${t('ob_art_h')}</h2>
        <p style="opacity:.85">${t('ob_art_p')}</p>
      </div>
    </div>
    <div class="form-side">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <a class="brand" href="#/"><img src="assets/logo.svg" alt="" />RELAY</a>
        <label class="lang-pick" style="margin-left:auto"><span class="sr-only">${t('language')}</span><span aria-hidden="true">🌐</span><select data-change="lang" class="lang-select"></select></label>
      </div>
      <h1 style="font-family:var(--display);font-weight:600;font-size:clamp(32px,4vw,44px);margin:8px 0 0;line-height:1.15">${t('ob_h1')}</h1>
      <p style="color:var(--muted);margin:0">${t('ob_net')}</p>
      <button class="choice-card featured" data-act="demo">
        <span class="ic" style="background:var(--marigold-soft)">👨‍👩‍👧</span>
        <span><b>${t('ob_demo_t')}</b><span>${t('ob_demo_p')}</span></span>
      </button>
      <button class="choice-card" data-act="create">
        <span class="ic" style="background:var(--teal-soft)">✨</span>
        <span><b>${t('ob_create_t')}</b><span>${t('ob_create_p')}</span></span>
      </button>
      <button class="choice-card" data-act="import">
        <span class="ic" style="background:var(--plum-soft)">🔑</span>
        <span><b>${t('ob_import_t')}</b><span>${t('ob_import_p')}</span></span>
      </button>
      ${S.openProposal ? `<div class="pill pill-gold" style="align-self:flex-start">${t('ob_link')}</div>` : ''}
    </div>
  </div>`;
  fillLangSelects();
}

function mainView() {
  if (S.error && !S.wallet) return `<div class="card"><h3>${t('reach_fail')}</h3><p class="hint">${esc(S.error)}</p><button class="btn btn-primary" data-act="refresh">${t('try_again')}</button></div>`;
  const pot = currentPot();
  if (!pot) {
    if (S.loading || !S.wallet) return loadingView();
    return `
    <div class="topbar"><h1>${t('namaste', { name: esc(S.ids[S.active].name.replace(/\s*\(.*\)/, '')) })}</h1></div>
    ${gettingStarted(null)}
    <div class="card empty">
      <img src="assets/use-home.svg" alt="" style="width:260px;border-radius:24px" />
      <h2 style="font-family:var(--display);font-weight:600;font-size:30px;margin:14px 0 6px">${t('first_pot_t')}</h2>
      <p style="color:var(--muted);max-width:32em;margin:0 auto 20px">${t('first_pot_p')}</p>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <button class="btn btn-primary btn-lg" data-act="newPot">${t('start_pot')}</button>
        <button class="btn btn-ghost btn-lg" data-act="invite">${t('invite_family')}</button>
      </div>
    </div>`;
  }
  return potView(pot);
}

const loadingView = () => `
  <div class="topbar"><div class="skel" style="height:40px;width:260px"></div></div>
  <div class="grid g-hero"><div class="skel" style="height:260px;border-radius:28px"></div><div class="skel" style="height:260px;border-radius:28px"></div></div>`;

function gettingStarted(pot) {
  if (S.gs.hidden) return '';
  const L = S.ledger;
  const done = [
    !!pot,
    !!(pot && L && L.incoming.some((x) => x.from === me())),
    !!(pot && (S.pending.length || L?.spent.length)),
    !!S.gs.shared,
  ];
  if (done.every(Boolean)) return '';
  const acts = ['newPot', 'add', 'request', S.pending[0] ? 'shareFirst' : 'request'];
  return `<section class="card gs" aria-label="${esc(t('gs_t'))}">
    <img src="assets/use-medicine.svg" alt="" style="border-radius:20px" />
    <div>
      <h3>${t('gs_t')}</h3><p class="hint" style="margin:0">${t('gs_p')}</p>
      <ol>${['gs_1', 'gs_2', 'gs_3', 'gs_4']
        .map((k, i) => {
          const can = i === 0 || pot;
          return `<li class="${done[i] ? 'done' : ''}"><i>${done[i] ? '✓' : i + 1}</i>${t(k)}${!done[i] && can ? `<button class="btn btn-ghost btn-sm" data-act="${acts[i]}">${t('gs_do')}</button>` : ''}</li>`;
        })
        .join('')}</ol>
    </div>
    <button class="btn btn-text btn-sm" data-act="gsHide">${t('gs_hide')}</button>
  </section>`;
}

function potView(pot) {
  const L = S.ledger ?? { contributions: [], spent: [], incoming: [] };
  const totals = new Map(L.contributions.map((c) => [c.member, c.total]));
  const totalIn = pot.members.reduce((s, m) => s + (totals.get(m.address) ?? 0), 0);
  const totalOut = L.spent.reduce((s, x) => s + x.amount, 0);
  const even = pot.members.length ? totalIn / pot.members.length : 0;
  const maxPaid = Math.max(1, ...pot.members.map((m) => totals.get(m.address) ?? 0), even);
  const isMember = pot.members.some((m) => m.address === me());

  const R0 = 70;
  const C0 = 2 * Math.PI * R0;
  let acc = 0;
  const segs = pot.members
    .map((m) => {
      const v = totalIn ? (totals.get(m.address) ?? 0) / totalIn : 0;
      const seg = `<circle class="seg" cx="85" cy="85" r="${R0}" fill="none" stroke="${colorFor(m.address)}" stroke-width="22" stroke-dasharray="0 ${C0}" data-dash="${Math.max(0, v * C0 - 3)} ${C0}" stroke-dashoffset="${-acc * C0}" />`;
      acc += v;
      return seg;
    })
    .join('');

  const byPurpose = [...L.spent.reduce((m, s) => m.set(s.purpose || '—', (m.get(s.purpose || '—') ?? 0) + s.amount), new Map()).entries()].sort((a, b) => b[1] - a[1]);
  const events = [
    ...L.spent.map((s) => ({ kind: 'out', at: s.at, s })),
    ...L.incoming.map((s) => ({ kind: 'in', at: s.at, s })),
    ...(L.setup ? [{ kind: 'setup', at: L.setup.at, s: L.setup }] : []),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

  return `
  <div class="topbar">
    <div>
      <div style="color:var(--soft);font-weight:700;font-size:14px">${t('fcp')}</div>
      <h1>${esc(pot.name)}</h1>
    </div>
    <div class="stack" style="margin-left:6px">${pot.members.map((m) => avatar(m.name, m.address, 'ring')).join('')}</div>
    <span class="spacer"></span>
    <span class="pill pill-ok">${t('needs_rule', { n: pot.approvals, total: pot.members.length })}</span>
    <button class="help-btn" data-act="help">? ${t('what_is_this')}</button>
    <button class="btn btn-text btn-sm" data-act="speak">${t('read_aloud')}</button>
    <button class="btn btn-text btn-sm" data-act="refresh">${t('refresh')}</button>
  </div>
  ${!isMember ? `<div class="err" style="margin-bottom:16px">${t('not_member_pot')}</div>` : ''}
  ${gettingStarted(pot)}

  <div class="grid g-hero">
    <section class="card pot-hero" aria-label="${esc(t('in_pot'))}">
      <div class="lbl">${t('in_pot')}</div>
      <div class="big" data-count="${pot.spendable}" data-key="bal-${pot.id}">${xlm(pot.spendable)}</div>
      <div class="fiat">${fiat(pot.spendable) ? t('about', { v: fiat(pot.spendable) }) : '&nbsp;'}</div>
      <div class="actions">
        <button class="btn btn-accent btn-lg" data-act="add">${t('put_in')}</button>
        <button class="btn btn-ghost btn-lg" data-act="request">${t('ask_pay')}</button>
        <a class="btn btn-ghost" href="${R.explorerAccount(pot.id)}" target="_blank" rel="noopener">${t('proof_btn')}</a>
      </div>
    </section>
    <section class="card">
      <h3>${t('waiting_t')}</h3>
      <p class="hint">${t('waiting_hint', { n: pot.approvals })}</p>
      ${S.pending.length ? S.pending.map((p) => requestCard(p, pot)).join('') : `<div class="empty" style="padding:18px 0"><div style="font-size:42px">🕊️</div><p style="color:var(--soft);margin:6px 0 0">${t('no_requests')}</p></div>`}
    </section>
  </div>

  <div class="grid g-4" style="margin-top:20px">
    ${kpi('💰', 'var(--ok-bg)', t('kpi_in'), totalIn, t('kpi_in_s', { a: L.contributions.length, b: pot.members.length }), `in-${pot.id}`)}
    ${kpi('📤', 'var(--plum-soft)', t('kpi_out'), totalOut, t('kpi_out_s', { n: L.spent.length }), `out-${pot.id}`)}
    ${kpi('⚖️', 'var(--marigold-soft)', t('kpi_even'), even, t('kpi_even_s'), `even-${pot.id}`)}
    ${kpi('⏳', 'var(--warn-bg)', t('kpi_wait'), S.pending.reduce((s, p) => s + p.amount, 0), t('kpi_wait_s', { n: S.pending.length }), `wait-${pot.id}`)}
  </div>

  <div class="grid g-2" style="margin-top:20px">
    <section class="card">
      <h3>${t('who_paid')}</h3>
      <p class="hint">${t('who_paid_hint')}</p>
      <div class="donut-wrap">
        <div class="donut" aria-hidden="true">
          <svg viewBox="0 0 170 170" width="170" height="170"><circle cx="85" cy="85" r="${R0}" fill="none" stroke="var(--bg-2)" stroke-width="22"/>${segs}</svg>
          <div class="mid"><div><b>${xlm(totalIn).replace(' XLM', '')}</b><small>${t('paid_in_mid')}</small></div></div>
        </div>
        <div class="share-list">
          ${pot.members
            .map((m) => {
              const paid = totals.get(m.address) ?? 0;
              const diff = paid - even;
              const st = Math.abs(diff) < 0.5 ? ['', t('even_ok')] : diff > 0 ? ['ahead', t('above', { v: xlm(diff) })] : ['behind', t('below', { v: xlm(-diff) })];
              return `<div class="share-row">
                ${avatar(m.name, m.address, 'sm')}
                <div><div class="nm">${esc(m.name)}${m.address === me() ? ` <span style="color:var(--soft);font-weight:600">${t('you_tag')}</span>` : ''}</div><div class="st ${st[0]}">${st[1]}</div></div>
                <div class="amt">${xlm(paid)}<small>${totalIn ? Math.round((paid / totalIn) * 100) : 0}%</small></div>
                <div class="bar" style="--c:${colorFor(m.address)}"><i data-w="${(paid / maxPaid) * 100}"></i><u style="left:${(even / maxPaid) * 100}%"></u></div>
              </div>`;
            })
            .join('')}
        </div>
      </div>
    </section>
    <section class="card">
      <h3>${t('where_t')}</h3>
      <p class="hint">${t('where_hint')}</p>
      ${
        byPurpose.length
          ? byPurpose
              .map(
                ([p, a]) => `<div class="purpose"><span class="ic">${purposeEmoji(p)}</span><b>${esc(p)}</b><b>${xlm(a)}</b>
              <div class="bar" style="--c:var(--plum)"><i data-w="${totalOut ? (a / totalOut) * 100 : 0}"></i></div></div>`,
              )
              .join('')
          : `<div class="empty" style="padding:10px 0"><img src="assets/use-groceries.svg" alt="" style="width:200px;border-radius:20px" /><p style="color:var(--soft);margin:10px 0 0">${t('where_empty')}</p></div>`
      }
    </section>
  </div>

  <section class="card" style="margin-top:20px">
    <h3>${t('timeline_t')}</h3>
    <p class="hint">${t('timeline_hint')}</p>
    ${
      events.length
        ? `<ol class="timeline">${events
            .map((e, i) => {
              const delay = `style="animation-delay:${Math.min(i, 10) * 40}ms"`;
              if (e.kind === 'out')
                return `<li class="tl" ${delay}><span class="dot out">${purposeEmoji(e.s.purpose)}</span>
                <div><b>${esc(e.s.purpose || t('tl_payment'))} → ${esc(nameFor(e.s.to, pot))}</b><div class="meta">${when(e.at)} · <a class="proof" href="${R.explorerTx(e.s.hash)}" target="_blank" rel="noopener">${t('proof_short')}</a></div>
                <div class="by"><span class="stack">${e.s.approvedBy.map((a) => avatar(nameFor(a, pot), a, 'sm ring')).join('')}</span>${t('approved_by', { names: esc(e.s.approvedBy.map((a) => nameFor(a, pot)).join(' + ')) })}</div></div>
                <span class="amt neg">−${xlm(e.s.amount)}</span></li>`;
              if (e.kind === 'in')
                return `<li class="tl" ${delay}><span class="dot in">💛</span><div><b>${t('tl_put_in', { name: esc(nameFor(e.s.from, pot)) })}</b><div class="meta">${when(e.at)} · <a class="proof" href="${R.explorerTx(e.s.hash)}" target="_blank" rel="noopener">${t('proof_short')}</a></div></div><span class="amt pos">+${xlm(e.s.amount)}</span></li>`;
              return `<li class="tl" ${delay}><span class="dot setup">🏡</span><div><b>${t('tl_opened', { name: esc(nameFor(e.s.by, pot)) })}</b><div class="meta">${when(e.at)} · ${t('tl_reserve', { v: xlm(e.s.amount) })}</div></div><span></span></li>`;
            })
            .join('')}</ol>`
        : `<p style="color:var(--soft)">${t('loading_ledger')}</p>`
    }
  </section>`;
}

const kpi = (icon, bg, label, value, sub, key) => `
  <section class="card kpi"><div class="k"><i style="background:${bg}">${icon}</i>${label}</div>
  <div class="v" data-count="${value}" data-key="${key}">${xlm(value)}</div><div class="s">${sub}${fiat(value) ? ` · ≈ ${fiat(value)}` : ''}</div></section>`;

function ring(have, need, size = 64, color = 'var(--marigold)') {
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  const v = Math.min(1, have / need);
  return `<div class="ring" style="width:${size}px;height:${size}px" aria-hidden="true"><svg width="${size}" height="${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#fff" stroke-width="7"/>
    <circle class="p" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${v >= 1 ? 'var(--ok)' : color}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c}" data-offset="${c * (1 - v)}"/></svg><b>${have}/${need}</b></div>`;
}

function requestCard(p, pot) {
  const mine = me();
  const approved = p.approvedBy.some((m) => m.address === mine);
  const isMember = pot.members.some((m) => m.address === mine);
  const left = Math.max(0, p.needed - p.approvedBy.length);
  return `<div class="req">
    ${ring(p.approvedBy.length, p.needed)}
    <div>
      <div class="t">${purposeEmoji(p.purpose)} ${xlm(p.amount)} → ${esc(nameFor(p.to, pot))}</div>
      <div class="m">${esc(p.purpose)} ${fiat(p.amount) ? `· ≈ ${fiat(p.amount)}` : ''}</div>
      <div class="m" style="margin-top:4px"><span class="stack">${p.approvedBy.map((m) => avatar(m.name, m.address, 'sm ring', true)).join('')}</span>
        ${p.status === 'ready' ? `<b style="color:var(--ok)">${t('req_ready')}</b>` : `<b style="color:var(--warn)">${t('req_more', { n: left })}</b>`}${p.expiresAt ? ` · ${t('expires', { d: day(p.expiresAt) })}` : ''}</div>
    </div>
    <div class="btns">
      ${p.status === 'ready' ? `<button class="btn btn-ok" data-act="submit" data-xdr="${esc(p.xdr)}">${t('send_payment')}</button>` : ''}
      ${p.status === 'waiting' && isMember && !approved ? `<button class="btn btn-ok" data-act="approve" data-xdr="${esc(p.xdr)}">${t('approve_btn')}</button>` : ''}
      <button class="btn btn-ghost btn-sm" data-act="share" data-xdr="${esc(p.xdr)}">${t('share')}</button>
    </div>
  </div>`;
}

function proposalPage() {
  const p = S.linkProposal;
  if (!p) {
    if (!S.linkLoading && !S.linkError) loadLinkProposal();
    return `<div class="topbar"><h1>${t('pr_title')}</h1></div>${S.linkError ? `<div class="err">${esc(S.linkError)}</div><button class="btn btn-ghost" data-act="closeLink" style="margin-top:12px">${t('back_pots')}</button>` : '<div class="skel" style="height:320px;border-radius:28px"></div>'}`;
  }
  const mine = me();
  const approved = p.approvedBy.some((m) => m.address === mine);
  const isMember = p.pot.members.some((m) => m.address === mine);
  return `
  <div class="topbar"><div><div style="color:var(--soft);font-weight:700;font-size:14px">${t('pr_from', { pot: esc(p.pot.name) })}</div><h1>${t('pr_title')}</h1></div><span class="spacer"></span><button class="btn btn-text" data-act="closeLink">${t('back_pots')}</button></div>
  <div class="grid g-2">
    <section class="card pot-hero">
      <span class="pill pill-glass">${purposeEmoji(p.purpose)} ${esc(p.purpose || t('tl_payment'))}</span>
      <div class="big">${xlm(p.amount)}</div>
      <div class="fiat">${fiat(p.amount) ? t('about', { v: fiat(p.amount) }) : '&nbsp;'}</div>
      <div style="display:flex;gap:12px;align-items:center;margin-top:18px;background:rgba(255,255,255,.14);padding:14px;border-radius:18px">
        ${avatar(nameFor(p.to, p.pot), p.to, 'lg')}<div><div style="opacity:.8;font-size:13px">${t('to')}</div><b>${esc(nameFor(p.to, p.pot))}</b><div style="opacity:.75;font-size:12px;font-family:ui-monospace,monospace">${short(p.to)}</div></div>
      </div>
    </section>
    <section class="card">
      <div style="display:flex;gap:18px;align-items:center">
        ${ring(p.approvedBy.length, p.needed, 96)}
        <div><h3>${t('approvals_of', { a: p.approvedBy.length, b: p.needed })}</h3><p class="hint" style="margin:0">${p.status === 'stale' ? t('pr_stale') : p.status === 'expired' ? t('pr_expired') : p.expiresAt ? t('expires_on', { d: day(p.expiresAt) }) : ''}</p></div>
      </div>
      <div style="display:grid;gap:10px;margin:18px 0">
        ${p.pot.members.map((m) => `<div style="display:flex;gap:12px;align-items:center">${avatar(m.name, m.address, '', p.approvedBy.some((a) => a.address === m.address))}<b style="flex:1">${esc(m.name)}${m.address === mine ? ` ${t('you_tag')}` : ''}</b>${p.approvedBy.some((a) => a.address === m.address) ? `<span class="pill pill-ok">${t('approved')}</span>` : `<span class="pill">${t('waiting')}</span>`}</div>`).join('')}
      </div>
      ${
        p.status === 'waiting' && isMember && !approved
          ? `<button class="btn btn-ok btn-lg" style="width:100%" data-act="approve" data-xdr="${esc(p.xdr)}">${t('approve_sign')}</button>`
          : p.status === 'ready'
            ? `<button class="btn btn-ok btn-lg" style="width:100%" data-act="submit" data-xdr="${esc(p.xdr)}">${t('send_now')}</button>`
            : !isMember && p.status === 'waiting'
              ? `<div class="pill pill-warn">${t('only_members')}</div>`
              : approved && p.status === 'waiting'
                ? `<button class="btn btn-ghost" style="width:100%" data-act="share" data-xdr="${esc(p.xdr)}">${t('share_family')}</button>`
                : ''
      }
    </section>
  </div>`;
}

async function loadLinkProposal() {
  S.linkLoading = true;
  try {
    S.linkProposal = await R.inspectProposal(S.openProposal);
    S.linkError = null;
  } catch (e) {
    S.linkError = errText(e);
  }
  S.linkLoading = false;
  renderApp(true);
}

// =====================================================================
// Modals
// =====================================================================
function addMoneyModal() {
  const pot = currentPot();
  openModal(
    t('add_t'),
    `<p style="margin:0;color:var(--muted)">${t('add_into', { pot: esc(pot.name) })}</p>
    ${amountField()}
    <div class="chips">${[50, 100, 250, 500].map((n) => `<button class="chip" data-act="fill" data-v="${n}" aria-pressed="false">+${n}</button>`).join('')}</div>
    <div id="amtHint" style="color:var(--soft);min-height:1.4em" aria-live="polite"></div>
    <div class="err-slot"></div>
    <button class="btn btn-accent btn-lg" data-act="doAdd">${t('add_btn')}</button>
    <small style="color:var(--soft)">${t('you_have', { v: S.wallet ? xlm(S.wallet.spendable) : '…' })}</small>`,
  );
  const upd = () => ($('#amtHint').textContent = amountHint());
  $('#amt').addEventListener('input', upd);
  modal._upd = upd;
}

function requestModal() {
  const pot = currentPot();
  const others = pot.members.filter((m) => m.address !== me());
  openModal(
    t('req_t'),
    `<div><b>${t('who_paid_q')}</b>
      <div class="chips" style="margin-top:8px" role="group">
        <button class="chip" data-act="payee" data-v="shop" aria-pressed="true">${t('payee_shop')}</button>
        <button class="chip" data-act="payee" data-v="member" aria-pressed="false">${t('payee_member')}</button>
      </div></div>
    <div id="payShop" style="display:grid;gap:12px">
      <label class="f">${t('their_name')}<input class="input" id="toName" placeholder="${esc(t('their_name_ph'))}" maxlength="40" /></label>
      <label class="f">${t('their_addr')}
        <div class="linkbox"><input class="input mono" id="toAddr" placeholder="G…" autocomplete="off" spellcheck="false" /><button class="btn btn-ghost" type="button" data-act="paste" data-target="toAddr">${t('paste')}</button></div></label>
      <button class="btn btn-text btn-sm" style="justify-self:start" data-act="genShop">${t('gen_shop')}</button>
    </div>
    <div id="payMember" hidden>
      <label class="f">${t('member')}<select class="input" id="toMember">${(others.length ? others : pot.members).map((m) => `<option value="${m.address}">${esc(m.name)}</option>`).join('')}</select></label>
    </div>
    ${amountField()}
    <div id="amtHint" style="color:var(--soft);margin-top:-8px" aria-live="polite">${t('pot_has', { v: xlm(pot.spendable) })}</div>
    <div><b>${t('what_for')}</b>
      <div class="chips" style="margin-top:8px">${PURPOSES.map(([e, k]) => `<button class="chip" data-act="purpose" data-v="${esc(t(k))}" aria-pressed="false">${e} ${t(k)}</button>`).join('')}</div></div>
    <label class="f">${t('note')}<input class="input" id="purpose" placeholder="${esc(t('note_ph'))}" maxlength="28" /></label>
    <div class="err-slot"></div>
    <button class="btn btn-primary btn-lg" data-act="doRequest">${t('req_btn')}</button>`,
  );
  const upd = () => {
    const v = readAmount();
    $('#amtHint').textContent = v > pot.spendable ? t('too_much', { v: xlm(pot.spendable) }) : amountHint(t('pot_has', { v: xlm(pot.spendable) }));
  };
  $('#amt').addEventListener('input', upd);
  modal._upd = upd;
}

function shareModal(xdr) {
  const link = `${SITE}?proposal=${encodeURIComponent(xdr)}`;
  const p = S.pending.find((x) => x.xdr === xdr) ?? S.linkProposal;
  const pot = p?.pot ?? currentPot();
  const text = p ? t('share_msg', { pot: pot.name, amount: xlm(p.amount), who: nameFor(p.to, pot), purpose: p.purpose || '—', link }) : link;
  const qr = qrSvg(link) || `<p style="max-width:220px;text-align:center;color:var(--soft)">${t('qr_long')}</p>`;
  S.gs.shared = true;
  store.set('gs', S.gs);
  openModal(
    t('share_t'),
    `<p style="margin:0;color:var(--muted)">${t('share_p')}</p>
    <div class="qr" aria-hidden="true">${qr}</div>
    <div class="linkbox"><input class="input mono" readonly value="${esc(link)}" aria-label="${esc(t('share_t'))}" /><button class="btn btn-ghost" data-act="copy" data-text="${esc(link)}">${t('copy')}</button></div>
    <a class="btn btn-ok btn-lg" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">${t('whatsapp')}</a>
    ${navigator.share ? `<button class="btn btn-ghost" data-act="nativeShare" data-text="${esc(text)}">📤 ${t('share')}</button>` : ''}
    ${S.ids.length > 1 ? `<small style="color:var(--soft)">${t('share_tip')}</small>` : ''}`,
  );
}

function inviteModal() {
  const pk = me();
  const text = t('inv_msg', { link: SITE, addr: pk });
  openModal(
    t('inv_t'),
    `<img src="assets/amma.svg" alt="" style="width:150px;margin:0 auto" />
    <p style="margin:0;color:var(--muted)">${t('inv_p')}</p>
    <div class="qr" aria-hidden="true">${qrSvg(SITE, 4)}</div>
    <a class="btn btn-ok btn-lg" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">${t('whatsapp')}</a>
    ${navigator.share ? `<button class="btn btn-ghost" data-act="nativeShare" data-text="${esc(text)}">📤 ${t('share')}</button>` : ''}
    <label class="f">${t('inv_mine')}<div class="linkbox"><input class="input mono" readonly value="${pk}" /><button class="btn btn-ghost" data-act="copy" data-text="${pk}">${t('copy')}</button></div></label>`,
  );
}

function helpModal() {
  const pot = currentPot();
  const v = { n: pot.approvals, total: pot.members.length };
  openModal(
    t('help_t', v),
    `<div class="stack" style="justify-content:center">${pot.members.map((m, i) => avatar(m.name, m.address, 'lg ring', i < pot.approvals)).join('')}</div>
    <p style="margin:0;font-size:18px">${t('help_p1', v)}</p>
    <p style="margin:0;color:var(--muted)">${t('help_p2', v)}</p>
    <p style="margin:0;color:var(--muted)">${t('help_p3', v)}</p>
    <button class="btn btn-primary" data-act="close">${t('got_it')}</button>`,
  );
}

function newPotModal() {
  const pk = me();
  const locals = S.ids.map((x) => ({ name: x.name, address: R.fromSecret(x.secret).publicKey() })).filter((x) => x.address !== pk);
  S.draft = { members: [], approvals: 2 };
  const draw = () => {
    const all = [{ name: $('#myName')?.value || S.ids[S.active].name, address: pk, me: true }, ...S.draft.members];
    S.draft.approvals = Math.min(Math.max(1, S.draft.approvals), all.length);
    $('#memberList').innerHTML = all
      .map(
        (m, i) => `<div style="display:flex;gap:12px;align-items:center;padding:8px 0;border-top:${i ? '1px solid var(--line)' : '0'}">${avatar(m.name, m.address)}<div style="flex:1;min-width:0"><b>${esc(m.name)}${m.me ? ` ${t('you_tag')}` : ''}</b><div style="font-size:12px;color:var(--soft);font-family:ui-monospace,monospace">${short(m.address)}</div></div>${m.me ? '' : `<button class="x" data-act="rmMember" data-v="${m.address}" aria-label="${esc(t('remove', { name: m.name }))}">✕</button>`}</div>`,
      )
      .join('');
    $('#appr').innerHTML = all.map((_, i) => `<button class="chip" data-act="appr" data-v="${i + 1}" aria-pressed="${S.draft.approvals === i + 1}">${i + 1}</button>`).join('');
    $('#apprRule').textContent = all.length < 2 ? t('np_need_more') : t('np_rule', { n: S.draft.approvals, total: all.length });
    $('#quick').innerHTML = locals
      .filter((l) => !S.draft.members.some((m) => m.address === l.address))
      .map((l) => `<button class="chip" data-act="quickAdd" data-v="${l.address}" data-n="${esc(l.name)}">+ ${esc(l.name)}</button>`)
      .join('');
  };
  S.drawDraft = draw;
  openModal(
    t('np_t'),
    `<label class="f">${t('np_name')}<input class="input" id="potName" placeholder="${esc(t('np_name_ph'))}" maxlength="28" /></label>
    <label class="f">${t('np_you')}<input class="input" id="myName" value="${esc(S.ids[S.active].name)}" maxlength="32" /></label>
    <div><b>${t('np_members')}</b><div id="memberList"></div><div class="chips" id="quick" style="margin-top:6px"></div></div>
    <div style="display:grid;gap:10px;padding:14px;border-radius:18px;background:var(--card);border:1px solid var(--line)">
      <label class="f">${t('their_name')}<input class="input" id="mName" placeholder="${esc(t('np_their_ph'))}" maxlength="32" /></label>
      <label class="f">${t('np_their_addr')}<div class="linkbox"><input class="input mono" id="mAddr" placeholder="G…" spellcheck="false" autocomplete="off" /><button class="btn btn-ghost" type="button" data-act="paste" data-target="mAddr">${t('paste')}</button></div></label>
      <button class="btn btn-ghost btn-sm" data-act="addMember">${t('np_add')}</button>
      <button class="btn btn-text btn-sm" data-act="invite">${t('np_no_addr')}</button>
    </div>
    <div><b>${t('np_appr')}</b><div class="chips" id="appr" style="margin-top:8px"></div><p id="apprRule" style="margin:8px 0 0;color:var(--muted)"></p></div>
    <small style="color:var(--soft)">${t('np_reserve')}</small>
    <div class="err-slot"></div>
    <button class="btn btn-primary btn-lg" data-act="doCreatePot">${t('np_btn')}</button>`,
  );
  $('#myName').addEventListener('input', draw);
  draw();
}

function walletModal() {
  openModal(
    t('w_t'),
    `<p style="margin:0;color:var(--muted)">${t('w_p')}</p>
    <label class="f">${t('w_name')}<input class="input" id="wName" placeholder="${esc(t('w_name_ph'))}" maxlength="32" /></label>
    <button class="btn btn-primary" data-act="doCreateWallet">${t('w_create')}</button>
    <div style="text-align:center;color:var(--soft);font-weight:700">${t('or')}</div>
    <label class="f">${t('w_secret')}<input class="input mono" id="wSecret" type="password" autocomplete="off" spellcheck="false" /></label>
    <div class="err-slot"></div>
    <button class="btn btn-ghost" data-act="doImport">${t('w_use')}</button>
    <small style="color:var(--soft)">${t('w_warn')}</small>`,
  );
}

// =====================================================================
// Demo family: real testnet transactions, start to finish
// =====================================================================
async function startDemo() {
  const steps = ['ds1', 'ds2', 'ds3', 'ds4', 'ds5'].map((k) => t(k));
  $('#landing').hidden = true;
  $('#appRoot').hidden = false;
  S.lastHtml = '';
  root.innerHTML = `
  <div class="onboard">
    <div class="art-side"><div style="max-width:440px;text-align:center">
      <img src="assets/amma.svg" alt="" style="width:280px;margin:0 auto 10px" />
      <h2 style="font-family:var(--display);font-weight:600;font-size:36px;line-height:1.15;margin:0 0 12px">${t('demo_h')}</h2>
      <p style="opacity:.85">${t('demo_p')}</p></div></div>
    <div class="form-side">
      <h1 style="font-family:var(--display);font-weight:600;font-size:34px;margin:0">${t('demo_title')}</h1>
      <ol class="progress-steps" id="demoSteps">${steps.map((s) => `<li><i></i>${esc(s)}</li>`).join('')}</ol>
      <div id="demoErr"></div>
    </div>
  </div>`;
  const li = $$('#demoSteps li');
  const mark = (i, st) => {
    li[i].className = st;
    $('i', li[i]).textContent = st === 'done' ? '✓' : '';
  };
  try {
    mark(0, 'doing');
    const fam = [
      { name: 'Priya (Toronto)', kp: R.newKeypair() },
      { name: 'Arjun (Dubai)', kp: R.newKeypair() },
      { name: 'Meera (London)', kp: R.newKeypair() },
    ];
    await Promise.all(fam.map((f) => R.fund(f.kp.publicKey())));
    S.ids = fam.map((f) => ({ name: f.name, secret: f.kp.secret() }));
    S.active = 0;
    saveIds();
    mark(0, 'done');

    mark(1, 'doing');
    const { potId } = await R.createPot(fam[0].kp, "Amma's care", fam.map((f) => ({ address: f.kp.publicKey(), name: f.name })), 2);
    S.potId = potId;
    mark(1, 'done');

    mark(2, 'doing');
    await Promise.all([R.contribute(fam[0].kp, potId, 300), R.contribute(fam[1].kp, potId, 250), R.contribute(fam[2].kp, potId, 180)]);
    mark(2, 'done');

    mark(3, 'doing');
    const pharmacy = R.newKeypair().publicKey();
    saveContact(pharmacy, 'Apollo Pharmacy, Pune');
    const x1 = await R.proposeSpend(fam[0].kp, potId, pharmacy, 120, 'Amma BP medicine Nov');
    await R.approveProposal(fam[1].kp, x1);
    mark(3, 'done');

    mark(4, 'doing');
    const kirana = R.newKeypair().publicKey();
    saveContact(kirana, 'Sharma Kirana Store');
    const x2 = await R.proposeSpend(fam[2].kp, potId, kirana, 45, 'Groceries for November');
    S.proposals = [{ xdr: x2, potId, createdAt: Date.now() }, ...S.proposals];
    saveProposals();
    S.gs = { hidden: true, shared: false }; // the demo already shows every step
    store.set('gs', S.gs);
    mark(4, 'done');

    await sleep(500);
    location.hash = '#/app';
    renderApp(true);
    await refresh();
    toast(t('demo_ready'), 'ok');
  } catch (e) {
    $('#demoErr').innerHTML = `<div class="err" role="alert">${esc(errText(e))}</div><button class="btn btn-primary" style="margin-top:12px" onclick="location.reload()">${t('try_again')}</button>`;
  }
}

// =====================================================================
// Events
// =====================================================================
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const a = el.dataset.act;
  const pot = currentPot();

  if (a === 'close') return closeModal();
  if (a === 'install') return install();
  if (a === 'demo') return startDemo();
  if (a === 'refresh') return refresh();
  if (a === 'pot') {
    S.potId = el.dataset.id;
    S.ledger = null;
    S.pending = [];
    S.openProposal = null;
    history.replaceState(null, '', `#/app/pot/${S.potId}`);
    renderApp(true);
    return refresh();
  }
  if (a === 'copy') {
    try {
      await navigator.clipboard.writeText(el.dataset.text);
      toast(t('copied'), 'ok');
    } catch {
      toast(t('copy_fail'), 'bad');
    }
    return;
  }
  if (a === 'paste') {
    try {
      const txt = (await navigator.clipboard.readText()).trim();
      const m = txt.match(/G[A-Z2-7]{55}/);
      $(`#${el.dataset.target}`).value = m ? m[0] : txt;
    } catch {
      $(`#${el.dataset.target}`).focus();
    }
    return;
  }
  if (a === 'nativeShare') {
    try {
      await navigator.share({ text: el.dataset.text });
    } catch {}
    return;
  }
  if (a === 'topup')
    return act(el, async () => {
      await R.fund(me());
      toast(t('topped'), 'ok');
      await refresh();
    });
  if (a === 'create' || a === 'import') return walletModal();
  if (a === 'add') return addMoneyModal();
  if (a === 'request') return requestModal();
  if (a === 'newPot') return newPotModal();
  if (a === 'invite') return inviteModal();
  if (a === 'help') return helpModal();
  if (a === 'share') return shareModal(el.dataset.xdr);
  if (a === 'shareFirst') return S.pending[0] && shareModal(S.pending[0].xdr);
  if (a === 'gsHide') {
    S.gs.hidden = true;
    store.set('gs', S.gs);
    return renderApp(true);
  }
  if (a === 'zoom') {
    S.zoom = Number(el.dataset.v);
    store.set('zoom', S.zoom);
    return renderApp(true);
  }
  if (a === 'speak') {
    const lines = [t('speak_pot', { pot: pot.name, v: xlm(pot.spendable), n: pot.approvals, total: pot.members.length })];
    if (S.pending.length) {
      lines.push(t('speak_req', { n: S.pending.length }));
      for (const p of S.pending) lines.push(t('speak_req1', { amount: xlm(p.amount), who: nameFor(p.to, pot), purpose: p.purpose, a: p.approvedBy.length, b: p.needed }));
    }
    return speak(lines.join(' '));
  }
  if (a === 'closeLink') {
    S.openProposal = null;
    S.linkProposal = null;
    renderApp(true);
    return refresh();
  }

  if (a === 'unit') {
    const before = readAmount();
    S.unit = el.dataset.v;
    $$('[data-act="unit"]', modal).forEach((b) => b.setAttribute('aria-pressed', b === el));
    // Keep the same value, re-expressed in the new unit.
    if (before) $('#amt').value = S.unit === 'FIAT' ? Math.round(before * S.prices[S.fiat]) : Math.round(before * 100) / 100;
    return modal._upd?.();
  }
  if (a === 'fill') {
    S.unit = 'XLM';
    $$('[data-act="unit"]', modal).forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === 'XLM'));
    $('#amt').value = el.dataset.v;
    return modal._upd?.();
  }
  if (a === 'purpose') {
    $$('[data-act="purpose"]', modal).forEach((c) => c.setAttribute('aria-pressed', c === el));
    $('#purpose').value = R.memoText(el.dataset.v);
    return;
  }
  if (a === 'payee') {
    $$('[data-act="payee"]', modal).forEach((c) => c.setAttribute('aria-pressed', c === el));
    $('#payShop').hidden = el.dataset.v !== 'shop';
    $('#payMember').hidden = el.dataset.v !== 'member';
    return;
  }
  if (a === 'genShop') {
    $('#toAddr').value = R.newKeypair().publicKey();
    if (!$('#toName').value) $('#toName').value = t('their_name_ph');
    return;
  }

  if (a === 'doAdd')
    return act(el, async () => {
      const amount = readAmount();
      if (!amount) throw new Error(t('enter_amount'));
      await R.contribute(kp(), pot.id, amount);
      closeModal();
      toast(t('added', { v: xlm(amount), pot: pot.name }), 'ok');
      await refresh();
    });

  if (a === 'doRequest')
    return act(el, async () => {
      const shop = !$('#payShop').hidden;
      const to = shop ? $('#toAddr').value.trim() : $('#toMember').value;
      const amount = readAmount();
      const purpose = R.memoText($('#purpose').value);
      if (!R.isValidAddress(to)) throw new Error(t('bad_addr'));
      if (!amount) throw new Error(t('enter_amount'));
      if (amount > pot.spendable) throw new Error(t('pot_only', { v: xlm(pot.spendable) }));
      if (!purpose) throw new Error(t('need_purpose'));
      if (shop && $('#toName').value.trim()) saveContact(to, $('#toName').value.trim());
      const xdr = await R.proposeSpend(kp(), pot.id, to, amount, purpose);
      S.proposals = [{ xdr, potId: pot.id, createdAt: Date.now() }, ...S.proposals];
      saveProposals();
      await refresh();
      shareModal(xdr);
    });

  if (a === 'approve')
    return act(el, async () => {
      const r = await R.approveProposal(kp(), el.dataset.xdr);
      S.proposals = S.proposals.filter((p) => p.xdr !== el.dataset.xdr);
      if (r.submittedHash) {
        confetti();
        toast(t('paid_toast', { v: xlm(r.proposal.amount), who: nameFor(r.proposal.to, r.proposal.pot) }), 'ok');
        if (S.openProposal) {
          S.openProposal = null;
          S.linkProposal = null;
          S.potId = r.proposal.potId;
        }
      } else {
        S.proposals.unshift({ xdr: r.xdr, potId: r.proposal.potId, createdAt: Date.now() });
        toast(t('more_needed', { n: r.proposal.needed - r.proposal.approvedBy.length }), 'ok');
        if (S.openProposal) {
          S.openProposal = r.xdr;
          S.linkProposal = r.proposal;
        }
      }
      saveProposals();
      await refresh();
    });

  if (a === 'submit')
    return act(el, async () => {
      await R.submitProposal(el.dataset.xdr);
      S.proposals = S.proposals.filter((p) => p.xdr !== el.dataset.xdr);
      saveProposals();
      confetti();
      toast(t('paid_proof'), 'ok');
      S.openProposal = null;
      S.linkProposal = null;
      await refresh();
    });

  if (a === 'addMember' || a === 'quickAdd') {
    const address = a === 'quickAdd' ? el.dataset.v : $('#mAddr').value.trim();
    const name = a === 'quickAdd' ? el.dataset.n : $('#mName').value.trim();
    const slot = $('.err-slot', modal);
    if (!R.isValidAddress(address) || address === me()) {
      slot.innerHTML = `<div class="err">${esc(t('bad_addr'))}</div>`;
      return;
    }
    if (!S.draft.members.some((m) => m.address === address)) S.draft.members.push({ address, name: name || short(address) });
    if (a === 'addMember') {
      $('#mAddr').value = '';
      $('#mName').value = '';
    }
    slot.innerHTML = '';
    if (S.draft.members.length === 1) S.draft.approvals = 2;
    return S.drawDraft();
  }
  if (a === 'rmMember') {
    S.draft.members = S.draft.members.filter((m) => m.address !== el.dataset.v);
    return S.drawDraft();
  }
  if (a === 'appr') {
    S.draft.approvals = Number(el.dataset.v);
    return S.drawDraft();
  }
  if (a === 'doCreatePot')
    return act(el, async () => {
      const members = [{ address: me(), name: $('#myName').value.trim() || S.ids[S.active].name }, ...S.draft.members];
      if (members.length < 2) throw new Error(t('np_need_more'));
      const { potId } = await R.createPot(kp(), $('#potName').value.trim() || t('np_name_ph'), members, S.draft.approvals);
      closeModal();
      S.potId = potId;
      confetti();
      toast(t('np_done'), 'ok');
      await refresh();
    });

  if (a === 'doCreateWallet')
    return act(el, async () => {
      const k = R.newKeypair();
      await R.fund(k.publicKey());
      S.ids.push({ name: $('#wName').value.trim() || t('member_n', { n: S.ids.length + 1 }), secret: k.secret() });
      S.active = S.ids.length - 1;
      saveIds();
      closeModal();
      location.hash = '#/app';
      renderApp(true);
      await refresh();
      toast(t('w_ready'), 'ok');
    });
  if (a === 'doImport')
    return act(el, async () => {
      const s = $('#wSecret').value.trim();
      if (!R.isValidSecret(s)) throw new Error(t('bad_key'));
      S.ids.push({ name: $('#wName').value.trim() || t('member_n', { n: S.ids.length + 1 }), secret: s });
      S.active = S.ids.length - 1;
      saveIds();
      closeModal();
      location.hash = '#/app';
      renderApp(true);
      await refresh();
    });
});

document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-change]');
  if (!el) return;
  const c = el.dataset.change;
  if (c === 'lang') return changeLang(el.value);
  if (c === 'who') {
    if (el.value === 'new') {
      el.value = String(S.active);
      return walletModal();
    }
    S.active = Number(el.value);
    saveIds();
    S.wallet = null;
    S.linkProposal = null; // re-check membership as the new person
    renderApp(true);
    refresh();
    toast(t('now_you', { name: S.ids[S.active].name }));
  }
  if (c === 'fiat') {
    S.fiat = el.value;
    store.set('fiat', S.fiat);
    renderApp(true);
  }
});

// =====================================================================
// Boot
// =====================================================================
applyStatic();
fillLangSelects();
initLanding();
R.fetchPrices().then((p) => {
  S.prices = p;
  renderApp(true);
});
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
addEventListener('hashchange', route);
if (S.openProposal && !location.hash.startsWith('#/app')) location.hash = '#/app';
route();
setInterval(() => {
  if (!$('#appRoot').hidden && !modal.open && !document.hidden) refresh();
}, 15000);
