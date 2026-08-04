# 04 — Invariantes permanentes

> Baseline congelada em 04/08/2026. Cada invariante tem teste automático.
> Quebrar qualquer uma é regressão, não evolução.

## Estruturais — o que não pode existir

| # | invariante | onde é cobrada |
|---|---|---|
| I1 | Nenhum `StepInstance` documental sem `documentoId` | `invariante-documental.ts` · aborta a transação |
| I2 | Nenhuma `Task` documental sem `documentoId` | idem |
| I3 | Nenhuma `Task` documental sem `Step` | idem |
| I4 | `Task.documentoId` = `StepInstance.documentoId` | idem — divergir é erro, não preferência |
| I5 | Nenhum documento duplicado para a mesma necessidade | chave de idempotência da materialização |
| I6 | Nenhuma etapa duplicada por documento | `chaveIdempotencia` do passo |
| I7 | Materialização é idempotente | reexecutar não duplica, não reseta, não recria concluído |
| I8 | Nenhuma segunda fonte da verdade | suíte da baseline, seção 7 |
| I9 | Nenhuma escrita fora do fluxo canônico | uma implementação por escrita, verificada por grep |

## Contrato documental

| # | invariante |
|---|---|
| I10 | Tipo com natureza que **exige workflow** precisa de perfil operacional |
| I11 | Perfil **ativo** precisa apontar para workflow publicado e ativo |
| I12 | Workflow com escopo `DOCUMENTO` precisa declarar `exigeDocumento` |
| I13 | Workflow que exige documento precisa declarar escopo |
| I14 | Passo de workflow documental publicado precisa declarar cardinalidade |
| I15 | Workflow não pode apontar para `tipoProcessoId` inexistente |

## Arquivo e evidência

| # | invariante |
|---|---|
| I16 | Um upload físico = um `DocumentoArquivo` (unique `documentoId, url`) |
| I17 | No máximo **uma versão vigente** por (solicitação, tipo mestre) — índice parcial no banco |
| I18 | Substituir versiona: a anterior sai de vigência, **nunca** é apagada |
| I19 | O mesmo `fileId` aparece na etapa, no documento e no protocolo |

## Fonte única

| # | invariante |
|---|---|
| I20 | Classificação por **ID**, nunca por nome, código em texto ou regex |
| I21 | O runtime nunca escreve `"DOC21"` nem nome de documento como chave |
| I22 | Sem alias, sem fallback estrutural, sem estrutura paralela |

## Ambiente

| # | invariante |
|---|---|
| I23 | Produção não sobe sem as variáveis do banco, apontando para o fingerprint registrado |

## Como as invariantes falham

**Falha fechada, sempre.** Aborta a operação com erro estruturado
(`CONTRATO_DOCUMENTAL_VIOLADO:<motivo>` / `CONTRATO_DOCUMENTAL:<motivo>`), sem criar
estado parcial e sem fallback.

**Guards recusam; nunca corrigem.** Correção silenciosa foi exatamente como o
cadastro chegou aos estados inválidos que esta baseline fecha.
