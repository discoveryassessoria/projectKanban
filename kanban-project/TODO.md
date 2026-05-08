## Problema

O sistema gera e valida tokens de autenticação usando apenas codificação
base64 (btoa/atob), sem assinatura criptográfica. Isso permite que qualquer
pessoa com acesso ao DevTools do navegador forje um token de admin sem ter
senha, simplesmente colando este código no console:

```js
const tokenFalso = btoa(JSON.stringify({ userId: 999, tipo: "admin", exp: 9999999999999 }))
localStorage.setItem("authToken", tokenFalso)
document.cookie = `authToken=${tokenFalso}; path=/`
location.reload()
```

Antes da correção do middleware, esse código bastava pra entrar como admin.

## Estado atual

- Pacote `jose` instalado (já em `package.json`)
- Variáveis `JWT_SECRET` e `APP_JWT_SECRET` no `.env` (32+ chars, geradas
  com `crypto.randomBytes`)
- Middleware e endpoint de login ainda usam base64 simples

## Tentativa de correção em 08/05/2026

Foi feita uma tentativa de migrar para JWT, mas REVERTIDA porque causou
loop infinito `/dashboard` ↔ `/login`. A causa: o sistema tem múltiplos
pontos independentes de validação de token, não só o middleware.

## Mapeamento das camadas que validam token

1. **Middleware do Next.js** (`middleware.ts` na raiz)
   - Protege rotas `/dashboard/*` e `/administrator/*`
   - Hoje: `JSON.parse(atob(token))`

2. **Endpoint de login** (`src/app/api/auth/login/route.ts`)
   - Gera o token
   - Hoje: `btoa(JSON.stringify({...}))`

3. **APIs do backend** (várias rotas em `src/app/api/**/route.ts`)
   - Validam o token nas requests autenticadas
   - Hoje: provavelmente também usam `atob()` (não mapeado em detalhe)
   - Quando uma API responde 401, algum componente do front detecta e
     redireciona para `/login`, causando o loop

4. **App mobile** (`src/lib/app-auth.ts`)
   - JÁ usa JWT real (`jsonwebtoken`) com `APP_JWT_SECRET`
   - Sistema separado, não afetado por essa migração

## Plano de migração (quando retomar)

1. **Mapear todas as APIs que validam token**:
```powershell
   Get-ChildItem -Path src -Recurse -Include *.ts,*.tsx | Select-String -Pattern "atob\(" -List | Select-Object Path
   Get-ChildItem -Path src -Recurse -Include *.ts,*.tsx | Select-String -Pattern "verificarToken|extrairToken|verifyToken|validateToken" -List | Select-Object Path
```

2. **Criar helper centralizado** em `src/lib/jwt.ts`:
   - Função `gerarToken(payload)` usando `SignJWT` do `jose`
   - Função `validarToken(token)` usando `jwtVerify` do `jose`
   - Lê `JWT_SECRET` do `.env`

3. **Refatorar todas as camadas pra usar o helper**:
   - Middleware
   - Endpoint de login
   - Todas as APIs do backend

4. **Atualizar todas de uma vez** (em uma única branch / PR), nunca em
   etapas separadas, porque a inconsistência entre camadas causa o loop.

5. **Aviso pré-deploy**: ao subir, todos os usuários atualmente logados
   serão deslogados (tokens antigos viram inválidos). Avisar Marco e
   equipe antes.

## Estimativa

1-2 horas focado, com janela dedicada. Não dá pra fazer "no canto"
enquanto trabalha em outras coisas.

## Risco operacional atual

Médio: requer acesso ao DevTools de uma máquina logada. Como o sistema é
interno (acesso só de funcionários), o risco é menor que se fosse exposto
publicamente. Ainda assim, deve ser resolvido antes do sistema crescer
ou ter mais usuários externos.