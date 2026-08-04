# 05 — Materialização

> Baseline congelada em 04/08/2026.

## A cadeia canônica

```
MatrizDocumental
    │ seleciona documentTypeId (por ID, nunca por nome)
    ▼
TipoDocumentoCadastro
    │ perfilOperacionalId
    ▼
PerfilOperacionalDocumento ──► PhaseInternalWorkflow publicado
    │ escopoInstanciacao = DOCUMENTO
    ▼
NecessidadeDocumental ──► Documento (pessoa + processo + tipo)
    │
    ▼
PhaseWorkflowInstance do ciclo atual  (não nasce uma por documento)
    │
    ├─► StepInstance [documentoId] ──► Tarefa [documentoId]
    └─► ...
```

## Quem faz o quê

| camada | responsabilidade | proibido |
|---|---|---|
| **Matriz Documental** | define **o quê** deve nascer | cadastrar passos, escolher tarefas |
| **Cadastro Mestre** | define **o que** o documento é | conter passos |
| **Perfil Operacional** | define **como** é processado | editar o workflow |
| **Materializador** | **cria** documentos e execução | inventar documento sem regra |
| **Runtime** | **executa** | decidir o que deve existir |

## Idempotência

Executar a materialização duas vezes produz:

- um Documento Operacional por necessidade;
- uma execução compatível no ciclo vigente;
- um conjunto de StepInstances;
- uma Task por passo configurado para gerar tarefa;
- **zero duplicação**.

E nunca: reset de status, recriação de item concluído, perda de autoria, datas,
anexos, protocolos, solicitações ou ciclos.

A garantia é de **chave**, não de verificação: `chaveIdempotencia` no passo, na
solicitação, na observação e na instância.

## Reparo de dado existente

**Determinístico repara; ambíguo não.**

| estado | ação |
|---|---|
| tem `documentoId` | nada a fazer |
| documento **deduzível** por relação existente | reparo automático, sem escolha |
| nada de onde deduzir | **reportado, intocado** |

Vincular sem de onde deduzir é inventar (D9). O script `auditar:vinculo-documental`
classifica e **não tem uma única chamada de escrita** — verificado por teste.
