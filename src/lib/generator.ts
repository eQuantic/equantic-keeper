/** Password / passphrase generation with unbiased sampling. */

export interface PasswordOptions {
  length: number;
  lowercase: boolean;
  uppercase: boolean;
  digits: boolean;
  symbols: boolean;
  /** Drop 0/O/1/l/I and friends. */
  avoidAmbiguous: boolean;
}

export const DEFAULT_PASSWORD_OPTIONS: PasswordOptions = {
  length: 24,
  lowercase: true,
  uppercase: true,
  digits: true,
  symbols: true,
  avoidAmbiguous: false,
};

const SETS = {
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!#$%&*+-.:=?@^_~',
};
const AMBIGUOUS = new Set(['O', '0', 'o', 'I', 'l', '1', '|', '`', "'", '"', '.', ':', '-']);

/** Uniform index in [0, max) via rejection sampling — `% max` would bias. */
function randomIndex(max: number): number {
  const limit = Math.floor(0xffffffff / max) * max;
  const buffer = new Uint32Array(1);
  let value: number;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0]!;
  } while (value >= limit);
  return value % max;
}

export function buildAlphabet(options: PasswordOptions): string {
  let alphabet = '';
  if (options.lowercase) alphabet += SETS.lowercase;
  if (options.uppercase) alphabet += SETS.uppercase;
  if (options.digits) alphabet += SETS.digits;
  if (options.symbols) alphabet += SETS.symbols;
  if (options.avoidAmbiguous) alphabet = [...alphabet].filter((c) => !AMBIGUOUS.has(c)).join('');
  return alphabet;
}

export function generatePassword(options: PasswordOptions): string {
  const alphabet = buildAlphabet(options);
  if (!alphabet) throw new Error('Selecione ao menos um conjunto de caracteres.');
  const length = Math.max(4, Math.min(256, Math.floor(options.length)));
  return Array.from({ length }, () => alphabet[randomIndex(alphabet.length)]).join('');
}

export const WORDS = [
  'ancora','arvore','aviao','bambu','banco','barco','bicho','bloco','bolha','bonde','bravo','brisa',
  'bruma','cacto','cafe','calma','campo','canal','canoa','carga','carta','casco','cedro','ceifa',
  'chama','chave','chuva','cinza','circo','clima','cobre','coral','corda','couro','cravo','curva',
  'dardo','denso','dique','disco','ducha','duelo','eixos','elmo','enxame','estufa','fagote','faixa',
  'farol','fenda','ferro','festa','fibra','flora','folha','forja','forte','fosco','fresta','fruta',
  'fungo','fusca','gaita','galho','ganso','garra','gelo','gesso','globo','grade','grao','greta',
  'grito','grupo','helio','hidra','horta','humus','icone','igloo','ilhas','indigo','janta','jarra',
  'jaula','joia','junco','lagoa','lapis','larva','laser','lastro','leque','limbo','linho','lira',
  'lodo','lombo','lonas','lousa','lupa','macio','malha','mango','manto','marfim','massa','mastro',
  'melao','mesa','metro','micro','minas','moeda','molho','monte','morro','mudas','nabos','naipe',
  'nervo','nevoa','ninho','nobre','norte','nuvem','oasis','obelisco','ombro','onda','opala','orbita',
  'ostra','ouro','ovelha','palco','panda','papel','pasta','pauta','pedra','pente','perfil','pilar',
  'pinho','placa','pluma','ponte','porto','pomar','prato','praia','prisma','prumo','pulso','quadro',
  'quartzo','quilha','ramal','rampa','ranho','recife','regua','relvo','remo','ritmo','rocha','rolha',
  'rosca','rotor','rugby','ruivo','sabia','safira','salmo','samba','selva','serra','signo','silo',
  'sirene','sisal','solar','sombra','sonda','tabua','talho','tapiz','tecla','telha','tenda','terra',
  'timao','tinta','tocha','torre','trama','trigo','tubo','tulipa','turbo','umbral','urso','vagao',
  'valsa','vapor','vela','verbo','vidro','vinha','viola','vulto','xadrez','zebra','zenite','zinco',
];

export interface PassphraseOptions {
  words: number;
  separator: string;
  capitalize: boolean;
  appendNumber: boolean;
}

export const DEFAULT_PASSPHRASE_OPTIONS: PassphraseOptions = {
  words: 5,
  separator: '-',
  capitalize: false,
  appendNumber: true,
};

export function generatePassphrase(options: PassphraseOptions): string {
  const count = Math.max(3, Math.min(16, Math.floor(options.words)));
  const parts = Array.from({ length: count }, () => {
    const word = WORDS[randomIndex(WORDS.length)]!;
    return options.capitalize ? word[0]!.toUpperCase() + word.slice(1) : word;
  });
  if (options.appendNumber) parts.push(String(randomIndex(9000) + 1000));
  return parts.join(options.separator);
}

/** Shannon entropy of the generator itself (not of a user-typed string). */
export function passwordEntropyBits(options: PasswordOptions): number {
  const alphabet = buildAlphabet(options);
  if (!alphabet) return 0;
  return Math.round(options.length * Math.log2(alphabet.length));
}

export function passphraseEntropyBits(options: PassphraseOptions): number {
  const base = options.words * Math.log2(WORDS.length);
  return Math.round(base + (options.appendNumber ? Math.log2(9000) : 0));
}

/**
 * Rough strength estimate for a password the user typed. Deliberately
 * conservative: counts the character classes actually present and penalises
 * repetition and dictionary-ish sequences.
 */
export function estimateStrength(value: string): { bits: number; label: string; score: 0 | 1 | 2 | 3 | 4 } {
  if (!value) return { bits: 0, label: 'vazia', score: 0 };
  let pool = 0;
  if (/[a-z]/.test(value)) pool += 26;
  if (/[A-Z]/.test(value)) pool += 26;
  if (/[0-9]/.test(value)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(value)) pool += 33;

  const unique = new Set(value).size;
  const repetitionPenalty = unique / value.length;
  const sequences = /(.)\1{2,}|abc|123|qwer|senha|password|admin/i.test(value) ? 0.75 : 1;
  const bits = Math.round(value.length * Math.log2(Math.max(pool, 2)) * repetitionPenalty * sequences);

  const score = bits < 40 ? 0 : bits < 60 ? 1 : bits < 80 ? 2 : bits < 110 ? 3 : 4;
  const label = ['muito fraca', 'fraca', 'razoável', 'forte', 'excelente'][score]!;
  return { bits, label, score: score as 0 | 1 | 2 | 3 | 4 };
}
