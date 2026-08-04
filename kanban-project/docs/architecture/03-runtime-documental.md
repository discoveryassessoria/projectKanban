# 03 — Runtime documental

> Baseline congelada em 04/08/2026.

## A cadeia de execução

```
PhaseWorkflowInstance   ← UMA por (processo, fase, ciclo)
        │
        ├── StepInstance [documentoId=A] ──► Tarefa [documentoId=A]
        ├── StepInstance [documentoId=A] ──► Tarefa [documentoId=A]
        ├── StepInstance [documentoId=B] ──► Tarefa [documentoId=B]
        └── StepInstance [documentoId=B] ──► Tarefa [documentoId=B]
```

## As três regras de propriedade

1. **`StepInstance` pertence a Documento.** Um passo documental existe *para* um
   documento; sem ele não é um passo, é um órfão.
2. **`Task` pertence ao Step.** A tarefa é projeção do passo, não entidade
   independente. Tarefa documental sem passo não tem origem rastreável.
3. **`Task` documental referencia Documento** — o **mesmo** do passo. Ela herda;
   nunca escolhe.

## O isolamento é do passo, não da instância

**Decisão congelada (D1):** a instância continua sendo por processo + fase + ciclo.
**Não existe `WorkflowInstance` por documento.**

Mudar a chave de instanciação reescreveria ciclos, `previousInstanceId`,
supersessão, `chaveIdempotencia`, movimentação manual para trás com preservação de
obrigações e Operação Antecipada. O ganho seria zero: o isolamento que o operador
percebe já acontece em `StepInstance` e `Tarefa`.

O resultado operacional é idêntico ao de uma instância por documento — cada
documento com seus cinco passos, progresso, anexos e histórico próprios. O que
difere é apenas onde o agrupamento técnico mora.

## O fluxo operacional — congelado

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

## O runtime apenas executa

Ele não decide o que deve existir (Matriz), não decide como processar (Perfil), não
cria política. Recebe o plano e o executa — e recusa executar o que viola contrato.
