/**
 * The credit card, drawn: front with chip, masked number, holder and expiry;
 * tap to flip to the back, where the CVC lives with the vault's usual touch
 * grammar (tap copies, hold reveals). The network wordmark comes from the
 * number prefix — offline, see lib/card-brand.ts — and the face color is the
 * item's own `cardColor` field: a preset name or a free hex.
 */
import { useRef, useState } from 'react';
import { cardExpiryLabel, detectCardBrand, maskCardNumber } from '../lib/card-brand';
import type { VaultItem } from '../lib/model';
import { useCopy } from './SecretValue';
import { Icon } from './icons';

export const CARD_PRESETS: { id: string; label: string; css: string }[] = [
  { id: 'grafite', label: 'Grafite', css: 'linear-gradient(135deg, #232b3f 0%, #12161f 100%)' },
  { id: 'azul', label: 'Azul profundo', css: 'linear-gradient(135deg, #1e3a6e 0%, #101c36 100%)' },
  { id: 'verde', label: 'Verde', css: 'linear-gradient(135deg, #14532d 0%, #0b2818 100%)' },
  { id: 'vinho', label: 'Vinho', css: 'linear-gradient(135deg, #6e1d33 0%, #35101b 100%)' },
  { id: 'roxo', label: 'Roxo', css: 'linear-gradient(135deg, #4a2a7a 0%, #241242 100%)' },
  { id: 'areia', label: 'Areia', css: 'linear-gradient(135deg, #8a6d3b 0%, #4a3a20 100%)' },
];

export function cardFaceBackground(value: string | undefined): string {
  const chosen = (value ?? '').trim();
  const preset = CARD_PRESETS.find((candidate) => candidate.id === chosen);
  if (preset) return preset.css;
  if (/^#[0-9a-fA-F]{6}$/.test(chosen)) {
    return `linear-gradient(135deg, ${chosen} 0%, color-mix(in srgb, ${chosen} 45%, black) 100%)`;
  }
  return CARD_PRESETS[0]?.css ?? '#171d2c';
}

export function CardVisual({ item }: { item: VaultItem }) {
  const [flipped, setFlipped] = useState(false);
  const [cvcRevealed, setCvcRevealed] = useState(false);
  const { copy, copiedKey } = useCopy();
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const heldRef = useRef(false);

  const number = item.fields.number ?? '';
  const cvc = item.fields.cvc ?? '';
  const brand = detectCardBrand(number);
  const background = cardFaceBackground(item.fields.cardColor);
  const holder = (item.fields.holder ?? '').trim();
  const expiry = cardExpiryLabel(item.fields.expiresAt ?? '');
  const cvcCopied = copiedKey === `${item.id}:cvc-card`;

  const cancelHold = () => clearTimeout(holdTimerRef.current);
  const copyCvc = () => {
    if (heldRef.current) {
      heldRef.current = false;
      return;
    }
    if (cvc) void copy(cvc, `${item.id}:cvc-card`);
  };

  return (
    <div className="flex flex-col items-center gap-2 pt-1 pb-2">
      <div
        data-card-visual
        data-flipped={flipped || undefined}
        role="button"
        tabIndex={0}
        aria-label={flipped ? 'Virar para a frente do cartão' : 'Virar para o verso do cartão'}
        onClick={() => setFlipped((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setFlipped((current) => !current);
          }
        }}
        className="w-full max-w-[340px] cursor-pointer outline-none"
        style={{ perspective: '1200px' }}
      >
        <div
          className="relative aspect-[340/214] w-full transition-transform duration-500 ease-out"
          style={{ transformStyle: 'preserve-3d', transform: `rotateY(${flipped ? 180 : 0}deg)` }}
        >
          {/* front */}
          <div
            className="absolute inset-0 flex flex-col justify-between overflow-hidden rounded-2xl p-5 shadow-[0_16px_40px_rgba(0,0,0,0.55)]"
            style={{
              background,
              WebkitBackfaceVisibility: 'hidden',
              backfaceVisibility: 'hidden',
            }}
          >
            <div className="pointer-events-none absolute -top-16 -right-10 h-56 w-56 rounded-full bg-white/5"></div>
            <div className="flex items-center gap-3">
              <svg width="38" height="28" viewBox="0 0 38 28" fill="none" aria-hidden="true">
                <rect x="1" y="1" width="36" height="26" rx="5" fill="rgba(255,255,255,0.22)" stroke="rgba(255,255,255,0.45)" />
                <path d="M1 10h10M1 18h10M27 10h10M27 18h10M13 1v26M25 1v26" stroke="rgba(255,255,255,0.45)" strokeWidth="1" />
              </svg>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="M6 9a9 9 0 0 1 0 6" />
                <path d="M9.5 7a12 12 0 0 1 0 10" />
                <path d="M13 5a15.5 15.5 0 0 1 0 14" />
              </svg>
              {brand ? (
                <span className="ml-auto text-[15px] font-bold tracking-wider text-white/90 italic">{brand.wordmark}</span>
              ) : null}
            </div>
            <div className="font-mono text-[19px] tracking-[0.14em] text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.4)]">
              {maskCardNumber(number)}
            </div>
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[8px] tracking-[0.14em] text-white/55">NOME</p>
                <p className="truncate text-[13px] tracking-wider text-white/90 uppercase">{holder || '—'}</p>
              </div>
              <div className="text-right">
                <p className="text-[8px] tracking-[0.14em] text-white/55">VALIDADE</p>
                <p className="font-mono text-[13px] text-white/90">{expiry || '—'}</p>
              </div>
            </div>
          </div>

          {/* back */}
          <div
            className="absolute inset-0 flex flex-col overflow-hidden rounded-2xl shadow-[0_16px_40px_rgba(0,0,0,0.55)]"
            style={{
              background,
              transform: 'rotateY(180deg)',
              WebkitBackfaceVisibility: 'hidden',
              backfaceVisibility: 'hidden',
            }}
          >
            <div className="mt-5 h-10 bg-black/55"></div>
            <div className="mx-5 mt-4 flex items-center gap-2.5">
              <div className="flex h-9 flex-1 items-center rounded-md px-3 [background:repeating-linear-gradient(0deg,rgba(255,255,255,0.85),rgba(255,255,255,0.85)_4px,rgba(230,230,230,0.85)_4px,rgba(230,230,230,0.85)_8px)]">
                <span className="truncate font-mono text-xs text-neutral-900 italic lowercase">{holder}</span>
              </div>
              <div className="flex flex-col items-center gap-0.5">
                <button
                  type="button"
                  aria-label={cvcCopied ? 'CVC copiado' : 'Copiar CVC (segure para revelar)'}
                  onClick={(event) => {
                    event.stopPropagation();
                    copyCvc();
                  }}
                  onPointerDown={(event) => {
                    if (event.pointerType === 'mouse') return;
                    heldRef.current = false;
                    clearTimeout(holdTimerRef.current);
                    holdTimerRef.current = setTimeout(() => {
                      heldRef.current = true;
                      setCvcRevealed(true);
                    }, 550);
                  }}
                  onPointerMove={cancelHold}
                  onPointerUp={cancelHold}
                  onPointerCancel={cancelHold}
                  className="tap-target flex h-9 w-14 items-center justify-center rounded-md bg-white/90 font-mono text-sm tracking-[0.2em] text-neutral-900"
                >
                  {cvcCopied ? '✓' : cvcRevealed && cvc ? cvc : '•••'}
                </button>
                <span className="text-[8px] tracking-[0.14em] text-white/60">CVC</span>
              </div>
            </div>
            <div className="mx-5 mt-auto mb-4 flex items-center justify-between gap-3">
              <span className="text-[10px] text-white/45">Toque no CVC para copiar · segure para revelar</span>
              {brand ? (
                <span className="text-[13px] font-bold tracking-wider text-white/70 italic">{brand.wordmark}</span>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-faint">
        <Icon name="refresh" size={12} />
        Toque no cartão para virar
      </p>
    </div>
  );
}

/** Preset swatches plus a free color, stored as a preset id or a hex. */
export function CardColorPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const chosen = value.trim();
  const custom = /^#[0-9a-fA-F]{6}$/.test(chosen);
  return (
    <div className="flex flex-wrap items-center gap-2.5 py-1">
      {CARD_PRESETS.map((preset) => (
        <button
          key={preset.id}
          type="button"
          aria-label={`Cor ${preset.label}`}
          onClick={() => onChange(preset.id)}
          className="tap-target h-8 w-11 rounded-lg border border-white/10 transition"
          style={{
            background: preset.css,
            boxShadow:
              chosen === preset.id || (!chosen && preset.id === 'grafite')
                ? '0 0 0 3px rgba(91, 140, 255, 0.5)'
                : 'none',
          }}
        />
      ))}
      <label
        className="tap-target relative flex h-8 w-11 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-line"
        style={
          custom
            ? { background: cardFaceBackground(chosen), boxShadow: '0 0 0 3px rgba(91, 140, 255, 0.5)' }
            : {
                background:
                  'conic-gradient(from 0deg, #f87171, #fbbf24, #34d399, #22d3ee, #5b8cff, #c084fc, #f87171)',
              }
        }
      >
        <input
          type="color"
          value={custom ? chosen : '#4a2a7a'}
          onChange={(event) => onChange(event.target.value)}
          aria-label="Cor personalizada"
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
    </div>
  );
}
