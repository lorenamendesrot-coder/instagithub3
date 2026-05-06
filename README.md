# Insta Manager v3

Gerenciador de múltiplas contas do Instagram via Meta Graph API v21.  
Publica em várias contas de uma vez, com agendamento, delay configurável e histórico local.

## O que há de novo na v3

- **Tokens armazenados no IndexedDB** (mais seguro que localStorage)
- **Graph API v21.0** (versão atual)
- **Layout responsivo mobile** com menu drawer
- **Validação de URL de mídia** antes de publicar (com preview automático)
- **Modal de confirmação** substituindo `confirm()` nativo
- **Edição de agendamentos** sem precisar deletar e recriar
- **Fuso horário explícito** nos agendamentos
- **Filtros e busca** no histórico (por tipo, status, legenda/conta)
- **Histórico expansível** com detalhes completos ao clicar
- **Aviso de truncamento** quando o histórico passa de 500 entradas
- **Conexão IndexedDB cacheada** (melhoria de performance)
- **`useRef` correto** no scheduler (evita disparos duplicados)
- **Tokens de página de longa duração** no auth-callback

## Stack

- **Frontend:** React + Vite (deploy no Netlify)
- **Backend:** Netlify Functions (serverless, Node.js)
- **Auth:** OAuth 2.0 com Meta/Facebook
- **Storage:** IndexedDB (contas + tokens + histórico + fila)

---

## Pré-requisitos

- Conta no [Netlify](https://netlify.com) (gratuito)
- App criado no [Meta for Developers](https://developers.facebook.com)
- Contas Instagram do tipo **Business** ou **Creator**
- Node.js 18+

---

## Passo 1 — Configurar o App na Meta

1. Acesse [developers.facebook.com](https://developers.facebook.com)
2. **Meus Apps → seu app → Configurações → Básico**  
   Anote o **ID do App** e o **Segredo do App**
3. Menu lateral → **Instagram → Configurações da API**  
   Adicione as permissões:
   - `instagram_basic`
   - `instagram_content_publish`
   - `pages_read_engagement`
   - `pages_show_list`
   - `business_management`
4. **Produtos → Facebook Login → Configurações**  
   URI de redirecionamento: `https://SEU-SITE.netlify.app/api/auth-callback`

---

## Passo 2 — Deploy no Netlify

### Via GitHub (recomendado)

1. Suba o projeto para um repositório no GitHub
2. Netlify → **Add new site → Import an existing project → GitHub**
3. Selecione o repositório (o `netlify.toml` já configura tudo)

### Via CLI

```bash
npm install -g netlify-cli
netlify login
netlify init
netlify deploy --prod
```

---

## Passo 3 — Variáveis de ambiente no Netlify

**Site settings → Environment variables → Add variable**

| Variável | Descrição |
|---|---|
| `META_APP_ID` | ID do App (Meta) |
| `META_APP_SECRET` | Segredo do App — **nunca exponha** |
| `META_REDIRECT_URI` | `https://SEU-SITE.netlify.app/api/auth-callback` |
| `VITE_META_APP_ID` | Mesmo que META_APP_ID (exposto ao frontend) |

Após adicionar: **Deploys → Trigger deploy**

---

## Rodar localmente

```bash
npm install
cp .env.example .env
# Preencha o .env com seus valores

npm install -g netlify-cli
netlify dev
```

Acesse: `http://localhost:8888`

---

## Estrutura do projeto

```
insta-manager/
├── netlify/
│   └── functions/
│       ├── auth-callback.mjs  ← OAuth com a Meta (v21)
│       └── publish.mjs        ← Publicação em múltiplas contas (v21)
├── src/
│   ├── pages/
│   │   ├── Accounts.jsx       ← Contas conectadas
│   │   ├── NewPost.jsx        ← Criar e publicar post
│   │   ├── Schedule.jsx       ← Agendamentos com edição
│   │   └── History.jsx        ← Histórico com filtros
│   ├── App.jsx                ← Layout, rotas, state global
│   ├── Modal.jsx              ← Modal reutilizável
│   ├── MediaPreview.jsx       ← Preview + validação de URL
│   ├── useAccounts.js         ← Hook de contas (IndexedDB)
│   ├── useDB.js               ← IndexedDB cacheado
│   ├── main.jsx
│   └── index.css
├── public/
│   └── sw.js                  ← Service Worker
├── index.html
├── vite.config.js
├── netlify.toml
└── package.json
```

---

## Notas de segurança

- **Tokens de acesso** ficam no IndexedDB, não no localStorage
- O `META_APP_SECRET` **nunca** vai para o frontend — fica só nas Netlify Functions
- Tokens de página são trocados por versões de longa duração no auth-callback

---

## Observações

- **URL da mídia:** A Meta API exige URLs públicas. Use [Catbox](https://catbox.moe), [Cloudinary](https://cloudinary.com), S3, etc.
- **Tipos de conta:** Apenas contas **Business** ou **Creator** têm acesso à API de publicação.
- **Reels/vídeos:** O processamento pode demorar até 2 minutos. O sistema aguarda automaticamente.
- **Agendamentos:** O scheduler roda no navegador a cada 10s. Se fechar a aba, o Service Worker tenta continuar (suporte limitado por browser).
