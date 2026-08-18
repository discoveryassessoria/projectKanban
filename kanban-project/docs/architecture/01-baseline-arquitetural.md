# Baseline Arquitetural do Discovery

**Congelada em 04/08/2026** · commits `356b78c6` (contrato) · `0e01814a` (UI + guards) · `e1608239` (invariantes)

Esta é a arquitetura oficial. Evolução futura **estende**; não substitui, não reescreve.
Toda alteração estrutural exige justificativa técnica registrada e não pode quebrar
nada descrito aqui.

Validação automática: `npm run test:arquitetura-baseline`. **Nenhuma implementação
está concluída se essa suíte falhar.**

## Índice oficial

Este documento é o resumo executivo. O detalhe vive nos seguintes, e os nove são a
mesma verdade em profundidades diferentes — mudam juntos.

| doc | responde |
|---|---|
| **01** (este) | a arquitetura inteira, em uma passada |
| [02 — Modelo de domínio](02-modelo-de-dominio.md) | quais entidades existem e quem é o centro |
| [03 — Runtime documental](03-runtime-documental.md) | como a execução acontece |
| [04 — Invariantes](04-invariantes.md) | o que nunca pode ser verdade |
| [05 — Materialização](05-materializacao.md) | como documento e execução nascem |
| [06 — Fonte da verdade](06-fonte-da-verdade.md) | por que existe só uma de cada coisa |
| [07 — Regras de evolução](07-regras-de-evolucao.md) | o que pode e o que não pode mudar |
| [08 — Checklist de regressão](08-checklist-de-regressao.md) | o que rodar antes de qualquer deploy |
| [09 — Decisões (ADR)](09-decisoes-arquiteturais.md) | o que foi decidido, e por quê |

---

## 1. Modelo de domínio aprovado

### 1.1 Cadastro (o que o sistema sabe antes de qualquer processo)

| entidade | papel | regra |
|---|---|---|
| `TipoDocumentoCadastro` | o documento mestre | declara família, natureza operacional e perfil |
| `FamiliaDocumental` | o que o documento **é** em grupo operacional | cadastro mestre, `code` estável |
| `NaturezaOperacionalDocumento` | **como** ele entra na operação | `exigeWorkflow` separa o que se processa do que só se anexa |
| `PerfilOperacionalDocumento` | a ponte cadastro ↔ workflow | aponta para o workflow publicado e declara o escopo |
| `PhaseInternalWorkflow` | o modelo de execução | declara `escopoExecucao`, `exigeDocumento`, `exigePessoa` |
| `PhaseInternalWorkflowStep` | o passo publicado | declara `cardinalidade` |
| `MatrizDocumental` | quem precisa de qual tipo documental | seleciona `documentTypeCode`; **não** cadastra passos |

### 1.2 Operação (o que nasce por processo)

| entidade | papel |
|---|---|
| `NecessidadeDocumental` | a exigência concreta de uma pessoa num processo |
| `Documento` | o documento operacional (pessoa + tipo + processo) |
| `PhaseWorkflowInstance` | **uma por (processo, fase, ciclo)** |
| `PhaseWorkflowStepInstance` | o passo executável, escopado por documento/pessoa/necessidade |
| `Tarefa` | a projeção do passo para quem executa |
| `SolicitacaoDocumento` | o ato de solicitar ao órgão |
| `Protocolo` | o número que o órgão devolve |
| `DocumentoArquivo` | o arquivo — **uma linha, todos os vínculos** |
| `DocumentoObservacao` | observação append-only |

---

## 2. Fluxo operacional aprovado

**Não muda.** A alteração de arquitetura foi estrutural, nunca operacional.

```
Emissão Documental (por documento)
  1. Solicitar certidão
  2. Aguardar retorno do cartório
  3. Receber certidão
  4. Conferir certidão
  5. Validar certidão
```

Ordem, nomes, obrigatoriedade, SLA, executor, automações e regras de conclusão são
**congelados**. Alterá-los é mudança de produto, não de arquitetura.

---

## 3. Relações entre entidades

### 3.1 A cadeia canônica

```
MatrizDocumental
    │ seleciona documentTypeId
    ▼
TipoDocumentoCadastro ──► FamiliaDocumental
    │                └──► NaturezaOperacionalDocumento (exigeWorkflow)
    │ perfilOperacionalId
    ▼
PerfilOperacionalDocumento ──► PhaseInternalWorkflow (publicado)
    │ escopoInstanciacao = DOCUMENTO                    │
    │                                                   └─► PhaseInternalWorkflowStep
    ▼                                                        (cardinalidade)
NecessidadeDocumental ──► Documento (pessoa + processo + tipo)
                              │
                              ▼
        PhaseWorkflowInstance  (1 por processo+fase+ciclo)
                              │
                              ├─► StepInstance [documentoId] ──► Tarefa [documentoId]
                              └─► StepInstance [documentoId] ──► Tarefa [documentoId]
```

### 3.2 O isolamento é do passo, não da instância

Decisão congelada: **uma `PhaseWorkflowInstance` por fase/ciclo**. O isolamento por
documento acontece em `StepInstance` e `Tarefa`.

```
PhaseWorkflowInstance (emissao_documental, ciclo 1)
├── Documento A ── Solicitar · Aguardar · Receber · Conferir · Validar
└── Documento B ── Solicitar · Aguardar · Receber · Conferir · Validar
```

Cada documento tem passos, tarefas, progresso, anexos, solicitação e histórico
**próprios**. O agrupador técnico é a fase; a experiência operacional é por documento.

### 3.3 O arquivo: uma linha, todos os vínculos

`DocumentoArquivo` carrega `documentoId`, `solicitacaoId`, `stepInstanceId`,
`protocoloId` e `documentTypeId` na **mesma linha**.

**Proibido** criar `StepAttachment` / `RequestAttachment` / `ProtocolAttachment` /
`DocumentAttachment`: quatro tabelas de junção seriam quatro chances de divergir
sobre o mesmo `fileId`.

---

## 4. Regras invariantes

Cada uma tem teste automático. Quebrar qualquer uma é regressão.

### 4.1 Contrato documental
1. Tipo com natureza que **exige workflow** precisa de perfil operacional.
2. Perfil **ativo** precisa apontar para workflow publicado e ativo.
3. Workflow com escopo `DOCUMENTO` precisa declarar `exigeDocumento`.
4. Workflow que exige documento precisa declarar escopo.
5. Passo de workflow documental publicado precisa declarar cardinalidade.
6. Workflow não pode apontar para `tipoProcessoId` inexistente.

### 4.2 Materialização
7. Passo de workflow documental **não nasce** sem `documentoId` — aborta a transação.
8. Tarefa **herda** o documento do passo; nunca escolhe o seu.
9. Tarefa e passo apontando para documentos diferentes é erro.
10. Tarefa de origem workflow precisa apontar para o passo.
11. Materialização é idempotente: reexecutar não duplica, não reseta, não recria concluído.

### 4.3 Arquivo e evidência
12. Um upload físico = um `DocumentoArquivo` (unique `documentoId, url`).
13. No máximo **uma versão vigente** por (solicitação, tipo mestre) — índice parcial no banco.
14. Substituir versiona: a anterior sai de vigência, nunca é apagada.
15. O mesmo `fileId` aparece na etapa, no documento e no protocolo.

### 4.4 Fonte única
16. Classificação por **ID**, nunca por nome, código em texto ou regex.
17. O runtime nunca escreve `"DOC21"` nem nome de documento como chave.
18. Sem alias, sem fallback, sem estrutura paralela.

### 4.5 Ambiente
19. Produção não sobe sem `PRISMA_DATABASE_URL`/`DIRECT_DATABASE_URL` — e apontando
    para o banco registrado (fingerprint).

---

## 5. Decisões arquiteturais

| # | decisão | motivo |
|---|---|---|
| D1 | **Instância por fase/ciclo**, não por documento | mudar a chave de instanciação reescreveria ciclos, supersessão, idempotência, movimentação manual e Operação Antecipada |
| D2 | Escopo (`PROCESSO/PESSOA/NECESSIDADE/DOCUMENTO`) é **enum**, não cadastro | dimensão fechada, sem atributo administrável, e já existia como tipo canônico no motor — cadastro seria segunda fonte |
| D3 | Família, Natureza e Perfil **são** cadastro | têm atributos administráveis (`exigeWorkflow`, ordem, descrição) |
| D4 | Cardinalidade reusa a coluna existente | o motor já a lia; declarar é backfill, não schema |
| D5 | Um perfil serve N tipos documentais | nascimento, casamento e óbito têm o mesmo processo — o que muda é a instância, não o modelo. Sem `workflow_emissao_nascimento` |
| D6 | DOC21 **sem** perfil operacional | é evidência de etapa, não algo que se emite |
| D7 | `DocumentoArquivo` com 5 vínculos numa linha | ver 3.3 |
| D8 | Guards **recusam**, nunca corrigem | correção silenciosa foi como o cadastro chegou a estados inválidos |
| D9 | Ambíguo não se repara | vincular sem de onde deduzir é inventar |
| D10 | `ON DELETE SET NULL` no documento permanece | CASCADE apagaria histórico do passo; RESTRICT impediria excluir pessoa |
| D11 | Abas: só o que o operador usa | etapa = Anexos/Observações/Timeline; documento = 5 abas, começando pelo Workflow. Remoção é de apresentação; o domínio fica |
| D12 | Fingerprint do banco por hash de host+db+prefixo | verifica identidade sem guardar segredo |

---

## 6. Diagramas

### 6.1 Solicitar certidão — uma transação

```
POST /api/documentos/{id}/solicitacoes
        │
        ▼  BEGIN ────────────────────────────────────────────
   valida canal · permissão · passo · documento
   resolve exigência de evidência (por ID do cadastro)
        │
   SolicitacaoDocumento (upsert por chaveIdempotencia)
   Protocolo (+ ProtocoloDocumento)        ── se houver número
   DocumentoArquivo  ← documentTypeId = DOC21
        └── solicitacaoId · stepInstanceId · protocoloId
   DocumentoObservacao (append-only)
   transição do passo → arrasta tarefa → libera o próximo
   LogAuditoria
        ▼  COMMIT ───────────────────────────────────────────
```

Falha em qualquer ponto → ROLLBACK. Não sobra arquivo órfão, protocolo sem
solicitação nem etapa concluída pela metade.

### 6.2 As três visões do mesmo arquivo

```
                   DocumentoArquivo #1
                   url = …/req.png  (um binário no R2)
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
  Anexos da etapa   Anexos do doc      Protocolo
  (stepInstanceId)  (documentoId)      (protocoloId)
        └─────────── mesmo fileId ──────────┘
```

---

## 7. Checklist de regressão obrigatório

Antes de qualquer deploy:

- [ ] `npm run lint` — zero
- [ ] `npx tsc --noEmit` — limpo (apagar `tsconfig.tsbuildinfo` antes)
- [ ] `npm run build`
- [ ] `npm run test:arquitetura-baseline` — **a suíte desta baseline**
- [ ] `npm run test:baseline` — schema em dia com o `schema.prisma`
- [ ] Migration: aditiva, idempotente, sem DROP/TRUNCATE/DELETE, com backup
- [ ] Ledger `0000_baseline` reconciliado se o baseline mudou
- [ ] Smoke: `/login` 200 · `/api/auth/login` 401 (não 500) · 0 respostas 5xx
- [ ] Contagens antes/depois: Tarefa, StepInstance, WorkflowInstance, Documento
- [ ] Contagens de processo/tarefa/passo explicadas — toda variação tem causa conhecida

**Proibido:** `prisma db push` · `prisma migrate reset` · seed destrutivo ·
truncate · delete em massa.

---

## 8. Testes obrigatórios antes de qualquer deploy

| suíte | comando | cobre |
|---|---|---|
| **Baseline arquitetural** | `test:arquitetura-baseline` | agrega as nove dimensões congeladas |
| Contrato documental | `test:contrato-doc` | cadastro, guards, UI |
| Invariante documental | `test:invariante-doc` | materialização, Step↔Task |
| DOC21 | `test:doc21` | classificação, vínculos, versionamento |
| Abas | `test:abas` | interface enxuta, domínio preservado |
| Solicitação | `test:solicitacao` | fonte única do ato |
| Editor de etapa | `test:editor-etapa` | execução dos cinco passos |
| Passo ↔ tarefa | `test:passo-tarefa` | coerência |
| Materialização | `test:materializacao` | serviço único |
| phaseKeys | `test:phasekeys` | zero legado |
| Central | `test:central-unificada` · `test:estrutura-operacional` | leitura por ciclo |
| Projeção | `test:operational-projection` · `test:emissao-gate` | 100% ⟺ pode avançar |
| Ambiente | `test:env-producao` | banco certo em produção |
| Schema | `test:baseline` | baseline × schema |

---

## Apêndice — pendências declaradas (não são dívida oculta)

1. **Matriz Documental vazia.** 0 regras publicadas. As 14 históricas apontavam para
   tipos de processo 0 e 5, inexistentes, e foram eliminadas com auditoria em 31/07.
   Sem regra não há materialização — é cadastro ausente, não defeito.
2. **Vínculos ambíguos** — passos e tarefas sem `documentoId` que não têm de onde
   deduzir. Reportados por `npm run auditar:vinculo-documental`, **intocados por
   decisão**: vincular sem deduzir é inventar. Em 04/08 eram 13, no processo 505;
   esse processo foi depois excluído pelo operador e outros nasceram. A baseline
   não se prende a ids — ela congela a invariante, e o script reconta a qualquer
   momento.
3. **Workflow 21** — órfão (`tipoProcessoId = 2` inexistente), ordem invertida, label
   corrompido, 0 consumidores. Detectável pelo guard; não removido.
4. **DOC4 (batismo)** sem perfil: emitido por paróquia, não por cartório. Vincular é
   decisão de domínio.
5. **`JWT_SECRET` de produção é Sensitive** — smoke autenticado com token local
   devolve 401. Não é defeito da aplicação.
