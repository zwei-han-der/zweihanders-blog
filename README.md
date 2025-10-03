# blog

Aplicação de blog full-stack construída com Bun, Drizzle ORM e PostgreSQL (Neon). A UI é composta por HTML/CSS/JS servidos a partir de `public/`, enquanto os endpoints HTTP ficam em `src/server.ts`.

## Requisitos
- **Bun** ≥ 1.2.23
- **Node.js** (opcional, apenas para tooling auxiliar)
- **Banco PostgreSQL** com URL de conexão (Neon recomendado)

## Configuração
1. Crie um arquivo `.env` na raiz do projeto.
2. Defina as variáveis necessárias:

```bash
DATABASE_URL="postgres://user:password@host/db"
SESSION_SECRET="chave-secreta" # opcional em desenvolvimento, obrigatório em produção
PORT=3000                        # opcional; padrão 3000
```

As tabelas esperadas estão descritas em `src/db/schema.ts`. Garanta que o banco remoto/local esteja em paridade com esse esquema antes de iniciar o servidor.

## Instalação

```bash
bun install
```

## Executar servidor

```bash
bun run src/server.ts
```

O servidor expõe:
- `GET /posts`, `POST /posts`, `PUT /posts/:id`, `DELETE /posts/:id`
- `GET /tags`
- `POST /auth/login`, `POST /auth/logout`, `GET /auth/session`

Os assets estáticos (`index.html`, `script.js`) são servidos a partir de `public/`.

## Testes

```bash
bun test
```

Os testes cobrem as rotas de posts (`tests/posts.test.ts`) e comportamentos do front (`tests/script.test.ts`).

## Estrutura principal
- `src/server.ts`: bootstrap do servidor Bun e roteamento
- `src/routes/`: handlers HTTP (`posts`, `auth`)
- `src/services/`: regras de negócio e acesso ao banco
- `src/db/`: cliente e definição de schema Drizzle
- `public/`: HTML/CSS/JS expostos ao navegador
