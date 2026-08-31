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
import { Icon } from './icons';
import { ensureIdentity } from '../lib/identity';
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
      <p className="mt-4 text-xs leading-relaxed text-muted">
        Depois de enviar, a outra pessoa libera o acesso do lado dela. Você vai precisar entrar com a sua conta
        Google aqui — é por ela que o Drive libera os arquivos.
      </p>
    </Modal>
  );
}
