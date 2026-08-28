# eQuantic Keeper

Cofre para o que você precisa consultar toda hora: segredos de desenvolvimento — tokens de API,
client id/secret, usuário e senha de painéis, credenciais de container registry, chaves SSH,
`.env`, certificados — e documentos pessoais de Portugal e do Brasil, seus e de quem mora com
você: títulos de residência, cartão de cidadão, NIF, NISS, CPF, RG, certidões, passaportes.

É uma aplicação **100% estática**, hospedada no **GitHub Pages**, que autentica com a sua **conta
Google** e guarda um único arquivo **cifrado** na pasta oculta do seu **Google Drive**. Não existe
servidor, banco de dados nem backend: a criptografia acontece inteira no seu navegador.

**Instância oficial: [keeper.equantic.tech](https://keeper.equantic.tech)**

---

## Como funciona

```
 você digita a senha mestra
          │
          ▼
  PBKDF2-SHA256 (720k iterações)  ──► HKDF ──┬──► chave AES-GCM-256  ──► cifra o cofre
                                              └──► verificador (público)
          │
          ▼
   { header público + ciphertext }  ──►  Google Drive (appDataFolder)
                                    ──►  localStorage (cache offline)
```

O Google recebe **apenas bytes cifrados**. A senha mestra nunca sai do navegador, não é
transmitida, não é salva e não pode ser recuperada.

### Modelo de segurança

| Item | Decisão |
| --- | --- |
| Derivação de chave | PBKDF2-SHA256, 720.000 iterações (piso de 210.000), salt aleatório de 16 bytes |
| Separação de chaves | HKDF-SHA256 divide o material em chave de cifragem e verificador |
| Cifra | AES-GCM-256 com IV de 12 bytes novo a cada gravação e tag de 128 bits |
| Integridade do cabeçalho | O header público entra como *additional authenticated data* — adulterá-lo invalida a tag |
| Chave em memória | `CryptoKey` não-extraível; apagada ao bloquear, ao fechar a aba e por inatividade |
| Escopo do Google | Somente `drive.appdata` (pasta oculta exclusiva do app) + e-mail/perfil |
| Token OAuth | Access token de curta duração, mantido apenas em memória |
| Área de transferência | Limpeza automática (padrão: 30s) após copiar um segredo |
| CSP | `default-src 'none'` com allow-list mínima; sem scripts inline; bloqueio de iframe |
| Busca | Nunca indexa valores secretos — só nome, descrição, tags e campos não sensíveis |

**O que este modelo não protege:** um dispositivo comprometido (keylogger, malware, extensão
maliciosa) enxerga o cofre aberto do mesmo jeito que você. E se você esquecer a senha mestra,
os dados são irrecuperáveis — por construção.

---

## Recursos

- **12 tipos de segredo** com campos próprios: API Token, API Client/Secret, Usuário e senha,
  Container Registry, Cloud/Provider, Chave SSH, Banco de dados, Variáveis/`.env`, Certificado,
  Webhook, Licença e Nota segura — além de campos personalizados em qualquer item.
- **21 tipos de documento pessoal**, cada um com os campos que aquele papel realmente tem:
  - *Portugal*: título de residência (por emissão, com entidade, processo e validade), Cartão de
    Cidadão, NIF, NISS, número de utente, registo criminal, comprovativo de morada e contrato de
    arrendamento.
  - *Brasil*: CPF, RG, CNH, título de eleitor, certidões (nascimento, casamento, óbito — com
    matrícula, cartório, livro/folha/termo e apostila), antecedentes criminais e CTPS.
  - *Geral*: passaporte, visto, diploma, cartão de vacinação, seguro de saúde e um tipo genérico.
- **Titulares**: cada item pode pertencer a uma pessoa (você, cônjuge, filhos). A barra lateral
  filtra por pessoa e a busca encontra o documento pelo nome dela, que não fica guardado no item.
  Remover uma pessoa nunca apaga os documentos dela — eles apenas ficam sem titular.
- **Códigos 2FA (TOTP)** gerados no próprio cofre, a partir de um segredo base32 ou de uma URI
  `otpauth://` (RFC 6238, SHA-1/256/512).
- **Gerador** de senhas e frases-senha com `crypto.getRandomValues` e amostragem sem viés.
- **Sincronização multi-dispositivo** com mesclagem item a item (o mais recente vence) e
  *tombstones*, para que exclusões se propaguem em vez de ressuscitar.
- **Backups**: snapshots diários rotativos no próprio Drive, exportação cifrada `.keeper.json`,
  importação com mesclagem e exportação em texto puro (sem lock-in).
- **PWA offline**: instalável, com o cofre cifrado em cache — dá para consultar segredos sem rede.
- Busca instantânea, pastas, tags, favoritos, lixeira, tema claro/escuro, `Ctrl+K` para buscar e
  `Ctrl+L` para bloquear.

---

## Publicando a sua instância

### 1. Crie a credencial OAuth no Google

1. Abra o [Google Cloud Console](https://console.cloud.google.com/apis/credentials) e crie um projeto.
2. Ative a **Google Drive API** (*APIs & Services → Library*).
3. Configure a **tela de consentimento OAuth** (tipo *External*). Enquanto o app estiver em
   *Testing*, adicione as contas que vão usá-lo em *Test users* — quem não estiver na lista recebe
   `Erro 403: access_denied`.
4. Em **Data access**, adicione o escopo `https://www.googleapis.com/auth/drive.appdata`. Se ele
   não estiver declarado ali, o Google concede apenas e-mail/perfil e o app recusa o login.
5. Em *Credentials*, crie um **OAuth client ID** do tipo **Web application**.
6. Em **Authorized JavaScript origins**, adicione a origem exata onde o app roda — sem barra no
   final e sem caminho. Para a instância oficial: `https://keeper.equantic.tech`; num fork sem
   domínio próprio, `https://<usuário>.github.io`. Não é preciso informar redirect URI: o fluxo
   usa o Google Identity Services em popup.

   > Se a origem não bater exatamente com a barra de endereços, o popup do Google recusa com
   > `origin_mismatch` — é o erro mais comum nesta configuração.
7. Copie o **Client ID** (algo como `1234567890-abc.apps.googleusercontent.com`). Ele é um
   identificador **público**, não um segredo.

> O escopo pedido é apenas `drive.appdata`. O Google mostra isso como "Ver e gerenciar seus
> próprios dados de configuração no Google Drive" — o app não enxerga nenhum outro arquivo seu.

#### Problemas comuns no login

| Sintoma | Causa | Correção |
| --- | --- | --- |
| `Erro 403: access_denied`, "não concluiu o processo de verificação" | A tela está em *Testing* e a conta não é testadora | Adicione a conta em *Audience → Test users*, ou publique o app |
| "O acesso à pasta do app no Drive não foi concedido" | O escopo não está em *Data access*, ou a caixa da permissão não foi marcada na tela do Google | Declare o escopo e, ao entrar de novo, marque a permissão do Drive |
| `origin_mismatch` no popup | A origem não bate exatamente com a barra de endereços | Registre a origem sem barra final e sem caminho |

> As permissões aparecem como **caixas que começam desmarcadas**. Clicar em "Continuar" sem marcar
> a do Drive concede só a identidade, e o app recusa o login em vez de criar um cofre que não
> conseguiria sincronizar depois.

**Vale publicar?** Todos os escopos usados aqui — `drive.appdata`, `userinfo.email` e
`userinfo.profile` — são classificados pelo Google como *non-sensitive*, que exigem apenas a
verificação básica. Publicar (*Audience → Publish app*) evita o teto de 100 testadores e a
autorização de teste expirando, que força um consentimento interativo novo quando a renovação
silenciosa falha.

### 2. Configure o repositório

1. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. **Settings → Secrets and variables → Actions → Variables → New repository variable**:
   - Nome: `GOOGLE_OAUTH_CLIENT_ID`
   - Valor: o client id do passo anterior.

Se você preferir não fixar o client id no build, deixe a variável vazia: o app pede o client id
na primeira execução e o guarda no `localStorage` daquele navegador.

### 3. Faça o deploy

Em *Settings → Pages → Build and deployment*, escolha **Source: GitHub Actions**. Isto não é
detalhe: com a opção *Deploy from a branch*, o GitHub roda o próprio build Jekyll da raiz do
repositório **em paralelo** com o workflow deste projeto, e os dois publicam no mesmo site. Quem
terminar por último vence — e quando é o Jekyll, o que vai ao ar é o código-fonte, com um
`index.html` que aponta para `/src/main.tsx` e não executa no navegador.

> Sintoma de que a origem está errada: `curl https://SEU-DOMINIO/README.md` responde 200, e
> `/manifest.webmanifest` responde 404. Num deploy correto é o contrário. Um *service worker* já
> instalado continua servindo a versão anterior do app, então o problema costuma aparecer primeiro
> para quem abre o site pela primeira vez.

Feito isso, um push em `main` dispara `.github/workflows/deploy.yml`, que roda typecheck + testes,
constrói e publica no Pages. O `base` do Vite é resolvido automaticamente (`/equantic-keeper/` em
página de projeto, `/` em domínio próprio).

**Domínio próprio:** configure em *Settings → Pages → Custom domain*. O GitHub grava o valor num
arquivo `CNAME` na raiz do repositório, e o build copia esse arquivo para dentro de `dist/` — assim
o artefato publicado carrega o mesmo domínio, sem uma segunda cópia em `public/` que poderia ficar
desatualizada se o domínio mudasse.

---

## Desenvolvimento

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # testes unitários (cripto, cofre, sync, TOTP, gerador, busca, documentos)
npm run typecheck
npm run build      # typecheck + build de produção em dist/
npm run icons      # regenera os ícones do PWA
npm run smoke      # teste de integração no navegador (após npm run build)
```

O `npm run smoke` sobe o `vite preview`, semeia um cofre cifrado por uma implementação
independente do formato e percorre o app com o Playwright: configuração inicial, senha errada,
desbloqueio, busca, revelar segredo, TOTP, criação de item, cadastro de um documento com titular,
filtro por pessoa, tema e bloqueio. O cofre semeado é um arquivo **v1**, então a migração para v2
também é exercitada em navegador de verdade. Ele precisa do navegador instalado uma vez:
`npx playwright install chromium`.

Para testar o login do Google localmente, adicione `http://localhost:5173` às *Authorized
JavaScript origins* da credencial. Sem isso, o app ainda funciona: crie o cofre, use offline e
conecte o Drive depois.

### Estrutura

```
src/lib/       crypto · vault · sync · drive · google-auth · totp · generator · search · storage
               model (tipos de segredo) · documents (tipos de documento pessoal)
src/state/     keeper.tsx  — máquina de estados (auth, cofre, sincronização)
src/screens/   Onboarding (config, login, criação, desbloqueio) · VaultScreen
src/components/ ItemDetail · ItemEditor · SecretValue/TOTP · Generator · SettingsDialog · ui · icons
```

---

## Formato do cofre

O arquivo gravado no Drive (`vault.keeper.json`) e o backup exportado usam o mesmo envelope:

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
- **Chave** = `HKDF-SHA256(PBKDF2(senha, salt, iterations), salt, "equantic-keeper:enc:v1")`
- **Payload** (cifrado) = `{ "items": [...], "people": [...], "preferences": {...} }`
- **Versão 2** acrescentou `people` (titulares) e `item.holderId`. Cofres v1 abrem normalmente;
  um cliente antigo se recusa a abrir um cofre mais novo em vez de descartar o que não entende.

O formato é simples de propósito: com a senha mestra e ~30 linhas de Web Crypto você decifra o
cofre sem este app. O teste de integração do repositório faz exatamente isso.

---

## Limitações conhecidas

- **Sem recuperação de senha.** Exporte um backup cifrado e guarde-o em outro lugar.
- O `appDataFolder` é invisível no Drive: para levar os dados embora, use *Exportar cofre cifrado*.
- A gravação no Drive não é atômica. O app mescla antes de escrever e detecta divergência de
  revisão, mas duas edições no mesmo segundo em dispositivos diferentes podem exigir uma
  sincronização extra.
- Enquanto a tela de consentimento estiver em *Testing*, o Google limita o app a 100 usuários de
  teste e o consentimento expira a cada 7 dias.

## Licença

MIT — veja [LICENSE](LICENSE).
