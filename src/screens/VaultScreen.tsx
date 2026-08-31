/** The unlocked application: sidebar, list and detail pane. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { getAllTypes, getFamily, getType, isSecretKind, type SecretTypeDef, type VaultItem } from '../lib/model';
import { DEFAULT_WARNING_DAYS, collectExpiring, describeExpiry } from '../lib/expiry';
import { EMPTY_FILTERS, applyFilters, collectFolders, collectTags, type Filters, type SortMode } from '../lib/search';
import { activeFolders, activeItems, activePeople, trashedItems } from '../lib/vault';
import {
  buildFolderTree,
  type FolderNode,
  flattenFolderTree,
  isWithinFolder,
  normalizeFolderPath,
} from '../lib/folders';
import type { TypeFamily } from '../lib/documents';
import { useKeeper } from '../state/keeper';
import {
  Badge,
  Button,
  ContextMenu,
  EmptyState,
  IconButton,
  Kbd,
  Select,
  TextInput,
  type MenuItem,
} from '../components/ui';
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
import * as storage from '../lib/storage';
import { OpenSharedDialog } from '../components/InviteCode';
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

/**
 * The line between the two halves of the sidebar.
 *
 * A vault with forty folders and one with two want opposite things from the
 * same screen, and only the person looking knows which — so the divider drags,
 * with the arrow keys as the other way in. Pointer events, so a thumb on the
 * drawer works the same as a mouse.
 */
/** Nothing below this is a list any more, it is a sliver. */
/** Sentinel option: not a workspace, an action. */
const OPEN_SHARED = '__open_shared__';

const SIDEBAR_MIN_PANE = 88;
const SIDEBAR_HANDLE = 12;

function SidebarSplitter({ onResize }: { onResize: (dy: number) => void }) {
  const last = useRef<{ y: number; pointerId: number } | null>(null);

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Redimensionar as seções da barra lateral"
      tabIndex={0}
      data-sidebar-splitter
      onPointerDown={(event) => {
        last.current = { y: event.clientY, pointerId: event.pointerId };
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          /* synthetic pointers (tests) have no capture */
        }
      }}
      onPointerMove={(event) => {
        const start = last.current;
        if (!start || event.pointerId !== start.pointerId) return;
        // Deltas since the previous move, not since the press: the pane clamps
        // at its limits, and an absolute offset would keep counting past them.
        onResize(event.clientY - start.y);
        last.current = { y: event.clientY, pointerId: event.pointerId };
      }}
      onPointerUp={() => {
        last.current = null;
      }}
      onPointerCancel={() => {
        last.current = null;
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        onResize(event.key === 'ArrowDown' ? 24 : -24);
      }}
      className="group flex h-3 shrink-0 cursor-row-resize touch-none items-center px-3 focus-visible:outline-none"
    >
      <span className="h-px w-full rounded bg-line transition group-hover:h-0.5 group-hover:bg-accent/60 group-focus-visible:h-0.5 group-focus-visible:bg-accent" />
    </div>
  );
}

function SyncBadge() {
  const { sync, online, connected, actions } = useKeeper();
  const map = {
    syncing: { icon: 'refresh', text: 'Sincronizando…', tone: 'text-muted' },
    saved: { icon: 'cloud', text: 'Sincronizado', tone: 'text-ok' },
    offline: { icon: 'cloudOff', text: 'Somente local', tone: 'text-warn' },
    pending: { icon: 'refresh', text: 'Envio pendente', tone: 'text-warn' },
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
  const { payload, actions, account, connected, driveMovedElsewhere, guest, workspaces, activeWorkspace } =
    useKeeper();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortMode>('updated');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ item: VaultItem | null } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Set when something on screen sends the user to a particular pane. */
  const [settingsPane, setSettingsPane] = useState<string | undefined>(undefined);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [swipeOpen, setSwipeOpen] = useState<{ id: string; side: SwipeSide } | null>(null);
  /** Right-click on a row: the pointer position and what was under it. */
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; item: VaultItem } | null>(null);
  const [openShared, setOpenShared] = useState(false);
  const [addingFolder, setAddingFolder] = useState(false);
  /**
   * How tall the items half is, in px. Null while nobody has dragged: each half
   * sizes itself to its content, which is right until it is not.
   */
  const [itemsHeight, setItemsHeight] = useState<number | null>(() => storage.loadSidebarSplit());
  const panesRef = useRef<HTMLDivElement>(null);
  const itemsPaneRef = useRef<HTMLDivElement>(null);
  /**
   * Dragging a row onto a folder or a person files it there. Mouse only: on
   * touch the horizontal swipe already owns the gesture, and the sidebar is a
   * drawer that is not even on screen while the list is.
   */
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  /** A folder being dragged to another parent, and which folders are open. */
  const [draggingFolder, setDraggingFolder] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [addingChildOf, setAddingChildOf] = useState<string | null>(null);
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
  /** Folders as a tree: paths carry the hierarchy, the sidebar draws it. */
  const folderTree = useMemo(
    () => buildFolderTree(folders.map((entry) => entry.folder), new Map(folders.map((entry) => [entry.folder, entry.count]))),
    [folders],
  );
  const visibleFolders = useMemo(() => {
    // Open by default: a tree that hides everything on first sight teaches
    // nothing about what is in the vault. Collapsing is the explicit act.
    const expanded = new Set<string>();
    const walk = (nodes: typeof folderTree) => {
      for (const node of nodes) {
        if (!collapsed.has(node.path)) expanded.add(node.path);
        walk(node.children);
      }
    };
    walk(folderTree);
    return flattenFolderTree(folderTree, expanded);
  }, [folderTree, collapsed]);
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

  /**
   * What the right button offers on a row.
   *
   * Everything here has another way in — the detail pane, a swipe, dragging the
   * row onto a folder — but all of those cost a trip somewhere else. This is the
   * desktop shortcut for the things people do in a list: file it, mark it, throw
   * it away.
   */
  const rowMenuItems = (item: VaultItem): MenuItem[] => {
    const quick = primarySecret(item);
    const copyItem: MenuItem[] = quick
      ? [
          {
            id: 'copy',
            label: `Copiar ${quick.label.toLocaleLowerCase('pt-BR')}`,
            icon: 'copy',
            onSelect: () => {
              void copy(quick.value, `menu:${item.id}`).then((result) => {
                if (result.ok) actions.notify('Copiado para a área de transferência.');
              });
            },
          },
        ]
      : [];

    // A guest is looking at someone else's vault: nothing here may change it.
    if (guest) return copyItem;

    if (item.deletedAt) {
      return [
        ...copyItem,
        { id: 'restore', label: 'Restaurar', icon: 'refresh', onSelect: () => void actions.restoreItem(item.id) },
        {
          id: 'purge',
          label: 'Apagar definitivamente',
          icon: 'trash',
          danger: true,
          onSelect: () => {
            if (confirm(`Apagar “${item.name || 'Sem título'}” para sempre? Não há como desfazer.`)) {
              void actions.purgeItem(item.id);
              if (selectedId === item.id) setSelectedId(null);
            }
          },
        },
      ];
    }

    return [
      { id: 'edit', label: 'Editar', icon: 'pencil', onSelect: () => setEditing({ item }) },
      ...copyItem,
      {
        id: 'favorite',
        label: item.favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos',
        icon: 'star',
        checked: item.favorite,
        onSelect: () => void actions.toggleFavorite(item.id),
      },
      {
        id: 'folder',
        label: 'Mover para',
        icon: 'folder',
        hint: item.folder,
        children: [
          {
            id: 'folder:none',
            label: 'Sem pasta',
            checked: !item.folder,
            onSelect: () => dropOnto(item.id, { folder: '' }, 'nenhuma pasta'),
          },
          ...folders.map((entry) => ({
            id: `folder:${entry.folder}`,
            label: entry.folder,
            icon: 'folder',
            checked: item.folder === entry.folder,
            onSelect: () => dropOnto(item.id, { folder: entry.folder }, entry.folder),
          })),
        ],
      },
      {
        id: 'holder',
        label: 'Titular',
        icon: 'user',
        children: [
          {
            id: 'holder:none',
            label: 'Sem titular',
            checked: !item.holderId,
            onSelect: () => dropOnto(item.id, { holderId: '' }, 'ninguém'),
          },
          ...people.map((person) => ({
            id: `holder:${person.id}`,
            label: person.name,
            icon: 'user',
            checked: item.holderId === person.id,
            onSelect: () => dropOnto(item.id, { holderId: person.id }, `nome de ${person.name}`),
          })),
        ],
      },
      {
        id: 'trash',
        label: 'Mover para a lixeira',
        icon: 'trash',
        danger: true,
        onSelect: () => {
          void actions.trashItem(item.id);
          if (selectedId === item.id) setSelectedId(null);
        },
      },
    ];
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
    let note = 0;
    for (const item of active) {
      const category = getType(item.type).category;
      if (category === 'doc') doc += 1;
      else if (category === 'note') note += 1;
      else dev += 1;
    }
    return { dev, doc, note };
  }, [active]);

  /**
   * The filter bar only offers what the vault actually holds — a picker full
   * of countries with nothing behind them is a list of dead ends. Counts come
   * from the active items, whatever the current filter is, so the bar never
   * narrows itself out of the options you might switch to.
   */
  const countryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of active) {
      if (item.country) counts.set(item.country, (counts.get(item.country) ?? 0) + 1);
    }
    const collator = new Intl.Collator('pt-BR', { sensitivity: 'base' });
    return [...counts.entries()]
      .map(([code, count]) => ({ code, name: countryName(code), count }))
      .sort((a, b) => collator.compare(a.name, b.name));
  }, [active]);

  const typeOptions = useMemo(() => {
    const collator = new Intl.Collator('pt-BR', { sensitivity: 'base' });
    return [...typeCounts.entries()]
      .map(([id, count]) => ({ id, label: getType(id).label, count }))
      .sort((a, b) => collator.compare(a.label, b.label));
    // `payload` re-registers custom types, so their labels belong in the deps.
  }, [typeCounts, payload]);

  const activeFilterCount = [
    filters.holderId,
    filters.country,
    filters.type,
    filters.family,
    filters.folder,
    filters.tag,
    filters.category,
    filters.expiry,
    filters.favoritesOnly || null,
  ].filter(Boolean).length;

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

  /** Moves a folder under another (or to the root) and reports the refusal. */
  const dropFolderInto = (from: string, toParent: string) => {
    setDraggingFolder(null);
    setDropTarget(null);
    void actions.moveFolder(from, toParent).then((error) => {
      if (error) return actions.notify(error);
      // Follow the folder if the sidebar was filtered by it.
      if (filters.folder && isWithinFolder(filters.folder, from)) {
        setFilter({ ...EMPTY_FILTERS, query: filters.query });
      }
    });
  };

  /**
   * One folder in the tree: a disclosure triangle when it has children, the
   * count of everything below it, and three drop behaviours — an item lands
   * in it, another folder becomes its child, and it can itself be dragged.
   */
  const FolderRow = ({ node }: { node: FolderNode }) => {
    const dropKey = `folder:${node.path}`;
    const armed = (!!dragging || !!draggingFolder) && draggingFolder !== node.path;
    const forbidden = !!draggingFolder && isWithinFolder(node.path, draggingFolder);
    const over = dropTarget === dropKey && !forbidden;
    const open = !collapsed.has(node.path);
    return (
      <div className="group/folder relative flex items-center" style={{ paddingLeft: node.depth * 14 }}>
        {node.children.length > 0 ? (
          <button
            type="button"
            aria-label={open ? `Recolher ${node.name}` : `Expandir ${node.name}`}
            aria-expanded={open}
            onClick={() =>
              setCollapsed((current) => {
                const next = new Set(current);
                if (next.has(node.path)) next.delete(node.path);
                else next.add(node.path);
                return next;
              })
            }
            className="tap-target flex h-5 w-4 shrink-0 items-center justify-center text-faint transition hover:text-ink"
          >
            <Icon name="chevron" size={11} className={open ? 'rotate-90' : ''} />
          </button>
        ) : (
          <span className="w-4 shrink-0" aria-hidden="true" />
        )}
        <button
          type="button"
          data-folder-row={node.path}
          data-drop-target={dropKey}
          draggable={!coarsePointer}
          onDragStart={(event) => {
            event.dataTransfer.setData('application/x-keeper-folder', node.path);
            event.dataTransfer.setData('text/plain', '');
            event.dataTransfer.effectAllowed = 'move';
            setDraggingFolder(node.path);
          }}
          onDragEnd={() => {
            setDraggingFolder(null);
            setDropTarget(null);
          }}
          onDragOver={(event) => {
            if (forbidden) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            if (dropTarget !== dropKey) setDropTarget(dropKey);
          }}
          onDragLeave={() => setDropTarget((current) => (current === dropKey ? null : current))}
          onDrop={(event) => {
            event.preventDefault();
            const folder = event.dataTransfer.getData('application/x-keeper-folder');
            if (folder) return dropFolderInto(folder, node.path);
            const itemId = event.dataTransfer.getData('text/plain');
            if (itemId) dropOnto(itemId, { folder: node.path }, `“${node.path}”`);
          }}
          onClick={() => setFilter({ ...EMPTY_FILTERS, folder: node.path, query: filters.query })}
          className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition pointer-coarse:py-2.5 ${
            over
              ? 'bg-accent/25 text-ink ring-2 ring-accent'
              : armed
                ? 'text-muted ring-1 ring-line ring-dashed'
                : filters.folder === node.path
                  ? 'bg-accent/12 text-ink'
                  : 'text-muted hover:bg-raised hover:text-ink'
          }`}
        >
          <Icon name="folder" size={15} />
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          {node.total > 0 ? <span className="text-xs text-faint tabular-nums">{node.total}</span> : null}
        </button>
        <span className="absolute right-1.5 flex items-center gap-0.5 opacity-0 transition group-hover/folder:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
          <button
            type="button"
            aria-label={`Nova subpasta em ${node.name}`}
            onClick={() => {
              setAddingChildOf(node.path);
              setNewFolder('');
              setCollapsed((current) => {
                const next = new Set(current);
                next.delete(node.path);
                return next;
              });
            }}
            className="tap-target flex h-6 w-6 items-center justify-center rounded-md bg-surface text-faint transition hover:text-ink"
          >
            <Icon name="plus" size={12} />
          </button>
          {node.total === 0 && node.children.length === 0 && explicitFolders.has(node.path) ? (
            <button
              type="button"
              aria-label={`Remover pasta ${node.name}`}
              onClick={() => {
                void actions.removeFolder(node.path);
                if (filters.folder === node.path) setFilter({ ...EMPTY_FILTERS, query: filters.query });
              }}
              className="tap-target flex h-6 w-6 items-center justify-center rounded-md bg-surface text-faint transition hover:text-danger"
            >
              <Icon name="x" size={12} />
            </button>
          ) : null}
        </span>
      </div>
    );
  };

  /** One compact picker in the list's filter bar. */
  const FilterSelect = ({
    label,
    value,
    onChange,
    options,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: string; count: number }[];
  }) => (
    <Select
      aria-label={label}
      size="sm"
      value={value}
      onChange={onChange}
      className={`shrink-0 ${value ? 'border-accent bg-accent/10 text-ink' : 'text-muted'}`}
      options={[
        { value: '', label: `${label}: todos` },
        ...options.map((option) => ({ value: option.value, label: `${option.label} (${option.count})` })),
      ]}
    />
  );

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

  /**
   * Moves the divider by `dy` px, keeping both halves usable. The first drag
   * has no stored height to start from, so it measures what the items half is
   * occupying right now — the line then moves from where the user sees it.
   */
  const resizeSidebar = (dy: number) => {
    const total = panesRef.current?.getBoundingClientRect().height ?? 0;
    const measured = itemsPaneRef.current?.getBoundingClientRect().height ?? 0;
    const room = Math.max(SIDEBAR_MIN_PANE, total - SIDEBAR_MIN_PANE - SIDEBAR_HANDLE);
    setItemsHeight((current) => {
      const next = Math.min(Math.max((current ?? measured) + dy, SIDEBAR_MIN_PANE), room);
      storage.saveSidebarSplit(next);
      return next;
    });
  };

  const sidebar = (
    <nav className="flex h-full w-64 shrink-0 flex-col border-r border-line bg-surface">
      {/* Which vault this is. A person can hold their own and any number of
          vaults other people shared with them, all open at once — switching is
          not signing out, so coming back asks for no password. */}
      <div className="shrink-0 border-b border-line px-3 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)] pb-2.5 lg:pt-3">
        <label className="sr-only" htmlFor="keeper-workspace">
          Cofre
        </label>
        <Select
          id="keeper-workspace"
          aria-label="Cofre"
          className="w-full"
          value={activeWorkspace}
          onChange={(next) => {
            // The same explanation as the entry screen: whoever picks this from
            // the switcher has just as little idea what Google is about to ask.
            if (next === OPEN_SHARED) return setOpenShared(true);
            void actions.switchWorkspace(next);
          }}
          options={[
            ...workspaces.map((workspace) => ({
              value: workspace.id,
              label: workspace.label,
              icon: workspace.kind === 'shared' ? 'share' : 'layers',
            })),
            { value: OPEN_SHARED, label: 'Abrir um cofre partilhado…', icon: 'plus' },
          ]}
        />
      </div>
      {/* The account row is the way out to Settings and to what is syncing —
          it stays put while the folders and types scroll past it. */}
      <div ref={panesRef} className="flex min-h-0 flex-1 flex-col">
      <div
        ref={itemsPaneRef}
        data-sidebar-scroll
        style={itemsHeight === null ? undefined : { height: itemsHeight, flex: '0 0 auto' }}
        className={`flex min-h-0 flex-col gap-4 overflow-y-auto px-3 pt-[calc(env(safe-area-inset-top,0px)+1rem)] pb-3 lg:pt-4 ${
          itemsHeight === null ? 'max-h-[60%] flex-none' : ''
        }`}
      >
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
        {categoryCounts.note > 0 ? (
          <NavItem
            icon="note"
            label="Notas"
            count={categoryCounts.note}
            activeState={filters.category === 'note'}
            onClick={() => setFilter({ ...EMPTY_FILTERS, category: 'note', query: filters.query })}
          />
        ) : null}
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
      </div>

      <SidebarSplitter onResize={resizeSidebar} />

      {/* The folder tree gets a half of its own: it is the part that grows
          without limit, and it was pushing everything else off the screen. */}
      <div data-sidebar-folders className="min-h-0 flex-1 overflow-y-auto px-3 pt-2 pb-3">
        <div
          className={`mb-1 flex items-center justify-between rounded-lg pr-1.5 transition ${
            draggingFolder ? 'ring-1 ring-line ring-dashed' : ''
          } ${dropTarget === 'folder-root' ? 'bg-accent/20 ring-2 ring-accent' : ''}`}
          data-drop-target="folder-root"
          onDragOver={(event) => {
            if (!draggingFolder) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            setDropTarget('folder-root');
          }}
          onDragLeave={() => setDropTarget((current) => (current === 'folder-root' ? null : current))}
          onDrop={(event) => {
            const folder = event.dataTransfer.getData('application/x-keeper-folder');
            if (!folder) return;
            event.preventDefault();
            // Dropping on the heading is how a folder leaves its parent.
            dropFolderInto(folder, '');
          }}
        >
          <p className="px-2.5 text-[11px] font-medium tracking-wider text-faint uppercase">
            {draggingFolder ? 'Pastas — solte aqui para tirar de dentro' : 'Pastas'}
          </p>
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
          {visibleFolders.map((node) => (
            <div key={node.path}>
              <FolderRow node={node} />
              {addingChildOf === node.path ? (
                <div className="px-1 py-1" style={{ paddingLeft: (node.depth + 1) * 14 + 4 }}>
                  <TextInput
                    autoFocus
                    value={newFolder}
                    onChange={(event) => setNewFolder(event.target.value)}
                    placeholder={`Subpasta de ${node.name}`}
                    onBlur={() => setAddingChildOf(null)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        const child = normalizeFolderPath(`${node.path}/${newFolder}`);
                        if (child !== node.path) void actions.saveFolder(child);
                        setAddingChildOf(null);
                        setNewFolder('');
                      } else if (event.key === 'Escape') {
                        event.stopPropagation();
                        setAddingChildOf(null);
                        setNewFolder('');
                      }
                    }}
                  />
                </div>
              ) : null}
            </div>
          ))}
          {folders.length === 0 && !addingFolder ? (
            <p className="px-2.5 text-xs text-faint">Nenhuma pasta ainda.</p>
          ) : null}
        </div>
      </div>

      </div>

      <div
        data-sidebar-footer
        className="shrink-0 border-t border-line bg-surface px-3 pt-2 pb-[calc(env(safe-area-inset-bottom,0px)+0.5rem)] lg:pb-2">
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
          {/* Nothing to create in a vault that is not yours. */}
          {guest ? null : (
            <Button variant="primary" icon="plus" onClick={() => setEditing({ item: null })} className="shrink-0">
              Novo
            </Button>
          )}
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
          {/* The vault moved and this device did not follow. It is still writing
              to a copy nobody else reads, so this cannot live behind a settings
              screen the user has no reason to open. */}
          {guest ? (
            <div
              data-guest-banner
              className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-accent/40 bg-accent/10 px-4 py-2.5 text-sm text-ink"
            >
              <Icon name="share" size={15} className="shrink-0 text-accent" />
              <span className="min-w-0 flex-1">
                Você está vendo um cofre partilhado com você{guest.label ? ` como “${guest.label}”` : ''}. Só
                leitura: nada do que estiver aqui é alterado por este aparelho.
              </span>
              <Button size="sm" icon="refresh" onClick={() => void actions.refreshSharedVault()}>
                Atualizar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (confirm('Tirar este cofre partilhado deste dispositivo? O cofre da outra pessoa não muda.')) {
                    actions.forgetSharedVault(`shared:${guest.vaultFileId}`);
                  }
                }}
              >
                Remover daqui
              </Button>
            </div>
          ) : null}

          {driveMovedElsewhere ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-warn/40 bg-warn/10 px-4 py-2.5 text-sm text-ink">
              <Icon name="warning" size={15} className="shrink-0 text-warn" />
              <span className="min-w-0 flex-1">
                Este cofre foi movido para uma pasta do Drive em outro aparelho. Este aqui parou de sincronizar
                para não gravar na cópia antiga.
              </span>
              <Button
                size="sm"
                onClick={() => {
                  setSettingsPane('conta');
                  setSettingsOpen(true);
                }}
              >
                Conectar à pasta
              </Button>
            </div>
          ) : null}

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
          {/* The same filters the sidebar carries, within reach of the list —
              on a phone the sidebar is a drawer, and on a desktop this is
              where the eye already is. Each picker only shows up when there
              is something to choose between. */}
          {filters.view === 'active' &&
          (people.length > 0 || countryOptions.length > 1 || typeOptions.length > 1) ? (
            <div className="flex items-center gap-2 overflow-x-auto border-b border-line px-4 py-2">
              {people.length > 0 ? (
                <FilterSelect
                  label="Pessoa"
                  value={filters.holderId ?? ''}
                  onChange={(value) => setFilter({ ...filters, holderId: value || null })}
                  options={people.map((person) => ({
                    value: person.id,
                    label: person.name,
                    count: holderCounts.get(person.id) ?? 0,
                  }))}
                />
              ) : null}
              {countryOptions.length > 1 ? (
                <FilterSelect
                  label="País"
                  value={filters.country ?? ''}
                  onChange={(value) => setFilter({ ...filters, country: value || null })}
                  options={countryOptions.map((country) => ({
                    value: country.code,
                    label: country.name,
                    count: country.count,
                  }))}
                />
              ) : null}
              {typeOptions.length > 1 ? (
                <FilterSelect
                  label="Tipo"
                  value={filters.type ?? ''}
                  onChange={(value) => setFilter({ ...filters, type: value || null, family: null })}
                  options={typeOptions.map((type) => ({
                    value: type.id,
                    label: type.label,
                    count: type.count,
                  }))}
                />
              ) : null}
              {folders.length > 0 ? (
                <FilterSelect
                  label="Pasta"
                  value={filters.folder ?? ''}
                  onChange={(value) => setFilter({ ...filters, folder: value || null })}
                  options={folders.map(({ folder, count }) => ({ value: folder, label: folder, count }))}
                />
              ) : null}
              {tags.length > 0 ? (
                <FilterSelect
                  label="Tag"
                  value={filters.tag ?? ''}
                  onChange={(value) => setFilter({ ...filters, tag: value || null })}
                  options={tags.map(({ tag, count }) => ({ value: tag, label: tag, count }))}
                />
              ) : null}
              {activeFilterCount > 0 ? (
                <button
                  type="button"
                  onClick={() => setFilter({ ...EMPTY_FILTERS, query: filters.query })}
                  className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs text-accent transition hover:bg-raised pointer-coarse:py-2"
                >
                  <Icon name="x" size={12} />
                  Limpar {activeFilterCount}
                </button>
              ) : null}
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
              <Select
                aria-label="Ordenar"
                size="sm"
                align="end"
                value={sort}
                onChange={(next) => setSort(next as SortMode)}
                options={[
                  { value: 'updated', label: 'Recentes' },
                  { value: 'name', label: 'Nome' },
                  { value: 'created', label: 'Criação' },
                  { value: 'type', label: 'Tipo' },
                ]}
              />
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
                        onContextMenu={(event) => {
                          // Touch keeps the swipe actions; this is the mouse's
                          // equivalent, and the browser's own menu is no use on
                          // a row of ours.
                          if (coarsePointer) return;
                          event.preventDefault();
                          setSelectedId(item.id);
                          setRowMenu({ x: event.clientX, y: event.clientY, item });
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setSelectedId(item.id);
                          }
                          // Shift+F10 and the menu key are how a keyboard asks
                          // for a context menu; the row is focusable, so it can.
                          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                            event.preventDefault();
                            const box = event.currentTarget.getBoundingClientRect();
                            setSelectedId(item.id);
                            setRowMenu({ x: box.left + 24, y: box.bottom - 4, item });
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

      {/* Thumb-reach command bar on phones; desktop keeps these in the header.
          `relative z-20` is load-bearing: every row in the list is positioned
          (the swipe layers need it), and a positioned element paints over a
          static one whatever the document order says — so the last rows were
          covering the + button that pokes up above this bar. Below the detail
          sheet (z-30) and the drawer (z-40), which are meant to cover it. */}
      <nav
        aria-label="Ações rápidas"
        className="relative z-20 flex shrink-0 items-end justify-around border-t border-line bg-surface px-2 pt-2 pb-[calc(env(safe-area-inset-bottom,0px)+0.5rem)] lg:hidden"
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
        {guest ? (
          <span className="w-[72px]" aria-hidden="true" />
        ) : (
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
        )}
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
      <OpenSharedDialog open={openShared} onClose={() => setOpenShared(false)} />

      {rowMenu ? (
        <ContextMenu
          at={rowMenu}
          label={`Ações de ${rowMenu.item.name || 'item sem título'}`}
          items={rowMenuItems(rowMenu.item)}
          onClose={() => setRowMenu(null)}
        />
      ) : null}

      <SettingsDialog
        open={settingsOpen}
        initialPane={settingsPane}
        onClose={() => {
          setSettingsOpen(false);
          setSettingsPane(undefined);
        }}
      />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />


    </div>
  );
}
