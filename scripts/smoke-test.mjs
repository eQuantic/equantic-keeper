/**
 * Smoke test: drives the built app in a real browser.
 *
 * The vault fixture is built with an *independent* implementation of the format
 * documented in the README (PBKDF2 -> HKDF -> AES-GCM), so a passing unlock also
 * proves the on-disk format is specified precisely enough to interoperate.
 *
 * Usage:
 *   npm run build
 *   npx playwright install chromium   # once, downloads the browser
 *   npm run smoke                     # spawns `vite preview` and drives it
 *
 * Env: KEEPER_SMOKE_PORT (default 4173), KEEPER_SMOKE_OUT (screenshot dir),
 *      CHROMIUM_PATH (explicit browser binary).
 */
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const PORT = Number(process.env.KEEPER_SMOKE_PORT ?? 4173);
const BASE = `http://localhost:${PORT}/`;
const OUT = process.env.KEEPER_SMOKE_OUT ?? mkdtempSync(join(tmpdir(), 'keeper-smoke-'));
const PASSWORD = 'frase-mestra-de-teste-123';

const hostIsOpen = (port, host) =>
  new Promise((resolve) => {
    const socket = connect({ port, host });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(1000);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });

/**
 * Resolves true as soon as something accepts a TCP connection on `port`.
 * Depending on the platform's name resolution, `vite preview` may bind
 * "localhost" to ::1 only, so both loopbacks are probed.
 */
const portIsOpen = async (port) => (await hostIsOpen(port, '127.0.0.1')) || hostIsOpen(port, '::1');

/** Starts `vite preview` and resolves once it is listening. */
async function startPreview() {
  const child = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await portIsOpen(PORT)) return child;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill();
  throw new Error(`servidor de preview não subiu em ${BASE}`);
}



const buildVaultInPage = async (page, password, payload) =>
  page.evaluate(
    async ([pass, data]) => {
      const enc = new TextEncoder();
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const iterations = 210000;
      const b64 = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)));

      const passwordKey = await crypto.subtle.importKey(
        'raw',
        enc.encode(pass.normalize('NFKC')),
        'PBKDF2',
        false,
        ['deriveBits'],
      );
      const masterBits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
        passwordKey,
        256,
      );
      const hkdfKey = await crypto.subtle.importKey('raw', masterBits, 'HKDF', false, [
        'deriveBits',
        'deriveKey',
      ]);
      const key = await crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('equantic-keeper:enc:v1') },
        hkdfKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
      const verifierBits = await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('equantic-keeper:verify:v1') },
        hkdfKey,
        128,
      );

      const header = {
        format: 'equantic-keeper.vault',
        version: 1,
        cipher: 'AES-GCM-256',
        kdf: { algo: 'PBKDF2-SHA256', iterations, salt: b64(salt) },
      };
      const aad = [
        header.format,
        header.version,
        header.cipher,
        header.kdf.algo,
        header.kdf.iterations,
        header.kdf.salt,
      ].join('|');
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: enc.encode(aad), tagLength: 128 },
        key,
        enc.encode(JSON.stringify(data)),
      );

      const file = {
        ...header,
        verifier: b64(verifierBits),
        iv: b64(iv),
        data: b64(ciphertext),
        updatedAt: new Date().toISOString(),
      };
      localStorage.setItem(
        'keeper.vault.cache.v1',
        JSON.stringify({ file, cachedAt: new Date().toISOString() }),
      );
      return file.data.length;
    },
    [password, payload],
  );

const now = new Date().toISOString();
/**
 * Dates as the app stores them, relative to today in *local* time. The app
 * counts validity against the local end of day, so deriving these from UTC
 * (toISOString) put the fixture one day off within an hour of midnight.
 */
const relativeDay = (offset) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
const item = (over) => ({
  id: crypto.randomUUID(),
  type: 'api-token',
  name: '',
  description: '',
  folder: '',
  tags: [],
  fields: {},
  customFields: [],
  favorite: false,
  createdAt: now,
  updatedAt: now,
  ...over,
});

const PAYLOAD = {
  preferences: { autoLockMinutes: 15, clipboardClearSeconds: 30, theme: 'dark', concealSecrets: true },
  items: [
    item({
      name: 'GitHub PAT — CI eQuantic',
      type: 'api-token',
      folder: 'Infra',
      tags: ['ci', 'github'],
      favorite: true,
      description: 'Usado pelo workflow de deploy',
      fields: {
        service: 'GitHub',
        token: 'ghp_ExampleTokenValue1234567890abcd',
        username: 'edgar',
        scopes: 'repo, write:packages',
        expiresAt: '2026-12-31',
      },
    }),
    item({
      name: 'Azure Container Registry',
      type: 'registry',
      folder: 'Infra',
      tags: ['azure', 'docker'],
      fields: {
        registry: 'equantic.azurecr.io',
        username: 'equantic-push',
        password: 'AcRt0k3n-Example-Value',
        namespace: 'equantic/api',
        loginCommand: 'docker login equantic.azurecr.io -u equantic-push',
      },
    }),
    item({
      name: 'Painel DigitalOcean',
      type: 'login',
      tags: ['cloud'],
      fields: {
        url: 'https://cloud.digitalocean.com',
        username: 'edgar@equantic.tech',
        password: 'senha-exemplo-do-painel',
        totp: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
      },
    }),
    item({
      name: 'Deploy server (prod-01)',
      type: 'ssh',
      folder: 'Servidores',
      tags: ['ssh'],
      fields: {
        host: '10.0.0.12',
        port: '22',
        username: 'deploy',
        privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nEXEMPLO\n-----END OPENSSH PRIVATE KEY-----',
        publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExemplo deploy@prod-01',
      },
    }),
    item({
      name: 'Passaporte — vencido',
      type: 'passaporte',
      folder: 'Documentos',
      fields: { documentNumber: 'CX123456', expiresAt: relativeDay(-40) },
    }),
    item({
      name: 'Cartão de Cidadão — a renovar',
      type: 'pt-cartao-cidadao',
      folder: 'Documentos',
      fields: { documentNumber: '12345678 9 ZZ1', expiresAt: relativeDay(25) },
    }),
    item({
      name: 'API do checkout (.env produção)',
      type: 'env',
      folder: 'Produtos',
      tags: ['env'],
      fields: {
        project: 'checkout-api',
        environment: 'production',
        content: 'DATABASE_URL=postgres://user:pass@db:5432/checkout\nSTRIPE_KEY=sk_live_exemplo',
      },
    }),
  ],
};

/**
 * A minimal but structurally valid one-page PDF, built with real cross-reference
 * offsets. Feeding pdf.js a fake would prove nothing about the viewer.
 */
function tinyPdf(text) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 200] /Contents 4 0 R ' +
      '/Resources << /Font << /F1 5 0 R >> >> >>',
    null, // the content stream, built below
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = `BT /F1 16 Tf 24 120 Td (${text}) Tj ET`;
  objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

const PDF_MARKER = 'TITULO DE RESIDENCIA 2024';

const errors = [];

let failures = 0;
/** Kept module-level so a crash can still photograph what the page looked like. */
let currentPage = null;

const run = async () => {
  const preview = await startPreview();
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  );
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  currentPage = page;
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

  const check = async (label, assertion) => {
    const ok = await assertion();
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) {
      failures += 1;
      process.exitCode = 1;
    }
  };

  // 1. First run: OAuth client id is required.
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Configurar acesso ao Google', { timeout: 10000 });
  await check('tela de configuração aparece sem client id', async () => true);

  await page.fill('input[placeholder*="apps.googleusercontent.com"]', '1234567890-teste.apps.googleusercontent.com');
  await page.click('button:has-text("Salvar e continuar")');
  await page.waitForSelector('text=Entrar com o Google', { timeout: 10000 });
  await check('tela de login aparece após salvar o client id', async () => true);

  // 2. Seed an encrypted vault written by an independent implementation.
  const size = await buildVaultInPage(page, PASSWORD, PAYLOAD);
  console.log(`      (cofre de teste: ${size} bytes de ciphertext base64)`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Desbloquear cofre', { timeout: 10000 });
  await page.screenshot({ path: `${OUT}/01-unlock.png` });

  // 3. The reveal toggle lets the user check what they typed.
  const master = page.locator('input[autocomplete="current-password"]');
  await master.fill('conferindo-o-que-digitei');
  await check('senha mestra começa oculta', async () => (await master.getAttribute('type')) === 'password');
  await page.locator('button[aria-label="Mostrar senha"]').click();
  await check('o olho revela a senha digitada', async () => {
    const type = await master.getAttribute('type');
    return type === 'text' && (await master.inputValue()) === 'conferindo-o-que-digitei';
  });
  await page.locator('button[aria-label="Ocultar senha"]').click();
  await check('clicar de novo volta a ocultar', async () => (await master.getAttribute('type')) === 'password');

  // 4. Wrong password must be rejected.
  await page.fill('input[type="password"]', 'senha-errada');
  await page.click('button:has-text("Desbloquear")');
  await page.waitForSelector('text=Senha mestra incorreta', { timeout: 15000 });
  await check('senha incorreta é rejeitada', async () => true);

  // 5. Correct password unlocks and lists the items.
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button:has-text("Desbloquear")');
  await page.waitForSelector('text=GitHub PAT', { timeout: 20000 });
  await check('cofre abre e lista os itens', async () => (await page.locator('main li').count()) === 7);
  await page.screenshot({ path: `${OUT}/02-vault.png` });

  // 6. Search filters the list.
  await page.fill('input[type="search"]', 'azure');
  await page.waitForTimeout(300);
  await check('busca filtra a lista', async () => (await page.locator('main li').count()) === 1);
  await page.fill('input[type="search"]', '');

  // 7. Detail pane reveals a secret only on demand.
  await page.click('text=Painel DigitalOcean');
  await page.waitForSelector('text=Chave 2FA', { timeout: 5000 });
  await check('segredo começa oculto', async () => (await page.locator('text=senha-exemplo-do-painel').count()) === 0);
  await page.locator('button[aria-label="Revelar"]').first().click();
  await check('revelar exibe o valor', async () => (await page.locator('text=senha-exemplo-do-painel').count()) > 0);

  const totp = await page.locator('.font-mono.text-lg').first().textContent();
  await check('código TOTP é gerado', async () => /^\d{3} \d{3}$/.test((totp ?? '').trim()));
  await page.screenshot({ path: `${OUT}/03-detail.png` });

  // 8. Create an item through the UI and confirm it is persisted encrypted.
  await page.click('button:has-text("Novo")');
  await page.waitForSelector('text=Escolha o tipo');
  await page.click('button:has-text("Banco de dados")');
  await page.fill('input[placeholder="GitHub PAT — CI eQuantic"]', 'Postgres — staging');
  await page.locator('label:has-text("Host") input').first().fill('db.staging.internal');
  await page.click('footer button:has-text("Salvar")');
  await page.waitForSelector('h2:has-text("Postgres — staging")', { timeout: 5000 });
  await check('novo item criado pela UI', async () => (await page.locator('main li').count()) === 8);

  const cached = await page.evaluate(() => localStorage.getItem('keeper.vault.cache.v1') ?? '');
  await check('cache local não contém texto puro', async () => !cached.includes('db.staging.internal'));
  await check('cache local é um cofre cifrado', async () => cached.includes('equantic-keeper.vault'));

  // 8b. Documents: a residence permit filed under a brand-new holder. The
  // seeded vault is a v1 file with neither `people` nor `holderId`, so this
  // also proves the migration works in a real browser.
  await page.click('button:has-text("Novo")');
  await page.waitForSelector('text=Escolha o tipo');
  await page.fill('input[placeholder*="Filtrar tipos"]', 'residência');
  await page.waitForTimeout(200);
  await check('filtro do seletor de tipos reduz a lista', async () => {
    const labels = await page.locator('[role="dialog"] section button span.font-medium').allTextContents();
    return labels.length > 0 && labels.every((label) => /resid/i.test(label));
  });
  await page.screenshot({ path: `${OUT}/06-tipos-documento.png` });

  await page.click('button:has-text("Título de residência")');
  await page.fill('input[placeholder="GitHub PAT — CI eQuantic"]', 'Título de residência — Maria');
  await page.click('button:has-text("nova pessoa")');
  await page.fill('input[placeholder="Nome da pessoa"]', 'Maria Teste');
  // Exact match: the same dialog also offers "Adicionar campo personalizado".
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await check('titular criado sem sair do formulário', async () => {
    // The holder picker is the editor's only <select>.
    const select = page.locator('[role="dialog"] select');
    const value = await select.inputValue();
    return value !== '' && (await select.locator(`option[value="${value}"]`).textContent())?.includes('Maria Teste');
  });
  await page.locator('label:has-text("Número do título") input').first().fill('RP-2024-99887');
  await page.locator('label:has-text("Válido até") input').first().fill('2027-03-10');
  await page.click('footer button:has-text("Salvar")');
  await page.waitForSelector('h2:has-text("Título de residência — Maria")', { timeout: 5000 });
  await check('documento salvo com os campos do tipo', async () =>
    (await page.locator('aside:has(h2) >> text=RP-2024-99887').count()) > 0);
  await check('detalhe mostra o titular', async () =>
    (await page.locator('aside:has(h2) >> text=Maria Teste').count()) > 0);
  await page.screenshot({ path: `${OUT}/07-documento.png` });

  // 8c. The holder becomes a filter of its own, next to the type filters.
  await check('barra lateral separa documentos de desenvolvimento', async () =>
    (await page.locator('nav button:has-text("Documentos")').count()) > 0 &&
    (await page.locator('nav button:has-text("Desenvolvimento")').count()) > 0);
  await page.click('nav button:has-text("Maria Teste")');
  await page.waitForTimeout(300);
  await check('filtrar por titular mostra só os itens dela', async () =>
    (await page.locator('main li').count()) === 1);
  await page.click('nav button:has-text("Tudo")');
  await page.waitForTimeout(300);
  await check('voltar para “Tudo” restaura a lista', async () => (await page.locator('main li').count()) === 9);

  // 8d. Searching by the holder's name finds a document that never stores it.
  await page.fill('input[type="search"]', 'maria teste');
  await page.waitForTimeout(300);
  await check('busca pelo nome do titular encontra o documento', async () =>
    (await page.locator('main li').count()) === 1);
  await page.fill('input[type="search"]', '');

  // 8e. Attachments: encrypt, store, and read the file back in the app.
  await page.click('aside:has(h2) button:has-text("Editar")');
  await page.waitForSelector('[role="dialog"] >> text=Anexos', { timeout: 5000 });
  await page
    .locator('input[aria-label="Escolher arquivos para anexar"]')
    .setInputFiles({ name: 'residencia-2024.pdf', mimeType: 'application/pdf', buffer: tinyPdf(PDF_MARKER) });
  await page.waitForSelector('[role="dialog"] >> text=residencia-2024.pdf', { timeout: 10000 });
  await check('anexo aparece na lista do editor', async () => true);
  await page.click('footer button:has-text("Salvar")');

  await page.waitForSelector('aside:has(h2) >> text=residencia-2024.pdf', { timeout: 5000 });
  await check('anexo fica no item depois de salvar', async () => true);
  await page.screenshot({ path: `${OUT}/09-anexo-no-item.png` });

  // The ciphertext is what leaves the app; the plaintext must not be findable.
  await check('nada do conteúdo do PDF aparece no armazenamento local', async () => {
    const found = await page.evaluate(async (marker) => {
      const local = JSON.stringify(localStorage);
      if (local.includes(marker)) return 'localStorage';
      const db = await new Promise((resolve) => {
        const request = indexedDB.open('keeper-attachments');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      });
      if (!db) return 'sem indexeddb';
      const blobs = await new Promise((resolve) => {
        const request = db.transaction('ciphertext').objectStore('ciphertext').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve([]);
      });
      if (blobs.length === 0) return 'cache vazio';
      const decoder = new TextDecoder();
      for (const buffer of blobs) if (decoder.decode(buffer).includes(marker)) return 'indexeddb';
      return 'ok';
    }, PDF_MARKER);
    if (found !== 'ok') console.log(`      (achado inesperado: ${found})`);
    return found === 'ok';
  });

  // 8f. The viewer renders the PDF in the app, with selectable text.
  await page.click('aside:has(h2) button:has-text("residencia-2024.pdf")');
  await page.waitForSelector('[role="dialog"] canvas', { timeout: 30000 });
  await check('visualizador desenha a página do PDF', async () => {
    const box = await page.locator('[role="dialog"] canvas').first().boundingBox();
    return !!box && box.width > 50 && box.height > 50;
  });
  await check('camada de texto permite seleção e cópia', async () => {
    const text = await page.locator('[role="dialog"] .keeper-text-layer').first().innerText();
    return text.includes('TITULO DE RESIDENCIA');
  });
  await page.screenshot({ path: `${OUT}/10-visualizador.png` });

  await page.click('[role="dialog"] button[aria-label="Aumentar zoom"]');
  await page.waitForTimeout(600);
  await check('zoom altera a escala da página', async () =>
    (await page.locator('[role="dialog"] button[title="Zoom original"]').innerText()).trim() === '125%');

  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"] canvas', { state: 'detached', timeout: 5000 });
  await check('Esc fecha o visualizador', async () => true);

  await check('nenhum blob: sobrou registrado após fechar', async () =>
    (await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => e.name.startsWith('blob:')).length)) === 0);

  // 8g. Validity: what is expired, what is about to be, and what is neither.
  await check('barra lateral separa vencidos de quem vence em breve', async () =>
    (await page.locator('nav button:has-text("Vencidos")').count()) === 1 &&
    (await page.locator('nav button:has-text("Vencem em breve")').count()) === 1);

  await page.click('nav button:has-text("Vencidos")');
  await page.waitForTimeout(300);
  await check('vencidos traz só o passaporte fora do prazo', async () => {
    const rows = await page.locator('main li').allInnerTexts();
    return rows.length === 1 && rows[0].includes('Passaporte — vencido');
  });
  await check('a linha diz há quanto tempo venceu', async () =>
    (await page.locator('main li').first().innerText()).includes('expirou há 40 dias'));

  await page.click('nav button:has-text("Vencem em breve")');
  await page.waitForTimeout(300);
  await check('vence em breve traz só o cartão a renovar', async () => {
    const rows = await page.locator('main li').allInnerTexts();
    return rows.length === 1 && rows[0].includes('expira em 25 dias');
  });
  await page.screenshot({ path: `${OUT}/11-validade.png` });

  // A date that is merely an issue date must never be dressed up as an expiry.
  await page.click('nav button:has-text("Tudo")');
  await page.waitForTimeout(300);
  await page.click('text=Título de residência — Maria');
  await page.waitForSelector('aside:has(h2) >> text=RP-2024-99887', { timeout: 5000 });
  await check('data de emissão não é tratada como validade', async () => {
    const detail = await page.locator('aside:has(h2)').innerText();
    return detail.includes('EMITIDO EM') ? !/EMITIDO EM[\s\S]{0,40}expir/i.test(detail) : true;
  });

  // 8h. Backup bundle: export vault + attachments, then restore from it.
  await page.locator('nav button:has-text("Configurações")').click();
  await page.waitForSelector('[role="dialog"] >> text=Backup e portabilidade', { timeout: 5000 });

  // Arm the listener before the click: the download can start immediately.
  const downloading = page.waitForEvent('download', { timeout: 30000 });
  await page.click('[role="dialog"] button:has-text("Exportar cofre + anexos")');
  const download = await downloading;

  const bundlePath = `${OUT}/backup.keeper.zip`;
  await download.saveAs(bundlePath);
  const archive = readFileSync(bundlePath);

  await check('pacote exportado é um ZIP de verdade', async () => archive.subarray(0, 4).toString('hex') === '504b0304');
  await check('pacote contém o cofre e o anexo', async () => {
    const names = archive.toString('latin1');
    return names.includes('vault.keeper.json') && names.includes('attachments/attachment-');
  });
  await check('pacote não contém o conteúdo do PDF em claro', async () =>
    !archive.toString('latin1').includes(PDF_MARKER));

  // Restore it back into the same vault: no new items, but the attachment
  // ciphertext is put back on the device.
  await page.setInputFiles('[role="dialog"] input[type="file"]', bundlePath);
  await page.waitForSelector('[role="dialog"] >> text=Senha mestra do backup', { timeout: 5000 });
  await page.fill('[role="dialog"] label:has-text("Senha mestra do backup") input', PASSWORD);
  // Exact match: "Importar backup" (the file picker) comes first in the DOM.
  await page.getByRole('button', { name: 'Importar', exact: true }).click();
  await check('importar o pacote restaura o anexo', async () => {
    await page.getByText(/anexo\(s\) restaurado/).waitFor({ timeout: 30000 });
    return true;
  });
  await page.screenshot({ path: `${OUT}/12-backup-pacote.png` });
  await page.keyboard.press('Escape');

  // 9. Generator produces a value.
  await page.click('button[aria-label="Gerador"]');
  await page.waitForSelector('text=Entropia estimada');
  await page.screenshot({ path: `${OUT}/04-generator.png` });
  await page.locator('[role="dialog"] button[aria-label="Fechar"]').click();

  // 10. Light theme.
  await page.locator('nav button:has-text("Configurações")').click();
  await page.waitForSelector('[role="dialog"] >> text=Backup e portabilidade', { timeout: 5000 });

  // 10b. The holder added from the editor is managed here, and edits stick.
  const holderName = page.locator('[role="dialog"] input[aria-label="Nome do titular"]');
  await check('configurações listam o titular', async () => {
    return (await holderName.count()) === 1 && (await holderName.inputValue()) === 'Maria Teste';
  });
  await check('mostra quantos itens são daquela pessoa', async () =>
    (await page.locator('[role="dialog"] >> text=1 item').count()) > 0);
  await page.locator('[role="dialog"] input[aria-label="Parentesco"]').fill('esposa');
  await holderName.click(); // blur commits the edit
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.locator('nav button:has-text("Configurações")').click();
  await page.waitForSelector('[role="dialog"] >> text=Backup e portabilidade', { timeout: 5000 });
  await check('o parentesco editado sobrevive ao fechar e reabrir', async () =>
    (await page.locator('[role="dialog"] input[aria-label="Parentesco"]').inputValue()) === 'esposa');
  await page.screenshot({ path: `${OUT}/08-pessoas.png` });

  await page.selectOption('select[aria-label="Tema"]', 'light');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/05-settings-light.png` });

  // 11. Lock clears the decrypted state.
  await check('tema claro aplicado', async () =>
    (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light');
  await page.selectOption('select[aria-label="Tema"]', 'dark');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+l');
  await page.waitForSelector('text=Desbloquear cofre', { timeout: 5000 });
  await check('bloqueio volta para a tela de senha', async () => true);

  // 12. Mobile: the same vault on a phone-sized, touch-first viewport. A fresh
  // page (fresh context) so the flow is seeded from scratch at 375px.
  const phone = await browser.newPage({
    viewport: { width: 375, height: 812 },
    hasTouch: true,
    isMobile: true,
  });
  currentPage = phone;
  phone.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  phone.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

  await phone.goto(BASE, { waitUntil: 'domcontentloaded' });
  await phone.waitForSelector('text=Configurar acesso ao Google', { timeout: 10000 });
  await phone.fill('input[placeholder*="apps.googleusercontent.com"]', '1234567890-teste.apps.googleusercontent.com');
  await phone.click('button:has-text("Salvar e continuar")');
  await buildVaultInPage(phone, PASSWORD, PAYLOAD);
  await phone.reload({ waitUntil: 'domcontentloaded' });
  await phone.waitForSelector('text=Desbloquear cofre', { timeout: 10000 });

  // iOS Safari zooms the page when a focused control is under 16px, and the
  // zoom outlives the focus. The floor only applies to touch-first devices.
  await check('inputs têm 16px em viewport de toque', async () =>
    (await phone.locator('input[type="password"]').evaluate((el) => getComputedStyle(el).fontSize)) === '16px');

  await phone.fill('input[type="password"]', PASSWORD);
  await phone.click('button:has-text("Desbloquear")');
  await phone.waitForSelector('text=GitHub PAT', { timeout: 20000 });

  // Expiry must not be desktop garnish: the row badge survives 375px…
  await check('badge de validade aparece na linha também no celular', async () =>
    (await phone.locator('main li:has-text("expira em 25 dias")').count()) === 1);

  // …and the sidebar's expired/soon filters surface as chips above the list,
  // because on a phone the sidebar hides behind the menu button.
  await check('chips de validade aparecem acima da lista', async () =>
    (await phone.locator('main button:has-text("1 vencido")').count()) === 1 &&
    (await phone.locator('main button:has-text("1 vence em breve")').count()) === 1);
  await phone.screenshot({ path: `${OUT}/13-mobile-lista.png` });

  await phone.click('main button:has-text("1 vence em breve")');
  await phone.waitForTimeout(300);
  await check('chip filtra a lista', async () => {
    const rows = await phone.locator('main li').allInnerTexts();
    return rows.length === 1 && rows[0].includes('Cartão de Cidadão — a renovar');
  });
  await phone.click('main button:has-text("1 vence em breve")');
  await phone.waitForTimeout(300);
  await check('tocar de novo desfaz o filtro', async () => (await phone.locator('main li').count()) === 7);

  // 32px icon buttons grow an invisible ~44px hit area on coarse pointers.
  await check('botões de ícone ganham área de toque no celular', async () =>
    (await phone.locator('button[aria-label="Gerador"]').evaluate((el) => {
      const after = getComputedStyle(el, '::after');
      return after.position === 'absolute' && after.top === '-6px';
    })));

  // Digits-only document fields ask the phone for the numeric keypad.
  await phone.click('main li:has-text("Cartão de Cidadão — a renovar")');
  await phone.waitForSelector('aside footer button:has-text("Editar")', { timeout: 5000 });
  await phone.click('aside footer button:has-text("Editar")');
  await phone.waitForSelector('[role="dialog"] >> text=Campos de Cartão de Cidadão', { timeout: 5000 });
  await check('campos numéricos pedem o teclado numérico', async () =>
    (await phone.locator('[role="dialog"] input[inputmode="numeric"]').count()) >= 3);
  await phone.screenshot({ path: `${OUT}/14-mobile-editor.png` });
  await phone.keyboard.press('Escape');
  await phone.waitForTimeout(300);

  // 13. On touch devices the system back gesture peels overlays one at a time
  // instead of leaving the app.
  await phone.goBack(); // the item detail is the topmost overlay
  await phone.waitForTimeout(300);
  await check('voltar fecha o detalhe em vez de sair do app', async () =>
    (await phone.locator('aside footer').count()) === 0 &&
    (await phone.locator('text=GitHub PAT').count()) > 0);

  // The desktop sidebar stays in the DOM (display: none), so the drawer copy
  // of each nav button must be matched by visibility.
  const drawerNav = phone.locator('nav button:has-text("Tudo")').filter({ visible: true });
  await phone.click('button[aria-label="Menu"]');
  await phone.waitForSelector('nav button:has-text("Tudo") >> visible=true', { timeout: 3000 });
  await phone.goBack();
  await phone.waitForTimeout(300);
  await check('voltar fecha a gaveta lateral', async () => (await drawerNav.count()) === 0);

  await phone.click('main li:has-text("Cartão de Cidadão — a renovar")');
  await phone.waitForSelector('aside footer button:has-text("Editar")', { timeout: 5000 });
  await phone.click('aside footer button:has-text("Editar")');
  await phone.waitForSelector('[role="dialog"]', { timeout: 5000 });
  await phone.goBack();
  await phone.waitForTimeout(300);
  await check('voltar fecha o editor e mantém o detalhe', async () =>
    (await phone.locator('[role="dialog"]').count()) === 0 &&
    (await phone.locator('aside footer button:has-text("Editar")').count()) === 1);
  await phone.goBack();
  await phone.waitForTimeout(300);
  await check('o segundo voltar fecha o detalhe', async () =>
    (await phone.locator('aside footer').count()) === 0 &&
    (await phone.locator('text=GitHub PAT').count()) > 0);

  // 14. Biometric unlock, driven by a virtual platform authenticator with PRF.
  // Older Chromium builds do not know the hasPrf option; skip gracefully there.
  let virtualAuthenticator = false;
  try {
    const cdp = await phone.context().newCDPSession(phone);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        hasPrf: true,
        automaticPresenceSimulation: true,
      },
    });
    virtualAuthenticator = true;
  } catch (error) {
    console.log(`      (sem autenticador virtual com PRF: ${error.message} — biometria pulada)`);
  }

  if (virtualAuthenticator) {
    // The availability probe runs at boot, before the authenticator existed.
    await phone.reload({ waitUntil: 'domcontentloaded' });
    await phone.waitForSelector('text=Desbloquear cofre', { timeout: 10000 });
    await phone.fill('input[type="password"]', PASSWORD);
    await phone.click('button:has-text("Desbloquear")');
    await phone.waitForSelector('text=GitHub PAT', { timeout: 20000 });

    await phone.click('button[aria-label="Menu"]');
    const settingsEntry = phone.locator('nav button:has-text("Configurações")').filter({ visible: true });
    await settingsEntry.click();
    await phone.waitForSelector('[role="dialog"] >> text=Segurança', { timeout: 5000 });
    await phone.click('[role="dialog"] button:has-text("Ativar desbloqueio por biometria")');
    await phone.locator('[role="dialog"] label:has-text("Senha mestra") input').first().fill(PASSWORD);
    await phone.getByRole('button', { name: 'Ativar', exact: true }).click();
    await check('biometria ativada pelas configurações', async () => {
      await phone.getByText('Desbloqueio por biometria ativado neste dispositivo.').waitFor({ timeout: 15000 });
      return true;
    });
    await phone.keyboard.press('Escape');

    await phone.keyboard.press('Control+l');
    await phone.waitForSelector('text=Desbloquear cofre', { timeout: 5000 });
    await check('tela de desbloqueio oferece biometria', async () =>
      (await phone.locator('button:has-text("Desbloquear com biometria")').count()) === 1);
    await phone.screenshot({ path: `${OUT}/15-mobile-biometria.png` });

    await phone.click('button:has-text("Desbloquear com biometria")');
    await phone.waitForSelector('text=GitHub PAT', { timeout: 20000 });
    await check('biometria desbloqueia sem digitar a senha', async () => true);
  }

  await phone.close();
  currentPage = page;

  const ignorable = /gsi\/client|accounts\.google|net::ERR|Failed to load resource|ERR_NAME_NOT_RESOLVED/i;
  const real = errors.filter((message) => !ignorable.test(message));
  await check(`sem erros de console (${real.length})`, async () => real.length === 0);
  if (real.length) console.log(real.slice(0, 10));

  await browser.close();
  preview.kill();
  console.log(`\n${failures === 0 ? 'Tudo verde' : `${failures} verificação(ões) falharam`} · capturas em ${OUT}`);
};

run().catch(async (error) => {
  console.error('EXCEÇÃO:', error.message);
  if (currentPage) {
    await currentPage.screenshot({ path: `${OUT}/erro.png` }).catch(() => {});
    console.error(`estado da página em ${OUT}/erro.png`);
  }
  process.exit(1);
});
