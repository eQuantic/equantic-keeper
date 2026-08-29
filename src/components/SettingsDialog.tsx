/** Account, people, security, appearance, backup and danger-zone settings. */
import { useRef, useState } from 'react';
import { Button, Field, IconButton, Modal, PasswordInput, Switch, TextInput } from './ui';
import { Icon } from './icons';
import { useKeeper } from '../state/keeper';
import { exportEncrypted, exportPlaintext } from '../lib/backup';
import { estimateStrength } from '../lib/generator';
import { createPerson, type Person } from '../lib/model';
import { getClientId } from '../lib/storage';
import { TOMBSTONE_TTL_DAYS, activePeople } from '../lib/vault';

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
  'rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-sm text-ink focus:border-accent focus:outline-none';

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { actions, account, connected, payload, sync, busy } = useKeeper();
  const fileRef = useRef<HTMLInputElement>(null);

  const [changingPassword, setChangingPassword] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [importState, setImportState] = useState<{ text: string; name: string } | null>(null);
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

  const runImport = async () => {
    if (!importState) return;
    setImporting(true);
    setImportError(null);
    try {
      const added = await actions.importBackup(importState.text, importPassword);
      setImportState(null);
      setImportPassword('');
      actions.notify(`Importação concluída: ${added} item(ns) novo(s) adicionados ao cofre.`);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Falha ao importar.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Configurações" wide>
      <Section title="Conta Google" description="Usada apenas para guardar o arquivo cifrado na pasta oculta do app.">
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
          <label className="flex items-center justify-between gap-4 py-2 text-sm text-ink">
            <span>
              Bloquear automaticamente
              <span className="mt-0.5 block text-xs text-muted">A chave é apagada da memória após inatividade.</span>
            </span>
            <select
              className={selectClass}
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
          <label className="flex items-center justify-between gap-4 py-2 text-sm text-ink">
            <span>
              Limpar área de transferência
              <span className="mt-0.5 block text-xs text-muted">Após copiar um segredo.</span>
            </span>
            <select
              className={selectClass}
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
          <label className="flex items-center justify-between gap-4 py-2 text-sm text-ink">
            <span>
              Avisar sobre validade
              <span className="mt-0.5 block text-xs text-muted">
                Com quanta antecedência um documento aparece como “vence em breve”.
              </span>
            </span>
            <select
              className={selectClass}
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
        <div className="flex items-center justify-between gap-4 py-1 text-sm text-ink">
          <span>Tema</span>
          <select
            className={selectClass}
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
        title="Backup e portabilidade"
        description={`Itens na lixeira são apagados definitivamente após ${TOMBSTONE_TTL_DAYS} dias.`}
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
          accept=".json,application/json"
          className="hidden"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            setImportState({ text: await file.text(), name: file.name });
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
