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
/**
 * Opens Configurações on one of its panes.
 *
 * The dialog is a sidebar of panes now: a section exists in the DOM only while
 * its own pane is the active one, so every visit has to say which it wants.
 */
async function openSettings(page, pane) {
  // Already open? Just switch panes. Clicking the sidebar entry behind the
  // overlay would hang until the timeout, which is a confusing way to learn
  // that the previous step forgot to close the dialog.
  if ((await page.locator('[data-settings-nav]').count()) === 0) {
    await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 5000 }).catch(() => undefined);
    await page.locator('nav button:has-text("Configurações")').filter({ visible: true }).first().click();
    await page.waitForSelector('[data-settings-nav]', { timeout: 5000 });
  }
  await page.locator(`[data-settings-nav] button:has-text("${pane}")`).click();
  // The pane and its entry in the list have to agree: a highlight left on the
  // previous entry is how a settings dialog starts lying about where you are.
  await page.waitForSelector(`[data-settings-nav] button[aria-current="page"]:has-text("${pane}")`, {
    timeout: 5000,
  });
}

/**
 * The app has no native selects any more: every one is the design-system menu,
 * so choosing an option is open, click, and wait for the menu to go.
 */
async function chooseOption(page, label, value) {
  await page.locator(`[data-select-trigger="${label}"]`).first().click();
  const menu = page.locator('[role="listbox"]').last();
  await menu.waitFor({ state: 'visible', timeout: 5000 });
  await menu.locator(`[data-option-value="${value}"]`).first().click();
  await page.waitForSelector('[role="listbox"]', { state: 'detached', timeout: 5000 });
}

/** What the trigger currently holds, by value. */
async function selectedValue(page, label) {
  return page.locator(`[data-select-trigger="${label}"]`).first().getAttribute('data-select-value');
}

/** Every option's visible text, with the menu opened and closed again. */
async function optionLabels(page, label) {
  await page.locator(`[data-select-trigger="${label}"]`).first().click();
  const menu = page.locator('[role="listbox"]').last();
  await menu.waitFor({ state: 'visible', timeout: 5000 });
  const labels = await menu.locator('[role="option"]').allInnerTexts();
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="listbox"]', { state: 'detached', timeout: 5000 });
  return labels;
}

/** Kept module-level so a crash can still photograph what the page looked like. */
let currentPage = null;

const run = async () => {
  const preview = await startPreview();
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  );
  /*
   * `reducedMotion` is not cosmetic here: Playwright clicks milliseconds after
   * a dialog opens, and a click that lands while the panel is still sliding is
   * swallowed. The app already collapses every animation under
   * prefers-reduced-motion, so this uses its own accessibility path rather than
   * injecting a stylesheet the real app never sees. Three intermittent failures
   * in one afternoon, all photographed mid-animation, bought this line.
   */
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
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
  await check('barra inferior não aparece no desktop', async () =>
    (await page.locator('nav[aria-label="Ações rápidas"]').filter({ visible: true }).count()) === 0);
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
  await page.waitForSelector('text=O que você quer guardar?');
  await page.click('button:has-text("Segredo de desenvolvimento")');
  await page.waitForSelector('input[placeholder*="Filtrar tipos"]', { timeout: 5000 });
  await check('ramo de desenvolvimento vai direto à lista', async () =>
    (await page.locator('[role="dialog"] button:has-text("Chave SSH")').count()) === 1);
  await page.click('button:has-text("Banco de dados")');
  await page.fill('input[aria-label="Nome"]', 'Postgres — staging');
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
  await page.waitForSelector('text=O que você quer guardar?');
  await page.click('button:has-text("Documento pessoal")');
  await page.waitForSelector('text=De onde é o documento?', { timeout: 5000 });
  await check('documento pergunta a origem antes de listar', async () =>
    (await page.locator('[role="dialog"] button:has-text("Geral — qualquer país")').count()) === 1 &&
    (await page.locator('[role="dialog"] button:has-text("Portugal")').count()) === 1 &&
    (await page.locator('[role="dialog"] button:has-text("Brasil")').count()) === 1);
  await check('a expansão traz os novos países', async () =>
    (await page.locator('[role="dialog"] button:has-text("Espanha")').count()) === 1 &&
    (await page.locator('[role="dialog"] button:has-text("Reino Unido")').count()) === 1);
  await page.click('[role="dialog"] button:has-text("Geral — qualquer país")');
  await page.waitForSelector('input[placeholder*="Filtrar tipos"]', { timeout: 5000 });
  await check('Geral inclui o cartão de crédito', async () =>
    (await page.locator('[role="dialog"] button:has-text("Cartão de crédito")').count()) === 1);
  // Declarations are a FAMILY: one entry in the list, the specific kind picked
  // inside the form. Seven tiles for "uma declaração" is what this replaces.
  await check('declarações aparecem como uma entrada só', async () => {
    const labels = await page.locator('[role="dialog"] button .font-medium').allTextContents();
    const declarations = labels.filter((label) => /declara/i.test(label));
    return declarations.length === 1 && declarations[0] === 'Declarações';
  });
  await check('Geral traz recibo de vencimento e contrato de trabalho', async () =>
    (await page.locator('[role="dialog"] button:has-text("Recibo de vencimento")').count()) === 1 &&
    (await page.locator('[role="dialog"] button:has-text("Contrato de trabalho")').count()) === 1);
  // The person types the name they use; the form is called something else.
  await page.fill('input[placeholder*="Filtrar tipos"]', 'holerite');
  await page.waitForTimeout(200);
  await check('filtro do assistente encontra o recibo por "holerite"', async () => {
    const labels = await page.locator('[role="dialog"] button .font-medium').allTextContents();
    return labels.length === 1 && labels[0] === 'Recibo de vencimento';
  });
  // Naming a specific member opens the family up, so typing what you want
  // still lands straight on its own form instead of on the family entry.
  await page.fill('input[placeholder*="Filtrar tipos"]', 'nato vivo');
  await page.waitForTimeout(200);
  await check('filtrar por "nato vivo" revela o membro específico da família', async () => {
    const labels = await page.locator('[role="dialog"] button .font-medium').allTextContents();
    return labels.length === 1 && labels[0] === 'Declaração de nascido vivo';
  });
  await page.fill('input[placeholder*="Filtrar tipos"]', '');
  await page.click('button[aria-label="Voltar"]');
  await page.waitForSelector('text=De onde é o documento?', { timeout: 5000 });
  await page.click('[role="dialog"] button:has-text("Portugal")');
  await page.waitForSelector('input[placeholder*="Filtrar tipos"]', { timeout: 5000 });
  await check('Portugal ganhou os tipos novos', async () =>
    (await page.locator('[role="dialog"] button:has-text("Carta de Condução")').count()) === 1 &&
    (await page.locator('[role="dialog"] button:has-text("Certidão (registo civil)")').count()) === 1);
  await check('as declarações de Portugal também vêm dobradas na família', async () => {
    const labels = await page.locator('[role="dialog"] button .font-medium').allTextContents();
    return labels.includes('Declarações') && !labels.includes('Declaração de IRS');
  });
  await page.fill('input[placeholder*="Filtrar tipos"]', 'IRS');
  await page.waitForTimeout(200);
  await check('filtrar por IRS abre a família e mostra o formulário próprio', async () => {
    const labels = await page.locator('[role="dialog"] button .font-medium').allTextContents();
    return labels.includes('Declaração de IRS');
  });
  await page.fill('input[placeholder*="Filtrar tipos"]', '');
  await check('Portugal traz o IMI', async () =>
    // Exact match on the label element: has-text is a substring and "IMI"
    // also lives inside "imigração" in another type's description.
    (await page.locator('[role="dialog"] button .font-medium').filter({ hasText: /^IMI$/ }).count()) === 1);
  await page.fill('input[placeholder*="Filtrar tipos"]', 'residência');
  await page.waitForTimeout(200);
  await check('filtro do seletor de tipos reduz a lista', async () => {
    const labels = await page.locator('[role="dialog"] button .font-medium').allTextContents();
    // Not every label has to read "resid" any more: the filter also matches
    // keywords, so "residência" legitimately surfaces the comprovativo de
    // morada (atestado de residência). What matters is that it narrows.
    const total = await page.evaluate(() => document.querySelectorAll('[role="dialog"] button .font-medium').length);
    return labels.length > 0 && labels.length < 5 && labels.includes('Título de residência') && total === labels.length;
  });
  await page.fill('input[placeholder*="Filtrar tipos"]', 'residencia');
  await page.waitForTimeout(200);
  await check('filtro do assistente ignora acentos', async () => {
    const labels = await page.locator('[role="dialog"] button .font-medium').allTextContents();
    return labels.includes('Título de residência');
  });
  await page.screenshot({ path: `${OUT}/06-tipos-documento.png` });

  await page.click('button:has-text("Título de residência")');
  await page.fill('input[aria-label="Nome"]', 'Título de residência — Maria');
  await page.click('button:has-text("nova pessoa")');
  await page.fill('input[placeholder="Nome da pessoa"]', 'Maria Teste');
  // Exact match: the same dialog also offers "Adicionar campo personalizado".
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  // Closed-set fields are editable selects: the list opens on click, choosing
  // fills the field, and free text is still accepted for the odd case.
  await page.locator('label:has-text("Tipo de autorização") input').first().click();
  await page.waitForSelector('[role="listbox"]', { timeout: 5000 });
  await check('campo de conjunto fechado abre a lista ao clicar', async () =>
    (await page.locator('[role="listbox"] [role="option"]').count()) >= 5);
  await page.locator('[role="listbox"] [role="option"]:has-text("Permanente")').first().click();
  await check('escolher da lista preenche o campo', async () =>
    (await page.locator('label:has-text("Tipo de autorização") input').first().inputValue()) === 'Permanente');
  await page.locator('label:has-text("Tipo de autorização") input').first().fill('Caso especial');
  await page.locator('label:has-text("Número do título") input').first().click();
  await check('texto fora da lista continua sendo aceito', async () =>
    (await page.locator('label:has-text("Tipo de autorização") input').first().inputValue()) === 'Caso especial');
  await page.locator('label:has-text("Tipo de autorização") input').first().fill('Temporária');
  await page.keyboard.press('Escape');

  await check('tipo de Portugal chega com o país já preenchido', async () =>
    (await selectedValue(page, 'País emissor')) === 'PT');
  await check('titular criado sem sair do formulário', async () => {
    const chosen = await selectedValue(page, 'Titular');
    const shown = await page.locator('[data-select-trigger="Titular"]').first().innerText();
    return !!chosen && shown.includes('Maria Teste');
  });
  await page.locator('label:has-text("Número do título") input').first().fill('RP-2024-99887');
  await page.locator('label:has-text("Válido até") input').first().fill('2027-03-10');
  await page.click('footer button:has-text("Salvar")');
  await page.waitForSelector('h2:has-text("Título de residência — Maria")', { timeout: 5000 });
  await check('documento salvo com os campos do tipo', async () =>
    (await page.locator('aside:has(h2) >> text=RP-2024-99887').count()) > 0);
  await check('detalhe mostra o titular', async () =>
    (await page.locator('aside:has(h2) >> text=Maria Teste').count()) > 0);
  await check('linha da lista mostra o titular em "Tudo"', async () =>
    (await page.locator('main li:has-text("Título de residência — Maria") >> text=Maria Teste').count()) > 0);
  await page.screenshot({ path: `${OUT}/07-documento.png` });

  // 8c. The holder becomes a filter of its own, next to the type filters.
  await check('barra lateral separa documentos de desenvolvimento', async () =>
    (await page.locator('nav button:has-text("Documentos")').count()) > 0 &&
    (await page.locator('nav button:has-text("Desenvolvimento")').count()) > 0);
  await page.click('nav button:has-text("Maria Teste")');
  await page.waitForTimeout(300);
  await check('filtrar por titular mostra só os itens dela', async () =>
    (await page.locator('main li').count()) === 1);
  await check('sob o filtro da pessoa, a linha não repete o titular', async () =>
    (await page.locator('main li >> text=Maria Teste').count()) === 0);
  await page.click('nav button:has-text("Tudo")');
  await page.waitForTimeout(300);
  await check('voltar para “Tudo” restaura a lista', async () => (await page.locator('main li').count()) === 9);

  // 8d. Searching by the holder's name finds a document that never stores it.
  await page.fill('input[type="search"]', 'maria teste');
  await page.waitForTimeout(300);
  await check('busca pelo nome do titular encontra o documento', async () =>
    (await page.locator('main li').count()) === 1);

  // Search must reach a document through its TYPE too — "banco de dados"
  // appears nowhere in the item's own name or fields.
  await page.fill('input[type="search"]', 'banco de dados');
  await page.waitForTimeout(300);
  await check('busca pelo rótulo do tipo encontra o item', async () =>
    (await page.locator('main li:has-text("Postgres — staging")').count()) === 1);
  // Aliases: "SEF" is nowhere in the item — it lives in the type's keywords.
  await page.fill('input[type="search"]', 'SEF');
  await page.waitForTimeout(300);
  await check('busca por apelido do tipo (SEF) encontra o título de residência', async () =>
    (await page.locator('main li:has-text("Título de residência — Maria")').count()) === 1);
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
    // pdf.js paints the canvas before it fills the text layer, so waiting for
    // the canvas is not waiting for the words. Without this the check fails
    // about one run in three, and always on the fast machine.
    await page
      .waitForFunction(
        () => (document.querySelector('[role="dialog"] .keeper-text-layer')?.textContent ?? '').length > 0,
        { timeout: 15000 },
      )
      .catch(() => undefined);
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

  // 8f-bis. Changing the master password must not cost the attachments. Before
  // the key envelope their keys hung off the password's key, and nothing
  // rewrapped them: every scan in the vault became unreadable.
  const NEW_PASSWORD = `${PASSWORD}-nova`;
  await openSettings(page, 'Segurança');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/05b-config-seguranca.png` });
  await page.click('[role="dialog"] button:has-text("Alterar senha mestra")');
  await page.locator('[role="dialog"] label:has-text("Senha mestra atual") input').first().fill(PASSWORD);
  await page.locator('[role="dialog"] label:has-text("Nova senha mestra") input').first().fill(NEW_PASSWORD);
  await page.locator('[role="dialog"] label:has-text("Confirme a nova senha") input').first().fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Alterar senha', exact: true }).click();
  await page.waitForSelector('text=Senha mestra alterada', { timeout: 30000 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await check('trocar a senha mestra mantém os anexos legíveis', async () => {
    await page.click('main li:has-text("Título de residência — Maria")');
    await page.click('aside:has(h2) button:has-text("residencia-2024.pdf")');
    await page.waitForSelector('[role="dialog"] canvas', { timeout: 30000 });
    const box = await page.locator('[role="dialog"] canvas').first().boundingBox();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    return !!box && box.width > 50;
  });
  await check('o cofre passa a abrir com a senha nova', async () => {
    await page.keyboard.press('Control+l');
    await page.waitForSelector('text=Desbloquear cofre', { timeout: 10000 });
    await page.fill('input[type="password"]', NEW_PASSWORD);
    await page.click('button:has-text("Desbloquear")');
    await page.waitForSelector('text=GitHub PAT', { timeout: 30000 });
    return true;
  });
  // Back to the original phrase: everything downstream unlocks with it, and
  // the round trip proves the second change costs the attachments nothing.
  await openSettings(page, 'Segurança');
  await page.click('[role="dialog"] button:has-text("Alterar senha mestra")');
  await page.locator('[role="dialog"] label:has-text("Senha mestra atual") input').first().fill(NEW_PASSWORD);
  await page.locator('[role="dialog"] label:has-text("Nova senha mestra") input').first().fill(PASSWORD);
  await page.locator('[role="dialog"] label:has-text("Confirme a nova senha") input').first().fill(PASSWORD);
  await page.getByRole('button', { name: 'Alterar senha', exact: true }).click();
  await page.waitForSelector('text=Senha mestra alterada', { timeout: 30000 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // 8f-ter. Where the vault is kept. Without a Google account the section can
  // only offer the explanation, but it renders — and the move button is not
  // reachable by accident from a device that has no account attached.
  // The previous dialog has to be gone, not just closing: a click that lands
  // mid-animation is swallowed by the overlay and the next one reopens nothing.
  await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 5000 });
  await openSettings(page, 'Conta e Drive');
  await page.waitForSelector('[role="dialog"] >> text=Onde o cofre fica', { timeout: 5000 });
  await check('configurações dizem onde o cofre fica', async () =>
    (await page.locator('[role="dialog"] >> text=Conecte a conta do Google para escolher onde o cofre fica').count()) === 1);
  await check('sem conta conectada não há botão de mover', async () =>
    (await page.locator('[role="dialog"] button:has-text("Mover para uma pasta do Drive")').count()) === 0);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

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
  await openSettings(page, 'Backup');
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
  await openSettings(page, 'Pessoas e tipos');
  await page.waitForSelector('[role="dialog"] input[aria-label="Nome do titular"]', { timeout: 5000 });

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
  await openSettings(page, 'Pessoas e tipos');
  await page.waitForSelector('[role="dialog"] input[aria-label="Parentesco"]', { timeout: 5000 });
  await check('o parentesco editado sobrevive ao fechar e reabrir', async () =>
    (await page.locator('[role="dialog"] input[aria-label="Parentesco"]').inputValue()) === 'esposa');
  await page.screenshot({ path: `${OUT}/08-pessoas.png` });
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 5000 });

  // Creating an item while a person's filter is active means "for them": the
  // holder select opens already pointing at the sidebar person.
  await page.locator('nav button:has-text("Maria Teste")').click();
  await page.waitForTimeout(300);
  await page.locator('header button:has-text("Novo")').click();
  await page.waitForSelector('text=O que você quer guardar?', { timeout: 5000 });
  await page.click('[role="dialog"] button:has-text("Segredo de desenvolvimento")');
  await page.locator('[role="dialog"] button:has-text("API Token")').first().click();
  await page.waitForSelector('[role="dialog"] >> text=Titular', { timeout: 5000 });
  await check('criar com filtro de pessoa pré-seleciona o titular', async () => {
    const chosen = await selectedValue(page, 'Titular');
    if (!chosen) return false;
    return (await page.locator('[data-select-trigger="Titular"]').first().innerText()).includes('Maria Teste');
  });
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 5000 });
  await page.locator('nav button:has-text("Tudo")').click();
  await page.waitForTimeout(300);

  // Sharing needs an account and a real folder, neither of which exists here.
  // What it must do without them is explain itself, not offer a form that
  // cannot work.
  await openSettings(page, 'Partilha');
  // Sem conta nenhuma ligada a este dispositivo, a partilha explica em vez de
  // oferecer um formulário que não pode funcionar. Com conta ligada, o painel
  // aparece mesmo sem token vivo — trancá-lo atrás de uma sessão que já não se
  // renova sozinha era deixá-lo inalcançável.
  await check('a partilha pede a conta antes de qualquer formulário', async () =>
    (await page.locator('[role="dialog"] >> text=Conecte a conta do Google para partilhar').count()) === 1 &&
    (await page.locator('[role="dialog"] textarea[aria-label="Código de convite"]').count()) === 0);
  // The guest's own code has to work with no account and no vault of theirs.
  await page.click('[role="dialog"] summary:has-text("Meu código de convite")');
  await check('o código de convite deste aparelho é gerado e é público', async () => {
    const code = await page
      .locator('[role="dialog"] p.font-mono')
      .first()
      .textContent({ timeout: 10000 });
    return !!code && code.startsWith('KEEPER1-') && code.split('-').length === 3;
  });
  await check('o código sobrevive a recarregar a página', async () => {
    const first = await page.locator('[role="dialog"] p.font-mono').first().textContent();
    await page.keyboard.press('Escape');
    // A code that changes on reload is a trap: it was already sent to someone.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=GitHub PAT', { timeout: 20000 });
    await openSettings(page, 'Partilha');
    await page.click('[role="dialog"] summary:has-text("Meu código de convite")');
    await page.waitForSelector('[role="dialog"] p.font-mono', { timeout: 10000 });
    const again = await page.locator('[role="dialog"] p.font-mono').first().textContent();
    return !!first && first === again;
  });
  await page.screenshot({ path: `${OUT}/05c-convite.png` });

  // The picker key is what a guest needs and nobody else: it has to be visible
  // and changeable without being in anyone's way.
  await openSettings(page, 'Avançado');
  await check('a chave do seletor de arquivos aparece em Avançado', async () =>
    (await page.locator('[role="dialog"] >> text=Chave de API do Google').count()) === 1 &&
    (await page.locator('[role="dialog"] button:has-text("Trocar a chave de API")').count()) === 1);

  await openSettings(page, 'Conta e Drive');
  await page.waitForSelector('[role="dialog"] >> text=Espaço no Google Drive', { timeout: 5000 });
  await check('as configurações têm a seção de espaço no Drive', async () =>
    (await page.locator('[role="dialog"] >> text=Espaço no Google Drive').count()) === 1);
  await check('sem conta conectada, a seção explica em vez de mentir um número', async () =>
    (await page.locator('[role="dialog"] >> text=Conecte a conta do Google para ver o espaço').count()) === 1);

  // The theme lives in a pane of its own, one click away.
  await page.locator('[data-settings-nav] button:has-text("Aparência")').click();
  await page.waitForSelector('[data-select-trigger="Tema"]', { timeout: 5000 });
  await check('trocar de painel troca o conteúdo', async () =>
    (await page.locator('[role="dialog"] >> text=Espaço no Google Drive').count()) === 0);
  await chooseOption(page, 'Tema', 'light');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/05-settings-light.png` });

  // 11. Lock clears the decrypted state.
  await check('tema claro aplicado', async () =>
    (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light');
  await chooseOption(page, 'Tema', 'dark');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+l');
  await page.waitForSelector('text=Desbloquear cofre', { timeout: 5000 });
  await check('bloqueio volta para a tela de senha', async () => true);

  // 11b. Keyboard shortcuts on desktop.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button:has-text("Desbloquear")');
  await page.waitForSelector('text=GitHub PAT', { timeout: 20000 });

  await page.keyboard.press('j');
  await page.waitForTimeout(200);
  await check('J seleciona o primeiro item', async () =>
    (await page.locator('[data-row-selected="true"]').count()) === 1);
  await page.keyboard.press('j');
  await page.waitForTimeout(200);
  await check('J desce a seleção e o detalhe acompanha', async () => {
    const row = await page.locator('[data-row-selected="true"]').innerText();
    const detail = (await page.locator('aside h2').innerText()).trim();
    return detail.length > 0 && row.includes(detail);
  });
  await check('linha selecionada mostra dicas de atalho', async () =>
    (await page.locator('[data-row-selected="true"] kbd').count()) >= 2);

  // Pin a secret-bearing item: the "Recentes" order after the whole flow can
  // put a copyless document in second place.
  await page.fill('input[type="search"]', 'DigitalOcean');
  await page.waitForTimeout(300);
  await page.locator('input[type="search"]').blur();
  await page.keyboard.press('j');
  await page.waitForTimeout(200);
  await page.keyboard.press('c');
  await check('C copia o segredo principal', async () => {
    await page.getByText('Copiado para a área de transferência.').waitFor({ timeout: 5000 });
    return true;
  });

  await page.keyboard.press('e');
  await page.waitForSelector('[role="dialog"] >> text=Editar segredo', { timeout: 5000 });
  await check('E abre o editor do item selecionado', async () => true);

  // Typed letter by letter on purpose: the dialog used to steal the focus
  // back after every keystroke (its focus() lived in an effect keyed on an
  // unstable onClose), so the caret left the field after one letter.
  await page.locator('[role="dialog"] input').first().click();
  await page.keyboard.type(' teste', { delay: 40 });
  await check('digitar num campo do editor mantém o foco no campo', async () =>
    page.evaluate(() => {
      const active = document.activeElement;
      return active instanceof HTMLInputElement && active.value.endsWith('teste');
    }));
  page.once('dialog', (dialog) => void dialog.accept());
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 5000 });
  await page.fill('input[type="search"]', '');
  await page.locator('input[type="search"]').blur();

  await page.keyboard.press('?');
  await page.waitForSelector('text=Atalhos do teclado', { timeout: 5000 });
  await check('? abre o painel de atalhos', async () => true);
  await page.keyboard.press('Escape');
  await page.waitForSelector('text=Atalhos do teclado', { state: 'detached', timeout: 5000 });

  // The guard: single keys must not fire while a field is focused.
  await page.keyboard.press('Control+k');
  await page.keyboard.type('j');
  await check('atalhos de uma tecla não disparam ao digitar', async () =>
    (await page.locator('input[type="search"]').inputValue()) === 'j');
  await page.fill('input[type="search"]', '');
  await page.keyboard.press('Escape');

  // 11c. Sharing without a share sheet (headless desktop): copy + mailto
  // fallback, secret fields unticked and therefore missing from the mailto.
  await page.click('text=Painel DigitalOcean');
  await page.waitForSelector('aside button[aria-label="Compartilhar"]', { timeout: 5000 });
  await page.click('aside button[aria-label="Compartilhar"]');
  await page.waitForSelector('[role="dialog"] >> text=texto puro', { timeout: 5000 });
  await check('sem folha nativa, oferece copiar e enviar por e-mail', async () =>
    (await page.locator('[role="dialog"] a[href^="mailto:"]').count()) === 1 &&
    (await page.locator('[role="dialog"] button:has-text("Copiar")').count()) === 1);
  await check('campo secreto começa desmarcado', async () =>
    (await page.locator('[role="dialog"] label:has-text("Senha") input[type="checkbox"]').first().isChecked()) === false);
  await check('o mailto leva os campos marcados e não leva a senha', async () => {
    const href = await page.locator('[role="dialog"] a[href^="mailto:"]').getAttribute('href');
    if (!href) return false;
    const decoded = decodeURIComponent(href);
    return decoded.includes('edgar@equantic.tech') && !decoded.includes('senha-exemplo-do-painel');
  });
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 5000 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // 11c-quinquies. Every change schedules its own upload; when the Drive is
  // out of reach the change is PENDING (and chased), not parked as "local".
  // Offline is simulated, so the guard is exercised for real: a change made
  // without a network must be PENDING (something is chasing it), not parked.
  await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true }));
  await page.click('main li:has-text("GitHub PAT")');
  await page.waitForTimeout(200);
  await page.click('aside button[aria-label="Favoritar"], aside button[aria-label="Remover dos favoritos"]');
  await page.waitForTimeout(2200);
  await check('mudança feita offline fica pendente, não parada', async () => {
    const header = await page.locator('header').first().innerText();
    if (!/pendente/i.test(header)) console.log(`      (cabeçalho: ${JSON.stringify(header)})`);
    return /pendente/i.test(header);
  });
  await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true }));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(400);

  // 11c-sexies. Notes: an item like any other, but its body is a block
  // document — typed here, rendered in the detail, searchable, exportable.
  await page.locator('header button:has-text("Novo")').click();
  await page.waitForSelector('text=O que você quer guardar?', { timeout: 5000 });
  await check('o assistente oferece a nota como terceiro caminho', async () =>
    (await page.locator('[role="dialog"] button:has-text("Nota")').count()) >= 1);
  await page.click('[role="dialog"] button:has-text("Nota")');
  await page.waitForSelector('[data-note-editor="edit"]', { timeout: 5000 });
  await page.fill('input[aria-label="Nome"]', 'Mudança para Lisboa');
  // The pane is a page: it fills the dialog and shows what to do, with no box
  // around it — and a click on the blank space below lands the caret in the text.
  await check('a folha ocupa a altura do painel e diz como começar', async () => {
    const sheet = await page.locator('[data-note-editor="edit"]').boundingBox();
    // O texto-guia é conteúdo de CSS (::before), invisível a innerText: o que
    // se verifica é o atributo que o desenha.
    const hint = await page
      .locator('[data-note-editor="edit"] p[data-placeholder]')
      .first()
      .getAttribute('data-placeholder');
    return !!sheet && sheet.height > 300 && /digite \//.test(hint ?? '');
  });
  const sheet = await page.locator('[data-note-editor="edit"]').boundingBox();
  await page.mouse.click(sheet.x + sheet.width / 2, sheet.y + sheet.height - 30);
  await page.keyboard.type('Pendências da semana');
  await check('clicar no fim da folha escreve na última linha', async () =>
    (await page.locator('[data-note-editor="edit"]').innerText()).includes('Pendências da semana'));
  await page.keyboard.press('Enter');
  // The slash menu is how a block becomes something else.
  await page.keyboard.type('/lista');
  await page.waitForSelector('[role="listbox"][aria-label="Blocos"]', { timeout: 5000 });
  await check('o menu de barra oferece os blocos', async () =>
    (await page.locator('[role="listbox"][aria-label="Blocos"] [role="option"]').count()) >= 1);
  await page.keyboard.press('Enter');
  await page.keyboard.type('agendar AIMA');
  await page.waitForTimeout(200);
  await check('o bloco virou item de lista', async () =>
    (await page.locator('[data-note-editor="edit"] li:has-text("agendar AIMA")').count()) === 1);
  // On a wide screen the note is a page: the details in a column of their own,
  // the content beside them, both filling the dialog's height.
  // The note is a document: details, page and summary side by side, with the
  // dialog taking the screen. The number that governs it is the page's width.
  await check('a nota abre em três colunas no desktop', async () => {
    const shape = await page.evaluate(() => {
      const panes = [...document.querySelectorAll('[data-note-pane]')].filter(
        (node) => node.getBoundingClientRect().width > 0,
      );
      const dialog = document.querySelector('[role="dialog"]').getBoundingClientRect();
      const sheet = document.querySelector('[data-note-editor="edit"]')?.getBoundingClientRect();
      return {
        panes: panes.map((node) => node.getAttribute('data-note-pane')).sort(),
        inline: panes.every((node) => getComputedStyle(node).position !== 'absolute'),
        wide: dialog.width > window.innerWidth * 0.9,
        sheet: sheet ? Math.round(sheet.width) : 0,
      };
    });
    return (
      shape.panes.join(',') === 'details,outline' && shape.inline && shape.wide && shape.sheet >= 560
    );
  });
  await check('a barra de blocos oferece os tipos em aberto', async () =>
    (await page.locator('[role="toolbar"][aria-label="Blocos"] button').count()) >= 10);
  // The toolbar converts the block under the caret, and a heading is what the
  // summary is made of — so one gesture proves both.
  // The caret is inside the list item by now; the toolbar converts the block it
  // is IN, so put it back on the first line before asking for a heading.
  await page.click('[data-note-editor="edit"] p:has-text("Pendências da semana")');
  await page.click('[role="toolbar"][aria-label="Blocos"] button[aria-label="Título 1"]');
  await page.waitForTimeout(300);
  await check('a barra converte o bloco em título', async () =>
    (await page.locator('[data-note-editor="edit"] h1:has-text("Pendências da semana")').count()) === 1);
  await check('o sumário lista os títulos da nota', async () =>
    (await page.locator('[data-note-pane="outline"] button:has-text("Pendências da semana")').count()) === 1);
  await page.click('[role="toolbar"][aria-label="Blocos"] button[aria-label="Título 1"]');
  await page.waitForTimeout(200);
  await check('o formulário da nota não mostra seção de campos vazia', async () =>
    (await page.locator('[role="dialog"] >> text=Campos de Nota').filter({ visible: true }).count()) === 0);
  await page.click('footer button:has-text("Salvar")');
  await page.waitForSelector('h2:has-text("Mudança para Lisboa")', { timeout: 5000 });
  await check('a nota salva é lida como documento no detalhe', async () =>
    (await page.locator('aside [data-note-editor="read"] li:has-text("agendar AIMA")').count()) === 1 &&
    (await page.locator('aside [data-note-editor="read"]').innerText()).includes('Pendências da semana'));
  await page.fill('input[type="search"]', 'agendar AIMA');
  await page.waitForTimeout(300);
  await check('a busca encontra o que está escrito dentro da nota', async () =>
    (await page.locator('main li:has-text("Mudança para Lisboa")').count()) === 1);
  await page.fill('input[type="search"]', '');
  await page.waitForTimeout(200);
  await page.click('main li:has-text("Mudança para Lisboa")');
  await page.click('aside button[aria-label="Compartilhar"]');
  await page.waitForSelector('[role="dialog"] >> text=Compartilhar', { timeout: 5000 });
  await check('compartilhar uma nota oferece baixar .md', async () =>
    (await page.locator('[role="dialog"] button:has-text("Baixar .md")').count()) === 1);
  const mdDownload = page.waitForEvent('download', { timeout: 10000 });
  await page.click('[role="dialog"] button:has-text("Baixar .md")');
  const file = await mdDownload;
  const markdown = await file.createReadStream().then(async (stream) => {
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8');
  });
  await check('o .md exportado é markdown puro, com título e lista', async () =>
    file.suggestedFilename() === 'Mudanca-para-Lisboa.md' &&
    markdown.includes('# Mudança para Lisboa') &&
    markdown.includes('- agendar AIMA'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // 11c-septies. The account row is the way to Settings: it must not scroll
  // away with the folders and types.
  await check('o rodapé da barra lateral fica fixo', async () => {
    const before = await page.evaluate(() => {
      const footer = document.querySelector('[data-sidebar-footer]');
      const scroller = document.querySelector('[data-sidebar-scroll]');
      if (!footer || !scroller) return null;
      scroller.scrollTop = scroller.scrollHeight;
      return {
        top: Math.round(footer.getBoundingClientRect().top),
        // Só prova alguma coisa se a lista realmente rolar.
        scrollable: scroller.scrollHeight > scroller.clientHeight + 4,
        bottom: Math.round(footer.getBoundingClientRect().bottom),
        navBottom: Math.round(document.querySelector('nav').getBoundingClientRect().bottom),
      };
    });
    if (!before) return false;
    await page.waitForTimeout(250);
    const after = await page.evaluate(() =>
      Math.round(document.querySelector('[data-sidebar-footer]').getBoundingClientRect().top),
    );
    if (!before.scrollable) console.log('      (barra lateral não rolava neste viewport)');
    return Math.abs(after - before.top) <= 1 && Math.abs(before.bottom - before.navBottom) <= 2;
  });

  // Google will not let an app leave Testing without these, and anyone deciding
  // whether to sign in deserves to read them first — so they have to be
  // reachable, and reachable WITHOUT signing in.
  // A worker that installs and then waits for every tab to close means the app
  // a person has open never updates. That is how a page added in one deploy was
  // still missing days later.
  await check('o service worker assume o comando sozinho', async () => {
    const sw = await page.request.get(`${BASE}sw.js`);
    const source = await sw.text();
    return source.includes('clientsClaim()') && source.includes('skipWaiting()');
  });

  // Through the service worker, not around it. Note what this does NOT prove:
  // the way this actually broke for someone was an OLD worker still in charge,
  // from a build before these pages existed, and a suite that always starts
  // from a fresh one cannot stage that. It proves the pages survive a worker
  // that knows about them, which is the part that stays true from now on.
  await check('o service worker não sequestra as páginas legais', async () => {
    // "Active" is not "in charge": a worker that has not claimed this client
    // intercepts nothing, and the check would pass on a broken build. A reload
    // is what puts a fresh registration in control.
    const controlling = async () =>
      page.evaluate(async () => {
        if (!('serviceWorker' in navigator)) return false;
        await navigator.serviceWorker.ready;
        return !!navigator.serviceWorker.controller;
      });
    if (!(await controlling())) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('text=GitHub PAT', { timeout: 20000 });
    }
    if (!(await controlling())) {
      console.log('      (nenhum service worker no comando: a checagem não prova nada aqui)');
      return false;
    }
    await page.goto(`${BASE}privacidade.html`);
    const title = await page.title();
    await page.goto(BASE);
    await page.waitForSelector('text=GitHub PAT', { timeout: 20000 });
    return title.includes('Política de privacidade');
  });

  for (const [file, heading, ...required] of [
    // The Limited Use wording is what a Google verification looks for, and it
    // belongs to the privacy policy — the terms page has its own job.
    [
      'privacidade.html',
      'Política de privacidade',
      'Google API Services User Data Policy',
      'Limited Use',
      'drive.appdata',
    ],
    ['termos.html', 'Termos de uso', 'MIT', 'sem garantia', 'senha mestra'],
  ]) {
    const response = await page.request.get(`${BASE}${file}`);
    const html = await response.text();
    await check(`${file} é servida e diz o que precisa dizer`, async () => {
      const missing = required.filter((needle) => !html.includes(needle));
      if (missing.length) console.log(`      (falta na página: ${missing.join(', ')})`);
      return response.status() === 200 && html.includes(heading) && missing.length === 0;
    });
  }

  // 11c-quinquies-bis. Masks: a CPF is written 000.000.000-00 on every form the
  // person has ever filled, and a run of digits is where a transposed pair hides.
  await page.click('header button:has-text("Novo")');
  await page.waitForSelector('text=O que você quer guardar?', { timeout: 5000 });
  await page.click('button:has-text("Documento pessoal")');
  await page.waitForSelector('text=De onde é o documento?', { timeout: 5000 });
  await page.click('[role="dialog"] button:has-text("Brasil")');
  await page.waitForSelector('input[placeholder*="Filtrar tipos"]', { timeout: 5000 });
  await page.click('[role="dialog"] button:has-text("CPF")');
  await page.waitForSelector('[role="dialog"] label:has-text("CPF")', { timeout: 5000 });
  const cpfInput = page.locator('[role="dialog"] label:has-text("CPF") input').first();
  await check('o CPF se formata enquanto se digita', async () => {
    await cpfInput.click();
    await page.keyboard.type('123');
    const three = await cpfInput.inputValue();
    await page.keyboard.type('4');
    const four = await cpfInput.inputValue();
    await page.keyboard.type('5678900');
    const full = await cpfInput.inputValue();
    // Sem pontuação pendurada no fim: o ponto entra com o dígito seguinte.
    return three === '123' && four === '123.4' && full === '123.456.789-00';
  });
  await check('digitar no meio não faz o cursor saltar', async () => {
    // Apagar um dígito do meio e escrever outro: o valor tem de continuar
    // formatado e o cursor tem de ficar onde a pessoa estava.
    await cpfInput.click();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('9');
    const value = await cpfInput.inputValue();
    const caret = await cpfInput.evaluate((el) => el.selectionStart);
    return value === '123.945.678-90' && caret === 5;
  });
  // O formulário está sujo, então sair pede confirmação.
  page.once('dialog', (dialog) => void dialog.accept());
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 5000 });

  // 11c-sexies-bis. The right button on a row. Everything it offers has another
  // way in, but all of those cost a trip somewhere else.
  await page.click('main li:has-text("GitHub PAT") >> nth=0', { button: 'right' });
  await page.waitForSelector('[data-context-menu]', { timeout: 5000 });
  await check('o botão direito abre o menu do item', async () => {
    const labels = await page.locator('[data-context-menu] [role="menuitem"]').allInnerTexts();
    return (
      labels.some((text) => text.includes('Editar')) &&
      labels.some((text) => text.includes('favoritos')) &&
      labels.some((text) => text.includes('Mover para')) &&
      labels.some((text) => text.includes('Titular')) &&
      labels.some((text) => text.includes('lixeira'))
    );
  });
  await check('a lista de pastas abre dentro do próprio menu', async () => {
    await page.click('[data-context-menu] [data-menu-item="folder"]');
    await page.waitForTimeout(200);
    const labels = await page.locator('[data-context-menu] [role="menuitem"]').allInnerTexts();
    return labels.includes('Sem pasta') && labels.some((text) => text.includes('Infra'));
  });
  await page.screenshot({ path: `${OUT}/03b-menu-item.png` });
  await check('escolher a pasta move o item de verdade', async () => {
    await page.click('[data-context-menu] [role="menuitem"]:has-text("Produtos")');
    await page.waitForSelector('[data-context-menu]', { state: 'detached', timeout: 5000 });
    await page.waitForTimeout(400);
    // Prova pela pasta, não pela lista inteira: o item tem de estar lá dentro.
    await page.click('nav button:has-text("Produtos")');
    await page.locator('main li').first().waitFor({ state: 'visible', timeout: 5000 });
    const moved = (await page.locator('main li:has-text("GitHub PAT")').count()) === 1;
    await page.click('nav button:has-text("Tudo")');
    await page.locator('main li:has-text("Azure Container Registry")').first().waitFor({ timeout: 5000 });
    return moved;
  });
  await check('favoritar pelo menu marca o item', async () => {
    await page.click('main li:has-text("Azure Container Registry") >> nth=0', { button: 'right' });
    await page.waitForSelector('[data-context-menu]', { timeout: 5000 });
    await page.click('[data-context-menu] [data-menu-item="favorite"]');
    await page.waitForSelector('[data-context-menu]', { state: 'detached', timeout: 5000 });
    await page.waitForTimeout(400);
    await page.click('nav button:has-text("Favoritos")');
    await page.locator('main li').first().waitFor({ state: 'visible', timeout: 5000 });
    const favorited = (await page.locator('main li:has-text("Azure Container Registry")').count()) === 1;
    await page.click('nav button:has-text("Tudo")');
    await page.locator('main li:has-text("Painel DigitalOcean")').first().waitFor({ timeout: 5000 });
    return favorited;
  });
  await check('Esc fecha o menu sem fazer nada', async () => {
    await page.click('main li:has-text("Painel DigitalOcean") >> nth=0', { button: 'right' });
    await page.waitForSelector('[data-context-menu]', { timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-context-menu]', { state: 'detached', timeout: 5000 });
    return (await page.locator('main li:has-text("Painel DigitalOcean")').count()) === 1;
  });

  // 11c-sexies-ter. An invite link: the guest opens one thing and the app knows
  // which vault, which record and which key. What it cannot carry is the Drive's
  // permission, so the picker still happens once — but nothing is typed and
  // nothing is sent back.
  await check('um link de convite é reconhecido ao abrir o app', async () => {
    const link = await page.evaluate(() => {
      const payload = {
        share: 'registo-1',
        secret: 'c2VncmVkbw==',
        folderId: 'pasta-1',
        vaultFileId: 'cofre-1',
        sharesFileId: 'partilhas-1',
        folderName: 'eQuantic Keeper',
      };
      const base64 = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(payload))))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
      return `${location.origin}/#convite=${base64}`;
    });
    // Colado numa aba que já tem o app aberto: só o fragmento muda, e mudar o
    // fragmento não recarrega nada — é o caso que passava despercebido.
    await page.goto(link);
    await page.waitForTimeout(500);
    const banner = await page.locator('main >> text=Alguém partilhou um cofre com você').count();
    // E o link sai da barra de endereços: ele carrega uma chave.
    const url = page.url();
    return banner === 1 && !url.includes('convite=');
  });
  await check('dispensar o convite tira o aviso', async () => {
    await page.click('main button:has-text("Agora não")');
    await page.waitForTimeout(300);
    return (await page.locator('main >> text=Alguém partilhou um cofre com você').count()) === 0;
  });
  await check('e não volta ao recarregar', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=GitHub PAT', { timeout: 20000 });
    return (await page.locator('main >> text=Alguém partilhou um cofre com você').count()) === 0;
  });

  // 11c-septies-bis. The vault switcher. A person can hold their own vault and
  // any number shared with them, and the way between them is here — including
  // for someone who already has a vault of their own, which is where the guest
  // flow used to have no door at all.
  await check('o topo da barra lateral diz em que cofre estamos', async () => {
    const trigger = page.locator('[data-select-trigger="Cofre"]');
    return (await trigger.count()) === 1 && (await selectedValue(page, 'Cofre')) === 'own';
  });
  await check('o seletor oferece abrir um cofre partilhado', async () => {
    const options = await optionLabels(page, 'Cofre');
    return (
      options.some((text) => text.includes('Meu cofre')) &&
      options.some((text) => text.startsWith('Abrir um cofre partilhado'))
    );
  });

  // 11c-octies. The divider between the two halves of the sidebar: dragging it
  // gives the folder tree room, and the choice survives a reload.
  await check('arrastar a divisória redimensiona as metades', async () => {
    const before = await page.evaluate(
      () => document.querySelector('[data-sidebar-scroll]').getBoundingClientRect().height,
    );
    const handle = page.locator('[data-sidebar-splitter]');
    const box = await handle.boundingBox();
    if (!box) return false;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 120, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const after = await page.evaluate(
      () => document.querySelector('[data-sidebar-scroll]').getBoundingClientRect().height,
    );
    return after < before - 60;
  });
  await check('a divisória também anda pelo teclado', async () => {
    const before = await page.evaluate(
      () => document.querySelector('[data-sidebar-scroll]').getBoundingClientRect().height,
    );
    await page.locator('[data-sidebar-splitter]').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);
    const after = await page.evaluate(
      () => document.querySelector('[data-sidebar-scroll]').getBoundingClientRect().height,
    );
    return after > before;
  });
  await check('a divisória fica onde foi deixada depois de recarregar', async () => {
    const before = await page.evaluate(
      () => document.querySelector('[data-sidebar-scroll]').getBoundingClientRect().height,
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=GitHub PAT', { timeout: 20000 });
    const after = await page.evaluate(
      () => document.querySelector('[data-sidebar-scroll]').getBoundingClientRect().height,
    );
    return Math.abs(after - before) <= 2;
  });

  // 11d. Folders created straight in the sidebar, before any item uses them.
  await page.click('button[aria-label="Nova pasta"]');
  await page.fill('input[placeholder="Nome da pasta"]', 'Fiscal');
  await page.keyboard.press('Enter');
  await page.waitForSelector('nav button:has-text("Fiscal")', { timeout: 5000 });
  await check('pasta criada na barra lateral aparece vazia', async () =>
    // Uma pasta sem itens não exibe contagem: "0" ao lado de cada pasta é ruído.
    !/\d/.test(await page.locator('nav [data-folder-row="Fiscal"]').innerText()));

  // 11d-bis. Folders nest: a subfolder is created from its parent's row, the
  // parent counts what is below it, and both can be dragged in and out.
  await page.click('nav button[aria-label="Nova subpasta em Fiscal"]');
  await page.fill('input[placeholder="Subpasta de Fiscal"]', '2026');
  await page.keyboard.press('Enter');
  await page.waitForSelector('nav [data-folder-row="Fiscal/2026"]', { timeout: 5000 });
  await check('subpasta aparece indentada sob a pasta mãe', async () => {
    const parent = await page.locator('nav [data-folder-row="Fiscal"]').boundingBox();
    const child = await page.locator('nav [data-folder-row="Fiscal/2026"]').boundingBox();
    return !!parent && !!child && child.x > parent.x;
  });
  await page.click('nav button[aria-label="Recolher Fiscal"]');
  await page.waitForTimeout(200);
  await check('recolher a pasta mãe esconde a subpasta', async () =>
    (await page.locator('nav [data-folder-row="Fiscal/2026"]').count()) === 0);
  await page.click('nav button[aria-label="Expandir Fiscal"]');
  await page.waitForTimeout(200);

  // Dragging folders: same real DragEvents as the item rows (a headless
  // browser never runs its native drag loop), with the folder's own mime type.
  const dragFolder = (from, targetSelector) =>
    page.evaluate(
      ([path, selector]) => {
        const row = document.querySelector(`nav [data-folder-row="${path}"]`);
        const target = document.querySelector(selector);
        if (!row || !target) return false;
        const dataTransfer = new DataTransfer();
        row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
        target.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer }));
        target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }));
        row.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
        return true;
      },
      [from, targetSelector],
    );

  await dragFolder('Fiscal/2026', 'nav [data-drop-target="folder-root"]');
  await page.waitForTimeout(500);
  await check('arrastar para o cabeçalho tira a subpasta de dentro', async () =>
    (await page.locator('nav [data-folder-row="2026"]').count()) === 1 &&
    (await page.locator('nav [data-folder-row="Fiscal/2026"]').count()) === 0);
  await dragFolder('2026', 'nav [data-drop-target="folder:Fiscal"]');
  await page.waitForTimeout(500);
  await check('arrastar sobre outra pasta faz dela uma subpasta', async () =>
    (await page.locator('nav [data-folder-row="Fiscal/2026"]').count()) === 1);

  await page.click('nav [data-folder-row="Fiscal"]');
  await page.waitForTimeout(300);
  await check('filtrar pela pasta vazia mostra 0 itens', async () =>
    (await page.locator('main li').count()) === 0);
  await page.click('nav button:has-text("Tudo")');
  await page.waitForTimeout(300);

  await page.hover('nav button:has-text("Fiscal")');
  // A pasta mãe só pode sair depois da subpasta: apagar uma pasta com filhos
  // levaria a subárvore junto sem dizer.
  await check('pasta com subpasta não oferece remover', async () =>
    (await page.locator('button[aria-label="Remover pasta Fiscal"]').count()) === 0);
  await page.click('nav button[aria-label="Remover pasta 2026"]');
  await page.waitForTimeout(300);
  await page.click('button[aria-label="Remover pasta Fiscal"]');
  await page.waitForSelector('nav button:has-text("Fiscal")', { state: 'detached', timeout: 5000 });
  await check('remover a pasta vazia tira a entrada da barra lateral', async () => true);

  // 11e. Custom types: build one in the wizard, use it, manage it in settings.
  await page.click('button:has-text("Novo")');
  await page.waitForSelector('text=O que você quer guardar?');
  await page.click('button:has-text("Criar tipo personalizado")');
  await page.waitForSelector('text=Novo tipo personalizado', { timeout: 5000 });
  await page.fill('input[placeholder="Contrato de aluguel — Espanha"]', 'Contrato de aluguel — Espanha');
  await chooseOption(page, 'Categoria do tipo', 'Espanha');
  await page.click('button:has-text("Adicionar campo")');
  await page.locator('[role="dialog"] button').filter({ hasText: 'Nº do documento, órgão' }).click();
  await page.fill('input[placeholder="Nome do campo"]', 'Número do contrato');
  await page.click('button:has-text("Adicionar campo")');
  await page.locator('[role="dialog"] button').filter({ hasText: 'Entra nos alertas de vencimento' }).click();
  await page.click('button:has-text("Salvar tipo")');
  await page.waitForSelector('text=Novo: Contrato de aluguel — Espanha', { timeout: 10000 });
  await check('salvar o tipo abre o editor já com os campos dele', async () =>
    (await page.locator('[role="dialog"] >> text=Número do contrato').count()) === 1 &&
    (await page.locator('[role="dialog"] >> text=Válido até').count()) === 1);

  await page.fill('input[aria-label="Nome"]', 'Aluguel Madrid');
  await page.locator('label:has-text("Número do contrato") input').first().fill('ES-2026-01');
  await page.locator('label:has-text("Válido até") input').first().fill(relativeDay(20));
  await page.click('footer button:has-text("Salvar")');
  await page.waitForSelector('h2:has-text("Aluguel Madrid")', { timeout: 5000 });
  await check('item do tipo personalizado é salvo e legível', async () =>
    (await page.locator('aside:has(h2) >> text=ES-2026-01').count()) > 0);
  await check('a validade do tipo personalizado entra nos alertas', async () =>
    (await page.locator('aside:has(h2) >> text=expira em').count()) > 0);

  // The definition travels in the encrypted payload: a reload keeps it. (The
  // reload reopens without the password — the derived key persists while the
  // auto-lock window is open; 11d asserts that on purpose.)
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=GitHub PAT', { timeout: 20000 });
  await page.click('text=Aluguel Madrid');
  await page.waitForSelector('h2:has-text("Aluguel Madrid")', { timeout: 5000 });
  await check('o tipo personalizado sobrevive à recarga', async () =>
    (await page.locator('aside:has(h2) >> text=Contrato de aluguel — Espanha').count()) > 0);

  await openSettings(page, 'Pessoas e tipos');
  await page.waitForSelector('[role="dialog"] >> text=Tipos personalizados', { timeout: 5000 });
  await check('configurações listam o tipo personalizado', async () =>
    (await page.locator('button[aria-label="Remover tipo Contrato de aluguel — Espanha"]').count()) === 1);
  page.once('dialog', (dialog) => void dialog.accept());
  await page.click('button[aria-label="Remover tipo Contrato de aluguel — Espanha"]');
  await page.waitForSelector('button[aria-label="Remover tipo Contrato de aluguel — Espanha"]', {
    state: 'detached',
    timeout: 5000,
  });
  await check('remover o tipo tira a definição', async () => true);
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 5000 });
  await check('itens do tipo removido continuam legíveis (fallback)', async () =>
    (await page.locator('aside:has(h2) >> text=campo antigo').count()) > 0);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // 11f. The credit card draws itself: masked front, flip to the back, brand
  // detected offline from the prefix, color chosen as a preset.
  await page.click('button:has-text("Novo")');
  await page.waitForSelector('text=O que você quer guardar?');
  await page.click('button:has-text("Documento pessoal")');
  await page.waitForSelector('text=De onde é o documento?', { timeout: 5000 });
  await page.click('[role="dialog"] button:has-text("Geral — qualquer país")');
  await page.waitForSelector('input[placeholder*="Filtrar tipos"]', { timeout: 5000 });
  await page.click('[role="dialog"] button:has-text("Cartão de crédito")');
  await page.waitForSelector('text=Novo: Cartão de crédito', { timeout: 5000 });
  await page.fill('input[aria-label="Nome"]', 'Cartão principal');
  await page.locator('label:has-text("Nome no cartão") input').first().fill('Edgar A Mesquita');
  // A card prints a month, not a day — and its number is typed off the plastic,
  // so it must be legible while being typed (concealed in the detail, not here).
  await check('validade do cartão pede mês, não dia', async () =>
    (await page.locator('label:has-text("Válido até") input').first().getAttribute('type')) === 'month');
  await check('número do cartão é digitado à vista', async () =>
    (await page.locator('label:has-text("Número do cartão") input').first().getAttribute('type')) === 'text');
  await check('a senha do cartão continua oculta', async () =>
    (await page.locator('label:has-text("Senha (app") input').first().getAttribute('type')) === 'password');
  await check('bandeira do cartão tem lista de opções', async () => {
    await page.locator('label:has-text("Bandeira") input').first().click();
    await page.waitForSelector('[role="listbox"]', { timeout: 5000 });
    const options = await page.locator('[role="listbox"] [role="option"]').allTextContents();
    await page.keyboard.press('Escape');
    return options.includes('Visa') && options.includes('Elo');
  });
  await page.locator('label:has-text("Número do cartão") input').first().fill('4111111111111111');
  await page.locator('label:has-text("Válido até") input').first().fill(relativeDay(400).slice(0, 7));
  await page.locator('label:has-text("CVC") input').first().fill('123');
  await page.click('button[aria-label="Cor Roxo"]');
  await page.click('footer button:has-text("Salvar")');
  await page.waitForSelector('h2:has-text("Cartão principal")', { timeout: 5000 });

  await check('o detalhe desenha o cartão com a bandeira detectada', async () =>
    (await page.locator('[data-card-visual]').count()) === 1 &&
    (await page.locator('[data-card-visual] >> text=VISA').count()) >= 1 &&
    (await page.locator('[data-card-visual] >> text=1111').count()) >= 1);
  await check('o número completo não aparece no cartão', async () =>
    (await page.locator('[data-card-visual] >> text=4111 1111').count()) === 0);

  await page.click('[data-card-visual]');
  await page.waitForTimeout(600);
  await check('tocar no cartão vira para o verso', async () =>
    (await page.locator('[data-card-visual][data-flipped]').count()) === 1);
  await page.click('button[aria-label="Copiar CVC (segure para revelar)"]');
  await check('o CVC do verso copia com um toque', async () => {
    const text = await page.evaluate(() => navigator.clipboard.readText());
    return text === '123';
  });
  await page.click('[data-card-visual]');
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // 11c-bis. The family flow end to end: one entry in the list, the specific
  // form chosen inside the item — and the fields typed before the choice survive it.
  await page.locator('header button:has-text("Novo")').click();
  await page.waitForSelector('text=O que você quer guardar?', { timeout: 5000 });
  await page.click('[role="dialog"] button:has-text("Documento pessoal")');
  await page.waitForSelector('text=De onde é o documento?', { timeout: 5000 });
  await page.click('[role="dialog"] button:has-text("Geral — qualquer país")');
  await page.click('[role="dialog"] button:has-text("Declarações")');
  await page.waitForSelector('[data-select-trigger="Tipo de declaração"]', { timeout: 5000 });
  // Placeholders follow the subject: no "GitHub PAT" hint on a declaration.
  await check('o exemplo do nome acompanha o tipo escolhido', async () => {
    const generic = await page.locator('input[aria-label="Nome"]').getAttribute('placeholder');
    await chooseOption(page, 'Tipo de declaração', 'pt-irs');
    await page.waitForTimeout(150);
    const irs = await page.locator('input[aria-label="Nome"]').getAttribute('placeholder');
    await chooseOption(page, 'Tipo de declaração', 'declaracao');
    await page.waitForTimeout(150);
    return /declara/i.test(generic ?? '') && irs === 'IRS 2025' && !/GitHub/.test(generic ?? '');
  });
  await check('a família abre o formulário com o seletor de tipo', async () => {
    const options = await optionLabels(page, 'Tipo de declaração');
    return options.includes('Declaração de IRS') && options.includes('Declaração de nascido vivo');
  });
  // Esc dentro de um menu fechava o diálogo inteiro: o evento subia do portal
  // até o handler do modal. Desistir de escolher não pode custar o formulário.
  await check('Esc fecha o menu do seletor, não o diálogo', async () => {
    await page.locator('[data-select-trigger="Tipo de declaração"]').first().click();
    await page.locator('[role="listbox"]').last().waitFor({ state: 'visible', timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    return (
      (await page.locator('[role="listbox"]').count()) === 0 &&
      (await page.locator('[role="dialog"]').count()) === 1
    );
  });
  // Depois de clicar no gatilho o foco fica nele, e as setas não faziam nada.
  await check('o teclado escolhe sem tocar no rato', async () => {
    const before = await selectedValue(page, 'Tipo de declaração');
    await page.locator('[data-select-trigger="Tipo de declaração"]').first().click();
    await page.locator('[role="listbox"]').last().waitFor({ state: 'visible', timeout: 5000 });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[role="listbox"]', { state: 'detached', timeout: 5000 });
    return (await selectedValue(page, 'Tipo de declaração')) !== before;
  });
  await page.fill('input[aria-label="Nome"]', 'IRS 2025');
  await chooseOption(page, 'Tipo de declaração', 'pt-irs');
  await page.waitForTimeout(200);
  await check('escolher IRS troca os campos do formulário', async () =>
    (await page.locator('[role="dialog"] label:has-text("Ano fiscal")').count()) === 1 &&
    (await page.locator('[role="dialog"] label:has-text("Nº da declaração")').count()) === 1);
  await check('o nome já digitado sobrevive à troca de tipo', async () =>
    (await page.locator('input[aria-label="Nome"]').inputValue()) === 'IRS 2025');
  await page.locator('label:has-text("Ano fiscal") input').first().fill('2025');
  await page.click('footer button:has-text("Salvar")');
  await page.waitForSelector('h2:has-text("IRS 2025")', { timeout: 5000 });
  await check('o item guarda o tipo específico, não o genérico', async () =>
    (await page.locator('aside:has(h2) >> text=Declaração de IRS').count()) > 0 &&
    (await page.locator('aside:has(h2) >> text=2025').count()) > 0);
  await check('a barra lateral mostra a família como uma entrada só', async () => {
    const entries = await page.locator('nav button').filter({ hasText: /Declara/ }).allTextContents();
    return entries.length === 1 && /Declarações/.test(entries[0]);
  });
  await page.locator('nav button').filter({ hasText: /Declarações/ }).click();
  await page.waitForTimeout(300);
  await check('filtrar pela família lista as declarações', async () =>
    (await page.locator('main li:has-text("IRS 2025")').count()) === 1);
  await page.locator('nav button:has-text("Tudo")').first().click();
  await page.waitForTimeout(300);

  // 11c-ter. A generic document has no country of its own: the form asks,
  // and whatever is chosen flies the flag in the list.
  await page.locator('header button:has-text("Novo")').click();
  await page.waitForSelector('text=O que você quer guardar?', { timeout: 5000 });
  await page.click('[role="dialog"] button:has-text("Documento pessoal")');
  await page.click('[role="dialog"] button:has-text("Geral — qualquer país")');
  await page.click('[role="dialog"] button:has-text("Passaporte")');
  await page.waitForSelector('[data-select-trigger="País emissor"]', { timeout: 5000 });
  await check('documento geral abre sem país escolhido', async () =>
    (await selectedValue(page, 'País emissor')) === '');
  await check('o país emissor oferece o mundo todo, não só o catálogo', async () => {
    const options = await optionLabels(page, 'País emissor');
    return options.includes('Bélgica') && options.includes('Angola') && options.length > 200;
  });
  // Duzentas opções não se leem: uma lista longa ganha um filtro, e o filtro
  // ignora acentos, senão ninguém digita "Bélgica" com o teclado no meio.
  await check('uma lista longa ganha um filtro que ignora acentos', async () => {
    await page.locator('[data-select-trigger="País emissor"]').first().click();
    const menu = page.locator('[role="listbox"]').last();
    await menu.waitFor({ state: 'visible', timeout: 5000 });
    const filter = menu.locator('input[aria-label="Filtrar opções"]');
    if ((await filter.count()) !== 1) return false;
    await filter.fill('belg');
    await page.waitForTimeout(200);
    const shown = await menu.locator('[role="option"]').allInnerTexts();
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role="listbox"]', { state: 'detached', timeout: 5000 });
    return shown.length > 0 && shown.every((text) => /bélgica/i.test(text));
  });
  await page.fill('input[aria-label="Nome"]', 'Passaporte brasileiro');
  await chooseOption(page, 'País emissor', 'BR');
  await page.click('footer button:has-text("Salvar")');
  await page.waitForSelector('h2:has-text("Passaporte brasileiro")', { timeout: 5000 });
  await check('o detalhe mostra o país escolhido', async () =>
    (await page.locator('aside:has(h2) >> text=Brasil').count()) > 0);
  await check('a bandeira aparece na linha da lista', async () =>
    (await page
      .locator('main li:has-text("Passaporte brasileiro") svg[aria-label="Brasil"]')
      .count()) === 1);
  await check('a linha do documento português mostra a bandeira de Portugal', async () =>
    (await page
      .locator('main li:has-text("Título de residência — Maria") svg[aria-label="Portugal"]')
      .count()) === 1);
  await page.fill('input[type="search"]', 'brasil');
  await page.waitForTimeout(300);
  await check('busca pelo país encontra o passaporte', async () =>
    (await page.locator('main li:has-text("Passaporte brasileiro")').count()) === 1);
  await page.fill('input[type="search"]', '');
  await page.waitForTimeout(200);

  // 11c-bis-bis. The list carries the same filters as the sidebar, because on
  // a phone the sidebar is a drawer and on a desktop this is where the eye is.
  const total = await page.locator('main li').count();
  await check('a lista traz filtros de pessoa, país e tipo', async () =>
    (await page.locator('main [data-select-trigger="Pessoa"]').count()) === 1 &&
    (await page.locator('main [data-select-trigger="País"]').count()) === 1 &&
    (await page.locator('main [data-select-trigger="Tipo"]').count()) === 1);
  // The filter menu labels people by name; the value behind it is an id.
  await page.locator('main [data-select-trigger="Pessoa"]').first().click();
  await page
    .locator('[role="listbox"] [role="option"]')
    .filter({ hasText: 'Maria Teste' })
    .first()
    .click();
  await page.waitForSelector('[role="listbox"]', { state: 'detached', timeout: 5000 });
  await page.waitForTimeout(300);
  await check('filtrar por pessoa na lista reduz os itens', async () => {
    // Sob o filtro da pessoa a linha não repete o titular (ver 8c), então a
    // prova é o corte na contagem, com os documentos dela ainda presentes.
    const rows = await page.locator('main li').count();
    const hers = await page.locator('main li:has-text("Título de residência — Maria")').count();
    return rows > 0 && rows < total && hers === 1;
  });
  await check('a barra oferece limpar os filtros ativos', async () =>
    (await page.locator('main button:has-text("Limpar")').count()) === 1);
  await chooseOption(page, 'País', 'PT');
  await page.waitForTimeout(300);
  await check('país e pessoa se somam como filtros', async () =>
    (await page.locator('main li:has-text("Título de residência — Maria")').count()) === 1 &&
    (await page.locator('main li').count()) === 1);
  await page.click('main button:has-text("Limpar")');
  await page.waitForTimeout(300);
  await check('limpar devolve a lista inteira', async () =>
    (await selectedValue(page, 'Pessoa')) === '' &&
    (await page.locator('main li').count()) > 1);

  // 11c-quater. Filing by drag: a row dropped on a folder or a person in the
  // sidebar moves it there. Mouse only — touch keeps the swipe gesture.
  await page.locator('nav button:has-text("Tudo")').first().click();
  await page.waitForTimeout(200);
  // The gesture is driven with real DragEvents and a real DataTransfer: a
  // headless browser never runs its native drag loop, so Playwright's own
  // dragTo (and a hand-rolled mouse sequence) fire nothing here. This still
  // exercises the app's whole path — dragstart, dragover, drop, the write.
  const drag = (name, targetSelector) =>
    page.evaluate(
      ([itemName, selector]) => {
        const row = [...document.querySelectorAll('main li div[draggable="true"]')].find((node) =>
          node.textContent?.includes(itemName),
        );
        const target = document.querySelector(selector);
        if (!row || !target) return false;
        const dataTransfer = new DataTransfer();
        row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
        target.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer }));
        target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }));
        row.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
        return true;
      },
      [name, targetSelector],
    );

  const folderTarget = page.locator('nav [data-drop-target^="folder:"]').first();
  const folderName = ((await folderTarget.getAttribute('data-drop-target')) ?? '').replace('folder:', '');
  await check('a linha da lista é arrastável no desktop', async () =>
    (await page.locator('main li div[draggable="true"]').count()) > 0 && folderName.length > 0);
  await drag('IRS 2025', 'nav [data-drop-target^="folder:"]');
  await page.waitForTimeout(400);
  await check('arrastar a linha para a pasta arquiva o item', async () =>
    (await page.locator(`main li:has-text("IRS 2025") >> text=${folderName}`).count()) === 1);
  await drag('IRS 2025', 'nav [data-drop-target^="person:"]');
  await page.waitForTimeout(400);
  await check('arrastar a linha para a pessoa define o titular', async () =>
    (await page.locator('main li:has-text("IRS 2025") >> text=Maria Teste').count()) === 1);

  // 11d. Auto-lock "Nunca" must survive a reload: browsers discard idle tabs
  // and every app update reloads the page — none of that reads as "I locked
  // my vault", so none of it may cost the master password.
  await openSettings(page, 'Segurança');
  await page.waitForSelector('[data-select-trigger="Bloquear automaticamente"]', { timeout: 5000 });
  await chooseOption(page, 'Bloquear automaticamente', '0');
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=GitHub PAT', { timeout: 20000 });
  await check('com "Nunca", recarregar reabre sem pedir a senha', async () =>
    (await page.locator('text=Desbloquear cofre').count()) === 0);

  const storedDeadline = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          const req = indexedDB.open('keeper-keystore', 1);
          req.onsuccess = () => {
            const get = req.result.transaction('derived', 'readonly').objectStore('derived').get('v1');
            get.onsuccess = () => resolve(get.result ? { expiresAt: get.result.expiresAt ?? null } : 'vazio');
            get.onerror = () => resolve('erro');
          };
          req.onerror = () => resolve('erro');
        }),
    );
  await check('registro do "Nunca" fica sem prazo', async () => {
    const record = await storedDeadline();
    return typeof record === 'object' && record.expiresAt === null;
  });

  // A timed auto-lock persists too, stamped with the deadline: on phones every
  // app switch can reload the page, and a reload inside the inactivity window
  // must not demand the master password.
  await openSettings(page, 'Segurança');
  await page.waitForSelector('[data-select-trigger="Bloquear automaticamente"]', { timeout: 5000 });
  await chooseOption(page, 'Bloquear automaticamente', '15');
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await check('bloqueio por tempo guarda a chave com prazo futuro', async () => {
    const record = await storedDeadline();
    return typeof record === 'object' && typeof record.expiresAt === 'number' && record.expiresAt > Date.now();
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=GitHub PAT', { timeout: 20000 });
  await check('com 15 minutos, recarregar dentro da janela não pede a senha', async () =>
    (await page.locator('text=Desbloquear cofre').count()) === 0);

  // A deliberate lock is different: it deletes the record, and no reload
  // brings the vault back without the password.
  await page.locator('button[aria-label="Bloquear (Ctrl+L)"]').click();
  await page.waitForSelector('text=Desbloquear cofre', { timeout: 10000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Desbloquear cofre', { timeout: 10000 });
  await check('bloquear manualmente apaga a chave e volta a exigir a senha', async () => true);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button:has-text("Desbloquear")');
  await page.waitForSelector('text=GitHub PAT', { timeout: 20000 });

  // 12. Mobile: the same vault on a phone-sized, touch-first viewport. A fresh
  // page (fresh context) so the flow is seeded from scratch at 375px.
  const phone = await browser.newPage({
    viewport: { width: 375, height: 812 },
    hasTouch: true,
    isMobile: true,
    reducedMotion: 'reduce',
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
  await check('inputs têm ~48px de altura no celular', async () => {
    const height = await phone.locator('input[type="password"]').evaluate((el) => el.getBoundingClientRect().height);
    return height >= 46 && height <= 52;
  });

  await phone.fill('input[type="password"]', PASSWORD);
  await phone.click('button:has-text("Desbloquear")');
  await phone.waitForSelector('text=GitHub PAT', { timeout: 20000 });

  // Expiry must not be desktop garnish: the row badge survives 375px…
  await check('badge de validade aparece na linha também no celular', async () =>
    (await phone.locator('main li:has-text("expira em 25 dias")').count()) === 1);

  await check('linhas da lista têm ~64px no celular', async () => {
    const height = await phone.locator('main li > div').first().evaluate((el) => el.getBoundingClientRect().height);
    return height >= 62 && height <= 72;
  });

  // What the first real-phone run caught: a page panning sideways and the
  // command bar past the visible height. Guard the shell geometry directly.
  await check('documento não rola na horizontal no celular', async () =>
    phone.evaluate(() =>
      document.scrollingElement.scrollWidth <= document.scrollingElement.clientWidth));
  await check('shell ocupa exatamente a altura do viewport', async () =>
    phone.evaluate(() =>
      Math.abs(document.getElementById('root').getBoundingClientRect().height - window.innerHeight) <= 1));
  await check('barra inferior termina no fim do viewport', async () => {
    const delta = await phone.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Ações rápidas"]');
      return nav ? Math.abs(nav.getBoundingClientRect().bottom - window.innerHeight) : Infinity;
    });
    return delta <= 1;
  });
  // The + button pokes up above the bar, and every row in the list is
  // positioned (the swipe layers need it) — a positioned element paints over a
  // static one whatever the document order says. Needs a list long enough to
  // reach up there, which the test vault only manages on a shorter screen.
  await phone.setViewportSize({ width: 390, height: 560 });
  await phone.waitForTimeout(300);
  await check('o botão + fica acima da lista, não por baixo', async () =>
    phone.evaluate(() => {
      for (const element of [document.scrollingElement, ...document.querySelectorAll('main, main *')]) {
        if (element && element.scrollHeight > element.clientHeight + 4) element.scrollTop = element.scrollHeight;
      }
      const bar = document.querySelector('nav[aria-label="Ações rápidas"]');
      const plus = bar?.querySelector('button:has(span)');
      if (!bar || !plus) return false;
      const box = plus.getBoundingClientRect();
      const covered = [...document.querySelectorAll('main li')].some((row) => {
        const r = row.getBoundingClientRect();
        return r.bottom > box.top + 2 && r.top < box.top + 8 && r.right > box.left && r.left < box.right;
      });
      // No row up there means the test proves nothing, so it fails rather than
      // passing on empty space.
      if (!covered) return false;
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + 4);
      return !!hit && (plus === hit || plus.contains(hit));
    }));
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.waitForTimeout(300);

  await check('duplo toque não dispara zoom (touch-action)', async () =>
    (await phone.evaluate(() => getComputedStyle(document.body).touchAction)) === 'manipulation');

  // The settings sheet must fit the narrowest phones (320px: SE, Display
  // Zoom): a select wider than its row used to pan the whole sheet sideways.
  await phone.setViewportSize({ width: 320, height: 660 });
  await phone.click('nav[aria-label="Ações rápidas"] button:has-text("Ajustes")');
  await phone.waitForSelector('[role="dialog"]', { timeout: 5000 });
  await check('Configurações cabem sem rolagem lateral a 320px', async () =>
    phone.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const scroller = dialog.querySelector('.overflow-y-auto');
      // The pane has to fit, and the dialog itself must not pan sideways: the
      // list of panes scrolls on its own, inside its strip.
      return scroller.scrollWidth <= scroller.clientWidth && dialog.scrollWidth <= dialog.clientWidth;
    }));
  await phone.waitForTimeout(400);
  await phone.screenshot({ path: `${OUT}/17-mobile-config-320.png` });
  await phone.click('[role="dialog"] button[aria-label="Fechar"]');
  await phone.waitForTimeout(300);
  await phone.setViewportSize({ width: 390, height: 844 });

  // The thumb-reach bar carries the primary commands on phones — and the
  // header must not repeat them (a regression here squeezes the search box).
  await check('barra inferior traz os comandos principais', async () =>
    (await phone.locator('nav[aria-label="Ações rápidas"] button').count()) === 5);
  await check('header do celular não repete os comandos da barra', async () =>
    (await phone.locator('header button[aria-label="Gerador"]').filter({ visible: true }).count()) === 0 &&
    (await phone.locator('header button:has-text("Novo")').filter({ visible: true }).count()) === 0);
  await phone.click('nav[aria-label="Ações rápidas"] button:has-text("Favoritos")');
  await phone.waitForTimeout(300);
  await check('Favoritos na barra filtra a lista', async () => (await phone.locator('main li').count()) === 1);
  await phone.click('nav[aria-label="Ações rápidas"] button:has-text("Favoritos")');
  await phone.waitForTimeout(300);
  await check('tocar de novo em Favoritos desfaz o filtro', async () => (await phone.locator('main li').count()) === 7);
  await phone.click('nav[aria-label="Ações rápidas"] button:has-text("Novo")');
  await phone.waitForSelector('text=O que você quer guardar?', { timeout: 5000 });
  await check('Novo na barra abre o assistente em passos', async () => true);

  // Walk the document branch, then peel the steps back with the system gesture.
  await phone.click('[role="dialog"] button:has-text("Documento pessoal")');
  await phone.waitForSelector('text=De onde é o documento?', { timeout: 5000 });
  await phone.click('[role="dialog"] button:has-text("Portugal")');
  await phone.waitForSelector('input[placeholder*="Filtrar tipos"]', { timeout: 5000 });
  await phone.goBack();
  await phone.waitForSelector('text=De onde é o documento?', { timeout: 5000 });
  await check('voltar no assistente descasca um passo', async () => true);
  await phone.goBack();
  await phone.waitForSelector('text=O que você quer guardar?', { timeout: 5000 });
  await check('o segundo voltar chega ao primeiro passo', async () => true);

  // Pick a type for real; the next opening remembers it.
  await phone.click('[role="dialog"] button:has-text("Documento pessoal")');
  await phone.waitForSelector('text=De onde é o documento?', { timeout: 5000 });
  await phone.click('[role="dialog"] button:has-text("Portugal")');
  await phone.waitForSelector('input[placeholder*="Filtrar tipos"]', { timeout: 5000 });
  await phone.click('[role="dialog"] button:has-text("Cartão de Cidadão")');
  await phone.waitForSelector('[role="dialog"] >> text=Campos de Cartão de Cidadão', { timeout: 5000 });
  await phone.keyboard.press('Escape');
  await phone.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 5000 });
  await phone.click('nav[aria-label="Ações rápidas"] button:has-text("Novo")');
  await phone.waitForSelector('text=O que você quer guardar?', { timeout: 5000 });
  await check('o assistente lembra os usados recentemente', async () =>
    (await phone.locator('[role="dialog"] >> text=Usados recentemente').count()) === 1 &&
    (await phone.locator('[role="dialog"] button:has-text("Cartão de Cidadão")').count()) >= 1);
  await phone.keyboard.press('Escape');
  await phone.waitForSelector('text=O que você quer guardar?', { state: 'detached', timeout: 5000 });

  // 12b. Row swipes. Synthetic pointer events walk the same handlers a finger
  // would; the clipboard permission lets the Copiar action actually copy.
  await phone.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  // Rows are addressed by text: committing an action touches updatedAt and
  // the "Recentes" sort reorders the list under an index.
  const swipeRow = (name, fromX, toX) =>
    phone.evaluate(([needle, x0, x1]) => {
      const item = [...document.querySelectorAll('main li')].find((li) => li.textContent.includes(needle));
      const el = item.querySelector('[data-swipe-row]');
      const fire = (type, x) =>
        el.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerId: 9,
            pointerType: 'touch',
            isPrimary: true,
            clientX: x,
            clientY: 300,
          }),
        );
      fire('pointerdown', x0);
      for (let step = 1; step <= 6; step += 1) fire('pointermove', x0 + ((x1 - x0) * step) / 6);
      fire('pointerup', x1);
    }, [name, fromX, toX]);

  await swipeRow('GitHub PAT', 300, 200);
  await phone.waitForTimeout(300);
  await check('swipe à esquerda revela Copiar e Lixeira', async () =>
    (await phone.locator('main li button:has-text("Copiar")').filter({ visible: true }).count()) === 1 &&
    (await phone.locator('main li button:has-text("Lixeira")').filter({ visible: true }).count()) === 1);
  await phone.screenshot({ path: `${OUT}/16-mobile-swipe.png` });

  await phone.locator('main li button:has-text("Copiar")').click();
  await check('tocar em Copiar copia e avisa', async () => {
    await phone.getByText('Copiado para a área de transferência.').waitFor({ timeout: 5000 });
    return true;
  });

  await swipeRow('Azure', 60, 290); // full swipe right commits Favoritar
  await phone.waitForTimeout(350);
  await check('swipe completo à direita favorita a linha', async () =>
    (await phone.locator('main li:has-text("Azure") .text-warn').count()) === 1);
  await swipeRow('Azure', 60, 290);
  await phone.waitForTimeout(350);
  await check('repetir o gesto desfaz o favorito', async () =>
    (await phone.locator('main li:has-text("Azure") .text-warn').count()) === 0);

  // 12c. Pull to sync. This context has no Google account, so releasing the
  // pull must land on the local-only notice instead of a popup.
  await phone.evaluate(() => {
    const el = document.querySelector('[data-pull]');
    const mk = (y) => new Touch({ identifier: 3, target: el, clientX: 200, clientY: y });
    const fire = (type, y) =>
      el.dispatchEvent(
        new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          touches: [mk(y)],
          targetTouches: [mk(y)],
          changedTouches: [mk(y)],
        }),
      );
    fire('touchstart', 200);
    fire('touchmove', 260);
    fire('touchmove', 380);
  });
  await check('puxar arma o indicador de sincronização', async () =>
    (await phone.getByText('Solte para sincronizar com o Drive').count()) === 1);
  await phone.evaluate(() => {
    const el = document.querySelector('[data-pull]');
    const touch = new Touch({ identifier: 3, target: el, clientX: 200, clientY: 380 });
    el.dispatchEvent(
      new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], changedTouches: [touch] }),
    );
  });
  await check('soltar sem conta Google mostra o aviso local', async () => {
    await phone.getByText(/Sem conexão com o Drive — conecte/).waitFor({ timeout: 5000 });
    return true;
  });

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

  // Icon buttons: 40px visual on touch, topped up to ~48px by the ::after pad.
  await check('botões de ícone ganham área de toque no celular', async () =>
    (await phone.locator('button[aria-label="Menu"]').evaluate((el) => {
      const after = getComputedStyle(el, '::after');
      const box = el.getBoundingClientRect();
      return after.position === 'absolute' && after.top === '-4px' && box.height >= 40;
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
  // The sidebar is split in two halves with a divider between them; on a phone
  // it is a drawer, and both halves have to be reachable there too.
  await check('a gaveta traz as duas metades da barra lateral', async () =>
    (await phone.locator('[data-sidebar-scroll] >> visible=true').count()) === 1 &&
    (await phone.locator('[data-sidebar-folders] >> visible=true').count()) === 1 &&
    (await phone.locator('[data-sidebar-splitter] >> visible=true').count()) === 1);
  await phone.waitForTimeout(350);
  await phone.screenshot({ path: `${OUT}/18-mobile-gaveta.png` });
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

  // 13b. Bottom-sheet gestures and tap-to-copy on the detail.
  await phone.click('main li:has-text("Cartão de Cidadão — a renovar")');
  await phone.waitForSelector('aside footer button:has-text("Editar")', { timeout: 5000 });
  await phone.locator('aside:has(h2) >> text=12345678 9 ZZ1').click();
  await check('tocar no campo copia o valor', async () => {
    const text = await phone.evaluate(() => navigator.clipboard.readText());
    return text === '12345678 9 ZZ1';
  });

  await phone.click('aside footer button:has-text("Editar")');
  await phone.waitForSelector('[data-sheet-grabber]', { timeout: 5000 });
  await check('folha inferior tem pegador no celular', async () =>
    (await phone.locator('[data-sheet-grabber]').filter({ visible: true }).count()) === 1);

  const dragSheetDown = () =>
    phone.evaluate(() => {
      const el = document.querySelector('[data-sheet-handle]');
      const fire = (type, y) =>
        el.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 11,
            pointerType: 'touch',
            isPrimary: true,
            clientX: 200,
            clientY: y,
          }),
        );
      fire('pointerdown', 200);
      for (let step = 1; step <= 5; step += 1) fire('pointermove', 200 + step * 40);
      fire('pointerup', 400);
    });

  await dragSheetDown();
  await phone.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 5000 });
  await check('arrastar a folha para baixo fecha o editor', async () => true);

  // A dirty form asks first. Playwright dismisses dialogs by default, which
  // stands in for the user answering "não".
  await phone.click('aside footer button:has-text("Editar")');
  await phone.waitForSelector('[role="dialog"]', { timeout: 5000 });
  await phone.fill('input[aria-label="Nome"]', 'Cartão renomeado');
  await dragSheetDown();
  await phone.waitForTimeout(400);
  await check('formulário sujo pede confirmação antes de fechar', async () =>
    (await phone.locator('[role="dialog"]').count()) === 1);
  phone.once('dialog', (dialog) => void dialog.accept());
  await dragSheetDown();
  await phone.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 5000 });
  await check('confirmar descarta as alterações e fecha', async () => true);

  // 13c. Sharing: the system sheet gets exactly the ticked fields, in plain text.
  await phone.evaluate(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: (data) => {
        window.__keeperShared = data;
        return Promise.resolve();
      },
    });
  });
  await phone.click('aside button[aria-label="Compartilhar"]');
  await phone.waitForSelector('[role="dialog"] >> text=texto puro', { timeout: 5000 });
  await check('diálogo de compartilhar avisa do texto puro', async () => true);
  await phone.click('[role="dialog"] button:has-text("Compartilhar")');
  await check('a folha de compartilhamento recebe os campos escolhidos', async () => {
    const data = await phone.evaluate(() => window.__keeperShared);
    return !!data && data.text.includes('12345678 9 ZZ1') && data.title.includes('Cartão de Cidadão');
  });
  await phone.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 5000 });

  await phone.goBack();
  await phone.waitForTimeout(300);

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
    // The reload itself reopens without the password (persisted key).
    await phone.reload({ waitUntil: 'domcontentloaded' });
    await phone.waitForSelector('text=GitHub PAT', { timeout: 20000 });

    await phone.click('button[aria-label="Menu"]');
    await openSettings(phone, 'Segurança');
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
