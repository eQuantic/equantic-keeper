/** Small, unopinionated UI primitives shared by every screen. */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
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


/* ------------------------------------------------------------------------- *
 * Select
 * ------------------------------------------------------------------------- */

export interface SelectOption {
  value: string;
  label: string;
  /** Heading shown above this option; repeat it to keep options together. */
  group?: string;
  icon?: string;
  /** Secondary line, for when the label alone is ambiguous. */
  hint?: string;
}

/**
 * A dropdown that looks like the rest of the app.
 *
 * The native control was the honest first choice — free keyboard behaviour, the
 * iOS wheel, no positioning code — but its list is drawn by the operating
 * system, so it ignored every colour and radius here and looked like a stranger
 * in every dialog it appeared in.
 *
 * Two things this owes the native one, and pays back:
 *  - Keyboard. Arrows move, Home/End jump, Enter picks, Escape closes, typing
 *    letters jumps to a match (which is how anyone finds a country in a list of
 *    two hundred without reaching for the mouse).
 *  - Not being clipped. The menu renders in a portal at fixed coordinates, so a
 *    dialog with `overflow: hidden` or a scrolling sidebar cannot cut it off,
 *    and it flips above the trigger when the room below runs out.
 */
export function Select({
  value,
  onChange,
  options,
  className = '',
  size = 'md',
  'aria-label': ariaLabel,
  id,
  placeholder = 'Selecione…',
  disabled,
  align = 'start',
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  className?: string;
  size?: 'sm' | 'md';
  'aria-label'?: string;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Which edge of the trigger the menu lines up with when it is wider. */
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState('');
  const [box, setBox] = useState<{ top: number; left: number; width: number; drop: 'down' | 'up' } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const typedRef = useRef({ text: '', at: 0 });
  const listId = useId();

  const selected = options.find((option) => option.value === value) ?? null;
  // Read by the open-effect, which must not depend on values that change every
  // render (see below).
  const optionsRef = useRef(options);
  const valueRef = useRef(value);
  const searchableRef = useRef(false);
  optionsRef.current = options;
  valueRef.current = value;
  // Long lists get a filter box. Twelve is about where scanning stops working
  // and people start hunting.
  const searchable = options.length > 12;
  searchableRef.current = searchable;
  const normalize = (text: string) =>
    text.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const needle = normalize(query.trim());
  const shown = needle
    ? options.filter((option) => normalize(`${option.label} ${option.hint ?? ''}`).includes(needle))
    : options;

  const place = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom;
    const drop: 'down' | 'up' = below < 240 && rect.top > below ? 'up' : 'down';
    setBox({
      top: drop === 'down' ? rect.bottom + 4 : rect.top - 4,
      left: align === 'end' ? rect.right : rect.left,
      width: rect.width,
      drop,
    });
  }, [align]);

  useEffect(() => {
    if (!open) return;
    place();
    // Capture phase: the trigger may live inside a scrolling pane, and only the
    // capturing listener hears that pane scroll.
    const onScroll = () => place();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, place]);

  // Deliberately keyed on `open` alone. Callers build their option arrays
  // inline, so a new array arrives on every render: with `options` in here, an
  // effect that calls setState would re-run forever.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(Math.max(0, optionsRef.current.findIndex((option) => option.value === valueRef.current)));
    // The filter takes focus when there is one; otherwise the menu itself does,
    // so the arrows work without a click.
    const timer = window.setTimeout(() => {
      if (searchableRef.current) searchRef.current?.focus();
      else menuRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (option: SelectOption) => {
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const move = (delta: number) => {
    setActive((current) => {
      if (shown.length === 0) return 0;
      return (current + delta + shown.length) % shown.length;
    });
  };

  /**
   * While the menu is open it owns the keyboard, from a capture listener on the
   * window. Two reasons, both learned the hard way:
   *  - Escape has to close the MENU and stop there. Bubbling from a portal
   *    reached the dialog's own Escape handler, so picking an option in a
   *    select and changing your mind closed the whole dialog.
   *  - The keys have to work wherever the focus happens to be. After clicking
   *    the trigger the focus is on the trigger, and arrows did nothing.
   */
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      const owned = ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', 'Escape'];
      if (!owned.includes(event.key) && !(event.key === ' ' && !searchableRef.current)) {
        // Typing goes to the filter box; type-ahead only where there is none.
        if (searchableRef.current || event.key.length !== 1 || event.metaKey || event.ctrlKey) return;
      }
      event.preventDefault();
      event.stopPropagation();
      handleKey(event.key, event.metaKey || event.ctrlKey);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  });

  const handleKey = (key: string, modified: boolean) => {
    if (key === 'ArrowDown') move(1);
    else if (key === 'ArrowUp') move(-1);
    else if (key === 'Home') setActive(0);
    else if (key === 'End') setActive(Math.max(0, shown.length - 1));
    else if (key === 'Enter' || (key === ' ' && !searchable)) {
      const option = shown[active];
      if (option) choose(option);
    } else if (key === 'Escape') {
      setOpen(false);
      triggerRef.current?.focus();
    } else if (!searchable && key.length === 1 && !modified) {
      // Type-ahead on short lists, where there is no filter box to type into.
      const now = Date.now();
      const text = now - typedRef.current.at < 900 ? typedRef.current.text + key : key;
      typedRef.current = { text, at: now };
      const index = shown.findIndex((option) => normalize(option.label).startsWith(normalize(text)));
      if (index >= 0) setActive(index);
    }
  };

  const padding =
    size === 'sm'
      ? 'px-2.5 py-1.5 text-xs pointer-coarse:px-3 pointer-coarse:py-2'
      : 'px-3 py-2 text-sm pointer-coarse:px-3.5 pointer-coarse:py-2.5';

  let lastGroup: string | undefined;

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        data-select-trigger={ariaLabel ?? ''}
        data-select-value={value}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={`inline-flex min-w-0 max-w-full items-center gap-2 rounded-lg border border-line bg-canvas text-left text-ink transition hover:border-line-soft focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 pointer-coarse:rounded-xl ${padding} ${className}`}
      >
        {selected?.icon ? <Icon name={selected.icon} size={14} className="shrink-0 text-muted" /> : null}
        <span className={`min-w-0 flex-1 truncate ${selected ? '' : 'text-faint'}`}>
          {selected?.label ?? placeholder}
        </span>
        <Icon name="chevron" size={12} className="shrink-0 rotate-90 text-faint" />
      </button>

      {open && box
        ? createPortal(
            <div
              ref={menuRef}
              id={listId}
              role="listbox"
              tabIndex={-1}
              aria-label={ariaLabel}
              style={{
                position: 'fixed',
                top: box.drop === 'down' ? box.top : undefined,
                bottom: box.drop === 'up' ? window.innerHeight - box.top : undefined,
                left: align === 'end' ? undefined : box.left,
                right: align === 'end' ? window.innerWidth - box.left : undefined,
                minWidth: box.width,
                maxWidth: `min(22rem, calc(100vw - 1rem))`,
              }}
              className="animate-in card z-[60] max-h-[min(20rem,60dvh)] overflow-y-auto p-1 shadow-xl focus:outline-none"
            >
              {searchable ? (
                <div className="sticky top-0 z-10 bg-surface p-1 pb-1.5">
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setActive(0);
                    }}
                    placeholder="Filtrar…"
                    aria-label="Filtrar opções"
                    className="w-full rounded-md border border-line bg-canvas px-2 py-1.5 text-xs text-ink placeholder:text-faint focus:border-accent focus:outline-none"
                  />
                </div>
              ) : null}

              {shown.length === 0 ? <p className="px-2 py-2 text-xs text-faint">Nada encontrado.</p> : null}

              {shown.map((option, index) => {
                const heading = option.group && option.group !== lastGroup ? option.group : null;
                lastGroup = option.group;
                return (
                  // The key carries the position, not just the value: a list
                  // may legitimately repeat a value in two groups (a country in
                  // "most used" and again in "all"), and duplicate keys make
                  // React reuse the wrong nodes — which in a production build
                  // is silent, and looks like the filter is broken.
                  <div key={`${option.group ?? ''}|${option.value}|${index}`}>
                    {heading ? (
                      <p className="px-2 pt-2 pb-1 text-[11px] font-medium tracking-wider text-faint uppercase">
                        {heading}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      role="option"
                      aria-selected={option.value === value}
                      data-option-value={option.value}
                      data-active={index === active}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => choose(option)}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition pointer-coarse:py-2.5 ${
                        index === active ? 'bg-raised text-ink' : 'text-muted'
                      } ${option.value === value ? 'text-accent' : ''}`}
                    >
                      {option.icon ? <Icon name={option.icon} size={14} className="shrink-0" /> : null}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{option.label}</span>
                        {option.hint ? <span className="block truncate text-xs text-faint">{option.hint}</span> : null}
                      </span>
                      {option.value === value ? <Icon name="check" size={13} className="shrink-0" /> : null}
                    </button>
                  </div>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
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
  actions,
  children,
  footer,
  wide,
  split,
  paned,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** Slot before the title — a wizard's back button lives here. */
  leading?: ReactNode;
  /** Slot before the close button — the note's column toggles live here. */
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /**
   * A document-shaped dialog: the whole screen bar a 24px margin (capped at
   * 1760px so a line of text never grows past reading length on an ultrawide),
   * with the body laid out by the caller instead of scrolled as one column —
   * the note editor puts its details and its summary beside the page.
   */
  split?: boolean;
  /**
   * A dialog with navigation of its own: the body is laid out by the caller
   * (settings puts a list of panes beside the pane) and the height is fixed, so
   * switching panes moves what is inside the dialog instead of resizing it.
   */
  paned?: boolean;
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
          split
            ? 'sm:h-full sm:max-w-[1760px]'
            : paned
              ? 'h-[92dvh] sm:h-[min(44rem,88dvh)] sm:max-w-4xl'
              : wide
                ? 'sm:max-w-3xl'
                : 'sm:max-w-lg'
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
            {actions}
            <IconButton icon="x" label="Fechar" onClick={onClose} />
          </header>
        </div>
        {/* overflow-x-hidden: a too-wide child must never pan the whole sheet sideways. */}
        <div
          className={
            split || paned
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
