import { describe, expect, it } from 'vitest';
import { DOCUMENT_ORIGINS, DOCUMENT_TYPES, GENERAL_GROUP } from './documents';
import { FALLBACK_TYPE, SECRET_TYPES, getType, isSecretKind } from './model';

// The wizard's origin step is the registry: a group outside it would be
// unreachable, so the whitelist derives from it instead of rotting apart.
const DOC_GROUPS = [GENERAL_GROUP, ...DOCUMENT_ORIGINS.map((origin) => origin.group)];

describe('catálogo de tipos', () => {
  it('não repete ids entre documentos e tipos de desenvolvimento', () => {
    const ids = SECRET_TYPES.map((type) => type.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('não repete ids de campo dentro de um mesmo tipo', () => {
    for (const type of SECRET_TYPES) {
      const ids = type.fields.map((field) => field.id);
      expect(new Set(ids).size, `campos duplicados em ${type.id}`).toBe(ids.length);
    }
  });

  it('classifica cada tipo em uma categoria e um grupo conhecidos', () => {
    for (const type of DOCUMENT_TYPES) {
      expect(type.category, type.id).toBe('doc');
      expect(DOC_GROUPS, type.id).toContain(type.group);
    }
    for (const type of SECRET_TYPES.filter((entry) => entry.category === 'dev')) {
      expect(type.group).toBe('Desenvolvimento');
    }
  });

  it('expõe os documentos pelo mesmo caminho dos demais tipos', () => {
    for (const type of DOCUMENT_TYPES) {
      expect(getType(type.id)).toBe(type);
    }
  });

  it('cai no tipo genérico quando o id é desconhecido', () => {
    // Um cofre gravado por uma versão mais nova não pode sumir da tela.
    expect(getType('tipo-que-ainda-nao-existe')).toMatchObject({
      label: FALLBACK_TYPE.label,
      category: FALLBACK_TYPE.category,
      fields: [],
    });
  });

  /**
   * Documentos são consultados, não rotacionados: marcá-los como segredo os
   * esconderia da busca e exigiria um clique para ler o próprio NIF. As
   * exceções são deliberadas — dados que CONCEDEM acesso em vez de apenas
   * identificar: o código de acesso da certidão online, o SSN americano e os
   * segredos do cartão de crédito (número, CVC, PIN e senha compram coisas).
   */
  it('só marca como segredo os dados de documento que concedem acesso', () => {
    const secret = DOCUMENT_TYPES.flatMap((type) =>
      type.fields.filter((field) => isSecretKind(field.kind)).map((field) => `${type.id}.${field.id}`),
    );
    expect(secret.sort()).toEqual([
      'cartao-credito.cvc',
      'cartao-credito.number',
      'cartao-credito.password',
      'cartao-credito.pin',
      'pt-certidao.codigoAcesso',
      'us-ssn.ssn',
    ]);
  });

  it('cobre os documentos de migração que motivaram a funcionalidade', () => {
    const ids = DOCUMENT_TYPES.map((type) => type.id);
    expect(ids).toEqual(
      expect.arrayContaining(['pt-residencia', 'pt-nif', 'br-cpf', 'br-certidao', 'passaporte']),
    );
  });

  it('dá validade ao título de residência, que é o que vence', () => {
    const residencia = getType('pt-residencia');
    expect(residencia.fields.map((field) => field.id)).toEqual(expect.arrayContaining(['issuedAt', 'expiresAt']));
    expect(residencia.fields.find((field) => field.id === 'expiresAt')?.kind).toBe('date');
  });
});
