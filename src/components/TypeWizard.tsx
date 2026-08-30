/**
 * Step-by-step replacement for the flat 33-type picker: first WHAT to store
 * (development secret or personal document), then — for documents — WHERE it
 * is from, and only then a short, relevant type list. Search stays available
 * at every list step and filters within the current scope; recently used
 * types skip the steps entirely.
 */
import { useMemo, useState } from 'react';
import { getAllTypes, getFamily, getType, type SecretTypeDef } from '../lib/model';
import { DOCUMENT_ORIGINS, GENERAL_GROUP, type TypeFamily } from '../lib/documents';
import { normalizeSearchText } from '../lib/search';
import { loadRecentTypes } from '../lib/storage';
import { TypeBuilder } from './TypeBuilder';
import { Icon } from './icons';
import { IconButton, Modal, TextInput } from './ui';
import { useCloseOnBack } from './use-close-on-back';

type Step = { kind: 'root' } | { kind: 'dev' } | { kind: 'origin' } | { kind: 'types'; group: string };

function matches(type: SecretTypeDef, needle: string): boolean {
  if (!needle) return true;
  // Keywords included on purpose: someone looking for a payslip types
  // "holerite", and the form is called "Recibo de vencimento".
  const hay = [type.label, type.description, type.group, ...(type.keywords ?? [])].join(' ');
  return normalizeSearchText(hay).includes(needle);
}

type Entry = { kind: 'type'; type: SecretTypeDef } | { kind: 'family'; family: TypeFamily; members: SecretTypeDef[] };

/**
 * One row per family instead of one per member — "Declarações" rather than
 * seven near-identical tiles. Two escapes keep it from hiding anything: a
 * family with a single member in this group renders as that member, and a
 * filter that names a specific member ("IRS") lists the members themselves,
 * so typing what you want still lands straight on its form.
 */
function collapseFamilies(types: SecretTypeDef[], needle: string): Entry[] {
  const entries: Entry[] = [];
  const done = new Set<string>();
  for (const type of types) {
    const family = getFamily(type.family);
    if (!family) {
      if (matches(type, needle)) entries.push({ kind: 'type', type });
      continue;
    }
    if (done.has(family.id)) continue;
    done.add(family.id);
    const members = types.filter((candidate) => candidate.family === family.id);
    const named = needle ? members.filter((member) => matches(member, needle)) : [];
    if (members.length < 2 || (needle && named.length > 0 && named.length < members.length)) {
      for (const member of members.length < 2 ? members : named) {
        if (!needle || matches(member, needle)) entries.push({ kind: 'type', type: member });
      }
      continue;
    }
    const familyHay = normalizeSearchText(`${family.label} ${family.description}`);
    if (!needle || familyHay.includes(needle) || named.length > 0) {
      entries.push({ kind: 'family', family, members });
    }
  }
  return entries;
}

function FamilyRow({ family, count, onPick }: { family: TypeFamily; count: number; onPick: (typeId: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPick(family.defaultTypeId)}
      className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-raised"
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px]"
        style={{ color: family.accent, backgroundColor: `color-mix(in srgb, ${family.accent} 13%, transparent)` }}
      >
        <Icon name={family.icon} size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink pointer-coarse:text-base">
          {family.label}
        </span>
        <span className="block truncate text-xs leading-snug text-muted pointer-coarse:text-[13px]">
          {family.description}
        </span>
      </span>
      <span className="shrink-0 rounded-md bg-raised px-1.5 py-0.5 text-[11px] text-faint tabular-nums">
        {count}
      </span>
    </button>
  );
}

function EntryRows({ entries, onPick }: { entries: Entry[]; onPick: (typeId: string) => void }) {
  return (
    <>
      {entries.map((entry) =>
        entry.kind === 'family' ? (
          <FamilyRow key={entry.family.id} family={entry.family} count={entry.members.length} onPick={onPick} />
        ) : (
          <TypeRow key={entry.type.id} type={entry.type} onPick={onPick} />
        ),
      )}
    </>
  );
}

function TypeRow({ type, onPick }: { type: SecretTypeDef; onPick: (typeId: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPick(type.id)}
      className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-raised"
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px]"
        style={{ color: type.accent, backgroundColor: `color-mix(in srgb, ${type.accent} 13%, transparent)` }}
      >
        <Icon name={type.icon} size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink pointer-coarse:text-base">{type.label}</span>
        <span className="block truncate text-xs leading-snug text-muted pointer-coarse:text-[13px]">
          {type.description}
        </span>
      </span>
    </button>
  );
}

function BranchCard({
  icon,
  accent,
  title,
  description,
  count,
  onClick,
}: {
  icon: string;
  accent: string;
  title: string;
  description: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3.5 rounded-2xl border border-line bg-canvas p-4 text-left transition hover:border-accent/50 hover:bg-raised"
    >
      <span
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
        style={{ color: accent, backgroundColor: `color-mix(in srgb, ${accent} 13%, transparent)` }}
      >
        <Icon name={icon} size={22} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold text-ink">{title}</span>
        <span className="mt-0.5 block text-[13px] leading-snug text-muted">{description}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-faint">
        {count} tipos
        <Icon name="chevron" size={14} />
      </span>
    </button>
  );
}

export function TypeWizard({
  onPick,
  onClose,
}: {
  onPick: (typeId: string) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>({ kind: 'root' });
  const [query, setQuery] = useState('');
  /** When set, the form builder covers the wizard; closing it comes back here. */
  const [builder, setBuilder] = useState<{ group?: string } | null>(null);

  // Snapshot at mount: the wizard is short-lived and the registry is current
  // (the keeper registers custom types synchronously on every payload change).
  const devTypes = useMemo(() => getAllTypes().filter((type) => type.category === 'dev'), []);
  const docTypes = useMemo(() => getAllTypes().filter((type) => type.category === 'doc'), []);
  const recents = useMemo(
    () => loadRecentTypes().map((id) => getType(id)).filter((type) => type.label).slice(0, 3),
    [],
  );

  const goBack = () => {
    setQuery('');
    setStep(step.kind === 'types' ? { kind: 'origin' } : { kind: 'root' });
  };
  const goTo = (next: Step) => {
    setQuery('');
    setStep(next);
  };
  // On touch, the system back gesture peels one step at a time; the document
  // branch is two deep, hence the second armed entry. These stack ON TOP of
  // the single Modal's own close-the-wizard entry — which is why the wizard
  // must render ONE Modal across steps: a Modal per step would arm and
  // release close-all entries on every transition and scramble the history.
  useCloseOnBack(step.kind !== 'root', goBack);
  useCloseOnBack(step.kind === 'types', goBack);

  const needle = normalizeSearchText(query.trim());

  if (builder) {
    return (
      <TypeBuilder
        initialGroup={builder.group}
        onSaved={(typeId) => onPick(typeId)}
        onClose={() => setBuilder(null)}
      />
    );
  }

  const customEntry = (label: string, group?: string) => (
    <button
      type="button"
      onClick={() => setBuilder(group === undefined ? {} : { group })}
      className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line px-3 py-3 text-sm font-medium text-muted transition hover:bg-raised hover:text-ink"
    >
      <Icon name="plus" size={15} />
      {label}
    </button>
  );

  const search = (placeholder: string) => (
    <TextInput
      value={query}
      onChange={(event) => setQuery(event.target.value)}
      placeholder={placeholder}
      autoComplete="off"
      spellCheck={false}
      className="mb-3"
      type="search"
    />
  );

  const header =
    step.kind === 'dev'
      ? { title: 'Desenvolvimento', subtitle: 'Escolha o tipo — os campos se ajustam.' }
      : step.kind === 'origin'
        ? { title: 'Documento pessoal', subtitle: 'De onde é o documento?' }
        : step.kind === 'types'
          ? { title: step.group, subtitle: 'Escolha o tipo — os campos se ajustam.' }
          : { title: 'Novo item', subtitle: 'O que você quer guardar?' };

  let body = null;
  if (step.kind === 'dev') {
    const entries = collapseFamilies(devTypes, needle);
    body = (
      <>
        {search('Filtrar tipos: token, ssh, registry…')}
        <div className="grid gap-1 sm:grid-cols-2">
          <EntryRows entries={entries} onPick={onPick} />
        </div>
        {entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">Nenhum tipo corresponde a “{query}”.</p>
        ) : null}
        {customEntry('Não encontrou? Crie um tipo de desenvolvimento', 'Desenvolvimento')}
      </>
    );
  } else if (step.kind === 'origin') {
    const general = docTypes.filter((type) => type.group === GENERAL_GROUP);
    const knownGroups = new Set([GENERAL_GROUP, ...DOCUMENT_ORIGINS.map((origin) => origin.group)]);
    const customOrigins = [...new Set(docTypes.map((type) => type.group))]
      .filter((group) => !knownGroups.has(group))
      .map((group) => ({
        group,
        code: group.slice(0, 2).toLocaleUpperCase('pt-BR'),
        accent: '#94a3b8',
        hint: 'Tipos personalizados',
      }));
    const origins = [...DOCUMENT_ORIGINS, ...customOrigins]
      .map((origin) => ({
        ...origin,
        count: docTypes.filter((type) => type.group === origin.group).length,
      }))
      .filter((origin) => origin.count > 0 && (!needle || normalizeSearchText(origin.group).includes(needle)));
    const generalVisible = !needle || normalizeSearchText(GENERAL_GROUP).includes(needle);
    body = (
      <>
        {search('Buscar país…')}
        <div className="space-y-1">
          {generalVisible ? (
            <button
              type="button"
              onClick={() => goTo({ kind: 'types', group: GENERAL_GROUP })}
              className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-raised"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-accent/13 text-accent">
                <Icon name="globe" size={19} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink pointer-coarse:text-base">Geral — qualquer país</span>
                <span className="block truncate text-xs text-muted pointer-coarse:text-[13px]">
                  Passaporte, visto, cartão de crédito, diploma, seguro…
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5 text-xs text-faint">
                {general.length}
                <Icon name="chevron" size={13} />
              </span>
            </button>
          ) : null}

          {origins.length > 0 ? (
            <p className="px-2 pt-3 pb-1 text-[11px] font-medium tracking-wider text-faint uppercase">Países</p>
          ) : null}
          {origins.map((origin) => (
            <button
              key={origin.group}
              type="button"
              onClick={() => goTo({ kind: 'types', group: origin.group })}
              className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-raised"
            >
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] font-mono text-[13px] font-semibold tracking-wide"
                style={{ color: origin.accent, backgroundColor: `color-mix(in srgb, ${origin.accent} 13%, transparent)` }}
              >
                {origin.code}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink pointer-coarse:text-base">{origin.group}</span>
                <span className="block truncate text-xs text-muted pointer-coarse:text-[13px]">{origin.hint}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5 text-xs text-faint">
                {origin.count}
                <Icon name="chevron" size={13} />
              </span>
            </button>
          ))}
          {!generalVisible && origins.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">Nenhum país corresponde a “{query}”.</p>
          ) : null}
        </div>
      </>
    );
  } else if (step.kind === 'types') {
    const group = step.group;
    const entries = collapseFamilies(
      docTypes.filter((type) => type.group === group),
      needle,
    );
    body = (
      <>
        {search('Filtrar tipos: residência, CPF, passaporte…')}
        <div className="grid gap-1 sm:grid-cols-2">
          <EntryRows entries={entries} onPick={onPick} />
        </div>
        {entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">Nenhum tipo corresponde a “{query}”.</p>
        ) : null}
        {customEntry(`Não encontrou? Crie um tipo para ${group}`, group)}
      </>
    );
  } else {
    body = (
      <div className="space-y-3">
        {recents.length > 0 ? (
          <div>
            <p className="mb-2 text-[11px] font-medium tracking-wider text-faint uppercase">Usados recentemente</p>
            <div className="flex flex-wrap gap-2">
              {recents.map((type) => (
                <button
                  key={type.id}
                  type="button"
                  onClick={() => onPick(type.id)}
                  className="inline-flex items-center gap-2 rounded-xl border border-line bg-canvas px-3.5 py-2 text-sm text-ink transition hover:border-accent/50 hover:bg-raised pointer-coarse:py-2.5"
                >
                  <Icon name={type.icon} size={15} style={{ color: type.accent }} />
                  {type.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <BranchCard
          icon="terminal"
          accent="var(--color-accent)"
          title="Segredo de desenvolvimento"
          description="Tokens, chaves SSH, .env, registries, bancos…"
          count={devTypes.length}
          onClick={() => goTo({ kind: 'dev' })}
        />
        <BranchCard
          icon="idCard"
          accent="#2dd4bf"
          title="Documento pessoal"
          description="Identidade, residência, certidões, vistos…"
          count={docTypes.length}
          onClick={() => goTo({ kind: 'origin' })}
        />

        <button
          type="button"
          onClick={() => setBuilder({})}
          className="flex w-full items-center gap-3.5 rounded-2xl border border-dashed border-line p-4 text-left transition hover:bg-raised"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-dashed border-line text-muted">
            <Icon name="plus" size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-ink">Criar tipo personalizado</span>
            <span className="mt-0.5 block text-xs leading-snug text-muted">
              Monte o formulário com os campos que quiser.
            </span>
          </span>
          <Icon name="chevron" size={14} className="shrink-0 text-faint" />
        </button>
      </div>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      wide={step.kind !== 'root'}
      title={header.title}
      subtitle={header.subtitle}
      leading={step.kind !== 'root' ? <IconButton icon="chevronLeft" label="Voltar" onClick={goBack} /> : undefined}
    >
      {body}
    </Modal>
  );
}
