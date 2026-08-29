/** Pre-vault screens: OAuth setup, Google sign-in, vault creation and unlock. */
import { useState, type FormEvent, type ReactNode } from 'react';
import { Button, Field, PasswordInput, TextInput } from '../components/ui';
import { Icon, Wordmark } from '../components/icons';
import { estimateStrength } from '../lib/generator';
import { useKeeper } from '../state/keeper';
import { isClientIdOverridden } from '../lib/storage';

function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="animate-in w-full max-w-md">
        <div className="mb-6">
          <Wordmark height={36} />
          <p className="mt-2 text-sm font-semibold tracking-tight text-ink">Keeper</p>
          <p className="text-xs text-muted">Cofre de segredos e documentos, cifrado ponta a ponta</p>
        </div>
        <div className="card p-6">
          <h1 className="text-lg font-semibold text-ink">{title}</h1>
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
          <div className="mt-5">{children}</div>
        </div>
        {footer ? <div className="mt-4 text-xs leading-relaxed text-faint">{footer}</div> : null}
      </div>
    </div>
  );
}

export function ConfigScreen() {
  const { actions, busy } = useKeeper();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed.endsWith('.apps.googleusercontent.com')) {
      setError('O client id deve terminar em .apps.googleusercontent.com');
      return;
    }
    setError(null);
    actions.setClientId(trimmed);
  };

  return (
    <AuthShell
      title="Configurar acesso ao Google"
      subtitle="O app precisa de um OAuth Client ID para falar com o seu Google Drive. Ele é um identificador público, não um segredo."
    >
      <form onSubmit={submit} className="space-y-4">
        <ol className="space-y-2 rounded-lg border border-line bg-raised p-4 text-xs leading-relaxed text-muted">
          <li>
            <strong className="text-ink">1.</strong> Abra o{' '}
            <a
              className="text-accent hover:underline"
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noreferrer noopener"
            >
              Google Cloud Console <Icon name="external" size={11} className="inline" />
            </a>{' '}
            e crie um projeto.
          </li>
          <li>
            <strong className="text-ink">2.</strong> Ative a <em>Google Drive API</em> e configure a tela de consentimento
            (tipo <em>External</em>, com você como usuário de teste).
          </li>
          <li>
            <strong className="text-ink">3.</strong> Crie uma credencial <em>OAuth client ID</em> do tipo{' '}
            <em>Web application</em>.
          </li>
          <li>
            <strong className="text-ink">4.</strong> Em <em>Authorized JavaScript origins</em>, adicione a origem onde
            este app roda: <code className="text-ink">{window.location.origin}</code>
          </li>
        </ol>
        <Field
          label="OAuth Client ID"
          hint="Termina em .apps.googleusercontent.com"
          error={error ?? undefined}
        >
          <TextInput
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
            placeholder="1234567890-abc123.apps.googleusercontent.com"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Button type="submit" variant="primary" className="w-full" loading={busy} icon="check">
          Salvar e continuar
        </Button>
      </form>
    </AuthShell>
  );
}

export function SignInScreen() {
  const { actions, busy, hasLocalVault, online } = useKeeper();

  return (
    <AuthShell
      title="Entrar com o Google"
      subtitle="Seus segredos são cifrados neste navegador antes de subir. O Google guarda apenas bytes que não consegue ler."
      footer={
        <>
          O app pede somente o escopo <code className="text-muted">drive.appdata</code>: uma pasta oculta e exclusiva
          dele. Nenhum outro arquivo do seu Drive fica visível.{' '}
          {isClientIdOverridden() ? (
            <button type="button" className="text-accent hover:underline" onClick={() => actions.setClientId('')}>
              Trocar o Client ID
            </button>
          ) : null}
        </>
      }
    >
      <div className="space-y-3">
        <Button
          variant="primary"
          className="w-full"
          loading={busy}
          onClick={() => void actions.connectGoogle(true)}
          disabled={!online}
        >
          <Icon name="google" size={16} />
          Continuar com o Google
        </Button>
        {!online ? (
          <p className="flex items-center gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
            <Icon name="cloudOff" size={14} /> Você está offline.
          </p>
        ) : null}
        {hasLocalVault ? (
          <Button variant="outline" className="w-full" icon="lock" onClick={actions.continueOffline}>
            Abrir cofre salvo neste dispositivo
          </Button>
        ) : null}
      </div>
    </AuthShell>
  );
}

export function CreateVaultScreen() {
  const { actions, busy, account } = useKeeper();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);

  const strength = estimateStrength(password);
  const tooShort = password.length > 0 && password.length < 12;
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit = password.length >= 12 && !mismatch && confirm.length > 0 && acknowledged && !busy;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canSubmit) void actions.createVault(password);
  };

  return (
    <AuthShell
      title="Criar sua senha mestra"
      subtitle={`Ela cifra tudo que entra no cofre${account ? ` de ${account.email}` : ''}. É a única chave — nem o Google, nem este app conseguem recuperá-la.`}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field
          label="Senha mestra"
          hint="Mínimo de 12 caracteres. Uma frase longa costuma ser melhor que uma senha curta e complexa."
          error={tooShort ? 'Use pelo menos 12 caracteres.' : undefined}
        >
          <PasswordInput
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus
            autoComplete="new-password"
          />
        </Field>
        {password ? (
          <div className="flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line-soft">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(100, (strength.score + 1) * 20)}%`,
                  backgroundColor:
                    strength.score >= 3
                      ? 'var(--color-ok)'
                      : strength.score >= 2
                        ? 'var(--color-warn)'
                        : 'var(--color-danger)',
                }}
              />
            </div>
            <span className="text-xs text-muted">
              {strength.label} · ~{strength.bits} bits
            </span>
          </div>
        ) : null}
        <Field label="Confirme a senha mestra" error={mismatch ? 'As senhas não conferem.' : undefined}>
          <PasswordInput
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-warn/30 bg-warn/5 p-3 text-xs leading-relaxed text-muted">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
            className="mt-0.5 accent-[var(--color-accent)]"
          />
          <span>
            Entendi que <strong className="text-ink">não existe recuperação de senha</strong>. Se eu esquecê-la, os
            segredos ficam permanentemente ilegíveis.
          </span>
        </label>
        <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={!canSubmit}>
          Criar cofre
        </Button>
      </form>
    </AuthShell>
  );
}

export function UnlockScreen() {
  const { actions, busy, account, online, connected } = useKeeper();
  const [password, setPassword] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (password) void actions.unlock(password);
  };

  return (
    <AuthShell
      title="Desbloquear cofre"
      subtitle={account ? `Cofre de ${account.email}` : 'Digite a senha mestra para decifrar os segredos.'}
      footer={
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex items-center gap-1.5">
            <Icon name={connected ? 'cloud' : 'cloudOff'} size={12} />
            {connected ? 'Sincronizado com o Drive' : online ? 'Sem conexão com o Drive' : 'Offline'}
          </span>
          <button type="button" className="text-accent hover:underline" onClick={actions.wipeDevice}>
            Usar outra conta / limpar este dispositivo
          </button>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Senha mestra">
          <PasswordInput
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus
            autoComplete="current-password"
          />
        </Field>
        <Button type="submit" variant="primary" className="w-full" loading={busy} icon="unlock" disabled={!password}>
          Desbloquear
        </Button>
        {!connected && online ? (
          <Button variant="ghost" className="w-full" onClick={() => void actions.connectGoogle(true)}>
            <Icon name="google" size={14} /> Reconectar conta Google
          </Button>
        ) : null}
      </form>
    </AuthShell>
  );
}
