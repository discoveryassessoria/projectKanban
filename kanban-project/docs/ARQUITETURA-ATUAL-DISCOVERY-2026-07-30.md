# Discovery — Arquitetura Atual (estado congelado em 30/07/2026)

Documento de **estado**, não de proposta. Descreve exclusivamente o que está
definido e implementado. Não contém sugestão, refatoração, melhoria ou ideia nova.

Base do levantamento: repositório `~/Developer/projectKanban/kanban-project`,
branch `main`, HEAD `f54d38c` ("merge: reconcilia a linha da Árvore com a main"),
`prisma/schema.prisma` com 198 models/enums e 101 migrations aplicadas.

---

> ## Nota de versionamento — 01/08/2026
>
> Este documento foi escrito em 30/07/2026 e versionado no repositório em
> 01/08/2026. **O corpo abaixo não foi reescrito**: continua sendo o retrato
> congelado em `f54d38c`, e é assim que deve ser lido. Esta nota registra apenas
> o que mudou depois, de forma objetiva e verificável — nada aqui descreve
> arquitetura nova.
>
> **Distância da base.** Na data do versionamento, `main` estava 77 commits à
> frente de `f54d38c`.
>
> **Deltas medidos** (`f54d38c` → `main` de 01/08/2026):
>
> | Medida | Na base | No versionamento |
> |---|---|---|
> | models/enums em `prisma/schema.prisma` | 198 | 226 |
> | migrations em `prisma/migrations` | 101 | 104 |
>
> As três migrations acrescentadas são
> `20260830100000_mrg_motor_registral_genealogico`,
> `20260830200000_catalogo_referencias_estruturais` e
> `20260831000000_modalidade_enquadramento_legal`.
>
> **Ressalva sobre a convenção de status.** A convenção abaixo equaciona "em
> `main`" com "deployado". Essa equivalência não vale para a leitura deste
> documento: quando ele foi versionado, `main` tinha 17 commits ausentes de
> `origin/main`, e o que estava publicado no repositório remoto não
> correspondia ao estado local. Portanto, **um item marcado "EM PRODUÇÃO" no
> corpo significa "estava em `main` em 30/07/2026"** — a confirmação de deploy
> tem de ser feita no painel da Vercel, não inferida daqui.

---

Convenção de status usada em todo o documento:

- **EM PRODUÇÃO** — código em `main` e deployado em `app.discovery.com.br`.
- **EM MAIN, NÃO DEPLOYADO** — commitado, deploy não confirmado.
- **EM BRANCH** — existe em branch, não integrado.
- **NÃO EXISTE** — não há entidade, serviço, tela nem rota.

---

## 0. Princípios permanentes que atravessam todos os módulos

Estas regras são **arquitetura oficial** e não são renegociáveis por conveniência
técnica. Estão travadas por testes-guarda (`scripts/*guard*.test.ts`).

| # | Princípio | Onde vive |
|---|---|---|
| P1 | **Uma implementação oficial por domínio.** Proibida segunda fonte de verdade, motor paralelo ou arquitetura concorrente. | transversal |
| P2 | **Estender antes de criar.** Conceito novo só ganha model novo se for conceito realmente novo. | transversal |
| P3 | **Nunca decidir por nome/label.** Fase, escopo, natureza de documento, elegibilidade — tudo por chave estrutural/enum/FK. Proibido `if (nome.includes(...))`. | `fases-catalog.ts`, `natureza-certidao.ts`, `catalogo.ts` |
| P4 | **Histórico é append-only.** Supersessão em vez de update destrutivo (`supersedePorId`, `previousInstanceId`, `previousStepInstanceId`, `NomePessoa.supersedidoPorId`). | schema |
| P5 | **Idempotência obrigatória** em toda escrita de motor: `chaveIdempotencia @unique` + convergência em P2002. | todos os serviços de motor |
| P6 | **Transacionalidade**: efeito + evento + outbox na MESMA transação. | `phase-advance.ts`, `documento-operacao.ts` |
| P7 | **Dado nunca é apagado** — perde elegibilidade, é arquivado ou superseded. Hard delete só via `sistema.exclusaoDefinitiva` (opt-in, ADMIN, frase de confirmação). | `exclusao-definitiva.ts` |
| P8 | **Sem botão morto**: toda ação visível nasce com handler + endpoint + persistência + feedback. Sem backend ⇒ desabilitada com tooltip honesto. | UI |
| P9 | **Um só Design System.** Tela recebe *skin*, nunca redesign. Token-first (`globals.css`), kit oficial `src/components/financeiroComponents/ui/kit.tsx`. Exceção documentada única: a Árvore Genealógica (superfície clara). | UI |
| P10 | **Claude implementa, não arquiteta.** Havendo duas leituras, vale a documentada. | processo de trabalho |
| P11 | **Produção é patrimônio.** Mudança aditiva/reversível; migration em prod só pelo mecanismo `MIGRATE_ON_BUILD=1` + `EU_CONFIRMO_ESCRITA_EM_PRODUCAO`, uma por deploy, e as envs são removidas depois. | `scripts/prod-migrate-guard.mjs` |
| P12 | **Ambiente oficial** = V2 em Postgres (`PRISMA_DATABASE_URL`). Homologação = Neon (Preview). Banco V1/legado nunca é destino. | `homolog-baseline.mjs` |

---

## 1. Árvore Genealógica

### 1.1 O que foi definido arquiteturalmente

A Árvore é um **motor**, não um desenho. O layout é calculado por algoritmo
próprio, em camadas, **sem sobreposição por construção** — proibido resolver
colisão com passada corretiva posterior. Substituiu `dagre` + React Flow, ambos
removidos.

A referência funcional e visual é o **FamilySearch Family Tree**: fidelidade tem
prioridade sobre criatividade; onde há solução consolidada lá, ela é adotada aqui
(reimplementada — nenhum código, marca ou ativo copiado). Não se usa o termo
"inspirada".

**Limite de escopo constitucional:** a árvore **mostra e leva; não gere**. Ela LÊ
situação documental e SUGERE pesquisa. Não cria, não versiona, não aprova, não
exclui documento. Travado em teste de guarda.

### 1.2 O que já foi implementado

- Motor puro isomórfico (sem Prisma, sem rede): índice de grafo O(1), fonética
  PT/IT/ES/DE + Levenshtein/Jaro-Winkler com memo, regras determinísticas.
- Layout familiar próprio + slots vagos ("lugares vagos") posicionados fora do
  motor de layout, descartando qualquer posição colidente.
- Câmera própria com inércia, canvas virtualizado, conectores SVG com barramento
  de irmãos, minimapa, paleta **Localizar**, painel de inteligência, painel de
  estatísticas.
- 4 vistas: **Paisagem**, **Retrato**, **Leque** (SVG radial, endereçamento Sosa,
  "colorir por"), **Descendência** (lista outline virtualizada — nunca grafo).
- Autorização server-side nas rotas de árvore/pessoa/união.
- Cálculo de parentesco, histórico de navegação próprio, isolar ramo, trilha
  genealógica, abertura centrada no requerente.
- Painel lateral operacional de 6 abas sobre o canvas (sem perder zoom/posição).
- Timeline como **projeção** (`motor/eventos.ts`) — não persiste.
- Filtros que **realçam**, nunca escondem (`navegacao/filtros.ts`).
- Página da pessoa com 5 abas: Sobre · Detalhes · Fontes · Auditoria · Linha do tempo.

Status: **EM MAIN** (linha da Árvore reconciliada com a main no merge `f54d38c`).
Migrations MDM (`20260828000000_mdm5_nome_pessoa`, `20260828000001_mdm3_decisao_dedup`)
constam do diretório de migrations.

### 1.3 Entidades

`Arvore`, `Pessoa`, `Uniao`, `Familia`. A árvore pertence a uma `Familia`
(`Arvore.familiaId`, nullable por backfill). `Arvore.pessoaPrincipalId` é único.
Não existe entidade "nó", "card" ou "layout" persistida — posição é derivada
(`Arvore.posicoesNodes` e `Pessoa.x/y` são resíduo legado, o motor não depende deles).

### 1.4 Serviços

`src/lib/genealogia/motor/` — `grafo.ts`, `texto.ts`, `parentesco.ts`, `busca.ts`,
`eventos.ts`, `facetas.ts`, `analisar.ts`, `tipos.ts` e `regras/{cronologia,
duplicidade,linhagem,sugestoes,pesquisa,completude}.ts`.
`src/lib/genealogia/layout/` — `layout-familiar.ts`, `fantasmas.ts`.
`src/lib/genealogia/navegacao/` — `filtros.ts`, `historico.ts`, `ramos.ts`.
`src/lib/genealogia/documental/indicadores.ts` — lê situação documental.
`src/lib/genealogia/vincular-requerente.ts` — único ponto que dedupa via `Requerente.personId`.

### 1.5 Telas

`src/components/arvore/` — `arvore-genealogica-view.tsx`, `index.tsx`,
`pessoa-details-page.tsx`, `requerente-selector.tsx`, `checagem-duplicidade.tsx`,
`tree-onboarding.tsx`; e `motor/` — `arvore-canvas`, `arvore-inteligente`,
`camada-conectores`, `cartao-pessoa`, `cartao-retrato`, `controles-arvore`,
`minimapa`, `painel-estatisticas`, `painel-inteligencia`, `painel-pessoa`,
`paleta-comandos`, `vista-descendencia`, `vista-leque`, `use-arvore-motor`,
`use-viewport`, `tokens.ts`.
Harness de validação visual: rota `/arvore-render?caso=&vista=&gaveta=`.

### 1.6 Regras de negócio

- **REGRA ABSOLUTA (Paisagem):** cada cônjuge tem **card próprio**, com folga
  visível; o vínculo conjugal é conector, não container; a folga conjugal é sempre
  menor que a folga entre famílias (mínimo 4px, mesmo com configuração 0); a linha
  parental nasce da **âncora da união** (nó lógico invisível), não da borda de um
  cônjuge; o dado do casamento é rotulado sobre o conector. Provada por
  `scripts/arvore-casal-cards.test.ts` (32 asserções) + cenário DOM.
- **Limite geracional** padrão 4, com "+" por ramo (`fronteiraGeracional` +
  `EstadoRamos.expandidos`). Buscar alguém além do limite **tem** de revelá-lo —
  `expandirAte` não pode ter atalho de saída antecipada.
- **Dobra de ramo é da FAMÍLIA:** a barreira verifica-se no filho; senão vaza pelo cônjuge.
- Clique no card abre o **cartão rápido** (popup em coordenadas de tela); a gaveta
  abre por ação dentro do popup, já na aba certa.
- Expansão: 2 gerações por clique; clicar de novo recolhe.
- Lugares vagos: papéis `pai`, `mae`, `conjuge`, `filho`. Nenhum registro criado,
  nenhuma pessoa fictícia no grafo.
- Criação de Pessoa é **travada** atrás de checagem obrigatória no Cadastro Mestre
  (`GET /api/pessoas?busca=`), com opção de vincular existente.
- Card = retrato circular + nome + período + lugar, no máximo 2 sinais pequenos.

### 1.7 Decisões arquiteturais tomadas

- Layout algorítmico próprio (não biblioteca de grafos). Mexer no layout = mexer
  no algoritmo, jamais adicionar passada de correção.
- Layout é **sempre automático**: arrastar card e "Reorganizar" foram removidos e
  são reprovados pelo guard `4b`.
- Removidos por serem invenção sem equivalente na referência: minimapa fixo
  permanente (voltou como minimapa da referência), barra de filtros avançados,
  densidade compacta/confortável (virou **Opções de exibição**: retratos/datas/
  lugares/códigos, com altura do card derivada), "Recolher colaterais"/"Expandir
  tudo", medidor de zoom em %, seletor de vista segmentado (virou dropdown),
  paleta que listava funções (virou **Localizar**). "Índice de sobrenomes/lugares"
  virou **Estatísticas da árvore**.
- Sem aba "Recordações" (não há módulo oficial de mídia de pessoa).
- Sem mapa: o Discovery não guarda coordenada; geocodificar em silêncio seria
  inventar dado. O painel "Lugares" lista localidades reais por contenção literal
  de segmentos.
- "Colaborar" da referência foi mapeado para **Auditoria**.
- Removidos por duplicação: `react-flow-tree.tsx` e `genealogical-tree.tsx`.

### 1.8 Premissas permanentes

- **Superfície CLARA** (papel `#f4f5f6`, cards brancos, bordas cinza discretas,
  conectores cinza, sem grade). Exceção documentada e única ao DS escuro; vale só
  para este módulo.
- `src/components/arvore/motor/tokens.ts` é o **único** lugar com cor do módulo e
  define literais claros. **NÃO** herda `--surface-overlay` / `--app-background` /
  `--surface-popover` (herdar traz o preto de volta). O acento institucional
  dourado vem de `--accent-primary`; texto sobre branco usa `TREE.acentoTexto`.
- Hover usa `.arv-hover` / `.arv-hover-suave` (declaradas em `CSS_MOVIMENTO_REDUZIDO`
  no próprio tokens.ts) — nunca classe utilitária com cor entre colchetes.
- Tokens de dimensão/folga vivem só em `tokens.ts` (`FOLGAS`, `CARTAO_LARGURA`,
  `RETRATO_LARGURA`, `CONTROLE`, `MINIMAPA`); o layout recebe folgas via
  `OpcoesLayout.folgas`.
- **Regra de decisão:** em qualquer escolha de interface, navegação, layout, fluxo,
  interação, posicionamento ou microinteração, a referência é o FamilySearch.
  Consultar a documentação pública ANTES de decidir, nunca de memória.
- Checklist viva obrigatória: `src/components/arvore/CONFORMIDADE.md` (tabela
  item-a-item ✓/△/✗ com as URLs consultadas), atualizada a cada mexida.

### 1.9 O que NÃO pode ser alterado

1. A árvore não gere documento (travado em guarda).
2. Um card por cônjuge em Paisagem (travado por 32 asserções + cenário DOM).
3. Superfície clara; nada de fundo escuro, grid, badge de papel/parentesco/país
   no card, anel de completude, barra de ferramentas extensa.
4. Layout automático; sem arrastar card.
5. Cor do módulo só em `motor/tokens.ts`.
6. Limite geracional com revelação obrigatória na busca.
7. Descendência como lista outline — nunca grafo.

**Suítes:** `npm run test:arvore` (motor + B1/B2/B4/B6 + FS + casal + guarda +
escala), `test:arvore-casal`, `test:arvore-visual` (referências versionadas em
`tests/visual/arvore/`), `test:arvore-e2e`, `test:arvore-escala`.

---

## 2. Genealogia (a FASE do processo)

Distinção obrigatória: **Árvore Genealógica** é o módulo de visualização/edição
do grafo familiar; **Genealogia** é a **primeira fase do Workflow Macro**.

### 2.1 Definição arquitetural

- `FaseCode.GENEALOGIA`, `phaseKey = "genealogia"`, `ordem 0`, `kind "documento"`,
  **`scope: "NECESSIDADE"`**, `next: EMISSAO_DOCUMENTAL`.
- Na Genealogia **localiza-se o registro civil**. Solicitar/obter a certidão é da
  fase de Emissão. Consequência: **um único stepKey canônico — `localizar_registro`**
  ("Localizar registro da certidão"), peso 100, SLA 5 dias.
- A Genealogia trabalha **exclusivamente com CERTIDÕES**, definidas pela
  **classificação estruturada** `TipoDocumentoCadastro.nature === "certidao"` —
  nunca por texto/nome.

### 2.2 O que já foi implementado — EM PRODUÇÃO

**Desativação do legado (commit `ac95f34`, 16/07):** `POST`/`PUT /api/pessoas` não
chamam mais `reconcileDocsForPessoa`; criar/editar Pessoa **não gera Documento**.
`reconcileDocsForPessoa`/`reconcileAllForArvore` marcados `LEGADO_INATIVO` com
guard de runtime `__assertGeracaoDocumentalDesativada()`. `/api/pessoas/[id]/reconcile`
→ **410**. `analyzePessoa`/`DOCUMENT_RULES` permanecem **puros** (consumidos por
`necessidade-documental.ts` e `matriz-economica.ts`).

**Materialização (Fatia 2, commit `3eb7389`):** `src/services/genealogia/materializar-genealogia.ts`
avalia as **Regras Documentais publicadas** exigidas na Genealogia
(`faseExigencia`/`faseBloqueio = genealogia`; protocolo fica de fora) por Pessoa →
`garantirNecessidade` idempotente (`varianteKey = rd:{codigo}:v{versao}`, snapshot,
`origem = MATRIZ`) + passo canônico vinculado à necessidade. Reconciliação:
DISPENSADA reversível / reabre. **NÃO cria Documento, NÃO avança, NÃO cria tarefa.**
Gatilhos best-effort em `POST`/`PUT /api/pessoas` + `POST /api/processos/[id]/genealogia/sincronizar`.

**Elegibilidade estrutural (commit `c64e968`):** `src/lib/documentos/natureza-certidao.ts`
(`ehNaturezaCertidao` / `itemCatalogosDeCertidao` / `codesDeCertidao`). O
`materializar-genealogia` só materializa necessidade+passo para documento de
natureza certidão; o BlockingEngine na Genealogia **ignora** necessidades
não-certidão (filtra por `itemCatalogo`).

**Operação da necessidade (commits `a8e89b5`, `4e46b99`, `72bcddd`, `254e8ff`):**
`POST /api/processos/[processoId]/genealogia/operacao {necessidadeId}` garante/reusa
o `Documento` da necessidade (idempotente, com `pg_advisory_xact_lock(741852, id::int4)`)
e liga o passo `localizar_registro`. Delegação:
`PATCH /api/processos/[processoId]/genealogia/delegar {necessidadeId, responsavelId}`
grava `PhaseWorkflowStepInstance.responsavelId` **sem criar Documento**.
"Iniciar operação" não aparece na Genealogia (o passo já nasce materializado).

### 2.3 Entidades

`NecessidadeDocumental` (+ `NecessidadeDocumentalEvento`), `Documento`,
`PhaseWorkflowInstance` / `PhaseWorkflowStepInstance` (fase `genealogia`),
`ItemCatalogo`, `TipoDocumentoCadastro`, `MatrizDocumental` (Regras Documentais).

### 2.4 Serviços

`services/genealogia/materializar-genealogia.ts` (`materializarGenealogia`,
`regrasGenealogiaDoProcesso`, `exigidaNaGenealogia`, `aplicaAoProcesso`,
`contextoDaPessoa`, `dispararMaterializacaoPorArvore`),
`services/genealogia/emitir-evento-requerente.ts`,
`services/necessidade-documental.ts`, `lib/documentos/natureza-certidao.ts`,
`services/documento-operacao.ts`, `services/processEngine/stepCompletionResolver.ts`.

### 2.5 Telas

Fase Genealogia dentro da **Central Operacional do Processo**:
`ProcessoCentralOperacional.tsx` → `PainelDaFase.tsx` → fila de necessidades →
**Abrir operação** → `DocumentoOperationalDrawer` → aba Workflow → passo
`localizar_registro` → `EditorRegistralModal`. Abas do drawer filtradas por
`workflow.faseCode` (oculta Divergências/Anexos/Tentativas/Auditoria).
Tela auxiliar `/genealogy` (busca de pessoas/documentos, `/api/genealogy/pesquisar/*`,
`/api/genealogy/estatisticas`).

### 2.6 Regras de negócio

- Gate da Genealogia é lido por **STEP_INSTANCE** (`localizar_registro`), **não**
  por `NecessidadeDocumental.status`. Resolver a necessidade exige **concluir o passo**.
- Conclusão do passo = front (Cartório) **+** (Livro | Folha | Termo), definida em
  `stepCompletionResolver.temDadosRegistrais` / `docFact.located`.
- Bloqueios estruturais do escopo NECESSIDADE (em `computeGate`):
  `NECESSIDADE_NAO_GERADA` (nenhuma necessidade de certidão gerada),
  `GENEALOGIA_SEM_ARVORE`, `GENEALOGIA_SEM_REQUERENTE`.
- O motor **pula** passos `localizar_registro` órfãos (`necessidadeId = null`) ou de
  necessidade **DISPENSADA** — escopado à Genealogia.
- Necessidade **"não localizada" mantém bloqueio**; só DISPENSAR destrava. A saída
  oferecida é criar uma **Operação Antecipada**.
- Reabertura de passo **regride** a necessidade (ATENDIDA/NAO_LOCALIZADA →
  EM_ATENDIMENTO) transacionalmente.

### 2.7 Decisões arquiteturais

- `localizar_registro` é o **único** stepKey canônico da Genealogia. Os aliases
  `buscar_documento` e `buscar_certidao` foram eliminados em código e em produção
  (7 step instances renomeadas com chave; 1 `buscar_certidao` legado SUPERSEDIDO).
- Gate por `toUpperCase() === "GENEALOGIA"` (cobre phaseKey minúscula e FaseCode).
- Métricas/agregados legados da Genealogia na Central foram **neutralizados**
  (`genealogiaReestruturacao` + `mensagemReestruturacao`; `PainelDaFase` ganhou
  `modoReestruturacao`). Só afeta GENEALOGIA.

### 2.8 Premissas permanentes

- Não religar o gerador documental antigo.
- Elegibilidade documental da Genealogia **sempre** pela natureza estruturada.
- A materialização não cria Documento nem Tarefa nem avança fase.

### 2.9 O que NÃO pode ser alterado

1. `localizar_registro` como stepKey único.
2. Genealogia = certidões, por `nature`, nunca por nome.
3. Escopo declarado `NECESSIDADE` em `FaseDef.scope`.
4. Gerador documental legado permanece desativado (guard de runtime lança).
5. Gate por step instance, não por status da necessidade.

**Suítes:** `test:genealogia-guard` (20), `test:genealogia-fatia1`,
`test:genealogia-materializacao` (11), `test:genealogia-central-v2`.

**Pendência declarada (Fatia 3, não implementada):** progresso da Central por
passos (des-neutralizar `genealogiaReestruturacao`) e reconciliação dos passos
legados do antigo desenho de 5 passos remanescentes em instâncias antigas.

---

## 3. Interessados

**NÃO EXISTE** no Discovery uma entidade, serviço, tela, rota ou termo
"Interessado" — a busca por `interessad` em `src/`, `prisma/` e `docs/` retorna
zero ocorrências.

O conceito de "parte com interesse no processo" é modelado por **papéis
contextuais distintos**, todos apontando para a identidade humana única `Pessoa`:

| Papel | Entidade | Vínculo com identidade | Vínculo com processo |
|---|---|---|---|
| Contratante (cliente que contrata) | `Contratante` | `personId → Pessoa` | `ProcessoContratante` |
| Requerente (quem requer a cidadania) | `Requerente` | `personId → Pessoa` | `ProcessoRequerente` |
| Pessoa da árvore | `Pessoa` | é a própria identidade | via `Arvore.processos` |
| Participante econômico da Receita | `ReceitaRequerente`, `ParticipacaoEconomica`, `DistribuicaoEconomica` | via `Requerente.personId` | via Receita/Obrigação |
| Pagador | `Pagador` | — | via Obrigação Econômica |
| Parte externa (cartório, tradutor, órgão) | `ParteExterna`, `Fornecedor`, `OrgaoProtocolo` | — | via Custo/Protocolo |

### Definição arquitetural vigente (CP-1)

**`Pessoa` é a identidade humana única.** `Contratante` e `Requerente` são
**papéis contextuais** que apontam para ela (`personId`, nullable por backfill).
A mesma pessoa pode ser contratante em um processo e requerente em outro sem
duplicar identidade.

### Regras de negócio implementadas

- **Dedup VISUAL de participantes** por `Requerente.personId`, via helper puro
  `dedupPorPessoa` (`lib/financeiro/identidade/dedup-pessoa.ts`), aplicado no
  seletor de criação (`LancamentoManualModal`) e nos disponíveis da distribuição
  (`redistribuir-service`). **EM PRODUÇÃO** (commit `b177f21`, sem migration).
- **Invioláveis:** dedup exclusivamente por `personId` — nunca por nome, CPF ou
  similaridade; requerentes sem `personId` ficam individuais; **nunca** funde,
  exclui ou altera Pessoa.
- Dedup visual ≠ consolidação financeira: valores, papéis, cobranças, parcelas e
  pagamentos continuam agregados nas telas de participação.
- Duplicidade real (mesmo `personId` em mais de um requerente) vira **pendência
  logada** (`registrarPendenciaReconciliacao`) para o futuro motor transversal de
  Reconciliação de Identidade do Cadastro Mestre.
- `GENEALOGIA_SEM_REQUERENTE` bloqueia a fase quando `ProcessoRequerente.count === 0`.
- Vinculação requerente↔árvore: `POST /api/arvore/[arvoreid]/vincular-requerente`
  (`lib/genealogia/vincular-requerente.ts`), única rotina que dedupa via
  `Requerente.personId`.

### O que NÃO pode ser alterado

1. Não inventar entidade "Interessado" — o modelo oficial é papel-sobre-`Pessoa`.
2. Nunca fundir Pessoa por heurística (merge foi **vetado**; é destrutivo).
3. Fusão oficial de Pessoa, quando existir, pertence ao **Cadastro Mestre** — não
   à árvore, não ao financeiro.

---

## 4. Relacionamentos Familiares

### 4.1 O que está definido e implementado

O parentesco é modelado por **FK direta na `Pessoa`**:

- `Pessoa.paiId` → `Pessoa` (relação `FilhosPai`)
- `Pessoa.maeId` → `Pessoa` (relação `FilhosMae`)
- `Pessoa.linhaReta: Boolean` (default `true`) — marca a linha de transmissão
- `Pessoa.numeroLinhagem: Int?`
- `Pessoa.casado: Boolean`, `Pessoa.documentacao: Boolean`

A **união conjugal** é a única relação com entidade própria: `model Uniao`
(`pessoa1Id`, `pessoa2Id`, `tipo`, `data_inicio`, `data_fim`, `local`, `estado`,
`pais`, e dados registrais completos: `cartorio`, `livro`, `folha`, `termo`,
`numero_registro`, `data_registro`, `observacoes`). A `Uniao` pode ser sujeito de
`NecessidadeDocumental` (`uniaoId`) — o CHECK do banco impõe `pessoaId` **XOR** `uniaoId`.

Sobre essa base, o motor calcula (sem persistir): parentesco
(`motor/parentesco.ts`), linhagem (`regras/linhagem.ts`), cronologia
(`regras/cronologia.ts`), duplicidade (`regras/duplicidade.ts`), completude,
sugestões e pesquisa.

### 4.2 Identidade e nomes — MDM (Master Data Management)

**MDM-5 — `NomePessoa`** (nomes alternativos/aliases). Migration
`20260828000000_mdm5_nome_pessoa`. Campos: `nome`, `sobrenome`, `tipo`
(`REGISTRAL | NASCIMENTO | CASADA | RELIGIOSO | GRAFIA_DOCUMENTO | APORTUGUESADO |
IMPORTADO`), `principal`, `chaveFonetica` (**derivada** por `motor/texto.ts`,
nunca editável, indexada — é o que faz "Bianqui" encontrar "Bianchi").
Contrato de **afirmação auditável** (`src/lib/cadastro-mestre/afirmacao.ts`,
escala única + 5 regras anti-"hipótese-vira-fato"): `origem`, `confianca`,
`responsavelId`, `afirmadoEm`, `justificativa`, `evidenciaNecessidadeId`.
Histórico append-only: `ativo`, `supersedidoPorId` (@unique), `chaveIdempotencia`.

**MDM-3 — `DecisaoDeduplicacao`** (`src/lib/cadastro-mestre/dedup.ts`). Migration
`20260828000001_mdm3_decisao_dedup`. Registro auditável de **cada** criação de
Pessoa que passou por triagem: `chaveDedup`, `candidatosAvaliados` (snapshot
imutável dos candidatos exibidos **com score e evidências**), `nivelTriagem`
(`BLOQUEIO | CONFIRMACAO | INFORMATIVO | LIVRE`), `decisao`
(`CRIOU_NOVA | VINCULOU_EXISTENTE`), `pessoaResultanteId`, `justificativa`,
`decididoPorId`, `chaveIdempotencia`.
Rota: `POST /api/pessoas/triagem`.

**Razão do snapshot:** sem os candidatos e scores exibidos não há como distinguir
erro humano de falha do algoritmo quando uma duplicata entra.

### 4.3 Serviços

`services/identity.ts` (chave de dedup), `services/cadastro-mestre/nome-pessoa.ts`,
`lib/cadastro-mestre/dedup.ts`, `lib/cadastro-mestre/afirmacao.ts`,
`lib/genealogia/motor/parentesco.ts`, `services/familia.ts`.

### 4.4 Telas

Painel de pessoa da árvore (`motor/painel-pessoa.tsx`), página da pessoa
(`pessoa-details-page.tsx`), `checagem-duplicidade.tsx`, `requerente-selector.tsx`.

### 4.5 O que NÃO existe (lacunas de domínio declaradas — bloqueiam B2–B8 da Árvore)

Estas ausências são **fato arquitetural registrado**, não omissão de levantamento.
Criar qualquer uma exige decisão de arquitetura do usuário:

1. **Relação familiar como entidade** — hoje é FK direta (`paiId`/`maeId`). Sem id
   próprio, sem tipo, sem período, sem confiança, sem auditoria.
2. **Evento de vida genealógico** — `model Evento` existe mas é **agenda do
   processo** (título/responsável). Eventos de vida são colunas inline em `Pessoa`
   e `Uniao`. A timeline é projeção dessas colunas, sem tabela nova.
3. **Serviço oficial de FUSÃO de Pessoa** — inexistente. Pertence ao Cadastro Mestre.
4. **Pesquisa genealógica** como entidade (hipótese/status/responsável) — inexistente.
5. Sem GEDCOM, sem geocodificação, sem comentários/menções, sem foto de pessoa.

Pendência conhecida do MDM: tornar `decisaoDedupId` **obrigatório** em
`POST /api/pessoas` (F3) ainda não foi feito.

**Suítes:** `test:mdm5` (80), `test:mdm3`, `test:mdm`, `test:arvore-dedup`.

---

## 5. Gestão Documental

### 5.1 Definição arquitetural — a cadeia canônica (CP-3)

```
Documento Mestre (ItemCatalogo)
  → Necessidade Documental (NecessidadeDocumental)
    → Documento Operacional (Documento)
      → Arquivo (arquivo_url / anexos em R2)
        → Tarefa
          → Custo / Receita
            → Auditoria
```

Cada elo é uma entidade real. Um `ItemCatalogo` é o **documento mestre**
(identidade única, `code` estável). A `NecessidadeDocumental` é a **exigência**
daquele item para um sujeito (`pessoaId` XOR `uniaoId`) num processo. O
`Documento` é a **via concreta** — 1 necessidade pode ter N documentos (múltiplas
vias). O arquivo físico vive em R2/S3.

### 5.2 Entidades

| Entidade | Papel |
|---|---|
| `ItemCatalogo` | documento/serviço mestre; `code` único, `natureza`, `unidade` |
| `TipoDocumentoCadastro` | tipo documental; `nature` (certidao/identidade/documento/apostila/traducao), `categoriaDocumentalId`, `itemCatalogoId`, `legacyEnumKey` |
| `CategoriaDocumental` | classificação canônica (`code` imutável, `sistema` para bootstrap) |
| `MatrizDocumental` | **Regras Documentais** (ver §12) |
| `NecessidadeDocumental` | exigência viva; status, obrigatoriedade, ciclo, supersessão, snapshot da regra |
| `NecessidadeDocumentalEvento` | histórico append-only da necessidade |
| `Documento` | documento operacional (dados registrais, arquivo, tradução, apostila, operação) |
| `AnexoProcesso`, `AnexoContratante`, `AnexoRequerente`, `AnexoProtocolo`, `AnexoInformacaoItalia` | anexos por contexto |
| `ModeloDocumento` | modelos documentais (cadastro) |
| `PastaTraducao` / `PastaTraducaoDocumento` | pasta de tradução juramentada |
| `PastaApostilamento` / `PastaApostilamentoDocumento` | pasta de apostilamento |
| `RetificacaoPacote`, `EmissaoRetificada` | pacotes da via retificatória |
| `ReceitaDocumento` | vínculo documento ↔ receita |

**Enums:** `StatusDocumento`, `TipoDocumento` (legado, ponte via `legacyEnumKey`),
`OrigemNecessidade` (`ARVORE | MATRIZ | MANUAL | MIGRACAO`),
`ObrigatoriedadeNecessidade`, `StatusNecessidade` (`PENDENTE | EM_ATENDIMENTO |
ATENDIDA | NAO_LOCALIZADA | DISPENSADA`), `TipoEventoNecessidade`.

### 5.3 Campos relevantes do `Documento`

Identificação registral (`cartorio`, `livro`, `folha`, `termo`, `numero_registro`,
`data_registro`, `matricula`, `crc`, `protocolo`, `comune`), identificação literal
como aparece na certidão (`nome_registrado`, `pai_registrado`, `mae_registrada`,
`conjuge_registrado`), arquivo (`arquivo_url/nome/tamanho/mime_type`), tradução
(`traduzido`, `tradutor`, `arquivo_traducao_url`), apostila (`apostilado`,
`numero_apostila`, `arquivo_apostila_url`), rastreamento da solicitação
(`nro_pedido`, `canal_solicitacao`, `link_acompanhamento`, `localizacao_fisica`),
operação (`responsavelId`, `dataInicioOperacao`, `dataPrazoOperacao`,
`ultimaMovimentacao`, `motivoBloqueio`), origem (`origem`, `ruleCode`), vínculos
(`documentTypeId`, `necessidadeId`, `pessoaId`).

⚠️ **GOTCHA de produção:** `Documento.origem` tem CHECK `Documento_origem_check`
que só admite `'manual' | 'automatica'`. Documento criado pelo sistema **deve**
usar `origem: 'automatica'` — qualquer outro valor viola o CHECK (23514) → 500.

### 5.4 Serviços

`services/necessidade-documental.ts` — `garantirNecessidade`,
`resolverNecessidadeDeDocumento`, `marcarNaoLocalizada`, `retornoGenealogia`,
`reabrir`, `iniciarAtendimentoNecessidade`, `atenderNecessidade`,
`dispensarNecessidade`, `reativarNecessidade`, `evoluirNecessidadePorPasso`,
`reabrirAtendimentoNecessidade`, `reconciliarNecessidadesPorPassos`,
`garantirNecessidadesArvoreDoProcesso`, `garantirNecessidadesDaMatriz`.

`services/documento-operacao.ts` — `passosOperacaoV2`, `temOperacaoV2`,
`progressoOperacaoV2`, `montarWorkflowV2`, `iniciarOperacaoDocumentoV2`,
`garantirOperacaoDocumentoV2`, `atualizarPassoV2`, `controlarOperacaoV2`,
`sincronizarStatusPassoV2`, `workflowsOperacaoV2PorProcesso`.

`lib/documentos/natureza-certidao.ts`, `lib/document-type-resolver.ts`,
`lib/document-category-map.ts`, `lib/document-generator.ts` (**LEGADO_INATIVO** —
só `analyzePessoa`/`DOCUMENT_RULES` puros seguem em uso),
`lib/process-stage/document-operational-projection.ts`, `lib/r2.ts`, `lib/storage.ts`.

### 5.5 Telas

- Processo → **Documentos** (`ProcessoDocumentos.tsx`) e **Biblioteca de
  Documentos** (`ProcessoDocumentosBiblioteca.tsx` + `DocumentoBibliotecaDrawer.tsx`).
- **Drawer operacional do documento** (`DocumentoOperationalDrawer.tsx`) +
  `TabOperationCockpit.tsx` + `OpManageModal.tsx`.
- Gerenciamento → Documentos e Protocolos: **Tipos de Documento**
  (`TiposDocumentoTab`), **Categorias Documentais** (`CategoriasDocumentaisTab`),
  **Tipos de Protocolo**, **Regras Documentais** (`RegrasDocumentaisTab`), e
  ocultos: `certtypes`, **`docmatrix`** (Matriz Documental — visão técnica),
  `protocols`, `prottypes-rascunho`.
- `DocumentCategorySelector.tsx`.

### 5.6 Rotas

`/api/documentos` (POST), `/api/documentos/[id]` (GET/PUT/DELETE/PATCH),
`/api/documentos/[id]/workflow`, `/api/documentos/[id]/workflow/steps/[stepId]`,
`/api/documentos/[id]/operational-projection`,
`/api/processos/[processoId]/documentos`,
`/api/processos/[processoId]/necessidades` e `/necessidades/[necessidadeId]`,
`/api/storage/presign`, `/api/app/upload/presign`.

### 5.7 Regras de negócio

- 1 necessidade → N documentos (múltiplas vias). O vínculo é `Documento.necessidadeId`.
- Necessidade **DISPENSADA** não bloqueia e seu passo é ignorado pelo motor.
- Necessidade tem **ciclo** e **supersessão**: nova necessidade supersede a
  anterior, que é preservada.
- `varianteKey` + `chaveIdempotencia` garantem materialização idempotente.
- Snapshot imutável da regra que originou (`matrizRegraId`, `matrizRegraVersao`,
  `matrizSnapshot`, `avaliadaEm`, `motivoAplicabilidade`).
- Lazy-create de Documento a partir da necessidade é idempotente por advisory lock.
- Permissões que gateiam a API documental: `arvore.criar_documento`,
  `arvore.editar_documento`, `arvore.excluir_documento` (as rotas `/api/documentos*`
  ainda as usam; a **UI da árvore** deixou de exercê-las).

### 5.8 Decisões arquiteturais

- Fonte única de classificação = `CategoriaDocumental` por **ID/code**; a coluna
  `TipoDocumentoCadastro.category` (String) é compatibilidade transitória
  (dual-read/dual-write) e **não** deve ser removida ainda.
- `nature` (subtipo técnico) é **eixo distinto** de `categoriaDocumentalId`
  (classificação administrativa).
- FK `categoriaDocumentalId` com `onDelete: Restrict` — impede desclassificação
  silenciosa via SQL cru.
- Progressão por-documento: concluir a etapa N de um documento libera a etapa N+1
  **daquele documento**; o gate "todos prontos" é do avanço de fase.
- Escopo por fase: `passosOperacaoV2`/`temOperacaoV2` filtram por
  `faseMacroKey = processo.faseAtualKey` (um mesmo Documento acumula passos de
  várias fases).
- Materialização automática da operação por documento ao **abrir** o drawer
  (`garantirOperacaoDocumentoV2`); "Iniciar operação" não é o fluxo normal.

### 5.9 O que NÃO pode ser alterado

1. A cadeia canônica CP-3 e o sentido de cada elo.
2. `Documento.origem ∈ {manual, automatica}`.
3. Gerador documental legado desativado.
4. Filtro de escopo por fase na leitura de passos do documento.
5. Nenhum cadastro documental paralelo — Tipos e Categorias são fonte única.

### 5.10 Débito técnico declarado

O **status mestre do `Documento` fica defasado** em relação ao workflow (pode
estar `RECEBIDO` com o workflow já validado). Sincronizar status↔workflow é
tarefa separada, **pendente**.

---

## 6. OCR

**NÃO EXISTE.**

Verificação: busca por `ocr` em `src/`, `prisma/` e `package.json` retorna apenas
falsos positivos de substring (`docrules`, `inicioCronograma`, `erroCriar`,
`DocRow`, `algumCampoCriticoMudou`). Não há `tesseract`, `textract`, Google Vision,
nem qualquer dependência de reconhecimento óptico no `package.json`.

Não há:
- entidade de OCR, job de OCR, fila de OCR;
- campo que armazene texto reconhecido;
- serviço, rota ou tela de OCR;
- regra de negócio que dependa de OCR.

O que existe e pode ser confundido com OCR: **upload e armazenamento** de arquivo
(`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, `lib/r2.ts`,
`lib/storage.ts`, rotas `/api/storage/presign` e `/api/app/upload/presign`) e
**leitura de PDF no navegador** (`react-pdf`) — ambos manipulam o arquivo, não o
seu conteúdo textual.

---

## 7. Extração de Dados

**NÃO EXISTE extração automática de dados de documento.** Não há nenhum SDK de
IA/LLM no projeto (nenhum `openai`, `@anthropic-ai/*`, `@google/genai`,
`langchain` — a lista completa de dependências foi verificada).

O que existe é **preenchimento estruturado manual** com marcação de proveniência:

- `Documento.structuredData: Json?` — dados estruturados por tipo
  (nascimento/casamento/óbito).
- `Documento.dataStatus: String` — `not_filled | ai_extracted | manual_filled | reviewed`.
  O valor `ai_extracted` **existe no vocabulário do campo mas não é produzido por
  nenhum código** — não há produtor de extração automática.
- `Documento.analysisStatus: String` — `not_ready | ready`.
- `Documento.registral: Json?` — dados registrais revisados (**verdade canônica**).

O preenchimento é feito por humano, principalmente pelo `EditorRegistralModal`
(passo `localizar_registro`) e pelas telas de Análise Documental v2
(`/api/processos/[processoId]/analise-v2/documentos/[docId]`).

**Regra vigente:** `registral` é a verdade canônica; `structuredData` é o
preenchido; `dataStatus` declara a proveniência do preenchimento.

**O que NÃO pode ser alterado:** o vocabulário de `dataStatus` (é contrato de
proveniência) e a precedência de `registral` como verdade canônica.

---

## 8. Validação Documental

Existe, mas **como conferência determinística e decisão humana** — não como
validação automática por IA.

### 8.1 Dois níveis distintos

**(a) Validação operacional por documento** — passos do Workflow Interno da fase
de Emissão:
`conferir_certidao` ("Inspeção operacional: legibilidade, integridade, dados
mínimos, apostila, tradução") → `validar_certidao` ("Decisão jurídica final ·
marca documento como Recebido"). O mesmo par existe nas outras fases:
`conferir_certidao_retificada`/`validar_certidao_retificada`,
`conferir_traducoes`/`validar_pasta_traduzida`,
`conferir_apostilas`/`validar_pasta_apostilada`, `validar_registros`,
`validar_localizacao`.

**(b) Análise Documental (fase `ANALISE_DOCUMENTAL`)** — comparação
**árvore × documento**, geração de divergências, decisão humana e decisão jurídica.

### 8.2 Entidades

`AnaliseDocumental` — 1:1 com o processo. `status`
(`pendente | em_andamento | concluida`), `currentStep`
(`comparacao_ia | revisao_humana | decisao_juridica`), KPIs
(`totalDocumentos`, `documentosAnalisados`, `camposComparados`, `resumoIA`),
`decisaoJuridica` (`null | com_retificacao | sem_retificacao`), `requerRetificacao`.

`Divergencia` — filha da análise, **auto-contida por snapshot** (não quebra se a
pessoa/documento mudar depois): `pessoaId`, `pessoaNome`, `geracao`, `linhaReta`,
`documentoId`, `documentoTitulo`, `dataDocumento`, `campo`, `campoLabel`,
`valorArvore`, `valorDocumento`, `tipo`, `severidade` (`baixa|media|critica`),
`sugestaoIA`, `motivoIA`, `impacto`, `requerRetificacaoIA`, `status`
(`pendente | aceita | ressalva | ignorada | retificacao | apoio_solicitado`),
`decididoPorId`, `decididoEm`, `notas`.

⚠️ Os campos com sufixo `IA` (`resumoIA`, `sugestaoIA`, `motivoIA`,
`requerRetificacaoIA`) e o step `comparacao_ia` são **rótulos do produto**. A
comparação é **100% determinística e local**.

### 8.3 Motor de comparação (puro, sem React, sem Prisma)

`src/lib/process-stage/ad-v2-engine.ts` — Análise Documental v2:
`stripAccents`, `norm`, `tokens`, `sameEquivGroup` (equivalência linguística),
`levenshtein`, `classifyName` (com flag `onLine` para linha reta),
`classifyPlainField`, `buildADModelFromTree`, `buildBranches`,
`resolveMarriageTransmission`, `buildCanonical`, `canonicalOf`, `initADModel`,
`ad2Readiness`, `ad2CompareValue` (name|date|place|text), `ad2ComputeNormalized`,
`ad2CompareDoc`, `ad2SevRank`, `ad2PersonSummary`, `ad2DocRequired`, `ad2GenNum`,
`ad2Role`, `ad2FullName`.

`src/lib/process-stage/analise-engine.ts` — `gerarDivergencias(pessoas)`.

### 8.4 Telas e rotas

Tela: `ProcessoAnalise.tsx` (painel próprio da fase, não usa `processSteps`).
Rotas: `/api/processos/[processoId]/analise`,
`/api/processos/[processoId]/analise/concluir`,
`/api/processos/[processoId]/analise/divergencias/[divId]`,
`/api/processos/[processoId]/analise-v2`,
`/api/processos/[processoId]/analise-v2/documentos/[docId]`.

### 8.5 Regras de negócio

- Divergência é **snapshot** — não referencia dado vivo.
- Toda divergência exige **decisão humana** explícita.
- A **decisão jurídica** da Análise (`AnaliseDocumental.requerRetificacao === true`)
  é a condição do **roteamento condicional** do Macro: `true` entra em
  `RETIFICACAO_REGISTROS`; `false`/indefinido pula para `TRADUCAO_JURAMENTADA`.
- A fase `ANALISE_DOCUMENTAL` tem `next: null` no catálogo justamente porque o
  destino é decidido pelo roteamento condicional, nunca por ordem.
- `AnaliseDocumental.status`/`currentStep` não substituem o gate: a conclusão da
  fase bespoke chama `concluirWorkflowInternoDaFase` (§9).

### 8.6 O que NÃO pode ser alterado

1. Comparação determinística e local — os campos `*IA` são nomenclatura, não contrato de IA.
2. `Divergencia` auto-contida por snapshot.
3. Decisão da Análise como condição oficial do roteamento condicional.
4. Decisão humana obrigatória por divergência.

---

## 9. Central Operacional

### 9.1 Definição arquitetural

Existem **duas** superfícies com esse nome; ambas oficiais e distintas:

**(a) Home = Centro Operacional** (`/dashboard`). Só aparece o que gera **ação nos
próximos minutos**. Blocos permitidos: cabeçalho (saudação/data/status/busca
global), Central Operacional (filas executáveis com quantidade + prioridade +
clique direto), Agenda (hoje/amanhã/próximos), Alertas (só quando existem) e
Operação de hoje.
**PROIBIDO voltar:** receita/caixa/financeiro resumido, processos ativos,
processos por fase, workflow macro, indicadores, atividade recente, acesso rápido,
fila da equipe, gargalos, gráficos.
Filas derivadas do **VERBO do stepKey** de `PhaseWorkflowStepInstance` (data-driven,
sem condicional por fase) em `src/lib/home/coleta.ts` — a MESMA coleta serve
`/api/home` e o drill-down `/api/home/fila/[key]` + `/dashboard/fila/[key]`, então
contagem e lista nunca divergem.
**EM PRODUÇÃO** (commit `b438dd1`, 22/07). Guarda `scripts/home-guard.test.ts` (55 checks).

**(b) Central Operacional do Processo** — a tela da fase, dentro do modal do
processo (`ProcessoCentralOperacional.tsx`).

### 9.2 Central unificada (fase ativa **e** fase passada) — REGRA DEFINITIVA

A tela da fase **passada é a MESMA Central Operacional** — mesmo layout, mesmas
abas, cards e tabelas — apenas em **modo somente-leitura**, com **DADOS VIVOS**
escopados pela instância/ciclo daquela fase. **Nunca fotografia congelada**: a
fase anterior pode ser consultada, navegada e reaberta (retorno oficial).

- **Modos:** `ACTIVE | PAST_READ_ONLY | REOPENED`.
- Fonte = registros REAIS do banco escopados por `(processoId, faseCode,
  workflowInstanceId, ciclo)`. Nunca carregar só por processo; nunca misturar
  dados da fase ativa com a consultada.
- **Resolvers parametrizados por fase** (contexto = `faseMacroKey` +
  `workflowInstanceId`): `resolveOperationalProjection(id, contexto?)` (com
  `resolveOperationalProjectionParaFase` para instância específica, qualquer
  status) e `resolveProgressoFaseDocumento(id, contexto?)`. Sem contexto ⇒ fase
  ATIVA. Mesma função-base `computeGate`.
- **Rota** `GET /api/processos/[processoId]/central-operacional?faseCode&instanceId&ciclo`
  → devolve `mode` + `phaseContext`; escopa progresso/projeção/genealogiaV2 à instância.
- **UI:** trilha e resumo seguem a fase ATIVA (`data`); o corpo renderiza
  `viewData ?? data` no MESMO layout, com `readOnly`. Cabeçalho de consulta: badge
  "Somente leitura", "Fase concluída · Ciclo X", "Voltar à fase ativa" e
  `RetornarFaseButton` (→ `/phase/return` oficial).
- **ELIMINADOS:** `HistoricalPhasePanel`, `resolveHistoricalPhaseProjection`, rota
  `/phases/[id]/projection` como fonte da tela.
- **SNAPSHOT NÃO controla nem reconstrói a tela operacional.** A coluna
  `PhaseWorkflowInstance.operationalSnapshot` e a captura foram preservadas apenas
  como registro técnico/auditoria opcional.

**EM PRODUÇÃO** (commits `32a86af` + guard `90c51a2`, deploy `fl1iamcbf`, 19/07).
Guarda `npm run test:central-unificada` (31 checagens).

Esta decisão **supera** definitivamente a arquitetura anterior de "snapshot por
ciclo" e o painel histórico separado.

### 9.3 Projeção Operacional Canônica — fonte ÚNICA

`OperationalProjection` é a fonte **única** de progresso, estado, bloqueio,
próxima ação e avanço da fase.

- **Núcleo puro:** `src/lib/motor/operational-projection-core.ts` → `computeGate`
  (gate) + `buildOperationalProjection` (progresso scope-aware) + `escopoEfetivo`.
  Sem I/O.
- **I/O:** `src/lib/process-stage/operational-projection.ts` →
  `resolveOperationalProjection(id)` e `resolveOperationalProjectionBatch(ids)`
  (o single delega ao batch). O batch são **6 queries fixas** (sem N+1), usado por
  `GET /api/processos` para o Kanban.
- **Contrato:**
  `{ processId, activePhase{id,name,scope}, progress{percentage,completedWeight,totalWeight},
  status{blocked,canAdvance,operationalState}, nextAction{key,label},
  metrics{required,completed,blocked} }`.
- `OperationalState` = `SEM_FASE | BLOQUEADA | PRONTA_PARA_AVANCAR | CONCLUIDA |
  EM_ANDAMENTO | NAO_INICIADA`.

**Consumidores (todos leem, nenhum recalcula):** card do Kanban
(`kanban-card.tsx` — SÓ barra + `progress.percentage%`; nunca conta
tarefas/docs/necessidades/steps), `PhaseProgressHeader` via
`/api/processos/[id]/phase`, Trilha Macro / Central via `/central-operacional`,
navegação de fases.

**EM PRODUÇÃO** (commit `7f5b69f`, 18/07; ampliado por `132907f`).

### 9.4 Invariante progresso ⇄ avanço (blindado)

**100% ⟺ pode avançar.** Uma fase bloqueada **nunca** exibe 100%.

- `computeProgress(input, blocked)`: se `blocked` → teto **99** (nunca 100); se
  `!blocked` e obrigatórias completas → exatamente **100** (sem reserva de 1%).
- Trava defensiva de runtime em `buildOperationalProjection`:
  `if (blocked && prog.percentage >= 100) prog.percentage = 99`.
- Teste de guarda `scripts/operational-projection.test.ts` (seções 9-11) — a
  regressão quebra o build.

**EM PRODUÇÃO** (commit `d3087f3`, deploy `lfz1uwk05`, 19/07).

### 9.5 Drawer operacional do documento — fonte única

Resposta **ÚNICA agregada** `{document, projection, workflow}` por
`GET /api/documentos/[id]/operational-projection`
(`resolveDocumentOperationalProjection`, reusa `garantirOperacaoDocumentoV2`).
Estados do front: `LOADING | OPERATIONAL | NOT_MATERIALIZED | ERROR`.
`LOADING` = skeleton — **nunca** "Sem operação ativa"/"Iniciar operação".
`AbortController` cancela a requisição anterior; a resposta é amarrada ao
`documentoId`. O empty-state só aparece em `NOT_MATERIALIZED`; o botão de início é
gated por `canStart` e rotulado pela `nextAction` do WF Interno — nunca por
`Documento.status`, nome de fase ou "buscar".
Chave de remontagem do drawer = `(faseCode + doc)`, com guard de corrida `reqSeq`.

### 9.6 Operação Antecipada (na Central)

Linha **COMPACTA** na Central (`OperacoesAntecipadasInline` dentro de
`PainelDaFase`): objetivo · status da operação · **Abrir operação**, que reutiliza
a MESMA tela oficial (`DocumentoOperationalDrawer`) com banner de contexto.
**NUNCA** mostra o workflow inteiro dentro da necessidade. Ver §10.6.

### 9.7 Telas

`ProcessoCentralOperacional.tsx`, `PainelDaFase.tsx`, `WorkflowMacroTrilha.tsx`,
`DocumentoOperationalDrawer.tsx`, `TabOperationCockpit.tsx`,
`PessoaOperacionalDrawer.tsx`, `RetornarFaseButton.tsx`, `WorkflowControls.tsx`,
`OperacaoAntecipadaModal.tsx`, `InitOperationModal.tsx`, `OpManageModal.tsx`.
Painéis bespoke por fase: `ProcessoAnalise`, `ProcessoRetificacao`,
`ProcessoEmissaoRetificada`, `ProcessoTraducao`, `ProcessoApostilamento`,
`ProcessoFaseFinal`, `ProcessoFaseGenerica`.
Home: `/dashboard`, `/dashboard/fila/[key]`.

### 9.8 O que NÃO pode ser alterado

1. `OperationalProjection` é a fonte única — **proibido cálculo paralelo** de
   progresso, e proibida "reserva de 1%" ou cap fora do gate.
2. Card do Kanban mostra **só** barra + percentual.
3. VIEW de fase passada = MESMA Central, dados vivos escopados, `readOnly`.
   Proibido reintroduzir painel histórico ou snapshot como fonte da tela.
4. Invariante 100% ⟺ `canAdvance`.
5. Home: só blocos que geram ação imediata; a lista de blocos proibidos é
   normativa.
6. Escopo declarado em `FaseDef.scope` — **nunca** derivar escopo do nome da fase.

### 9.9 Limitação conhecida (registrada, não corrigida)

Os painéis **bespoke** por fase (Análise, Tradução, Apostilamento, Retificação,
Emissão Retificada, Fase Final) buscam a fase ATIVA e não são escopados por
instância/ciclo. Em consulta de fase passada bespoke, a Central cai no **corpo
genérico** (com dados corretos escopados) em vez do layout bespoke.

---

## 10. Workflow

### 10.1 Arquitetura em duas camadas

**Workflow Macro** — a sequência de fases do processo (`MacroWorkflow`,
`FaseMacro`). **Workflow Interno** — o fluxo de passos **dentro** de cada fase
(`PhaseInternalWorkflow`, `PhaseInternalWorkflowStep`, `PhaseInternalMode`).

**Definição × Instância:** `PhaseInternalWorkflow`/`Step` são **template**;
`PhaseWorkflowInstance`/`PhaseWorkflowStepInstance` são as entidades
**operacionais**. É **proibido** usar a definição como estado do processo. A
instância carrega **snapshot imutável** da definição — alterar template não altera
instância viva.

### 10.2 Cutover V2 — CONCLUÍDO

O runtime legado `Workflow`/`WorkflowStep` foi **removido fisicamente** do banco
(migration `20260714230000_contract_remove_legacy_workflow`). Todos os 6
consumidores operacionais migrados; a allowlist da guarda
`scripts/legacy-workflow-guard.test.ts` está **ZERADA**.
Fonte única do runtime: `PhaseWorkflowStepInstance` (com `documentoId` para a
operação por-documento). `Tarefa` é **materializada** a partir do passo
(`workflowStepInstanceId`) — **não** é fonte canônica.

Backup do cutover: `~/discovery-contract-migration-backup-20260714-223445`.
**Lição registrada:** nunca dropar tabela antes de deployar o código que para de usá-la.

### 10.3 Catálogo de fases — fonte única

`src/lib/process-stage/fases-catalog.ts` (só dados + tipos, não toca no banco).
`FaseDef` = `{ code, phaseKey, ordem, label, kind, scope, steps, processSteps, next }`.

| Ordem | FaseCode | phaseKey | kind | scope | next |
|---|---|---|---|---|---|
| 0 | GENEALOGIA | genealogia | documento | **NECESSIDADE** | EMISSAO_DOCUMENTAL |
| 1 | EMISSAO_DOCUMENTAL | emissao_documental | documento | **DOCUMENTO** | ANALISE_DOCUMENTAL |
| 2 | ANALISE_DOCUMENTAL | analise_documental | processo | PROCESSO | null (roteamento condicional) |
| 3 | RETIFICACAO_REGISTROS | retificacao_registros | processo | PROCESSO | EMISSAO_DOCUMENTAL_RETIFICADA |
| 4 | EMISSAO_DOCUMENTAL_RETIFICADA | emissao_documental_retificada | processo | PROCESSO | TRADUCAO_JURAMENTADA |
| 5 | TRADUCAO_JURAMENTADA | traducao_juramentada | processo | PROCESSO | APOSTILAMENTO |
| 6 | APOSTILAMENTO | apostilamento | processo | PROCESSO | AGUARDANDO_PROTOCOLO |
| 7 | AGUARDANDO_PROTOCOLO | aguardando_protocolo | processo | PROCESSO | PROTOCOLADO |
| 8 | PROTOCOLADO | protocolado | processo | PROCESSO | FINALIZADO |
| 9 | FINALIZADO | finalizado | processo | PROCESSO | null |

`kind: "documento"` = workflow por documento/necessidade com gate automático.
`kind: "processo"` = checklist (`processSteps`) com avanço manual.
`phaseKey` é a identidade lógica estável — **renomear uma fase = mudar só ali**.
**Label nunca é identidade.**

⚠️ **GOTCHA:** as chaves REAIS do Macro em produção divergem do catálogo — o macro
usa `retificacao` e `emissao_documental_retificada` (catálogo:
`retificacao_registros`). **SEMPRE** usar a flag canônica `FaseMacro.conditional`
(carregada em `carregarContexto`), nunca chave hardcoded.

### 10.4 Criação V2-nativa de processo — cadeia única e atômica

Todo processo novo **nasce v2**. Em UMA transação (rollback integral em falha):

```
criar Processo (workflowRuntime="v2")
  → Workflow Macro publicado (ativo)
    → 1ª fase pela ORDEM (menor ordem, nunca por label)
      → faseAtualKey
        → instanciarWorkflowDaFase (passos versionados)
          → garantirTarefaDePasso por passo (idempotente)
            → phase.entered inicial na DomainOutbox
               (source="process_created", transitionReason="initial_phase", previousPhase=null)
              → LogAuditoria (acao=PROCESSO_INICIALIZADO_V2)
```

Serviço de domínio ÚNICO: `src/services/criar-processo.ts` (`criarProcessoV2`).
Idempotência por `Processo.chaveIdempotenciaCriacao` (@unique) — mesma
`Idempotency-Key` ⇒ mesmo processo (P2002 converge).
`POST /api/processos` é **adaptador fino**: rejeita fase/runtime/tarefas vindos do
cliente e aceita header `Idempotency-Key`.
Migration `20260716090000_criacao_v2_nativa`. **EM PRODUÇÃO** (16/07).
Kill switch inalterado: v2 exige `MotorConfig.runtimeV2Habilitado = true`.

### 10.5 Avanço de fase — cadeia única

`PhaseAdvanceService` (`src/lib/motor/phase-advance.ts`) é o **único escritor** de
`Processo.faseAtualKey`. Opera com CAS + chave idempotente @unique + transação +
`PhaseAdvanceLog` + `WorkflowEvento` + `DomainOutbox`, e suporta ciclos.

API: `advance`, `forceAdvance`, `reopenPhase`, `returnPhase`.
Política padrão: **`ALL_REQUIRED_COMPLETED`** — pode avançar se não houver nenhum
issue `BLOCKING`.
Eventos canônicos no outbox transacional: `phase.completed` (quando conclui) e
`phase.entered` (sempre), montados por `phase-advance-helpers.ts`.
`cicloAlvo = proximoCiclo(processoId, proxima)` — nunca fixo em 1.

**Roteamento condicional:** `proximaFaseComCondicional` → `proximaFaseAplicavel`
(helper puro) **pula** fases com `FaseMacro.conditional = true` que não se aplicam.
`advance` **não** usa mais `proximaFasePorOrdem`.

**Auto-avanço por evento:** gancho único
`src/lib/motor/auto-avanco.ts::tentarAvancoAutomatico(processoId)` (best-effort,
nunca lança, laço curto para encadear fases prontas), ligado em: conclusão de
tarefa (`tarefas/[id]/concluir`, v2 e legado), `necessidades/[id]` PATCH
(atender|dispensar|nao_localizada) e `processos/[id]` PUT (requerente/árvore).
**REGRA:** toda mutação que é entrada do gate deve chamar o gancho após commitar.

**Alinhamento bespoke ⇄ gate:** as fases por-processo têm fluxo bespoke em tabelas
próprias (`AnaliseDocumental`, `PastaTraducao`, `PastaApostilamento`,
`RetificacaoPacote`, `EmissaoRetificada`, `FaseFinal`) **E** Workflow Interno V2
(cujos passos são o GATE). `src/services/alinhar-workflow-fase.ts::concluirWorkflowInternoDaFase`
conclui os passos obrigatórios abertos pelo serviço canônico `concluirPasso`
(idempotente, sincroniza Tarefa, aprova pelo sistema se exigir).
`auto-avanco.ts::concluirFaseBespokeEAvancar(id, faseMacroKey)` = conclui gate +
avança; ligado no `completePhase` de cada endpoint bespoke —
**só no completePhase, NUNCA por etapa** (o gate é por passo).

**Rejeições de API:** `kind=phase_advance` e `type=phase_transition` são
rejeitados (422) em `automacoes-fase`. `exitRule` não é mais gravado nem editável.
`/avancar-fase` e `/fase` rejeitam o caminho legado; o drag-and-drop só aceita a
**próxima** fase, delegando ao serviço.

### 10.6 Operação Antecipada — ARQUITETURA DEFINITIVA

**Substitui a Tarefa Transversal.** Entidade **ORQUESTRADORA pura** — sem workflow
ou etapas próprios. Vincula uma necessidade da fase atual a uma **OPERAÇÃO OFICIAL
de outra fase**, cujo workflow oficial é a única execução real.

- **Núcleo agnóstico a tipos:** resolução por CATÁLOGO/ADAPTADOR
  (`src/lib/operacoes/catalogo.ts` — `getAdapter` / `listCatalogo` — +
  `adapters/*`), lookup no registry. **Proibido `if(phase)` / `switch(operationType)`
  de negócio.** Novo tipo operacional = novo adaptador registrado, disponível
  automaticamente. Hoje há **um** adaptador: `documento`.
- Model `OperacaoAntecipada` + enum `StatusOperacaoAntecipada`
  (`CRIADA | EM_EXECUCAO | AGUARDANDO_RESULTADO | CONCLUIDA | CONCLUIDA_PARCIAL |
  NAO_ATINGIDA | CANCELADA`). Migrations `20260720170000_operacao_antecipada` e
  `20260720190000`.
- Serviço `src/services/operacao-antecipada.ts`: `criarOperacaoAntecipada` (via
  `adapter.criarOperacao`), `listarOperacoesAntecipadas`,
  `avaliarOperacaoAntecipada` (Sim/Parcial/Não/Cancelar — **só no SIM**:
  `atenderNecessidade` → `tentarAvancoAutomatico`, nunca antes),
  `reconciliarOperacoesAntecipadas` (no `phase.entered`, reusa sem duplicar).
- **Adaptador `documento`, 2 modos:** (1) `params.tipoDocumentoId` — valida tipo
  ativo + pessoa, reutiliza doc compatível vivo ou cria, idempotente; (2) fallback
  pelo doc da própria necessidade (erro funcional se nada resolver, **nunca null
  silencioso**).
- **Distinção crítica:** documento de **APOIO** (tipo ≠ exigido) **NÃO** vincula
  `Documento.necessidadeId`; a avaliação captura resultado **ESTRUTURADO**
  (cartório/livro/folha/termo) que atende a necessidade de origem. Só vincula
  quando **COMPATÍVEL** = mesmo `ItemCatalogo` mestre + mesma pessoa + sem doc
  oficial já vinculado.
- **Interpretador na origem:** `ExecutionAdapter.aplicarResultadoNaOrigem` — o
  adaptador documental conclui os passos obrigatórios ABERTOS dos documentos
  oficiais da necessidade na fase vigente via `atualizarPassoV2` (caminho oficial:
  evolui necessidade, libera o próximo, transacional), anexando os dados
  registrais. Só então o BlockingEngine libera e o PhaseAdvance avança.
- Idempotência: `@@unique(processoId, necessidadeId, targetOperationType,
  targetTipoDocumentoId)` + pré-checagem + catch P2002.
- **EM PRODUÇÃO** (commits `2ce7cef`, `7eda250`, `c4a2c53`). E2E validado em prod.

⚠️ **GOTCHA:** a compatibilidade exige `TipoDocumentoCadastro.itemCatalogoId`; em
produção só 3 de 20 tipos têm esse mapeamento — os demais sempre viram "apoio"
(seguro, mas o vínculo oficial só funciona para tipos mapeados ao ItemCatalogo).

**Legado dormant (não removido):** serviço e rotas `tarefa-transversal*` e
`Tarefa.tipo = TRANSVERSAL` permanecem no banco/código, mas a UI não os usa.
`TarefaTransversalModal` foi deletado; `/api/tarefas-transversais/acoes` ainda é
reusado pelo modal novo para listar fases dinamicamente.

### 10.7 Automações — neutralizadas

**Decisão arquitetural:** o Workflow Interno de cada Fase Macro é o **ÚNICO dono**
de tarefas obrigatórias, ordem, dependências, responsáveis, SLA e conclusão da
fase. Automações **só REAGEM a eventos com EFEITOS ADICIONAIS**
(financeiro/evento/protocolo/notificação). **Nenhuma automação cria tarefa
obrigatória nem avança/conclui fase.**

- Runtime `src/lib/motor/executor.ts`: bloco `kind=task` **não cria mais Tarefa**
  (reporta `skipped`); `financial`/`event`/`protocol`/`trigger` preservados;
  `phase_advance`/`phase_transition` já eram inertes.
- APIs `automacoes-fase` e `modelos-automacao`: POST/PUT permitem só
  `financial | event | protocol | alert`; `task | document | phase_advance |
  phase_transition` → **422**.
- `regras-tarefa-transversal` e `modelos-tarefa-transversal`: POST → **410**;
  PUT bloqueia reativar (só arquivar).
- Dados de produção **sem DELETE** — só `arquivado=true` / `active=false`.
- **EM PRODUÇÃO** (commit `f0cd11f`). Guarda `test:automacoes-guard` (22 asserts).

### 10.8 Biblioteca de Modelos — REMOVIDA

Eliminada em 20/07 (commit `30e4099`, migration `20260720210000`). Verificação
prévia: **nenhum** componente do motor consultava os `Modelo*` em runtime — todos
os acessos eram config-time em rotas admin.
Fonte de verdade = catálogo `FASES` + config real por fase
(`PhaseInternalWorkflow` / `PhaseAutomationRule` / `PhaseInternalMode`).
DROP das 5 tabelas (`ModeloInternoFase`, `ModeloWorkflowInterno`,
`PassoWorkflowInterno`, `ModeloAutomacao`, `ModeloTarefaTransversal`). Colunas
`templateId` (Int soltas, sem FK) preservadas como **proveniência morta**.
Duplicação futura usa a ação "Duplicar" direta, sem biblioteca.

### 10.9 Status legado do Processo — REMOVIDO

Migration `20260715210000_remove_processo_statusid_legado` **aplicada em prod**:
`Processo.statusId`, `Status.faseCode` e a FK removidos. `Tarefa.statusId` e a
tabela `Status` **preservadas** — `Status` virou domínio exclusivo de **Tarefa**
(UI renomeada "Status de Tarefa"). A fase do processo é **`Processo.faseAtualKey`**
e nada mais. `DELETE /api/status` bloqueia se houver tarefas (o cascade destrutivo
foi removido). Guarda `test:status-legacy-guard`.

### 10.10 Entidades do Workflow

`MacroWorkflow`, `FaseMacro`, `CatalogoFase`, `PhaseInternalMode`,
`PhaseInternalWorkflow`, `PhaseInternalWorkflowStep`, `PhaseAutomationRule`,
`PhaseEconomicRule`, `PhaseWorkflowInstance`, `PhaseWorkflowStepInstance`,
`WorkflowEvento`, `PhaseAdvanceLog`, `DomainOutbox`, `Tarefa`, `TarefaHistorico`,
`MotorArtefato`, `MotorConfig`, `PerfilPermissaoMotor`, `OperacaoAntecipada`,
`RegraTarefaTransversal` (dormant), `MarcoProcesso`.

**Enums:** `PassoTipo` (HUMANO/AUTOMATICO/ESPERA/VALIDACAO/DECISAO/APROVACAO/
MANUAL_SEM_TAREFA), `WorkflowInstanceStatus`, `StepInstanceStatus`,
`OrigemInstancia`, `OutboxStatus`, `TipoTarefa`, `WorkflowEventoTipo` (36 tipos),
`AdvanceResultado`, `FaseCode`, `StatusOperacaoAntecipada`.

### 10.11 Serviços

`services/criar-processo.ts`, `services/phase-workflow.ts`
(`resolverWorkflowAplicavel`, `instanciarWorkflowDaFase`, `getInstanciaAtiva`),
`services/documento-operacao.ts`, `services/passo-tarefa.ts`,
`services/task-step-sync.ts`, `services/alinhar-workflow-fase.ts`,
`services/operacional-workflow.ts`, `services/outbox-dispatcher.ts`,
`services/workflow-activation.ts`, `services/workflow-definition-validator.ts`,
`services/completion-engine/`, `services/processEngine/`,
`lib/motor/phase-advance.ts`, `lib/motor/blocking-engine.ts`,
`lib/motor/auto-avanco.ts`, `lib/motor/executor.ts`,
`lib/motor/phase-simulation.ts`, `lib/motor/runtime-guard.ts`,
`lib/motor/observability.ts`, `lib/motor/resolve-passos-bloqueantes.ts`,
`lib/process-stage/recalcular-fase.ts` (delega ao PhaseAdvanceService),
`lib/workflow-runtime.ts`.

### 10.12 Telas de configuração

Gerenciamento → **Processos**: Tipos de Processo, Modalidades, Países e Regiões,
**Fases** (`CatalogoFasesTab`, sobre `CatalogoFase`), Variações da Fase, Marcos,
SLA, Versões, Configurações Gerais.
Gerenciamento → **Workflow**: Workflow Macro (`MacroKanbanTab`), Workflow Interno
(`PhaseWorkflowsFasesTab`), Transições, Executor do Motor (`ExecutorMotorTab`),
Diagnóstico de Runtime (`RuntimeWorkflowDiagnostics`), Migração do Motor.
Gerenciamento → **Automações**: Financeiras, Eventos, Simulação
(`SimulacaoFaseTab`), Histórico de Execuções.
No processo: `WorkflowMacroTrilha`, `WorkflowV2Panel`, `WorkflowV2AtivacaoPanel`,
`WorkflowControls`.

### 10.13 Rotas principais

`/api/processos/[id]/advance`, `/advance/force`, `/advance/simulate`,
`/phase`, `/phase/reopen`, `/phase/return`, `/phases`, `/phase-workflow`,
`/phase-workflow/instantiate`, `/workflow-runtime`, `/pendencias`,
`/observability`, `/central-operacional`, `/operational-workflow`,
`/operacoes-antecipadas`; `/api/operacoes-antecipadas/{catalogo,[id]}`;
`/api/tarefas/*`; `/api/motor/outbox/processar`.

### 10.14 O que NÃO pode ser alterado

1. `PhaseAdvanceService` é o **único** escritor de `faseAtualKey`.
2. Workflow Interno é o único dono de tarefa obrigatória / conclusão de fase.
3. Automação nunca cria tarefa obrigatória nem avança fase.
4. Definição ≠ instância; instância carrega snapshot imutável.
5. Fases cadastradas **exclusivamente** em Processos › Estrutura › Fases; Workflow
   só REFERENCIA (travado por `test:nav`, 70 asserções).
6. Idempotência + transacionalidade + outbox em toda mutação de motor.
7. Roteamento condicional pela flag `FaseMacro.conditional` — nunca chave hardcoded.
8. `phaseKey` é a identidade; label nunca é identidade.
9. Não reintroduzir `Workflow`/`WorkflowStep` legados nem a Biblioteca de Modelos.
10. Operação Antecipada resolve por adaptador — proibido condicional por fase/tipo.

**Suítes:** `test:legacy-guard`, `test:phase-advance` (guard + events),
`test:status-legacy-guard`, `test:automacoes-guard`, `test:cp4` (272),
`test:completion`, `test:fases`, `test:roteamento-condicional` (6),
`test:central-unificada` (31), `test:operational-projection` (34),
`test:emissao-gate` (6), `test:entrega-transversal` (19), `test:nav` (70).

---

## 11. Necessidades Documentais

### 11.1 Definição arquitetural

`NecessidadeDocumental` é a **exigência documental viva** de um sujeito num
processo. É o elo 2 da cadeia CP-3 e o **denominador do progresso** nas fases de
escopo NECESSIDADE e DOCUMENTO.

Sujeito: `pessoaId` **XOR** `uniaoId` (CHECK no banco).
Objeto: `itemCatalogoId` (o Documento Mestre exigido).

### 11.2 Modelo

Campos de identidade e idempotência: `varianteKey` (default `"padrao"`), `ciclo`,
`chaveIdempotencia` (@unique).
Classificação: `origem` (`ARVORE | MATRIZ | MANUAL | MIGRACAO`),
`obrigatoriedade` (`OBRIGATORIA | OPCIONAL`), `status` (`PENDENTE |
EM_ATENDIMENTO | ATENDIDA | NAO_LOCALIZADA | DISPENSADA`).
Proveniência imutável: `matrizRegraId`, `matrizRegraVersao`, `matrizSnapshot`,
`avaliadaEm`, `motivoAplicabilidade`, `arvoreId`, `ruleCode`.
Supersessão: `supersedePorId` (histórico append-only).
Relações: `documentos[]`, `eventos[]`, `tarefasVinculadas[]`, `stepInstances[]`,
`nomesEvidenciados[]`.

`NecessidadeDocumentalEvento` registra o histórico: `CRIADA`, `EM_ATENDIMENTO`,
`ATENDIDA`, `NAO_LOCALIZADA`, `REABERTA`, `DISPENSADA`, `SUPERSEDIDA`,
`RETORNO_GENEALOGIA`.

### 11.3 Serviços — `src/services/necessidade-documental.ts`

`garantirNecessidade` (idempotente), `resolverNecessidadeDeDocumento`,
`marcarNaoLocalizada`, `retornoGenealogia`, `reabrir`,
`iniciarAtendimentoNecessidade`, `atenderNecessidade`, `dispensarNecessidade`,
`reativarNecessidade`, `evoluirNecessidadePorPasso`,
`reabrirAtendimentoNecessidade`, `reconciliarNecessidadesPorPassos`,
`garantirNecessidadesArvoreDoProcesso`, `garantirNecessidadesDaMatriz`.
Helpers: `montarChaveIdempotencia`, `sujeitoValido`
(`necessidade-documental-helpers.ts`).

### 11.4 Telas e rotas

Fila de necessidades no `PainelDaFase` da Central Operacional (com ações
Atender / Dispensar / Não localizada / Delegar / Operação Antecipada).
`GET /api/processos/[processoId]/necessidades`;
`PATCH /api/processos/[processoId]/necessidades/[necessidadeId]`
(`atender | dispensar | nao_localizada`) — este PATCH dispara
`tentarAvancoAutomatico`.

### 11.5 Regras de negócio

- **Escopo NECESSIDADE** (Genealogia): progresso e gate sobre necessidades
  `ehCertidao && obrigatoria && status !== DISPENSADA`. Uma necessidade conta como
  **localizada** quando o seu passo por-necessidade está concluído **ou**
  `status === ATENDIDA`.
- **Escopo DOCUMENTO** (Emissão): o denominador é o conjunto de **CERTIDÕES
  OBRIGATÓRIAS** (`ehCertidao && obrigatoria && status !== DISPENSADA`), **não** os
  documentos da linha reta. Uma certidão está resolvida **iff** o seu `Documento`
  (via `Documento.necessidadeId`) tem a operação da fase concluída (último passo
  por-documento concluído). Documentos de apoio (RG/CPF) **não gateiam**.
  Certidão obrigatória que **nunca teve operação aberta** conta como pendente e
  emite `CERTIDAO_OBRIGATORIA_PENDENTE` — o helper
  `certidoesObrigatoriasDocumento` é fonte ÚNICA de `computeGate` **e**
  `computeProgress`, então gate e progresso nunca divergem.
- Passos em estado `CONCLUIDO | DISPENSADO | SUPERSEDIDO` (`PASSO_OK`) contam como
  feitos e **não** bloqueiam.
- Reabertura de passo **regride** a necessidade transacionalmente
  (`reabrirAtendimentoNecessidade` no ramo `vaiReabrir` de `atualizarPassoV2`,
  dentro da `$transaction`). Progresso cai, gate volta a bloquear.
- "Não localizada" **mantém** o bloqueio; só DISPENSAR destrava.
- Contagens sempre com `supersedePorId: null` (senão reabertura conta em dobro) —
  aplicado em `blocking-engine`, `resolve-fase-progresso`, `operational-projection`
  (batch e por-fase) e `central genealogiaV2`.
- Emissão materializa passos por-documento **sob demanda**
  (`iniciarOperacaoDocumentoV2` / `garantirOperacaoDocumentoV2`); Genealogia
  materializa **na entrada** (um passo para toda necessidade).

### 11.6 O que NÃO pode ser alterado

1. `pessoaId` XOR `uniaoId`.
2. Snapshot imutável da regra de origem.
3. Supersessão em vez de update destrutivo.
4. `certidoesObrigatoriasDocumento` como fonte única de gate **e** progresso na Emissão.
5. Necessidade DISPENSADA não bloqueia e seu passo é ignorado.
6. Filtro `supersedePorId: null` em toda contagem.

---

## 12. Regras Documentais

### 12.1 Definição arquitetural

A **fonte ÚNICA** das Regras Documentais é o model **`MatrizDocumental`
AMPLIADO**. Não foi criada tabela nem motor concorrente — a Matriz Documental
virou a visão técnica da mesma tabela.

Migrations: `20260716140000_regras_documentais` (aditiva) e
`20260716180000_regras_doc_multiplo` (aditiva). **EM PRODUÇÃO** (commits `787fbc4`
e `03e84d8`, 16/07).

### 12.2 Modelo — campos canônicos

**Identificação:** `codigo` (estável, compartilhado entre versões), `nome`,
`descricao`, `status` (`RegraDocumentalStatus`), `prioridade`, `vigenciaInicio`,
`vigenciaFim`, `versao`, `@@unique([codigo, versao])`.
**Aplicabilidade:** `aplicaTodosProcessos`, `tipoProcessoIds` (Json `[Int]`).
`modalidadeId`, `paisCode`, `regiaoCode` são **LEGADO** — saíram do escopo
(modalidade virou campo de **condição**).
**Requisito:** `requisitoNome`, `documentosAceitos` (Json `[String]` de códigos de
TipoDocumento), `modoSatisfacao` (`QUALQUER_UM_ATENDE` padrão | `TODOS_SAO_EXIGIDOS`),
`obrigatoriedade` (`OBRIGATORIA | OPCIONAL`).
**Público-alvo (múltiplo):** `publicosAlvo` (Json), com `publicoAlvo` singular como
primário para dual-read. Valores: `REQUERENTE`, `CONTRATANTE`,
`PESSOA_DA_ARVORE_COM_DOCUMENTACAO`, `PESSOA_DA_LINHA_RETA`,
`PESSOA_FORA_DA_LINHA_RETA`, `TODAS_AS_PESSOAS_DA_ARVORE`.
**Condições estruturadas:** `condicoes: Json` =
`{ combinador: TODAS|QUALQUER, regras: [{campo, operador, valor}] }` — 8 operadores.
**Fase e bloqueio:** `faseExigencia`, `faseBloqueio` (**independentes**),
`continuaObrigatorioNasFasesSeguintes`, `faseFinalExigencia`,
`obrigatorioAteFinalProcesso`.
**Validade:** `possuiValidade`, `validadeDias`, `exigeDataEmissao`,
`renovarQuandoExpirado`, `antecedenciaRenovacaoDias`.
**Auditoria de versão:** `criadoPor`, `atualizadoPor`, `publicadoEm`, `publicadoPor`.

**Enums:** `RegraDocumentalStatus` (`RASCUNHO | PUBLICADA | INATIVA | ARQUIVADA`),
`ObrigatoriedadeRegra`, `ModoSatisfacaoRequisito`, `PublicoAlvoRegra`.

**Campos legados preservados (dual-read/dual-write):** `required`, `target`,
`phaseKey`, `blocksPhaseCompletion`, `condition`, `generationRule`, `createsTask`,
`createsCost`, `createsRevenue`, `documentTypeCode`, `tipoProcessoId`,
`categoriaCode`. Registros antigos foram **adaptados** na migration
(`required → obrigatoriedade`, `target → publicoAlvo`, `phaseKey → faseExigencia`,
`codigo = 'MDX_' || id`) e mantidos em **RASCUNHO** (não publica sozinho).

### 12.3 Lib pura — `src/lib/documentos/regras-documentais/`

| Arquivo | Responsabilidade |
|---|---|
| `tipos.ts` | contratos canônicos |
| `condicoes.ts` | 8 operadores, combinadores TODAS/QUALQUER, validação de incompatíveis |
| `avaliador.ts` | `avaliarRegrasDocumentais` — público-alvo, condições, status/vigência, validade/vencimento, **justificativa** |
| `conflitos.ts` | `detectarConflitos` — divergência, duplicação, fase, validade, condição. **Nunca resolve em silêncio** |
| `resumo.ts` | frase-resumo legível da regra |
| `versionamento.ts` | `podeEditarEmLugar`, `proximaVersao` |
| `mapear.ts` | row ↔ canônico |
| `persistencia.ts` | **único** arquivo que importa Prisma (o resto é client-safe) |

### 12.4 API

`src/app/api/gerenciamento/regras-documentais/`:
- `route.ts` — `GET` (lista + apoio + conflitos), `POST` (criar rascunho)
- `[id]/route.ts` — `GET` (+ versões), `PUT` (edita **rascunho**; publicada é
  **imutável**), `DELETE` (só regra **nunca usada**), `POST` (ações:
  `duplicar | publicar | inativar | arquivar | reabrir | nova_versao`)
- `simular/route.ts`, `conflitos/route.ts`

Validação sempre no backend. Auditoria em `LogAuditoria` com
`entidade = REGRA_DOCUMENTAL`.
Permissões: `regras_documentais.{ver,criar,editar,publicar,arquivar,simular,excluir}`.
**Publicar** exige `regras_documentais.publicar` (admin-only na prática); as demais
caem em `usuarios.gerenciar`.

### 12.5 Tela

Gerenciamento → Documentos e Protocolos → **Regras Documentais**
(`screen=docrules` → `RegrasDocumentaisTab`). Contém: lista completa, **wizard de
8 etapas**, construtor visual de condições com frase-resumo e alerta, e
**simulador** que explica por que a regra é aplicável ou não.
A tela **absorve a Matriz**: `docmatrix` virou item **oculto** "Matriz Documental
(visão técnica)" sobre a MESMA tabela — fonte única.

### 12.6 Regras de negócio

- **Regra publicada é IMUTÁVEL.** Editar uma publicada gera automaticamente uma
  **nova versão** ("Editar" é o fluxo principal). `@@unique([codigo, versao])`.
- **Excluir** só é permitido para regra **nunca utilizada**.
- **Vigência saiu do formulário** (as colunas continuam no banco). Regra sem
  vigência = válida sem limite.
- **Aplicabilidade** = múltiplos tipos de processo **OU** todos. Modalidade, país e
  região **saíram do escopo** e viram condição quando necessário.
- **Requisito** = nome + N documentos aceitos + modo de satisfação. **Categoria
  saiu da tela** — é derivada do Tipo de Documento, nunca redefinida pela regra.
- **Público-alvo é MÚLTIPLO.** Linha reta / casado / etc. viraram **condição**
  (o legado "linha reta" foi convertido em "Pessoa da árvore" + condição `linhaReta`).
- **Conflitos nunca são resolvidos em silêncio** — são detectados e apresentados.
- `faseExigencia` e `faseBloqueio` são **independentes**.

### 12.7 Integração com o runtime — estado exato

A lib de Regras Documentais **é pura e não executa runtime por si**. A ponte com o
motor é a **materialização da Genealogia** (§2.2):
`materializar-genealogia.ts` lê as regras **PUBLICADAS** cuja `faseExigencia` ou
`faseBloqueio` é `genealogia` (protocolo fica de fora), avalia por Pessoa e produz
`NecessidadeDocumental` + passo canônico, com `varianteKey = rd:{codigo}:v{versao}`
e snapshot da regra.

A regra **não** cria Documento, **não** cria Tarefa e **não** avança fase.
Não há, hoje, materialização equivalente para as demais fases.

### 12.8 O que NÃO pode ser alterado

1. `MatrizDocumental` ampliada é a **fonte única** — proibido criar tabela ou motor
   concorrente de regras documentais.
2. Regra publicada é imutável; alteração gera nova versão.
3. Campos legados permanecem (dual-read) — não remover.
4. Conflito nunca é resolvido em silêncio.
5. Categoria é derivada do Tipo de Documento.
6. Avaliador é puro e client-safe; só `persistencia.ts` toca Prisma.

**Suítes:** `test:regras-documentais` (28 cenários),
`test:regras-documentais-guard` (7, prova a ausência de runtime).

---

## 13. Matriz de estado — resumo executivo

| Domínio | Estado | Fonte única | Guarda |
|---|---|---|---|
| Árvore Genealógica | implementado, em main | `motor/` + `layout-familiar` + `tokens.ts` | `test:arvore` |
| Genealogia (fase) | em produção | `localizar_registro` + `natureza-certidao` | `test:genealogia-*` |
| Interessados | **não existe como entidade** | papéis sobre `Pessoa` | `test:arvore-dedup` |
| Relacionamentos Familiares | parcial (FK direta + `Uniao` + MDM) | `Pessoa.paiId/maeId`, `Uniao`, `NomePessoa` | `test:mdm` |
| Gestão Documental | em produção | cadeia CP-3 | `test:cp3`, `test:doccats` |
| OCR | **não existe** | — | — |
| Extração de Dados | **não existe automática** | `registral` (canônico) | — |
| Validação Documental | em produção (determinística) | `ad-v2-engine` + `Divergencia` | — |
| Central Operacional | em produção | `OperationalProjection` | `test:central-unificada`, `test:operational-projection`, `test:home` |
| Workflow | em produção (V2 puro) | `PhaseWorkflowStepInstance` + `PhaseAdvanceService` | `test:legacy-guard`, `test:phase-advance`, `test:cp4` |
| Necessidades Documentais | em produção | `NecessidadeDocumental` | `test:cp3`, `test:emissao-gate` |
| Regras Documentais | em produção (sem runtime além da Genealogia) | `MatrizDocumental` ampliada | `test:regras-documentais*` |

---

## 14. Pendências e débitos declarados (registro, não plano)

1. **Genealogia Fatia 3** — progresso da Central por passos (des-neutralizar
   `genealogiaReestruturacao`) e reconciliação dos passos legados do desenho antigo
   de 5 passos em instâncias existentes.
2. **Status mestre do `Documento` defasado** em relação ao workflow.
3. **Painéis bespoke não escopados** por instância/ciclo na Central em modo VIEW.
4. **Árvore B2–B8 bloqueadas** pelas 4 lacunas de domínio da §4.5.
5. **MDM F3** — `decisaoDedupId` ainda não é obrigatório em `POST /api/pessoas`.
6. **Mapeamento `TipoDocumentoCadastro.itemCatalogoId`** incompleto em produção
   (3 de 20), limitando o vínculo oficial da Operação Antecipada.
7. **`phase.completed`** gravado na outbox e nunca consumido (arquivado em
   `TIPOS_SEM_EFEITO`, não acumula).
8. **KPIs/counts da Central** (`resolve-fase-progresso`) divergem do headline da
   projeção; a tabela por-pessoa é chaveada por nome em alguns pontos.
9. **Tarefa Transversal** dormant no banco e no código (UI removida).

---

## 15. Operação — o que quem continuar precisa saber

- **Deploy:** `vercel --prod --yes` a partir de `~/Developer/projectKanban`
  (diretório **PAI**, é onde está o `.vercel`). Root Directory do projeto =
  `kanban-project`.
- **Migration em produção:** setar `MIGRATE_ON_BUILD=1` +
  `EU_CONFIRMO_ESCRITA_EM_PRODUCAO` na Vercel → deploy (o guard aplica
  `migrate deploy` e aborta se houver perda de dados) → conferir o log →
  **REMOVER** as env vars. SQL aditivo e idempotente, **uma por deploy**, código
  com `try/catch` resiliente.
- **Verificação de build:** `npx tsc --noEmit` direto + `npm run build`. **NUNCA**
  usar `timeout` (não existe no shell → `tsc` falso-limpo). A quebra local por
  `R2_ACCOUNT_ID` vazio é **esperada**, não é regressão.
- **Lint:** `npm run lint` deve dar 0/0. Erro novo é regressão.
- **Middleware:** guarda `/api/gerenciamento/*` — toda rota (existente ou não) dá
  401 sem token. **401 não prova existência.**
- **Sessões concorrentes** costumam usar `git add -A` e absorver stage alheio.
  Conferir `git log` antes e depois de commitar.

---

*Fim do documento. Estado congelado em 30/07/2026, HEAD `f54d38c`.*
