// Builds the animated SVG cards used by README.md.
//   npm install && npm run build
//
// Visual language: a pilot HUD in the spirit of Titanfall 2 (fan homage, all
// shapes drawn here, no game assets). Text is converted to vector paths
// (Barlow Condensed + JetBrains Mono) so the cards render identically
// everywhere, even though GitHub serves them as <img>.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import sharp from 'sharp';
import * as SI from 'simple-icons';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets');
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- palette
const C = {
  bg: '#06080b',
  panel: '#0c1117',
  blue: '#5290cf', // avatar background blue, used for lines
  friendly: '#5cb8ff', // friendly / online
  ice: '#d9efff', // visor white
  text: '#e6eef5',
  soft: '#c3d1de',
  muted: '#7f93a7',
  dim: '#22303e',
  orange: '#ff8a1e', // titan meter / warnings
};

// ---------------------------------------------------------------- fonts
const font = (pkg, file) => {
  const b = fs.readFileSync(path.join(ROOT, 'node_modules/@fontsource', pkg, 'files', file));
  return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
const FONTS = {
  mono: font('jetbrains-mono', 'jetbrains-mono-latin-400-normal.woff'),
  monoB: font('jetbrains-mono', 'jetbrains-mono-latin-700-normal.woff'),
  cond: font('barlow-condensed', 'barlow-condensed-latin-500-normal.woff'),
  condS: font('barlow-condensed', 'barlow-condensed-latin-600-normal.woff'),
  condB: font('barlow-condensed', 'barlow-condensed-latin-700-normal.woff'),
};

// Each glyph is stored once per card in <defs> and placed with <use>.
let GLYPHS = new Map();
const r2 = (n) => Math.round(n * 100) / 100;

function glyphRef(fk, size, g) {
  const key = `${fk}|${size}|${g.index}`;
  let e = GLYPHS.get(key);
  if (!e) {
    e = { id: 'g' + GLYPHS.size.toString(36), d: g.getPath(0, 0, size).toPathData(2) };
    GLYPHS.set(key, e);
  }
  return e;
}

function measure(str, { f = 'mono', s = 16, ls = 0 } = {}) {
  const fo = FONTS[f];
  const sc = s / fo.unitsPerEm;
  const gs = fo.stringToGlyphs(str);
  const xs = [];
  let w = 0;
  gs.forEach((g, i) => {
    if (g.index === 0) throw new Error(`Missing glyph "${[...str][i]}" in font ${f}`);
    xs.push(w);
    const kern = i < gs.length - 1 ? fo.getKerningValue(g, gs[i + 1]) : 0;
    w += (g.advanceWidth + kern) * sc + (i < gs.length - 1 ? ls : 0);
  });
  return { gs, xs, w };
}

// Text as glyph paths. `max` guards against overflow while editing copy.
function T(str, x, y, o = {}) {
  const { f = 'mono', s = 16, fill = C.text, a = 'start', ls = 0, op, cls, st, max } = o;
  const { gs, xs, w } = measure(str, { f, s, ls });
  if (max && w > max) throw new Error(`Text too wide (${Math.round(w)} > ${max}): "${str}"`);
  const x0 = a === 'middle' ? x - w / 2 : a === 'end' ? x - w : x;
  let uses = '';
  gs.forEach((g, i) => {
    const e = glyphRef(f, s, g);
    if (e.d) uses += `<use xlink:href="#${e.id}" x="${r2(x0 + xs[i])}" y="${r2(y)}"/>`;
  });
  const attrs = `fill="${fill}"${op != null ? ` opacity="${op}"` : ''}${cls ? ` class="${cls}"` : ''}${st ? ` style="${st}"` : ''}`;
  return { svg: `<g ${attrs}>${uses}</g>`, w, x0 };
}
const t = (...a) => T(...a).svg;

// ---------------------------------------------------------------- shapes
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// panel with the top-left and bottom-right corners cut
const chamfer = (x, y, w, h, c = 12) =>
  `M${x + c} ${y}H${x + w}V${y + h - c}L${x + w - c} ${y + h}H${x}V${y + c}Z`;

// slanted segment, used for meters
const seg = (x, y, w, h, sk = 5) => `M${r2(x + sk)} ${y}h${r2(w)}l${-sk} ${h}h${r2(-w)}z`;

const polar = (cx, cy, r, deg) => {
  const a = (deg * Math.PI) / 180;
  return [r2(cx + r * Math.sin(a)), r2(cy - r * Math.cos(a))];
};
const arcPath = (cx, cy, r, a0, a1) => {
  const [x1, y1] = polar(cx, cy, r, a0);
  const [x2, y2] = polar(cx, cy, r, a1);
  return `M${x1} ${y1}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x2} ${y2}`;
};

// Section header: orange slash tag, title, meta, rule.
function header(title, meta, W, y = 52, animate = true) {
  let s = `<path d="M66 ${y - 15}h7l-7 19h-7z" fill="${C.orange}"/>`;
  s += t(title, 82, y, { f: 'condS', s: 18, ls: 3.5, fill: C.ice });
  if (meta) s += t(meta, W - 60, y, { f: 'cond', s: 16, ls: 2.5, fill: C.muted, a: 'end' });
  s += `<line x1="60" y1="${y + 16}" x2="${W - 60}" y2="${y + 16}" stroke="${C.blue}" stroke-opacity=".28"/>`;
  s += `<rect x="60" y="${y + 15}" width="96" height="3" fill="${C.orange}"/>`;
  return animate ? `<g class="in" style="animation-delay:.05s">${s}</g>` : `<g>${s}</g>`;
}

// Typing reveal: a clip rect that grows left to right in steps.
let CLIP_N = 0;
function typed(svg, x, y, w, h, delay, dur, steps) {
  const id = `ty${CLIP_N++}`;
  return {
    defs: `<clipPath id="${id}"><rect x="${r2(x)}" y="${r2(y)}" width="${r2(w + 4)}" height="${h}" class="ty" style="transform-origin:${r2(x)}px 0;animation:ty ${r2(dur / 0.88)}s steps(${steps}) ${r2(delay)}s forwards"/></clipPath>`,
    svg: `<g clip-path="url(#${id})">${svg}</g>`,
  };
}

// ---------------------------------------------------------------- card shell
const BASE_CSS = `
.in{opacity:0;animation:in .6s cubic-bezier(.2,.8,.2,1) forwards}
@keyframes in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.ty{transform:scaleX(0)}
@keyframes ty{0%{transform:scaleX(0)}88%,100%{transform:none}}
.blink{animation:blink 1.1s steps(1) infinite}
@keyframes blink{50%{opacity:0}}
@media (prefers-reduced-motion:reduce){*{animation-duration:.01s!important;animation-delay:0s!important;animation-iteration-count:1!important}}
`;

function card(name, w, h, body, { css = '', defs = '', aria, shell = true, edge = C.ice }) {
  const CUT = 24;
  const outline = `M${CUT + 0.5} .5H${w - 0.5}V${h - CUT - 0.5}L${w - CUT - 0.5} ${h - 0.5}H.5V${CUT + 0.5}Z`;
  const glyphDefs = [...GLYPHS.values()].filter((e) => e.d).map((e) => `<path id="${e.id}" d="${e.d}"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(aria)}">
<title>${esc(aria)}</title>
<style>${BASE_CSS}${css}</style>
<defs>${glyphDefs}
<clipPath id="card"><path d="${outline}"/></clipPath>
<pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="12" cy="12" r="1" fill="${C.blue}" fill-opacity=".12"/></pattern>
<pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="8" fill="${C.orange}" fill-opacity=".5"/></pattern>
<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
${defs}</defs>
${shell ? `<path d="${outline}" fill="${C.bg}"/><path d="${outline}" fill="url(#dots)"/>
<g clip-path="url(#card)">${body}</g>
<path d="${outline}" fill="none" stroke="${C.blue}" stroke-opacity=".38"/>
<path d="M.5 ${CUT + 0.5}L${CUT + 0.5} .5H110" fill="none" stroke="${C.orange}" stroke-width="3"/>
<path d="M${w - 0.5} ${h - CUT - 0.5}L${w - CUT - 0.5} ${h - 0.5}H${w - 110}" fill="none" stroke="${edge}" stroke-opacity=".6" stroke-width="2"/>` : body}
</svg>
`;
  fs.writeFileSync(path.join(OUT, `${name}.svg`), svg);
  console.log(`assets/${name}.svg`.padEnd(26), `${(svg.length / 1024).toFixed(1)} KB`);
  GLYPHS = new Map();
  CLIP_N = 0;
}

// ================================================================ 1. hero / pilot
async function hero() {
  const W = 1200, H = 470;
  const cx = 290, cy = 228, AV = 280;

  const avatar = await sharp(path.join(ROOT, 'src/avatar.webp'))
    .flatten({ background: C.bg }).resize(AV, AV).jpeg({ quality: 88 }).toBuffer();
  const img = `data:image/jpeg;base64,${avatar.toString('base64')}`;

  // titan meter: segmented ring that charges up, gap at the bottom
  const SEGS = 40, A0 = -148, A1 = 148, RM = 176;
  const step = (A1 - A0) / SEGS;
  let meter = '';
  for (let i = 0; i < SEGS; i++) {
    const a = A0 + i * step;
    meter += `<path d="${arcPath(cx, cy, RM, a + 0.9, a + step - 0.9)}" class="mseg" style="animation-delay:${(0.6 + i * 0.045).toFixed(3)}s"/>`;
  }
  const charged = 0.6 + SEGS * 0.045;

  let ticks = '';
  for (let d = 0; d < 360; d += 6) {
    if (d > 150 && d < 210) continue;
    const [x1, y1] = polar(cx, cy, 192, d);
    const [x2, y2] = polar(cx, cy, d % 30 === 0 ? 201 : 196, d);
    ticks += `M${x1} ${y1}L${x2} ${y2}`;
  }

  const X = 540;
  const name = T('NABIL ISLAM', X - 4, 214, { f: 'condB', s: 124, ls: 1, fill: C.text, max: W - 70 - X });

  // shield bar under the name
  const SB = 32, sbw = (W - 70 - X - (SB - 1) * 4) / SB;
  let shield = '';
  for (let i = 0; i < SB; i++) {
    const on = i < SB - 5;
    shield += `<path d="${seg(X + i * (sbw + 4), 236, sbw, 12, 4)}" fill="${on ? C.friendly : C.dim}" class="${on ? 'sb' : ''}" style="animation-delay:${(0.9 + i * 0.025).toFixed(3)}s"/>`;
  }

  const chips = [
    ['STATUS', 'ONLINE', C.friendly],
    ['MODE', 'BUILD', C.ice],
    ['VTX', '5.8 GHZ', C.ice],
  ];
  let chipSvg = '';
  let chx = X;
  chips.forEach(([k, v, col], i) => {
    const kw = measure(k, { f: 'condS', s: 14, ls: 2.5 }).w;
    const vw = measure(v, { f: 'condB', s: 19, ls: 1 }).w;
    const w = kw + vw + 46;
    chipSvg += `<g class="in" style="animation-delay:${1.5 + i * 0.1}s"><path d="${chamfer(chx, 362, w, 38, 9)}" fill="${C.panel}" stroke="${C.blue}" stroke-opacity=".5"/><rect x="${chx}" y="371" width="3" height="20" fill="${C.orange}"/>${t(k, chx + 16, 387, { f: 'condS', s: 14, ls: 2.5, fill: C.muted })}${t(v, chx + 30 + kw, 388, { f: 'condB', s: 19, ls: 1, fill: col })}</g>`;
    chx += w + 10;
  });
  {
    // signal strength chip
    const w = 104;
    let bars = '';
    [8, 12, 16, 20].forEach((h, i) => {
      bars += `<path d="${seg(chx + 56 + i * 10, 390 - h, 6, h, 2)}" fill="${C.friendly}" class="bar" style="animation-delay:${i * 0.18}s"/>`;
    });
    chipSvg += `<g class="in" style="animation-delay:${1.5 + chips.length * 0.1}s"><path d="${chamfer(chx, 362, w, 38, 9)}" fill="${C.panel}" stroke="${C.blue}" stroke-opacity=".5"/><rect x="${chx}" y="371" width="3" height="20" fill="${C.orange}"/>${t('SIG', chx + 16, 387, { f: 'condS', s: 14, ls: 2.5, fill: C.muted })}${bars}</g>`;
    chx += w;
  }
  if (chx > W - 60) throw new Error('hero chips overflow');

  const body = `
<circle cx="${cx}" cy="${cy}" r="170" fill="url(#halo)"/>
<g clip-path="url(#av)" class="holo">
<image x="${cx - AV / 2}" y="${cy - AV / 2}" width="${AV}" height="${AV}" xlink:href="${img}"/>
<image x="${cx - AV / 2}" y="${cy - AV / 2}" width="${AV}" height="${AV}" xlink:href="${img}" filter="url(#bloom)" class="bloom"/>
<rect x="${cx - 150}" y="${cy - 150}" width="300" height="300" fill="url(#scanlines)"/>
<rect x="${cx - 150}" y="${cy - 150}" width="300" height="3" fill="${C.ice}" opacity=".3" class="scan"/>
</g>
<circle cx="${cx}" cy="${cy}" r="146" fill="none" stroke="${C.blue}" stroke-opacity=".7" stroke-width="2"/>
<circle cx="${cx}" cy="${cy}" r="160" fill="none" stroke="${C.blue}" stroke-opacity=".25"/>
<g fill="none" stroke-width="11">${meter}</g>
<path d="${ticks}" stroke="${C.blue}" stroke-opacity=".6" stroke-width="1.4"/>
<g class="spin"><path d="${arcPath(cx, cy, 212, -40, 40)}" fill="none" stroke="${C.ice}" stroke-opacity=".5" stroke-dasharray="3 7" stroke-width="2"/></g>
<g class="ready">${t('TITANFALL READY', cx, cy + 192, { f: 'condB', s: 26, ls: 3, fill: C.orange, a: 'middle' })}</g>
<g class="charging">${t('CHARGING', cx, cy + 192, { f: 'condS', s: 20, ls: 4, fill: C.muted, a: 'middle' })}</g>

<g class="in" style="animation-delay:.4s"><path d="M${X + 6} 86h7l-7 19h-7z" fill="${C.orange}"/>${t('PILOT', X + 22, 103, { f: 'condB', s: 20, ls: 4, fill: C.orange })}${t('//  GITHUB.COM/NABILISLAM722', X + 96, 103, { f: 'cond', s: 18, ls: 2.5, fill: C.muted })}</g>
<g class="in" style="animation-delay:.4s"><circle cx="${W - 236}" cy="97" r="5" fill="${C.friendly}" class="blink" filter="url(#glow)"/>${t('LINK ESTABLISHED', W - 70, 103, { f: 'condS', s: 18, ls: 2.5, fill: C.friendly, a: 'end' })}</g>
<g class="in glitch" style="animation-delay:.6s">${name.svg}</g>
<g class="in" style="animation-delay:.85s">${shield}</g>
<g class="in" style="animation-delay:1.1s">${t('FULL-STACK  //  EMBEDDED SYSTEMS  //  BLOCKCHAIN', X, 296, { f: 'condS', s: 27, ls: 1.2, fill: C.ice, max: W - 70 - X })}</g>
<g class="in" style="animation-delay:1.25s">${t('Bangladesh · FPV pilot · from idea to working system', X, 334, { s: 18, fill: C.muted, max: W - 70 - X })}</g>
${chipSvg}
`;

  card('hero', W, H, body, {
    aria: 'Pilot: Nabil Islam. Full-stack developer, embedded systems, blockchain. Helmet avatar inside a charging titan meter that reads Titanfall ready.',
    defs: `<clipPath id="av"><circle cx="${cx}" cy="${cy}" r="145"/></clipPath>
<radialGradient id="halo"><stop offset=".6" stop-color="${C.blue}" stop-opacity=".2"/><stop offset="1" stop-color="${C.blue}" stop-opacity="0"/></radialGradient>
<pattern id="scanlines" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1.3" fill="#000" fill-opacity=".35"/></pattern>
<filter id="bloom" x="-20%" y="-20%" width="140%" height="140%"><feComponentTransfer><feFuncR type="gamma" exponent="4"/><feFuncG type="gamma" exponent="4"/><feFuncB type="gamma" exponent="4"/></feComponentTransfer><feGaussianBlur stdDeviation="5"/></filter>`,
    css: `
.mseg{stroke:${C.dim};animation:charge .25s ease-out forwards}
@keyframes charge{to{stroke:${C.orange}}}
.ready{opacity:0;animation:ready 2.4s ease-in-out ${charged.toFixed(2)}s infinite}
@keyframes ready{0%,100%{opacity:1}50%{opacity:.45}}
.charging{animation:out .2s linear ${charged.toFixed(2)}s forwards}
@keyframes out{to{opacity:0}}
.bloom{mix-blend-mode:screen;animation:bloom 3.2s ease-in-out infinite}
@keyframes bloom{0%,100%{opacity:1}50%{opacity:.35}}
.holo{animation:holo 9s steps(1) 3s infinite}
@keyframes holo{0%,100%{opacity:1}96%{opacity:.6}97%{opacity:1}98%{opacity:.75}}
.scan{animation:scan 4s linear infinite}
@keyframes scan{from{transform:translateY(0)}to{transform:translateY(300px)}}
.spin{transform-origin:${cx}px ${cy}px;animation:rot 24s linear infinite}
@keyframes rot{to{transform:rotate(360deg)}}
.sb{opacity:.3;animation:sb .3s ease-out forwards}
.bar{animation:bar 2.4s ease-in-out infinite}
@keyframes bar{0%,100%{opacity:1}50%{opacity:.25}}
@keyframes sb{to{opacity:1}}
.glitch{animation:in .6s cubic-bezier(.2,.8,.2,1) .6s forwards,gl 7s steps(1) 3s infinite}
@keyframes gl{0%,100%{transform:none}93%{transform:translateX(-4px) skewX(-6deg)}94%{transform:translateX(3px)}95%{transform:none}}
`,
  });
}

// ================================================================ 2. neural link boot
function boot() {
  const W = 1200, H = 520;
  const X = 60, S = 22;
  let defs = '';
  let body = header('NEURAL LINK  //  BOOT SEQUENCE', 'SERIAL 115200 8N1', W);

  const ONLINE = ['ONLINE', C.friendly];
  const CAL = ['CALIBRATING', C.orange];
  const OFF = ['OFFLINE', C.muted];
  const lines = [
    ['INITIALIZING PILOT LINK ...', null],
    ['PILOT DETECTED: NABIL ISLAM, BANGLADESH', ['LINKED', C.friendly]],
    ['WEB: REACT, TYPESCRIPT, TAILWIND, FRAMER MOTION', ONLINE],
    ['CHAIN: NFT MARKETPLACE SHIPPED, SOLIDITY + ETHEREUM', ONLINE],
    ['ARM: BARE-METAL BRING-UP ON RADXA DRAGON Q6A', CAL],
    ['KERNEL: MEMORY, CONTEXT SWITCHING, SCHEDULER DESIGN', CAL],
    ['RF: ADALM-PLUTO SDR NOT FOUND, ON THE WISHLIST', OFF],
    ['FPV: PILOT CERTIFIED, PROPS ON', ONLINE],
    ['LANGUAGES: BANGLA, ENGLISH, JAPANESE (LEARNING)', ONLINE],
  ];
  const Y0 = 112, DY = 31;
  lines.forEach(([msg, st], i) => {
    const y = Y0 + i * DY;
    const d = 0.35 + i * 0.3;
    const num = t(String(i + 1).padStart(2, '0'), X, y, { s: 13, fill: C.muted });
    const chev = `<path d="M${X + 34} ${y - 14}l7 7l-7 7" fill="none" stroke="${C.orange}" stroke-width="2.2"/>`;
    const m = T(msg, X + 52, y, { f: 'condS', s: S, ls: 1, fill: i === 0 ? C.ice : C.soft });
    const ty = typed(num + chev + m.svg, X, y - 22, 52 + m.w, 30, d, 0.3, 16);
    defs += ty.defs;
    body += ty.svg;
    if (st) {
      const [word, color] = st;
      const sw = measure(word, { f: 'condB', s: S, ls: 2 }).w;
      const sx = W - 60 - sw;
      body += `<g class="in" style="animation-delay:${(d + 0.3).toFixed(2)}s"><line x1="${r2(X + 52 + m.w + 14)}" y1="${y - 6}" x2="${r2(sx - 14)}" y2="${y - 6}" stroke="${C.muted}" stroke-opacity=".45" stroke-dasharray="2 6"/><g class="${word === 'CALIBRATING' ? 'cal' : ''}">${t(word, W - 60, y, { f: 'condB', s: S, ls: 2, fill: color, a: 'end' })}</g></g>`;
    }
  });

  // three protocols
  const protocols = [
    ['PROTOCOL 1', 'LINK TO THE METAL'],
    ['PROTOCOL 2', 'UPHOLD THE BUILD'],
    ['PROTOCOL 3', 'PROTECT THE CURIOSITY'],
  ];
  const PY = 404, PW = (W - 120 - 2 * 16) / 3;
  const tp = 0.35 + lines.length * 0.3 + 0.2;
  protocols.forEach(([k, v], i) => {
    const x = 60 + i * (PW + 16);
    body += `<g class="in" style="animation-delay:${(tp + i * 0.25).toFixed(2)}s">
<path d="${chamfer(x, PY, PW, 74, 12)}" fill="${C.panel}" stroke="${C.orange}" stroke-opacity=".55"/>
<rect x="${x + PW - 70}" y="${PY + 8}" width="58" height="10" fill="url(#hatch)"/>
${t(k, x + 22, PY + 30, { f: 'condS', s: 15, ls: 3, fill: C.orange })}
${t(v, x + 22, PY + 60, { f: 'condB', s: 27, ls: 1, fill: C.text, max: PW - 40 })}
</g>`;
  });

  card('boot', W, H, body, {
    defs,
    aria: 'Neural link boot sequence. Pilot Nabil Islam, Bangladesh. Web: React, TypeScript, Tailwind, Framer Motion. Chain: NFT marketplace shipped with Solidity and Ethereum. ARM bare-metal on Radxa Dragon Q6A and kernel internals in progress. ADALM-Pluto SDR on the wishlist. FPV pilot. Languages: Bangla, English, Japanese (learning). Protocols: link to the metal, uphold the build, protect the curiosity.',
    css: `
.cal{animation:cal 1.6s ease-in-out 4s infinite}
@keyframes cal{50%{opacity:.35}}
`,
  });
}

// ================================================================ 3. mission flow (pipeline)
function datapath() {
  const W = 1200, H = 380;
  const BX = 61, BW = 190, GAP = 32, BY = 150, BH = 150, P = BW + GAP;
  const stages = [
    ['IF', 'IDEA', 'fetch the problem'],
    ['ID', 'DESIGN', 'decode it in Figma'],
    ['EX', 'BUILD', 'React · TS · C'],
    ['MEM', 'CHAIN', 'Solidity · state'],
    ['WB', 'SHIP', 'deploy · iterate'],
  ];
  let body = header('MISSION FLOW  //  FROM IDEA TO WORKING SYSTEM', '5-STAGE PIPELINE', W);

  // clock, stopping at the end of the last stage
  const cy = 108, amp = 11, xEnd = BX + 4 * P + BW;
  let clk = `M${BX} ${cy + amp}`;
  let len = 0;
  for (let i = 0; i < 5; i++) {
    const x = BX + i * P;
    const fall = Math.min(x + P / 2, xEnd);
    clk += `V${cy - amp}H${fall}`;
    len += 2 * amp + (fall - x);
    if (fall < xEnd) {
      const next = Math.min(x + P, xEnd);
      clk += `V${cy + amp}H${next}`;
      len += 2 * amp + (next - fall);
    }
  }
  body += t('CLK', 52, cy + 5, { f: 'condS', s: 13, ls: 2, fill: C.muted, a: 'end' });
  body += `<path d="${clk}" fill="none" stroke="${C.blue}" stroke-opacity=".45" stroke-width="1.4"/>`;
  body += `<path d="${clk}" fill="none" stroke="${C.ice}" stroke-width="2" stroke-dasharray="90 ${Math.ceil(len)}" class="clk" filter="url(#glow)"/>`;

  stages.forEach(([code, word, cap], i) => {
    const x = BX + i * P;
    const d = chamfer(x, BY, BW, BH, 14);
    body += `<g class="in" style="animation-delay:${0.25 + i * 0.1}s">
<path d="${d}" fill="${C.panel}" stroke="${C.blue}" stroke-opacity=".45"/>
${t(code, x + 20, BY + 32, { f: 'condS', s: 15, ls: 3, fill: C.muted })}
${t(`0${i + 1}`, x + BW - 20, BY + 32, { s: 12, fill: C.muted, a: 'end', op: 0.6 })}
${t(word, x + 20, BY + 96, { f: 'condB', s: 50, ls: 1, fill: C.text, max: BW - 30 })}
${t(cap, x + 20, BY + 128, { s: 14, fill: C.muted, max: BW - 26 })}
</g>
<g class="act" style="animation-delay:${i}s"><path d="${d}" fill="${C.orange}" fill-opacity=".08" stroke="${C.orange}" stroke-width="1.8"/><rect x="${x + 1}" y="${BY + BH - 8}" width="${BW - 16}" height="7" fill="url(#hatch)"/><circle cx="${x + BW - 24}" cy="${BY + 54}" r="4" fill="${C.orange}" filter="url(#glow)"/></g>`;
    if (i < 4) {
      const ax = x + BW + 4, ay = BY + BH / 2;
      body += `<path d="M${ax} ${ay}H${ax + GAP - 10}" stroke="${C.blue}" stroke-opacity=".6"/><path d="M${ax + GAP - 12} ${ay - 4}L${ax + GAP - 6} ${ay}L${ax + GAP - 12} ${ay + 4}Z" fill="${C.blue}"/>`;
    }
  });

  const busY = 336, c0 = BX + BW / 2;
  body += `<line x1="${BX}" y1="${busY}" x2="${xEnd}" y2="${busY}" stroke="${C.blue}" stroke-opacity=".3"/>`;
  for (let i = 0; i < 5; i++) body += `<path d="M${c0 + i * P} ${BY + BH + 6}V${busY - 4}" stroke="${C.blue}" stroke-opacity=".25" stroke-dasharray="2 4"/>`;
  body += `<g class="pkt"><path d="M${c0} ${busY - 9}L${c0 + 9} ${busY}L${c0} ${busY + 9}L${c0 - 9} ${busY}Z" fill="${C.orange}" filter="url(#glow)"/></g>`;

  const kf = [];
  for (let i = 0; i < 5; i++) kf.push(`${i * 20}%,${i * 20 + 16}%{transform:translateX(${i * P}px)}`);
  card('datapath', W, H, body, {
    aria: 'Mission flow, a 5-stage pipeline from idea to working system: Idea, Design in Figma, Build with React, TypeScript and C, Chain with Solidity, Ship and iterate.',
    css: `
.act{opacity:0;animation:act 5s linear infinite}
@keyframes act{0%,17%{opacity:1}21%,100%{opacity:0}}
.pkt{animation:pkt 5s cubic-bezier(.6,0,.4,1) infinite}
@keyframes pkt{${kf.join('')}97%{opacity:1}99%{opacity:0;transform:translateX(${4 * P}px)}99.5%{opacity:0;transform:none}100%{opacity:1;transform:none}}
.clk{animation:clk 5s linear infinite}
@keyframes clk{from{stroke-dashoffset:90}to{stroke-dashoffset:${-Math.ceil(len)}}}
`,
  });
}

// ================================================================ 4. pulse scan (minimap)
function radar() {
  const W = 1200, H = 500;
  const cx = 300, cy = 282, R = 165;
  const EXPAND = 3, PERIOD = 4.5;
  let body = header('PULSE SCAN  //  CURRENTLY TRACKING', '5 CONTACTS', W);

  body += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="url(#scope)"/>`;
  for (let k = 1; k <= 3; k++) body += `<circle cx="${cx}" cy="${cy}" r="${(R * k) / 3}" fill="none" stroke="${C.blue}" stroke-opacity="${k === 3 ? 0.65 : 0.2}"${k < 3 ? ' stroke-dasharray="3 5"' : ''}/>`;
  body += `<path d="M${cx - R} ${cy}H${cx + R}M${cx} ${cy - R}V${cy + R}" stroke="${C.blue}" stroke-opacity=".18"/>`;
  let ticks = '';
  for (let d = 0; d < 360; d += 10) {
    const [x1, y1] = polar(cx, cy, R + 4, d);
    const [x2, y2] = polar(cx, cy, R + (d % 90 === 0 ? 14 : 9), d);
    ticks += `M${x1} ${y1}L${x2} ${y2}`;
  }
  body += `<path d="${ticks}" stroke="${C.blue}" stroke-opacity=".6" stroke-width="1.4"/>`;
  body += t('N', cx, cy - R - 20, { f: 'condB', s: 18, fill: C.ice, a: 'middle' });

  // expanding sonar pulse
  body += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="${C.orange}" fill-opacity=".05" stroke="${C.orange}" stroke-width="2" vector-effect="non-scaling-stroke" class="pulse"/>`;
  body += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${C.orange}" stroke-opacity=".5" stroke-width="1" vector-effect="non-scaling-stroke" class="pulse" style="animation-delay:.12s"/>`;

  // pilot marker + view cone
  const [lx, ly] = polar(cx, cy, 90, -32);
  const [rx, ry] = polar(cx, cy, 90, 32);
  body += `<path d="M${cx} ${cy}L${lx} ${ly}A90 90 0 0 1 ${rx} ${ry}Z" fill="url(#cone)"/>`;
  body += `<path d="M${cx} ${cy - 11}L${cx + 8} ${cy + 8}L${cx} ${cy + 3}L${cx - 8} ${cy + 8}Z" fill="${C.friendly}" filter="url(#glow)"/>`;

  const contacts = [
    ['TGT-01', 38, 0.58, 'ARM', 'ARM BARE-METAL', 'Radxa Dragon Q6A, no OS underneath'],
    ['TGT-02', 112, 0.82, 'KERNEL', 'OS INTERNALS', 'memory, context switching, scheduling'],
    ['TGT-03', 200, 0.46, 'SDR', 'SDR / RF', 'ADALM-Pluto, radio, radar, antennas'],
    ['TGT-04', 262, 0.72, 'FPV', 'FPV DRONES', 'build, tune, fly, crash, repeat'],
    ['TGT-05', 322, 0.9, 'MINTORA', 'MINTORA', 'NFT marketplace, shipped (friendly)'],
  ];

  const LX = 610;
  contacts.forEach(([id, brg, rng, short, name, detail], i) => {
    const friendly = i === 4;
    const col = friendly ? C.friendly : C.orange;
    const delay = (rng * EXPAND).toFixed(3);
    const [bx, by] = polar(cx, cy, R * rng, brg);
    const right = Math.sin((brg * Math.PI) / 180) >= -0.2;
    const shape = friendly
      ? `<rect x="${bx - 6}" y="${by - 6}" width="12" height="12" fill="${col}" filter="url(#glow)"/>`
      : `<path d="M${bx} ${by - 8}L${bx + 7} ${by + 5}H${bx - 7}Z" fill="${col}" filter="url(#glow)"/>`;
    body += `<g class="blip" style="animation-delay:${delay}s">${shape}</g>`;
    body += `<circle cx="${bx}" cy="${by}" r="7" fill="none" stroke="${col}" stroke-width="1.5" class="ring" style="animation-delay:${delay}s"/>`;
    body += `<g class="tag" style="animation-delay:${delay}s">${t(short, bx + (right ? 14 : -14), by + 5, { f: 'condB', s: 16, ls: 1.5, fill: col, a: right ? 'start' : 'end' })}</g>`;

    const y = 122 + i * 72;
    body += `<g class="in" style="animation-delay:${0.3 + i * 0.1}s">
${t(id, LX, y, { s: 13, fill: C.muted })}
${t(name, LX + 84, y + 4, { f: 'condB', s: 30, ls: 1, fill: C.text })}
${t(`RNG ${rng.toFixed(2)}`, W - 60, y, { f: 'condS', s: 15, ls: 2, fill: C.muted, a: 'end' })}
${t(detail, LX + 84, y + 32, { s: 16, fill: C.muted, max: W - 60 - LX - 84 })}
</g>`;
    body += `<rect x="${LX - 18}" y="${y - 20}" width="4" height="58" fill="${col}" class="hit" style="animation-delay:${delay}s"/>`;
    if (i < contacts.length - 1) body += `<line x1="${LX}" y1="${y + 47}" x2="${W - 60}" y2="${y + 47}" stroke="${C.blue}" stroke-opacity=".14"/>`;
  });

  card('radar', W, H, body, {
    aria: 'Pulse scan, currently tracking: ARM bare-metal on Radxa Dragon Q6A, OS internals, SDR and RF with ADALM-Pluto, FPV drones, and Mintora, an NFT marketplace that shipped.',
    defs: `<radialGradient id="scope"><stop offset="0" stop-color="${C.blue}" stop-opacity=".16"/><stop offset="1" stop-color="${C.blue}" stop-opacity=".03"/></radialGradient>
<radialGradient id="cone" cx="${cx}" cy="${cy}" r="90" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.friendly}" stop-opacity=".35"/><stop offset="1" stop-color="${C.friendly}" stop-opacity="0"/></radialGradient>`,
    css: `
.pulse{transform-origin:${cx}px ${cy}px;transform:scale(0);animation:pulse ${PERIOD}s linear infinite}
@keyframes pulse{0%{transform:scale(0);opacity:1}${((EXPAND / PERIOD) * 100).toFixed(1)}%{transform:scale(1);opacity:.25}${((EXPAND / PERIOD) * 100 + 4).toFixed(1)}%,100%{transform:scale(1);opacity:0}}
.blip{opacity:.25;animation:blip ${PERIOD}s linear infinite}
@keyframes blip{0%{opacity:1}60%{opacity:.25}100%{opacity:.25}}
.tag{opacity:.5;animation:tag ${PERIOD}s linear infinite}
@keyframes tag{0%{opacity:1}65%{opacity:.5}100%{opacity:.5}}
.ring{opacity:0;transform-box:fill-box;transform-origin:center;animation:ring ${PERIOD}s ease-out infinite}
@keyframes ring{0%{opacity:.9;transform:scale(1)}20%{opacity:0;transform:scale(3.6)}100%{opacity:0}}
.hit{opacity:.15;animation:hit ${PERIOD}s linear infinite}
@keyframes hit{0%{opacity:1}40%{opacity:.15}100%{opacity:.15}}
`,
  });
}

// ================================================================ 5. data knife / registers
function registers() {
  const W = 1200, H = 410;
  const rows = [
    ['x1', 'CPU_ARCH', '0x00A1', 'Logic gates, ALUs, cache, pipelines'],
    ['x2', 'ASM', '0x0086', 'x86, ARM, RISC-V instruction sets'],
    ['x3', 'EMBEDDED', '0x0B4E', 'Bare-metal, RTOS, microcontrollers'],
    ['x4', 'REVERSE', '0xD15A', 'Firmware analysis, binary disassembly'],
    ['x5', 'RF_EM', '0x5800', 'Radio, radar, signal propagation'],
    ['x6', 'KERNEL', '0x5C11', 'Memory management, scheduling, syscalls'],
  ];
  const col = { arrow: 72, reg: 100, name: 170, val: 380, det: 520 };
  let body = header('DATA KNIFE  //  REGISTER DUMP', 'AREAS OF DEEP INTEREST', W);
  const hy = 112;
  body += `<g class="in" style="animation-delay:.2s">${['REG', 'NAME', 'VALUE', 'WHAT I DIG INTO'].map((s, i) => t(s, [col.reg, col.name, col.val, col.det][i], hy, { f: 'condS', s: 14, ls: 3, fill: C.muted })).join('')}</g>`;

  const Y0 = 154, DY = 40;
  body += `<g class="step"><rect x="60" y="${Y0 - 25}" width="${W - 120}" height="36" fill="${C.orange}" fill-opacity=".08"/><rect x="60" y="${Y0 - 25}" width="4" height="36" fill="${C.orange}"/><path d="M${col.arrow} ${Y0 - 14}L${col.arrow + 9} ${Y0 - 7}L${col.arrow} ${Y0}Z" fill="${C.orange}" filter="url(#glow)"/><rect x="${W - 150}" y="${Y0 - 17}" width="80" height="20" fill="url(#hatch)" opacity=".7"/></g>`;
  rows.forEach(([reg, name, val, det], i) => {
    const y = Y0 + i * DY;
    body += `<g class="in" style="animation-delay:${0.3 + i * 0.08}s">
${t(reg, col.reg, y, { s: 18, fill: C.muted })}
${t(name, col.name, y, { f: 'monoB', s: 18, fill: C.text })}
${t(val, col.val, y, { s: 18, fill: C.friendly })}
${t(det, col.det, y, { s: 18, fill: C.soft, max: W - 60 - col.det })}
</g>`;
  });

  card('registers', W, H, body, {
    aria: 'Areas of deep interest: CPU architecture, assembly (x86, ARM, RISC-V), embedded systems, reverse engineering, RF and electromagnetics, OS and kernel design.',
    css: `
.step{animation:step ${rows.length * 1.3}s steps(${rows.length}) infinite}
@keyframes step{from{transform:translateY(0)}to{transform:translateY(${rows.length * DY}px)}}
`,
  });
}

// ================================================================ 6. FPV goggles OSD
async function fpv() {
  const W = 1200, H = 500;
  const jpg = await sharp(path.join(ROOT, 'fpv.jpeg'))
    .extract({ left: 600, top: 1700, width: 4800, height: 2000 })
    .resize(W, H)
    .modulate({ saturation: 0.9 })
    .jpeg({ quality: 70, mozjpeg: true })
    .toBuffer();

  // ---- OSD readouts: edit these ----
  const OSD = {
    rssi: '-42dBm',
    lq: '100%',
    status: 'DISARMED',
    timer: '00:00.0',
    volts: '24.8V',
    cells: 6, // battery icon draws one bar per cell
    capacity: '1600mAh',
    pilot: 'NABIL',
    vtx: '5.8G  R1  1000mW',
    tagline: 'CALL ME AN FPV PILOT TOO',
  };

  const O = { f: 'monoB', s: 20, fill: '#f4f8fb' };
  const L = { ...O, s: 14, fill: '#cfe1ee' };
  const ccx = 600, ccy = 238;

  // battery icon: body grows with the cell count, right edge stays put
  const bRight = W - 152, bW = OSD.cells * 8 + 4, bLeft = bRight - bW;
  let cellBars = '';
  for (let i = 0; i < OSD.cells; i++) cellBars += `M${bLeft + 4 + i * 8} 50h6v12h-6z`;

  const body = `<image width="${W}" height="${H}" xlink:href="data:image/jpeg;base64,${jpg.toString('base64')}"/>
<rect width="${W}" height="${H}" fill="url(#vig)"/>
<rect width="${W}" height="${H}" fill="url(#scanlines)"/>
<g class="osd">
${t('RSSI', 48, 62, L)}${t(OSD.rssi, 104, 62, O)}
${t('LQ', 48, 92, L)}${t(OSD.lq, 104, 92, O)}
<g class="blink">${t(OSD.status, ccx, 62, { ...O, fill: C.orange, a: 'middle' })}</g>
${t(OSD.timer, ccx, 92, { ...O, s: 16, a: 'middle' })}
<path d="M${bLeft} 46h${bW}v20h-${bW}zM${bRight} 52h4v8h-4z" fill="none" stroke="#f4f8fb" stroke-width="2"/>
<path d="${cellBars}" fill="#f4f8fb"/>
${t(OSD.volts, W - 48, 64, { ...O, a: 'end' })}
${t(`${OSD.cells}S  ${OSD.capacity}`, W - 48, 92, { ...L, a: 'end' })}
<g class="hz"><path d="M${ccx - 210} ${ccy}h120M${ccx + 90} ${ccy}h120M${ccx - 210} ${ccy}v8M${ccx + 210} ${ccy}v8" fill="none" stroke="#f4f8fb" stroke-width="2.5"/></g>
<path d="M${ccx - 22} ${ccy}h14M${ccx + 8} ${ccy}h14M${ccx} ${ccy - 22}v14M${ccx} ${ccy + 8}v14" stroke="#f4f8fb" stroke-width="2.5"/>
<circle cx="${ccx}" cy="${ccy}" r="3" fill="#f4f8fb"/>
${t('PILOT', 48, H - 46, { ...O, s: 12, fill: '#cfe1ee' })}${t(OSD.pilot, 112, H - 46, O)}
${t(OSD.tagline, ccx, H - 44, { f: 'condB', s: 32, ls: 2, fill: C.ice, a: 'middle' })}
${t(OSD.vtx, W - 48, H - 46, { ...O, s: 16, a: 'end' })}
</g>`;

  card('fpv', W, H, body, {
    aria: 'My FPV kit: goggles, a small FPV drone and a radio controller in the grass, with a goggles style on-screen display. Call me an FPV pilot too.',
    defs: `<linearGradient id="vig" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".6"/><stop offset=".28" stop-color="#000" stop-opacity=".05"/><stop offset=".7" stop-color="#000" stop-opacity=".05"/><stop offset="1" stop-color="#000" stop-opacity=".7"/></linearGradient>
<pattern id="scanlines" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="#000" fill-opacity=".18"/></pattern>`,
    css: `
.osd use{stroke:#000;stroke-opacity:.55;stroke-width:3px;paint-order:stroke;stroke-linejoin:round}
.hz{transform-origin:${ccx}px ${ccy}px;animation:hz 7s ease-in-out infinite}
@keyframes hz{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(3.5deg) translateY(4px)}}
`,
  });
}

// ================================================================ 7. projects (loadout layout)
// Each project is its own SVG so every tile can link to its repo in README.md.
// Static on purpose: no animation.
const PROJECTS = [
  {
    file: 'mintora', repo: 'Mintora', slot: 'TITAN', kind: 'FLAGSHIP  //  NFT MARKETPLACE', name: 'MINTORA',
    desc: 'NFT marketplace for Bitcoin Layer 2, running on Hemi today. Solidity marketplace contracts, a React + wagmi front end, an Express API, and Cloudflare R2 for media.',
    tags: ['SOLIDITY', 'REACT', 'WAGMI', 'EXPRESS', 'CLOUDFLARE R2'],
  },
  {
    file: 'hairgames', repo: 'HairGames', slot: 'PRIMARY', kind: 'WEB3 ARCADE', name: 'HAIRGAMES',
    desc: 'An arcade of on-chain games on Hemi. Play in the browser, put your score on chain, earn Hair Points.',
    tags: ['TYPESCRIPT', 'HEMI', 'ON-CHAIN'],
  },
  {
    file: 'lab-rampage', repo: 'Web3-Games', slot: 'SECONDARY', kind: 'WEB3 GAME', name: 'MAD SCIENTIST: LAB RAMPAGE',
    desc: 'Side-scrolling run-and-gun with Spine animation and 10 unlockable guns. Daily raids are seeded by Bitcoin blocks.',
    tags: ['JAVASCRIPT', 'SPINE', 'BITCOIN'],
  },
  {
    file: 'esp32-dashboard', repo: 'esp32-realtime-dashboard', slot: 'TACTICAL', kind: 'IOT', name: 'ESP32 REALTIME DASHBOARD',
    desc: 'An ESP32 streams temperature, current and voltage to a Flask + Socket.IO dashboard that updates live.',
    tags: ['ESP32', 'FLASK', 'SOCKET.IO'],
  },
  {
    file: 'avr', repo: 'AVR_programs', slot: 'BOOST', kind: 'BARE-METAL', name: 'AVR PROGRAMS',
    desc: 'Bare-metal C for the ATmega328P, built and flashed straight onto the chip with avrdude.',
    tags: ['C', 'ATMEGA328P', 'AVRDUDE'],
  },
];

function wrap(str, o, maxW) {
  const lines = [];
  let cur = '';
  for (const w of str.split(' ')) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && measure(next, o).w > maxW) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

// largest font size (down to `min`) at which the text fits
function fitSize(str, o, maxW, min) {
  let s = o.s;
  while (s > min && measure(str, { ...o, s }).w > maxW) s -= 1;
  return s;
}

function tagChips(tags, x, y) {
  let svg = '';
  let cx = x;
  for (const tag of tags) {
    const w = measure(tag, { f: 'condS', s: 15, ls: 1.5 }).w + 24;
    svg += `<path d="${chamfer(cx, y, w, 30, 7)}" fill="${C.panel}" stroke="${C.blue}" stroke-opacity=".55"/>${t(tag, cx + 12, y + 21, { f: 'condS', s: 15, ls: 1.5, fill: C.ice })}`;
    cx += w + 8;
  }
  return { svg, end: cx - 8 };
}

const openRepo = (xr, y) => {
  const lbl = T('OPEN REPO', xr - 24, y, { f: 'condB', s: 16, ls: 2.5, fill: C.orange, a: 'end' });
  return `${lbl.svg}<path d="M${xr - 14} ${y - 1}l10 -10m-7 0h7v7" fill="none" stroke="${C.orange}" stroke-width="2" stroke-linecap="square"/>`;
};

function projects() {
  // section header strip
  card('projects-header', 1200, 92, header('LOADOUT  //  PROJECTS', 'SELECT A SLOT TO OPEN THE REPO', 1200, 52, false), {
    aria: 'Projects',
  });

  PROJECTS.forEach((p, i) => {
    const titan = p.slot === 'TITAN';
    const W = titan ? 1200 : 600, H = titan ? 270 : 250;
    const X = 34, R = W - 34;
    let body = '';
    if (titan) body += `<path d="M0 0H${W}V${H}H0Z" fill="${C.orange}" fill-opacity=".06"/>`;
    body += `<path d="M${X + 6} 30h7l-7 19h-7z" fill="${C.orange}"/>`;
    const slot = T(p.slot, X + 22, 46, { f: 'condB', s: 17, ls: 3.5, fill: C.orange });
    body += slot.svg + t(`//  ${p.kind}`, X + 22 + slot.w + 12, 46, { f: 'cond', s: 16, ls: 2.5, fill: C.muted });
    body += t(String(i).padStart(2, '0'), R, 46, { s: 13, fill: C.muted, a: 'end', op: 0.7 });

    const titleMax = titan ? 760 : R - X;
    const ts = fitSize(p.name, { f: 'condB', s: titan ? 74 : 44, ls: 1 }, titleMax, 30);
    body += t(p.name, X - 2, titan ? 118 : 100, { f: 'condB', s: ts, ls: 1, fill: C.text, max: titleMax });

    const dO = { f: 'cond', s: titan ? 23 : 21, ls: 0.3 };
    const lines = wrap(p.desc, dO, titan ? 760 : R - X);
    if (lines.length > 2) throw new Error(`Description of ${p.name} wraps to ${lines.length} lines; keep it to 2`);
    lines.forEach((ln, k) => { body += t(ln, X, (titan ? 156 : 136) + k * (titan ? 28 : 26), { ...dO, fill: C.soft }); });

    const chips = tagChips(p.tags, X, H - 62);
    body += chips.svg;
    body += openRepo(R, H - 40);
    if (chips.end > R - 150) throw new Error(`Tags of ${p.name} run into OPEN REPO`);

    if (titan) {
      // static titan readiness block on the right
      body += `<rect x="${R - 150}" y="${74}" width="150" height="12" fill="url(#hatch)"/>`;
      body += t('READY', R, 140, { f: 'condB', s: 40, ls: 5, fill: C.orange, a: 'end' });
      let bar = '';
      for (let k = 0; k < 16; k++) bar += `<path d="${seg(R - 190 + k * 12, 156, 8, 10, 3)}" fill="${C.orange}"/>`;
      body += bar;
    }

    card(`project-${p.file}`, W, H, body, {
      aria: `${p.name}: ${p.desc} Built with ${p.tags.join(', ')}.`,
      edge: titan ? C.orange : C.blue,
    });
  });
}

// ================================================================ 8. tech stack (static)
const STACK = [
  ['SYSTEMS', [['C', 'c'], ['C++', 'cplusplus'], ['Rust', 'rust'], ['Linux', 'linux'], ['Arduino', 'arduino']]],
  ['WEB', [['TypeScript', 'typescript'], ['JavaScript', 'javascript'], ['React', 'react'], ['Tailwind CSS', 'tailwindcss'], ['Framer Motion', 'framer'], ['Node.js', 'nodedotjs']]],
  ['BACKEND', [['Python', 'python'], ['Java', 'openjdk'], ['C#', 'C#'], ['MySQL', 'db']]],
  ['WEB3', [['Solidity', 'solidity'], ['Ethereum', 'ethereum']]],
  ['CLOUD', [['Cloudflare', 'cloudflare'], ['Google Cloud', 'googlecloud'], ['Git', 'git']]],
  ['DESIGN & 3D', [['Figma', 'figma'], ['Blender', 'blender'], ['Unity', 'unity'], ['Photoshop', 'Ps'], ['After Effects', 'Ae'], ['Illustrator', 'Ai']]],
];

// brand icon from simple-icons, or a monogram tile when the brand isn't in the set
function icon(key, x, y, size = 22) {
  if (key === 'db') {
    // generic database glyph (the MySQL mark includes a wordmark that is unreadable this small)
    const cx = x + size / 2, w = size * 0.42, e = size * 0.16;
    return `<g fill="none" stroke="${C.ice}" stroke-width="1.6"><ellipse cx="${cx}" cy="${y + 4 + e / 2}" rx="${w}" ry="${e}"/><path d="M${cx - w} ${y + 4 + e / 2}V${y + size - 4}A${w} ${e} 0 0 0 ${cx + w} ${y + size - 4}V${y + 4 + e / 2}M${cx - w} ${y + size / 2 + 2}A${w} ${e} 0 0 0 ${cx + w} ${y + size / 2 + 2}"/></g>`;
  }
  const si = SI['si' + key[0].toUpperCase() + key.slice(1)];
  if (si && /^[a-z]+$/.test(key)) {
    return `<path transform="translate(${x} ${y}) scale(${size / 24})" d="${si.path}" fill="${C.ice}"/>`;
  }
  return `<rect x="${x + 0.75}" y="${y + 0.75}" width="${size - 1.5}" height="${size - 1.5}" rx="4" fill="none" stroke="${C.ice}" stroke-width="1.5"/>${t(key, x + size / 2, y + size / 2 + 5, { f: 'condB', s: 14, fill: C.ice, a: 'middle' })}`;
}

function stack() {
  const W = 1200;
  const LX = 60, CX = 250, RX = W - 60, CH = 44, GAP = 10;
  let body = header('TECH STACK', 'LANGUAGES  ·  FRAMEWORKS  ·  TOOLS', W, 52, false);
  let y = 98;
  STACK.forEach(([cat, items], ci) => {
    body += t(cat, LX, y + 28, { f: 'condB', s: 18, ls: 3, fill: C.orange });
    let x = CX;
    for (const [name, key] of items) {
      const w = 14 + 22 + 10 + measure(name, { f: 'condS', s: 20, ls: 0.5 }).w + 16;
      if (x + w > RX) { x = CX; y += CH + GAP; }
      body += `<path d="${chamfer(x, y, w, CH, 8)}" fill="${C.panel}" stroke="${C.blue}" stroke-opacity=".45"/>`;
      body += icon(key, x + 14, y + 11);
      body += t(name, x + 46, y + 29, { f: 'condS', s: 20, ls: 0.5, fill: C.text });
      x += w + GAP;
    }
    y += CH;
    if (ci < STACK.length - 1) {
      body += `<line x1="${LX}" y1="${y + 14}" x2="${RX}" y2="${y + 14}" stroke="${C.blue}" stroke-opacity=".14"/>`;
      y += 28;
    }
  });
  const H = y + 46;
  card('stack', W, H, body, {
    aria: `Tech stack. ${STACK.map(([c, items]) => `${c}: ${items.map((i) => i[0]).join(', ')}`).join('. ')}.`,
  });
}

// ================================================================ 9. signal footer
function signal() {
  const W = 1200, H = 346;
  const top = 92, bot = 176, mid = (top + bot) / 2;
  let grid = '';
  for (let x = 60; x <= W - 60; x += 54) grid += `M${x} ${top}V${bot}`;
  for (let y = top; y <= bot; y += 21) grid += `M60 ${y}H${W - 60}`;

  // AM-modulated carrier, periodic over 540 px so the scroll loops seamlessly
  const PER = 540;
  let d = '';
  for (let x = 0; x <= W + PER; x += 2) {
    const env = 0.35 + 0.65 * Math.abs(Math.sin((x / PER) * Math.PI * 2));
    const y = mid - 34 * env * Math.sin((x / PER) * Math.PI * 2 * 9);
    d += `${x === 0 ? 'M' : 'L'}${x} ${r2(y)}`;
  }

  const body = `${header('COMMS  //  OPEN CHANNEL', 'CH1  ·  5.8 GHZ', W)}
<path d="${grid}" stroke="${C.blue}" stroke-opacity=".12"/>
<path d="M60 ${mid}H${W - 60}" stroke="${C.blue}" stroke-opacity=".3"/>
<g clip-path="url(#scr)"><g class="wave"><path d="${d}" fill="none" stroke="${C.ice}" stroke-width="1.8" filter="url(#glow)"/></g></g>
<g class="in" style="animation-delay:.3s">${t('"The more I learn, the more I realize how deep the rabbit hole goes."', W / 2, 216, { s: 17, fill: C.muted, a: 'middle' })}</g>
<g class="in" style="animation-delay:.5s">${t("LET'S BUILD SOMETHING AT THE EDGE OF WHAT'S POSSIBLE", W / 2, 276, { f: 'condB', s: 46, ls: 1.5, fill: C.text, a: 'middle', max: W - 140 })}</g>
<g class="in" style="animation-delay:.7s">${t('open to software, kernel and OS design, embedded firmware, research and experimental projects', W / 2, 312, { s: 16, fill: C.muted, a: 'middle', max: W - 140 })}</g>
`;
  card('signal', W, H, body, {
    aria: "The more I learn, the more I realize how deep the rabbit hole goes. Let's build something at the edge of what's possible. Open to software, kernel and OS design, embedded firmware, research and experimental projects.",
    defs: `<clipPath id="scr"><rect x="60" y="${top}" width="${W - 120}" height="${bot - top}"/></clipPath>`,
    css: `
.wave{animation:wave 4s linear infinite}
@keyframes wave{from{transform:translateX(0)}to{transform:translateX(-${PER}px)}}
`,
  });
}

// ================================================================ 10. link buttons
function buttons() {
  const links = [
    ['linkedin', 'LINKEDIN', '01'],
    ['leetcode', 'LEETCODE', '02'],
    ['discord', 'DISCORD', '03'],
    ['facebook', 'FACEBOOK', '04'],
  ];
  const W = 240, H = 60;
  for (const [file, name, n] of links) {
    const body = `
<path d="${chamfer(1, 1, W - 2, H - 2, 14)}" fill="${C.panel}" stroke="${C.ice}" stroke-opacity=".5" stroke-width="1.5"/>
<path d="M1 15L15 1H70" fill="none" stroke="${C.orange}" stroke-width="3"/>
${t(n, 22, 36, { s: 12, fill: C.orange })}
${t(name, 52, 41, { f: 'condB', s: 28, ls: 2, fill: C.ice })}
<path d="M${W - 42} ${H / 2 + 7}l13 -13m-9 0h9v9" fill="none" stroke="${C.ice}" stroke-width="2.2" stroke-linecap="square"/>
`;
    card(`btn-${file}`, W, H, body, { aria: name, shell: false });
  }
}

for (const f of fs.readdirSync(OUT)) if (f.endsWith('.svg')) fs.unlinkSync(path.join(OUT, f));
await hero();
boot();
datapath();
radar();
registers();
await fpv();
projects();
stack();
signal();
buttons();
