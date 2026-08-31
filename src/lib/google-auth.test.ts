import { describe, expect, it } from 'vitest';
import { GoogleAuth, GoogleAuthError } from './google-auth';

/**
 * The rule this file exists to keep: a request without a gesture never reaches
 * Google. Breaking it is how a phone ended up navigating away from the app and
 * landing on a blank OAuth callback — the token client always opens a window,
 * and a window with no click behind it is the browser's to redirect or refuse.
 */
describe('token sem gesto do utilizador', () => {
  it('falha na hora, sem tocar no Google', async () => {
    const auth = new GoogleAuth('cliente-de-teste.apps.googleusercontent.com');

    // Se chegasse ao GIS, isto explodiria por não haver `window` nenhum aqui.
    await expect(auth.requestToken(false)).rejects.toBeInstanceOf(GoogleAuthError);
    await expect(auth.requestToken(false)).rejects.toMatchObject({ code: 'needs_gesture' });
  });

  it('não se considera autenticado sem token', () => {
    expect(new GoogleAuth('cliente-de-teste').isSignedIn).toBe(false);
  });

  it('não reporta escopos que ninguém concedeu', () => {
    const auth = new GoogleAuth('cliente-de-teste');
    expect(auth.hasScope('https://www.googleapis.com/auth/drive.file')).toBe(false);
  });
});
