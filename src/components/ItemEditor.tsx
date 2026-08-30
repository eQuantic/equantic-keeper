/** Create / edit form. Fields are rendered from the type's schema. */
import { useRef, useState, type FormEvent } from 'react';
import {
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
import { pushRecentType } from '../lib/storage';
import { TypeWizard } from './TypeWizard';
import { activePeople } from '../lib/vault';
import { useKeeper } from '../state/keeper';
import { Button, ComboInput, Field, IconButton, Modal, PasswordInput, TextArea, TextInput } from './ui';
import { Icon } from './icons';
import { AttachmentPicker } from './Attachments';
import { CardColorPicker } from './CardVisual';
import { CountryMark } from './flags';
import { GeneratorDialog } from './Generator';

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
      title={isNew ? `Novo: ${type.label}` : 'Editar segredo'}
      subtitle={isNew ? type.description : type.label}
      footer={
        <>
          <Button onClick={attemptClose}>Cancelar</Button>
          <Button variant="primary" icon="check" disabled={!canSave} onClick={submit}>
            Salvar
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome">
            <TextInput
              aria-label="Nome"
              value={draft.name}
              onChange={(event) => patch({ name: event.target.value })}
              placeholder={type.namePlaceholder ?? type.label}
              autoFocus
            />
          </Field>
          <Field label="Pasta / projeto" hint="Opcional. Agrupa segredos na barra lateral.">
            <TextInput
              value={draft.folder}
              onChange={(event) => patch({ folder: event.target.value })}
              placeholder={isDoc ? 'Documentos' : 'Infra'}
              list="keeper-folders"
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

        <div className="border-t border-line-soft pt-4">
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
      </form>
    </Modal>
  );
}
