/** Domain model: what a "secret" is, and the field schema of each kind. */
import type { WrappedKey } from './crypto';
import { DOCUMENT_ORIGINS, DOCUMENT_TYPES, TYPE_FAMILIES, type TypeFamily } from './documents';

export type FieldKind =
  | 'text'
  | 'secret'
  | 'multiline'
  | 'multilineSecret'
  | 'url'
  | 'username'
  | 'password'
  | 'totp'
  | 'date';

export interface FieldDef {
  id: string;
  label: string;
  kind: FieldKind;
  placeholder?: string;
  hint?: string;
  /** Set on digits-only fields so phones open the numeric keypad. */
  numeric?: boolean;
  /**
   * Closed-ish list of values for this field. Rendered as an editable select:
   * the options are what people almost always type, and anything else can
   * still be typed — see ComboInput.
   */
  options?: string[];
}

export type TypeCategory = 'dev' | 'doc';

export interface SecretTypeDef {
  id: string;
  label: string;
  description: string;
  /** Splits the sidebar between developer secrets and personal documents. */
  category: TypeCategory;
  /** Sub-heading inside the category, e.g. "Portugal" or "Brasil". */
  group: string;
  /** Key into the icon set (see components/icons.tsx). */
  icon: string;
  /** CSS color token used for the type badge. */
  accent: string;
  /**
   * Example name for THIS kind of item — a declaration form must not suggest
   * "GitHub PAT". Falls back to the label when a type does not set one.
   */
  namePlaceholder?: string;
  /**
   * Family this type belongs to (see TYPE_FAMILIES): the list shows the family
   * once, and the form picks the member. Absent for types that stand alone.
   */
  family?: string;
  /**
   * Extra search terms for this type: the other country's name for the same
   * paper (holerite/recibo de vencimento, IPTU/IMI), the colloquial spelling
   * someone will actually type, the acronym. Never rendered — the point is
   * that the document is reachable by whatever the person calls it.
   */
  keywords?: string[];
  fields: FieldDef[];
}

export interface CustomField {
  id: string;
  label: string;
  value: string;
  secret: boolean;
}

export interface VaultItem {
  id: string;
  type: string;
  name: string;
  description: string;
  /** Free-form grouping, e.g. a client or project name. */
  folder: string;
  /** `Person.id` this document belongs to. Empty for items with no holder. */
  holderId: string;
  /**
   * Issuing country as a DOCUMENT_ORIGINS code ("PT", "BR"…). Country-specific
   * types fill it from their own group; the generic ones (a passport, a credit
   * card) start empty because only the person knows which country issued theirs.
   */
  country: string;
  tags: string[];
  /** Values keyed by `FieldDef.id` of the item's type. */
  fields: Record<string, string>;
  customFields: CustomField[];
  /** Scans and PDFs. The bytes live in Drive; only the key travels here. */
  attachments: AttachmentRef[];
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  /** Tombstone: set when trashed so deletions propagate across devices. */
  deletedAt?: string;
}

/**
 * One encrypted file. The vault carries the metadata and the wrapped content
 * key; the ciphertext itself is a separate file in the Drive app folder, so a
 * 4 MB scan never turns into a 4 MB re-upload of the whole vault on every edit.
 *
 * `driveFileId` is empty until the upload lands — a scan added offline is
 * usable straight away and gets pushed on the next sync.
 */
export interface AttachmentRef {
  id: string;
  name: string;
  mimeType: string;
  /** Plaintext size in bytes, for the UI. */
  size: number;
  /** AES-GCM key for the file content, encrypted with the master key. */
  wrapped: WrappedKey;
  /** base64 IV of the file content. */
  iv: string;
  driveFileId: string;
  addedAt: string;
}

type BaseTypeDef = Omit<SecretTypeDef, 'category' | 'group'>;

const DEV_TYPE_LIST: BaseTypeDef[] = [
  {
    id: 'api-token',
    namePlaceholder: 'GitHub PAT — CI eQuantic',
    label: 'API Token',
    description: 'Tokens de acesso pessoal: GitHub PAT, GitLab, npm, Vercel, Slack…',
    icon: 'key',
    accent: '#7c9cff',
    fields: [
      { id: 'service', label: 'Serviço', kind: 'text', placeholder: 'GitHub', options: ['GitHub', 'GitLab', 'Bitbucket', 'npm', 'PyPI', 'Docker Hub', 'Vercel', 'Netlify', 'Cloudflare', 'Slack', 'Stripe', 'OpenAI', 'Anthropic', 'Azure DevOps'] },
      { id: 'token', label: 'Token', kind: 'secret', placeholder: 'ghp_…' },
      { id: 'username', label: 'Usuário / dono', kind: 'username', placeholder: 'edgar' },
      { id: 'scopes', label: 'Escopos', kind: 'text', placeholder: 'repo, read:org, write:packages' },
      { id: 'expiresAt', label: 'Expira em', kind: 'date' },
      { id: 'url', label: 'URL do serviço', kind: 'url', placeholder: 'https://github.com/settings/tokens' },
    ],
  },
  {
    id: 'oauth-client',
    namePlaceholder: 'OAuth — app de faturação',
    label: 'API Client / Secret',
    description: 'Aplicações OAuth e service principals: client id + client secret.',
    icon: 'app',
    accent: '#c084fc',
    fields: [
      { id: 'provider', label: 'Provedor', kind: 'text', placeholder: 'Azure AD / Google Cloud / Auth0', options: ['Azure AD / Entra ID', 'Google Cloud', 'Auth0', 'Okta', 'Keycloak', 'AWS Cognito', 'GitHub OAuth', 'Apple'] },
      { id: 'clientId', label: 'Client ID', kind: 'text' },
      { id: 'clientSecret', label: 'Client Secret', kind: 'secret' },
      { id: 'tenantId', label: 'Tenant / Directory ID', kind: 'text' },
      { id: 'authUrl', label: 'Authorization URL', kind: 'url' },
      { id: 'tokenUrl', label: 'Token URL', kind: 'url' },
      { id: 'scopes', label: 'Escopos', kind: 'text' },
      { id: 'expiresAt', label: 'Secret expira em', kind: 'date' },
    ],
  },
  {
    id: 'login',
    namePlaceholder: 'Portal das Finanças — Maria',
    label: 'Usuário e senha',
    description: 'Acesso a painéis e serviços, com suporte a 2FA (TOTP).',
    icon: 'user',
    accent: '#34d399',
    fields: [
      { id: 'url', label: 'Endereço', kind: 'url', placeholder: 'https://portal.azure.com' },
      { id: 'username', label: 'Usuário', kind: 'username' },
      { id: 'password', label: 'Senha', kind: 'password' },
      { id: 'totp', label: 'Chave 2FA (TOTP)', kind: 'totp', hint: 'Cole o segredo base32 ou a URI otpauth://' },
      { id: 'recoveryCodes', label: 'Códigos de recuperação', kind: 'multilineSecret' },
    ],
  },
  {
    id: 'registry',
    namePlaceholder: 'Azure Container Registry — equantic',
    label: 'Container Registry',
    description: 'Azure CR, DigitalOcean, ECR, GHCR, Docker Hub, Harbor…',
    icon: 'container',
    accent: '#38bdf8',
    fields: [
      { id: 'registry', label: 'Registry', kind: 'text', placeholder: 'equantic.azurecr.io' },
      { id: 'username', label: 'Usuário', kind: 'username' },
      { id: 'password', label: 'Senha / token', kind: 'secret' },
      { id: 'namespace', label: 'Namespace / repositório', kind: 'text', placeholder: 'equantic/api' },
      { id: 'loginCommand', label: 'Comando de login', kind: 'multiline', placeholder: 'docker login equantic.azurecr.io -u <user> -p <token>' },
    ],
  },
  {
    id: 'cloud',
    namePlaceholder: 'AWS — conta de produção',
    label: 'Cloud / Provider',
    description: 'Chaves de acesso de AWS, Azure, DigitalOcean, GCP, Cloudflare…',
    icon: 'cloud',
    accent: '#fbbf24',
    fields: [
      { id: 'provider', label: 'Provedor', kind: 'text', placeholder: 'DigitalOcean', options: ['AWS', 'Azure', 'Google Cloud', 'DigitalOcean', 'Cloudflare', 'Vercel', 'Netlify', 'Hetzner', 'Linode', 'Oracle Cloud'] },
      { id: 'account', label: 'Conta / Subscription / Project', kind: 'text' },
      { id: 'accessKeyId', label: 'Access Key ID', kind: 'text' },
      { id: 'secretKey', label: 'Secret Access Key', kind: 'secret' },
      { id: 'region', label: 'Região', kind: 'text', placeholder: 'nyc3' },
      { id: 'endpoint', label: 'Endpoint', kind: 'url' },
    ],
  },
  {
    id: 'ssh',
    namePlaceholder: 'Chave SSH — servidor de deploy',
    label: 'Chave SSH',
    description: 'Acesso remoto a servidores: chave privada, passphrase e host.',
    icon: 'terminal',
    accent: '#f472b6',
    fields: [
      { id: 'host', label: 'Host', kind: 'text', placeholder: 'deploy@10.0.0.12' },
      { id: 'port', label: 'Porta', kind: 'text', placeholder: '22', numeric: true },
      { id: 'username', label: 'Usuário', kind: 'username', placeholder: 'root' },
      { id: 'privateKey', label: 'Chave privada', kind: 'multilineSecret', placeholder: '-----BEGIN OPENSSH PRIVATE KEY-----' },
      { id: 'passphrase', label: 'Passphrase', kind: 'secret' },
      { id: 'publicKey', label: 'Chave pública', kind: 'multiline', placeholder: 'ssh-ed25519 AAAA…' },
      { id: 'fingerprint', label: 'Fingerprint', kind: 'text' },
    ],
  },
  {
    id: 'database',
    namePlaceholder: 'Postgres — staging',
    label: 'Banco de dados',
    description: 'Strings de conexão e credenciais de bancos.',
    icon: 'database',
    accent: '#22d3ee',
    fields: [
      { id: 'engine', label: 'Engine', kind: 'text', placeholder: 'PostgreSQL', options: ['PostgreSQL', 'MySQL', 'MariaDB', 'MongoDB', 'Redis', 'SQL Server', 'SQLite', 'Oracle', 'Elasticsearch', 'ClickHouse', 'DynamoDB'] },
      { id: 'host', label: 'Host', kind: 'text' },
      { id: 'port', label: 'Porta', kind: 'text', placeholder: '5432', numeric: true },
      { id: 'database', label: 'Database', kind: 'text' },
      { id: 'username', label: 'Usuário', kind: 'username' },
      { id: 'password', label: 'Senha', kind: 'password' },
      { id: 'connectionString', label: 'Connection string', kind: 'multilineSecret' },
    ],
  },
  {
    id: 'env',
    namePlaceholder: '.env — API de checkout',
    label: 'Variáveis / .env',
    description: 'Blocos inteiros de variáveis de ambiente por projeto.',
    icon: 'file',
    accent: '#a3e635',
    fields: [
      { id: 'project', label: 'Projeto', kind: 'text' },
      { id: 'environment', label: 'Ambiente', kind: 'text', placeholder: 'production', options: ['production', 'staging', 'development', 'test', 'preview', 'local'] },
      { id: 'content', label: 'Conteúdo', kind: 'multilineSecret', placeholder: 'DATABASE_URL=…\nAPI_KEY=…' },
    ],
  },
  {
    id: 'certificate',
    namePlaceholder: 'Certificado TLS — equantic.tech',
    label: 'Certificado',
    description: 'Certificados TLS, chaves privadas e cadeias.',
    icon: 'shield',
    accent: '#fb923c',
    fields: [
      { id: 'domain', label: 'Domínio', kind: 'text', placeholder: '*.equantic.tech' },
      { id: 'certificate', label: 'Certificado', kind: 'multiline', placeholder: '-----BEGIN CERTIFICATE-----' },
      { id: 'privateKey', label: 'Chave privada', kind: 'multilineSecret' },
      { id: 'chain', label: 'Cadeia intermediária', kind: 'multiline' },
      { id: 'passphrase', label: 'Passphrase', kind: 'secret' },
      { id: 'expiresAt', label: 'Expira em', kind: 'date' },
    ],
  },
  {
    id: 'webhook',
    namePlaceholder: 'Webhook — Stripe',
    label: 'Webhook',
    description: 'URLs de webhook e segredos de assinatura.',
    icon: 'link',
    accent: '#818cf8',
    fields: [
      { id: 'service', label: 'Serviço', kind: 'text', placeholder: 'Stripe', options: ['Stripe', 'GitHub', 'GitLab', 'Slack', 'Twilio', 'SendGrid', 'Shopify', 'PayPal', 'Mailgun'] },
      { id: 'url', label: 'URL', kind: 'secret', placeholder: 'https://hooks.slack.com/services/…' },
      { id: 'signingSecret', label: 'Signing secret', kind: 'secret' },
      { id: 'events', label: 'Eventos', kind: 'text' },
    ],
  },
  {
    id: 'license',
    namePlaceholder: 'Licença — JetBrains',
    label: 'Licença',
    description: 'Chaves de licença de ferramentas e IDEs.',
    icon: 'badge',
    accent: '#f87171',
    fields: [
      { id: 'product', label: 'Produto', kind: 'text', placeholder: 'JetBrains All Products' },
      { id: 'licenseKey', label: 'Chave', kind: 'multilineSecret' },
      { id: 'email', label: 'E-mail da conta', kind: 'username' },
      { id: 'expiresAt', label: 'Expira em', kind: 'date' },
    ],
  },
  {
    id: 'note',
    namePlaceholder: 'Nota — recuperação da conta',
    label: 'Nota segura',
    description: 'Qualquer anotação sensível em texto livre.',
    icon: 'note',
    accent: '#94a3b8',
    fields: [{ id: 'content', label: 'Conteúdo', kind: 'multilineSecret' }],
  },
];

export const SECRET_TYPES: SecretTypeDef[] = [
  ...DEV_TYPE_LIST.map((type) => ({ ...type, category: 'dev' as const, group: 'Desenvolvimento' })),
  ...DOCUMENT_TYPES,
];

const TYPE_INDEX = new Map(SECRET_TYPES.map((t) => [t.id, t]));

/**
 * A user-defined type: it lives ENCRYPTED in the vault payload (see vault.ts,
 * format v5), merges across devices by id with tombstones, and joins an
 * existing category (its `group`) or founds a new one. The field palette is
 * the same `FieldKind` set the built-in types use — a field with id
 * `expiresAt` feeds the expiry alerts exactly like a built-in validity date.
 */
export interface CustomTypeDef {
  id: string;
  label: string;
  group: string;
  icon: string;
  accent: string;
  fields: FieldDef[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export function createCustomType(): CustomTypeDef {
  const now = new Date().toISOString();
  return {
    id: `custom-${crypto.randomUUID()}`,
    label: '',
    group: '',
    icon: 'file',
    accent: '#5b8cff',
    fields: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function toSecretTypeDef(custom: CustomTypeDef): SecretTypeDef {
  return {
    id: custom.id,
    label: custom.label,
    description: `Tipo personalizado · ${custom.fields.length} campo(s)`,
    category: custom.group === 'Desenvolvimento' ? 'dev' : 'doc',
    group: custom.group,
    icon: custom.icon,
    accent: custom.accent,
    fields: custom.fields,
  };
}

/**
 * Custom types resolve through the same lookups the built-ins use, so the
 * list, the detail and the wizard need no special cases. The keeper registers
 * the payload's live definitions on every payload change (unlock, edit, sync,
 * lock) — a module-level registry rather than threading a map through every
 * `getType` call site.
 */
let CUSTOM_INDEX = new Map<string, SecretTypeDef>();

export function registerCustomTypes(customs: CustomTypeDef[]): void {
  CUSTOM_INDEX = new Map(
    customs.filter((custom) => !custom.deletedAt).map((custom) => [custom.id, toSecretTypeDef(custom)]),
  );
}

/** Built-in types plus the registered custom ones, in that order. */
export function getAllTypes(): SecretTypeDef[] {
  return [...SECRET_TYPES, ...CUSTOM_INDEX.values()];
}

const FAMILY_INDEX = new Map(TYPE_FAMILIES.map((family) => [family.id, family]));

export function getFamily(id: string | undefined): TypeFamily | undefined {
  return id ? FAMILY_INDEX.get(id) : undefined;
}

/** Every type in the family, custom types included, in catalogue order. */
export function familyMembers(familyId: string): SecretTypeDef[] {
  return getAllTypes().filter((type) => type.family === familyId);
}

export const FALLBACK_TYPE: SecretTypeDef = {
  id: 'unknown',
  label: 'Outro',
  category: 'dev',
  group: 'Desenvolvimento',
  description: 'Tipo desconhecido (criado por uma versão mais nova do app).',
  icon: 'note',
  accent: '#94a3b8',
  fields: [],
};

export function getType(id: string): SecretTypeDef {
  return TYPE_INDEX.get(id) ?? CUSTOM_INDEX.get(id) ?? { ...FALLBACK_TYPE, id };
}

export function isSecretKind(kind: FieldKind): boolean {
  return kind === 'secret' || kind === 'password' || kind === 'multilineSecret' || kind === 'totp';
}

export function isMultilineKind(kind: FieldKind): boolean {
  return kind === 'multiline' || kind === 'multilineSecret';
}

/**
 * Whose document this is. Modelled as its own entity rather than a folder name
 * so "everything of Maria's" and "every residence permit" stay independent
 * questions, and so renaming a person does not orphan their documents.
 */
export interface Person {
  id: string;
  name: string;
  /** Free text: "esposa", "filho", "eu". */
  relation: string;
  birthDate: string;
  createdAt: string;
  updatedAt: string;
  /** Tombstone, so removing a person propagates instead of coming back. */
  deletedAt?: string;
}

/**
 * An explicitly created folder. Items reference folders by NAME (the string in
 * `item.folder`), so the name is the identity here; the record exists so a
 * folder can live in the sidebar before any item points at it. Tombstoned like
 * people, so removing one propagates instead of coming back.
 */
export interface Folder {
  name: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export function createFolder(name: string): Folder {
  const now = new Date().toISOString();
  return { name: name.trim(), createdAt: now, updatedAt: now };
}

export function createPerson(name: string, relation = ''): Person {
  return {
    id: crypto.randomUUID(),
    name: name.trim(),
    relation,
    birthDate: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** The country a type implies, if any: "pt-nif" is Portuguese by definition. */
export function countryForType(typeId: string): string {
  const group = getType(typeId).group;
  return DOCUMENT_ORIGINS.find((origin) => origin.group === group)?.code ?? '';
}

export function createItem(type: string): VaultItem {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    type,
    name: '',
    description: '',
    folder: '',
    holderId: '',
    country: countryForType(type),
    tags: [],
    fields: {},
    customFields: [],
    attachments: [],
    favorite: false,
    createdAt: now,
    updatedAt: now,
  };
}
