/**
 * The Google Picker: how a guest's app is allowed to see a folder it did not
 * create.
 *
 * Under `drive.file` an app reaches only what it created itself or what the
 * user handed it through this picker. That is a good rule — it is why Keeper
 * never needs a scope that can read the rest of someone's Drive — but it means
 * a folder shared with a guest is invisible to their app until they point at it
 * once. After that the grant sticks for that account.
 *
 * The picker allows folders AND files, on purpose. Google's own documentation
 * does not say whether picking a folder extends the grant to the files inside
 * it, and the answer decides whether a guest picks once or picks a handful of
 * files. Rather than betting on one, the caller reads what came back and says
 * what it found — the first real use settles it.
 */

const API_JS = 'https://apis.google.com/js/api.js';

export interface PickedItem {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
}

export class PickerError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = 'PickerError';
  }
}

/* ------------------------------------------------------------------------- *
 * The slice of Google's global objects this file touches. Declared rather than
 * pulled from a types package: three calls do not justify a dependency, and the
 * shapes are stable enough to be pinned here where they can be read.
 * ------------------------------------------------------------------------- */

interface PickerDocument {
  id: string;
  name?: string;
  mimeType?: string;
}

interface PickerResponse {
  action: string;
  docs?: PickerDocument[];
}

interface PickerBuilder {
  addView(view: unknown): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setTitle(title: string): PickerBuilder;
  setCallback(callback: (data: PickerResponse) => void): PickerBuilder;
  enableFeature(feature: string): PickerBuilder;
  setOrigin(origin: string): PickerBuilder;
  build(): { setVisible(visible: boolean): void };
}

interface DocsView {
  setIncludeFolders(value: boolean): DocsView;
  setSelectFolderEnabled(value: boolean): DocsView;
  setOwnedByMe(value: boolean): DocsView;
  setLabel(label: string): DocsView;
  setQuery(query: string): DocsView;
  setMimeTypes(mimeTypes: string): DocsView;
}

export interface PickerApi {
  PickerBuilder: new () => PickerBuilder;
  DocsView: new (viewId?: string) => DocsView;
  ViewId: { DOCS: string; FOLDERS: string };
  Action: { PICKED: string; CANCEL: string };
  Feature: { MULTISELECT_ENABLED: string };
  Response: { ACTION: string; DOCUMENTS: string };
}

declare global {
  interface Window {
    gapi?: { load(name: string, callback: () => void): void };
  }
}

let loading: Promise<void> | null = null;

function loadPicker(): Promise<void> {
  if (window.google?.picker) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const done = () => {
      if (!window.gapi) return reject(new PickerError('O script do Google não carregou.', 'script'));
      window.gapi.load('picker', () => resolve());
    };
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${API_JS}"]`);
    if (existing && window.gapi) return done();
    const script = existing ?? document.createElement('script');
    script.src = API_JS;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', done);
    script.addEventListener('error', () => {
      loading = null;
      reject(new PickerError('Não foi possível carregar o seletor do Google (offline?).', 'script'));
    });
    if (!existing) document.head.append(script);
  });
  return loading;
}

/**
 * Opens the picker on "shared with me" and resolves with what was chosen, or
 * an empty array if the user closed it.
 *
 * Multi-select is on so that, if a folder turns out not to carry its contents,
 * the guest can select the vault and the shares file together in one go instead
 * of being sent round the loop twice.
 */
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export async function pickSharedItems(
  token: string,
  apiKey: string,
  folderName: string,
): Promise<PickedItem[]> {
  if (!apiKey) {
    throw new PickerError(
      'Falta a chave de API do Google para abrir o seletor de arquivos. Ela é configurada em ' +
        'Configurações → Avançado.',
      'missing_key',
    );
  }
  await loadPicker();
  const picker = window.google?.picker;
  if (!picker) throw new PickerError('O seletor do Google não ficou disponível.', 'unavailable');

  return new Promise<PickedItem[]>((resolve) => {
    /*
     * Three views, narrowest first. Opening on everything the person has ever
     * been shared — holiday photos, a spreadsheet from work — and asking them
     * to find a folder in it is not a choice, it is a search party. The first
     * view is the folder by name and usually holds exactly one thing.
     *
     * The other two are escape hatches: the owner may have renamed the folder,
     * and picking files directly is the fallback if a picked folder turns out
     * not to carry its contents.
     */
    const shared = () =>
      new picker.DocsView(picker.ViewId.DOCS).setOwnedByMe(false).setIncludeFolders(true);

    const theFolder = shared()
      .setSelectFolderEnabled(true)
      .setMimeTypes(FOLDER_MIME)
      .setQuery(folderName)
      .setLabel('Pasta do cofre');

    const anyFolder = shared()
      .setSelectFolderEnabled(true)
      .setMimeTypes(FOLDER_MIME)
      .setLabel('Todas as pastas');

    const theFiles = shared().setMimeTypes('application/json').setQuery('keeper').setLabel('Arquivos do cofre');

    const built = new picker.PickerBuilder()
      .addView(theFolder)
      .addView(anyFolder)
      .addView(theFiles)
      .setOAuthToken(token)
      .setDeveloperKey(apiKey)
      .setTitle(`Escolha a pasta “${folderName}” partilhada com você`)
      .enableFeature(picker.Feature.MULTISELECT_ENABLED)
      .setOrigin(window.location.origin)
      .setCallback((data) => {
        if (data.action === picker.Action.CANCEL) return resolve([]);
        if (data.action !== picker.Action.PICKED) return;
        resolve(
          (data.docs ?? []).map((doc) => ({
            id: doc.id,
            name: doc.name ?? '',
            mimeType: doc.mimeType ?? '',
            isFolder: doc.mimeType === 'application/vnd.google-apps.folder',
          })),
        );
      })
      .build();

    built.setVisible(true);
  });
}
