/** Read-only view of a single secret. */
import { DEFAULT_WARNING_DAYS, describeExpiry, isExpiryField, statusOf } from '../lib/expiry';
import { getType, isMultilineKind, isSecretKind, type VaultItem } from '../lib/model';
import { Badge, Button, IconButton } from './ui';
import { Icon } from './icons';
import { AttachmentList } from './Attachments';
import { SecretValue, TotpCode } from './SecretValue';
import { useKeeper } from '../state/keeper';

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('pt-BR', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatDay(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('pt-BR', { dateStyle: 'long' });
}

/**
 * Only a validity date gets the colour treatment. Flagging every date meant an
 * *issue* date — which is in the past by definition — showed up in red as
 * expired, teaching the user to ignore the one signal that matters.
 */
function DateValue({
  fieldId,
  value,
  warningDays,
}: {
  fieldId: string;
  value: string;
  warningDays: number;
}) {
  if (!isExpiryField(fieldId)) return <span className="text-sm text-ink">{formatDay(value)}</span>;

  const days = Math.ceil((Date.parse(`${value}T23:59:59`) - Date.now()) / 86_400_000) - 1;
  if (Number.isNaN(days)) return <span className="text-sm text-ink">{formatDay(value)}</span>;

  const status = statusOf(days, warningDays);
  const tone = status === 'expired' ? 'text-danger' : status === 'soon' ? 'text-warn' : 'text-ink';
  return (
    <span className={`text-sm ${tone}`}>
      {formatDay(value)}
      {status === 'ok' ? '' : ` · ${describeExpiry({ days })}`}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-line-soft py-3 last:border-0">
      <p className="mb-1 text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
      {children}
    </div>
  );
}

export function ItemDetail({
  item,
  onEdit,
  onClose,
}: {
  item: VaultItem;
  onEdit: () => void;
  onClose: () => void;
}) {
  const { actions, payload } = useKeeper();
  const type = getType(item.type);
  const conceal = payload?.preferences.concealSecrets ?? true;
  const warningDays = payload?.preferences.expiryWarningDays ?? DEFAULT_WARNING_DAYS;
  const holder = payload?.people.find((person) => person.id === item.holderId && !person.deletedAt);
  const filled = type.fields.filter((field) => (item.fields[field.id] ?? '').trim().length > 0);
  const extras = Object.entries(item.fields).filter(
    ([key, value]) => value?.trim() && !type.fields.some((field) => field.id === key),
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start gap-3 border-b border-line px-5 py-4">
        <span
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ color: type.accent, backgroundColor: `color-mix(in srgb, ${type.accent} 14%, transparent)` }}
        >
          <Icon name={type.icon} size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-ink">{item.name || 'Sem título'}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge color={type.accent}>{type.label}</Badge>
            {holder ? (
              <Badge className="bg-raised text-muted">
                <Icon name="users" size={11} /> {holder.name}
              </Badge>
            ) : null}
            {item.folder ? (
              <Badge className="bg-raised text-muted">
                <Icon name="folder" size={11} /> {item.folder}
              </Badge>
            ) : null}
            {item.tags.map((tag) => (
              <Badge key={tag} className="bg-raised text-muted">
                <Icon name="tag" size={11} /> {tag}
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton
            icon="star"
            label={item.favorite ? 'Remover dos favoritos' : 'Favoritar'}
            active={item.favorite}
            onClick={() => void actions.toggleFavorite(item.id)}
          />
          {!item.deletedAt ? <IconButton icon="pencil" label="Editar" onClick={onEdit} /> : null}
          <IconButton icon="x" label="Fechar" onClick={onClose} className="lg:hidden" />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">
        {item.description ? (
          <p className="border-b border-line-soft py-3 text-sm leading-relaxed text-muted">{item.description}</p>
        ) : null}

        {filled.map((field) => {
          const value = item.fields[field.id] ?? '';
          const fieldKey = `${item.id}:${field.id}`;
          if (field.kind === 'totp') {
            return (
              <Row key={field.id} label={field.label}>
                <TotpCode secret={value} fieldKey={fieldKey} />
              </Row>
            );
          }
          if (field.kind === 'date') {
            return (
              <Row key={field.id} label={field.label}>
                <DateValue fieldId={field.id} value={value} warningDays={warningDays} />
              </Row>
            );
          }
          if (field.kind === 'url') {
            return (
              <Row key={field.id} label={field.label}>
                <div className="flex items-center gap-2">
                  <a
                    href={value}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="min-w-0 flex-1 truncate text-sm text-accent hover:underline"
                  >
                    {value}
                  </a>
                  <Icon name="external" size={13} className="shrink-0 text-faint" />
                </div>
              </Row>
            );
          }
          return (
            <Row key={field.id} label={field.label}>
              <SecretValue
                value={value}
                fieldKey={fieldKey}
                secret={isSecretKind(field.kind)}
                multiline={isMultilineKind(field.kind)}
                defaultRevealed={!conceal}
              />
            </Row>
          );
        })}

        {item.customFields
          .filter((field) => field.value.trim())
          .map((field) => (
            <Row key={field.id} label={field.label || 'Campo'}>
              <SecretValue
                value={field.value}
                fieldKey={`${item.id}:${field.id}`}
                secret={field.secret}
                multiline={field.value.includes('\n')}
                defaultRevealed={!conceal}
              />
            </Row>
          ))}

        {/* Values kept from a type that no longer declares this field. */}
        {extras.map(([key, value]) => (
          <Row key={key} label={`${key} (campo antigo)`}>
            <SecretValue value={value} fieldKey={`${item.id}:${key}`} secret defaultRevealed={!conceal} />
          </Row>
        ))}

        <AttachmentList refs={item.attachments} />

        <div className="flex flex-wrap gap-x-6 gap-y-1 py-4 text-xs text-faint">
          <span>Criado em {formatDate(item.createdAt)}</span>
          <span>Atualizado em {formatDate(item.updatedAt)}</span>
        </div>
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
        {item.deletedAt ? (
          <>
            <Button icon="refresh" onClick={() => void actions.restoreItem(item.id)}>
              Restaurar
            </Button>
            <Button
              variant="danger"
              icon="trash"
              onClick={() => {
                if (confirm(`Excluir "${item.name}" definitivamente? Esta ação não pode ser desfeita.`)) {
                  void actions.purgeItem(item.id);
                  onClose();
                }
              }}
            >
              Excluir para sempre
            </Button>
          </>
        ) : (
          <>
            <Button icon="pencil" onClick={onEdit}>
              Editar
            </Button>
            <Button
              variant="danger"
              icon="trash"
              onClick={() => {
                void actions.trashItem(item.id);
                onClose();
              }}
            >
              Mover para a lixeira
            </Button>
          </>
        )}
      </footer>
    </div>
  );
}
