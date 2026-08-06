# 03 — Dívidas técnicas

Dívida aqui é o que **já custou** ou **vai custar** — não estilo de código.
Cada item traz o commit ou o arquivo que a produziu.

---

## D-01 · Regressão da planilha documental-financeira · **RESOLVIDA em 06/08**

Fica registrada porque explica um modo de falha que vai se repetir.

**A cadeia quebrou em dois pontos, em dias diferentes:**

| Data | Commit | O que fez | Efeito |
|---|---|---|---|
| 26/07 | `9ffbbd20` | consolidou o Financeiro do Processo no `ProcessoFinanceiroShell` e removeu `subabas/Custos.tsx` | a Planilha (`TabelaCustos`) perdeu o último ponto de montagem — `ProcessoFaturas` ficou sem consumidor |
| 28/07 | `4fca632e` (cherry-pick `ecccbb34`) | motor de fase V3-native: `criarCusto` passou a criar `ObrigacaoEconomica` e parou de gravar no `Custo` legado | o leitor da planilha continuou consultando `prisma.custo` — tabela que ninguém mais alimenta |

**A causa raiz não é nenhum dos dois isoladamente.** É que a
`ObrigacaoEconomica` **não tinha onde guardar o vínculo documental**. O `Custo`
legado carregava `personId`/`documentoId`/`tipoServicoId`/`phaseKey`; a obrigação
não. O vínculo virou string em `observacoes` (`"· doc#2080"`), e o financeiro
passou a saber **quanto** sem saber **de quem** e **de quê**.

**E havia um terceiro elo, que nunca existiu:** o gatilho. O custo era projetado
em `phase.entered` (entrada de fase), nunca em "registro localizado". O evento
canônico `step.concluido` **já era emitido** transacionalmente por
`task-step-sync` — e não estava em `TIPOS_DRENADOS`. Cinco eventos esperavam na
fila.

**Correção (06/08):** migration aditiva devolveu o vínculo + snapshot de preço +
`chaveIdempotencia` `@unique`; o motor voltou a gravá-los; o dispatcher passou a
drenar `step.concluido`; a leitura da planilha migrou para a fonte V3; a visão
foi restaurada como terceira vista da aba Custos. 30/30 em
`test:custo-documental`.

**Lição a proteger com guard:** *quando o writer de um domínio muda de tabela, o
leitor precisa mudar junto — e um teste precisa reprovar se não mudar.*

---

## D-02 · Um documento só conseguia gerar UM componente econômico

**Onde.** `matriz-economica.ts`, função `resolverRegraEconomica` (agora
`resolverPlanoEconomico`).

**O que era.** A resolução usava `find` — devolvia **a primeira**
`PhaseEconomicRule` aplicável. "Certidão de nascimento → emissão + apostilamento
+ tradução + apostilamento da tradução" era **impossível de configurar**: o
segundo componente cadastrado nunca era alcançado.

**Consequência escondida.** A chave de idempotência era
`…::matriz:<regra>::doc:<id>` — sem o componente. Com N componentes, todos
colidiriam na mesma chave e o segundo seria descartado como "já criado".

**Corrigido em 06/08.** A precedência continua a mesma (regra específica vence a
regra "qualquer documento"); dentro da precedência vencedora, **todos** os
componentes valem, e a chave passou a incluir `::comp:<componentKey>`. Seguro
porque **não existe nenhum artefato `ruleSource: 'matriz'` em produção** —
verificado antes da mudança.

**Nota de arquitetura.** Isto é o "Plano de Tratamento Documental" pedido na
especificação, implementado **no cadastro que já existia** em vez de numa tabela
nova. `PhaseEconomicRule` já era exatamente "tipo documental + fase → componente +
configuração financeira"; faltava permitir mais de uma linha por documento.

---

## D-03 · `GET /processos/[id]/custos` sem gate de permissão

Encontrada por `financeiro-autorizacao-guard` durante esta auditoria. A rota lia
custos de qualquer processo sem exigir `financeiro.ver`. Passava despercebida
porque a tela que a consumia estava morta. **Corrigida em 06/08.**

---

## D-04 · `item-config` não expõe a conta contábil

`lancamento-financeiro.test.ts` reprova
`chk(/contaContabilLabel/.test(rotaConfig))`. **Pré-existente** — confirmado
rodando a suíte em `main` limpo (64 passaram, 1 falhou, mesma falha).

Provável consequência da eliminação da classificação financeira (categorias /
plano de contas / centros de custo saíram; o `PlanoContaFinanceira` do motor V3
permaneceu). O teste ainda cobra o rótulo antigo.

**Decisão pendente:** ou a rota volta a expor a conta (vinda do plano fixo do
Ledger), ou o teste é atualizado para cobrar o que a arquitetura atual promete.
**Não relaxar o teste sem decidir qual das duas.**

---

## D-05 · Migrations pós-baseline não são idempotentes

**Evidência.** `prisma migrate deploy` num banco virgem morre na terceira:
`20260803b_cardinalidade_passo` → `column "cardinalidade" ... already exists`,
porque o baseline regenerado já a contém.

**Consequência.** O baseline serve para recriar o schema (disaster recovery), mas
**baseline + migrations subsequentes não é um caminho válido**. Só o caminho de
produção funciona (baseline já aplicado, migrations novas por cima).

**Mitigação já em uso:** a migration de 06/08 é integralmente
`ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` — aplicada duas vezes
seguidas num banco com o schema de produção, sem erro e com **zero drift** contra
o `schema.prisma`.

**Padrão a adotar:** toda migration nova, idempotente por construção.

---

## D-06 · Componentes mortos

`ProcessoFaturas.tsx` e `TabelaCustos.tsx` — zero consumidores desde `9ffbbd20`.
Foram mantidos nesta entrega porque a resposta da API preservou o formato legado
(eles voltaram a receber dados **reais**, da fonte V3). A remoção é a decisão
correta, mas é decisão separada.

---

## D-07 · Ruído de `P2002` no log do motor econômico

A idempotência do `MotorArtefato` é *tentar criar e capturar a violação de chave
única*. Funciona e é correta sob concorrência — mas o `prisma:error` aparece no
log a cada reprocesso, o que faz operação normal parecer erro.

**Fecha quando:** o caminho feliz do reprocesso não emitir `prisma:error`
(consulta prévia + fallback no catch, mantendo a captura como rede de segurança).

---

## D-08 · Tipagem e observabilidade

426 `: any`, 633 `console.error`, 30 `console.log`, 68 `TODO/FIXME`, 160 arquivos
mencionando legado/deprecated. O caminho do custo documental já nasceu com log
estruturado JSON + `correlationId` — é o padrão a espalhar, não a inventar.
