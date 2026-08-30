/** Small, unopinionated UI primitives shared by every screen. */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { Icon } from './icons';
import { useCloseOnBack } from './use-close-on-back';

type Variant = 'primary' | 'ghost' | 'outline' | 'danger' | 'subtle';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:brightness-110 border border-transparent',
  outline: 'border border-line text-ink hover:bg-raised',
  ghost: 'text-muted hover:text-ink hover:bg-raised border border-transparent',
  subtle: 'bg-raised text-ink border border-line-soft hover:border-line',
  danger: 'border border-danger/40 text-danger hover:bg-danger/10',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: string;
  loading?: boolean;
  size?: 'sm' | 'md';
}

export function Button({
  variant = 'subtle',
  icon,
  loading,
  size = 'md',
  className = '',
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
        size === 'sm'
          ? 'px-2.5 py-1.5 text-xs pointer-coarse:py-2'
          : 'px-3.5 py-2 text-sm pointer-coarse:rounded-xl pointer-coarse:px-4 pointer-coarse:py-3'
      } ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {loading ? <Spinner /> : icon ? <Icon name={icon} size={size === 'sm' ? 14 : 16} /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  className = '',
  active,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; label: string; active?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={`tap-target inline-flex h-8 w-8 items-center justify-center rounded-lg transition pointer-coarse:h-10 pointer-coarse:w-10 pointer-coarse:rounded-[10px] ${
        active ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-raised hover:text-ink'
      } ${className}`}
      {...rest}
    >
      <Icon name={icon} size={16} />
    </button>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      className="inline-block animate-spin rounded-full border-2 border-current border-t-transparent"
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

/**
 * Label + control + hint/error.
 *
 * `wrapper` exists because a `<label>` is the wrong element for a composite
 * field: when a control inside it is removed by its own click handler, the
 * browser falls back to the label's activation behaviour and fires a second
 * click on whatever labelable element comes first — usually the button in
 * `actions`. Pass `wrapper="div"` whenever the field holds more than one
 * control.
 */
export function Field({
  label,
  hint,
  error,
  children,
  actions,
  wrapper: Wrapper = 'label',
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  actions?: ReactNode;
  wrapper?: 'label' | 'div';
}) {
  return (
    <Wrapper className="block">
      <span className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-xs font-medium tracking-wide text-muted uppercase">{label}</span>
        {actions}
      </span>
      {children}
      {hint && !error ? <span className="mt-1 block text-xs text-faint">{hint}</span> : null}
      {error ? <span className="mt-1 block text-xs text-danger">{error}</span> : null}
    </Wrapper>
  );
}

const inputClass =
  'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink placeholder:text-faint transition focus:border-accent focus:outline-none disabled:opacity-60 pointer-coarse:rounded-xl pointer-coarse:px-3.5 pointer-coarse:py-3';

export function TextInput({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${inputClass} ${className}`} {...rest} />;
}

/**
 * Editable select: the values people actually type are a short closed list
 * ("Temporária · Permanente · CPLP"), but never *only* that list — a document
 * from an unforeseen category must still go in. So the options are suggestions
 * on a plain text field: click (or the chevron) opens them, typing filters
 * them, and anything typed is kept whether it is on the list or not.
 */
export function ComboInput({
  value,
  onChange,
  options,
  className = '',
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const normalize = (input: string) =>
    input.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/\p{Diacritic}/gu, '');
  // An exact match means "this is the chosen one" — keep the whole list open
  // so the next option is one click away, instead of a list of one.
  const needle = normalize(value.trim());
  const shown =
    !needle || options.some((option) => normalize(option) === needle)
      ? options
      : options.filter((option) => normalize(option).includes(needle));

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const commit = (option: string) => {
    onChange(option);
    setOpen(false);
    setActive(-1);
  };

  return (
    <div ref={wrapperRef} className="relative">
      <input
        {...rest}
        value={value}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) return setOpen(true);
            const delta = event.key === 'ArrowDown' ? 1 : -1;
            setActive((current) => (current + delta + shown.length) % Math.max(shown.length, 1));
          } else if (event.key === 'Enter' && open && active >= 0 && shown[active]) {
            event.preventDefault();
            commit(shown[active]);
          } else if (event.key === 'Escape' && open) {
            event.stopPropagation();
            setOpen(false);
          }
        }}
        className={`${inputClass} pr-9 ${className}`}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={open ? 'Fechar sugestões' : 'Ver sugestões'}
        onClick={() => setOpen((current) => !current)}
        className="tap-target absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-faint transition hover:text-ink"
      >
        <Icon name="chevron" size={13} className={open ? '-rotate-90' : 'rotate-90'} />
      </button>
      {open && shown.length > 0 ? (
        <ul
          role="listbox"
          className="animate-in absolute top-full right-0 left-0 z-30 mt-1 max-h-56 overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-xl"
        >
          {shown.map((option, index) => (
            <li key={option}>
              <button
                type="button"
                role="option"
                aria-selected={option === value}
                // pointerdown, not click: the input's blur must not close the
                // list before the choice lands.
                onPointerDown={(event) => {
                  event.preventDefault();
                  commit(option);
                }}
                onMouseEnter={() => setActive(index)}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition pointer-coarse:py-2.5 ${
                  index === active ? 'bg-raised text-ink' : 'text-muted hover:bg-raised hover:text-ink'
                }`}
              >
                <span className="min-w-0 truncate">{option}</span>
                {option === value ? <Icon name="check" size={13} className="shrink-0 text-accent" /> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function TextArea({ className = '', rows = 4, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={rows} className={`${inputClass} resize-y font-mono text-[13px] ${className}`} {...rest} />;
}

/**
 * Password field with a reveal toggle. Typing a master password blind is how
 * people lock themselves out of a vault that has no recovery, so being able to
 * read back what was typed matters more here than in an ordinary login form.
 * Revealed text is monospaced to keep look-alike glyphs (l/1, O/0) apart.
 */
export function PasswordInput({
  className = '',
  revealLabel = 'Mostrar senha',
  hideLabel = 'Ocultar senha',
  defaultRevealed = false,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  revealLabel?: string;
  hideLabel?: string;
  /** Starts legible — for values copied off a physical card, not passwords. */
  defaultRevealed?: boolean;
}) {
  const [revealed, setRevealed] = useState(defaultRevealed);
  return (
    <div className="relative">
      <input
        {...rest}
        type={revealed ? 'text' : 'password'}
        className={`${inputClass} pr-10 font-mono ${className}`}
      />
      <button
        type="button"
        onClick={() => setRevealed((current) => !current)}
        aria-label={revealed ? hideLabel : revealLabel}
        aria-pressed={revealed}
        title={revealed ? hideLabel : revealLabel}
        className="tap-target absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted transition hover:text-ink"
      >
        <Icon name={revealed ? 'eyeOff' : 'eye'} size={15} />
      </button>
    </div>
  );
}

/** Keyboard-key chip, as in the shortcuts cheat sheet and inline hints. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-md border border-line border-b-2 bg-canvas px-1.5 font-mono text-[11px] text-muted">
      {children}
    </kbd>
  );
}

export function Badge({
  children,
  color,
  className = '',
}: {
  children: ReactNode;
  color?: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${className}`}
      style={
        color
          ? { color, backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)` }
          : undefined
      }
    >
      {children}
    </span>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm text-ink">
          {label}
        </label>
        {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full border transition ${
          checked ? 'border-accent bg-accent/80' : 'border-line bg-raised'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white transition-all ${
            checked ? 'left-5.5' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  leading,
  children,
  footer,
  wide,
  split,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** Slot before the title — a wizard's back button lives here. */
  leading?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /**
   * A document-shaped dialog: as wide and as tall as the screen sensibly
   * allows, with the body laid out by the caller instead of scrolled as one
   * column — the note editor puts the form beside the page.
   */
  split?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useCloseOnBack(open, onClose);

  // Below the sm breakpoint the modal is a bottom sheet; dragging its handle
  // down is the touch way to dismiss it. onClose stays the single exit, so a
  // dirty-form confirmation upstream also guards the gesture.
  const [sheetDrag, setSheetDrag] = useState<number | null>(null);
  const sheetStartRef = useRef<{ y: number; pointerId: number } | null>(null);
  // The handlers read the ref: pointermove is not a discrete event, so the
  // state may not have re-rendered by the time pointerup fires.
  const sheetDragRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  // Focus moves to the dialog ONLY when it opens — in its own effect because
  // an unstable `onClose` (an inline arrow in the parent) re-runs the effect
  // above on every keystroke in a controlled field, and a focus() there kept
  // yanking the caret out of the input after each typed letter. The guard
  // covers re-runs from StrictMode and prop churn alike.
  useEffect(() => {
    if (!open) return;
    const node = ref.current;
    if (node && !node.contains(document.activeElement)) node.focus();
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6">
      <div
        className="absolute inset-0"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={
          sheetDrag !== null
            ? { transform: `translateY(${sheetDrag}px)`, transition: 'none' }
            : undefined
        }
        className={`animate-in card relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-b-none pb-[env(safe-area-inset-bottom,0px)] sm:rounded-card sm:pb-0 ${
          split ? 'sm:h-[92dvh] sm:max-w-6xl' : wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'
        }`}
      >
        <div
          data-sheet-handle
          className="[touch-action:none]"
          onPointerDown={(event) => {
            if (event.pointerType === 'mouse') return;
            sheetStartRef.current = { y: event.clientY, pointerId: event.pointerId };
          }}
          onPointerMove={(event) => {
            const start = sheetStartRef.current;
            if (!start || event.pointerId !== start.pointerId) return;
            const dy = event.clientY - start.y;
            if (dy > 4) {
              try {
                event.currentTarget.setPointerCapture(event.pointerId);
              } catch {
                /* synthetic pointers (tests) have no capture */
              }
            }
            sheetDragRef.current = Math.max(0, dy);
            setSheetDrag(sheetDragRef.current);
          }}
          onPointerUp={() => {
            const dy = sheetDragRef.current;
            sheetDragRef.current = 0;
            sheetStartRef.current = null;
            setSheetDrag(null);
            if (dy > 120) onClose();
          }}
          onPointerCancel={() => {
            sheetDragRef.current = 0;
            sheetStartRef.current = null;
            setSheetDrag(null);
          }}
        >
          <div data-sheet-grabber className="flex justify-center pt-2.5 pb-1 sm:hidden" aria-hidden="true">
            <div className="h-1 w-10 rounded-full bg-line"></div>
          </div>
          <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4 pt-2 sm:pt-4">
            {leading}
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-base font-semibold text-ink">{title}</h2>
              {subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
            </div>
            <IconButton icon="x" label="Fechar" onClick={onClose} />
          </header>
        </div>
        {/* overflow-x-hidden: a too-wide child must never pan the whole sheet sideways. */}
        <div
          className={
            split
              ? 'min-h-0 flex-1 overflow-hidden'
              : 'min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-5 py-4'
          }
        >
          {children}
        </div>
        {footer ? (
          <footer className="flex items-center justify-end gap-2 border-t border-line bg-raised/50 px-5 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-raised text-muted">
        <Icon name={icon} size={22} />
      </span>
      <div>
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="mx-auto mt-1 max-w-sm text-xs text-muted">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function Toast({
  message,
  tone = 'info',
  onDismiss,
}: {
  message: string;
  tone?: 'info' | 'error' | 'success';
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, tone === 'error' ? 9000 : 4000);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss, tone]);

  const palette =
    tone === 'error'
      ? 'border-danger/40 bg-danger/10 text-danger'
      : tone === 'success'
        ? 'border-ok/40 bg-ok/10 text-ok'
        : 'border-line bg-raised text-ink';

  return (
    <div
      role="status"
      className={`animate-in pointer-events-auto flex max-w-md items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur ${palette}`}
    >
      <Icon name={tone === 'error' ? 'warning' : tone === 'success' ? 'check' : 'layers'} size={16} />
      <span className="flex-1 leading-snug">{message}</span>
      <button type="button" onClick={onDismiss} aria-label="Dispensar" className="opacity-60 hover:opacity-100">
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
