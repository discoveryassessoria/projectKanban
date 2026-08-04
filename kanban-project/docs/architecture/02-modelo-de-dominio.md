# 02 — Modelo de domínio

> Baseline congelada em 04/08/2026. Ver [01-baseline-arquitetural](01-baseline-arquitetural.md).

## A entidade central

**`Documento` (Documento Operacional) é a entidade central do domínio.**

Ele representa a necessidade documental concreta de **uma pessoa, num processo**.
Tudo que a operação faz com um documento pendura nele — e é por isso que ele é o
centro, não o workflow, não a fase, não a tarefa.

```
                          Documento
                              │
     ┌──────────┬─────────────┼─────────────┬──────────────┐
     ▼          ▼             ▼             ▼              ▼
  anexos    protocolo    solicitações   histórico    workflow (passos)
DocumentoArquivo  Protocolo  Solicitacao   Documento    StepInstance
                          Documento       Observacao
```

### O que o Documento controla

| aspecto | entidade | regra |
|---|---|---|
| **anexos** | `DocumentoArquivo` | uma linha por arquivo, com todos os vínculos |
| **protocolo** | `Protocolo` + `ProtocoloDocumento` | o cadastro que já existia; nunca um segundo |
| **solicitações** | `SolicitacaoDocumento` | o ato de pedir ao órgão; reenvio é outra solicitação |
| **histórico** | `DocumentoObservacao` + `LogAuditoria` | append-only, com autor e carimbo |
| **execução** | `PhaseWorkflowStepInstance` | os passos daquele documento |

## Cadastro × Operação

O sistema tem duas camadas, e confundi-las é a origem da maioria dos defeitos que
esta baseline fecha.

### Cadastro — o que o sistema sabe antes de qualquer processo

| entidade | responde |
|---|---|
| `TipoDocumentoCadastro` | o que este documento é |
| `FamiliaDocumental` | a que grupo operacional pertence |
| `NaturezaOperacionalDocumento` | como ele entra na operação (`exigeWorkflow`) |
| `PerfilOperacionalDocumento` | qual workflow o processa e com que escopo |
| `PhaseInternalWorkflow` | o modelo de execução, e sobre o que executa |
| `PhaseInternalWorkflowStep` | os passos publicados e sua cardinalidade |
| `MatrizDocumental` | quem precisa de qual tipo documental |

### Operação — o que nasce por processo

| entidade | responde |
|---|---|
| `NecessidadeDocumental` | esta pessoa precisa deste tipo, neste processo |
| `Documento` | o documento concreto dessa necessidade |
| `PhaseWorkflowInstance` | a execução da fase, num ciclo |
| `PhaseWorkflowStepInstance` | o passo executável daquele documento |
| `Tarefa` | a projeção do passo para quem executa |

## A separação de responsabilidades

```
Matriz Documental  →  define O QUE deve nascer
Cadastro Mestre    →  define O QUE o documento é
Perfil Operacional →  define COMO ele é processado
Materializador     →  CRIA os documentos e a execução
Runtime            →  apenas EXECUTA
```

Nenhuma dessas camadas invade a outra. A Matriz não cadastra passos. O Perfil não
edita workflow. O Runtime não decide o que deve existir.
