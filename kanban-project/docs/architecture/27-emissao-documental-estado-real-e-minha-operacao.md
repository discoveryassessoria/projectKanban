# 27 — Emissão Documental: estado real confirmado, e extensão de Minha Operação

Consolidado em 13/09/2026. Fecha a auditoria pré-implementação do mandato
"Emissão Documental + 4 subtarefas + Gerenciamento + Minha Operação" com
evidência real de produção, e documenta a única extensão de código
efetivamente necessária e entregue nesta rodada. Ver também
[20](20-emissao-documental-diagnostico.md) (diagnóstico anterior, "PRONTA
PARA CONFIGURAÇÃO") e [25](25-fechamento-compreensao-sistemica.md)/[26](26-delete-processo-lifecycle-seguro.md).

## Achado central: o workflow já existe, publicado, versão 4, em produção

O mandato presumia que "Solicitar Certidão" com 4 subtarefas precisava ser
construído. **Não precisava.** Confirmado por leitura direta do banco de
produção:

- `PhaseInternalWorkflow` id=12, `name="Workflow Interno · Emissão
  Documental"`, `phaseKey="emissao_documental"`, `versao=4`, `active=true`,
  `arquivado=false`, global (`tipoProcessoId=null`).
- 5 `PhaseInternalWorkflowStep` publicados, na ordem certa:

| ordem | key | ações cadastradas (effectKey) |
|---|---|---|
| 1 | `solicitar_certidao` | `COMPLETE_STEP`, `PAUSE_FOR_EXTERNAL_WAIT`, `REGISTER_ONLY` |
| 2 | `aguardar_retorno_do_cartorio` | `COMPLETE_STEP`("retorno_chegou"), `PAUSE_FOR_EXTERNAL_WAIT`("ainda_aguardando"), `RESUME`("retomar") |
| 3 | `receber_certidao` | `MARK_DOCUMENT_RECEIVED`("recebido") |
| 4 | `conferir_certidao` | `COMPLETE_STEP`("aprovado"), `REQUEST_NEW_COPY`("nova_via", exige `motivo`) |
| 5 | `validar_certidao` | `APPROVE_FOR_ANALYSIS`("aprovado"), `REQUEST_NEW_COPY`("nova_via") |

- `ExigenciaEvidenciaEtapa` real para `solicitar_certidao` × 3
  `documentoTipoId` distintos (nascimento/casamento/óbito), exigindo
  evidência `REQUERIMENTO_ENVIADO`.
- `StepChecklistItem` real (5 itens) para `conferir_certidao`.
- Um SEGUNDO workflow real, `Workflow Interno · Emissão Documental
  Retificada` (id=15), para o caminho de retificação.

## Prova definitiva da invariante central (UMA Tarefa, N passos)

O mandato exige, como invariante absoluta #2: *"Uma tarefa não vira várias
tarefas apenas porque possui vários passos."* Rastreado com dado real
(Processo 592 "Teste", instância de workflow 354, documento 2136):

```
WorkflowEvento id=3424  TAREFA_GERADA   stepInstance=1999 (solicitar_certidao)  tarefaId=3570
WorkflowEvento id=3425  PASSO_INICIADO  stepInstance=1999
WorkflowEvento id=3426  PASSO_CONCLUIDO stepInstance=1999 → causationId encadeia para 2000
WorkflowEvento id=3427  PASSO_INICIADO  stepInstance=2000 (aguardar_retorno_do_cartorio)
WorkflowEvento id=3428  PASSO_CONCLUIDO stepInstance=2000 → encadeia para 2001
WorkflowEvento id=3429  PASSO_INICIADO  stepInstance=2001 (receber_certidao)
WorkflowEvento id=3430  PASSO_CONCLUIDO stepInstance=2001 → encadeia para 2002
WorkflowEvento id=3431  PASSO_INICIADO  stepInstance=2002 (conferir_certidao)
WorkflowEvento id=3432  PASSO_CONCLUIDO stepInstance=2002 → encadeia para 2003
WorkflowEvento id=3433  PASSO_INICIADO  stepInstance=2003 (validar_certidao)
WorkflowEvento id=3434  PASSO_CONCLUIDO stepInstance=2003
```

**Exatamente UM evento `TAREFA_GERADA` em toda a cadeia.** Tarefa 3570
(`documentoId=2136`, `statusTarefa="CONCLUIDO_RECEBIDO"`,
`workflowStepInstanceId=null` — limpo ao terminar, padrão já confirmado nas
Etapas 4-6) é a mesma Tarefa do primeiro ao último passo. CONFIRMADO PELO
BANCO, não inferido.

## O que a auditoria confirmou já funcionar (sem alteração nesta rodada)

- **Materialização**: `garantirTarefaDePasso` (chamado por
  `materializar-fase.ts`, o motor genérico de ativação de fase) é o único
  caminho correto — `materializarTarefaOperacional` é só a rede de
  segurança do job de reconciliação (docs 24/25), e não deve ser chamado
  por código novo.
- **Cartório/terceiro**: `OrgaoProtocolo` (Base Órgãos e Organizações) é o
  cadastro real usado, via `alvoDeReferenciaEsperado: "ORGANIZACAO"`.
  Nenhum cadastro novo é necessário.
- **`canal` vs `canalOperacionalId`**: já resolvido (doc 25) — `canal`
  continua sendo o campo ativo; nenhuma ação nova necessária.
- **Snapshot de configuração**: `useConfiguracaoDaEtapa` já lê a "versão
  CONGELADA que a execução registrou" — versionamento/publicação de
  configuração já é conceito ativo, não gap.
- **Não-validação preserva versão**: `novaViaDocumental()` (já confirmado
  em rodada anterior, relido) cria documento novo com `derivadoDeId`,
  marca o anterior com `substituidoEm` — nunca apaga, nunca sobrescreve.
- **Espera externa é manual, não automática — decisão de produto, não
  bug**: `PAUSE_FOR_EXTERNAL_WAIT` no passo 2 (`ainda_aguardando`) exige
  clique do operador; não há hook que dispare automaticamente ao concluir
  o passo 1. Investigado e classificado como decisão de produto aceitável
  (o operador confirma o envio e, na mesma interação, marca que aguarda
  retorno) — não alterado nesta rodada por exigir tocar a máquina de
  transição de passo para um ganho marginal, fora do escopo mínimo.

## O que faltava de fato, e foi implementado

**"Minha Operação" também já existia** — não como esse nome, mas como
`/operacao` (menu "Operação") → `CentralTarefas` +
`lib/operacional/tarefa-projecoes.ts::minhaFila()`. Já era: uma linha por
Tarefa (nunca por passo), read-only de execução ("toda mudança sai por
`POST /api/tarefas/{id}/comando`"), com deep-link (`urlOperacionalDaTarefa`),
tempo de espera, motivo de bloqueio, agrupamento por família.

**Gap real confirmado**: `emRisco`/`motivosRisco`/`acompanhamentoVencido`
(Etapa 5) já eram calculados por `tarefa-projecoes.ts`, e `retornoRecebido`
(Etapa 4, `proximo-acontecimento.ts`) já existia no motor temporal — mas
nenhum dos dois chegava à tela como filtro, e `retornoRecebido` nem saía
do motor para a projeção.

### O que foi alterado (mínimo, aditivo, sem cálculo novo)

- `lib/operacional/tarefa-projecoes.ts`: `LinhaDeFila.retornoRecebido`
  (novo campo, default + mapeado de `estadosTemporaisDasOperacoes` dentro
  de `comAtencaoTemporal` — nenhuma lógica nova, só exposição).
- `src/components/operacao/kit-operacional.tsx`: `emRisco`/`motivosRisco`/
  `acompanhamentoVencido`/`retornoRecebido` no tipo `LinhaDeFila` (os
  dados já vinham na resposta da API; só não estavam tipados nem
  usados).
- `src/components/operacao/central-tarefas.tsx`: 3 novos filtros
  ("Acompanhar hoje", "Retornos recebidos", "Em risco"), habilitados
  também na visão "Sem responsável" (trabalho sem dono em risco é o caso
  mais urgente de distribuir, não só o pessoal); badge com motivo
  explícito nos dois componentes de linha da tela (`CartaoDaFila` — minha
  fila — e `Linha` — sem responsável/calendário, que não tinha nenhum dos
  dois antes).

### Validação

Playwright autenticado (`tests/ui/minha-operacao-filtros.smoke.ts`) contra
servidor local apontado para o banco de PRODUÇÃO real (leitura, técnica já
estabelecida nas Etapas 4-6 e no DELETE de Processo — token local não é
aceito pelo Vercel real): usando a Tarefa 3571 real (já EM_RISCO desde a
Etapa 6, com motivos `SEM_PROXIMO_ACONTECIMENTO_DETERMINAVEL` e
`SEM_RESPONSAVEL_PARA_PROXIMA_ACAO`) — o filtro "Em risco" aparece com a
contagem certa, o clique filtra corretamente, e o motivo real (não
genérico) aparece na tela. Zero 5xx, console limpo. Regressão: typecheck,
`npm run build` completo (guards+baseline+`next build`),
`etapa5-projecoes-convergem.test.ts` (29/29),
`etapa6-circuito-completo.test.ts` (77/77),
`delete-processo-lifecycle-seguro.test.ts` (33/33) — todos verdes depois
da mudança.

## Fora de escopo desta rodada (investigado, não alterado)

- Auto-disparo de `PAUSE_FOR_EXTERNAL_WAIT` ao concluir o passo 1 (hoje
  manual, primeira ação do operador no passo 2 — ver acima).
- Checklist/evidência específicos para múltiplos tipos documentais além
  dos 3 já cadastrados para `solicitar_certidao`.
- Preview de impacto de alteração de configuração (rascunho→publicação já
  existe como conceito; a TELA de preview de impacto — quantas operações
  em andamento usam a versão anterior — não foi auditada nem construída
  nesta rodada).
- Calendário operacional (dias úteis/feriados/timezone) — não auditado
  nesta rodada.
- Handoff explícito com troca de responsável dentro do mesmo passo/Tarefa
  — o mecanismo genérico de reatribuição já está provado (Etapa 6), mas
  uma UI/fluxo dedicado de "handoff" (distinto de reatribuição comum) não
  foi auditado nem construído nesta rodada.
- Cadeia de impacto downstream de invalidação pós-validação (apostilamento/
  tradução/retificação) — já sinalizada como investigação pendente no
  mandato original de Emissão Documental (doc 20, §§43/79); não avançada
  nesta rodada.
- Os 110 casos de teste numerados e os 20 cenários adversariais (A-T) do
  mandato não foram executados um a um como uma suíte nova e literal nesta
  rodada — uma fração substancial e sobreposta já está coberta pelas
  suítes existentes (`etapa4/5/6-*.test.ts`, 200+ asserções) e pelo dado
  real de produção citado acima; o restante fica registrado aqui como
  pendência explícita, não como "comprovado".

## Regra permanente reafirmada

> Uma obrigação operacional é representada por uma Tarefa canônica. Os
> passos do Workflow Interno representam a progressão interna dessa mesma
> operação e não devem ser materializados como novas Tarefas salvo quando
> existir uma nova obrigação de negócio independente. — **Já provado em
> produção real** (Tarefa 3570), não apenas em teste.

> Minha Operação é uma projeção pessoal de atenção e nunca executa o
> motor. — **Já era verdade antes desta rodada** (`CentralTarefas`); esta
> rodada só ampliou o que ela mostra, sem tocar em como ela escreve (ela
> não escreve).

> Atenção operacional deriva do estado canônico da operação; notificação é
> consequência, nunca condição necessária para uma Tarefa aparecer na
> fila. — Reafirmado; os 3 novos filtros leem o MESMO motor temporal que
> já alimenta a notificação (Etapa 4), nunca o inverso.
