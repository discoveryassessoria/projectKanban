# 31 — Hierarquia País/Região → Tipo de Processo → Modalidade → Workflow Macro

**Status: CONGELADO em 22/09/2026.** Mandato "Reconstrução da hierarquia
País/Região → Tipo de Processo → Modalidade → Workflow Macro". Qualquer
mudança de arquitetura, cardinalidade, unicidade ou contrato descrito aqui
exige pedido explícito do usuário e a suíte `npm run test:hierarquia-pais-tipo-modalidade`
inteira passando (48 verificações, gate obrigatório em CI —
`.github/workflows/guards-arquitetura.yml`, job `hierarquia`).

## 1. A hierarquia é a única fonte de classificação de processo

```
País/Região  →  Tipo de Processo  →  Modalidade  →  Workflow Macro
```

Nada fora desta cadeia classifica um processo. **Modalidade Legal** e
**Enquadramento Legal** foram removidos por completo (código, menus, rotas,
permissões, tabelas do banco) e **permanecem inexistentes** — `prisma.modalidadeLegal`
e `prisma.enquadramentoLegal` não existem no client; os modelos não existem
em `prisma/schema.prisma`.

## 2. Contrato canônico (as 10 garantias)

1. **Um Tipo de Processo representa EXCLUSIVAMENTE uma nacionalidade.**
   `TipoProcessoNacionalidade.code`/`.name` nunca incorporam a modalidade —
   nem no cadastro manual, nem na sugestão automática do formulário. Exemplo
   correto: `code="ITA"`, `name="Nacionalidade Italiana"`. Exemplo proibido:
   `code="ITA-JUD"`, `name="Cidadania Italiana · Judicial"` (bug real
   encontrado e corrigido em produção em 22/09/2026 — os 4 Tipos reais
   tinham a modalidade no nome/código, resíduo do modelo anterior).

2. **Modalidades permitidas: EXCLUSIVAMENTE `ADMINISTRATIVA` e `JUDICIAL`.**
   `ModalidadePais.modalityKey` é uma enumeração canônica travada em duas
   camadas: (a) `POST /api/gerenciamento/paises/[countryKey]/modalidades`
   só aceita `modalityKey` igual a `"administrativa"` ou `"judicial"` —
   rótulo/sufixo são fixos no servidor, nunca vêm do corpo da requisição; (b)
   `CHECK` constraint em produção (`ModalidadePais_modalityKey_canonica_check`)
   trava a mesma regra no banco. Nenhuma modalidade é renomeável para outro
   conceito (`PUT` só aceita `ativo`/`ordem`).

3. **Um Tipo pode habilitar as duas modalidades simultaneamente.**
   `TipoProcessoModalidadeHabilitada` é uma relação N:N real (não um FK
   único). `POST /api/gerenciamento/tipos-processo` aceita `modalityKeys:
   string[]` com 1 ou 2 chaves.

4. **Cada par (Tipo, Modalidade) tem o SEU PRÓPRIO Workflow Macro.**
   `MacroWorkflow` é identificado por `@@unique([tipoProcessoId,
   modalidadeId])` — não mais por `tipoProcessoId` sozinho. **Este é o ponto
   que quebrou em produção**: o índice único antigo (coluna única) nunca
   tinha sido trocado pelo composto no passo 1 da migração original; o
   segundo Workflow Macro do mesmo Tipo (a outra modalidade) não conseguia
   nascer, com erro genérico "Unique constraint failed on (tipoProcessoId)".
   Corrigido pela migration `20260922120000_macro_workflow_unique_tipo_modalidade`.
   A suíte de regressão prova isto nos dois níveis: via rota (§4.2) e via
   `INSERT` direto no banco (§4.7).

5. **Isolamento entre os dois Workflow Macro.** Compor fases num Workflow
   Macro (Judicial, por exemplo) nunca afeta o outro (Administrativo) do
   mesmo Tipo — são registros independentes, cada um com sua própria lista
   de `FaseMacro`.

6. **A cardinalidade do requerimento (INDIVIDUAL/COLETIVO) vive no Workflow
   Macro**, campo `cardinalidadeRequerimento` — não num quinto cadastro, nem
   em Modalidade, nem em Tipo. Decisão explícita do usuário em 22/09/2026:
   "A cardinalidade não deve ficar em Tipo de Processo nem em Modalidade.
   Ela deve ficar no Workflow Macro, porque define como aquele fluxo
   específico será protocolado."

7. **Gerenciamento é a fonte única.** `criarProcessoV2` só aceita
   `modalidadeId` de uma habilitação real (`TipoProcessoModalidadeHabilitada`
   ativa) do Tipo informado — nunca aceita, infere ou inventa uma modalidade
   não habilitada. A resolução do Workflow Macro aplicável passa sempre por
   `resolverMacroWorkflowDoProcesso`/`resolverMacroWorkflowDoTipo`
   (`src/lib/motor/resolver-macro-workflow.ts`) — fonte única, nunca uma
   query própria duplicada em outro arquivo.

8. **Processos existentes e históricos nunca são excluídos, recriados ou
   corrompidos** por uma reconfiguração da hierarquia (nova fase composta,
   modalidade nova habilitada, etc.). Identidade (`id`, `dataInicio`,
   `modalidadeId`, `faseAtualKey`) preservada ao longo de qualquer edição de
   OUTRO Workflow Macro ou de outra modalidade do mesmo Tipo.

9. **Desabilitar uma modalidade com Workflow Macro ativo é bloqueado**
   (`409 MODALIDADE_COM_MACRO_ATIVO`) — nunca silencioso, nunca destrutivo.
   O admin inativa o Workflow Macro primeiro, se for essa a intenção real. A
   hierarquia é configurável e reconciliável, nunca frágil.

10. **Exclusão de País/Tipo em uso real (Tipo de Processo ou Processo) é
    bloqueada** (`409`). Tudo o mais que referencia o país por FK é
    cadastro/configuração, não fato operacional — a exclusão do país
    desvincula (Órgão de Protocolo, Requisito Cadastral: `paisId` é campo de
    ESCOPO, ficam sem país) ou remove junto o que só existia por causa do
    país (Modalidade, Serviço/Condição/Taxa por país, Status legado). Nunca
    confundir "em uso por cadastro" com "em uso por processo real" — só o
    segundo bloqueia (mandato "Exclusão não deixa órfão" + "Configuração ≠
    fato histórico").

## 3. Fronteira com o Catálogo de Fases

O Catálogo de Fases (`docs/architecture/30-catalogo-de-fases-reconciliacao.md`,
CONGELADO desde 22/09/2026) é uma fronteira intocada por este mandato. O
Workflow Macro referencia `phaseKey` já publicada por Fases; nunca cadastra,
edita ou possui uma fase por conta própria. Nenhuma mudança nesta hierarquia
altera a arquitetura, cardinalidade, ou contrato de Fases — e vice-versa.

## 4. O que este contrato PROÍBE (mesmo sem quebrar tipos/lint/build)

- Modalidade por texto livre, em qualquer caminho (API, seed, script
  administrativo direto no banco).
- Nome/código de Tipo concatenando modalidade (`ITA-JUD`, `Nacionalidade X
  · Judicial`) — nem no cadastro manual, nem na sugestão automática.
- `MacroWorkflow` identificado só por `tipoProcessoId` (índice de coluna
  única) — sempre o composto com `modalidadeId`.
- Qualquer reintrodução de `ModalidadeLegal`/`EnquadramentoLegal`, mesmo como
  nome de campo/variável fora do modelo (achado real: `modalidadeLegal` como
  nome de campo em `completude.ts`, corrigido para `modalidadeLabel`).
- Bloquear exclusão de país/tipo por cadastro/configuração que não é fato
  operacional.
- Segunda query própria para "o Workflow Macro aplicável" fora de
  `resolver-macro-workflow.ts`.

## 5. Prova permanente

`scripts/hierarquia-pais-tipo-modalidade.test.ts` — 48 verificações, banco de
teste real (nunca mock), cobrindo as 10 garantias acima mais unicidade do
par (rota + banco), isolamento entre macros, permissões (403 real para
operacional, com prova de que nada persiste), bloqueios de exclusão, e
ausência funcional de `ModalidadeLegal`/`EnquadramentoLegal` (grep dinâmico
sobre `src/` e `scripts/`, exceto comentário/migração histórica).

Rodar localmente:

```
npm run test:hierarquia-pais-tipo-modalidade
```

Gate obrigatório em CI: `.github/workflows/guards-arquitetura.yml`, job
`hierarquia` — roda em todo push e toda pull request, bloqueia merge/deploy
se falhar.
