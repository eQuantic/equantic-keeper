/** Create / edit form. Fields are rendered from the type's schema. */
import { useMemo, useState, type FormEvent } from 'react';
import {
  SECRET_TYPES,
  createItem,
  createPerson,
  getType,
  isMultilineKind,
  isSecretKind,
  type CustomField,
  type FieldDef,
  type SecretTypeDef,
  type VaultItem,
} from '../lib/model';
import { activePeople } from '../lib/vault';
import { useKeeper } from '../state/keeper';
import { Button, Field, IconButton, Modal, PasswordInput, TextArea, TextInput } from './ui';
import { Icon } from './icons';
import { GeneratorDialog } from './Generator';

function TagEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
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
        placeholder={tags.length ? '' : 'produção, cliente-x, urgente'}
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

  const control = isMultilineKind(field.kind) ? (
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
      revealLabel="Revelar"
      hideLabel="Ocultar"
    />
  ) : (
    <TextInput
      type={field.kind === 'date' ? 'date' : 'text'}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={field.placeholder ?? ''}
      autoComplete="off"
      spellCheck={false}
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
  onSave,
  onClose,
}: {
  /** `null` starts a new item. */
  item: VaultItem | null;
  onSave: (item: VaultItem) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<VaultItem>(() => item ?? createItem('api-token'));
  const [typePickerOpen, setTypePickerOpen] = useState(!item);
  const [typeQuery, setTypeQuery] = useState('');
  const [addingPerson, setAddingPerson] = useState(false);
  const [newPerson, setNewPerson] = useState('');
  const { payload, actions } = useKeeper();
  const people = activePeople(payload?.people ?? []);
  const isNew = !item;
  const type = getType(draft.type);

  const canSave = draft.name.trim().length > 0;
  /**
   * A holder only makes sense once there is a family to point at. Someone who
   * uses Keeper purely for API tokens never sees the field.
   */
  const showHolder = type.category === 'doc' || people.length > 0 || !!draft.holderId;
  const patch = (changes: Partial<VaultItem>) => setDraft((current) => ({ ...current, ...changes }));

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
  const setField = (id: string, value: string) =>
    setDraft((current) => ({ ...current, fields: { ...current.fields, [id]: value } }));

  const setCustom = (id: string, changes: Partial<CustomField>) =>
    setDraft((current) => ({
      ...current,
      customFields: current.customFields.map((field) => (field.id === id ? { ...field, ...changes } : field)),
    }));

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

  // With 30+ types a flat grid stops being browsable, so the picker groups by
  // origin and offers a filter.
  const groups = useMemo(() => {
    const order = ['Portugal', 'Brasil', 'Geral', 'Desenvolvimento'];
    const needle = typeQuery.trim().toLocaleLowerCase('pt-BR');
    const buckets = new Map<string, SecretTypeDef[]>();
    for (const candidate of SECRET_TYPES) {
      const heading = candidate.category === 'dev' ? 'Desenvolvimento' : candidate.group;
      const haystack = `${candidate.label} ${candidate.description} ${candidate.group}`.toLocaleLowerCase('pt-BR');
      if (needle && !haystack.includes(needle)) continue;
      buckets.set(heading, [...(buckets.get(heading) ?? []), candidate]);
    }
    return [...buckets.entries()].sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  }, [typeQuery]);

  if (typePickerOpen) {
    return (
      <Modal
        open
        onClose={onClose}
        title="Novo item"
        subtitle="Escolha o tipo — os campos se ajustam automaticamente."
        wide
      >
        <TextInput
          value={typeQuery}
          onChange={(event) => setTypeQuery(event.target.value)}
          placeholder="Filtrar tipos: residência, CPF, passaporte, token…"
          autoFocus
          className="mb-4"
        />
        {groups.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">Nenhum tipo corresponde a “{typeQuery}”.</p>
        ) : null}
        {groups.map(([heading, types]) => (
          <section key={heading} className="mb-5 last:mb-0">
            <p className="mb-2 text-[11px] font-medium tracking-wider text-faint uppercase">{heading}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {types.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => {
                    setDraft(createItem(candidate.id));
                    setTypePickerOpen(false);
                  }}
                  className="flex items-start gap-3 rounded-lg border border-line bg-canvas p-3 text-left transition hover:border-accent/50 hover:bg-raised"
                >
                  <span
                    className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                    style={{
                      color: candidate.accent,
                      backgroundColor: `color-mix(in srgb, ${candidate.accent} 14%, transparent)`,
                    }}
                  >
                    <Icon name={candidate.icon} size={16} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink">{candidate.label}</span>
                    <span className="mt-0.5 block text-xs leading-snug text-muted">{candidate.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={isNew ? `Novo: ${type.label}` : 'Editar segredo'}
      subtitle={isNew ? type.description : type.label}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" icon="check" disabled={!canSave} onClick={submit}>
            Salvar
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome">
            <TextInput
              value={draft.name}
              onChange={(event) => patch({ name: event.target.value })}
              placeholder="GitHub PAT — CI eQuantic"
              autoFocus
            />
          </Field>
          <Field label="Pasta / projeto" hint="Opcional. Agrupa segredos na barra lateral.">
            <TextInput
              value={draft.folder}
              onChange={(event) => patch({ folder: event.target.value })}
              placeholder="Infra"
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
                value={draft.holderId}
                onChange={(event) => patch({ holderId: event.target.value })}
                className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
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

        <Field label="Descrição">
          <TextInput
            value={draft.description}
            onChange={(event) => patch({ description: event.target.value })}
            placeholder="Para que serve, onde é usado…"
          />
        </Field>

        <Field label="Tags">
          <TagEditor tags={draft.tags} onChange={(tags) => patch({ tags })} />
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
