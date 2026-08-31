import { describe, expect, it } from 'vitest';
import { MIN_ITERATIONS, generateContentKey } from './crypto';
import { createIdentity, inviteCode, rewrapShare, unwrapWithIdentity, type ShareRecord } from './invites';
import { grantAccess, readShares, removeAccess, unmatchedPermissions, writeShares } from './sharing';
import { createVault, emptyPayload, openVaultWithDataKey, sealVault } from './vault';
import type { DriveFileMeta, DrivePermission } from './drive';

const iterations = MIN_ITERATIONS;

/**
 * In-memory Drive: one JSON document store and one permission list, which is
 * all sharing touches. It can be told to fail on demand, because the order of
 * the two writes is the thing worth testing.
 */
class FakeDrive {
  files = new Map<string, { id: string; name: string; value: unknown }>();
  permissions: DrivePermission[] = [
    { id: 'p-owner', role: 'owner', type: 'user', emailAddress: 'dono@gmail.com' },
  ];
  failWrite = false;
  private next = 1;

  async readJson<T>(name: string, guard: (value: unknown) => value is T) {
    const found = [...this.files.values()].find((file) => file.name === name);
    if (!found) return null;
    if (!guard(found.value)) throw new Error('formato inesperado');
    return {
      meta: { id: found.id, name, modifiedTime: '2026-01-01T00:00:00Z' } as DriveFileMeta,
      value: found.value,
    };
  }

  async writeJson(name: string, value: unknown, fileId?: string): Promise<DriveFileMeta> {
    if (this.failWrite) throw new Error('o Drive recusou a escrita');
    const id = fileId ?? `f${this.next++}`;
    this.files.set(id, { id, name, value });
    return { id, name, modifiedTime: '2026-01-01T00:00:00Z' };
  }

  async shareFolder(_folderId: string, email: string, role: 'reader' | 'writer'): Promise<DrivePermission> {
    if (!email.includes('@')) throw new Error('conta inválida');
    const permission: DrivePermission = { id: `p${this.next++}`, role, type: 'user', emailAddress: email };
    this.permissions.push(permission);
    return permission;
  }

  async folderPermissions(): Promise<DrivePermission[]> {
    return this.permissions;
  }

  async revokePermission(_folderId: string, permissionId: string): Promise<void> {
    this.permissions = this.permissions.filter((permission) => permission.id !== permissionId);
  }

  granted(): string[] {
    return this.permissions.filter((p) => p.role !== 'owner').map((p) => p.emailAddress ?? '');
  }
}

async function ownerVault() {
  return createVault('senha-mestra-do-dono', emptyPayload(), iterations);
}

describe('dar acesso', () => {
  it('libera a pasta e publica a chave embrulhada', async () => {
    const drive = new FakeDrive();
    const { keys } = await ownerVault();
    const maria = await createIdentity();

    const record = await grantAccess(drive, 'pasta', keys.data, {
      code: await inviteCode(maria),
      label: 'Maria',
      email: 'maria@gmail.com',
      role: 'writer',
    });

    expect(drive.granted()).toEqual(['maria@gmail.com']);
    expect(record.role).toBe('writer');

    // E a chave publicada abre mesmo o cofre, no aparelho dela.
    const stored = await readShares(drive);
    expect(stored.file.shares).toHaveLength(1);
    const dataKey = await unwrapWithIdentity(stored.file.shares[0]!, maria);
    const sealed = await sealVault(keys, emptyPayload());
    await expect(openVaultWithDataKey(sealed, dataKey)).resolves.toBeDefined();
  });

  it('um código inválido não chega a tocar no Drive', async () => {
    const drive = new FakeDrive();
    const { keys } = await ownerVault();

    await expect(
      grantAccess(drive, 'pasta', keys.data, {
        code: 'bom dia',
        label: 'Maria',
        email: 'maria@gmail.com',
        role: 'reader',
      }),
    ).rejects.toThrow();

    expect(drive.granted()).toEqual([]);
    expect(drive.files.size).toBe(0);
  });

  it('uma conta recusada pelo Drive não deixa registo para trás', async () => {
    const drive = new FakeDrive();
    const { keys } = await ownerVault();
    const maria = await createIdentity();

    await expect(
      grantAccess(drive, 'pasta', keys.data, {
        code: await inviteCode(maria),
        label: 'Maria',
        email: 'isto-não-é-um-email',
        role: 'reader',
      }),
    ).rejects.toThrow();

    expect(drive.files.size).toBe(0);
  });

  it('se a chave não puder ser publicada, o acesso é devolvido', async () => {
    const drive = new FakeDrive();
    const { keys } = await ownerVault();
    const maria = await createIdentity();
    drive.failWrite = true;

    await expect(
      grantAccess(drive, 'pasta', keys.data, {
        code: await inviteCode(maria),
        label: 'Maria',
        email: 'maria@gmail.com',
        role: 'reader',
      }),
    ).rejects.toThrow();

    // O que não pode sobrar é uma pessoa com acesso à pasta e nome nenhum na
    // lista do dono.
    expect(drive.granted()).toEqual([]);
  });

  it('convidar a mesma pessoa de novo substitui o registo', async () => {
    const drive = new FakeDrive();
    const { keys } = await ownerVault();
    const maria = await createIdentity();
    const code = await inviteCode(maria);

    await grantAccess(drive, 'pasta', keys.data, { code, label: 'Maria', email: 'maria@gmail.com', role: 'reader' });
    await grantAccess(drive, 'pasta', keys.data, { code, label: 'Maria', email: 'maria@gmail.com', role: 'writer' });

    const stored = await readShares(drive);
    expect(stored.file.shares).toHaveLength(1);
    expect(stored.file.shares[0]!.role).toBe('writer');
  });
});

describe('tirar o acesso', () => {
  it('remove a permissão e diz quem fica', async () => {
    const drive = new FakeDrive();
    const { keys } = await ownerVault();
    const maria = await createIdentity();
    const joao = await createIdentity();

    const dela = await grantAccess(drive, 'pasta', keys.data, {
      code: await inviteCode(maria),
      label: 'Maria',
      email: 'maria@gmail.com',
      role: 'writer',
    });
    await grantAccess(drive, 'pasta', keys.data, {
      code: await inviteCode(joao),
      label: 'João',
      email: 'joao@gmail.com',
      role: 'reader',
    });

    const plan = await removeAccess(drive, 'pasta', dela.id);

    expect(plan.removed?.label).toBe('Maria');
    expect(plan.keep.map((record) => record.label)).toEqual(['João']);
    expect(drive.granted()).toEqual(['joao@gmail.com']);
  });

  it('quem fica continua a abrir o cofre depois da rotação', async () => {
    const drive = new FakeDrive();
    const { keys } = await ownerVault();
    const maria = await createIdentity();
    const joao = await createIdentity();

    const dela = await grantAccess(drive, 'pasta', keys.data, {
      code: await inviteCode(maria),
      label: 'Maria',
      email: 'maria@gmail.com',
      role: 'writer',
    });
    await grantAccess(drive, 'pasta', keys.data, {
      code: await inviteCode(joao),
      label: 'João',
      email: 'joao@gmail.com',
      role: 'reader',
    });

    // O que o keeper faz ao revogar: tira o acesso, roda a chave, reescreve os
    // registos de quem fica e sela o cofre de novo.
    const plan = await removeAccess(drive, 'pasta', dela.id);
    const rotated = await generateContentKey();
    await writeShares(
      drive,
      plan.stored,
      await Promise.all(plan.keep.map((record) => rewrapShare(record, rotated))),
    );
    const sealed = await sealVault({ derived: keys.derived, data: rotated }, emptyPayload());

    const stored = await readShares(drive);
    const dele = stored.file.shares.find((record) => record.label === 'João') as ShareRecord;
    await expect(openVaultWithDataKey(sealed, await unwrapWithIdentity(dele, joao))).resolves.toBeDefined();

    // E a chave que a Maria tinha guardado já não serve para nada.
    await expect(openVaultWithDataKey(sealed, await unwrapWithIdentity(dela, maria))).rejects.toThrow();
  });

  it('revogar alguém que já não está lá não estraga a lista', async () => {
    const drive = new FakeDrive();
    const { keys } = await ownerVault();
    const maria = await createIdentity();
    await grantAccess(drive, 'pasta', keys.data, {
      code: await inviteCode(maria),
      label: 'Maria',
      email: 'maria@gmail.com',
      role: 'reader',
    });

    const plan = await removeAccess(drive, 'pasta', 'um-id-que-não-existe');

    expect(plan.removed).toBeNull();
    expect(plan.keep).toHaveLength(1);
    expect(drive.granted()).toEqual(['maria@gmail.com']);
  });
});

describe('as duas metades desencontradas', () => {
  it('aponta quem tem a pasta mas não tem chave', async () => {
    const permissions: DrivePermission[] = [
      { id: 'p-owner', role: 'owner', type: 'user', emailAddress: 'dono@gmail.com' },
      { id: 'p1', role: 'reader', type: 'user', emailAddress: 'maria@gmail.com' },
      { id: 'p2', role: 'reader', type: 'user', emailAddress: 'estranho@gmail.com' },
    ];
    const shares = [{ email: 'MARIA@gmail.com' } as ShareRecord];

    const orphans = unmatchedPermissions(shares, permissions);

    // O dono nunca conta, e maiúsculas num e-mail não fazem de alguém estranho.
    expect(orphans.map((permission) => permission.emailAddress)).toEqual(['estranho@gmail.com']);
  });
});
