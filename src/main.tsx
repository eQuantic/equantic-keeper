import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { completeMicrosoftAuthCallback } from './lib/ms-auth';
import './index.css';

// Clickjacking guard: a vault must never render inside someone else's frame.
if (window.top !== window.self) {
  document.body.textContent =
    'O eQuantic Keeper não pode ser aberto dentro de um iframe. Acesse o app diretamente.';
  throw new Error('Framed context blocked.');
}

function start(): void {
  /*
   * A worker that takes over mid-session leaves this page running code from the
   * build before it — and the old chunks it might still lazily load are gone from
   * the server, because a deploy replaces them. So the page reloads once, when
   * control changes hands.
   *
   * Only when there WAS a controller: on a first visit the worker claims the page
   * for the first time, and reloading then would be a pointless flash.
   */
  if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return;
      reloading = true;
      window.location.reload();
    });
  }

  const container = document.getElementById('root');
  if (!container) throw new Error('Elemento #root não encontrado.');

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

/*
 * Microsoft sends the popup back to this same address, which boots the whole app
 * inside a window that is about to close. When that is what happened, the code
 * goes to the opener and nothing else here is worth doing — least of all
 * mounting a second copy of the vault for a fraction of a second.
 */
if (!completeMicrosoftAuthCallback()) start();
