/** Domain model: what a "secret" is, and the field schema of each kind. */

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
}

export interface SecretTypeDef {
  id: string;
  label: string;
  description: string;
  /** Key into the icon set (see components/icons.tsx). */
  icon: string;
  /** CSS color token used for the type badge. */
  accent: string;
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
  tags: string[];
  /** Values keyed by `FieldDef.id` of the item's type. */
  fields: Record<string, string>;
  customFields: CustomField[];
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  /** Tombstone: set when trashed so deletions propagate across devices. */
  deletedAt?: string;
}

export const SECRET_TYPES: SecretTypeDef[] = [
  {
    id: 'api-token',
    label: 'API Token',
    description: 'Tokens de acesso pessoal: GitHub PAT, GitLab, npm, Vercel, Slack…',
    icon: 'key',
    accent: '#7c9cff',
    fields: [
      { id: 'service', label: 'Serviço', kind: 'text', placeholder: 'GitHub' },
      { id: 'token', label: 'Token', kind: 'secret', placeholder: 'ghp_…' },
      { id: 'username', label: 'Usuário / dono', kind: 'username', placeholder: 'edgar' },
      { id: 'scopes', label: 'Escopos', kind: 'text', placeholder: 'repo, read:org, write:packages' },
      { id: 'expiresAt', label: 'Expira em', kind: 'date' },
      { id: 'url', label: 'URL do serviço', kind: 'url', placeholder: 'https://github.com/settings/tokens' },
    ],
  },
  {
    id: 'oauth-client',
    label: 'API Client / Secret',
    description: 'Aplicações OAuth e service principals: client id + client secret.',
    icon: 'app',
    accent: '#c084fc',
    fields: [
      { id: 'provider', label: 'Provedor', kind: 'text', placeholder: 'Azure AD / Google Cloud / Auth0' },
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
    label: 'Cloud / Provider',
    description: 'Chaves de acesso de AWS, Azure, DigitalOcean, GCP, Cloudflare…',
    icon: 'cloud',
    accent: '#fbbf24',
    fields: [
      { id: 'provider', label: 'Provedor', kind: 'text', placeholder: 'DigitalOcean' },
      { id: 'account', label: 'Conta / Subscription / Project', kind: 'text' },
      { id: 'accessKeyId', label: 'Access Key ID', kind: 'text' },
      { id: 'secretKey', label: 'Secret Access Key', kind: 'secret' },
      { id: 'region', label: 'Região', kind: 'text', placeholder: 'nyc3' },
      { id: 'endpoint', label: 'Endpoint', kind: 'url' },
    ],
  },
  {
    id: 'ssh',
    label: 'Chave SSH',
    description: 'Acesso remoto a servidores: chave privada, passphrase e host.',
    icon: 'terminal',
    accent: '#f472b6',
    fields: [
      { id: 'host', label: 'Host', kind: 'text', placeholder: 'deploy@10.0.0.12' },
      { id: 'port', label: 'Porta', kind: 'text', placeholder: '22' },
      { id: 'username', label: 'Usuário', kind: 'username', placeholder: 'root' },
      { id: 'privateKey', label: 'Chave privada', kind: 'multilineSecret', placeholder: '-----BEGIN OPENSSH PRIVATE KEY-----' },
      { id: 'passphrase', label: 'Passphrase', kind: 'secret' },
      { id: 'publicKey', label: 'Chave pública', kind: 'multiline', placeholder: 'ssh-ed25519 AAAA…' },
      { id: 'fingerprint', label: 'Fingerprint', kind: 'text' },
    ],
  },
  {
    id: 'database',
    label: 'Banco de dados',
    description: 'Strings de conexão e credenciais de bancos.',
    icon: 'database',
    accent: '#22d3ee',
    fields: [
      { id: 'engine', label: 'Engine', kind: 'text', placeholder: 'PostgreSQL' },
      { id: 'host', label: 'Host', kind: 'text' },
      { id: 'port', label: 'Porta', kind: 'text', placeholder: '5432' },
      { id: 'database', label: 'Database', kind: 'text' },
      { id: 'username', label: 'Usuário', kind: 'username' },
      { id: 'password', label: 'Senha', kind: 'password' },
      { id: 'connectionString', label: 'Connection string', kind: 'multilineSecret' },
    ],
  },
  {
    id: 'env',
    label: 'Variáveis / .env',
    description: 'Blocos inteiros de variáveis de ambiente por projeto.',
    icon: 'file',
    accent: '#a3e635',
    fields: [
      { id: 'project', label: 'Projeto', kind: 'text' },
      { id: 'environment', label: 'Ambiente', kind: 'text', placeholder: 'production' },
      { id: 'content', label: 'Conteúdo', kind: 'multilineSecret', placeholder: 'DATABASE_URL=…\nAPI_KEY=…' },
    ],
  },
  {
    id: 'certificate',
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
    label: 'Webhook',
    description: 'URLs de webhook e segredos de assinatura.',
    icon: 'link',
    accent: '#818cf8',
    fields: [
      { id: 'service', label: 'Serviço', kind: 'text', placeholder: 'Stripe' },
      { id: 'url', label: 'URL', kind: 'secret', placeholder: 'https://hooks.slack.com/services/…' },
      { id: 'signingSecret', label: 'Signing secret', kind: 'secret' },
      { id: 'events', label: 'Eventos', kind: 'text' },
    ],
  },
  {
    id: 'license',
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
    label: 'Nota segura',
    description: 'Qualquer anotação sensível em texto livre.',
    icon: 'note',
    accent: '#94a3b8',
    fields: [{ id: 'content', label: 'Conteúdo', kind: 'multilineSecret' }],
  },
];

const TYPE_INDEX = new Map(SECRET_TYPES.map((t) => [t.id, t]));

export const FALLBACK_TYPE: SecretTypeDef = {
  id: 'unknown',
  label: 'Outro',
  description: 'Tipo desconhecido (criado por uma versão mais nova do app).',
  icon: 'note',
  accent: '#94a3b8',
  fields: [],
};

export function getType(id: string): SecretTypeDef {
  return TYPE_INDEX.get(id) ?? { ...FALLBACK_TYPE, id };
}

export function isSecretKind(kind: FieldKind): boolean {
  return kind === 'secret' || kind === 'password' || kind === 'multilineSecret' || kind === 'totp';
}

export function isMultilineKind(kind: FieldKind): boolean {
  return kind === 'multiline' || kind === 'multilineSecret';
}

export function createItem(type: string): VaultItem {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    type,
    name: '',
    description: '',
    folder: '',
    tags: [],
    fields: {},
    customFields: [],
    favorite: false,
    createdAt: now,
    updatedAt: now,
  };
}
