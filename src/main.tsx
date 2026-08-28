import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// Clickjacking guard: a vault must never render inside someone else's frame.
if (window.top !== window.self) {
  document.body.textContent =
    'O eQuantic Keeper não pode ser aberto dentro de um iframe. Acesse o app diretamente.';
  throw new Error('Framed context blocked.');
}

const container = document.getElementById('root');
if (!container) throw new Error('Elemento #root não encontrado.');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
