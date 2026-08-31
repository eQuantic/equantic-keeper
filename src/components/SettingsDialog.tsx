/** Account, people, security, appearance, backup and danger-zone settings. */
import { useEffect, useRef, useState } from 'react';
import { Button, Field, IconButton, Modal, PasswordInput, Switch, TextInput } from './ui';
import { Icon } from './icons';
import { useKeeper } from '../state/keeper';
import { exportBundle, exportEncrypted, exportPlaintext } from '../lib/backup';
import { estimateStrength } from '../lib/generator';
import { createPerson, getType, type CustomTypeDef, type Person } from '../lib/model';
import { getClientId } from '../lib/storage';
import { TOMBSTONE_TTL_DAYS, activeCustomTypes, activePeople } from '../lib/vault';
import { KEEPER_FOLDER_NAME, type DriveUsage } from '../lib/drive';
import { formatBytes } from '../lib/attachments';
import { TypeBuilder } from './TypeBuilder';

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line-soft py-5 first:pt-0 last:border-0 last:pb-0">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {description ? <p className="mt-0.5 mb-3 text-xs leading-relaxed text-muted">{description}</p> : <div className="mb-3" />}
      {children}
    </section>
  );
}

/**
 * One holder. Edits are kept locally while typing and committed on blur, so a
 * name never reaches the vault (and the Drive sync) half-typed.
 */
function PersonRow({
  person,
  count,
  onSave,
  onRemove,
}: {
  person: Person;
  count: number;
  onSave: (person: Person) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState(person);

  const commit = (next: Person) => {
    if (next.name.trim() === person.name && next.relation === person.relation && next.birthDate === person.birthDate) {
      return;
    }
    if (!next.name.trim()) {
      setDraft(person);
      return;
    }
    onSave(next);
  };

  return (
    // Grid, not flex: `TextInput` is `w-full`, so per-input widths would fight it.
    <div className="grid items-center gap-2 rounded-lg border border-line bg-canvas p-2 sm:grid-cols-[minmax(0,1fr)_8rem_9.5rem_auto_auto]">
      <TextInput
        aria-label="Nome do titular"
        value={draft.name}
        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        onBlur={() => commit(draft)}
      />
      <TextInput
        aria-label="Parentesco"
        placeholder="parentesco"
        value={draft.relation}
        onChange={(event) => setDraft({ ...draft, relation: event.target.value })}
        onBlur={() => commit(draft)}
      />
      <TextInput
        type="date"
        aria-label="Data de nascimento"
        value={draft.birthDate}
        onChange={(event) => {
          const next = { ...draft, birthDate: event.target.value };
          setDraft(next);
          commit(next);
        }}
      />
      <span className="px-1 text-right text-xs whitespace-nowrap text-faint">
        {count === 1 ? '1 item' : `${count} itens`}
      </span>
      <IconButton
        icon="trash"
        label={`Remover ${person.name || 'titular'}`}
        onClick={() => {
          const warning = count
            ? `Remover ${person.name}? Os ${count} item(ns) desta pessoa continuam no cofre, apenas sem titular.`
            : `Remover ${person.name}?`;
          if (confirm(warning)) onRemove();
        }}
      />
    </div>
  );
}

function PeopleSection() {
  const { actions, payload } = useKeeper();
  const [newName, setNewName] = useState('');
  const people = activePeople(payload?.people ?? []);
  const items = payload?.items ?? [];

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    void actions.savePerson(createPerson(name));
    setNewName('');
  };

  return (
    <Section
      title="Pessoas"
      description="Titulares dos documentos: você, cônjuge, filhos. Cada item pode apontar para uma pessoa."
    >
      <div className="space-y-2">
        {people.map((person) => (
          <PersonRow
            key={person.id}
            person={person}
            count={items.filter((item) => item.holderId === person.id && !item.deletedAt).length}
            onSave={(next) => void actions.savePerson(next)}
            onRemove={() => void actions.removePerson(person.id)}
          />
        ))}
        {people.length === 0 ? (
          <p className="text-xs text-muted">Nenhuma pessoa cadastrada ainda.</p>
        ) : null}
        <div className="flex gap-2">
          <TextInput
            className="flex-1"
            aria-label="Nome da nova pessoa"
            placeholder="Nome da pessoa"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                add();
              }
            }}
          />
          <Button size="sm" icon="plus" onClick={add} disabled={!newName.trim()}>
            Adicionar
          </Button>
        </div>
      </div>
    </Section>
  );
}

const selectClass =
  'min-w-0 max-w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-sm text-ink focus:border-accent focus:outline-none pointer-coarse:rounded-xl pointer-coarse:px-3 pointer-coarse:py-2.5';

/*
 * A `select` refuses to shrink below its widest option, so on narrow phones
 * (320–375px: mini, SE, Display Zoom) a roomy row overflows the sheet and the
 * whole content pans sideways. These rows wrap instead: the control drops to
 * its own line, right-aligned, iOS-Settings style.
 */
const prefRowClass = 'flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 py-2 text-sm text-ink';
const prefLabelClass = 'min-w-0 flex-1 basis-48';

/**
 * What this vault costs the Drive account.
 *
 * The app folder is invisible in the Drive UI — the only place a person can
 * find out is here. Asked for on demand, not on open: it is a couple of API
 * calls and nobody needs them every time they change a preference.
 */
/**
 * Where the vault is kept, and the one-way door out of the hidden app folder.
 *
 * "One-way" only in the sense that nobody would want to go back: the app folder
 * keeps its copy either way. What the move buys is the ability to share, which
 * Drive flatly refuses for anything stored in the app folder.
 */
function DriveFolderSection() {
  const { actions, connected, driveFolderId, driveMove, driveMovedElsewhere, phase } = useKeeper();
  const [cleaning, setCleaning] = useState(false);

  if (!connected) {
    return <p className="text-xs text-muted">Conecte a conta do Google para escolher onde o cofre fica.</p>;
  }

  const discard = async () => {
    if (
      !confirm(
        'Apagar a cópia do cofre na pasta oculta do app? A cópia da pasta nova é conferida arquivo por ' +
          'arquivo antes de qualquer coisa ser apagada.',
      )
    ) {
      return;
    }
    setCleaning(true);
    try {
      const { deleted, missing } = await actions.discardOldDriveCopy();
      actions.notify(
        missing.length
          ? `Nada foi apagado: ${missing.length} arquivo(s) ainda não estão na pasta nova (${missing
              .slice(0, 3)
              .join(', ')}). Mova o cofre de novo e tente depois.`
          : `Cópia antiga apagada: ${deleted} arquivo(s) liberados da pasta oculta.`,
      );
    } catch (error) {
      actions.notify(error instanceof Error ? error.message : 'Não foi possível apagar a cópia antiga.');
    } finally {
      setCleaning(false);
    }
  };

  if (driveFolderId) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-3 rounded-lg border border-line bg-canvas p-3">
          <Icon name="folder" size={16} className="mt-0.5 shrink-0 text-accent" />
          <div className="min-w-0 text-sm text-ink">
            <p>
              O cofre está na pasta <strong className="font-semibold">{KEEPER_FOLDER_NAME}</strong> do seu Drive.
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Continua tudo cifrado: quem abrir a pasta vê arquivos ilegíveis sem a sua senha mestra. A cópia
              antiga na pasta oculta do app não foi apagada.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="danger" icon="trash" loading={cleaning} onClick={() => void discard()}>
            Apagar a cópia antiga
          </Button>
          <span className="text-xs text-muted">
            Só apaga depois de conferir que está tudo na pasta nova.
          </span>
        </div>
      </div>
    );
  }

  const moving = !!driveMove;
  return (
    <div className="space-y-3">
      {driveMovedElsewhere ? (
        <div className="flex items-start gap-3 rounded-lg border border-warn/40 bg-warn/10 p-3">
          <Icon name="warning" size={16} className="mt-0.5 shrink-0 text-warn" />
          <div className="min-w-0 text-sm text-ink">
            <p>Este cofre já foi movido para uma pasta do Drive em outro aparelho.</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Este aqui ainda sincroniza pela pasta oculta, então as alterações dos dois lados não se
              encontram. Conceda a permissão abaixo para trazê-lo de volta à mesma pasta.
            </p>
          </div>
        </div>
      ) : (
        <>
          <p className="text-xs leading-relaxed text-muted">
            Hoje o cofre fica na pasta oculta do aplicativo. É o acesso mais restrito que o Drive oferece, mas
            nada guardado ali pode ser partilhado com outra pessoa — é uma regra do próprio Drive. Mover para
            uma pasta sua é o primeiro passo para dar acesso a alguém.
          </p>
          <p className="text-xs leading-relaxed text-muted">
            Os arquivos são copiados, nunca movidos: se algo falhar no meio, o cofre continua inteiro nos dois
            lados.
          </p>
        </>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          icon="folder"
          loading={moving}
          disabled={phase !== 'unlocked'}
          onClick={() => void actions.moveToDriveFolder()}
        >
          {driveMovedElsewhere ? 'Conectar este aparelho à pasta' : 'Mover para uma pasta do Drive'}
        </Button>
        {moving && driveMove.total > 0 ? (
          <span className="text-xs text-muted">
            Copiando {driveMove.done} de {driveMove.total}…
          </span>
        ) : null}
        {phase !== 'unlocked' ? <span className="text-xs text-muted">Abra o cofre primeiro.</span> : null}
      </div>
    </div>
  );
}

function DriveUsageSection() {
  const { actions, connected, driveFolderId } = useKeeper();
  const [usage, setUsage] = useState<DriveUsage | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const read = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const result = await actions.driveUsage();
      setUsage(result);
      setFailed(!result);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (connected) void read();
    // Reading again on every render would spend requests for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  if (!connected) {
    return <p className="text-xs text-muted">Conecte a conta do Google para ver o espaço ocupado.</p>;
  }

  const inFolder = !!driveFolderId;
  const rows: { label: string; bytes: number }[] = usage
    ? [
        { label: 'Cofre cifrado', bytes: usage.vault },
        { label: 'Anexos', bytes: usage.attachments },
        { label: 'Backups automáticos', bytes: usage.backups },
        ...(usage.other > 0 ? [{ label: 'Outros arquivos', bytes: usage.other }] : []),
      ]
    : [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-canvas p-3">
        <div className="min-w-0">
          <p className="text-sm text-ink">
            {usage ? formatBytes(usage.total) : busy ? 'Somando…' : '—'}
            {usage ? (
              <span className="text-muted"> em {usage.files} {usage.files === 1 ? 'arquivo' : 'arquivos'}</span>
            ) : null}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {usage?.quota
              ? `A conta usa ${formatBytes(usage.quota.used)} de ${formatBytes(usage.quota.limit)} no total.`
              : inFolder
                ? `Na pasta "${KEEPER_FOLDER_NAME}" do seu Drive.`
                : 'Na pasta oculta do app — não aparece no Drive nem conta como arquivo seu.'}
          </p>
        </div>
        <Button size="sm" icon="refresh" loading={busy} onClick={() => void read()}>
          Recalcular
        </Button>
      </div>

      {failed ? (
        <p className="text-xs text-warn">Não foi possível ler o espaço agora. Tente de novo.</p>
      ) : null}

      {usage && usage.total > 0 ? (
        <>
          <div className="flex h-2 overflow-hidden rounded-full bg-raised" aria-hidden="true">
            {rows.map((row, index) =>
              row.bytes > 0 ? (
                <span
                  key={row.label}
                  style={{
                    width: `${(row.bytes / usage.total) * 100}%`,
                    backgroundColor: ['var(--color-accent)', '#2dd4bf', '#fbbf24', '#8d96ae'][index],
                  }}
                />
              ) : null,
            )}
          </div>
          <div className="space-y-1">
            {rows.map((row, index) => (
              <div key={row.label} className="flex items-center gap-2 text-xs">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: ['var(--color-accent)', '#2dd4bf', '#fbbf24', '#8d96ae'][index] }}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate text-muted">{row.label}</span>
                <span className="tabular-nums text-ink">{formatBytes(row.bytes)}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [editingType, setEditingType] = useState<CustomTypeDef | null>(null);
  const { actions, account, connected, driveFolderId, payload, sync, busy, biometricAvailable, biometricEnrolled } =
    useKeeper();
  const fileRef = useRef<HTMLInputElement>(null);

  const [changingPassword, setChangingPassword] = useState(false);
  const [enablingBiometrics, setEnablingBiometrics] = useState(false);
  const [biometricPassword, setBiometricPassword] = useState('');
  const [biometricError, setBiometricError] = useState<string | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [importState, setImportState] = useState<{ text: string; bytes?: Uint8Array; name: string } | null>(
    null,
  );
  const [bundling, setBundling] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const [importPassword, setImportPassword] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  if (!payload) return null;
  const prefs = payload.preferences;
  const strength = estimateStrength(next);

  const submitPasswordChange = async () => {
    setPasswordError(null);
    if (next.length < 12) {
      setPasswordError('A nova senha precisa ter ao menos 12 caracteres.');
      return;
    }
    if (next !== confirmPassword) {
      setPasswordError('A confirmação não confere.');
      return;
    }
    try {
      await actions.changeMasterPassword(current, next);
      setChangingPassword(false);
      setCurrent('');
      setNext('');
      setConfirmPassword('');
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : 'Falha ao alterar a senha.');
    }
  };

  const submitEnableBiometrics = async () => {
    setBiometricError(null);
    try {
      await actions.enableBiometrics(biometricPassword);
      setEnablingBiometrics(false);
      setBiometricPassword('');
    } catch (error) {
      setBiometricError(error instanceof Error ? error.message : 'Falha ao ativar a biometria.');
    }
  };

  const runImport = async () => {
    if (!importState) return;
    setImporting(true);
    setImportError(null);
    try {
      if (importState.bytes) {
        const { items, attachments } = await actions.importBundle(importState.bytes, importPassword);
        setImportState(null);
        setImportPassword('');
        actions.notify(
          `Importação concluída: ${items} item(ns) novo(s) e ${attachments} anexo(s) restaurado(s).`,
        );
      } else {
        const added = await actions.importBackup(importState.text, importPassword);
        setImportState(null);
        setImportPassword('');
        actions.notify(`Importação concluída: ${added} item(ns) novo(s) adicionados ao cofre.`);
      }
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Falha ao importar.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Configurações" wide>
      <Section
        title="Conta Google"
        description={
          driveFolderId
            ? `Usada apenas para guardar o arquivo cifrado na pasta "${KEEPER_FOLDER_NAME}" do seu Drive.`
            : 'Usada apenas para guardar o arquivo cifrado na pasta oculta do app.'
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-canvas p-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-raised text-muted">
              <Icon name={connected ? 'google' : 'cloudOff'} size={16} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm text-ink">{account?.email ?? 'Não conectado'}</p>
              <p className="text-xs text-muted">
                {connected ? 'Conectado' : 'Offline — alterações ficam só neste dispositivo'}
                {sync.at ? ` · última sincronização ${new Date(sync.at).toLocaleTimeString('pt-BR')}` : ''}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" icon="refresh" onClick={() => void actions.syncNow()} loading={sync.status === 'syncing'}>
              Sincronizar
            </Button>
            {connected ? (
              <Button size="sm" variant="ghost" icon="logout" onClick={() => void actions.signOut()}>
                Desconectar
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => void actions.connectGoogle(true)}>
                Conectar
              </Button>
            )}
          </div>
        </div>
        {sync.status === 'conflict' ? (
          <div className="mt-3 rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs text-warn">
            <p className="flex items-center gap-1.5 font-medium">
              <Icon name="warning" size={13} /> Conflito de senha mestra
            </p>
            <p className="mt-1 leading-relaxed">{sync.message}</p>
            <Button
              size="sm"
              variant="danger"
              className="mt-2"
              onClick={() => {
                if (confirm('Sobrescrever o cofre do Drive com a versão deste dispositivo?')) {
                  void actions.syncNow(true);
                }
              }}
            >
              Sobrescrever o Drive com esta versão
            </Button>
          </div>
        ) : null}
      </Section>

      <PeopleSection />

      <Section title="Segurança">
        <div className="space-y-1">
          <label className={prefRowClass}>
            <span className={prefLabelClass}>
              Bloquear automaticamente
              <span className="mt-0.5 block text-xs text-muted">
                {prefs.autoLockMinutes === 0
                  ? 'O cofre reabre sem senha neste dispositivo até você bloquear manualmente.'
                  : 'Sem uso por esse tempo, a senha é pedida de novo. Recarregar dentro do período mantém o cofre aberto.'}
              </span>
            </span>
            <select
              className={`${selectClass} ml-auto`}
              aria-label="Bloquear automaticamente"
              value={prefs.autoLockMinutes}
              onChange={(event) => void actions.updatePreferences({ autoLockMinutes: Number(event.target.value) })}
            >
              <option value={1}>1 minuto</option>
              <option value={5}>5 minutos</option>
              <option value={15}>15 minutos</option>
              <option value={30}>30 minutos</option>
              <option value={60}>1 hora</option>
              <option value={0}>Nunca (não recomendado)</option>
            </select>
          </label>
          <label className={prefRowClass}>
            <span className={prefLabelClass}>
              Limpar área de transferência
              <span className="mt-0.5 block text-xs text-muted">Após copiar um segredo.</span>
            </span>
            <select
              className={`${selectClass} ml-auto`}
              aria-label="Limpar área de transferência"
              value={prefs.clipboardClearSeconds}
              onChange={(event) =>
                void actions.updatePreferences({ clipboardClearSeconds: Number(event.target.value) })
              }
            >
              <option value={10}>10 segundos</option>
              <option value={30}>30 segundos</option>
              <option value={60}>1 minuto</option>
              <option value={0}>Não limpar</option>
            </select>
          </label>
          <label className={prefRowClass}>
            <span className={prefLabelClass}>
              Avisar sobre validade
              <span className="mt-0.5 block text-xs text-muted">
                Com quanta antecedência um documento aparece como “vence em breve”.
              </span>
            </span>
            <select
              className={`${selectClass} ml-auto`}
              aria-label="Avisar sobre validade"
              value={prefs.expiryWarningDays}
              onChange={(event) =>
                void actions.updatePreferences({ expiryWarningDays: Number(event.target.value) })
              }
            >
              <option value={30}>30 dias</option>
              <option value={60}>60 dias</option>
              <option value={90}>90 dias</option>
              <option value={180}>6 meses</option>
            </select>
          </label>
          <Switch
            label="Ocultar segredos por padrão"
            description="Exige um clique em “revelar” para exibir cada valor."
            checked={prefs.concealSecrets}
            onChange={(checked) => void actions.updatePreferences({ concealSecrets: checked })}
          />
        </div>

        {biometricAvailable ? (
          biometricEnrolled ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-line bg-canvas p-3">
              <span className="min-w-0 flex-1 basis-48 text-sm text-ink">
                <span className="flex items-center gap-2">
                  <Icon name="fingerprint" size={15} /> Desbloqueio por biometria
                </span>
                <span className="mt-0.5 block text-xs text-muted">
                  Ativado neste dispositivo. A senha mestra continua valendo em todos.
                </span>
              </span>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={actions.disableBiometrics}>
                Desativar
              </Button>
            </div>
          ) : enablingBiometrics ? (
            <div className="mt-3 space-y-3 rounded-lg border border-line bg-canvas p-3">
              <Field
                label="Senha mestra"
                hint="Confirma a senha e cria uma chave de acesso protegida por Face ID, digital ou o PIN do aparelho."
                error={biometricError ?? undefined}
              >
                <PasswordInput
                  value={biometricPassword}
                  onChange={(event) => setBiometricPassword(event.target.value)}
                  autoFocus
                />
              </Field>
              <p className="text-xs text-muted">
                A chave do cofre fica cifrada atrás da biometria, apenas neste dispositivo. Nada muda no
                cofre nem no Drive, e a senha mestra continua sendo a chave definitiva.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  loading={busy}
                  disabled={!biometricPassword}
                  onClick={() => void submitEnableBiometrics()}
                >
                  Ativar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEnablingBiometrics(false);
                    setBiometricPassword('');
                    setBiometricError(null);
                  }}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <Button
              className="mt-3 mr-2"
              size="sm"
              icon="fingerprint"
              onClick={() => setEnablingBiometrics(true)}
            >
              Ativar desbloqueio por biometria
            </Button>
          )
        ) : null}

        {changingPassword ? (
          <div className="mt-3 space-y-3 rounded-lg border border-line bg-canvas p-3">
            <Field label="Senha mestra atual">
              <PasswordInput value={current} onChange={(event) => setCurrent(event.target.value)} />
            </Field>
            <Field
              label="Nova senha mestra"
              hint={next ? `${strength.label} · ~${strength.bits} bits` : 'Mínimo de 12 caracteres.'}
            >
              <PasswordInput value={next} onChange={(event) => setNext(event.target.value)} />
            </Field>
            <Field label="Confirme a nova senha" error={passwordError ?? undefined}>
              <PasswordInput
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </Field>
            <p className="text-xs text-muted">
              O cofre inteiro será cifrado de novo e enviado ao Drive, substituindo a versão remota. Outros
              dispositivos passarão a exigir a nova senha.
            </p>
            <div className="flex gap-2">
              <Button variant="primary" size="sm" loading={busy} onClick={() => void submitPasswordChange()}>
                Alterar senha
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setChangingPassword(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <Button className="mt-3" size="sm" icon="key" onClick={() => setChangingPassword(true)}>
            Alterar senha mestra
          </Button>
        )}
      </Section>

      <Section title="Aparência">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 py-1 text-sm text-ink">
          <span>Tema</span>
          <select
            className={`${selectClass} ml-auto`}
            aria-label="Tema"
            value={prefs.theme}
            onChange={(event) =>
              void actions.updatePreferences({ theme: event.target.value === 'light' ? 'light' : 'dark' })
            }
          >
            <option value="dark">Escuro</option>
            <option value="light">Claro</option>
          </select>
        </div>
      </Section>

      <Section
        title="Onde o cofre fica"
        description="A pasta do Google Drive que guarda o arquivo cifrado e os anexos."
      >
        <DriveFolderSection />
      </Section>

      <Section
        title="Espaço no Google Drive"
        description="Quanto este cofre ocupa na conta conectada, item por item."
      >
        <DriveUsageSection />
      </Section>

      <Section
        title="Backup e portabilidade"
        description={`O cofre cifrado leva os dados; o pacote leva também os arquivos anexados. Itens na lixeira são apagados definitivamente após ${TOMBSTONE_TTL_DAYS} dias.`}
      >
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            icon="download"
            onClick={() => {
              const file = actions.currentVaultFile();
              if (file) exportEncrypted(file);
            }}
          >
            Exportar cofre cifrado
          </Button>
          <Button
            size="sm"
            icon="paperclip"
            loading={bundling}
            onClick={async () => {
              setBundling(true);
              try {
                const file = actions.currentVaultFile();
                if (!file) return;
                const { bytes, missing } = await actions.collectAttachments();
                exportBundle(file, bytes);
                if (missing.length) {
                  actions.notify(
                    `Backup gerado sem ${missing.length} anexo(s) que não pôde(ram) ser lido(s): ${missing.join(', ')}.`,
                  );
                }
              } finally {
                setBundling(false);
              }
            }}
          >
            Exportar cofre + anexos
          </Button>
          <Button size="sm" icon="upload" onClick={() => fileRef.current?.click()}>
            Importar backup
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon="warning"
            onClick={() => {
              if (
                confirm(
                  'Isto baixa TODOS os segredos em texto puro, sem criptografia. Qualquer pessoa com o arquivo poderá lê-los. Continuar?',
                )
              ) {
                exportPlaintext(payload);
              }
            }}
          >
            Exportar texto puro
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".json,.zip,application/json,application/zip"
          className="hidden"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            const isBundle = file.name.endsWith('.zip') || file.type === 'application/zip';
            setImportState({
              name: file.name,
              text: isBundle ? '' : await file.text(),
              ...(isBundle ? { bytes: new Uint8Array(await file.arrayBuffer()) } : {}),
            });
            setImportError(null);
          }}
        />
        {importState ? (
          <div className="mt-3 space-y-3 rounded-lg border border-line bg-canvas p-3">
            <p className="text-xs text-muted">
              Arquivo: <span className="text-ink">{importState.name}</span>. Os itens serão mesclados ao cofre atual
              (o mais recente vence em caso de conflito).
            </p>
            <Field label="Senha mestra do backup" error={importError ?? undefined}>
              <PasswordInput
                value={importPassword}
                onChange={(event) => setImportPassword(event.target.value)}
                autoFocus
              />
            </Field>
            <div className="flex gap-2">
              <Button variant="primary" size="sm" loading={importing} onClick={() => void runImport()}>
                Importar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setImportState(null)}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : null}
      </Section>

      {activeCustomTypes(payload?.customTypes ?? []).length > 0 ? (
        <Section
          title="Tipos personalizados"
          description="Criados no assistente de novo item. Remover um tipo não apaga os itens — eles continuam legíveis."
        >
          <div className="space-y-2">
            {activeCustomTypes(payload?.customTypes ?? []).map((custom) => (
              <div key={custom.id} className="flex items-center gap-3 rounded-lg border border-line-soft px-3 py-2">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={{ color: custom.accent, backgroundColor: `color-mix(in srgb, ${custom.accent} 13%, transparent)` }}
                >
                  <Icon name={getType(custom.id).icon} size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">{custom.label}</span>
                  <span className="block truncate text-xs text-muted">
                    {custom.group} · {custom.fields.length} campo(s)
                  </span>
                </span>
                <IconButton icon="pencil" label={`Editar tipo ${custom.label}`} onClick={() => setEditingType(custom)} />
                <IconButton
                  icon="trash"
                  label={`Remover tipo ${custom.label}`}
                  onClick={() => {
                    if (
                      confirm(
                        `Remover o tipo "${custom.label}"? Itens existentes continuam legíveis e mantêm os dados.`,
                      )
                    ) {
                      void actions.removeCustomType(custom.id);
                    }
                  }}
                />
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {editingType ? (
        <TypeBuilder
          existing={editingType}
          onSaved={() => setEditingType(null)}
          onClose={() => setEditingType(null)}
        />
      ) : null}

      <Section title="Avançado">
        <p className="mb-2 text-xs text-muted">
          OAuth Client ID em uso: <code className="text-ink">{getClientId() || 'nenhum'}</code>
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const value = prompt('Novo OAuth Client ID (deixe vazio para voltar ao padrão do app):', getClientId());
              if (value !== null) actions.setClientId(value);
            }}
          >
            Trocar Client ID
          </Button>
          <Button
            size="sm"
            icon="cloud"
            loading={sweeping}
            disabled={!connected}
            onClick={async () => {
              setSweeping(true);
              try {
                const removed = await actions.sweepDriveOrphans();
                actions.notify(
                  removed === 0
                    ? 'Nenhum anexo órfão para remover.'
                    : `${removed} anexo(s) órfão(s) removido(s) do Drive.`,
                );
              } catch (error) {
                actions.notify(error instanceof Error ? error.message : 'Falha ao limpar o Drive.');
              } finally {
                setSweeping(false);
              }
            }}
          >
            Liberar espaço no Drive
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon="trash"
            onClick={() => {
              if (
                confirm(
                  'Apagar o cofre salvo neste navegador? A cópia no Google Drive permanece intacta e pode ser baixada de novo.',
                )
              ) {
                actions.wipeDevice();
                onClose();
              }
            }}
          >
            Apagar dados deste dispositivo
          </Button>
        </div>
      </Section>
    </Modal>
  );
}
