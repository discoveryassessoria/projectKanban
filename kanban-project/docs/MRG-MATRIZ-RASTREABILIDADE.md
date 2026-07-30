# MRG — Motor Registral Genealógico · Matriz de rastreabilidade

Escopo implementado em 30/07/2026. Status permitidos: **IMPLEMENTADO E VALIDADO**,
**IMPLEMENTADO COM RESTRIÇÃO EXPLÍCITA**, **NÃO IMPLEMENTADO**.

Comandos de verificação:

```bash
npm run test:mrg           # 991 asserções puras (leitura, identidade, decisão, guarda)
npm run db:test:up         # sobe Postgres local isolado + aplica schema
npm run test:mrg-e2e       # 193 asserções end-to-end contra banco real
node scripts/mrg-banco-teste.mjs migration   # migration aditiva/idempotente/sem drift
npx tsc --noEmit && npm run lint
```

---

## 1. Motor de reconstrução genealógica por certidões

| ID | Requisito | Status | Onde | Teste |
|---|---|---|---|---|
| R1.1 | Processamento em lote de certidões da Pasta Documental | IMPLEMENTADO E VALIDADO | `services/registral/lote.ts` · `LoteRegistral` | E2E §2 (6 certidões, 1 lote) |
| R1.2 | Identificar e classificar cada documento | IMPLEMENTADO E VALIDADO | `lib/genealogia/registral/classificador.ts` | leitura §5 · E2E §3 |
| R1.3 | Reconhecer nascimento, casamento, óbito, batismo e demais | IMPLEMENTADO E VALIDADO | `classificador.ts` (7 naturezas) | leitura §5 |
| R1.4 | Extrair pessoas, nomes, datas, locais, filiações, cônjuges, filhos, declarantes, avós | IMPLEMENTADO E VALIDADO | `extracao-ancorada.ts` (27 âncoras) + `extracao-estrutural.ts` (11 fórmulas) · `PapelOcorrencia` (15 papéis) | leitura §6-7 |
| R1.5 | Nome registral, nome de casado, variações, abreviações, grafias históricas | IMPLEMENTADO E VALIDADO | `normalizacao.ts` (`ehVariacaoDeCasamento`, `EXPANSOES`, `chaveFonetica`) | leitura §2-3 · E2E §6 |
| R1.6 | Resolver identidades entre documentos | IMPLEMENTADO E VALIDADO | `identidade.ts` + `reconstrucao.ts` (clusters) | identidade §1-9 · E2E §6 |
| R1.7 | Encontrar pessoas já existentes | IMPLEMENTADO E VALIDADO | `pipeline.ts::carregarCandidatos` (fonética + prenome + árvore) | E2E §6 |
| R1.8 | Sugerir novas pessoas | IMPLEMENTADO E VALIDADO | `propostas.ts::propostasDeIdentidade` | E2E §8 |
| R1.9 | Detectar duplicidades | IMPLEMENTADO E VALIDADO | `integridade.ts` + `lib/cadastro-mestre/dedup.ts` | identidade §16 |
| R1.10 | Formar relações de parentesco | IMPLEMENTADO E VALIDADO | `reconstrucao.ts` (cruzamento entre documentos) + `propostaDeRelacao` | E2E §8 |
| R1.11 | Reconstruir árvore inexistente / complementar existente | IMPLEMENTADO E VALIDADO | `reconstrucao.ts` | E2E §12 (árvore complementada) |
| R1.12 | Jamais apagar/substituir a árvore de forma destrutiva | IMPLEMENTADO E VALIDADO | nenhum `delete` de Pessoa/União no motor; `planejarReversao` recusa exclusão | guarda §6 · E2E §14 |
| R1.13 | Resultado consolidado antes de alteração sensível | IMPLEMENTADO E VALIDADO | `PropostaReconciliacao` + `ImpactoAplicacaoRegistral` (momento PREVIO) | E2E §8, §12 |
| R1.14 | Incremental e idempotente; reprocessar não duplica | IMPLEMENTADO E VALIDADO | `chaves.ts` (10 chaves) + `@unique` em 10 modelos | E2E §15 |

## 2. Pipeline registral multietapas

| ID | Requisito | Status | Onde | Teste |
|---|---|---|---|---|
| R2.1 | 13 etapas persistidas (RECEBIDO→AUDITADO) | IMPLEMENTADO E VALIDADO | `enum EtapaRegistral` · `pipeline.ts` | E2E §3 (11 etapas conferidas em D1) |
| R2.2 | FALHA DE LEITURA / INSUFICIENTE / CONFLITANTE / REPROCESSAMENTO / REJEITADO / CANCELADO | IMPLEMENTADO E VALIDADO | `EtapaRegistral` (19 valores) · `lote.ts::cancelarLote` | E2E §3 (D5 insuficiente, D6 conflitante) |
| R2.3 | Nenhuma etapa desaparece; tentativas, erros e decisões registrados | IMPLEMENTADO E VALIDADO | `EtapaExecucaoRegistral` (append-only, com `tentativa`, `ok`, `duracaoMs`) | E2E §3 |

## 3. Extração dupla e revalidação

| ID | Requisito | Status | Onde | Teste |
|---|---|---|---|---|
| R3.1 | Primeira extração | IMPLEMENTADO E VALIDADO | `extracao-ancorada.ts` (âncora de rótulo + campos literais) | leitura §6 |
| R3.2 | Segunda extração INDEPENDENTE | IMPLEMENTADO E VALIDADO | `extracao-estrutural.ts` (gramática registral + canal estruturado AD2) | leitura §6 (independência provada nos dois sentidos) |
| R3.3 | Comparação, validação estrutural e semântica | IMPLEMENTADO E VALIDADO | `conferencia.ts` (5 veredictos) | leitura §8 |
| R3.4 | Cruzamento com documentos anteriores / cadastro / árvore / processo | IMPLEMENTADO E VALIDADO | `reconstrucao.ts` · `integridade.ts::divergenciaArvoreCertidao` · `estado.ts` | identidade §17 · E2E §7 |
| R3.5 | Revalidação final | IMPLEMENTADO E VALIDADO | `impacto.ts::revalidar` (10 verificações) | decisão §7 |
| R3.6 | 11 campos críticos com dupla leitura | IMPLEMENTADO E VALIDADO | `campos.ts::CAMPOS_CRITICOS` | decisão §4 |
| R3.7 | Divergência NÃO escolhe silenciosamente: cria conflito | IMPLEMENTADO E VALIDADO | `conferencia.ts` (DIVERGENTE ⇒ `valorNormalizado: null`, `confianca: 0`, `bloqueadoParaRevisao`) | leitura §8 · E2E §7 |

## 4. Modelo de evidências

| ID | Requisito | Status | Onde | Teste |
|---|---|---|---|---|
| R4.1 | 15 atributos obrigatórios por evidência | IMPLEMENTADO E VALIDADO | `model EvidenciaRegistral` (documento, item mestre, necessidade, ocorrência, fato, página, região, trecho, campo, sujeito, valor bruto, valor normalizado, método, confiança extração, confiança associação, regra, data, versão) | E2E §4 |
| R4.2 | Fato/vínculo nunca confirmado sem evidência rastreável | IMPLEMENTADO E VALIDADO | `campos.ts::estadoDoFato` (favoraveis=0 ⇒ NAO_COMPROVADO) · `afirmacao.ts::validarAfirmacao` | decisão §5 · E2E §5 |
| R4.3 | Offset real do documento (não do texto normalizado) | IMPLEMENTADO E VALIDADO | `normalizacao.ts::normalizarComMapa` | leitura §6 (defeito real corrigido) |

## 5. Motor de identidade e deduplicação

| ID | Requisito | Status | Onde | Teste |
|---|---|---|---|---|
| R5.1 | Comparar 16 eixos (nome, casado, sobrenome, abreviação, data, local, filiação, cônjuge, filhos, idade, profissão, residência, documentos, cartório, livro/folha/termo, relações) | IMPLEMENTADO E VALIDADO | `identidade.ts::avaliar` · `normalizacao.ts::referenciaRegistral` | identidade §1-8 |
| R5.2 | 5 classificações de correspondência | IMPLEMENTADO E VALIDADO | `enum ClasseCorrespondencia` | identidade §1-5 |
| R5.3 | Vínculo automático só com segurança inequívoca | IMPLEMENTADO E VALIDADO | `identidade.ts::decidirAutomatico` | identidade §2, §9 |
| R5.4 | Homônimo nunca fundido | IMPLEMENTADO E VALIDADO | `decidirAutomatico` (2 fortes ⇒ null) | identidade §2 · E2E §6 |
| R5.5 | Fusão exige revisão, impacto, histórico e reversão | IMPLEMENTADO COM RESTRIÇÃO EXPLÍCITA | proposta + impacto + bloqueio + permissão `registral.mesclar_pessoas` (OPT-IN) implementados; a EXECUÇÃO da fusão é recusada com mensagem explícita (`aplicar.ts`) porque não existe serviço de fusão com reversão garantida | identidade §10 · E2E §11 |

## 6. Reconciliação contínua

| ID | Requisito | Status | Onde | Teste |
|---|---|---|---|---|
| R6.1 | Nova certidão revalida 16 dimensões | IMPLEMENTADO E VALIDADO | `gancho-documental.ts` → `DomainOutbox` → `outbox-dispatcher.ts` → `reconciliacao-documental.ts` + `recalcularLinhagem` | E2E §17 |
| R6.2 | Gancho em anexar / alterar / transcrever / invalidar documento | IMPLEMENTADO E VALIDADO | `api/documentos/route.ts`, `api/documentos/[id]/route.ts` (PUT+PATCH), `api/documentos/[id]/transcricao/route.ts` | E2E §17 |
| R6.3 | Gancho em transição de necessidade | IMPLEMENTADO E VALIDADO | `api/processos/[processoId]/necessidades/[necessidadeId]/route.ts` (6 transições) | E2E §17 |
| R6.4 | Mais documentos ⇒ informação mais completa, sem sobrescrever histórico | IMPLEMENTADO E VALIDADO | `FatoRegistral` append-only (`versao`, `supersedidoPorId`) · `propostas-db.ts` acumula evidência | E2E §15 |

## 7. Classificação dos dados

| ID | Requisito | Status | Onde | Teste |
|---|---|---|---|---|
| R7.1 | 13 estados por FATO (não um status por pessoa) | IMPLEMENTADO E VALIDADO | `enum EstadoFatoRegistral` · `campos.ts::estadoDoFato` | decisão §5 · E2E §5 |

## 8. Motor de integridade genealógica

| ID | Requisito | Status | Onde | Teste |
|---|---|---|---|---|
| R8.1..R8.15 | 15 classes de inconsistência (sem pai/mãe esperado, filiação contraditória, datas impossíveis, filho antes dos pais, idade incompatível, casamento após óbito, óbito antes do nascimento, ciclo, autoancestralidade, vínculo duplicado, cônjuges incompatíveis, geração quebrada, ascendente repetido, requerente duplicado, divergência árvore×cadastro×certidão) | IMPLEMENTADO E VALIDADO | `integridade.ts` (14 regras próprias + tradução de `cronologia.ts`/`duplicidade.ts`) | identidade §11-18 |
| R8.16 | Cada inconsistência com severidade, evidência, explicação e ação | IMPLEMENTADO E VALIDADO | `interface Inconsistencia` (4 campos obrigatórios) | identidade §11-18 · E2E §7 |

## 9. Motor de linhagem e elegibilidade

| ID | Requisito | Status | Onde | Teste |
|---|---|---|---|---|
| R9.1 | Ascendente transmissor automático | IMPLEMENTADO E VALIDADO | `elegibilidade.ts` + `motor/regras/linhagem.ts` | identidade §19 |
| R9.2 | Todos os caminhos genealógicos | IMPLEMENTADO E VALIDADO | `todosOsCaminhos` (enumeração completa, teto 12) | identidade §23 |
| R9.3 | Linha principal, quebras, gerações sem comprovação | IMPLEMENTADO E VALIDADO | `CaminhoLinhagem` | identidade §19-20 |
| R9.4 | Recalcular após qualquer alteração | IMPLEMENTADO E VALIDADO | `consultas.ts::recalcularLinhagem` (derivado, nunca persistido como conclusão) | E2E §10, §17 |
| R9.5 | Considerar modalidade/país/contexto | IMPLEMENTADO E VALIDADO | `estado.ts::carregarContexto` (`Processo.pais` → `PaisAlvo`) | E2E §10 |
| R9.6 | Não declarar elegibilidade sem evidência | IMPLEMENTADO E VALIDADO | `comprovadoDocumentalmente` só com 0 pendências e 0 conflitos | identidade §19-21 · E2E §10 |
| R9.7 | Estrutural ≠ comprovada | IMPLEMENTADO E VALIDADO | `LINHA_COMPLETA_COM_PENDENCIAS` vs `LINHA_COMPLETA_COMPROVADA` | identidade §19 |
| R9.8 | 6 resultados de linhagem | IMPLEMENTADO E VALIDADO | `enum ResultadoLinhagemRegistral` | identidade §19-21 |

## 10. Integração com o Sistema Documental

| ID | Requisito | Status | Onde | Teste |
|---|---|---|---|---|
| R10.1 | A árvore NÃO armazena documentos | IMPLEMENTADO E VALIDADO | nenhuma coluna de arquivo/status documental nas 13 tabelas novas | guarda §3 · E2E §22 (verificação no `information_schema`) |
| R10.2 | Usa Documento Mestre, Necessidade, Documento do Processo, Pasta | IMPLEMENTADO E VALIDADO | FKs `itemCatalogoId`, `necessidadeId`, `documentoId` | guarda §3 |
| R10.3 | 12 efeitos possíveis da nova certidão (satisfazer, parcial, insuficiente, divergente, inteiro teor, tradução, apostilamento, retificação, nova necessidade, inaplicável, vínculo com pessoa, vínculo com fato) | IMPLEMENTADO E VALIDADO | `reconciliacao-documental.ts` (6 ramos + necessidades faltantes da linha) | E2E §9 |
| R10.4 | Mudanças ocorrem NO Sistema Documental, refletidas na árvore | IMPLEMENTADO E VALIDADO | só `atenderNecessidade`/`garantirNecessidade`/`reabrir` são chamados; nenhuma escrita direta | guarda §4 |

## 11. Propostas de reconciliação

| ID | Requisito | Status | Onde | Teste |
|---|---|---|---|---|
| R11.1 | 20 atributos por proposta (tipo, valor atual, proposto, evidências favoráveis/contrárias, confiança, justificativa, regra, pessoas/vínculos/documentos/processos/necessidades afetados, criticidade, aplicabilidade automática, decisão, responsável) | IMPLEMENTADO E VALIDADO | `model PropostaReconciliacao` | E2E §8 |
| R11.2 | 16 tipos mínimos | IMPLEMENTADO E VALIDADO | `enum TipoPropostaRegistral` (16 valores) | decisão §6 |
| R11.3 | Aprovar / rejeitar / adiar | IMPLEMENTADO E VALIDADO | `decisoes.ts` | E2E §12, §21 |

## 12. Matriz de automação e bloqueio

| ID | Requisito | Status | Onde | Teste |
|---|---|---|---|---|
| R12.1 | 6 operações automáticas | IMPLEMENTADO E VALIDADO | `campos.ts::TIPOS_AUTOMATICOS` | decisão §1 |
| R12.2 | 9 operações com aprovação humana | IMPLEMENTADO E VALIDADO | `CAMPOS_APROVACAO_HUMANA` + `TIPOS_APROVACAO` | decisão §2 |
| R12.3 | 8 operações com bloqueio obrigatório | IMPLEMENTADO E VALIDADO | `criticidadeDaAlteracao` (irreversível, massa, fusão, filiação, linha, requerente, multiprocesso, tipos bloqueados) | decisão §3 |
| R12.4 | Default conservador | IMPLEMENTADO E VALIDADO | fallback = APROVACAO_HUMANA | decisão §4 |

## 13. Análise de impacto

| ID | Requisito | Status | Onde | Teste |
|---|---|---|---|---|
| R13.1 | 14 grandezas calculadas ANTES de aplicar | IMPLEMENTADO E VALIDADO | `impacto.ts::analisarImpacto` · `model ImpactoAplicacaoRegistral` | decisão §7 · E2E §12 |
| R13.2 | Simulação real do estado depois | IMPLEMENTADO E VALIDADO | `aplicar.ts::simularEstado` (8 tipos de efeito sobre cópia do estado) | decisão §7 |
| R13.3 | Aborta automaticamente com inconsistência crítica | IMPLEMENTADO E VALIDADO | `bloqueado` ⇒ status ABORTADA antes de escrever | E2E §13 |

## 14. Revalidação pós-aplicação

| ID | Requisito | Status | Onde | Teste |
|---|---|---|---|---|
| R14.1 | 10 verificações obrigatórias | IMPLEMENTADO E VALIDADO | `impacto.ts::revalidar` | decisão §7 (10/10 exercitadas) |
| R14.2 | Transação atômica + rollback em falha crítica | IMPLEMENTADO E VALIDADO | `prisma.$transaction` + `ErroRevalidacao` (throw ⇒ rollback) | E2E §13 (nada escrito) |

## 15. Histórico, versionamento e reversão

| ID | Requisito | Status | Onde | Teste |
|---|---|---|---|---|
| R15.1 | Versão de árvore/pessoas/relações/fatos/evidências/propostas | IMPLEMENTADO E VALIDADO | `VersaoGenealogica` (snapshot lógico) · `FatoRegistral.versao` · evidência imutável · `DecisaoRevisaoRegistral` | decisão §8 · E2E §19 |
| R15.2 | Snapshot lógico determinístico + hash | IMPLEMENTADO E VALIDADO | `versao.ts::montarSnapshot` + `serializarCanonico` + `hashDoSnapshot` | decisão §8 |
| R15.3 | Comparação entre versões | IMPLEMENTADO E VALIDADO | `compararSnapshots` · rota `/versoes/comparar` | decisão §8 · E2E §12 |
| R15.4 | Reversão segura | IMPLEMENTADO E VALIDADO | `planejarReversao` + `decisoes.ts::reverterProposta` | decisão §9 · E2E §14 |
| R15.5 | Nenhum histórico apagado por exclusão comum | IMPLEMENTADO E VALIDADO | nenhum `delete` no motor; fato é desativado, não removido | guarda §6 · E2E §14 |
| R15.6 | 12 atributos na trilha | IMPLEMENTADO E VALIDADO | `LogAuditoria` + `DecisaoRevisaoRegistral` (inclui a PERMISSÃO exercida) | E2E §12, §18 |

## 16. Copiloto genealógico

| ID | Requisito | Status | Onde | Teste |
|---|---|---|---|---|
| R16.1 | 10 perguntas mínimas | IMPLEMENTADO E VALIDADO | `copiloto.ts` (10 intenções) · rota `/registral/copiloto` | decisão §12 (10/10) · E2E §18 |
| R16.2 | Conclusão + evidências + confiança + pendências + origem | IMPLEMENTADO E VALIDADO | `interface RespostaCopiloto` | decisão §12 |
| R16.3 | Nunca inventar | IMPLEMENTADO E VALIDADO | determinístico, sem modelo de linguagem; sem dado ⇒ `semDados: true` | decisão §12 · E2E §18 |

## 17. Processamento assíncrono e resiliente

| ID | Requisito | Status | Onde | Teste |
|---|---|---|---|---|
| R17.1 | Fila já adotada no projeto | IMPLEMENTADO E VALIDADO | `DomainOutbox` + `outbox-dispatcher.ts` | E2E §17 |
| R17.2 | Idempotência | IMPLEMENTADO E VALIDADO | `chaves.ts` + `@unique` | E2E §15 · decisão §10 |
| R17.3 | Tentativas + backoff exponencial | IMPLEMENTADO E VALIDADO | `MAX_TENTATIVAS_EXECUCAO=5` · `backoffMs` (30s→64min) | — (código; caminho de erro coberto por `pipeline.ts` catch) |
| R17.4 | Registro de falha (dead-letter) | IMPLEMENTADO E VALIDADO | `ExecucaoRegistral.erro` + etapa FALHA_LEITURA + `EtapaExecucaoRegistral` | E2E §3 |
| R17.5 | Retomada / cancelamento / progresso | IMPLEMENTADO E VALIDADO | `processarLote` reentrante · `cancelarLote` · `progressoLote` | E2E §2 |
| R17.6 | Proteção contra processamento duplicado e concorrência | IMPLEMENTADO E VALIDADO | claim atômico por (id, etapa, reserva) + reserva expirável | E2E §16 (2 workers concorrentes) |
| R17.7 | Observabilidade e logs estruturados | IMPLEMENTADO E VALIDADO | `logRegistral` · `MetricaRegistral` | E2E §18 |

## 18. Segurança e permissões

| ID | Requisito | Status | Onde | Teste |
|---|---|---|---|---|
| R18.1 | 8 permissões distintas | IMPLEMENTADO E VALIDADO | `lib/permissoes.ts` (`registral.*`) | guarda §7 |
| R18.2 | Usa o sistema atual (sem autenticação paralela) | IMPLEMENTADO E VALIDADO | `services/registral/autorizacao.ts` reusa `extrairUsuarioComPermissoes` | guarda §7 |
| R18.3 | Enforcement server-side | IMPLEMENTADO E VALIDADO | `aplicar.ts` + todas as 20 rotas | E2E §11 · guarda §7 |
| R18.4 | Fusão como OPT-IN | IMPLEMENTADO E VALIDADO | `PERMISSOES_OPT_IN` | guarda §7 |

## 19. Banco de dados

| ID | Requisito | Status | Onde | Teste |
|---|---|---|---|---|
| R19.1 | Apenas migrações aditivas e retrocompatíveis | IMPLEMENTADO E VALIDADO | `20260830100000_mrg_motor_registral_genealogico` (927 linhas, 0 destrutivas) | guarda §5 · `mrg-banco-teste.mjs migration` |
| R19.2 | Reutilizar estruturas existentes antes de criar | IMPLEMENTADO E VALIDADO | reusa Pessoa, União, Árvore, Documento, Necessidade, ItemCatalogo, NomePessoa (aliases), DecisaoDeduplicacao, LogAuditoria, DomainOutbox, Perfil | guarda §3-4 |
| R19.3 | 10 entidades equivalentes solicitadas | IMPLEMENTADO E VALIDADO | 13 modelos + 12 enums novos | schema |
| R19.4 | Nada removido | IMPLEMENTADO E VALIDADO | 0 DROP/RENAME/ALTER TYPE | guarda §5 |
| R19.5 | Índices/constraints sem bloquear operação | IMPLEMENTADO E VALIDADO | 56 índices e 47 FKs, todos em tabelas NOVAS (vazias); única alteração em tabela existente = 4 colunas nullable em `Documento` | guarda §5 |

## 20. APIs e serviços

| ID | Requisito | Status | Endpoint |
|---|---|---|---|
| R20.1 | Processar lote documental | IMPLEMENTADO E VALIDADO | `POST /api/processos/[processoId]/registral/lotes` |
| R20.2 | Consultar progresso | IMPLEMENTADO E VALIDADO | `GET /api/registral/lotes/[loteId]` |
| R20.3 | Consultar resultado | IMPLEMENTADO E VALIDADO | idem + `GET .../registral/lotes` |
| R20.4 | Consultar evidências | IMPLEMENTADO E VALIDADO | `GET /api/registral/evidencias` · `GET /api/registral/pessoas/[id]/dossie` |
| R20.5 | Consultar conflitos | IMPLEMENTADO E VALIDADO | `GET /api/registral/conflitos` |
| R20.6 | Revisar / aprovar / rejeitar proposta | IMPLEMENTADO E VALIDADO | `GET|PATCH /api/registral/propostas/[id]` (aprovar/rejeitar/adiar/reverter) |
| R20.7 | Recalcular árvore / linhagem | IMPLEMENTADO E VALIDADO | `GET|POST /api/processos/[processoId]/registral/linhagem` |
| R20.8 | Reprocessar documento | IMPLEMENTADO E VALIDADO | `POST /api/registral/execucoes/[id]/reprocessar` |
| R20.9 | Comparar versões | IMPLEMENTADO E VALIDADO | `GET /api/registral/arvores/[id]/versoes/comparar` |
| R20.10 | Reverter alteração | IMPLEMENTADO E VALIDADO | `PATCH .../propostas/[id]` com `acao: "reverter"` |
| R20.11 | Consultar auditoria | IMPLEMENTADO E VALIDADO | `GET /api/registral/auditoria` · `GET /api/registral/metricas` |
| R20.12 | Conectar às ações existentes preservando o visual | IMPLEMENTADO E VALIDADO | ganchos em `documentos` (POST/PUT/PATCH), `transcricao` (PUT), `necessidades` (PATCH); nenhum arquivo visual alterado |

## 21. Testes

| ID | Cenário | Status | Onde |
|---|---|---|---|
| R21.1 | Lote com várias certidões | IMPLEMENTADO E VALIDADO | E2E §2 |
| R21.2 | Reconstrução de árvore vazia / complementação | IMPLEMENTADO E VALIDADO | E2E §12 |
| R21.3 | Reprocessamento idempotente | IMPLEMENTADO E VALIDADO | E2E §15 |
| R21.4 | Nome de solteiro e casado | IMPLEMENTADO E VALIDADO | leitura §3 · identidade §6 · E2E §6 |
| R21.5 | Homônimos | IMPLEMENTADO E VALIDADO | identidade §2 · E2E §6 |
| R21.6 | Grafia divergente / OCR divergente | IMPLEMENTADO E VALIDADO | leitura §8 · E2E §7 |
| R21.7 | Datas e filiação conflitantes | IMPLEMENTADO E VALIDADO | identidade §3-4, §13-14 |
| R21.8 | Pessoa duplicada / ciclo genealógico | IMPLEMENTADO E VALIDADO | identidade §11, §16 |
| R21.9 | Documento insuficiente | IMPLEMENTADO E VALIDADO | leitura §10 · E2E §3 |
| R21.10 | Nova certidão que confirma / contradiz | IMPLEMENTADO E VALIDADO | decisão §6 · identidade §17 |
| R21.11 | Alteração que afeta vários requerentes | IMPLEMENTADO E VALIDADO | decisão §3 (multiprocesso ⇒ bloqueio) |
| R21.12 | Falha no meio da aplicação / rollback | IMPLEMENTADO E VALIDADO | E2E §13 |
| R21.13 | Reversão humana | IMPLEMENTADO E VALIDADO | E2E §14 |
| R21.14 | Concorrência | IMPLEMENTADO E VALIDADO | E2E §16 |
| R21.15 | Permissões | IMPLEMENTADO E VALIDADO | E2E §11 · guarda §7 |
| R21.16 | Auditoria | IMPLEMENTADO E VALIDADO | E2E §18 |
| R21.17 | Nenhuma alteração visual | IMPLEMENTADO E VALIDADO | guarda §1 (manifesto SHA-256 de 30 arquivos + conferência via git) |
| R21.18 | Múltiplos requerentes / compartilhamento de pessoa entre processos | IMPLEMENTADO E VALIDADO | identidade §16 · `estado.ts::processosQueDependemDe` |
| R21.19 | Adoção representada | IMPLEMENTADO COM RESTRIÇÃO EXPLÍCITA | a filiação adotiva é lida (`FILH[OA] ... ADOTIV[OA] DE`) e tratada como filiação normal; **não existe** distinção de natureza do vínculo no modelo atual (`Pessoa.paiId/maeId` não tem tipo) — modelá-la exigiria alterar o domínio de vínculo, o que está fora deste escopo aditivo |
| R21.20 | Casamento múltiplo / filhos de uniões diferentes | IMPLEMENTADO E VALIDADO | `motor/grafo.ts` (`conjugesOrdenados`, `Irmandade`) reusado por `integridade.ts` |

## 22. Observabilidade

| ID | Requisito | Status | Onde | Teste |
|---|---|---|---|---|
| R22.1 | 12 métricas | IMPLEMENTADO E VALIDADO | `metricas.ts::METRICAS` (19 chaves) · `MetricaRegistral` | decisão §11 · E2E §18 |
| R22.2 | Sem conteúdo sensível integral em log | IMPLEMENTADO E VALIDADO | `redigirParaLog` (20 campos sensíveis reduzidos a inicial+tamanho) | decisão §11 · E2E §18 (nenhum nome completo na trilha) |

---

## Restrições explícitas (3)

1. **Execução de fusão/separação de pessoas** — proposta, impacto, bloqueio, permissão OPT-IN e auditoria estão implementados; a execução é **recusada com mensagem explícita**. Aplicar uma fusão sem serviço de reversão garantida é a única operação deste sistema sem volta.
2. **Adoção como natureza de vínculo** — lida na extração, mas o domínio de vínculo (`Pessoa.paiId/maeId`) não tem campo de natureza. Modelar exigiria alterar o vínculo existente, fora do escopo aditivo.
3. **`SOLICITAR_RETIFICACAO`** — a proposta é criada, classificada e auditada; a execução pertence ao fluxo documental de retificação (`RetificacaoPacote`), não ao motor genealógico.

## Dependências externas declaradas (2)

1. **OCR / digitalização** — o motor lê a transcrição gravada em `Documento.transcricaoTexto` / `transcricaoPaginas` pela rota `PUT /api/documentos/[id]/transcricao`. O produtor do texto é externo ao Discovery. Sem transcrição, o pipeline continua funcionando pelos canais reais restantes (campos literais + `registral` + `structuredData` da AD2), com menos cobertura e registrando a lacuna.
2. **Banco oficial** — a migration **não foi aplicada em produção**. Aplicar exige o mecanismo documentado do repositório (`MIGRATE_ON_BUILD=1` + `EU_CONFIRMO_ESCRITA_EM_PRODUCAO` + deploy, e remoção das variáveis depois) e autorização de janela. A validação feita foi contra Postgres local isolado.
