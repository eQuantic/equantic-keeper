# eQuantic Keeper

A vault for the things you look up all the time: development secrets — API tokens,
client id/secret pairs, dashboard logins, container registry credentials, SSH keys,
`.env` files, certificates — and personal documents from Portugal and Brazil, yours and
your household's: residence permits, Cartão de Cidadão, NIF, NISS, CPF, RG, certificates,
passports.

It is a **100% static** application, hosted on **GitHub Pages**, that signs in with your
**Google account** and stores a single **encrypted** file in the hidden app folder of your
**Google Drive**. There is no server, no database, no backend: all cryptography happens
in your browser.

**Official instance: [keeper.equantic.tech](https://keeper.equantic.tech)**

---

## How it works

```
 you type the master password
          │
          ▼
  PBKDF2-SHA256 (720k iterations)  ──► HKDF ──┬──► AES-GCM-256 key  ──► encrypts the vault
                                              └──► verifier (public)
          │
          ▼
   { public header + ciphertext }  ──►  Google Drive (app folder, or your own)
                                   ──►  localStorage (offline cache)
```

Google receives **encrypted bytes only**. The master password never leaves the browser,
is never transmitted, never stored, and cannot be recovered.

### Security model

| Item | Decision |
| --- | --- |
| Key derivation | PBKDF2-SHA256, 720,000 iterations (floor of 210,000), random 16-byte salt |
| Key separation | HKDF-SHA256 splits the material into an encryption key and a verifier |
| Cipher | AES-GCM-256 with a fresh 12-byte IV on every write and a 128-bit tag |
| Header integrity | The public header is fed in as *additional authenticated data* — tampering with it invalidates the tag |
| Key at rest | Non-extractable `CryptoKey`, wiped on manual lock and when the auto-lock window ends. While the window is open (or forever, with auto-lock "Never") a non-extractable copy sits in IndexedDB stamped with the deadline, so tab discards, app updates and reloads reopen the vault without the password; boot deletes an expired record and asks for the password again |
| Biometric unlock (optional) | Master bits AES-GCM-wrapped under a key derived from a platform passkey's WebAuthn PRF output — per device, gated by Face ID / fingerprint / device PIN, invalidated by a password change |
| Google scope | `drive.appdata` (the app's own hidden folder) + email/profile. `drive.file` — files this app created or that the user picked, and nothing else — is asked for only if you move the vault into a folder of your own, or open one shared with you |
| Sharing | The vault's data key wrapped to a recipient's ECDH public key (ephemeral ECDH + HKDF + AES-GCM). The invite code carries no secret; revoking rotates the data key so a kept copy dies |
| OAuth token | Short-lived access token, held in memory only |
| Clipboard | Automatic clearing (default: 30s) after copying a secret; a wipe that came due while the app was in the background runs as soon as it is visible again — a background tab cannot touch the clipboard |
| CSP | `default-src 'none'` with a minimal allow-list; no inline scripts; iframe blocked |
| Search | Never indexes secret values — only name, description, tags and non-sensitive fields |
| Sharing | Explicit per-field dialog, out through the OS share sheet or `mailto:` only — never an https link carrying the secret (that would park it in browser history); TOTP seeds are never shareable |

**What this model does not protect against:** a compromised device (keylogger, malware,
malicious extension) sees the open vault the same way you do. And if you forget the master
password, the data is unrecoverable — by construction.

### Where the vault lives

By default everything sits in Drive's `appDataFolder`: a per-app folder you never see,
under the narrowest scope Drive offers. It is also the one place in Drive that **cannot be
shared** — Google will not give another account access to it, by design.

*Configurações → Onde o cofre fica* moves the vault into a normal folder named
**eQuantic Keeper** in your My Drive, asking for `drive.file` at that moment and not
before. Nothing is destroyed: the files are copied, the app folder keeps its copy, and an
interrupted move leaves a working vault on both sides — running it again picks up where it
stopped. A second run of *Apagar a cópia antiga* deletes the old copy, but only after
checking file by file that everything reached the new folder.

A device that has not been granted the wider permission cannot even see the new folder, so
the move leaves a marker file behind in the app folder. Any device still syncing the old
way reads it and says so, instead of quietly drifting away from the vault everyone else is
using.

### Sharing a vault

Two things have to line up, and they are deliberately separate.

**The Drive permission** decides who can download the bytes. The owner adds the
other person's Google account to the folder — which is why the vault has to leave
`appDataFolder` first, since Drive refuses to share anything kept there.

**The key** decides who can read them. The guest's device generates an ECDH
keypair and shows the public half as an **invite code**; nothing secret travels,
so the code can go by WhatsApp or be read out loud. The owner pastes it, and the
vault's data key is wrapped to that public key and published as a share record
beside the vault. Only the private key that never left the guest's device opens
it, and the owner's master password is never involved on either side.

**Revoking** removes the permission *and* rotates the vault's data key:
attachments move onto the new one and everyone who stays gets their record
rewritten around it, so a copy the removed person kept stops opening.

The guest's app reaches the folder through the Google Picker — under
`drive.file` it can see only what its user pointed at. Guest access is read-only
for now.

### Biometric unlock

Typing a long passphrase on a phone keyboard several times a day is what pushes people
toward short passwords, so the phone's own unlock can stand in for it. Enabling it (in
*Configurações → Segurança*, once per device) creates a platform passkey and evaluates its
**WebAuthn PRF extension**; the PRF output derives — through HKDF — an AES-GCM key that
wraps the vault's master bits into a record kept in `localStorage`.

- The record is ciphertext plus public parameters. Opening it requires the passkey's PRF
  output, which the authenticator only releases after user verification (Face ID,
  fingerprint, device PIN) — the record alone, or the storage alone, opens nothing.
- The record pins the vault's KDF salt, so **changing the master password invalidates it**;
  the app deletes it and asks you to re-enable. Wiping the device data removes it too.
- The master password remains the canonical key on every device; biometrics never replace
  it, and the vault file itself is unchanged.
- Requires a browser with WebAuthn PRF support (Safari on iOS 18+, Chrome/Android, and
  desktop Chrome with a platform authenticator, among others). Where unsupported, the
  option simply does not appear.

---

## Features

- **12 secret types** with purpose-built fields: API Token, API Client/Secret, Username and
  password, Container Registry, Cloud/Provider, SSH Key, Database, Variables/`.env`,
  Certificate, Webhook, License and Secure note — plus custom fields on any item.
- **46 personal document types**, each with the fields that document actually has:
  - *Portugal*: residence permit (per issuance, with issuing entity, process number and
    validity), Cartão de Cidadão, NIF, NISS, health service number, criminal record,
    proof of address, lease agreement, driving licence and civil-registry certificate
    (with the online access code kept as a secret).
  - *Brazil*: CPF, RG, CNH, voter registration, civil registry certificates (birth,
    marriage, death — with matrícula, registry office, book/page/term and apostille),
    criminal background check and CTPS.
  - *Spain, United States, France, Germany, Italy, United Kingdom*: the national ID,
    residence permit, social-security/tax number and driving licence of each — DNI,
    NIE/TIE, SSN (kept as a secret), Green Card, Titre de Séjour, Personalausweis,
    Steuer-ID, Codice Fiscale, NI Number, BRP/eVisa…
  - *General*: passport, visa, diploma, vaccination card, health insurance, **credit/debit
    card** (holder, number, CVC, PIN and purchase password concealed — with the numeric
    keypad — and the expiry wired to the alerts; the detail draws the card itself: tap to
    flip to the back where the CVC copies with a tap, the network wordmark is detected
    offline from the number prefix, and the face color is customizable per card) and a
    generic type.
- **Holders**: every item can belong to a person (you, your spouse, your children). The
  sidebar filters by person and search finds a document by the person's name, which is not
  stored on the item. Removing a person never deletes their documents — they just lose
  their holder.
- **Expiry alerts**: the vault knows the difference between the date a document was *issued*
  and the date it *expires*. The sidebar separates what has already expired from what is
  about to, the list shows "expires in 25 days" on the row, and the warning window is
  configurable (default: 60 days — renewing a residence permit takes months).
- **Encrypted attachments** (PDF, JPG, PNG, WebP, up to 25 MB each) with a **built-in
  viewer**: pdf.js renders the document inside the app, with zoom and text selection,
  instead of opening a tab with the decrypted bytes. Every file has its own key, wrapped by
  the master key, and lives as a separate object in the app folder — changing the master
  password re-encrypts the vault, not the archive. An attachment added while offline stays
  on the device and uploads on the next sync.
- **2FA codes (TOTP)** generated inside the vault, from a base32 secret or an
  `otpauth://` URI (RFC 6238, SHA-1/256/512).
- **Password and passphrase generator** using `crypto.getRandomValues` with bias-free
  sampling.
- **Custom types**: build your own form in the new-item wizard — name, an existing
  category (or a new one), color, icon and the fields, from the same palette the built-in
  types use; a field named "Data de validade" feeds the expiry alerts. Definitions travel
  encrypted in the vault, sync to every device with tombstoned merging, and are managed
  (edit/remove) in Settings; items of a removed type stay readable.
- **Sharing, on purpose**: a per-field dialog sends an item out through the phone's share
  sheet (WhatsApp, Gmail, Signal — as text, or an attachment as the decrypted file) and
  falls back to `mailto:`/clipboard on desktop. Secret fields start unticked, TOTP seeds
  are never offered, and the dialog says plainly that whatever leaves, leaves in plain
  text.
- **Biometric unlock** (optional, per device): a platform passkey with the WebAuthn PRF
  extension stands in for the master passphrase — Face ID or a fingerprint instead of
  retyping it on a phone keyboard. The passphrase remains the canonical key.
- **Multi-device sync** with item-by-item merging (most recent wins) and *tombstones*, so
  deletions propagate instead of resurrecting.
- **Backups**: rotating daily snapshots in Drive itself, encrypted `.keeper.json` export,
  a **`.keeper.zip` bundle with the vault and the attachments**, import with merging
  (accepts both formats) and plain-text export (no lock-in).
- **Offline PWA**: installable, with the encrypted vault cached — you can look up secrets
  with no network.
- Instant search, folders, tags, favorites, trash, light/dark theme.
- **Keyboard-first on desktop**: `Ctrl+K` search, `Ctrl+L` lock, `J`/`K` or the arrows walk
  the list, `C` copies the selected item's main secret, `E` edits, `F` favorites, `N` creates,
  `G` opens the generator and `?` shows the cheat sheet — single-key shortcuts stay inactive
  while a text field is focused.
- **Touch-first on phones**: 48px controls, a thumb-reach bottom command bar, swipe a row
  for copy/favorite/trash, pull the list down to sync, bottom sheets with a drag handle,
  tap a detail field to copy it (hold to reveal) — and the system back gesture closes the
  open panel, sheet or drawer instead of leaving the app.

---

## Publishing your own instance

### 1. Create the OAuth credential on Google

1. Open the [Google Cloud Console](https://console.cloud.google.com/apis/credentials) and create a project.
2. Enable the **Google Drive API** (*APIs & Services → Library*).
3. Configure the **OAuth consent screen** (type *External*). While the app is in
   *Testing*, add the accounts that will use it under *Test users* — anyone not on the
   list gets `Error 403: access_denied`.
4. Under **Data access**, add the scope `https://www.googleapis.com/auth/drive.appdata`.
   If it is not declared there, Google grants only email/profile and the app refuses the
   login. Add `https://www.googleapis.com/auth/drive.file` as well if you want to move the
   vault into a folder of your own (which is what makes sharing possible later) — the app
   never asks for it at sign-in, only when you press the button, and it falls back to the
   app folder if the scope is missing.
5. To let someone open a vault **shared with them**, also enable the **Google
   Picker API** (*APIs & Services → Library*) and create an **API key** under
   *Credentials*. Under `drive.file` a guest's browser can only reach files they
   pointed at through that picker, so without the key the guest side does
   nothing; everything else works without it.

   > If the key is restricted (and it should be), the restrictions have to cover
   > **both** halves: the origin under *Website restrictions*, and **Google
   > Picker API** in the list under *API restrictions*. A key restricted to the
   > Drive API alone makes the picker refuse with **"The API developer key is
   > invalid"** — the key is fine, the picker is simply not on its list.
6. Under *Credentials*, create an **OAuth client ID** of type **Web application**.
7. Under **Authorized JavaScript origins**, add the exact origin where the app runs — no
   trailing slash and no path. For the official instance: `https://keeper.equantic.tech`;
   on a fork without a custom domain, `https://<username>.github.io`. No redirect URI is
   needed: the flow uses Google Identity Services in a popup.

   > If the origin does not exactly match the address bar, Google's popup refuses with
   > `origin_mismatch` — the most common error in this setup.
8. Copy the **Client ID** (something like `1234567890-abc.apps.googleusercontent.com`).
   It is a **public** identifier, not a secret.

> At sign-in the only Drive scope requested is `drive.appdata`. Google presents it as "See
> and manage its own configuration data in your Google Drive" — the app cannot see any of
> your other files. `drive.file`, if you enable the folder, adds exactly the files this app
> creates: still nothing else in your Drive.

#### Common login problems

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Error 403: access_denied`, "has not completed the verification process" | The consent screen is in *Testing* and the account is not a tester | Add the account under *Audience → Test users*, or publish the app |
| "Access to the app's Drive folder was not granted" | The scope is not under *Data access*, or the permission checkbox was left unchecked on Google's screen | Declare the scope and, when signing in again, tick the Drive permission |
| `origin_mismatch` in the popup | The origin does not exactly match the address bar | Register the origin without a trailing slash and without a path |

> The permissions show up as **checkboxes that start unchecked**. Clicking "Continue"
> without ticking the Drive one grants identity only, and the app refuses the login instead
> of creating a vault it could never sync.

**Is publishing worth it?** Every scope used here — `drive.appdata`, `drive.file`,
`userinfo.email` and `userinfo.profile` — is classified by Google as *non-sensitive*, which
only requires basic verification. Publishing (*Audience → Publish app*) removes the 100-tester cap and the
expiring test authorization that forces a fresh interactive consent whenever silent renewal
fails.

### 2. Configure the repository

1. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. **Settings → Secrets and variables → Actions → Variables → New repository variable**:
   - Name: `GOOGLE_OAUTH_CLIENT_ID`
   - Value: the client id from the previous step.
   - And, for the guest side, `GOOGLE_PICKER_API_KEY` with the API key.

Neither is a secret. If you prefer not to bake them into the build, leave the variables
empty: the app asks for the client id on first run and keeps both in that browser's
`localStorage` (*Configurações → Avançado*).

### 3. Deploy

Under *Settings → Pages → Build and deployment*, choose **Source: GitHub Actions**. This
is not a detail: with *Deploy from a branch*, GitHub runs its own Jekyll build of the
repository root **in parallel** with this project's workflow, and both publish to the same
site. Whoever finishes last wins — and when it is Jekyll, what goes live is the source
code, with an `index.html` that points at `/src/main.tsx` and does not run in a browser.

> Symptom of the wrong source: `curl https://YOUR-DOMAIN/README.md` answers 200, and
> `/manifest.webmanifest` answers 404. A correct deploy is the other way around. A
> *service worker* that is already installed keeps serving the previous version of the
> app, so the problem tends to show up first for whoever opens the site for the first time.

Once that is set, a push to `main` triggers `.github/workflows/deploy.yml`, which runs
typecheck + tests, builds and publishes to Pages. Vite's `base` is resolved automatically
(`/equantic-keeper/` on a project page, `/` on a custom domain).

**Custom domain:** configure it under *Settings → Pages → Custom domain*. GitHub writes
the value to a `CNAME` file at the repository root, and the build copies that file into
`dist/` — so the published artifact carries the same domain, without a second copy in
`public/` that could go stale if the domain ever changed.

---

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (crypto, vault, sync, TOTP, generator, search, documents)
npm run typecheck
npm run build      # typecheck + production build in dist/
npm run icons      # regenerates the PWA icons
npm run smoke      # in-browser integration test (after npm run build)
```

`npm run smoke` starts `vite preview`, seeds a vault encrypted by an independent
implementation of the file format and walks the app with Playwright across two viewports.
The desktop pass covers first-run setup, wrong password, unlock, search, revealing a
secret, TOTP, item and document creation with a holder, encrypted attachments opened in
the PDF viewer, expiry alerts, the backup bundle round-trip, the keyboard shortcuts
(including the typing guard and the `?` cheat sheet), theme and lock. The phone-sized,
touch-first pass (375×812) covers the 16px/48px control metrics, the bottom command bar,
expiry chips, row swipes with their commit thresholds, pull-to-sync, bottom-sheet gestures
with the dirty-form confirmation, tap-to-copy on detail fields, system back navigation,
and biometric unlock through a virtual PRF authenticator. The seeded vault is a **v1**
file, so the migration to v2 is exercised in a real browser as well. Playwright installs
with the dev dependencies; the browser itself is a one-time
`npx playwright install chromium`.

To test Google sign-in locally, add `http://localhost:5173` to the credential's
*Authorized JavaScript origins*. Without it the app still works: create the vault, use it
offline and connect Drive later.

### Structure

```
src/lib/       crypto · vault · sync · drive · google-auth · totp · generator · search · storage
               model (secret types) · documents (personal document types)
               attachments (key envelope) · blobstore (encrypted IndexedDB cache)
               expiry (what expired and what is about to) · zip (backup bundle)
src/assets/brand/  eQuantic logos — single source for the icons and the favicon
src/state/     keeper.tsx  — state machine (auth, vault, sync)
src/screens/   Onboarding (setup, login, creation, unlock) · VaultScreen
src/components/ ItemDetail · ItemEditor · SecretValue/TOTP · Generator · SettingsDialog · ui · icons
```

---

## Vault format

The file written to Drive (`vault.keeper.json`) and the exported backup share the same
envelope:

```jsonc
{
  "format": "equantic-keeper.vault",
  "version": 2,
  "cipher": "AES-GCM-256",
  "kdf": { "algo": "PBKDF2-SHA256", "iterations": 720000, "salt": "<base64>" },
  "verifier": "<base64, 16 bytes>",   // HKDF info "equantic-keeper:verify:v1"
  "iv": "<base64, 12 bytes>",
  "data": "<base64: AES-GCM(payload)>",
  "updatedAt": "2026-08-27T23:59:00.000Z"
}
```

- **AAD** = `format|version|cipher|kdf.algo|kdf.iterations|kdf.salt`
- **Key** = `HKDF-SHA256(PBKDF2(password, salt, iterations), salt, "equantic-keeper:enc:v1")`
- **Payload** (encrypted) = `{ "items": [...], "people": [...], "preferences": {...} }`
- **Version 2** added `people` (holders) and `item.holderId`; **version 3** added
  `item.attachments`; **version 4** added `folders` (folders created in the sidebar, which
  may hold no items yet — the ones items reference are derived); **version 5** added
  `customTypes` (user-defined type schemas built in the wizard's form builder). Old vaults
  open normally; it is the old client that refuses to open a newer vault, instead of
  discarding what it does not understand.

### Attachments

The bytes do **not** live in the vault. Each attachment is encrypted with its own AES-GCM
key and written as a separate file in the same hidden folder; the vault stores only the
metadata and that key, wrapped by the master key:

```jsonc
{
  "id": "…", "name": "residencia-2024.pdf", "mimeType": "application/pdf", "size": 184320,
  "wrapped": { "key": "<base64>", "iv": "<base64>" },  // file key, wrapped by the master key
  "iv": "<base64>",                                     // content IV
  "driveFileId": "…"                                    // empty until uploaded to Drive
}
```

- **Key AAD** = `equantic-keeper:attachment-key:v1|<id>` — prevents moving a key from one
  record to another.
- **Content AAD** = `equantic-keeper:attachment:v1|<id>|<mimeType>|<size>` — tampering with
  the declared type (renaming a PDF to an image inside the vault) breaks decryption instead
  of handing the bytes to the viewer under a different label.
- The ciphertext is also cached in the browser's **IndexedDB**, for offline opening.
- The **`.keeper.json`** export carries the vault only. To take the files along, use
  *Exportar cofre + anexos* ("Export vault + attachments"), which produces a
  **`.keeper.zip`**:

```
vault.keeper.json                    the same encrypted envelope as always
attachments/attachment-<id>.bin      one ciphertext per attachment, unchanged
```

  Nothing in it is readable without the master password — it is the same ciphertext Drive
  receives. Entries are not compressed: ciphertext does not compress, and spending CPU (and
  a dependency) to save nothing is not justified. On restore, attachments return to the
  device and lose their original Drive file id, so that **this** account uploads its own
  copy — without that, a second device would inherit a reference it cannot read.

The format is simple on purpose: with the master password and ~30 lines of Web Crypto you
can decrypt the vault without this app. The repository's integration test does exactly that.

---

## Known limitations

- **No password recovery.** Export a backup and keep it somewhere else — the
  `.keeper.zip` bundle includes the attachments; the `.keeper.json`, only the vault.
- **Orphaned attachments.** When an item is deleted for good, its bytes go with it. But if
  an item leaves through the 90-day trash retention, the file stays in Drive — unreadable
  without the wrapped key, yet still taking space. *Configurações → Liberar espaço no
  Drive* ("Free up Drive space") removes whatever no item references and is itself older
  than 90 days. The grace period exists because a device that stayed offline may hold the
  only copy of the vault that still points at that file.
- The `appDataFolder` is invisible in Drive: to take your data elsewhere, use the
  encrypted vault export — or move the vault into a folder of your own, where you can at
  least see the files (still encrypted).
- Moving the vault into a folder is per device: each one asks for the wider permission
  once. Until a device follows, it keeps syncing against the app folder and says so.
- Drive writes are not atomic. The app merges before writing and detects revision
  divergence, but two edits in the same second on different devices may need one extra
  sync.
- While the consent screen is in *Testing*, Google caps the app at 100 test users and the
  consent expires every 7 days.

## License

MIT — see [LICENSE](LICENSE).
