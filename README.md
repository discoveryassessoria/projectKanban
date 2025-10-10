# Guia de Comandos: Prisma & Next.js

Este arquivo serve como uma referência rápida para os comandos mais utilizados do Prisma e do Next.js no desenvolvimento de aplicações.

## Sumário

- [Prisma CLI](#prisma-cli)
  - [Inicialização e Geração](#inicialização-e-geração)
  - [Migrations](#migrations)
  - [Comandos de Banco de Dados](#comandos-de-banco-de-dados)
  - [Ferramentas de Desenvolvimento](#ferramentas-de-desenvolvimento)
- [Next.js CLI](#nextjs-cli)
  - [Desenvolvimento](#desenvolvimento)
  - [Build e Produção](#build-e-produção)
  - [Criação de Projetos](#criação-de-projetos)
  - [Linting e Qualidade de Código](#linting-e-qualidade-de-código)

---

## Prisma CLI

O Prisma é um ORM (Object-Relational Mapper) de próxima geração para Node.js e TypeScript. Ele simplifica o acesso ao banco de dados com um schema declarativo e um cliente de consulta fortemente tipado.

### Inicialização e Geração

| Comando | Descrição |
| --- | --- |
| `npx prisma init` | Inicializa um novo projeto Prisma. Cria o diretório `prisma` com o arquivo `schema.prisma` e um arquivo `.env` para as variáveis de ambiente do banco de dados. |
| `npx prisma generate` | Gera o Prisma Client com base no seu `schema.prisma`. Este comando deve ser executado sempre que houver uma alteração no seu schema. |

### Migrations

As migrations permitem que você evolua o schema do seu banco de dados de forma consistente e versionada.

| Comando | Descrição |
| --- | --- |
| `npx prisma migrate dev` | Cria uma nova migration com base nas alterações do seu `schema.prisma` e a aplica ao banco de dados de desenvolvimento. Ideal para o ambiente de desenvolvimento. |
| `npx prisma migrate deploy` | Aplica todas as migrations pendentes ao banco de dados. Recomendado para ambientes de produção e CI/CD. |
| `npx prisma migrate reset` | Reseta o banco de dados, apagando todos os dados e aplicando todas as migrations novamente. Útil para reiniciar o ambiente de desenvolvimento. |
| `npx prisma migrate status` | Exibe o status das suas migrations, mostrando quais foram aplicadas e quais estão pendentes. |

### Comandos de Banco de Dados

Estes comandos interagem diretamente com o banco de dados.

| Comando | Descrição |
| --- | --- |
| `npx prisma db push` | Sincroniza o seu `schema.prisma` com o banco de dados sem criar um arquivo de migration. Útil para prototipagem e desenvolvimento inicial. |
| `npx prisma db pull` | Extrai o schema de um banco de dados existente e o traduz para o formato do `schema.prisma`. |
| `npx prisma db seed` | Executa o script de seed definido no seu `package.json` para popular o banco de dados com dados iniciais. |

### Ferramentas de Desenvolvimento

| Comando | Descrição |
| --- | --- |
| `npx prisma studio` | Abre uma interface gráfica no navegador para visualizar e editar os dados do seu banco de dados. |
| `npx prisma format` | Formata o seu arquivo `schema.prisma` para garantir um estilo de código consistente. |
| `npx prisma validate` | Valida o seu `schema.prisma` em busca de erros de sintaxe ou de schema. |

---

## Next.js CLI

O Next.js é um framework React para produção. Os comandos a seguir são essenciais para o ciclo de vida de desenvolvimento de uma aplicação Next.js.

### Desenvolvimento

| Comando | Descrição |
| --- | --- |
| `npm run dev` ou `next dev` | Inicia o servidor de desenvolvimento do Next.js em `http://localhost:3000`. Inclui recursos como Fast Refresh e recarregamento de módulo a quente. |
| `next dev -p <porta>` | Inicia o servidor de desenvolvimento em uma porta específica. Ex: `next dev -p 8080`. |

### Build e Produção

| Comando | Descrição |
| --- | --- |
| `npm run build` ou `next build` | Cria uma versão otimizada da sua aplicação para produção. Gera os arquivos estáticos e os "chunks" de JavaScript necessários. |
| `npm run start` ou `next start` | Inicia o servidor de produção do Next.js. Requer que o comando `next build` tenha sido executado anteriormente. |
| `next start -p <porta>` | Inicia o servidor de produção em uma porta específica. |

### Criação de Projetos

| Comando | Descrição |
| --- | --- |
| `npx create-next-app@latest` | Cria um novo projeto Next.js com um setup interativo que permite configurar TypeScript, ESLint, Tailwind CSS e o App Router. |

### Linting e Qualidade de Código

| Comando | Descrição |
| --- | --- |
| `npm run lint` ou `next lint` | Executa o ESLint para identificar e corrigir problemas no seu código. O Next.js oferece uma configuração base otimizada. |
| `next lint --fix` | Corrige automaticamente os problemas de lint que são passíveis de correção. |