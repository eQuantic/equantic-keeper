/** The unlocked application: sidebar, list and detail pane. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { getAllTypes, getFamily, getType, isSecretKind, type SecretTypeDef, type VaultItem } from '../lib/model';
import { DEFAULT_WARNING_DAYS, collectExpiring, describeExpiry } from '../lib/expiry';
import { EMPTY_FILTERS, applyFilters, collectFolders, collectTags, type Filters, type SortMode } from '../lib/search';
import { activeFolders, activeItems, activePeople, trashedItems } from '../lib/vault';
import type { TypeFamily } from '../lib/documents';
import { useKeeper } from '../state/keeper';
import { Badge, Button, EmptyState, IconButton, Kbd, TextInput } from '../components/ui';
import { Icon, Logo } from '../components/icons';
import { CountryMark } from '../components/flags';
import { countryName } from '../lib/countries';
import { ItemDetail } from '../components/ItemDetail';
import { ItemEditor } from '../components/ItemEditor';
import { GeneratorDialog } from '../components/Generator';
import { SettingsDialog } from '../components/SettingsDialog';
import { CopyButton, useCopy } from '../components/SecretValue';
import { SwipeableRow, type SwipeSide } from '../components/SwipeableRow';
import { ShortcutsDialog } from '../components/ShortcutsDialog';
import { PullToSync } from '../components/PullToSync';
import { useCloseOnBack } from '../components/use-close-on-back';

/** A sidebar row: one type in use, or a whole family of them. */
type SidebarEntry =
  | { kind: 'type'; type: SecretTypeDef; count: number }
  | { kind: 'family'; family: TypeFamily; count: number };

function relativeTime(value: string): string {
  const diff = Date.now() - Date.parse(value);
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d`;
  return new Date(value).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
}

/** The value a quick-copy button should hand over for this item. */
function primarySecret(item: VaultItem): { value: string; label: string } | null {
  const type = getType(item.type);
  for (const field of type.fields) {
    const value = item.fields[field.id];
    if (value && isSecretKind(field.kind) && field.kind !== 'totp') {
      return { value, label: field.label };
    }
  }
  const custom = item.customFields.find((field) => field.secret && field.value);
  return custom ? { value: custom.value, label: custom.label || 'Campo' } : null;
}

function SyncBadge() {
  const { sync, online, connected, actions } = useKeeper();
  const map = {
    syncing: { icon: 'refresh', text: 'Sincronizando…', tone: 'text-muted' },
    saved: { icon: 'cloud', text: 'Sincronizado', tone: 'text-ok' },
    offline: { icon: 'cloudOff', text: 'Somente local', tone: 'text-warn' },
    error: { icon: 'warning', text: 'Falha ao sincronizar', tone: 'text-danger' },
    conflict: { icon: 'warning', text: 'Conflito', tone: 'text-warn' },
    idle: { icon: connected ? 'cloud' : 'cloudOff', text: connected ? 'Pronto' : 'Somente local', tone: 'text-muted' },
  } as const;
  const state = map[sync.status] ?? map.idle;

  return (
    <button
      type="button"
      onClick={() => void actions.syncNow()}
      title={sync.message ?? (online ? 'Sincronizar agora' : 'Sem conexão')}
      className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs transition hover:bg-raised ${state.tone}`}
    >
      <Icon name={state.icon} size={14} className={sync.status === 'syncing' ? 'animate-spin' : ''} />
      <span className="hidden md:inline">{state.text}</span>
    </button>
  );
}

export function VaultScreen() {
  const { payload, actions, account, connected } = useKeeper();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortMode>('updated');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ item: VaultItem | null } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [swipeOpen, setSwipeOpen] = useState<{ id: string; side: SwipeSide } | null>(null);
  const [addingFolder, setAddingFolder] = useState(false);
  /**
   * Dragging a row onto a folder or a person files it there. Mouse only: on
   * touch the horizontal swipe already owns the gesture, and the sidebar is a
   * drawer that is not even on screen while the list is.
   */
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const { copy } = useCopy();
  // Gestures are a touch affordance; a mouse keeps its buttons and hovers.
  const [coarsePointer] = useState(() => window.matchMedia('(pointer: coarse)').matches);

  const items = payload?.items ?? [];
  const warningDays = payload?.preferences.expiryWarningDays ?? DEFAULT_WARNING_DAYS;
  const people = useMemo(() => activePeople(payload?.people ?? []), [payload]);
  const holderNames = useMemo(
    () => new Map(people.map((person) => [person.id, person.name])),
    [people],
  );
  const visible = useMemo(
    () => applyFilters(items, filters, sort, holderNames, warningDays),
    [items, filters, sort, holderNames, warningDays],
  );
  const tags = useMemo(() => collectTags(items), [items]);
  const folders = useMemo(() => {
    const byName = new Map(collectFolders(items).map((entry) => [entry.folder, entry.count]));
    for (const folder of activeFolders(payload?.folders ?? [])) {
      if (!byName.has(folder.name)) byName.set(folder.name, 0);
    }
    return [...byName.entries()]
      .map(([folder, count]) => ({ folder, count }))
      .sort((a, b) => a.folder.localeCompare(b.folder, 'pt-BR'));
  }, [items, payload]);
  /** Only an explicitly created record can be removed from the sidebar. */
  const explicitFolders = useMemo(
    () => new Set(activeFolders(payload?.folders ?? []).map((folder) => folder.name)),
    [payload],
  );
  const active = useMemo(() => activeItems(items), [items]);
  const trashed = useMemo(() => trashedItems(items), [items]);
  const selected = items.find((item) => item.id === selectedId) ?? null;

  // On a phone these are full-screen overlays, and the system back gesture is
  // how people dismiss them; dialogs get the same treatment inside Modal.
  useCloseOnBack(sidebarOpen, () => setSidebarOpen(false));
  useCloseOnBack(!!selected, () => setSelectedId(null));

  /** Files the dragged item under a folder or a person, and says so. */
  const dropOnto = (itemId: string, change: Partial<VaultItem>, where: string) => {
    setDragging(null);
    setDropTarget(null);
    const item = items.find((candidate) => candidate.id === itemId);
    if (!item) return;
    const [key, value] = Object.entries(change)[0] as [keyof VaultItem, string];
    if (item[key] === value) return;
    void actions.saveItem({ ...item, ...change });
    actions.notify(`“${item.name || 'Sem título'}” em ${where}.`);
  };

  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of active) counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
    return counts;
  }, [active]);

  /** Only worth splitting the sidebar in two when the vault actually holds both. */
  const categoryCounts = useMemo(() => {
    let dev = 0;
    let doc = 0;
    for (const item of active) {
      if (getType(item.type).category === 'doc') doc += 1;
      else dev += 1;
    }
    return { dev, doc };
  }, [active]);

  /** Indexed by item id so a list row can look its own status up in O(1). */
  const expiring = useMemo(() => {
    const found = collectExpiring(items, warningDays);
    return { list: found, byItem: new Map(found.map((entry) => [entry.itemId, entry])) };
  }, [items, warningDays]);

  const holderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of active) {
      if (item.holderId) counts.set(item.holderId, (counts.get(item.holderId) ?? 0) + 1);
    }
    return counts;
  }, [active]);

  /**
   * Only types actually in use, bucketed by origin so the sidebar stays short —
   * and a family (every declaration, say) counts as ONE entry, filed under the
   * group of its default member however many countries its members span.
   */
  const typeGroups = useMemo(() => {
    const order = ['Portugal', 'Brasil', 'Geral', 'Desenvolvimento'];
    const buckets = new Map<string, SidebarEntry[]>();
    const familyCounts = new Map<string, number>();
    const push = (heading: string, entry: SidebarEntry) =>
      buckets.set(heading, [...(buckets.get(heading) ?? []), entry]);

    for (const type of getAllTypes()) {
      const count = typeCounts.get(type.id);
      if (!count) continue;
      if (type.family) {
        familyCounts.set(type.family, (familyCounts.get(type.family) ?? 0) + count);
        continue;
      }
      push(type.category === 'dev' ? 'Desenvolvimento' : type.group, { kind: 'type', type, count });
    }
    for (const [familyId, count] of familyCounts) {
      const family = getFamily(familyId);
      if (!family) continue;
      const home = getType(family.defaultTypeId);
      push(home.category === 'dev' ? 'Desenvolvimento' : home.group, { kind: 'family', family, count });
    }
    return [...buckets.entries()].sort(
      ([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99),
    );
    // `payload` re-registers custom types, so it belongs in the deps.
  }, [typeCounts, payload]);

  useEffect(() => {
    const isTyping = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      target.closest('input, textarea, select, [contenteditable="true"]') !== null;

    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        actions.lock();
        return;
      }
      if (event.key === 'Escape') {
        if (!editing && !settingsOpen && !generatorOpen && !shortcutsOpen) setSelectedId(null);
        return;
      }

      // Single-key shortcuts: never while typing, never under an open dialog.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTyping(event.target)) return;
      if (editing || settingsOpen || generatorOpen || shortcutsOpen) return;

      const move = (delta: number) => {
        if (visible.length === 0) return;
        const index = visible.findIndex((item) => item.id === selectedId);
        const next = index === -1 ? (delta > 0 ? 0 : visible.length - 1) : Math.min(Math.max(index + delta, 0), visible.length - 1);
        setSelectedId(visible[next].id);
      };

      const key = event.key.toLowerCase();
      if (key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault();
        move(1);
      } else if (key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault();
        move(-1);
      } else if (event.key === 'Enter') {
        if (!selected && visible.length > 0) setSelectedId(visible[0].id);
      } else if (key === 'c') {
        const quick = selected ? primarySecret(selected) : null;
        if (quick) {
          void copy(quick.value, `key:${selected!.id}`).then((result) => {
            if (result.ok) actions.notify('Copiado para a área de transferência.');
          });
        }
      } else if (key === 'e') {
        if (selected && !selected.deletedAt) setEditing({ item: selected });
      } else if (key === 'f') {
        if (selected) void actions.toggleFavorite(selected.id);
      } else if (key === 'n') {
        setEditing({ item: null });
      } else if (key === 'g') {
        setGeneratorOpen(true);
      } else if (event.key === '?') {
        setShortcutsOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, copy, editing, generatorOpen, selected, selectedId, settingsOpen, shortcutsOpen, visible]);

  // Keyboard navigation should keep the selected row in view.
  useEffect(() => {
    if (!selectedId) return;
    document.querySelector('[data-row-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const setFilter = (patch: Partial<Filters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setSidebarOpen(false);
    setSwipeOpen(null);
  };

  const NavItem = ({
    icon,
    label,
    count,
    activeState,
    onClick,
    accent,
    dropKey,
    onDropItem,
  }: {
    icon: string;
    label: string;
    count?: number;
    activeState: boolean;
    onClick: () => void;
    accent?: string;
    /** Identifies this entry as a drop target while a row is being dragged. */
    dropKey?: string;
    onDropItem?: (itemId: string) => void;
  }) => {
    const armed = !!dragging && !!dropKey;
    const over = armed && dropTarget === dropKey;
    return (
    <button
      type="button"
      onClick={onClick}
      data-drop-target={dropKey}
      onDragOver={
        onDropItem
          ? (event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              if (dropTarget !== dropKey) setDropTarget(dropKey ?? null);
            }
          : undefined
      }
      onDragLeave={onDropItem ? () => setDropTarget((current) => (current === dropKey ? null : current)) : undefined}
      onDrop={
        onDropItem
          ? (event) => {
              event.preventDefault();
              const itemId = event.dataTransfer.getData('text/plain');
              if (itemId) onDropItem(itemId);
            }
          : undefined
      }
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition pointer-coarse:py-2.5 ${
        over
          ? 'bg-accent/25 text-ink ring-2 ring-accent'
          : armed
            ? 'text-muted ring-1 ring-line ring-dashed'
            : activeState
              ? 'bg-accent/12 text-ink'
              : 'text-muted hover:bg-raised hover:text-ink'
      }`}
    >
      <Icon name={icon} size={15} style={accent ? { color: accent } : undefined} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined ? <span className="text-xs text-faint tabular-nums">{count}</span> : null}
    </button>
    );
  };

  const BarAction = ({
    icon,
    label,
    active,
    onClick,
  }: {
    icon: string;
    label: string;
    active?: boolean;
    onClick: () => void;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-16 flex-col items-center gap-1 rounded-xl py-1.5 text-[11px] transition ${
        active ? 'text-accent' : 'text-muted'
      }`}
    >
      <Icon name={icon} size={22} />
      {label}
    </button>
  );

  const sidebar = (
    <nav className="flex h-full w-64 shrink-0 flex-col gap-4 overflow-y-auto border-r border-line bg-surface px-3 pt-[calc(env(safe-area-inset-top,0px)+1rem)] pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] lg:pt-4 lg:pb-4">
      <div className="space-y-0.5">
        <NavItem
          icon="layers"
          label="Tudo"
          count={active.length}
          activeState={
            filters.view === 'active' &&
            !filters.type &&
            !filters.tag &&
            !filters.folder &&
            !filters.holderId &&
            !filters.category &&
            !filters.expiry &&
            !filters.favoritesOnly
          }
          onClick={() => setFilter({ ...EMPTY_FILTERS, query: filters.query })}
        />
        {categoryCounts.dev > 0 && categoryCounts.doc > 0 ? (
          <>
            <NavItem
              icon="terminal"
              label="Desenvolvimento"
              count={categoryCounts.dev}
              activeState={filters.category === 'dev'}
              onClick={() => setFilter({ ...EMPTY_FILTERS, category: 'dev', query: filters.query })}
            />
            <NavItem
              icon="idCard"
              label="Documentos"
              count={categoryCounts.doc}
              activeState={filters.category === 'doc'}
              onClick={() => setFilter({ ...EMPTY_FILTERS, category: 'doc', query: filters.query })}
            />
          </>
        ) : null}
        <NavItem
          icon="star"
          label="Favoritos"
          count={active.filter((item) => item.favorite).length}
          activeState={filters.favoritesOnly}
          onClick={() => setFilter({ ...EMPTY_FILTERS, favoritesOnly: true, query: filters.query })}
        />
        <NavItem
          icon="trash"
          label="Lixeira"
          count={trashed.length}
          activeState={filters.view === 'trash'}
          onClick={() => setFilter({ ...EMPTY_FILTERS, view: 'trash', query: filters.query })}
        />
      </div>

      {expiring.list.length > 0 ? (
        <div>
          <p className="mb-1 px-2.5 text-[11px] font-medium tracking-wider text-faint uppercase">Validade</p>
          <div className="space-y-0.5">
            {expiring.list.some((entry) => entry.status === 'expired') ? (
              <NavItem
                icon="warning"
                accent="var(--color-danger)"
                label="Vencidos"
                count={expiring.list.filter((entry) => entry.status === 'expired').length}
                activeState={filters.expiry === 'expired'}
                onClick={() => setFilter({ ...EMPTY_FILTERS, expiry: 'expired', query: filters.query })}
              />
            ) : null}
            {expiring.list.some((entry) => entry.status === 'soon') ? (
              <NavItem
                icon="clock"
                accent="var(--color-warn)"
                label="Vencem em breve"
                count={expiring.list.filter((entry) => entry.status === 'soon').length}
                activeState={filters.expiry === 'soon'}
                onClick={() => setFilter({ ...EMPTY_FILTERS, expiry: 'soon', query: filters.query })}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      {people.length > 0 ? (
        <div>
          <p className="mb-1 px-2.5 text-[11px] font-medium tracking-wider text-faint uppercase">Pessoas</p>
          <div className="space-y-0.5">
            {people.map((person) => (
              <NavItem
                key={person.id}
                icon="users"
                label={person.name}
                count={holderCounts.get(person.id) ?? 0}
                activeState={filters.holderId === person.id}
                onClick={() =>
                  setFilter({ ...EMPTY_FILTERS, holderId: person.id, query: filters.query })
                }
                dropKey={`person:${person.id}`}
                onDropItem={(itemId) => dropOnto(itemId, { holderId: person.id }, `nome de ${person.name}`)}
              />
            ))}
          </div>
        </div>
      ) : null}

      {typeGroups.map(([heading, entries]) => (
        <div key={heading}>
          <p className="mb-1 px-2.5 text-[11px] font-medium tracking-wider text-faint uppercase">{heading}</p>
          <div className="space-y-0.5">
            {entries.map((entry) =>
              entry.kind === 'family' ? (
                <NavItem
                  key={entry.family.id}
                  icon={entry.family.icon}
                  accent={entry.family.accent}
                  label={entry.family.label}
                  count={entry.count}
                  activeState={filters.family === entry.family.id}
                  onClick={() =>
                    setFilter({ ...EMPTY_FILTERS, family: entry.family.id, query: filters.query })
                  }
                />
              ) : (
                <NavItem
                  key={entry.type.id}
                  icon={entry.type.icon}
                  accent={entry.type.accent}
                  label={entry.type.label}
                  count={entry.count}
                  activeState={filters.type === entry.type.id}
                  onClick={() =>
                    setFilter({ ...EMPTY_FILTERS, type: entry.type.id, query: filters.query })
                  }
                />
              ),
            )}
          </div>
        </div>
      ))}
      {typeCounts.size === 0 ? (
        <p className="px-2.5 text-xs text-faint">Nenhum item ainda.</p>
      ) : null}

      <div>
        <div className="mb-1 flex items-center justify-between pr-1.5">
          <p className="px-2.5 text-[11px] font-medium tracking-wider text-faint uppercase">Pastas</p>
          <button
            type="button"
            aria-label="Nova pasta"
            onClick={() => {
              setAddingFolder((open) => !open);
              setNewFolder('');
            }}
            className="tap-target flex h-6 w-6 items-center justify-center rounded-md text-faint transition hover:bg-raised hover:text-ink"
          >
            <Icon name={addingFolder ? 'x' : 'plus'} size={13} />
          </button>
        </div>
        {addingFolder ? (
          <div className="px-1 pb-1.5">
            <TextInput
              autoFocus
              value={newFolder}
              onChange={(event) => setNewFolder(event.target.value)}
              placeholder="Nome da pasta"
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  const name = newFolder.trim();
                  if (name) void actions.saveFolder(name);
                  setAddingFolder(false);
                  setNewFolder('');
                } else if (event.key === 'Escape') {
                  event.stopPropagation();
                  setAddingFolder(false);
                  setNewFolder('');
                }
              }}
            />
          </div>
        ) : null}
        <div className="space-y-0.5">
          {folders.map(({ folder, count }) => (
            <div key={folder} className="group/folder relative">
              <NavItem
                icon="folder"
                label={folder}
                count={count}
                activeState={filters.folder === folder}
                onClick={() => setFilter({ ...EMPTY_FILTERS, folder, query: filters.query })}
                dropKey={`folder:${folder}`}
                onDropItem={(itemId) => dropOnto(itemId, { folder }, `“${folder}”`)}
              />
              {count === 0 && explicitFolders.has(folder) ? (
                <button
                  type="button"
                  aria-label={`Remover pasta ${folder}`}
                  onClick={() => {
                    void actions.removeFolder(folder);
                    if (filters.folder === folder) setFilter({ ...EMPTY_FILTERS, query: filters.query });
                  }}
                  className="tap-target absolute top-1/2 right-1.5 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md bg-surface text-faint opacity-0 transition group-hover/folder:opacity-100 hover:text-danger focus-visible:opacity-100 pointer-coarse:opacity-100"
                >
                  <Icon name="x" size={12} />
                </button>
              ) : null}
            </div>
          ))}
          {folders.length === 0 && !addingFolder ? (
            <p className="px-2.5 text-xs text-faint">Nenhuma pasta ainda.</p>
          ) : null}
        </div>
      </div>

      {tags.length > 0 ? (
        <div>
          <p className="mb-1 px-2.5 text-[11px] font-medium tracking-wider text-faint uppercase">Tags</p>
          <div className="flex flex-wrap gap-1 px-1.5">
            {tags.slice(0, 24).map(({ tag, count }) => (
              <button
                key={tag}
                type="button"
                onClick={() =>
                  setFilter(
                    filters.tag === tag
                      ? { ...EMPTY_FILTERS, query: filters.query }
                      : { ...EMPTY_FILTERS, tag, query: filters.query },
                  )
                }
                className={`rounded-md px-2 py-1 text-xs transition ${
                  filters.tag === tag ? 'bg-accent/15 text-accent' : 'bg-raised text-muted hover:text-ink'
                }`}
              >
                {tag} <span className="text-faint">{count}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-auto border-t border-line-soft pt-3">
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-muted transition hover:bg-raised hover:text-ink"
        >
          <Icon name="settings" size={15} />
          <span className="min-w-0 flex-1 truncate">{account?.email ?? 'Configurações'}</span>
        </button>
      </div>
    </nav>
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-3 pt-[calc(env(safe-area-inset-top,0px)+0.625rem)] pb-2.5 sm:px-4">
        <IconButton
          icon="layers"
          label="Menu"
          className="lg:hidden"
          onClick={() => setSidebarOpen((open) => !open)}
        />
        <div className="hidden items-center gap-2 lg:flex">
          <Logo size={24} />
          <span className="text-sm font-semibold tracking-tight text-ink">Keeper</span>
        </div>

        <div className="relative mx-auto w-full max-w-xl">
          <Icon name="search" size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
          <input
            ref={searchRef}
            value={filters.query}
            onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
            placeholder="Buscar por nome, serviço, tag…"
            className="w-full rounded-lg border border-line bg-canvas py-2 pr-16 pl-9 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none pointer-coarse:rounded-xl pointer-coarse:py-3 pointer-coarse:pl-10"
            type="search"
            autoComplete="off"
          />
          <kbd className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-faint sm:block">
            Ctrl K
          </kbd>
        </div>

        <SyncBadge />
        {/* On phones these commands live in the bottom bar, within thumb reach.
            The wrapper does the hiding: a `hidden` merged into the buttons' own
            class list loses to their base `inline-flex` in the cascade. */}
        <div className="hidden items-center gap-2 lg:flex">
          <IconButton icon="wand" label="Gerador" onClick={() => setGeneratorOpen(true)} />
          <IconButton icon="lock" label="Bloquear (Ctrl+L)" onClick={actions.lock} />
          <Button variant="primary" icon="plus" onClick={() => setEditing({ item: null })} className="shrink-0">
            Novo
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="hidden lg:flex">{sidebar}</div>
        {sidebarOpen ? (
          <div className="fixed inset-0 z-40 flex lg:hidden">
            <div className="absolute inset-0 bg-black/60" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
            <div className="animate-in relative">{sidebar}</div>
          </div>
        ) : null}

        <main className="flex min-w-0 flex-1 flex-col">
          {expiring.list.length > 0 ? (
            /* The sidebar carries these filters, but on a phone it hides behind
               the menu button — and expiry is the one signal that must not wait
               for a drawer to be opened. */
            <div className="flex items-center gap-2 overflow-x-auto border-b border-line px-4 py-2 lg:hidden">
              {(
                [
                  ['expired', 'warning', 'text-danger bg-danger/10', 'vencido', 'vencidos'],
                  ['soon', 'clock', 'text-warn bg-warn/10', 'vence em breve', 'vencem em breve'],
                ] as const
              ).map(([status, icon, tone, singular, plural]) => {
                const count = expiring.list.filter((entry) => entry.status === status).length;
                if (count === 0) return null;
                const isActive = filters.expiry === status;
                return (
                  <button
                    key={status}
                    type="button"
                    onClick={() =>
                      setFilter(
                        isActive
                          ? { ...EMPTY_FILTERS, query: filters.query }
                          : { ...EMPTY_FILTERS, expiry: status, query: filters.query },
                      )
                    }
                    className={`flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition pointer-coarse:rounded-lg pointer-coarse:px-3 pointer-coarse:py-2 pointer-coarse:text-[13px] ${tone} ${
                      isActive ? 'ring-1 ring-current' : ''
                    }`}
                  >
                    <Icon name={icon} size={12} />
                    {count} {count === 1 ? singular : plural}
                  </button>
                );
              })}
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
            <p className="text-xs text-muted">
              {visible.length} {visible.length === 1 ? 'item' : 'itens'}
              {filters.view === 'trash' ? ' na lixeira' : ''}
            </p>
            <div className="flex items-center gap-2">
              {filters.view === 'trash' && trashed.length > 0 ? (
                <Button
                  size="sm"
                  variant="danger"
                  icon="trash"
                  onClick={() => {
                    if (confirm(`Esvaziar a lixeira? ${trashed.length} item(ns) serão apagados definitivamente.`)) {
                      void actions.emptyTrash();
                      setSelectedId(null);
                    }
                  }}
                >
                  Esvaziar
                </Button>
              ) : null}
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as SortMode)}
                className="rounded-lg border border-line bg-canvas px-2 py-1 text-xs text-muted focus:border-accent focus:outline-none pointer-coarse:rounded-[10px] pointer-coarse:px-3 pointer-coarse:py-2"
                aria-label="Ordenar"
              >
                <option value="updated">Recentes</option>
                <option value="name">Nome</option>
                <option value="created">Criação</option>
                <option value="type">Tipo</option>
              </select>
            </div>
          </div>

          <PullToSync
            enabled={coarsePointer}
            className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-[env(safe-area-inset-bottom,0px)]"
            onSync={async () => {
              if (!connected) {
                actions.notify('Sem conexão com o Drive — conecte a conta nas Configurações para sincronizar.');
                return;
              }
              await actions.syncNow();
            }}
          >
            {visible.length === 0 ? (
              <EmptyState
                icon={filters.query ? 'search' : 'key'}
                title={filters.query ? 'Nada encontrado' : filters.view === 'trash' ? 'Lixeira vazia' : 'Cofre vazio'}
                description={
                  filters.query
                    ? 'Tente outro termo ou limpe os filtros da barra lateral.'
                    : 'Guarde tokens, chaves SSH, credenciais de registry, .env e o que mais você consultar todo dia.'
                }
                action={
                  filters.view === 'active' && !filters.query ? (
                    <Button variant="primary" icon="plus" onClick={() => setEditing({ item: null })}>
                      Adicionar o primeiro segredo
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <ul className="divide-y divide-[var(--color-line-soft)]">
                {visible.map((item) => {
                  const type = getType(item.type);
                  const quick = primarySecret(item);
                  const expiry = expiring.byItem.get(item.id);
                  return (
                    <li key={item.id}>
                      <SwipeableRow
                        enabled={coarsePointer && filters.view === 'active' && !item.deletedAt}
                        open={swipeOpen?.id === item.id ? swipeOpen.side : null}
                        onOpenChange={(side) => setSwipeOpen(side ? { id: item.id, side } : null)}
                        canCopy={!!quick}
                        onCopy={() => {
                          if (!quick) return;
                          void copy(quick.value, `swipe:${item.id}`).then((result) => {
                            if (result.ok) actions.notify('Copiado para a área de transferência.');
                          });
                        }}
                        favoriteLabel={item.favorite ? 'Remover' : 'Favoritar'}
                        onFavorite={() => void actions.toggleFavorite(item.id)}
                        onTrash={() => {
                          void actions.trashItem(item.id);
                          if (selectedId === item.id) setSelectedId(null);
                        }}
                      >
                      <div
                        role="button"
                        tabIndex={0}
                        data-row-selected={selectedId === item.id || undefined}
                        draggable={!coarsePointer}
                        onDragStart={(event) => {
                          event.dataTransfer.setData('text/plain', item.id);
                          event.dataTransfer.effectAllowed = 'move';
                          setDragging(item.id);
                        }}
                        onDragEnd={() => {
                          setDragging(null);
                          setDropTarget(null);
                        }}
                        onClick={() => setSelectedId(item.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setSelectedId(item.id);
                          }
                        }}
                        className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 transition pointer-coarse:py-3 ${
                          selectedId === item.id ? 'bg-accent/8' : 'hover:bg-raised'
                        }`}
                      >
                        <span className="relative shrink-0">
                        <span
                          className="flex h-8 w-8 items-center justify-center rounded-lg pointer-coarse:h-10 pointer-coarse:w-10 pointer-coarse:rounded-[10px]"
                          style={{
                            color: type.accent,
                            backgroundColor: `color-mix(in srgb, ${type.accent} 13%, transparent)`,
                          }}
                        >
                          <Icon name={type.icon} size={15} />
                        </span>
                        {/* Whose country this paper is from, read without opening it. */}
                        {item.country ? (
                          <span className="absolute -right-1 -bottom-1 rounded-[3px] bg-surface p-[1px] leading-none">
                            <CountryMark
                              code={item.country}
                              size={13}
                              title={countryName(item.country)}
                            />
                          </span>
                        ) : null}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1.5 truncate text-sm text-ink pointer-coarse:text-base">
                            {item.favorite ? <Icon name="star" size={12} className="shrink-0 text-warn" /> : null}
                            {item.name || 'Sem título'}
                          </p>
                          <p className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted pointer-coarse:text-[13px]">
                            {/* The holder reads from the row in "Tudo"/"Favoritos";
                                under a person's own filter it would only repeat. */}
                            {!filters.holderId && item.holderId && holderNames.has(item.holderId) ? (
                              <>
                                <Icon name="users" size={10} className="shrink-0" />
                                <span className="max-w-[45%] shrink-0 truncate">
                                  {holderNames.get(item.holderId)}
                                </span>
                                <span aria-hidden="true">·</span>
                              </>
                            ) : null}
                            <span className="min-w-0 truncate">
                              {item.description ||
                                item.fields.username ||
                                item.fields.service ||
                                item.fields.registry ||
                                item.fields.host ||
                                type.label}
                            </span>
                          </p>
                        </div>
                        {/* Expiry stays visible at every width — it matters most on
                            the phone in the queue at the registry office. Folder and
                            age are desktop garnish. */}
                        {expiry ? (
                          <Badge
                            className={`shrink-0 ${
                              expiry.status === 'expired'
                                ? 'bg-danger/12 text-danger'
                                : 'bg-warn/12 text-warn'
                            }`}
                          >
                            <Icon name={expiry.status === 'expired' ? 'warning' : 'clock'} size={11} />
                            {describeExpiry(expiry)}
                          </Badge>
                        ) : null}
                        {selectedId === item.id ? (
                          /* Shortcut hints live where the garnish was: only on
                             the selected row, only where a keyboard exists. */
                          <div className="hidden shrink-0 items-center gap-2.5 text-xs text-faint lg:flex">
                            {quick ? (
                              <span className="flex items-center gap-1">
                                <Kbd>C</Kbd> copiar
                              </span>
                            ) : null}
                            <span className="flex items-center gap-1">
                              <Kbd>E</Kbd> editar
                            </span>
                            <span className="flex items-center gap-1">
                              <Kbd>F</Kbd> favoritar
                            </span>
                          </div>
                        ) : (
                          <div className="hidden shrink-0 items-center gap-2 sm:flex">
                            {item.folder ? <Badge className="bg-raised text-muted">{item.folder}</Badge> : null}
                            <span className="w-12 text-right text-xs text-faint">{relativeTime(item.updatedAt)}</span>
                          </div>
                        )}
                        {quick && !item.deletedAt ? (
                          <div onClick={(event) => event.stopPropagation()}>
                            <CopyButton
                              value={quick.value}
                              itemKey={`list:${item.id}`}
                              label={`Copiar ${quick.label.toLowerCase()}`}
                            />
                          </div>
                        ) : null}
                      </div>
                      </SwipeableRow>
                    </li>
                  );
                })}
              </ul>
            )}
          </PullToSync>
        </main>

        {selected ? (
          <aside className="fixed inset-0 z-30 flex flex-col bg-canvas lg:relative lg:inset-auto lg:z-auto lg:w-[420px] lg:shrink-0 lg:border-l lg:border-line lg:bg-surface">
            <ItemDetail
              item={selected}
              onEdit={() => setEditing({ item: selected })}
              onClose={() => setSelectedId(null)}
            />
          </aside>
        ) : null}
      </div>

      {/* Thumb-reach command bar on phones; desktop keeps these in the header. */}
      <nav
        aria-label="Ações rápidas"
        className="flex shrink-0 items-end justify-around border-t border-line bg-surface px-2 pt-2 pb-[calc(env(safe-area-inset-bottom,0px)+0.5rem)] lg:hidden"
      >
        <BarAction icon="wand" label="Gerador" onClick={() => setGeneratorOpen(true)} />
        <BarAction
          icon="star"
          label="Favoritos"
          active={filters.favoritesOnly}
          onClick={() =>
            setFilter(
              filters.favoritesOnly
                ? { ...EMPTY_FILTERS, query: filters.query }
                : { ...EMPTY_FILTERS, favoritesOnly: true, query: filters.query },
            )
          }
        />
        <button
          type="button"
          onClick={() => setEditing({ item: null })}
          className="-mt-6 flex w-[72px] flex-col items-center gap-1 text-[11px] text-ink"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-white shadow-lg shadow-accent/40">
            <Icon name="plus" size={26} />
          </span>
          Novo
        </button>
        <BarAction icon="settings" label="Ajustes" onClick={() => setSettingsOpen(true)} />
        <BarAction icon="lock" label="Bloquear" onClick={actions.lock} />
      </nav>

      {editing ? (
        <ItemEditor
          item={editing.item}
          // Creating while a sidebar filter is active means "inside it": the
          // filtered person or folder arrives pre-selected on the new item.
          preset={{
            ...(filters.holderId ? { holderId: filters.holderId } : {}),
            ...(filters.folder ? { folder: filters.folder } : {}),
          }}
          onClose={() => setEditing(null)}
          onSave={(item) => {
            void actions.saveItem(item);
            setEditing(null);
            setSelectedId(item.id);
          }}
        />
      ) : null}

      <GeneratorDialog open={generatorOpen} onClose={() => setGeneratorOpen(false)} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      <datalist id="keeper-folders">
        {folders.map(({ folder }) => (
          <option key={folder} value={folder} />
        ))}
      </datalist>
    </div>
  );
}
