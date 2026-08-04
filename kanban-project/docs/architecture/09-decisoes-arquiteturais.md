# 09 — Decisões arquiteturais (ADR)

> Baseline congelada em 04/08/2026. Toda decisão futura entra aqui, no commit da
> implementação. Ver [07-regras-de-evolucao](07-regras-de-evolucao.md).

| # | decisão | motivo |
|---|---|---|
| **D1** | `PhaseWorkflowInstance` continua por **processo + fase + ciclo**. Não existe WorkflowInstance por documento. | mudar a chave de instanciação reescreveria ciclos, `previousInstanceId`, supersessão, idempotência, movimentação manual e Operação Antecipada. O isolamento que o operador percebe já acontece no passo. |
| **D2** | Escopo (`PROCESSO/PESSOA/NECESSIDADE/DOCUMENTO`) é **enum**, não cadastro | dimensão fechada, sem atributo administrável, e já existia como tipo canônico no motor. Cadastro seria segunda fonte. |
| **D3** | Família, Natureza e Perfil **são** cadastro mestre | têm atributos administráveis (`exigeWorkflow`, ordem, descrição) |
| **D4** | Cardinalidade reusa `PhaseInternalWorkflowStep.cardinalidade` | o motor já a lia; declarar é backfill, não schema |
| **D5** | **Um perfil serve N tipos documentais** | nascimento, casamento e óbito têm o mesmo processo operacional — o que muda é a instância, não o modelo. Sem `workflow_emissao_nascimento`. |
| **D6** | **DOC21 sem perfil operacional** | é evidência da etapa "Solicitar certidão", não algo que se emite. Natureza `EVIDENCIA_DE_ETAPA` (`exigeWorkflow = false`), então o guard não cobra dele um perfil que ele não deve ter. |
| **D7** | `DocumentoArquivo` com os cinco vínculos numa linha | quatro tabelas de junção seriam quatro chances de divergir sobre o mesmo `fileId` |
| **D8** | Guards **recusam**, nunca corrigem | correção silenciosa foi como o cadastro chegou aos estados inválidos |
| **D9** | Ambíguo **não** se repara | vincular sem de onde deduzir é inventar |
| **D10** | `ON DELETE SET NULL` no documento permanece | CASCADE apagaria o histórico do passo; RESTRICT impediria excluir pessoa da árvore. As duas são piores que o vínculo nulo. |
| **D11** | Abas: só o que o operador usa | etapa = Anexos/Observações/Timeline; documento = 6 abas. Remoção é de **apresentação**; o domínio permanece intacto. |
| **D12** | Fingerprint do banco por hash de host+db+prefixo | verifica identidade sem guardar segredo |
| **D13** | Perfil Operacional é definido no **Cadastro Mestre**; o Workflow Interno apenas **consome** o contrato | quem sabe o que o documento é, é o cadastro. O workflow executa. |
| **D14** | A baseline verifica **invariantes**, nunca ids | prender a arquitetura ao processo 505 transformou uso normal do sistema em falha de build. Corrigido no mesmo dia. |

## Decisões congeladas — resumo executivo

✓ `PhaseWorkflowInstance` por processo + fase + ciclo
✓ NÃO existe WorkflowInstance por documento
✓ `documentoId` obrigatório para Steps documentais
✓ `documentoId` obrigatório para Tasks documentais
✓ Workflow de Emissão Documental trabalha **por documento**
✓ DOC21 é evidência da etapa e não tem workflow próprio
✓ Perfil Operacional definido no Cadastro Mestre
✓ Workflow Interno apenas consome o contrato
✓ Matriz Documental define o que deve nascer
✓ Materializador cria os documentos
✓ Runtime apenas executa

## Pendências declaradas

Não são dívida oculta — são decisões de esperar.

1. **Matriz Documental vazia** (0 regras). As 14 históricas apontavam para tipos de
   processo 0 e 5, inexistentes, e foram eliminadas com auditoria em 31/07. Sem
   regra não há materialização: é cadastro ausente, não defeito.
2. **Vínculos ambíguos** — passos e tarefas sem `documentoId` sem de onde deduzir.
   Reportados por `npm run auditar:vinculo-documental`, intocados por D9.
3. **Workflow 21** — órfão (`tipoProcessoId = 2` inexistente), ordem invertida,
   label corrompido, zero consumidores. Detectável pelo guard; não removido porque
   difere estruturalmente do vigente.
4. **DOC4 (batismo)** sem perfil: emitido por paróquia, não por cartório. Vincular
   é decisão de domínio, não inferência por o nome conter "Certidão".
5. **`JWT_SECRET` de produção é Sensitive** — smoke autenticado com token assinado
   localmente devolve 401. Não é defeito da aplicação.
