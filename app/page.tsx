"use client";
/* eslint-disable @next/next/no-img-element, @typescript-eslint/no-explicit-any */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  Heart, X, Check, Camera, Receipt, Trophy, BookOpen, Plus, Pencil, EyeOff, LogOut, Lock,
  Upload as UploadIcon, MapPin
} from 'lucide-react';

/* ───────────────────────── Supabase ───────────────────────── */
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);
const BUCKET = 'meowcare';

/* ───────────────────────── Types ───────────────────────── */
type ID = string | number;
type Row = Record<string, any>;
type DonationStatus = 'pending' | 'approved' | 'rejected';

interface Cat {
  id: ID; name: string; breed: string; age: string; traits: string[];
  photo: string; targetAmount: number; currentRaised: number; isActive: boolean;
  lat: number | null; lng: number | null;
}
interface Donation {
  id: ID; catId: ID; name: string; amount: number; status: DonationStatus;
  receipt: string | null; createdAt: string;
}
interface Proof { id: ID; catId: ID; photo: string; note: string; createdAt: string }
interface CatPayload {
  id?: ID; name: string; breed: string; age: string; traits: string[]; targetAmount: number; photo: string;
  lat: number | null; lng: number | null;
}
interface NewDonation { catId: ID; name: string; amount: number; receipt: string }
interface Handlers {
  approve(d: Donation): Promise<void>;
  reject(d: Donation): Promise<void>;
  fed(catId: ID, photo: string, note: string): Promise<void>;
  save(c: CatPayload): Promise<void>;
  setActive(id: ID, active: boolean): Promise<void>;
}

/* DB row → UI model */
const toCat = (r: Row): Cat => ({
  id: r.id, name: r.name, breed: r.breed ?? '', age: r.age ?? '', traits: r.traits ?? [],
  photo: r.photo_url ?? '', targetAmount: Number(r.target_amount), currentRaised: Number(r.current_raised),
  isActive: r.is_active !== false,
  lat: r.lat ? Number(r.lat) : null, lng: r.lng ? Number(r.lng) : null,
});
const toDonation = (r: Row): Donation => ({
  id: r.id, catId: r.cat_id, name: r.display_name ?? 'Anonim', amount: Number(r.amount),
  status: r.status, receipt: r.receipt_url ?? null, createdAt: r.created_at,
});
const toProof = (r: Row): Proof => ({
  id: r.id, catId: r.cat_id, photo: r.photo_url ?? '', note: r.note ?? '', createdAt: r.created_at,
});

/* ───────────────────────── Helpers ───────────────────────── */
const rp = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
const pctOf = (c: Cat) => Math.min(100, Math.round((c.currentRaised / c.targetAmount) * 100));

async function uploadImage(file: File, folder: string): Promise<string> {
  if (file.size > 5 * 1024 * 1024) throw new Error('Ukuran foto maksimal 5 MB');
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type });
  if (error) throw error;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/* ───────────────────────── Icons ───────────────────────── */
const ICONS = { Heart, X, Check, Camera, Receipt, Trophy, BookOpen, Plus, Pencil, EyeOff, LogOut, Lock, Upload: UploadIcon, MapPin };
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
@media (prefers-color-scheme:dark){ .map-theme .leaflet-tile-pane { filter: invert(0.9) hue-rotate(180deg) brightness(0.8) contrast(1.2) sepia(0.2); } }
.leaflet-popup-content-wrapper, .leaflet-popup-tip { background: var(--card) !important; border: 2.5px solid var(--ink); color: var(--ink) !important; box-shadow: 4px 4px 0 var(--ink) !important; border-radius: 16px !important; }
.leaflet-popup-tip { border-top: none; border-left: none; box-shadow: none !important; }

@keyframes fl{0%,100%{transform:translateY(0) rotate(-8deg)}50%{transform:translateY(-28px) rotate(10deg)}}
@keyframes bounce{0%,100%{transform:translateY(0)}40%{transform:translateY(-8px)}60%{transform:translateY(-3px)}}
.bnc{animation:bounce 2s ease-in-out infinite}
@keyframes pop{from{transform:scale(.92) translateY(14px);opacity:0}to{transform:none;opacity:1}} .pop{animation:pop .25s ease-out}
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
  return (
    <div>
      <div className="flex justify-between font-bold text-sm mb-1.5">
        <span>Hunger Bar {p >= 100 ? '😻' : p >= 50 ? '😺' : '🥺'}</span><span>{p}%</span>
      </div>
      <div className="bar" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}>
        <div style={{ width: p + '%' }} />
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

const UploadField = ({ file, onFile, label, folder, icon = 'Upload' }: {
  file?: string | null; onFile: (url: string, name: string) => void; label: string; folder: string; icon?: IconName;
}) => {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <div>
      <label className="btn ghost flex items-center justify-center gap-2 px-4 py-2.5 text-sm" style={{ borderStyle: 'dashed' }}>
        <Ic n={icon} size={16} />
        <span className="truncate">{busy ? 'Mengunggah…' : file ? '✓ ' + file : label}</span>
        <input type="file" accept="image/*" className="hidden" disabled={busy}
          onChange={async e => {
            const f = e.target.files?.[0];
            if (!f) return;
            setBusy(true); setErr('');
            try { onFile(await uploadImage(f, folder), f.name); }
            catch (ex) { setErr(ex instanceof Error ? ex.message : 'Upload gagal'); }
            finally { setBusy(false); }
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
        mapInst.current = L.map(mapContainer.current).setView([-6.200000, 106.816666], 11); // Area default
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

  useEffect(() => {
    if (typeof window === 'undefined' || !mapContainer.current) return;
    import('leaflet').then((leaflet) => {
      const L = leaflet.default || leaflet;
      const initialLat = lat ? parseFloat(lat) : -6.200000;
      const initialLng = lng ? parseFloat(lng) : 106.816666;

      if (!mapInst.current) {
        mapInst.current = L.map(mapContainer.current).setView([initialLat, initialLng], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapInst.current);

        const icon = L.divIcon({
            className: 'custom-pin',
            html: `<div style="font-size:36px; filter: drop-shadow(2px 4px 0 var(--ink));">📍</div>`,
            iconSize: [36, 36], iconAnchor: [18, 36]
        });

        markerInst.current = L.marker([initialLat, initialLng], { icon, draggable: true }).addTo(mapInst.current);

        // Jika pin digeser
        markerInst.current.on('dragend', (e: any) => {
          const pos = e.target.getLatLng();
          onChange(pos.lat.toString(), pos.lng.toString());
        });

        // Jika peta diklik
        mapInst.current.on('click', (e: any) => {
          markerInst.current.setLatLng(e.latlng);
          onChange(e.latlng.lat.toString(), e.latlng.lng.toString());
        });
      }
    });
  }, []); // Mount sekali saja

  return (
    <div>
      <p className="text-xs muted mb-1 font-bold flex items-center gap-1"><Ic n="MapPin" size={14}/> Geser pin atau klik peta untuk atur lokasi</p>
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

const ProfileModal = ({ cat, proofs, onClose, onFeed }: { cat: Cat; proofs: Proof[]; onClose: () => void; onFeed: () => void }) => {
  const mine = proofs.filter(p => p.catId === cat.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <Modal onClose={onClose} label={'Profil ' + cat.name}>
      <div className="p-6 pt-8">
        <div className="w-44 mx-auto"><CatFrame src={cat.photo} alt={cat.name} /></div>
        <h3 className="text-2xl font-bold text-center mt-4">{cat.name}</h3>
        <p className="text-center muted text-sm">{cat.breed} · {cat.age}</p>
        <div className="flex gap-1.5 flex-wrap justify-center mt-2">{cat.traits.map(t => <span key={t} className="chip">{t}</span>)}</div>
        <div className="mt-5"><HungerBar cat={cat} /></div>
        <button className="btn go w-full py-3.5 mt-4 text-lg flex items-center justify-center gap-2" onClick={onFeed}><Ic n="Heart" size={20} /> Beri Makan</button>
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
  return (
    <button onClick={onOpen} className="card p-4 pt-6 text-left transition hover:-translate-y-1 flex flex-col" style={{ transform: `rotate(${[-1, 1, -0.5][i % 3]}deg)` }}>
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

const PublicView = ({ cats, donations, proofs, onOpen }: { cats: Cat[]; donations: Donation[]; proofs: Proof[]; onOpen: (id: ID) => void }) => {
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
  const total = donations.filter(d => d.status === 'approved').reduce((a, d) => a + d.amount, 0);

  return (
    <>
      <section className="max-w-5xl mx-auto px-5 pt-10 pb-6 grid md:grid-cols-2 gap-8 items-center">
        <div>
          <span className="chip">🐾 100% receh, 100% nyata</span>
          <h1 className="text-4xl sm:text-5xl font-bold leading-tight mt-3">Perut kenyang,<br />hati <span style={{ color: 'var(--a2)' }}>meong</span> senang.</h1>
          <p className="muted mt-4 max-w-md">Patungan receh buat kasih makan kucing jalanan. Tanpa login. Setiap bar penuh, relawan kami kasih makan dan upload fotonya ke Buku Harian.</p>
          <div className="flex gap-3 mt-6 flex-wrap">
            <a href="#kucing" className="btn go px-6 py-3 bnc">Cari kucing lapar 🐱</a>
            <a href="#pahlawan" className="btn ghost px-6 py-3">Lihat Pahlawan 🏆</a>
          </div>
        </div>
        <div className="relative max-w-xs mx-auto w-full">
          <CatFrame src={cats[0]?.photo} alt="Kucing MeowCare" />
          <span className="card absolute z-20 -bottom-4 -left-2 px-3 py-1.5 text-sm font-bold" style={{ transform: 'rotate(-6deg)', background: 'var(--pink)' }}>Rp 1.000 = 1 suap 🍗</span>
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
    </>
  );
};

/* ───────────────────────── Admin ───────────────────────── */
const CatForm = ({ cat, onClose, onSave }: { cat: Cat | null; onClose: () => void; onSave: (c: CatPayload) => void }) => {
  const [f, setF] = useState(
    cat
      ? { name: cat.name, breed: cat.breed, age: cat.age, traits: cat.traits.join(', '), targetAmount: String(cat.targetAmount), photo: cat.photo, lat: String(cat.lat||''), lng: String(cat.lng||'') }
      : { name: '', breed: '', age: '', traits: '', targetAmount: '20000', photo: '', lat: '', lng: '' },
  );
  const [picked, setPicked] = useState('');
  const set = (k: keyof typeof f, v: string) => setF(s => ({ ...s, [k]: v }));
  const ok = f.name.trim() && Number(f.targetAmount) > 0;
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
        <button disabled={!ok} className="btn go w-full py-3"
          onClick={() => {
            onSave({
              id: cat?.id, name: f.name.trim(), breed: f.breed.trim(), age: f.age.trim(),
              traits: f.traits.split(',').map(t => t.trim()).filter(Boolean),
              targetAmount: Number(f.targetAmount), photo: f.photo,
              lat: f.lat ? Number(f.lat) : null, lng: f.lng ? Number(f.lng) : null
            });
            onClose();
          }}>Simpan Kucing</button>
      </div>
    </Modal>
  );
};

const Admin = ({ cats, donations, h }: { cats: Cat[]; donations: Donation[]; h: Handlers }) => {
  const [tab, setTab] = useState<'verify' | 'cats'>('verify');
  const [form, setForm] = useState<{ cat: Cat | null } | null>(null);
  const pending = donations.filter(d => d.status === 'pending');
  return (
    <div className="max-w-5xl mx-auto px-5 py-8">
      <div className="flex gap-2 flex-wrap mb-6">
        <button onClick={() => setTab('verify')} className={'btn px-4 py-2 text-sm ' + (tab === 'verify' ? 'go' : 'ghost')}>Verifikasi ({pending.length})</button>
        <button onClick={() => setTab('cats')} className={'btn px-4 py-2 text-sm ' + (tab === 'cats' ? 'go' : 'ghost')}>Kucing ({cats.length})</button>
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
                <button className="btn ghost px-3 py-2" onClick={() => setForm({ cat: c })}><Ic n="Pencil" size={16} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
      {form && <CatForm cat={form.cat} onClose={() => setForm(null)} onSave={h.save} />}
    </div>
  );
};

/* ───────────────────────── Main App ───────────────────────── */
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

  const refresh = useCallback(async () => {
    const [c, d, p] = await Promise.all([
      supabase.from('cats').select('*').order('id', { ascending: true }),
      supabase.from('donations').select('*').order('created_at', { ascending: false }),
      supabase.from('proofs').select('*').order('created_at', { ascending: false }),
    ]);
    if (!c.error && !d.error && !p.error) {
      setCats((c.data ?? []).map(toCat));
      setDonations((d.data ?? []).map(toDonation));
      setProofs((p.data ?? []).map(toProof));
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuth(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setAuth(!!session));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => { refresh().finally(() => setLoading(false)); }, [refresh, auth]);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 3000); return () => clearTimeout(t); } }, [toast]);

  const h: Handlers = {
    approve: async d => {
      const cat = cats.find(c => c.id === d.catId);
      if (!cat) return;
      await supabase.from('donations').update({ status: 'approved' }).eq('id', d.id);
      await supabase.from('cats').update({ current_raised: cat.currentRaised + d.amount }).eq('id', cat.id);
      setToast('Donasi disetujui ✅'); await refresh();
    },
    reject: async d => { await supabase.from('donations').update({ status: 'rejected' }).eq('id', d.id); await refresh(); },
    fed: async (id, photo, note) => {
      const cat = cats.find(c => c.id === id);
      if (!cat) return;
      await supabase.from('proofs').insert({ cat_id: id, photo_url: photo, note });
      await supabase.from('cats').update({ current_raised: Math.max(0, cat.currentRaised - cat.targetAmount) }).eq('id', id);
      setToast('Kucing sudah diberi makan 📖'); await refresh();
    },
    save: async c => {
      const row = { name: c.name, breed: c.breed, age: c.age, traits: c.traits, photo_url: c.photo, target_amount: c.targetAmount, lat: c.lat, lng: c.lng };
      if (c.id) await supabase.from('cats').update(row).eq('id', c.id);
      else await supabase.from('cats').insert({ ...row, current_raised: 0, is_active: true });
      setToast('Data kucing disimpan 🐱'); await refresh();
    },
    setActive: async (id, active) => { await supabase.from('cats').update({ is_active: active }).eq('id', id); await refresh(); },
  };

  const submit = async (d: NewDonation) => {
    await supabase.from('donations').insert({ cat_id: d.catId, display_name: d.name, amount: d.amount, receipt_url: d.receipt, status: 'pending' });
    setToast('Bukti dikirim! Menunggu admin mengecek 💌');
    if (auth) await refresh(); return true;
  };

  return (
    <div className="min-h-screen relative">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <header className="sticky z-40 border-b-[3px]" style={{ top: 'env(safe-area-inset-top,0px)', background: 'var(--card)', borderColor: 'var(--ink)' }}>
        <div className="max-w-5xl mx-auto px-5 py-2.5 flex items-center justify-between">
          <button onClick={() => setView('public')} className="font-bold text-2xl flex items-center gap-1.5">🐾 Meow<span style={{ color: 'var(--a2)' }}>Care</span></button>
          <div className="flex gap-2">
            {view === 'admin' && auth && <button className="btn ghost px-3 py-1 text-sm flex items-center gap-1" onClick={() => { supabase.auth.signOut(); setView('public'); }}><Ic n="LogOut" size={14} />Keluar</button>}
            <button className="btn ghost px-3 py-1.5 text-sm flex items-center gap-1" onClick={() => setView(view === 'public' ? 'admin' : 'public')}>{view === 'public' ? <><Ic n="Lock" size={14} />Admin</> : '← Publik'}</button>
          </div>
        </div>
      </header>

      {/* PERBAIKAN Z-INDEX (z-20) AGAR TIDAK TUMPANG TINDIH DENGAN FOOTER */}
      <main className="relative z-20">
        {loading ? (
          <div className="text-center py-24 muted font-bold">Memuat data… 🐾</div>
        ) : view === 'public' ? (
          <PublicView cats={cats.filter(c => c.isActive)} donations={donations} proofs={proofs} onOpen={setOpenId} />
        ) : auth ? (
          <Admin cats={cats} donations={donations} h={h} />
        ) : (
          <div className="max-w-sm mx-auto px-5 py-20 text-center"><button className="btn go w-full py-3" onClick={async () => {
             const email = prompt('Email:'); const pw = prompt('Password:');
             if(email && pw) await supabase.auth.signInWithPassword({ email, password: pw });
          }}>Login Admin Khusus Relawan</button></div>
        )}
      </main>

      <footer className="relative z-10 text-center text-xs muted py-8">Dibuat dengan 🧡 untuk kucing jalanan</footer>

      {openId && <ProfileModal cat={cats.find(c=>c.id===openId)!} proofs={proofs} onClose={() => setOpenId(null)} onFeed={() => setPayId(openId)} />}
      {payId && <PayModal cat={cats.find(c=>c.id===payId)!} onClose={() => setPayId(null)} onSubmit={submit} />}
      {toast && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] pop btn go px-5 py-3 text-sm whitespace-nowrap">{toast}</div>}
    </div>
  );
}