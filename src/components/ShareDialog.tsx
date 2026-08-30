/**
 * Sends a copy of an item out of the vault, on purpose: through the system
 * share sheet on phones (WhatsApp, Gmail, Signal… all live there) or, without
 * one, by mailto / clipboard. Secret fields start unticked, TOTP seeds are
 * never offered — sharing your 2FA seed hands over the second factor for
 * good — and the dialog says plainly that whatever leaves, leaves in plain
 * text.
 */
import { useMemo, useState } from 'react';
import { getType, isSecretKind, type AttachmentRef, type VaultItem } from '../lib/model';
import {
  buildShareText,
  canShareFiles,
  mailtoUrl,
  shareFiles,
  shareSheetAvailable,
  shareText,
  type ShareField,
} from '../lib/share';
import { useKeeper } from '../state/keeper';
import { blocksToMarkdown, markdownFileName } from '../lib/markdown';
import { useCopy } from './SecretValue';
import { Button, Modal } from './ui';
import { Icon } from './icons';

function shareableFields(item: VaultItem): ShareField[] {
  const type = getType(item.type);
  const fields: ShareField[] = [];
  for (const field of type.fields) {
    const value = (item.fields[field.id] ?? '').trim();
    if (!value || field.kind === 'totp' || field.id === 'cardColor') continue;
    fields.push({ label: field.label, value, secret: isSecretKind(field.kind) });
  }
  for (const field of item.customFields) {
    const value = field.value.trim();
    if (!value) continue;
    fields.push({ label: field.label || 'Campo', value, secret: field.secret });
  }
  return fields;
}

export function ShareDialog({ item, onClose }: { item: VaultItem; onClose: () => void }) {
  const { actions } = useKeeper();
  const { copy, copiedKey } = useCopy();
  const fields = useMemo(() => shareableFields(item), [item]);
  const [checked, setChecked] = useState<boolean[]>(() => fields.map((field) => !field.secret));
  const [error, setError] = useState<string | null>(null);
  const sheet = shareSheetAvailable();
  const fileSharing = useMemo(
    () => canShareFiles([new File([''], 'probe.pdf', { type: 'application/pdf' })]),
    [],
  );

  const selected = fields.filter((_, index) => checked[index]);
  /**
   * A note is its body: what gets sent (or exported) is plain Markdown, so the
   * person on the other side reads a document and not a list of fields — and
   * the file opens in Obsidian, or any editor, without this app.
   */
  const markdown = useMemo(() => blocksToMarkdown(item.blocks), [item.blocks]);
  const text = markdown
    ? [`# ${item.name || 'Sem título'}`, '', markdown, ...(selected.length ? ['', buildShareText('', selected)] : [])]
        .join('\n')
        .trim()
    : buildShareText(item.name || 'Sem título', selected);
  const canSend = selected.length > 0 || !!markdown;

  const exportMarkdown = () => {
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = markdownFileName(item.name || 'nota');
    anchor.click();
    // Revoked on the next tick: the click has already handed the blob over.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    actions.notify('Nota exportada em Markdown — decifrada, fora do cofre.');
  };

  const sendText = async () => {
    setError(null);
    const outcome = await shareText(item.name || 'Item do Keeper', text);
    if (outcome === 'shared') {
      actions.notify('Compartilhado. O conteúdo saiu do cofre em texto puro.');
      onClose();
    } else if (outcome === 'failed') {
      setError('O compartilhamento falhou. Tente copiar e colar.');
    }
  };

  const sendAttachment = async (ref: AttachmentRef) => {
    setError(null);
    try {
      const blob = await actions.readAttachment(ref);
      const file = new File([blob], ref.name, { type: ref.mimeType });
      const outcome = await shareFiles(ref.name, [file]);
      if (outcome === 'shared') {
        actions.notify('Arquivo compartilhado — decifrado, fora do cofre.');
        onClose();
      } else if (outcome === 'failed') {
        setError('Não foi possível compartilhar este arquivo.');
      }
    } catch {
      setError('Não foi possível decifrar o anexo para compartilhar.');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Compartilhar"
      subtitle={item.name || 'Sem título'}
      footer={
        <>
          <Button onClick={onClose}>Fechar</Button>
          {markdown ? (
            <Button icon="download" onClick={exportMarkdown}>
              Baixar .md
            </Button>
          ) : null}
          {sheet ? (
            <Button variant="primary" icon="share" disabled={!canSend} onClick={() => void sendText()}>
              Compartilhar…
            </Button>
          ) : (
            <>
              <Button
                icon={copiedKey === 'share' ? 'check' : 'copy'}
                disabled={!canSend}
                onClick={() => void copy(text, 'share')}
              >
                {copiedKey === 'share' ? 'Copiado' : 'Copiar'}
              </Button>
              <a
                href={mailtoUrl(item.name || 'Item do Keeper', text)}
                className={`inline-flex items-center justify-center gap-2 rounded-lg border border-transparent bg-accent px-3.5 py-2 text-sm font-medium text-white hover:brightness-110 pointer-coarse:rounded-xl pointer-coarse:px-4 pointer-coarse:py-3 ${
                  canSend ? '' : 'pointer-events-none opacity-50'
                }`}
              >
                <Icon name="share" size={16} />
                Enviar por e-mail
              </a>
            </>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <p className="flex items-start gap-2.5 rounded-lg border border-warn/30 bg-warn/5 p-3 text-xs leading-relaxed text-muted">
          <Icon name="warning" size={14} className="mt-0.5 shrink-0 text-warn" />
          <span>
            O que você selecionar sai do cofre <strong className="text-ink">em texto puro</strong>: quem recebe — e os
            backups do app de mensagens — passa a tê-lo. A chave 2FA nunca é incluída.
          </span>
        </p>

        {fields.length > 0 ? (
          <div className="space-y-1">
            {fields.map((field, index) => (
              <label
                key={`${field.label}:${index}`}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 transition hover:bg-raised"
              >
                <input
                  type="checkbox"
                  checked={checked[index] ?? false}
                  onChange={(event) =>
                    setChecked((current) => current.map((value, i) => (i === index ? event.target.checked : value)))
                  }
                  className="h-4 w-4 accent-[var(--color-accent)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">{field.label}</span>
                  <span className="block truncate text-xs text-muted">
                    {field.secret && !(checked[index] ?? false) ? '••••••••' : field.value}
                  </span>
                </span>
                {field.secret ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-warn/12 px-1.5 py-0.5 text-[11px] font-medium text-warn">
                    <Icon name="lock" size={10} /> segredo
                  </span>
                ) : null}
              </label>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">Este item não tem campos preenchidos para compartilhar.</p>
        )}

        {item.attachments.length > 0 ? (
          <div className="space-y-2 border-t border-line-soft pt-3">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">Anexos</p>
            {fileSharing ? (
              item.attachments.map((ref) => (
                <div key={ref.id} className="flex items-center gap-3 rounded-lg border border-line-soft px-3 py-2">
                  <Icon name="file" size={15} className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{ref.name}</span>
                  <Button size="sm" icon="share" onClick={() => void sendAttachment(ref)}>
                    Enviar arquivo
                  </Button>
                </div>
              ))
            ) : (
              <p className="text-xs text-faint">
                Este navegador não compartilha arquivos; no celular, os anexos saem pela folha de compartilhamento.
              </p>
            )}
          </div>
        ) : null}

        {error ? <p className="text-xs text-danger">{error}</p> : null}
      </div>
    </Modal>
  );
}
