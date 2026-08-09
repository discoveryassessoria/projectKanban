# ADR 14 — Requerente do Processo × Membro da Árvore

**Status:** aceito · 09/08/2026
**Contrato em código:** `lib/genealogia/estados-requerente.ts`
**Guards:** `test:guard-cadastro-arvore` · `test:guard-porta-requerente` · `test:guard-derivado`
**Testes:** `test:matriz-estados` · `test:porta-requerente` · `test:reconciliacao-derivada`

---

## A regra

> **Existir no processo não é participar da árvore.**

Um requerente pode ficar cadastrado num processo por um dia, um mês ou um ano sem
nunca entrar na Árvore Genealógica. Esse é um **estado legítimo de negócio**: não é
pendência técnica, não é inconsistência, não é corrupção, e **não se repara**.

O que inicia o ciclo genealógico é **uma transição explícita do usuário** —
"adicionar à árvore" — e nunca a mera existência do cadastro.

## Por que precisou virar ADR

O contrato estava certo na cabeça de quem o desenhou e foi violado três vezes,
de três formas diferentes, sem que nada quebrasse:

| # | violação | consequência medida |
|---|---|---|
| 1 | a rota HTTP era dona do efeito de entrada | tela e serviço produziam estados finais diferentes; requerentes 134/135/137 do processo 513 tiveram nó de árvore e nunca geraram `MotorArtefato` |
| 2 | o motor econômico tinha o adicionar e não tinha o retirar | R$ 47.382,42 de receita ativa sem causa viva no processo 513 |
| 3 | cinco consultas contavam requerente por régua de flag própria | régua local = 0 requerentes no 513, régua canônica = 1 |

Nenhuma delas lançou exceção. Regra que vive só em prosa é combinado; regra que
vive em módulo, é lida por quem decide e é verificada no CI, é contrato.

## Os quatro estados

| estado | vínculo com o processo | nó na árvore | efeitos genealógicos |
|---|---|---|---|
| `FORA_DO_PROCESSO` | não | — | nenhum |
| `FORA_DA_ARVORE` | **sim** | não | **nenhum** — e está certo |
| `NA_ARVORE` | sim | ativo, marcado requerente | documental · workflow · financeiro · Central · linhagem |
| `REMOVIDO_DA_ARVORE` | **sim, preservado** | inativo | nenhum; o que perdeu a última causa é reconciliado |

O estado é lido dos **fatos** (`classificarEstado`), nunca de `Requerente.personId`
sozinho: `personId` responde *quem é esta pessoa*, não *se ela participa da árvore*.

## Transições e gatilhos

| de → para | gatilho | porta | evento |
|---|---|---|---|
| `FORA_DO_PROCESSO` → `FORA_DA_ARVORE` | cadastrar no processo (ato administrativo) | `PUT /api/processos/[id]` · `criar-processo` | **nenhum** |
| `FORA_DA_ARVORE` → `NA_ARVORE` | usuário escolhe **adicionar à árvore** | `vincularRequerente` | `requerente.adicionado` |
| `NA_ARVORE` → `REMOVIDO_DA_ARVORE` | remover, havendo fato protegido | `removerPessoaDaArvore` (DESATIVAR) | — |
| `NA_ARVORE` → `FORA_DA_ARVORE` | remover, sem fato protegido | `removerPessoaDaArvore` (HARD) | — |
| `REMOVIDO_DA_ARVORE` → `NA_ARVORE` | adicionar de novo | `vincularRequerente` (reativa o nó) | `requerente.adicionado` |

Repare no que **não** existe: nenhuma transição para `NA_ARVORE` cujo gatilho seja
cadastrar. Cadastrar leva a `FORA_DA_ARVORE` e **para nele**.

## O que o cadastro pode e o que não pode

**Pode:** criar/atualizar o cadastro administrativo, vincular ao processo, guardar
os dados do cliente.

**Não pode, como efeito automático:** adicionar à árvore, criar membership, criar
relação de filiação, materializar necessidades documentais, criar tarefas, criar
participante financeiro, gerar receita ou custo cujo gatilho seja a entrada na
árvore, emitir `requerente.adicionado`.

## Porta única

Toda entrada na árvore — UI, script, teste, backfill autorizado, serviço — passa
pelo mesmo serviço, na mesma transação, com o mesmo evento e o mesmo pós-commit,
terminando no mesmo estado. Ver ADR de porta única no cabeçalho de
`lib/genealogia/vincular-requerente.ts`.

`vincularRequerenteTx` enfileira o evento **dentro** da transação recebida;
`efeitosDoVinculoPosCommit` drena a fila e reavalia as Regras Documentais. Quem
compõe com transação própria é obrigado, por guard, a chamar os dois.

## Saída e reentrada

Remover da árvore **não** remove o requerente do processo. Reinserir recalcula pelo
motor oficial, sem duplicar Pessoa, membership, receita, participante ou documento.

## Saúde do sistema

**Nunca** alertar porque um requerente ainda não foi adicionado à árvore — isso
ensinaria a equipe a ignorar o alerta, e o próximo alerta real morre junto.

Inconsistências reais que **valem** alerta: membership ativo sem identidade;
efeito financeiro genealógico sem causa genealógica; documento derivado sem causa;
membership ou evento duplicado; requerente fora da árvore **produzindo** efeito que
exige membership; requerente dentro da árvore com pós-commit não concluído.

## Testes e produção

Teste automatizado **não escreve em produção**. A trava é
`scripts/_banco-de-teste.ts` (`exigirBancoDeTeste`): exige host local **e**
database com "test" no nome — as duas condições. Os poucos scripts cujo propósito
é escrever no ambiente real usam `exigirConfirmacaoDeEscritaEmProducao`, que
recusa sem `EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1`, e estão declarados nominalmente
no guard.

Contexto: a auditoria de 09/08/2026 encontrou **49** testes que escrevem em banco
sem verificar ambiente. Rodando com o `.env` do projeto — que aponta para
produção — cada um deles montava e derrubava cenário no banco do cliente.
