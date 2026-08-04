# 06 — Fonte da verdade

> Baseline congelada em 04/08/2026.

## Uma fonte para documentos

**`Documento` (Documento Operacional) é a única representação de documento no
domínio operacional.**

Proibido criar tabela paralela que represente documento — `DocumentoProcesso`,
`DocumentoPessoa`, `DocumentoOperacional`, `OperationalDocument` ou variação. Duas
tabelas para o mesmo conceito são duas chances de divergir sobre o mesmo documento.

## Uma fonte para anexos

**`DocumentoArquivo` é a única representação de arquivo.** Uma linha por arquivo,
com **todos** os vínculos na mesma linha:

```
DocumentoArquivo
├── documentoId      ← a que documento pertence
├── solicitacaoId    ← de que solicitação nasceu
├── stepInstanceId   ← em que etapa foi anexado
├── protocoloId      ← a que protocolo se liga
└── documentTypeId   ← o que ele É no Cadastro Mestre
```

**Proibido** criar `StepAttachment`, `RequestAttachment`, `ProtocolAttachment`,
`DocumentAttachment` ou qualquer junção equivalente. Quatro tabelas seriam quatro
chances de divergir sobre o mesmo `fileId` — e o defeito que originou esta
arquitetura foi exatamente um arquivo que existia sem conseguir se apresentar igual
em três telas.

O binário é **um só** no storage. As telas consultam a mesma linha, por
`stepInstanceId`, `documentoId` ou `protocoloId`. Nenhuma copia.

## Uma implementação por escrita

| escrita | implementação única |
|---|---|
| arquivo do documento | `documento-arquivos.ts` → `vincularArquivoDocumentoTx` |
| observação | `documento-arquivos.ts` → `registrarObservacaoDocumentoTx` |
| solicitação + protocolo + conclusão | `solicitacao-documento.ts` → `registrarSolicitacaoDocumento` |
| passo | `phase-workflow.ts` → `materializarAlvos` |

A suíte da baseline faz `grep` e reprova se qualquer outro arquivo gravar
`documentoArquivo.create`.

## Identificação por ID, nunca por texto

Proibido resolver vínculo estrutural por:

- nome do documento (`"Requerimento inteiro teor"`);
- código em string espalhada (`"DOC21"` no runtime);
- rótulo de campo, título de passo, extensão de arquivo, `phaseKey` como regra;
- regex sobre nome, prefixo `DOC`, categoria textual.

Quem resolve código → ID é o **seed**, uma vez. Daí em diante tudo trabalha por ID.

A suíte verifica o **código** (sem comentários): explicar o domínio em prosa é
esperado; o que se proíbe é o código *depender* do texto.

## Zero duplicação de vínculo

Nenhum vínculo pode existir duas vezes:

- `@@unique([documentoId, url])` — o mesmo arquivo não entra duas vezes;
- índice parcial `(solicitacaoId, documentTypeId) WHERE vigente` — uma versão vigente;
- `chaveIdempotencia` no passo, na solicitação e na observação.

A garantia é do **banco**, não da aplicação.
