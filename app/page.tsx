"use client";
/* eslint-disable @next/next/no-img-element, @typescript-eslint/no-explicit-any */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { ReactNode, CSSProperties } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  Heart, X, Check, Camera, Receipt, Trophy, BookOpen, Plus, Pencil, EyeOff, LogOut, Lock,
  Upload as UploadIcon, MapPin, Moon, Sun, Share2, ChevronLeft, ChevronRight
} from 'lucide-react';

/* ───────────────────────── Supabase ───────────────────────── */
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);
const BUCKET = 'meowcare';
const MAX_GALLERY = 6; // extra photos per cat, keeps storage and bandwidth in check
const THEME_KEY = 'meowcare-theme';
const ABOUT_KEY = 'about_us';
const DEFAULT_ABOUT = `MeowCare lahir dari keresahan sederhana: banyak kucing jalanan yang kelaparan, sementara banyak orang ingin membantu tapi bingung caranya.

Lewat patungan receh, setiap donasi langsung diubah menjadi makanan. Relawan kami memberi makan kucing-kucing ini dan mengunggah fotonya ke Buku Harian, jadi kamu bisa melihat sendiri ke mana donasimu pergi.`;

/* ───────────────────────── Types ───────────────────────── */
type ID = string | number;
type Row = Record<string, any>;
type DonationStatus = 'pending' | 'approved' | 'rejected';
type Theme = 'light' | 'dark';

interface Cat {
  id: ID; name: string; breed: string; age: string; traits: string[];
  photo: string; targetAmount: number; currentRaised: number; isActive: boolean;
  lat: number | null; lng: number | null;
  gallery: string[]; videoUrl: string;
}
interface Donation {
  id: ID; catId: ID; name: string; amount: number; status: DonationStatus;
  receipt: string | null; createdAt: string;
}
interface Proof { id: ID; catId: ID; photo: string; note: string; cost: number; createdAt: string }
interface CatPayload {
  id?: ID; name: string; breed: string; age: string; traits: string[]; targetAmount: number; photo: string;
  lat: number | null; lng: number | null; gallery: string[]; videoUrl: string;
}
interface NewDonation { catId: ID; name: string; amount: number; receipt: string }
interface LedgerEntry { id: string; date: string; type: 'in' | 'out'; catName: string; label: string; amount: number }
interface Handlers {
  approve(d: Donation): Promise<void>;
  reject(d: Donation): Promise<void>;
  fed(catId: ID, photo: string, note: string, cost: number): Promise<void>;
  save(c: CatPayload): Promise<void>;
  setActive(id: ID, active: boolean): Promise<void>;
  saveAbout(text: string): Promise<void>;
  removeCat(id: ID): Promise<void>;
}

/* DB row → UI model */
const toCat = (r: Row): Cat => ({
  id: r.id, name: r.name, breed: r.breed ?? '', age: r.age ?? '', traits: r.traits ?? [],
  photo: r.photo_url ?? '', targetAmount: Number(r.target_amount), currentRaised: Number(r.current_raised),
  isActive: r.is_active !== false,
  lat: r.lat ? Number(r.lat) : null, lng: r.lng ? Number(r.lng) : null,
  gallery: Array.isArray(r.gallery) ? r.gallery.filter((x: unknown): x is string => typeof x === 'string' && !!x) : [],
  videoUrl: r.video_url ?? '',
});
const toDonation = (r: Row): Donation => ({
  id: r.id, catId: r.cat_id, name: r.display_name ?? 'Anonim', amount: Number(r.amount),
  status: r.status, receipt: r.receipt_url ?? null, createdAt: r.created_at,
});
const toProof = (r: Row): Proof => ({
  id: r.id, catId: r.cat_id, photo: r.photo_url ?? '', note: r.note ?? '', cost: Number(r.cost ?? 0), createdAt: r.created_at,
});

/* ───────────────────────── Helpers ───────────────────────── */
const rp = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
const pctOf = (c: Cat) => Math.min(100, Math.round((c.currentRaised / c.targetAmount) * 100));

/* ───────────────────────── SFX (native HTML5 Audio, zero dependencies) ───────────────────────── */
type Sfx = 'meow' | 'coin';
const SFX_SRC: Record<Sfx, string> = { meow: '/meow.mp3', coin: '/coin.mp3' };
const sfxPool: Partial<Record<Sfx, HTMLAudioElement>> = {};

/* One reusable <audio> per sound, created lazily so nothing downloads until the first tap */
const getSfx = (name: Sfx): HTMLAudioElement => (sfxPool[name] ??= new Audio(SFX_SRC[name]));

/* Never throws: autoplay blocks, missing files and unsupported browsers all stay silent */
function playSfx(name: Sfx, volume = 0.7) {
  if (typeof window === 'undefined') return;
  try {
    const a = getSfx(name);
    a.muted = false;
    a.volume = volume;
    a.currentTime = 0;
    a.play()?.catch(() => { /* autoplay blocked or file missing */ });
  } catch { /* Audio API unavailable */ }
}

/* iOS Safari only lets an <audio> element play later (e.g. after an await) once it has been played inside a tap.
   So on the very first tap we silently "prime" every sound that is not already playing. */
function unlockSfx() {
  (Object.keys(SFX_SRC) as Sfx[]).forEach(name => {
    try {
      const a = getSfx(name);
      if (!a.paused) return; // already played for real inside this tap, so it is unlocked
      a.muted = true;
      a.play()?.then(() => { a.pause(); a.currentTime = 0; a.muted = false; })
        .catch(() => { a.muted = false; });
    } catch { /* ignore */ }
  });
}

/* Money in (approved donations) + money out (feeding costs), newest first */
const buildLedger = (cats: Cat[], donations: Donation[], proofs: Proof[]): LedgerEntry[] => {
  const nameOf = (id: ID) => cats.find(c => String(c.id) === String(id))?.name ?? 'Kucing dihapus';
  const income = donations.filter(d => d.status === 'approved').map<LedgerEntry>(d => ({
    id: 'in-' + d.id, date: d.createdAt, type: 'in', catName: nameOf(d.catId), label: d.name, amount: d.amount,
  }));
  const expense = proofs.map<LedgerEntry>(p => ({
    id: 'out-' + p.id, date: p.createdAt, type: 'out', catName: nameOf(p.catId), label: p.note, amount: p.cost,
  }));
  return [...income, ...expense].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
};

/* Shrinks big phone photos before upload so they cost far less storage and bandwidth */
async function compressImage(file: File, maxSide = 1280, quality = 0.82): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 250 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.fillStyle = '#fff'; // JPEG has no transparency
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

async function uploadImage(file: File, folder: string): Promise<string> {
  if (file.size > 5 * 1024 * 1024) throw new Error('Ukuran foto maksimal 5 MB');
  // Receipts stay untouched so the admin can still read them
  const f = folder === 'receipts' ? file : await compressImage(file);
  const ext = f.name.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, f, { cacheControl: '31536000', upsert: false, contentType: f.type }); // file names are unique, so cache for a year
  if (error) throw error;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/* ───────────────────────── Icons ───────────────────────── */
const ICONS = { Heart, X, Check, Camera, Receipt, Trophy, BookOpen, Plus, Pencil, EyeOff, LogOut, Lock, Upload: UploadIcon, MapPin, Moon, Sun, Share2, ChevronLeft, ChevronRight };
type IconName = keyof typeof ICONS;
const Ic = ({ n, size = 18 }: { n: IconName; size?: number }) => {
  const C = ICONS[n];
  return <C size={size} aria-hidden="true" />;
};

/* ───────────────────────── Styles ───────────────────────── */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Quicksand:wght@500;600;700&display=swap');
@import url('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css');

:root{color-scheme:light;--bg:#fff6ea;--ink:#4a2c1d;--muted:#8a6a58;--card:#fffdf8;--soft:#ffe9d2;--pink:#ffc6d9;--mint:#c9f0d8;--a1:#ff8a4c;--a2:#ff6f9f;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--bg:#1d1410;--ink:#ffe9d6;--muted:#d1b29d;--card:#2a1d17;--soft:#3a2a20;--pink:#5a2c3e;--mint:#254334}}
:root[data-theme="dark"]{color-scheme:dark;--bg:#1d1410;--ink:#ffe9d6;--muted:#d1b29d;--card:#2a1d17;--soft:#3a2a20;--pink:#5a2c3e;--mint:#254334}
html{scroll-padding-top:env(safe-area-inset-top,0px);scroll-behavior:smooth}
html,body{background:var(--bg);color:var(--ink);font-family:'Quicksand','Nunito','Segoe UI',system-ui,sans-serif;font-weight:600}
body::before{content:"";position:fixed;inset:0 0 auto;height:env(safe-area-inset-top,0px);background:var(--card);z-index:45}
.muted{color:var(--muted)} .soft{background:var(--soft)}
.card{background:var(--card);border:2.5px solid var(--ink);border-radius:28px 12px 30px 14px/14px 28px 12px 30px;box-shadow:4px 4px 0 var(--ink)}
.chip{display:inline-block;font-size:.72rem;font-weight:700;padding:2px 10px;border:2px solid var(--ink);border-radius:99px 60px 99px 70px;background:var(--pink)}
.btn{font-weight:700;border:2.5px solid var(--ink);border-radius:22px 12px 24px 12px/12px 22px 12px 24px;box-shadow:3px 3px 0 var(--ink);transition:transform .15s,box-shadow .15s;cursor:pointer}
.btn:hover{transform:translate(-1px,-2px) rotate(-1deg);box-shadow:5px 5px 0 var(--ink)}
.btn:active{transform:translate(2px,2px);box-shadow:1px 1px 0 var(--ink)}
.btn:disabled{opacity:.45;cursor:not-allowed;transform:none}
.go{background:linear-gradient(120deg,var(--a1),var(--a2));color:#fff;text-shadow:0 1px 0 rgba(0,0,0,.2)}
.ghost{background:var(--card);color:var(--ink)}
.ok{background:#7ddba0;color:#143d26}.no{background:var(--pink);color:var(--ink)}
.input{width:100%;padding:.65rem .9rem;background:var(--card);color:var(--ink);border:2.5px solid var(--ink);border-radius:16px 10px 18px 10px;outline:none;font-weight:600}
.input:focus{box-shadow:3px 3px 0 var(--a1)}
.frame{position:relative;aspect-ratio:1/1}
.frame::before,.frame::after{content:"";position:absolute;top:-7%;width:30%;height:30%;background:var(--ink);clip-path:polygon(0 100%,50% 0,100% 100%)}
.frame::before{left:9%;transform:rotate(-16deg)} .frame::after{right:9%;transform:rotate(16deg)}
.blob{position:relative;z-index:1;width:100%;height:100%;overflow:hidden;border:3px solid var(--ink);border-radius:58% 42% 55% 45%/52% 56% 44% 48%;background:var(--soft)}
.ph{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:3rem;background:radial-gradient(circle at 30% 30%,var(--pink),var(--soft))}
.bar{height:22px;background:var(--soft);border:2.5px solid var(--ink);border-radius:99px 40px 99px 50px;overflow:hidden}
.bar>div{height:100%;transition:width .8s cubic-bezier(.3,1.4,.5,1);background:repeating-linear-gradient(115deg,var(--a1) 0 14px,#ffa870 14px 28px)}
.polaroid{background:#fff;padding:6px 6px 10px;border:2px solid var(--ink);box-shadow:3px 3px 0 var(--ink);color:#4a2c1d}
.fl{position:fixed;z-index:0;pointer-events:none;opacity:.5;animation:fl 9s ease-in-out infinite}

/* MAP THEMING */
.map-theme .leaflet-tile-pane { filter: sepia(0.4) hue-rotate(-15deg) contrast(0.9) brightness(0.95); }
@media (prefers-color-scheme:dark){ :root:not([data-theme="light"]) .map-theme .leaflet-tile-pane { filter: invert(0.9) hue-rotate(180deg) brightness(0.8) contrast(1.2) sepia(0.2); } }
:root[data-theme="dark"] .map-theme .leaflet-tile-pane { filter: invert(0.9) hue-rotate(180deg) brightness(0.8) contrast(1.2) sepia(0.2); }
.leaflet-popup-content-wrapper, .leaflet-popup-tip { background: var(--card) !important; border: 2.5px solid var(--ink); color: var(--ink) !important; box-shadow: 4px 4px 0 var(--ink) !important; border-radius: 16px !important; }
.leaflet-popup-tip { border-top: none; border-left: none; box-shadow: none !important; }

@keyframes fl{0%,100%{transform:translateY(0) rotate(-8deg)}50%{transform:translateY(-28px) rotate(10deg)}}
@keyframes bounce{0%,100%{transform:translateY(0)}40%{transform:translateY(-8px)}60%{transform:translateY(-3px)}}
.bnc{animation:bounce 2s ease-in-out infinite}
@keyframes pop{from{transform:scale(.92) translateY(14px);opacity:0}to{transform:none;opacity:1}} .pop{animation:pop .25s ease-out}

/* ANIMATIONS & MICRO-INTERACTIONS */
@keyframes fade-in-up{from{opacity:0;transform:translateY(24px) rotate(var(--rot,0deg))}to{opacity:1;transform:translateY(0) rotate(var(--rot,0deg))}}
.reveal{opacity:0}
.reveal.in{opacity:1;animation:fade-in-up .6s cubic-bezier(.2,.8,.2,1) var(--delay,0ms) backwards}
.cat-card{transform:rotate(var(--rot,0deg));transition:transform .2s ease}
.cat-card:hover{transform:translateY(-4px) rotate(var(--rot,0deg))}
@keyframes pulse{0%,100%{box-shadow:3px 3px 0 var(--ink),0 0 0 0 rgba(255,111,159,.6)}50%{box-shadow:3px 3px 0 var(--ink),0 0 0 12px rgba(255,111,159,0)}}
.pulse{animation:pulse 1.8s ease-out infinite}
.pulse:hover{animation:none}

/* PHOTO SLIDER */
.slider{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;aspect-ratio:4/3;border:3px solid var(--ink);border-radius:26px 14px 28px 14px;background:var(--soft)}
.slider::-webkit-scrollbar{display:none}
.slide{flex:0 0 100%;scroll-snap-align:center;height:100%;overflow:hidden}
.slide>*{width:100%;height:100%}
.slider-btn{position:absolute;top:calc(50% - 17px);width:34px;height:34px;padding:0;display:flex;align-items:center;justify-content:center;z-index:2}
.slider-dots{position:absolute;bottom:10px;left:0;right:0;display:flex;justify-content:center;gap:6px;z-index:2;pointer-events:none}
.slider-dots button{pointer-events:auto;width:10px;height:10px;padding:0;border:2px solid var(--ink);border-radius:99px;background:var(--card);transition:width .2s,background .2s}
.slider-dots button.on{width:22px;background:var(--a2)}

/* GALLERY THUMBS (admin form) */
.thumbs{display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem}
.thumb{position:relative;aspect-ratio:1/1;border:2.5px solid var(--ink);border-radius:14px;overflow:hidden;background:var(--soft)}
.thumb-x{position:absolute;top:4px;right:4px;width:24px;height:24px;padding:0;display:flex;align-items:center;justify-content:center;box-shadow:2px 2px 0 var(--ink)}

/* VIDEO EMBED */
.video{margin-top:14px;width:100%;border:3px solid var(--ink);border-radius:20px 12px 22px 12px;overflow:hidden;background:#000}
.video iframe{width:100%;height:100%;border:0;display:block}
.video.wide{aspect-ratio:16/9}
.video.tall{max-width:325px;height:560px;margin-inline:auto}

/* LIVE TICKER */
@keyframes ticker{from{transform:translateX(0)}to{transform:translateX(-50%)}}
.ticker{overflow:hidden;white-space:nowrap;margin-top:1.25rem;background:var(--soft);border-top:2.5px solid var(--ink);border-bottom:2.5px solid var(--ink);font-weight:700;font-size:.875rem}
.ticker-track{display:flex;width:max-content;animation:ticker 40s linear infinite}
.ticker:hover .ticker-track{animation-play-state:paused}
.ticker-half{display:flex}
.ticker-item{padding:.6rem 1.25rem}
.ticker-item::after{content:"•";margin-left:2.5rem;opacity:.45}

@media (prefers-reduced-motion:reduce){
  .reveal{opacity:1}.reveal.in{animation:none}
  .pulse,.bnc,.ticker-track{animation:none}
  .ticker{overflow-x:auto}
  .bar>div{transition:none}
  html{scroll-behavior:auto}
}
`;

/* ───────────────────────── UI components ───────────────────────── */
const Photo = ({ src, alt }: { src?: string | null; alt: string }) => {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [src]);
  return !src || bad
    ? <div className="ph" role="img" aria-label={alt}>🐱</div>
    : <img src={src} alt={alt} loading="lazy" onError={() => setBad(true)} className="w-full h-full object-cover" />;
};

const CatFrame = ({ src, alt, className = '' }: { src?: string | null; alt: string; className?: string }) => (
  <div className={'frame ' + className}><div className="blob"><Photo src={src} alt={alt} /></div></div>
);

const HungerBar = ({ cat }: { cat: Cat }) => {
  const p = pctOf(cat);
  const extra = Math.max(0, cat.currentRaised - cat.targetAmount);
  const [w, setW] = useState(0); // starts empty, then fills up so the CSS transition plays when the modal opens
  useEffect(() => {
    const t = setTimeout(() => setW(p), 80);
    return () => clearTimeout(t);
  }, [p]);
  return (
    <div>
      <div className="flex justify-between font-bold text-sm mb-1.5">
        <span>Hunger Bar {p >= 100 ? '😻' : p >= 50 ? '😺' : '🥺'}</span><span>{p}%</span>
      </div>
      <div className="bar" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}>
        <div style={{ width: w + '%' }} />
      </div>
      <div className="flex justify-between text-xs muted mt-1.5">
        <span>{rp(cat.currentRaised)}</span><span>target {rp(cat.targetAmount)}</span>
      </div>
      {extra > 0 && (
        <div className="text-xs mt-1 font-bold" style={{ color: 'var(--a2)' }}>
          +{rp(extra)} kelebihan jadi bekal 💝
        </div>
      )}
    </div>
  );
};

const Modal = ({ onClose, children, label }: { onClose: () => void; children: ReactNode; label: string }) => {
  useEffect(() => {
    const o = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => { document.body.style.overflow = o; window.removeEventListener('keydown', k); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3" style={{ background: 'rgba(40,20,10,.55)' }} onClick={onClose}>
      <div role="dialog" aria-label={label} className="card pop w-full sm:max-w-lg max-h-[92vh] overflow-y-auto relative" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} aria-label="Tutup" className="btn ghost absolute top-3 right-3 z-10 w-9 h-9 flex items-center justify-center"><Ic n="X" size={16} /></button>
        {children}
      </div>
    </div>
  );
};

const UploadField = ({ file, onFile, label, folder, icon = 'Upload', multiple = false, limit }: {
  file?: string | null; onFile: (url: string, name: string) => void; label: string; folder: string; icon?: IconName;
  multiple?: boolean; limit?: number; // limit = max files accepted per pick (0 disables the field)
}) => {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <div>
      <label className="btn ghost flex items-center justify-center gap-2 px-4 py-2.5 text-sm" style={{ borderStyle: 'dashed' }}>
        <Ic n={icon} size={16} />
        <span className="truncate">{busy ? 'Mengunggah…' : file ? '✓ ' + file : label}</span>
        <input type="file" accept="image/*" multiple={multiple} className="hidden" disabled={busy || limit === 0}
          onChange={async e => {
            const input = e.target;
            const files = Array.from(input.files ?? []).slice(0, limit ?? undefined);
            if (!files.length) return;
            setBusy(true); setErr('');
            try { for (const f of files) onFile(await uploadImage(f, folder), f.name); }
            catch (ex) { setErr(ex instanceof Error ? ex.message : 'Upload gagal'); }
            finally { setBusy(false); input.value = ''; }
          }} />
      </label>
      {err && <p className="text-xs mt-1 font-bold" style={{ color: 'var(--a2)' }}>{err}</p>}
    </div>
  );
};

/* ───────────────────────── Leaflet Maps ───────────────────────── */
const PublicMap = ({ cats, onOpen }: { cats: Cat[]; onOpen: (id: ID) => void }) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapInst = useRef<any>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !mapContainer.current) return;
    let L: any;
    import('leaflet').then((leaflet) => {
      L = leaflet.default || leaflet;
      if (!mapInst.current) {
        mapInst.current = L.map(mapContainer.current!).setView([-6.200000, 106.816666], 11); // Area default
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(mapInst.current);
      }
      
      // Bersihkan marker lama
      mapInst.current.eachLayer((layer: any) => { if (layer instanceof L.Marker) mapInst.current.removeLayer(layer); });
      
      // Tambah marker kucing
      cats.filter(c => c.lat && c.lng).forEach(c => {
         const icon = L.divIcon({
            className: 'custom-pin',
            html: `<div style="font-size:32px; filter: drop-shadow(2px 4px 0 var(--ink)); animation: bounce 2s infinite;">📍</div>`,
            iconSize: [32, 32], iconAnchor: [16, 32], popupAnchor: [0, -32]
         });
         const marker = L.marker([c.lat, c.lng], { icon }).addTo(mapInst.current);
         marker.bindPopup(`
          <div style="text-align:center; padding: 4px;">
            <b style="font-size:16px;">${c.name}</b>
            <img src="${c.photo}" style="width:100%; height:90px; object-fit:cover; border:2px solid var(--ink); border-radius:8px; margin: 8px 0;"/>
            <button onclick="window.dispatchEvent(new CustomEvent('open-cat', {detail: '${c.id}'}))" class="btn go" style="width:100%; padding:6px; font-size:12px;">Profil / Beri Makan</button>
          </div>
         `);
      });
    });
  }, [cats]);

  useEffect(() => {
     const handle = (e: any) => onOpen(e.detail);
     window.addEventListener('open-cat', handle);
     return () => window.removeEventListener('open-cat', handle);
  }, [onOpen]);

  return <div ref={mapContainer} className="w-full h-80 rounded-[24px] border-[3px] map-theme card overflow-hidden" style={{ borderColor: 'var(--ink)', zIndex: 1 }} />;
};

const LocationPicker = ({ lat, lng, onChange }: { lat: string; lng: string; onChange: (lat: string, lng: string) => void }) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapInst = useRef<any>(null);
  const markerInst = useRef<any>(null);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !mapContainer.current) return;
    import('leaflet').then((leaflet) => {
      const L = leaflet.default || leaflet;
      const initialLat = lat ? parseFloat(lat) : -6.200000;
      const initialLng = lng ? parseFloat(lng) : 106.816666;

      if (!mapInst.current) {
        mapInst.current = L.map(mapContainer.current!).setView([initialLat, initialLng], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapInst.current);

        const icon = L.divIcon({
            className: 'custom-pin',
            html: `<div style="font-size:36px; filter: drop-shadow(2px 4px 0 var(--ink));">📍</div>`,
            iconSize: [36, 36], iconAnchor: [18, 36]
        });

        markerInst.current = L.marker([initialLat, initialLng], { icon, draggable: true }).addTo(mapInst.current);

        markerInst.current.on('dragend', (e: any) => {
          const pos = e.target.getLatLng();
          onChange(pos.lat.toString(), pos.lng.toString());
        });

        mapInst.current.on('click', (e: any) => {
          markerInst.current.setLatLng(e.latlng);
          onChange(e.latlng.lat.toString(), e.latlng.lng.toString());
        });
      }
    });
  }, []);

  // Fungsi untuk mengambil GPS HP
  const getMyLocation = () => {
    if (!navigator.geolocation) {
      alert('Browser HP Anda tidak mendukung GPS');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        if (mapInst.current && markerInst.current) {
          mapInst.current.setView([latitude, longitude], 16); // 16 = Zoom lebih dekat
          markerInst.current.setLatLng([latitude, longitude]);
        }
        onChange(latitude.toString(), longitude.toString());
        setLocating(false);
      },
      (err) => {
        alert('Gagal mengambil lokasi. Pastikan izin akses Lokasi/GPS aktif di browser Anda.');
        setLocating(false);
      },
      { enableHighAccuracy: true } // Minta akurasi tertinggi dari HP
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-end">
        <p className="text-xs muted font-bold flex items-center gap-1"><Ic n="MapPin" size={14}/> Geser pin atau klik peta</p>
        <button type="button" onClick={getMyLocation} disabled={locating} className="btn ghost px-3 py-1.5 text-xs flex items-center gap-1">
          {locating ? '⏳ Melacak...' : '📍 Ambil GPS Saya'}
        </button>
      </div>
      <div ref={mapContainer} className="w-full h-48 rounded-[16px] border-[3px] map-theme overflow-hidden" style={{ borderColor: 'var(--ink)', zIndex: 1 }} />
    </div>
  );
};

/* ───────────────────────── Views ───────────────────────── */
const PayModal = ({ cat, onClose, onSubmit }: { cat: Cat; onClose: () => void; onSubmit: (d: NewDonation) => Promise<boolean> }) => {
  const [step, setStep] = useState(1);
  const [amount, setAmount] = useState('');
  const [name, setName] = useState('');
  const [rec, setRec] = useState<{ url: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const n = parseInt(amount || '0', 10);
  const ok = n >= 1000 && !!rec;
  return (
    <Modal onClose={onClose} label="Donasi QRIS">
      <div className="p-6">
        <h3 className="text-xl font-bold pr-10">Beri makan {cat.name} 🍗</h3>
        {step === 1 ? (
          <>
            <p className="muted text-sm mt-1">Scan QRIS, transfer nominal sesukamu. Tanpa login, tanpa ribet!</p>
            <div className="w-56 h-56 mx-auto my-4 p-2 bg-white card bnc">
               <img src="/QRIS_Meowcare_small.jpeg" alt="QRIS MeowCare" className="w-full h-full object-contain rounded-xl" />
            </div>
            <button className="btn go w-full py-3" onClick={() => setStep(2)}>Sudah transfer → isi bukti</button>
          </>
        ) : (
          <div className="space-y-3 mt-2">
            <div>
              <label className="text-sm font-bold">Nominal donasi (Rp)</label>
              <input className="input mt-1 text-lg" type="number" inputMode="numeric" min="1000" value={amount} onChange={e => setAmount(e.target.value)} />
              <div className="flex gap-2 flex-wrap mt-2">
                {[2000, 5000, 10000, 20000].map(v => <button key={v} className="chip" onClick={() => setAmount(String(v))}>{rp(v)}</button>)}
              </div>
            </div>
            <div>
              <label className="text-sm font-bold">Display Name (IG/TikTok)</label>
              <input className="input mt-1" placeholder="@usernamekamu" value={name} onChange={e => setName(e.target.value)} maxLength={30} />
            </div>
            <UploadField file={rec?.name} onFile={(url, nm) => setRec({ url, name: nm })} label="Upload bukti transfer" folder="receipts" />
            <button disabled={!ok || busy} className="btn go w-full py-3"
              onClick={async () => {
                if (!rec) return;
                setBusy(true);
                const sent = await onSubmit({ catId: cat.id, name: name.trim() || 'Anonim', amount: n, receipt: rec.url });
                setBusy(false);
                if (sent) onClose();
              }}>
              {busy ? 'Mengirim…' : 'Kirim bukti donasi 💌'}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
};

/* Reveals an element the first time it scrolls into view */
const useInView = <T extends HTMLElement>() => {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen] as const;
};

/* Turns a pasted YouTube / TikTok / Instagram link into an embeddable URL (known hosts only) */
const toEmbed = (raw: string): { src: string; vertical: boolean } | null => {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const safe = (x?: string | null) => (x && /^[\w-]+$/.test(x) ? x : null);
  const host = u.hostname.replace(/^(www\.|m\.)/, '');
  const parts = u.pathname.split('/').filter(Boolean);
  if (host === 'youtu.be') {
    const id = safe(parts[0]);
    if (id) return { src: `https://www.youtube-nocookie.com/embed/${id}`, vertical: false };
  }
  if (host === 'youtube.com') {
    const id = safe(u.searchParams.get('v') ?? (['shorts', 'embed', 'live'].includes(parts[0]) ? parts[1] : null));
    if (id) return { src: `https://www.youtube-nocookie.com/embed/${id}`, vertical: parts[0] === 'shorts' };
  }
  if (host === 'tiktok.com') {
    const i = parts.indexOf('video');
    const id = i >= 0 ? safe(parts[i + 1]) : null;
    if (id) return { src: `https://www.tiktok.com/embed/v2/${id}`, vertical: true };
  }
  if (host === 'instagram.com') {
    const i = parts.findIndex(x => ['p', 'reel', 'tv'].includes(x));
    const code = i >= 0 ? safe(parts[i + 1]) : null;
    if (code) return { src: `https://www.instagram.com/${parts[i]}/${code}/embed`, vertical: true };
  }
  return null;
};

const VideoEmbed = ({ url, title }: { url: string; title: string }) => {
  const embed = toEmbed(url);
  if (embed) {
    return (
      <div className={'video ' + (embed.vertical ? 'tall' : 'wide')}>
        <iframe src={embed.src} title={title} loading="lazy" allowFullScreen
          allow="encrypted-media; picture-in-picture; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin" />
      </div>
    );
  }
  // Unknown or short link: offer a plain link instead of an embed
  let href: string | null = null;
  try { const u = new URL(url); if (u.protocol === 'https:' || u.protocol === 'http:') href = u.href; } catch { /* invalid URL */ }
  return href
    ? <a href={href} target="_blank" rel="noopener noreferrer" className="btn ghost flex items-center justify-center gap-2 px-4 py-2.5 text-sm mt-4">▶ Tonton video ↗</a>
    : null;
};

const PhotoSlider = ({ photos, alt }: { photos: string[]; alt: string }) => {
  const track = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);
  const go = (i: number) => {
    const el = track.current;
    if (!el) return;
    const n = ((i % photos.length) + photos.length) % photos.length;
    el.scrollTo({ left: n * el.clientWidth, behavior: 'smooth' });
  };
  return (
    <div className="relative" style={{ marginTop: 14 }}>
      <div ref={track} className="slider" tabIndex={0} role="group" aria-roledescription="carousel" aria-label={'Foto ' + alt}
        onScroll={e => setIdx(Math.round(e.currentTarget.scrollLeft / (e.currentTarget.clientWidth || 1)))}>
        {photos.map((src, i) => (
          <div key={src + i} className="slide"><Photo src={src} alt={`${alt} ${i + 1} dari ${photos.length}`} /></div>
        ))}
      </div>
      <button type="button" className="btn ghost slider-btn" style={{ left: 8 }} aria-label="Foto sebelumnya" onClick={() => go(idx - 1)}><Ic n="ChevronLeft" size={18} /></button>
      <button type="button" className="btn ghost slider-btn" style={{ right: 8 }} aria-label="Foto berikutnya" onClick={() => go(idx + 1)}><Ic n="ChevronRight" size={18} /></button>
      <div className="slider-dots">
        {photos.map((_, i) => <button key={i} type="button" aria-label={`Ke foto ${i + 1}`} className={i === idx ? 'on' : ''} onClick={() => go(i)} />)}
      </div>
    </div>
  );
};

const ProfileModal = ({ cat, proofs, onClose, onFeed, onToast }: {
  cat: Cat; proofs: Proof[]; onClose: () => void; onFeed: () => void; onToast: (msg: string) => void;
}) => {
  const mine = proofs.filter(p => p.catId === cat.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const photos = [cat.photo, ...cat.gallery].filter(Boolean);

  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}?cat=${cat.id}`;
    const text = `Kenalan sama ${cat.name}, kucing jalanan di MeowCare! Yuk bantu kasih makan 🐱🍗`;
    try {
      if (navigator.share) {
        await navigator.share({ title: `${cat.name} di MeowCare`, text, url });
      } else {
        // Fallback for browsers without the Web Share API (e.g. desktop Firefox)
        await navigator.clipboard.writeText(`${text} ${url}`);
        onToast('Tautan profil disalin 📋');
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) onToast('Gagal membagikan profil');
    }
  };
  return (
    <Modal onClose={onClose} label={'Profil ' + cat.name}>
      <div className="p-6 pt-8">
        {photos.length > 1
          ? <PhotoSlider photos={photos} alt={cat.name} />
          : <div className="w-44 mx-auto"><CatFrame src={cat.photo} alt={cat.name} /></div>}
        {cat.videoUrl && <VideoEmbed url={cat.videoUrl} title={'Video ' + cat.name} />}
        <h3 className="text-2xl font-bold text-center mt-4">{cat.name}</h3>
        <p className="text-center muted text-sm">{cat.breed} · {cat.age}</p>
        <div className="flex gap-1.5 flex-wrap justify-center mt-2">{cat.traits.map(t => <span key={t} className="chip">{t}</span>)}</div>
        <div className="mt-5"><HungerBar cat={cat} /></div>
        <div className="flex gap-2 mt-4">
          <button className="btn go flex-1 py-3.5 text-lg flex items-center justify-center gap-2 pulse" onClick={onFeed}><Ic n="Heart" size={20} /> Beri Makan</button>
          <button className="btn ghost px-4 py-3.5 flex items-center justify-center gap-2" onClick={share} aria-label={'Bagikan profil ' + cat.name}><Ic n="Share2" size={18} /> Bagikan</button>
        </div>
        <h4 className="font-bold text-lg mt-7 mb-3 flex items-center gap-2"><Ic n="BookOpen" size={18} /> Buku Harian {cat.name}</h4>
        {mine.length === 0 ? (
          <p className="muted text-sm">Belum ada foto makan. Jadilah yang pertama! 🐾</p>
        ) : (
          <ol className="space-y-5 border-l-[3px] border-dashed pl-5" style={{ borderColor: 'var(--ink)' }}>
            {mine.map((p, i) => (
              <li key={p.id} className="relative">
                <span className="absolute -left-[31px] top-2 text-lg">🐾</span>
                <div className="flex gap-3 items-start">
                  <div className="polaroid w-24 shrink-0" style={{ transform: `rotate(${i % 2 ? 3 : -3}deg)` }}>
                    <div className="aspect-square overflow-hidden"><Photo src={p.photo} alt={'Bukti'} /></div>
                  </div>
                  <div>
                    <div className="text-xs font-bold" style={{ color: 'var(--a2)' }}>{p.createdAt.slice(0, 10)}</div>
                    <p className="text-sm">{p.note}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Modal>
  );
};

const CatCard = ({ cat, i, onOpen }: { cat: Cat; i: number; onOpen: () => void }) => {
  const p = pctOf(cat);
  const [ref, seen] = useInView<HTMLButtonElement>();
  return (
    <button ref={ref} onClick={onOpen}
      className={'card cat-card reveal p-4 pt-6 text-left flex flex-col' + (seen ? ' in' : '')}
      style={{ '--rot': ['-1deg', '1deg', '-0.5deg'][i % 3], '--delay': (i % 3) * 90 + 'ms' } as CSSProperties}>
      <div className="w-3/4 mx-auto"><CatFrame src={cat.photo} alt={cat.name} /></div>
      <div className="flex justify-between items-center mt-4 mb-1">
        <h3 className="font-bold text-lg">{cat.name}</h3>
        <span className="text-xs font-bold">{p >= 100 ? 'Siap makan 🍽️' : p + '%'}</span>
      </div>
      <p className="text-xs muted mb-2">{cat.breed} · {cat.age}</p>
      <div className="flex gap-1 flex-wrap mb-3">{cat.traits.slice(0, 2).map(t => <span key={t} className="chip">{t}</span>)}</div>
      <div className="mt-auto bar" style={{ height: 14 }}><div style={{ width: p + '%' }} /></div>
    </button>
  );
};

const LedgerTable = ({ entries, variant }: { entries: LedgerEntry[]; variant: 'admin' | 'public' }) => {
  const isAdmin = variant === 'admin';
  const heads = isAdmin ? ['Tanggal', 'Tipe', 'Kucing', 'Catatan / Donatur', 'Nominal'] : ['Tanggal', 'Keterangan', 'Nominal'];
  const amountText = (e: LedgerEntry) => e.type === 'in' ? '+' + rp(e.amount) : e.amount > 0 ? '−' + rp(e.amount) : 'tidak tercatat';
  return (
    <div className="card overflow-x-auto">
      <table className={'w-full text-sm ' + (isAdmin ? 'min-w-[620px]' : 'min-w-[420px]')}>
        <thead><tr className="text-left muted text-xs uppercase">{heads.map(x => <th key={x} className="px-4 py-3">{x}</th>)}</tr></thead>
        <tbody>
          {entries.length === 0 && <tr><td colSpan={heads.length} className="p-8 text-center muted">Belum ada transaksi.</td></tr>}
          {entries.map(e => (
            <tr key={e.id} className="border-t-2" style={{ borderColor: 'var(--soft)' }}>
              <td className="px-4 py-3 whitespace-nowrap">{e.date.slice(0, 10)}</td>
              {isAdmin ? (
                <>
                  <td className="px-4 py-3 whitespace-nowrap">{e.type === 'in' ? '🟢 Pemasukan' : '🔴 Pengeluaran'}</td>
                  <td className="px-4 py-3 font-bold">{e.catName}</td>
                  <td className="px-4 py-3">{e.label}</td>
                </>
              ) : (
                <td className="px-4 py-3">{e.type === 'in' ? '🟢' : '🔴'} <b>{e.catName}</b> · {e.label}</td>
              )}
              <td className="px-4 py-3 font-bold whitespace-nowrap" style={{ color: e.type === 'in' ? '#2f9e5f' : 'var(--a2)' }}>{amountText(e)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const PublicLedger = ({ entries }: { entries: LedgerEntry[] }) => {
  const [showAll, setShowAll] = useState(false);
  const totalIn = entries.filter(e => e.type === 'in').reduce((a, e) => a + e.amount, 0);
  const totalOut = entries.filter(e => e.type === 'out').reduce((a, e) => a + e.amount, 0);
  
  return (
    <section id="transaksi" className="max-w-5xl mx-auto px-5 py-8">
      <h2 className="text-2xl font-bold flex items-center gap-2 mb-2"><Ic n="Receipt" size={24} /> Buku Transaksi Terbuka</h2>
      <p className="muted text-sm mb-4">Semua uang masuk dan uang keluar, tercatat transparan.</p>
      
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="card p-3.5" style={{ background: 'var(--mint)' }}><div className="text-xs">Total masuk 🟢</div><div className="font-bold text-lg">{rp(totalIn)}</div></div>
        <div className="card p-3.5" style={{ background: 'var(--pink)' }}><div className="text-xs">Total keluar 🔴</div><div className="font-bold text-lg">{rp(totalOut)}</div></div>
      </div>
      
      {/* Hanya tampilkan 5 transaksi di halaman utama sebagai cuplikan */}
      <LedgerTable entries={entries.slice(0, 5)} variant="public" />
      
      {entries.length > 5 && (
        <button className="btn ghost w-full py-3 mt-4 text-sm font-bold" onClick={() => setShowAll(true)}>
          Lihat Semua Transaksi ({entries.length})
        </button>
      )}

      {/* Pop-up Modal untuk melihat semua transaksi yang bisa di-scroll dengan rapi */}
      {showAll && (
        <Modal onClose={() => setShowAll(false)} label="Semua Transaksi">
          <div className="p-6">
            <h3 className="text-xl font-bold mb-4 flex items-center gap-2"><Ic n="Receipt" size={20} /> Seluruh Riwayat Kas</h3>
            <LedgerTable entries={entries} variant="public" />
          </div>
        </Modal>
      )}
    </section>
  );
};

const LiveTicker = ({ entries }: { entries: LedgerEntry[] }) => {
  const items = useMemo(() => entries
    .filter(e => e.catName !== 'Kucing dihapus')
    .slice(0, 12) // entries are already newest first
    .map((e, i) => {
      if (e.type === 'out') return `🍗 Relawan baru saja memberi makan ${e.catName}`;
      const who = !e.label.trim() || /^anonim$/i.test(e.label.trim()) ? 'Seseorang' : e.label.trim();
      return `${i % 2 ? '❤️' : '🐾'} ${who} berdonasi ${rp(e.amount)} untuk ${e.catName}`;
    }), [entries]);
  if (items.length === 0) return null;
  // Repeat short lists so the ribbon always fills the screen; the track holds two identical halves for a seamless loop
  const half = Array.from({ length: Math.ceil(8 / items.length) }, () => items).flat();
  return (
    <div className="ticker" role="region" aria-label="Aktivitas terbaru">
      <div className="ticker-track" style={{ animationDuration: Math.max(24, half.length * 5) + 's' }}>
        {[0, 1].map(copy => (
          <div key={copy} className="ticker-half" aria-hidden={copy === 1}>
            {half.map((t, i) => <span key={i} className="ticker-item">{t}</span>)}
          </div>
        ))}
      </div>
    </div>
  );
};

const PublicView = ({ cats, donations, proofs, ledger, about, onOpen }: { cats: Cat[]; donations: Donation[]; proofs: Proof[]; ledger: LedgerEntry[]; about: string; onOpen: (id: ID) => void }) => {
  const board = useMemo(() => {
    const m: Record<string, { name: string; total: number; n: number }> = {};
    donations.filter(d => d.status === 'approved').forEach(d => {
        const k = d.name.trim().toLowerCase();
        if (!k || k === 'anonim') return;
        if (!m[k]) m[k] = { name: d.name.trim(), total: 0, n: 0 };
        m[k].total += d.amount; m[k].n++;
    });
    return Object.values(m).sort((a, b) => b.total - a.total).slice(0, 5);
  }, [donations]);
  const stats = useMemo(() => {
    const approved = donations.filter(d => d.status === 'approved');
    const named = new Set<string>();
    let anonymous = 0; // every anonymous donation counts as its own donor
    approved.forEach(d => {
      const k = d.name.trim().toLowerCase();
      if (!k || k === 'anonim') anonymous++; else named.add(k);
    });
    return { total: approved.reduce((a, d) => a + d.amount, 0), donors: named.size + anonymous, feeds: proofs.length };
  }, [donations, proofs]);

  return (
    <>
      <div className="max-w-5xl mx-auto px-5 pt-6">
        <div className="card px-4 py-2.5 text-sm text-center" style={{ background: 'var(--mint)' }}>
          🐾 Telah menyalurkan <b>{rp(stats.total)}</b> dari <b>{stats.donors}</b> donatur, dan memberi makan kucing sebanyak <b>{stats.feeds}</b> kali.{' '}
          <a href="#transaksi" style={{ textDecoration: 'underline' }}>Lihat buku transaksi</a>
        </div>
      </div>

      <LiveTicker entries={ledger} />

      <section className="max-w-5xl mx-auto px-5 pt-10 pb-6 grid md:grid-cols-2 gap-8 items-center">
        <div>
          <span className="chip">🐾 100% receh, 100% nyata</span>
          <h1 className="text-4xl sm:text-5xl font-bold leading-tight mt-3">Perut kenyang,<br />hati <span style={{ color: 'var(--a2)' }}>meong</span> senang.</h1>
          <p className="muted mt-4 max-w-md">Patungan receh buat kasih makan kucing jalanan. Tanpa login. Relawan kami kasih makan dan upload fotonya ke Buku Harian.</p>
          <div className="flex gap-3 mt-6 flex-wrap">
            <a href="#kucing" className="btn go px-6 py-3 bnc">Cari kucing lapar 🐱</a>
            <a href="#pahlawan" className="btn ghost px-6 py-3">Lihat Pahlawan 🏆</a>
            {about.trim() && <a href="#tentang" className="btn ghost px-6 py-3">Tentang Kami 💌</a>}
          </div>
        </div>
        <div className="relative max-w-xs mx-auto w-full">
          <CatFrame src={cats[0]?.photo} alt="Kucing MeowCare" />
          <span className="card absolute z-20 -bottom-4 -left-2 px-3 py-1.5 text-sm font-bold" style={{ transform: 'rotate(-6deg)', background: 'var(--pink)' }}>Halo Human yang Baik Hati</span>
        </div>
      </section>

      <section id="peta" className="max-w-5xl mx-auto px-5 py-8">
        <h2 className="text-2xl font-bold flex items-center gap-2 mb-4"><Ic n="MapPin" size={24} /> Peta Kucing MeowCare</h2>
        <PublicMap cats={cats} onOpen={onOpen} />
      </section>

      <section id="pahlawan" className="max-w-5xl mx-auto px-5 py-8">
        <h2 className="text-2xl font-bold flex items-center gap-2 mb-4"><Ic n="Trophy" size={24} /> Pahlawan Meow</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {board.length === 0 && <div className="card p-5 muted">Belum ada pahlawan. Jadi yang pertama!</div>}
          {board.map((b, i) => (
            <div key={b.name} className="card p-3.5 flex items-center gap-3" style={i === 0 ? { background: 'var(--pink)' } : undefined}>
              <div className="text-2xl w-9 text-center">{['🥇', '🥈', '🥉', '4', '5'][i]}</div>
              <div className="flex-1 min-w-0"><div className="font-bold truncate">{b.name}</div><div className="text-xs muted">{b.n} kali donasi</div></div>
              <div className="font-bold">{rp(b.total)}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="kucing" className="max-w-5xl mx-auto px-5 py-8">
        <h2 className="text-2xl font-bold mb-6">Kucing yang nunggu kamu</h2>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-5">
          {cats.map((c, i) => <CatCard key={c.id} cat={c} i={i} onOpen={() => onOpen(c.id)} />)}
        </div>
      </section>

      <PublicLedger entries={ledger} />

      {about.trim() && (
        <section id="tentang" className="max-w-5xl mx-auto px-5 py-8">
          <h2 className="text-2xl font-bold flex items-center gap-2 mb-4">💌 Tentang Kami</h2>
          <div className="card p-5 sm:p-6" style={{ background: 'var(--soft)' }}>
            <p style={{ whiteSpace: 'pre-line', lineHeight: 1.7 }}>{about}</p>
          </div>
        </section>
      )}
    </>
  );
};

/* ───────────────────────── Admin ───────────────────────── */
const FeedForm = ({ cat, onClose, onFeed }: {
  cat: Cat; onClose: () => void; onFeed: (catId: ID, photo: string, note: string, cost: number) => void;
}) => {
  const [photo, setPhoto] = useState('');
  const [picked, setPicked] = useState('');
  const [note, setNote] = useState('');
  const [cost, setCost] = useState('');
  const costNum = Number(cost);
  const overspend = costNum > cat.currentRaised;
  const ok = !!photo && !!note.trim() && costNum > 0 && !overspend;
  return (
    <Modal onClose={onClose} label={"Beri makan " + cat.name}>
      <div className="p-6 space-y-3">
        <h3 className="text-xl font-bold pr-10">Upload Bukti Makan 🍗</h3>
        <p className="text-sm muted mb-4">Uang terkumpul: {rp(cat.currentRaised)}. Upload foto saat relawan memberi makan {cat.name}.</p>
        <UploadField file={picked} onFile={(url, nm) => { setPhoto(url); setPicked(nm); }} label="Pilih foto bukti makan" icon="Camera" folder="proofs" />
        <div>
          <label className="text-sm font-bold">Biaya Makanan (Rp)</label>
          <input className="input mt-1" type="number" inputMode="numeric" min="1" max={cat.currentRaised} placeholder="Misal: 15000" value={cost} onChange={e => setCost(e.target.value)} />
          <p className="text-xs muted mt-1">Tip: Jika membeli makanan secara grosir, cukup masukkan perkiraan harga per porsi makan kali ini.</p>
          {overspend && <p className="text-xs mt-1 font-bold" style={{ color: 'var(--a2)' }}>Biaya melebihi dana terkumpul ({rp(cat.currentRaised)}). Kurangi nominalnya.</p>}
          {costNum > 0 && !overspend && <p className="text-xs muted mt-1">Sisa dana setelah dipotong: {rp(cat.currentRaised - costNum)}</p>}
        </div>
        <textarea className="input min-h-[100px] mt-2" placeholder="Catatan (Misal: Bobby makannya lahap banget hari ini!)" value={note} onChange={e => setNote(e.target.value)} />
        <button disabled={!ok} className="btn go w-full py-3 mt-2"
          onClick={() => { onFeed(cat.id, photo, note.trim(), costNum); onClose(); }}>
          Simpan ke Buku Harian
        </button>
      </div>
    </Modal>
  );
};

const CatForm = ({ cat, onClose, onSave }: { cat: Cat | null; onClose: () => void; onSave: (c: CatPayload) => void }) => {
  const [f, setF] = useState(
    cat
      ? { name: cat.name, breed: cat.breed, age: cat.age, traits: cat.traits.join(', '), targetAmount: String(cat.targetAmount), photo: cat.photo, lat: String(cat.lat||''), lng: String(cat.lng||''), videoUrl: cat.videoUrl }
      : { name: '', breed: '', age: '', traits: '', targetAmount: '20000', photo: '', lat: '', lng: '', videoUrl: '' },
  );
  const [gallery, setGallery] = useState<string[]>(cat?.gallery ?? []);
  const [picked, setPicked] = useState('');
  const set = (k: keyof typeof f, v: string) => setF(s => ({ ...s, [k]: v }));
  const ok = f.name.trim() && Number(f.targetAmount) > 0;
  const room = MAX_GALLERY - gallery.length;
  const videoUrl = f.videoUrl.trim();
  return (
    <Modal onClose={onClose} label="Form kucing">
      <div className="p-6 space-y-3">
        <h3 className="text-xl font-bold pr-10">{cat ? 'Edit' : 'Tambah'} kucing</h3>
        <div className="w-28 mx-auto"><CatFrame src={f.photo} alt="Preview" /></div>
        <input className="input" placeholder="Nama" value={f.name} onChange={e => set('name', e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <input className="input" placeholder="Ras" value={f.breed} onChange={e => set('breed', e.target.value)} />
          <input className="input" placeholder="Umur (2 tahun)" value={f.age} onChange={e => set('age', e.target.value)} />
        </div>
        <input className="input" placeholder="Sifat, pisah koma (Manja, Preman)" value={f.traits} onChange={e => set('traits', e.target.value)} />
        <input className="input" type="number" min="1000" placeholder="Target (Rp)" value={f.targetAmount} onChange={e => set('targetAmount', e.target.value)} />
        <LocationPicker lat={f.lat} lng={f.lng} onChange={(lat, lng) => { set('lat', lat); set('lng', lng); }} />
        <UploadField file={picked} onFile={(url, nm) => { set('photo', url); setPicked(nm); }} label="Pilih foto profil kucing" icon="Camera" folder="cats" />

        <div>
          <div className="text-sm font-bold mb-1">Galeri foto tambahan ({gallery.length}/{MAX_GALLERY})</div>
          {gallery.length > 0 && (
            <div className="thumbs mb-2">
              {gallery.map((src, i) => (
                <div key={src} className="thumb">
                  <Photo src={src} alt={`Foto galeri ${i + 1}`} />
                  <button type="button" className="btn no thumb-x" aria-label={`Hapus foto galeri ${i + 1}`}
                    onClick={() => setGallery(g => g.filter((_, j) => j !== i))}><Ic n="X" size={12} /></button>
                </div>
              ))}
            </div>
          )}
          <UploadField multiple limit={room} onFile={url => setGallery(g => [...g, url])} folder="gallery" icon="Camera"
            label={room > 0 ? 'Tambah foto galeri (bisa pilih banyak)' : 'Galeri penuh'} />
        </div>

        <div>
          <input className="input" type="url" placeholder="Link video (YouTube / TikTok / Instagram)" value={f.videoUrl} onChange={e => set('videoUrl', e.target.value)} />
          <p className="text-xs muted mt-1">Tempel link video biasa. Link pendek seperti vm.tiktok.com tidak bisa disematkan.</p>
          {videoUrl && !toEmbed(videoUrl) && <p className="text-xs mt-1 font-bold" style={{ color: 'var(--a2)' }}>Link tidak dikenali, video akan tampil sebagai tombol Tonton video.</p>}
        </div>

        <button disabled={!ok} className="btn go w-full py-3"
          onClick={() => {
            onSave({
              id: cat?.id, name: f.name.trim(), breed: f.breed.trim(), age: f.age.trim(),
              traits: f.traits.split(',').map(t => t.trim()).filter(Boolean),
              targetAmount: Number(f.targetAmount), photo: f.photo,
              lat: f.lat ? Number(f.lat) : null, lng: f.lng ? Number(f.lng) : null,
              gallery, videoUrl,
            });
            onClose();
          }}>Simpan Kucing</button>
      </div>
    </Modal>
  );
};

const SettingsPanel = ({ about, onSave }: { about: string; onSave: (text: string) => Promise<void> }) => {
  const [text, setText] = useState(about);
  const [busy, setBusy] = useState(false);
  useEffect(() => setText(about), [about]);
  const dirty = text.trim() !== about.trim();
  return (
    <div className="card p-5 space-y-3 max-w-2xl">
      <h3 className="text-xl font-bold">Tentang Kami 💌</h3>
      <p className="text-sm muted">Teks ini tampil di halaman publik pada bagian &quot;Tentang Kami&quot;. Baris baru dipertahankan. Kosongkan untuk menyembunyikan bagian tersebut.</p>
      <textarea className="input min-h-[180px]" maxLength={2000} placeholder="Ceritakan kisah atau misi MeowCare…" value={text} onChange={e => setText(e.target.value)} />
      <div className="text-xs muted text-right">{text.length}/2000</div>
      <button className="btn go w-full py-3" disabled={busy || !dirty}
        onClick={async () => { setBusy(true); await onSave(text.trim()); setBusy(false); }}>
        {busy ? 'Menyimpan…' : 'Simpan Perubahan'}
      </button>
    </div>
  );
};

const Admin = ({ cats, donations, ledger, about, h }: { cats: Cat[]; donations: Donation[]; ledger: LedgerEntry[]; about: string; h: Handlers }) => {
  const [tab, setTab] = useState<'verify' | 'cats' | 'feed' | 'ledger' | 'settings'>('verify');
  const [form, setForm] = useState<{ cat: Cat | null } | null>(null);
  const [feedForm, setFeedForm] = useState<{ cat: Cat } | null>(null);
  const pending = donations.filter(d => d.status === 'pending');
  return (
    <div className="max-w-5xl mx-auto px-5 py-8">
      <div className="flex gap-2 flex-wrap mb-6">
        <button onClick={() => setTab('verify')} className={'btn px-4 py-2 text-sm ' + (tab === 'verify' ? 'go' : 'ghost')}>Verifikasi ({pending.length})</button>
        <button onClick={() => setTab('cats')} className={'btn px-4 py-2 text-sm ' + (tab === 'cats' ? 'go' : 'ghost')}>Kucing ({cats.length})</button>
        <button onClick={() => setTab('feed')} className={'btn px-4 py-2 text-sm ' + (tab === 'feed' ? 'go' : 'ghost')}>Bukti Makan</button>
        <button onClick={() => setTab('ledger')} className={'btn px-4 py-2 text-sm ' + (tab === 'ledger' ? 'go' : 'ghost')}>Buku Kas</button>
        <button onClick={() => setTab('settings')} className={'btn px-4 py-2 text-sm ' + (tab === 'settings' ? 'go' : 'ghost')}>Pengaturan</button>
      </div>

      {tab === 'verify' && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[620px]">
            <thead><tr className="text-left muted text-xs uppercase">{['Donatur', 'Kucing', 'Nominal', 'Bukti', 'Aksi'].map(x => <th key={x} className="px-4 py-3">{x}</th>)}</tr></thead>
            <tbody>
              {pending.length === 0 && <tr><td colSpan={5} className="p-8 text-center muted">Semua donasi sudah dicek 🎉</td></tr>}
              {pending.map(d => (
                <tr key={d.id} className="border-t-2" style={{ borderColor: 'var(--soft)' }}>
                  <td className="px-4 py-3 font-bold">{d.name}</td>
                  <td className="px-4 py-3">{cats.find(x => x.id === d.catId)?.name || 'Kucing dihapus'}</td>
                  <td className="px-4 py-3 font-bold">{rp(d.amount)}</td>
                  <td className="px-4 py-3">
                    {d.receipt ? <a href={d.receipt} target="_blank" rel="noreferrer"><img src={d.receipt} alt="Bukti" className="w-9 h-9 object-cover rounded-lg border-2 border-[var(--ink)]" /></a> : '-'}
                  </td>
                  <td className="px-4 py-3 flex gap-2">
                    <button className="btn ok px-3 py-1.5 flex items-center gap-1" onClick={() => h.approve(d)}><Ic n="Check" size={14} />Approve</button>
                    <button className="btn no px-3 py-1.5" onClick={() => h.reject(d)}><Ic n="X" size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'cats' && (
        <div>
          <button className="btn go px-5 py-2.5 mb-4 flex items-center gap-2" onClick={() => setForm({ cat: null })}><Ic n="Plus" size={16} />Tambah Kucing</button>
          <div className="grid sm:grid-cols-2 gap-4">
            {cats.map(c => (
              <div key={c.id} className="card p-3 flex gap-3 items-center" style={c.isActive ? undefined : { opacity: 0.65 }}>
                <div className="w-16 shrink-0"><CatFrame src={c.photo} alt={c.name} /></div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold">{c.name}{!c.isActive && <span className="chip ml-2">nonaktif</span>}</div>
                  <div className="text-xs muted truncate">{c.lat ? '📍 Ada koordinat' : 'Belum ada koordinat'}</div>
                  <div className="text-xs">{rp(c.currentRaised)} / {rp(c.targetAmount)}</div>
                </div>
                <div className="flex gap-1 items-center">
                  {/* Tombol Edit */}
                  <button className="btn ghost px-2.5 py-2" title="Edit" onClick={() => setForm({ cat: c })}><Ic n="Pencil" size={15} /></button>
                  {/* Tombol Sembunyikan / Tampilkan (Hide/Unhide) */}
                  <button className="btn ghost px-2.5 py-2" title={c.isActive ? 'Sembunyikan' : 'Aktifkan'} onClick={() => h.setActive(c.id, !c.isActive)}>
                    <Ic n={c.isActive ? 'EyeOff' : 'Check'} size={15} />
                  </button>
                  {/* Tombol Hapus */}
                  <button className="btn no px-2.5 py-2" title="Hapus" onClick={() => h.removeCat(c.id)}><Ic n="X" size={15} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'feed' && (
        <div>
          <p className="muted text-sm mb-4">Kucing dengan dana terkumpul. Klik icon kamera untuk upload bukti makan.</p>
          <div className="grid sm:grid-cols-2 gap-4">
            {cats.filter(c => c.currentRaised > 0).map(c => (
              <div key={c.id} className="card p-3 flex gap-3 items-center">
                <div className="w-16 shrink-0"><CatFrame src={c.photo} alt={c.name} /></div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold">{c.name}</div>
                  <div className="text-sm font-bold text-[var(--a2)]">Terkumpul: {rp(c.currentRaised)}</div>
                </div>
                <button className="btn ok px-3 py-2 flex items-center gap-1" onClick={() => setFeedForm({ cat: c })}>
                  <Ic n="Camera" size={16} /> Upload
                </button>
              </div>
            ))}
            {cats.filter(c => c.currentRaised > 0).length === 0 && (
              <div className="col-span-full p-8 text-center muted border-2 border-dashed border-[var(--ink)] rounded-2xl">
                Belum ada kucing yang memiliki dana donasi.
              </div>
            )}
          </div>
        </div>
      )}
      {tab === 'ledger' && (
        <div>
          <p className="muted text-sm mb-4">Riwayat uang masuk (donasi disetujui) dan uang keluar (biaya makan), terbaru di atas.</p>
          <LedgerTable entries={ledger} variant="admin" />
        </div>
      )}

      {tab === 'settings' && <SettingsPanel about={about} onSave={h.saveAbout} />}

      {form && <CatForm cat={form.cat} onClose={() => setForm(null)} onSave={h.save} />}
      {feedForm && <FeedForm cat={feedForm.cat} onClose={() => setFeedForm(null)} onFeed={h.fed} />}
    </div>
  );
};

/* ───────────────────────── Main App ───────────────────────── */
const Login = () => {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
    setBusy(false);
    if (error) { setErr(error.message); setPw(''); setShake(s => s + 1); }
  };
  return (
    <div className="max-w-sm mx-auto px-5 py-16">
      <div key={shake} className={'card p-6 text-center ' + (shake ? 'shake' : '')}>
        <div className="text-5xl bnc">🔐</div>
        <h2 className="text-xl font-bold mt-2">Area Admin</h2>
        <p className="text-sm muted mb-4">Khusus relawan & pengelola MeowCare.</p>
        <input className="input mb-2" type="email" placeholder="Email admin" value={email} onChange={e => setEmail(e.target.value)} />
        <input className="input" type="password" placeholder="Password" value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} />
        {err && <p className="text-sm mt-2 font-bold" style={{ color: 'var(--a2)' }}>{err}</p>}
        <button className="btn go w-full py-3 mt-4" disabled={busy || !email || !pw} onClick={go}>{busy ? 'Masuk…' : 'Masuk'}</button>
      </div>
    </div>
  );
};

const Header = ({ view, auth, theme, onToggleTheme, onView, onLogout }: {
  view: 'public' | 'admin'; auth: boolean; theme: Theme;
  onToggleTheme: () => void; onView: (v: 'public' | 'admin') => void; onLogout: () => void;
}) => {
  const label = theme === 'dark' ? 'Aktifkan mode terang' : 'Aktifkan mode gelap';
  return (
    <header className="sticky z-40 border-b-[3px]" style={{ top: 'env(safe-area-inset-top,0px)', background: 'var(--card)', borderColor: 'var(--ink)' }}>
      <div className="max-w-5xl mx-auto px-5 py-2.5 flex items-center justify-between">
        <button onClick={() => onView('public')} className="font-bold text-2xl flex items-center gap-1.5">🐾 Meow<span style={{ color: 'var(--a2)' }}>Care</span></button>
        <div className="flex gap-2 items-center">
          <button className="btn ghost w-9 h-9 flex items-center justify-center" onClick={onToggleTheme} aria-label={label} title={label}>
            <Ic n={theme === 'dark' ? 'Sun' : 'Moon'} size={16} />
          </button>
          {view === 'admin' && auth && <button className="btn ghost px-3 py-1 text-sm flex items-center gap-1" onClick={onLogout}><Ic n="LogOut" size={14} />Keluar</button>}
          <button className="btn ghost px-3 py-1.5 text-sm flex items-center gap-1" onClick={() => onView(view === 'public' ? 'admin' : 'public')}>{view === 'public' ? <><Ic n="Lock" size={14} />Admin</> : '← Publik'}</button>
        </div>
      </div>
    </header>
  );
};

export default function Page() {
  const [view, setView] = useState<'public' | 'admin'>('public');
  const [auth, setAuth] = useState(false);
  const [cats, setCats] = useState<Cat[]>([]);
  const [donations, setDonations] = useState<Donation[]>([]);
  const [proofs, setProofs] = useState<Proof[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<ID | null>(null);
  const [payId, setPayId] = useState<ID | null>(null);
  const [toast, setToast] = useState('');
  const [about, setAbout] = useState(DEFAULT_ABOUT);
  const [userEmail, setUserEmail] = useState('');
  const [theme, setTheme] = useState<Theme>('light');
  const deepLinked = useRef(false);

  const refresh = useCallback(async () => {
    const [c, d, p, st] = await Promise.all([
      supabase.from('cats').select('*').order('id', { ascending: true }),
      supabase.from('donations').select('*').order('created_at', { ascending: false }),
      supabase.from('proofs').select('id, cat_id, photo_url, note, cost, created_at').order('created_at', { ascending: false }),
      supabase.from('site_settings').select('value').eq('key', ABOUT_KEY).maybeSingle(),
    ]);
    if (!c.error && !d.error && !p.error) {
      setCats((c.data ?? []).map(toCat));
      setDonations((d.data ?? []).map(toDonation));
      setProofs((p.data ?? []).map(toProof));
    }
    // Settings are optional: if the table is missing or empty, keep the default text
    if (!st.error && st.data) setAbout(String(st.data.value ?? ''));
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAuth(!!data.session);
      setUserEmail(data.session?.user.email ?? '');
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setAuth(!!session);
      setUserEmail(session?.user.email ?? '');
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => { refresh().finally(() => setLoading(false)); }, [refresh, auth]);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 3000); return () => clearTimeout(t); } }, [toast]);

  /* Prime the SFX on the first user gesture (needed by iOS Safari / autoplay policies) */
  useEffect(() => {
    const events = ['click', 'touchend', 'keydown'] as const;
    const once = () => { unlockSfx(); events.forEach(e => window.removeEventListener(e, once)); };
    events.forEach(e => window.addEventListener(e, once));
    return () => events.forEach(e => window.removeEventListener(e, once));
  }, []);

  /* Opening a profile from a tap meows; the ?cat= deep link above uses setOpenId directly, so it stays silent */
  const openProfile = useCallback((id: ID) => { playSfx('meow'); setOpenId(id); }, []);

  /* Theme: restore saved choice (or system preference) and set data-theme on <html> */
  const applyTheme = (t: Theme) => document.documentElement.setAttribute('data-theme', t);
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch { /* storage unavailable */ }
    const initial: Theme = saved === 'dark' || saved === 'light'
      ? saved
      : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    setTheme(initial);
    applyTheme(initial);
  }, []);
  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* storage unavailable */ }
  };

  /* Shared links (?cat=ID) open that cat's profile once data has loaded */
  useEffect(() => {
    if (loading || deepLinked.current) return;
    deepLinked.current = true;
    const id = new URLSearchParams(window.location.search).get('cat');
    if (id && cats.some(c => String(c.id) === id && c.isActive)) setOpenId(id);
  }, [loading, cats]);

  const h: Handlers = {
    approve: async d => {
      const cat = cats.find(c => c.id === d.catId);
      if (!cat) return;
      const { error } = await supabase.from('donations').update({ status: 'approved' }).eq('id', d.id);
      if (error) { console.error(error); setToast('Gagal menyetujui donasi ❌'); return; }
      await supabase.from('cats').update({ current_raised: cat.currentRaised + d.amount }).eq('id', cat.id);
      playSfx('coin');
      setToast('Donasi disetujui ✅'); await refresh();
    },
    reject: async d => { await supabase.from('donations').update({ status: 'rejected' }).eq('id', d.id); await refresh(); },
    fed: async (id, photo, note, cost) => {
      const cat = cats.find(c => c.id === id);
      if (!cat) return;
      if (cost > cat.currentRaised) { setToast('Biaya melebihi dana terkumpul ❌'); return; }
      const { error } = await supabase.from('proofs').insert({ cat_id: id, photo_url: photo, note, cost, fed_by: userEmail || null });
      if (error) { console.error(error); setToast('Gagal menyimpan bukti makan ❌'); return; }
      await supabase.from('cats').update({ current_raised: Math.max(0, cat.currentRaised - cost) }).eq('id', id);
      playSfx('meow');
      setToast('Kucing sudah diberi makan 📖'); await refresh();
    },
    save: async c => {
      const row = {
        name: c.name, breed: c.breed, age: c.age, traits: c.traits, photo_url: c.photo, target_amount: c.targetAmount,
        lat: c.lat, lng: c.lng, gallery: c.gallery, video_url: c.videoUrl || null,
      };
      const { error } = c.id
        ? await supabase.from('cats').update(row).eq('id', c.id)
        : await supabase.from('cats').insert({ ...row, current_raised: 0, is_active: true });
      if (error) { console.error(error); setToast('Gagal menyimpan data kucing ❌'); return; }
      setToast('Data kucing disimpan 🐱'); await refresh();
    },
    setActive: async (id, active) => { await supabase.from('cats').update({ is_active: active }).eq('id', id); await refresh(); },
    saveAbout: async text => {
      const { error } = await supabase.from('site_settings').upsert(
        { key: ABOUT_KEY, value: text, updated_at: new Date().toISOString() },
        { onConflict: 'key' },
      );
      if (error) { console.error(error); setToast('Gagal menyimpan Tentang Kami ❌'); return; }
      setAbout(text); setToast('Tentang Kami diperbarui 💌');
    },
    removeCat: async id => {
      if (!confirm('Yakin ingin menghapus kucing ini secara permanen?')) return;
      await supabase.from('cats').delete().eq('id', id);
      setToast('Kucing berhasil dihapus 🗑️'); await refresh();
    },
  };

  const submit = async (d: NewDonation) => {
    const { error } = await supabase.from('donations').insert({ cat_id: d.catId, display_name: d.name, amount: d.amount, receipt_url: d.receipt, status: 'pending' });
    if (error) { console.error(error); setToast('Gagal mengirim bukti donasi ❌'); return false; }
    playSfx('coin');
    setToast('Bukti dikirim! Menunggu admin mengecek 💌');
    if (auth) await refresh(); return true;
  };

  const ledger = useMemo(() => buildLedger(cats, donations, proofs), [cats, donations, proofs]);
  const openCat = cats.find(c => String(c.id) === String(openId));
  const payCat = cats.find(c => String(c.id) === String(payId));

  return (
    <div className="min-h-screen relative">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <Header
        view={view} auth={auth} theme={theme} onToggleTheme={toggleTheme} onView={setView}
        onLogout={() => { supabase.auth.signOut(); setView('public'); }}
      />

      {/* PERBAIKAN Z-INDEX (z-20) AGAR TIDAK TUMPANG TINDIH DENGAN FOOTER */}
      <main className="relative z-20">
        {loading ? (
          <div className="text-center py-24 muted font-bold">Memuat data… 🐾</div>
        ) : view === 'public' ? (
          <PublicView cats={cats.filter(c => c.isActive)} donations={donations} proofs={proofs} ledger={ledger} about={about} onOpen={openProfile} />
        ) : auth ? (
          <Admin cats={cats} donations={donations} ledger={ledger} about={about} h={h} />
        ) : (
          <Login />
        )}
      </main>

      <footer className="relative z-10 text-center text-xs muted py-8">Dibuat dengan 🧡 untuk kucing jalanan</footer>

      {openCat && <ProfileModal cat={openCat} proofs={proofs} onClose={() => setOpenId(null)} onFeed={() => setPayId(openCat.id)} onToast={setToast} />}
      {payCat && <PayModal cat={payCat} onClose={() => setPayId(null)} onSubmit={submit} />}
      {toast && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] pop btn go px-5 py-3 text-sm whitespace-nowrap">{toast}</div>}
    </div>
  );
}