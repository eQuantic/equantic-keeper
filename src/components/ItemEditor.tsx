/** Create / edit form. Fields are rendered from the type's schema. */
import { useRef, useState, type FormEvent } from 'react';
import { noteOutline, noteStats } from '../lib/blocks';
import {
  NOTE_TYPE_ID,
  countryForType,
  createItem,
  createPerson,
  familyMembers,
  getFamily,
  getType,
  isMultilineKind,
  isSecretKind,
  type CustomField,
  type FieldDef,
  type VaultItem,
} from '../lib/model';
import { DOCUMENT_ORIGINS } from '../lib/documents';
import { allCountries, countryName } from '../lib/countries';
import { loadNotePanes, pushRecentType, saveNotePanes } from '../lib/storage';
import { TypeWizard } from './TypeWizard';
import { activeFolders, activePeople } from '../lib/vault';
import { useKeeper } from '../state/keeper';
import { Button, ComboInput, Field, IconButton, Modal, PasswordInput, TextArea, TextInput } from './ui';
import { Icon } from './icons';
import { useMediaQuery } from './use-media-query';
import { AttachmentPicker } from './Attachments';
import { CardColorPicker } from './CardVisual';
import { CountryMark } from './flags';
import { GeneratorDialog } from './Generator';
import { LazyNoteEditor } from './note/LazyNoteEditor';

function TagEditor({
  tags,
  onChange,
  placeholder,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState('');

  const commit = () => {
    const value = draft.trim().replace(/,$/, '');
    if (value && !tags.includes(value)) onChange([...tags, value]);
    setDraft('');
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-canvas px-2 py-1.5">
      {tags.map((tag) => (
        <span key={tag} className="flex items-center gap-1 rounded-md bg-raised px-2 py-1 text-xs text-muted">
          {tag}
          <button
            type="button"
            onClick={() => onChange(tags.filter((candidate) => candidate !== tag))}
            aria-label={`Remover ${tag}`}
            className="opacity-60 hover:opacity-100"
          >
            <Icon name="x" size={11} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            commit();
          } else if (event.key === 'Backspace' && !draft && tags.length) {
            onChange(tags.slice(0, -1));
          }
        }}
        onBlur={commit}
        placeholder={tags.length ? '' : placeholder}
        className="min-w-24 flex-1 bg-transparent px-1 py-1 text-sm text-ink outline-none placeholder:text-faint"
      />
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: string;
  onChange: (value: string) => void;
}) {
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const secret = isSecretKind(field.kind);
  const generatable = field.kind === 'password' || field.kind === 'secret';

  // The card's color field edits as swatches, not as text.
  if (field.id === 'cardColor') {
    return (
      <Field label={field.label} wrapper="div">
        <CardColorPicker value={value} onChange={onChange} />
      </Field>
    );
  }

  const control = field.options?.length ? (
    <ComboInput
      value={value}
      onChange={onChange}
      options={field.options}
      placeholder={field.placeholder ?? ''}
      spellCheck={false}
      inputMode={field.numeric ? 'numeric' : undefined}
    />
  ) : isMultilineKind(field.kind) ? (
    <TextArea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={field.placeholder ?? ''}
      rows={field.kind === 'multilineSecret' ? 6 : 4}
      spellCheck={false}
    />
  ) : secret ? (
    <PasswordInput
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={field.placeholder ?? ''}
      autoComplete="off"
      spellCheck={false}
      inputMode={field.numeric ? 'numeric' : undefined}
      // A card number, a CVC, a PIN: you are copying them off the plastic in
      // your hand, and sixteen digits typed blind is how they end up wrong.
      // They stay concealed where it matters — the detail view.
      defaultRevealed={field.numeric}
      revealLabel="Revelar"
      hideLabel="Ocultar"
    />
  ) : (
    <TextInput
      type={field.kind === 'date' ? 'date' : field.kind === 'month' ? 'month' : 'text'}
      // <input type="month"> speaks YYYY-MM; a value stored as a full date
      // (older cards) is trimmed so the control still shows the right month.
      value={field.kind === 'month' ? value.slice(0, 7) : value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={field.placeholder ?? ''}
      autoComplete="off"
      spellCheck={false}
      inputMode={field.numeric ? 'numeric' : field.kind === 'url' ? 'url' : undefined}
      autoCapitalize={
        field.numeric || field.kind === 'url' || field.kind === 'username' ? 'none' : undefined
      }
      className={field.kind === 'url' || field.kind === 'text' ? '' : 'font-mono'}
    />
  );

  return (
    <>
      <Field
        label={field.label}
        {...(field.hint ? { hint: field.hint } : {})}
        actions={
          generatable ? (
            <button
              type="button"
              onClick={() => setGeneratorOpen(true)}
              className="flex items-center gap-1 text-[11px] text-accent hover:underline"
            >
              <Icon name="wand" size={11} /> gerar
            </button>
          ) : undefined
        }
      >
        {control}
      </Field>
      <GeneratorDialog open={generatorOpen} onClose={() => setGeneratorOpen(false)} onUse={onChange} />
    </>
  );
}

export function ItemEditor({
  item,
  preset,
  onSave,
  onClose,
}: {
  /** `null` starts a new item. */
  item: VaultItem | null;
  /** Pre-filled fields for a new item — the sidebar filter active at creation. */
  preset?: Partial<Pick<VaultItem, 'holderId' | 'folder'>>;
  onSave: (item: VaultItem) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<VaultItem>(() => item ?? { ...createItem('api-token'), ...preset });
  const [typePickerOpen, setTypePickerOpen] = useState(!item);
  const [addingPerson, setAddingPerson] = useState(false);
  const [newPerson, setNewPerson] = useState('');
  const { payload, actions } = useKeeper();
  const people = activePeople(payload?.people ?? []);
  /** Existing folder paths, so filing into a subfolder is a pick, not a typo. */
  const folderPaths = [
    ...new Set([
      ...activeFolders(payload?.folders ?? []).map((folder) => folder.name),
      ...(payload?.items ?? []).map((entry) => entry.folder).filter(Boolean),
    ]),
  ].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const isNew = !item;
  const type = getType(draft.type);
  /**
   * Any edit arms a confirmation on every exit — the X, Esc, the backdrop,
   * the sheet's swipe-down and the system back gesture all land on onClose.
   */
  const dirtyRef = useRef(false);
  const attemptClose = () => {
    if (dirtyRef.current && !window.confirm('Descartar as alterações?')) return;
    onClose();
  };

  const canSave = draft.name.trim().length > 0;
  /**
   * A holder only makes sense once there is a family to point at. Someone who
   * uses Keeper purely for API tokens never sees the field.
   */
  const showHolder = type.category === 'doc' || people.length > 0 || !!draft.holderId;
  /** Placeholders follow the subject: a declaration form suggests declarations. */
  const isDoc = type.category === 'doc';
  /** A note is a page: it gets the document dialog and columns of its own. */
  const isNote = draft.type === NOTE_TYPE_ID;
  /**
   * The page never goes below ~560px of writing width: that is the number the
   * columns give way to, not a taste in breakpoints. Above 1400 the summary
   * fits beside the details and the page (340 + 560 + 260); above 1100 the
   * details still fit; below that each opens over the page as a drawer.
   */
  const outlineFits = useMediaQuery('(min-width: 1400px)');
  const detailsFit = useMediaQuery('(min-width: 1100px)');
  const [showDetails, setShowDetails] = useState(() => loadNotePanes().details);
  const [showOutline, setShowOutline] = useState(() => loadNotePanes().outline);
  /**
   * The stored preference governs a column that FITS. One that does not fit
   * starts closed and opens as a drawer only when asked — a summary covering
   * the page the moment a note opens would be a worse default than no summary.
   * One drawer at a time, so the page is never buried under two.
   */
  const [drawer, setDrawer] = useState<'details' | 'outline' | null>(null);
  const detailsOpen = isNote ? (detailsFit ? showDetails : drawer === 'details') : true;
  const outlineOpen = isNote && (outlineFits ? showOutline : drawer === 'outline');
  const detailsDrawer = detailsOpen && !detailsFit;
  const outlineDrawer = outlineOpen && !outlineFits;
  const outline = isNote ? noteOutline(draft.blocks) : [];
  const stats = isNote ? noteStats(draft.blocks) : { blocks: 0, todos: 0, done: 0 };
  const togglePane = (pane: 'details' | 'outline') => {
    const fits = pane === 'details' ? detailsFit : outlineFits;
    if (!fits) return setDrawer((current) => (current === pane ? null : pane));
    const next = pane === 'details' ? !showDetails : !showOutline;
    if (pane === 'details') setShowDetails(next);
    else setShowOutline(next);
    saveNotePanes({
      details: pane === 'details' ? next : showDetails,
      outline: pane === 'outline' ? next : showOutline,
    });
  };
  const patch = (changes: Partial<VaultItem>) => {
    dirtyRef.current = true;
    setDraft((current) => ({ ...current, ...changes }));
  };

  /**
   * Families are picked here, not in the type list: "Declarações" is one entry
   * out there, and the specific form is chosen inside the item. Switching
   * keeps every field the new form also has, so correcting the kind after
   * typing does not cost the typing.
   */
  const family = getFamily(type.family);
  const members = family ? familyMembers(family.id) : [];
  const memberGroups = [...new Map(members.map((member) => [member.group, [] as typeof members])).entries()].map(
    ([groupName]) => [groupName, members.filter((member) => member.group === groupName)] as const,
  );
  const switchType = (typeId: string) => {
    if (typeId === draft.type) return;
    const kept: Record<string, string> = {};
    for (const field of getType(typeId).fields) {
      const value = draft.fields[field.id];
      if (value) kept[field.id] = value;
    }
    const implied = countryForType(typeId);
    patch({ type: typeId, fields: kept, ...(implied ? { country: implied } : {}) });
    pushRecentType(typeId);
  };

  /** Adds a holder without leaving the form, and selects them right away. */
  const commitNewPerson = () => {
    const name = newPerson.trim();
    if (!name) return;
    const person = createPerson(name);
    void actions.savePerson(person);
    patch({ holderId: person.id });
    setNewPerson('');
    setAddingPerson(false);
  };
  const setField = (id: string, value: string) => {
    dirtyRef.current = true;
    setDraft((current) => ({ ...current, fields: { ...current.fields, [id]: value } }));
  };

  const setCustom = (id: string, changes: Partial<CustomField>) => {
    dirtyRef.current = true;
    setDraft((current) => ({
      ...current,
      customFields: current.customFields.map((field) => (field.id === id ? { ...field, ...changes } : field)),
    }));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    onSave({
      ...draft,
      name: draft.name.trim(),
      folder: draft.folder.trim(),
      description: draft.description.trim(),
    });
  };

  if (typePickerOpen) {
    return (
      <TypeWizard
        onClose={onClose}
        onPick={(typeId) => {
          dirtyRef.current = false;
          setDraft({ ...createItem(typeId), ...preset });
          setTypePickerOpen(false);
          pushRecentType(typeId);
        }}
      />
    );
  }

  return (
    <Modal
      open
      onClose={attemptClose}
      wide
      split={isNote}
      // A document dialog is anchored by the document's own name; the field on
      // the left still edits it.
      title={isNote ? draft.name.trim() || 'Nota sem título' : isNew ? `Novo: ${type.label}` : 'Editar segredo'}
      subtitle={isNote ? [type.label, draft.folder].filter(Boolean).join(' · ') : isNew ? type.description : type.label}
      actions={
        isNote ? (
          <>
            <IconButton
              icon="layers"
              label={detailsOpen ? 'Ocultar detalhes' : 'Mostrar detalhes'}
              active={detailsOpen}
              onClick={() => togglePane('details')}
            />
            <IconButton
              icon="note"
              label={outlineOpen ? 'Ocultar sumário' : 'Mostrar sumário'}
              active={outlineOpen}
              onClick={() => togglePane('outline')}
            />
          </>
        ) : undefined
      }
      footer={
        <>
          <Button onClick={attemptClose}>Cancelar</Button>
          <Button variant="primary" icon="check" disabled={!canSave} onClick={submit}>
            Salvar
          </Button>
        </>
      }
    >
      <form
        onSubmit={submit}
        className={isNote ? 'relative flex h-full min-h-0 overflow-hidden' : 'space-y-4'}
      >
        {/* A drawer covers the page, so a tap outside is how it closes. */}
        {isNote && (detailsDrawer || outlineDrawer) ? (
          <button
            type="button"
            aria-label="Fechar painel"
            onClick={() => setDrawer(null)}
            className="absolute inset-0 z-10 bg-black/40"
          />
        ) : null}
        <div
          data-note-pane={isNote ? 'details' : undefined}
          className={
            !isNote
              ? 'contents'
              : !detailsOpen
                ? 'hidden'
                : detailsFit
                  ? 'flex w-[340px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-line px-5 py-4'
                  : 'absolute inset-y-0 left-0 z-20 flex w-[340px] max-w-[85%] flex-col gap-4 overflow-y-auto border-r border-line bg-surface px-5 py-4 shadow-2xl'
          }
        >
        {family ? (
          <Field
            label={family.pickerLabel}
            hint="Muda os campos deste formulário. O que já preencheu é mantido."
          >
            <select
              aria-label={family.pickerLabel}
              value={draft.type}
              onChange={(event) => switchType(event.target.value)}
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none pointer-coarse:rounded-xl pointer-coarse:px-3.5 pointer-coarse:py-3"
            >
              {memberGroups.map(([groupName, groupMembers]) => (
                <optgroup key={groupName} label={groupName}>
                  {groupMembers.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
        ) : null}
        <div className={isNote ? 'grid gap-4' : 'grid gap-4 sm:grid-cols-2'}>
          <Field label="Nome">
            <TextInput
              aria-label="Nome"
              value={draft.name}
              onChange={(event) => patch({ name: event.target.value })}
              placeholder={type.namePlaceholder ?? type.label}
              autoFocus
            />
          </Field>
          <Field
            label="Pasta / projeto"
            hint="Opcional. Use / para subpastas: Documentos/Portugal."
          >
            <ComboInput
              value={draft.folder}
              onChange={(value) => patch({ folder: value })}
              options={folderPaths}
              placeholder={isDoc ? 'Documentos' : 'Infra'}
            />
          </Field>
        </div>

        {showHolder ? (
          <Field
            label="Titular"
            wrapper="div"
            hint="De quem é este documento. Deixe vazio para itens sem titular."
            actions={
              <button
                type="button"
                onClick={() => {
                  setAddingPerson((open) => !open);
                  setNewPerson('');
                }}
                className="flex items-center gap-1 text-[11px] text-accent hover:underline"
              >
                <Icon name={addingPerson ? 'x' : 'plus'} size={11} />
                {addingPerson ? 'cancelar' : 'nova pessoa'}
              </button>
            }
          >
            {addingPerson ? (
              <div className="flex gap-2">
                <TextInput
                  value={newPerson}
                  onChange={(event) => setNewPerson(event.target.value)}
                  placeholder="Nome da pessoa"
                  autoFocus
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      // The form's submit would otherwise save a half-filled item.
                      event.preventDefault();
                      commitNewPerson();
                    }
                  }}
                />
                <Button size="sm" icon="check" disabled={!newPerson.trim()} onClick={commitNewPerson}>
                  Adicionar
                </Button>
              </div>
            ) : (
              <select
                aria-label="Titular"
                value={draft.holderId}
                onChange={(event) => patch({ holderId: event.target.value })}
                className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none pointer-coarse:rounded-xl pointer-coarse:px-3.5 pointer-coarse:py-3"
              >
                <option value="">— sem titular —</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                    {person.relation ? ` · ${person.relation}` : ''}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : null}

        {isDoc ? (
          <Field
            label="País emissor"
            hint="Preenchido quando o tipo é de um país; nos documentos gerais, escolha o seu."
          >
            <span className="flex items-center gap-2">
              <CountryMark code={draft.country} size={20} title={countryName(draft.country)} />
              <select
                aria-label="País emissor"
                value={draft.country}
                onChange={(event) => patch({ country: event.target.value })}
                className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none pointer-coarse:rounded-xl pointer-coarse:px-3.5 pointer-coarse:py-3"
              >
                <option value="">— sem país —</option>
                {/* The catalogue countries first: they are the likely answer. */}
                <optgroup label="Mais usados">
                  {DOCUMENT_ORIGINS.map((origin) => (
                    <option key={origin.code} value={origin.code}>
                      {origin.group}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Todos os países">
                  {allCountries().map((country) => (
                    <option key={country.code} value={country.code}>
                      {country.name}
                    </option>
                  ))}
                </optgroup>
              </select>
            </span>
          </Field>
        ) : null}

        <Field label="Descrição">
          <TextInput
            value={draft.description}
            onChange={(event) => patch({ description: event.target.value })}
            placeholder={isDoc ? 'Onde está o original, para que serviu…' : 'Para que serve, onde é usado…'}
          />
        </Field>

        <Field label="Tags">
          <TagEditor
            tags={draft.tags}
            onChange={(tags) => patch({ tags })}
            placeholder={isDoc ? 'renovar, viagem, família' : 'produção, cliente-x, urgente'}
          />
        </Field>

        {/* A note keeps its content in blocks, so it declares no fields — and a
            heading with nothing under it is just noise. */}
        <div className={`border-t border-line-soft pt-4 ${type.fields.length ? '' : 'hidden'}`}>
          <p className="mb-3 flex items-center gap-2 text-xs font-medium tracking-wide text-muted uppercase">
            <Icon name={type.icon} size={13} style={{ color: type.accent }} />
            Campos de {type.label}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {type.fields.map((field) => (
              <div key={field.id} className={isMultilineKind(field.kind) ? 'sm:col-span-2' : ''}>
                <FieldInput
                  field={field}
                  value={draft.fields[field.id] ?? ''}
                  onChange={(value) => setField(field.id, value)}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3 border-t border-line-soft pt-4">
          <p className="text-xs font-medium tracking-wide text-muted uppercase">Anexos</p>
          <AttachmentPicker
            refs={draft.attachments}
            onChange={(attachments) => patch({ attachments })}
          />
        </div>

        {draft.customFields.length > 0 ? (
          <div className="space-y-3 border-t border-line-soft pt-4">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">Campos personalizados</p>
            {draft.customFields.map((field) => (
              <div key={field.id} className="flex items-start gap-2">
                <TextInput
                  value={field.label}
                  onChange={(event) => setCustom(field.id, { label: event.target.value })}
                  placeholder="Rótulo"
                  className="w-1/3"
                />
                <TextInput
                  type={field.secret ? 'password' : 'text'}
                  value={field.value}
                  onChange={(event) => setCustom(field.id, { value: event.target.value })}
                  placeholder="Valor"
                  className="flex-1 font-mono"
                />
                <IconButton
                  icon={field.secret ? 'lock' : 'unlock'}
                  label={field.secret ? 'Tratar como texto comum' : 'Tratar como segredo'}
                  active={field.secret}
                  onClick={() => setCustom(field.id, { secret: !field.secret })}
                />
                <IconButton
                  icon="trash"
                  label="Remover campo"
                  onClick={() =>
                    patch({ customFields: draft.customFields.filter((candidate) => candidate.id !== field.id) })
                  }
                />
              </div>
            ))}
          </div>
        ) : null}

        <Button
          icon="plus"
          size="sm"
          onClick={() =>
            patch({
              customFields: [
                ...draft.customFields,
                { id: crypto.randomUUID(), label: '', value: '', secret: true },
              ],
            })
          }
        >
          Adicionar campo personalizado
        </Button>

        {/* Lets the browser submit the form with Enter. */}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
        </div>

        {isNote ? (
          <>
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <LazyNoteEditor
                blocks={draft.blocks}
                onChange={(blocks) => patch({ blocks })}
                toolbar
              />
            </div>

            <div
              data-note-pane="outline"
              className={
                !outlineOpen
                  ? 'hidden'
                  : outlineFits
                    ? 'flex w-[260px] shrink-0 flex-col overflow-y-auto border-l border-line px-3 py-4'
                    : 'absolute inset-y-0 right-0 z-20 flex w-[260px] max-w-[85%] flex-col overflow-y-auto border-l border-line bg-surface px-3 py-4 shadow-2xl'
              }
            >
              <p className="mb-2 px-2.5 text-xs font-medium tracking-wide text-muted uppercase">Sumário</p>
              {outline.length === 0 ? (
                <p className="px-2.5 text-xs text-faint">
                  Os títulos da nota aparecem aqui conforme você os escreve.
                </p>
              ) : (
                <div className="flex flex-col gap-px">
                  {outline.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      // The editor stamps the block's id on its DOM node, so the
                      // summary can jump straight to the heading it names.
                      onClick={() =>
                        document
                          .getElementById(entry.id)
                          ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                      }
                      style={{ paddingLeft: 10 + (entry.level - 1) * 12 }}
                      className="truncate rounded-lg py-1.5 pr-2.5 text-left text-[13px] text-muted transition hover:bg-raised hover:text-ink"
                    >
                      {entry.text}
                    </button>
                  ))}
                </div>
              )}
              <p className="mt-auto border-t border-line-soft px-2.5 pt-3 text-xs leading-relaxed text-faint">
                {stats.blocks} {stats.blocks === 1 ? 'bloco' : 'blocos'}
                {stats.todos > 0
                  ? ` · ${stats.todos} ${stats.todos === 1 ? 'tarefa' : 'tarefas'}, ${stats.todos - stats.done} por fazer`
                  : ''}
              </p>
            </div>
          </>
        ) : null}
      </form>
    </Modal>
  );
}
