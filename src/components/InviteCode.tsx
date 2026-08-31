/**
 * The code someone sends to be let into another person's vault.
 *
 * It is this device's PUBLIC key, and nothing else: whoever reads it on the way
 * learns that someone was invited, and gains no way to open anything. That is
 * the whole reason the flow starts from this side instead of the owner mailing
 * out a secret — there is nothing here to intercept.
 */
import { useEffect, useState } from 'react';
import { Button, Modal, Spinner } from './ui';
import { KEEPER_FOLDER_NAME } from '../lib/drive';
import { Icon } from './icons';
import { useKeeper } from '../state/keeper';
import { ensureIdentity } from '../lib/identity';
import { getPickerApiKey, setPickerApiKey } from '../lib/storage';
import { fingerprint, inviteCode } from '../lib/invites';
import { shareSheetAvailable, shareText } from '../lib/share';

export function InviteCodePanel() {
  const [code, setCode] = useState<string | null>(null);
  const [print, setPrint] = useState('');
  const [persisted, setPersisted] = useState(true);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { identity, persisted: stored } = await ensureIdentity();
        const value = await inviteCode(identity);
        const mark = await fingerprint(identity.publicKey);
        if (!alive) return;
        setCode(value);
        setPrint(mark);
        setPersisted(stored);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (failed) {
    return <p className="text-xs text-danger">Não foi possível gerar o código neste navegador.</p>;
  }

  if (!code) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted">
        <Spinner /> Gerando o código deste aparelho…
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-muted">
        Envie este código para quem vai lhe dar acesso. Ele não é segredo: pode ir por WhatsApp, e-mail ou
        ditado ao telefone. Só este aparelho consegue abrir o que for enviado para ele.
      </p>

      <div className="rounded-lg border border-line bg-canvas p-3">
        <p className="font-mono text-xs leading-relaxed break-all text-ink">{code}</p>
        <p className="mt-2 text-[11px] text-faint">
          Confirmação: <span className="font-mono text-muted">{print}</span> — devem ser os mesmos 16
          caracteres na tela da outra pessoa.
        </p>
      </div>

      {!persisted ? (
        <p className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 p-2.5 text-xs text-warn">
          <Icon name="warning" size={14} className="mt-0.5 shrink-0" />
          <span>
            Este navegador não deixou guardar a chave deste aparelho, então o código deixa de valer quando você
            fechar a aba. Numa janela anônima é isso mesmo que acontece — abra o Keeper numa janela normal antes
            de enviar.
          </span>
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          icon={copied ? 'check' : 'copy'}
          onClick={() => {
            // No auto-clear here, unlike a copied secret: this has to survive
            // the walk to another app, and it is public anyway.
            void navigator.clipboard?.writeText(code).then(() => setCopied(true));
          }}
        >
          {copied ? 'Copiado' : 'Copiar código'}
        </Button>
        {shareSheetAvailable() ? (
          <Button size="sm" icon="share" onClick={() => void shareText('Meu código do Keeper', code)}>
            Enviar
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Offered to someone who has just signed in and has no vault: they may not be
 * here to make one, they may be here because someone shared theirs.
 */
/**
 * The picker key normally comes baked into the build. When it does not, a guest
 * has nowhere to put one — Configurações needs a vault, and a guest may have
 * none — so it is asked for at the moment it is needed. Returns false when the
 * person declines, and the caller does nothing.
 */
export function ensurePickerKey(): boolean {
  if (getPickerApiKey()) return true;
  const value = prompt(
    'Este app foi publicado sem a chave de API do Google que abre o seletor de arquivos. Peça a chave a ' +
      'quem administra o app e cole aqui:',
    '',
  );
  if (!value?.trim()) return false;
  setPickerApiKey(value);
  return true;
}

/**
 * What happens next, before it happens.
 *
 * The picker is Google's screen, not ours, and being dropped into it with no
 * warning — asked to find a folder among everything anyone has ever shared with
 * you — is bewildering. It is also a one-time step: the permission it grants
 * belongs to the account, so the vault is in the list from then on. Both of
 * those are worth one short paragraph.
 */
export function OpenSharedDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { actions, busy } = useKeeper();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Abrir um cofre partilhado"
      subtitle="Só nesta primeira vez"
    >
      <div className="space-y-3 text-sm leading-relaxed text-ink">
        <p>
          O Google vai perguntar qual pasta você quer abrir. Escolha a pasta{' '}
          <strong className="font-semibold">{KEEPER_FOLDER_NAME}</strong> — é a que a outra pessoa partilhou
          com você. A tela já abre filtrada nela.
        </p>
        <p className="text-xs text-muted">
          É o Google que decide o que este app pode ver, e ele só libera o que você apontar. Por isso esta
          pergunta existe, e por isso acontece uma vez só: depois o cofre fica na lista lá em cima, junto com o
          seu.
        </p>
        <p className="text-xs text-muted">
          Se a pasta não aparecer, a outra pessoa ainda não liberou o acesso — mande o seu código de convite
          para ela.
        </p>
        <p className="text-xs text-faint">
          Se o Google responder “The API developer key is invalid”, o problema é da configuração do app, não
          sua: a chave de API precisa ter a <strong className="text-muted">Google Picker API</strong> liberada
          em <em>API restrictions</em>. Avise quem administra o app.
        </p>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button
          variant="primary"
          icon="folder"
          loading={busy}
          onClick={() => {
            if (!ensurePickerKey()) return;
            void actions.openSharedVault();
            onClose();
          }}
        >
          Escolher a pasta
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Agora não
        </Button>
      </div>
    </Modal>
  );
}

export function OpenSharedButton() {
  const { busy } = useKeeper();
  const [intro, setIntro] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        className="w-full"
        icon="share"
        loading={busy}
        onClick={() => setIntro(true)}
      >
        Abrir um cofre partilhado comigo
      </Button>
      <OpenSharedDialog open={intro} onClose={() => setIntro(false)} />
    </>
  );
}

/** The same panel, for someone who has no vault of their own yet. */
export function InviteCodeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Fui convidado por alguém"
      subtitle="Mande seu código para quem tem o cofre"
    >
      <InviteCodePanel />

      {/* The loop closes here on purpose: the person who just sent their code
          has no reason to know that the next step is a button on another
          screen — and the only question the flow ever raised was "and now?". */}
      <div className="mt-5 border-t border-line-soft pt-4">
        <p className="mb-1 text-sm text-ink">Depois de enviar o código</p>
        <p className="mb-3 text-xs leading-relaxed text-muted">
          A outra pessoa cola o seu código no Keeper dela e libera o acesso. Não há nada para você colar aqui:
          quando ela avisar, entre com a sua conta Google e abra o cofre.
        </p>
        <OpenSharedButton />
      </div>
    </Modal>
  );
}
