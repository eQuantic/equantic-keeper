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
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const PORT = Number(process.env.KEEPER_SMOKE_PORT ?? 4173);
const BASE = `http://localhost:${PORT}/`;
const OUT = process.env.KEEPER_SMOKE_OUT ?? mkdtempSync(join(tmpdir(), 'keeper-smoke-'));
const PASSWORD = 'frase-mestra-de-teste-123';

/** Resolves true as soon as something accepts a TCP connection on `port`. */
const portIsOpen = (port) =>
  new Promise((resolve) => {
    const socket = connect({ port, host: '127.0.0.1' });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(1000);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });

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

const errors = [];

let failures = 0;

const run = async () => {
  const preview = await startPreview();
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  );
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
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
  await check('cofre abre e lista os itens', async () => (await page.locator('main li').count()) === 5);
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
  await check('novo item criado pela UI', async () => (await page.locator('main li').count()) === 6);

  const cached = await page.evaluate(() => localStorage.getItem('keeper.vault.cache.v1') ?? '');
  await check('cache local não contém texto puro', async () => !cached.includes('db.staging.internal'));
  await check('cache local é um cofre cifrado', async () => cached.includes('equantic-keeper.vault'));

  // 9. Generator produces a value.
  await page.click('button[aria-label="Gerador"]');
  await page.waitForSelector('text=Entropia estimada');
  await page.screenshot({ path: `${OUT}/04-generator.png` });
  await page.locator('[role="dialog"] button[aria-label="Fechar"]').click();

  // 10. Light theme.
  await page.locator('nav button:has-text("Configurações")').click();
  await page.waitForSelector('[role="dialog"] >> text=Backup e portabilidade', { timeout: 5000 });
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

  const ignorable = /gsi\/client|accounts\.google|net::ERR|Failed to load resource|ERR_NAME_NOT_RESOLVED/i;
  const real = errors.filter((message) => !ignorable.test(message));
  await check(`sem erros de console (${real.length})`, async () => real.length === 0);
  if (real.length) console.log(real.slice(0, 10));

  await browser.close();
  preview.kill();
  console.log(`\n${failures === 0 ? 'Tudo verde' : `${failures} verificação(ões) falharam`} · capturas em ${OUT}`);
};

run().catch((error) => {
  console.error('EXCEÇÃO:', error.message);
  process.exit(1);
});
