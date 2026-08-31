/**
 * Form builder for a user-defined type: name it, join an existing category
 * (or found a new one), pick a color and icon, and assemble the fields from
 * the same palette the built-in types use. The result lives encrypted in the
 * vault (format v5) and syncs to every device.
 */
import { useMemo, useRef, useState } from 'react';
import { createCustomType, type CustomTypeDef, type FieldDef } from '../lib/model';
import { DOCUMENT_ORIGINS, GENERAL_GROUP } from '../lib/documents';
import { activeCustomTypes } from '../lib/vault';
import { useKeeper } from '../state/keeper';
import { Button, Field, IconButton, Modal, Select, TextInput } from './ui';
import { Icon } from './icons';

const ACCENTS = ['#5b8cff', '#34d399', '#fbbf24', '#f472b6', '#c084fc', '#22d3ee'];
const ICONS = ['file', 'idCard', 'stamp', 'car', 'shield', 'badge', 'key', 'note'];
const NEW_GROUP = '__nova__';

interface KindOption {
  label: string;
  hint: string;
  /** Only one validity field per type — it is what feeds the expiry alerts. */
  single?: 'expiresAt';
  make: (id: string) => FieldDef;
}

const KIND_PALETTE: KindOption[] = [
  { label: 'Texto', hint: 'Nº do documento, órgão…', make: (id) => ({ id, label: '', kind: 'text' }) },
  { label: 'Texto longo', hint: 'Observações, endereço', make: (id) => ({ id, label: '', kind: 'multiline' }) },
  { label: 'Número', hint: 'Teclado numérico', make: (id) => ({ id, label: '', kind: 'text', numeric: true }) },
  { label: 'Data', hint: 'Emissão, nascimento…', make: (id) => ({ id, label: '', kind: 'date' }) },
  {
    label: 'Data de validade',
    hint: 'Entra nos alertas de vencimento',
    single: 'expiresAt',
    make: () => ({ id: 'expiresAt', label: 'Válido até', kind: 'date' }),
  },
  { label: 'Mês', hint: 'Mês/ano, como a validade de um cartão', make: (id) => ({ id, label: '', kind: 'month' }) },
  { label: 'Segredo', hint: 'Oculto até revelar', make: (id) => ({ id, label: '', kind: 'secret' }) },
  { label: 'Segredo longo', hint: 'Chaves, certificados', make: (id) => ({ id, label: '', kind: 'multilineSecret' }) },
  { label: 'Senha', hint: 'Com gerador embutido', make: (id) => ({ id, label: '', kind: 'password' }) },
  { label: 'Usuário', hint: 'Login, e-mail de acesso', make: (id) => ({ id, label: '', kind: 'username' }) },
  { label: 'URL', hint: 'Abre com um toque', make: (id) => ({ id, label: '', kind: 'url' }) },
  { label: 'Chave 2FA (TOTP)', hint: 'Gera códigos no cofre', make: (id) => ({ id, label: '', kind: 'totp' }) },
];

const KIND_LABELS: Record<string, string> = {
  text: 'Texto',
  multiline: 'Texto longo',
  date: 'Data',
  secret: 'Segredo',
  multilineSecret: 'Segredo longo',
  password: 'Senha',
  username: 'Usuário',
  url: 'URL',
  totp: '2FA',
};

function kindLabel(field: FieldDef): string {
  if (field.id === 'expiresAt') return 'Validade';
  if (field.numeric) return 'Número';
  return KIND_LABELS[field.kind] ?? field.kind;
}

export function TypeBuilder({
  initialGroup,
  existing,
  onSaved,
  onClose,
}: {
  initialGroup?: string;
  existing?: CustomTypeDef;
  onSaved: (typeId: string) => void;
  onClose: () => void;
}) {
  const { payload, actions } = useKeeper();
  const [draft, setDraft] = useState<CustomTypeDef>(
    () => existing ?? { ...createCustomType(), group: initialGroup ?? GENERAL_GROUP },
  );
  const [groupChoice, setGroupChoice] = useState<string>(() => draft.group || GENERAL_GROUP);
  const [newGroup, setNewGroup] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const dirtyRef = useRef(false);
  const fieldSeq = useRef(existing ? existing.fields.length + 1 : 1);

  const groups = useMemo(() => {
    const known = new Set<string>(['Desenvolvimento', ...DOCUMENT_ORIGINS.map((origin) => origin.group), GENERAL_GROUP]);
    for (const custom of activeCustomTypes(payload?.customTypes ?? [])) {
      if (custom.group.trim()) known.add(custom.group.trim());
    }
    return [...known];
  }, [payload]);

  const patch = (changes: Partial<CustomTypeDef>) => {
    dirtyRef.current = true;
    setDraft((current) => ({ ...current, ...changes }));
  };

  const attemptClose = () => {
    if (dirtyRef.current && !window.confirm('Descartar o tipo?')) return;
    onClose();
  };

  const addField = (option: KindOption) => {
    const id = option.single ?? `c${fieldSeq.current++}`;
    patch({ fields: [...draft.fields, option.make(id)] });
    setPaletteOpen(false);
  };

  const setFieldLabel = (id: string, label: string) =>
    patch({ fields: draft.fields.map((field) => (field.id === id ? { ...field, label } : field)) });

  const move = (index: number, delta: number) => {
    const next = [...draft.fields];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const [field] = next.splice(index, 1);
    if (!field) return;
    next.splice(target, 0, field);
    patch({ fields: next });
  };

  const group = groupChoice === NEW_GROUP ? newGroup.trim() : groupChoice;
  const canSave =
    draft.label.trim().length > 0 &&
    group.length > 0 &&
    draft.fields.length > 0 &&
    draft.fields.every((field) => field.label.trim().length > 0) &&
    !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      const def: CustomTypeDef = { ...draft, group };
      await actions.saveCustomType(def);
      onSaved(def.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={attemptClose}
      wide
      title={existing ? 'Editar tipo personalizado' : 'Novo tipo personalizado'}
      subtitle="Monte o formulário do seu documento ou segredo."
      footer={
        <>
          <Button onClick={attemptClose}>Cancelar</Button>
          <Button variant="primary" icon="check" disabled={!canSave} loading={busy} onClick={() => void save()}>
            Salvar tipo
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome do tipo">
            <TextInput
              value={draft.label}
              onChange={(event) => patch({ label: event.target.value })}
              placeholder="Contrato de aluguel — Espanha"
              autoFocus
            />
          </Field>
          <Field label="Categoria" hint="Entra na lista dessa categoria no assistente.">
            <Select
              aria-label="Categoria do tipo"
              className="w-full"
              value={groupChoice}
              onChange={(next) => {
                dirtyRef.current = true;
                setGroupChoice(next);
              }}
              options={[
                ...groups.map((candidate) => ({ value: candidate, label: candidate })),
                { value: NEW_GROUP, label: 'Nova categoria…', icon: 'plus' },
              ]}
            />
          </Field>
        </div>
        {groupChoice === NEW_GROUP ? (
          <Field label="Nome da nova categoria">
            <TextInput
              value={newGroup}
              onChange={(event) => {
                dirtyRef.current = true;
                setNewGroup(event.target.value);
              }}
              placeholder="Suíça"
              autoFocus
            />
          </Field>
        ) : null}

        <div className="flex flex-wrap items-end gap-6">
          <Field label="Cor" wrapper="div">
            <div className="flex items-center gap-2.5 py-1">
              {ACCENTS.map((accent) => (
                <button
                  key={accent}
                  type="button"
                  aria-label={`Cor ${accent}`}
                  onClick={() => patch({ accent })}
                  className="tap-target h-6 w-6 rounded-full transition"
                  style={{
                    backgroundColor: accent,
                    boxShadow: draft.accent === accent ? `0 0 0 3px color-mix(in srgb, ${accent} 35%, transparent)` : 'none',
                  }}
                />
              ))}
            </div>
          </Field>
          <Field label="Ícone" wrapper="div">
            <div className="flex items-center gap-1.5 py-0.5">
              {ICONS.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  aria-label={`Ícone ${icon}`}
                  onClick={() => patch({ icon })}
                  className={`tap-target flex h-9 w-9 items-center justify-center rounded-[10px] border transition ${
                    draft.icon === icon ? 'border-accent bg-accent/12' : 'border-line-soft hover:bg-raised'
                  }`}
                  style={{ color: draft.icon === icon ? draft.accent : 'var(--color-muted)' }}
                >
                  <Icon name={icon} size={17} />
                </button>
              ))}
            </div>
          </Field>
        </div>

        <div className="space-y-2 border-t border-line-soft pt-4">
          <p className="text-xs font-medium tracking-wide text-muted uppercase">Campos do formulário</p>
          {draft.fields.map((field, index) => (
            <div key={field.id} className="flex items-center gap-2 rounded-xl border border-line-soft bg-canvas px-2.5 py-2">
              <TextInput
                value={field.label}
                onChange={(event) => setFieldLabel(field.id, event.target.value)}
                placeholder="Nome do campo"
                className="border-none bg-transparent px-1 py-1 pointer-coarse:py-1.5"
              />
              <span
                className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${
                  field.id === 'expiresAt' ? 'bg-warn/12 text-warn' : 'bg-raised text-muted'
                }`}
              >
                {field.id === 'expiresAt' ? <Icon name="clock" size={10} /> : null}
                {kindLabel(field)}
              </span>
              <IconButton icon="arrowUp" label="Mover para cima" disabled={index === 0} onClick={() => move(index, -1)} />
              <IconButton
                icon="arrowDown"
                label="Mover para baixo"
                disabled={index === draft.fields.length - 1}
                onClick={() => move(index, 1)}
              />
              <IconButton
                icon="trash"
                label={`Remover campo ${field.label || kindLabel(field)}`}
                onClick={() => patch({ fields: draft.fields.filter((candidate) => candidate.id !== field.id) })}
              />
            </div>
          ))}

          {paletteOpen ? (
            <div className="grid gap-1.5 rounded-xl border border-line-soft p-2 sm:grid-cols-2">
              {KIND_PALETTE.map((option) => {
                const blocked = option.single ? draft.fields.some((field) => field.id === option.single) : false;
                return (
                  <button
                    key={option.label}
                    type="button"
                    disabled={blocked}
                    onClick={() => addField(option)}
                    className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-raised disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span className="text-sm text-ink">{option.label}</span>
                    <span className="truncate text-xs text-faint">{blocked ? 'já existe' : option.hint}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line px-3 py-3 text-sm font-medium text-muted transition hover:bg-raised hover:text-ink"
            >
              <Icon name="plus" size={15} />
              Adicionar campo
            </button>
          )}

          <p className="pt-1 text-xs text-faint">
            O tipo viaja cifrado no cofre e aparece em todos os seus dispositivos, na categoria escolhida.
          </p>
        </div>
      </div>
    </Modal>
  );
}
