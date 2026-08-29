/** The unlocked application: sidebar, list and detail pane. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { SECRET_TYPES, getType, isSecretKind, type VaultItem } from '../lib/model';
import { DEFAULT_WARNING_DAYS, collectExpiring, describeExpiry } from '../lib/expiry';
import { EMPTY_FILTERS, applyFilters, collectFolders, collectTags, type Filters, type SortMode } from '../lib/search';
import { activeItems, activePeople, trashedItems } from '../lib/vault';
import { useKeeper } from '../state/keeper';
import { Badge, Button, EmptyState, IconButton } from '../components/ui';
import { Icon, Logo } from '../components/icons';
import { ItemDetail } from '../components/ItemDetail';
import { ItemEditor } from '../components/ItemEditor';
import { GeneratorDialog } from '../components/Generator';
import { SettingsDialog } from '../components/SettingsDialog';
import { CopyButton } from '../components/SecretValue';
import { useCloseOnBack } from '../components/use-close-on-back';

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
      className={`hidden items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs transition hover:bg-raised sm:flex ${state.tone}`}
    >
      <Icon name={state.icon} size={14} className={sync.status === 'syncing' ? 'animate-spin' : ''} />
      <span className="hidden md:inline">{state.text}</span>
    </button>
  );
}

export function VaultScreen() {
  const { payload, actions, account } = useKeeper();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortMode>('updated');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ item: VaultItem | null } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

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
  const folders = useMemo(() => collectFolders(items), [items]);
  const active = useMemo(() => activeItems(items), [items]);
  const trashed = useMemo(() => trashedItems(items), [items]);
  const selected = items.find((item) => item.id === selectedId) ?? null;

  // On a phone these are full-screen overlays, and the system back gesture is
  // how people dismiss them; dialogs get the same treatment inside Modal.
  useCloseOnBack(sidebarOpen, () => setSidebarOpen(false));
  useCloseOnBack(!!selected, () => setSelectedId(null));

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

  /** Only types actually in use, bucketed by origin so the sidebar stays short. */
  const typeGroups = useMemo(() => {
    const order = ['Portugal', 'Brasil', 'Geral', 'Desenvolvimento'];
    const buckets = new Map<string, typeof SECRET_TYPES>();
    for (const type of SECRET_TYPES) {
      if (!typeCounts.get(type.id)) continue;
      const heading = type.category === 'dev' ? 'Desenvolvimento' : type.group;
      buckets.set(heading, [...(buckets.get(heading) ?? []), type]);
    }
    return [...buckets.entries()].sort(
      ([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99),
    );
  }, [typeCounts]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        actions.lock();
      } else if (event.key === 'Escape' && !editing && !settingsOpen) {
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, editing, settingsOpen]);

  const setFilter = (patch: Partial<Filters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setSidebarOpen(false);
  };

  const NavItem = ({
    icon,
    label,
    count,
    activeState,
    onClick,
    accent,
  }: {
    icon: string;
    label: string;
    count?: number;
    activeState: boolean;
    onClick: () => void;
    accent?: string;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition ${
        activeState ? 'bg-accent/12 text-ink' : 'text-muted hover:bg-raised hover:text-ink'
      }`}
    >
      <Icon name={icon} size={15} style={accent ? { color: accent } : undefined} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined ? <span className="text-xs text-faint tabular-nums">{count}</span> : null}
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
              />
            ))}
          </div>
        </div>
      ) : null}

      {typeGroups.map(([heading, types]) => (
        <div key={heading}>
          <p className="mb-1 px-2.5 text-[11px] font-medium tracking-wider text-faint uppercase">{heading}</p>
          <div className="space-y-0.5">
            {types.map((type) => (
              <NavItem
                key={type.id}
                icon={type.icon}
                accent={type.accent}
                label={type.label}
                count={typeCounts.get(type.id)}
                activeState={filters.type === type.id}
                onClick={() => setFilter({ ...EMPTY_FILTERS, type: type.id, query: filters.query })}
              />
            ))}
          </div>
        </div>
      ))}
      {typeCounts.size === 0 ? (
        <p className="px-2.5 text-xs text-faint">Nenhum item ainda.</p>
      ) : null}

      {folders.length > 0 ? (
        <div>
          <p className="mb-1 px-2.5 text-[11px] font-medium tracking-wider text-faint uppercase">Pastas</p>
          <div className="space-y-0.5">
            {folders.map(({ folder, count }) => (
              <NavItem
                key={folder}
                icon="folder"
                label={folder}
                count={count}
                activeState={filters.folder === folder}
                onClick={() => setFilter({ ...EMPTY_FILTERS, folder, query: filters.query })}
              />
            ))}
          </div>
        </div>
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
            className="w-full rounded-lg border border-line bg-canvas py-2 pr-16 pl-9 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none"
            type="search"
            autoComplete="off"
          />
          <kbd className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-faint sm:block">
            Ctrl K
          </kbd>
        </div>

        <SyncBadge />
        <IconButton icon="wand" label="Gerador" onClick={() => setGeneratorOpen(true)} />
        <IconButton icon="lock" label="Bloquear (Ctrl+L)" onClick={actions.lock} />
        <Button variant="primary" icon="plus" onClick={() => setEditing({ item: null })} className="shrink-0">
          <span className="hidden sm:inline">Novo</span>
        </Button>
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
                    className={`flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition ${tone} ${
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
                className="rounded-lg border border-line bg-canvas px-2 py-1 text-xs text-muted focus:border-accent focus:outline-none"
                aria-label="Ordenar"
              >
                <option value="updated">Recentes</option>
                <option value="name">Nome</option>
                <option value="created">Criação</option>
                <option value="type">Tipo</option>
              </select>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom,0px)]">
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
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedId(item.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setSelectedId(item.id);
                          }
                        }}
                        className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 transition ${
                          selectedId === item.id ? 'bg-accent/8' : 'hover:bg-raised'
                        }`}
                      >
                        <span
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                          style={{
                            color: type.accent,
                            backgroundColor: `color-mix(in srgb, ${type.accent} 13%, transparent)`,
                          }}
                        >
                          <Icon name={type.icon} size={15} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1.5 truncate text-sm text-ink">
                            {item.favorite ? <Icon name="star" size={12} className="shrink-0 text-warn" /> : null}
                            {item.name || 'Sem título'}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-muted">
                            {item.description ||
                              item.fields.username ||
                              item.fields.service ||
                              item.fields.registry ||
                              item.fields.host ||
                              type.label}
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
                        <div className="hidden shrink-0 items-center gap-2 sm:flex">
                          {item.folder ? <Badge className="bg-raised text-muted">{item.folder}</Badge> : null}
                          <span className="w-12 text-right text-xs text-faint">{relativeTime(item.updatedAt)}</span>
                        </div>
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
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
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

      {editing ? (
        <ItemEditor
          item={editing.item}
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

      <datalist id="keeper-folders">
        {folders.map(({ folder }) => (
          <option key={folder} value={folder} />
        ))}
      </datalist>
    </div>
  );
}
