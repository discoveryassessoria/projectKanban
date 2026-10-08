# DISCOVERY — CONTRATO INEGOCIÁVEL DO MOTOR OPERACIONAL

ESTE ARQUIVO É NORMATIVO. Vale para qualquer sessão, não só para esta conversa.

Antes de alterar qualquer código relacionado a:

- Tarefa
- Workflow
- Step
- Documento
- Necessidade Documental
- Genealogia
- Fase
- Responsabilidade
- Central Operacional
- Home
- Operação
- Minha Fila
- Tarefas e Projetos
- Notificações
- Contadores
- Agregações

LEIA ESTE CONTRATO.

Se o código atual contradizer este contrato, NÃO assuma automaticamente que o contrato está errado.
Investigue se o código é legado, projeção antiga, compatibilidade ou dívida arquitetural.

## 1. Unidade operacional

TAREFA é a unidade canônica de trabalho operacional do Discovery.

Uma obrigação real executável deve corresponder a UMA Tarefa canônica.

Não criar outra representação operacional da mesma obrigação.

Tarefa continua a unidade canônica de TRABALHO: quem faz, atribuição, responsabilidade, histórico.

Status e prazo de CERTIDÃO não são mais gravados como fonte em Tarefa.statusTarefa/dataPrazo (decisão "fonte única de status e prazo de certidão", 29/09/2026, achado #3860: escrita por evento que pode falhar silenciosamente sem nada reavaliar depois).

Status e prazo de certidão são PROJEÇÃO calculada na leitura a partir de SolicitacaoDocumento (dataEnvio + prazoEsperadoDias → previsaoRetorno) + SubtaskExecution.status, via a função pura `situacaoDaSolicitacaoCertidao` (`src/lib/process-stage/situacao-solicitacao-certidao.ts`) e o serviço `src/lib/process-stage/projecao-certidao.ts` — uma única implementação, importada por Central Operacional, Relatório de Certidões e Dashboard/PRZ-001.

Tarefa MANUAL, TRANSVERSAL, ADMINISTRATIVA e qualquer Tarefa sem NecessidadeDocumental de origem continuam usando o statusTarefa/dataPrazo gravado — não há SolicitacaoDocumento por trás para calcular.

Tarefa CANCELADA/SUPERSEDIDA/BLOQUEADA nunca é sobrescrita pela projeção calculada — são decisão humana/do motor sobre o TRABALHO, não fato de progresso da certidão.

## 2. Workflow

O Workflow é definido/configurado por fase (PhaseInternalWorkflow) e sua execução é materializada como PhaseWorkflowInstance.

As Tarefas pertencentes àquele contexto operacional podem compartilhar a mesma PhaseWorkflowInstance.

A Tarefa referencia essa instância e, quando aplicável, seu StepInstance atual.

Workflow não pertence à Tarefa.

Workflow NÃO é uma segunda Tarefa.

## 3. Step

Workflow possui N Steps, materializados na PhaseWorkflowInstance — não na Tarefa.

Step NÃO é Tarefa.

Step NÃO deve aumentar contagem de Tarefas.

Step não pertence estruturalmente à Tarefa: pertence à PhaseWorkflowInstance que a Tarefa referencia. A Tarefa aponta para seu StepInstance atual; não o contém.

## 4. Documentos

Documento NÃO é Tarefa.

Necessidade Documental NÃO é Tarefa.

Documento e Necessidade podem ORIGINAR ou CONTEXTUALIZAR uma Tarefa.

Quando já existe uma Tarefa canônica correspondente, Documento/Necessidade NÃO podem ser somados novamente como trabalho adicional.

## 5. Grain

Toda entidade, query, contador e projeção deve declarar mentalmente seu GRAIN.

Exemplos:

- Tarefa → grain TAREFA
- Documento → grain DOCUMENTO
- Step → grain STEP
- Pessoa → grain PESSOA
- União → grain UNIÃO

Nunca misturar grains em um contador sem declarar explicitamente que é uma métrica composta.

Nunca chamar métrica composta de "tarefas".

## 6. Identidade

Identidade nunca deve depender de:

- nome
- label
- descrição textual
- nome da pessoa
- nome do documento

Use IDs e relações canônicas.

## 7. Casamento

Nascimento pertence à Pessoa.

Óbito pertence à Pessoa.

Casamento pertence à União.

A mesma União NÃO pode gerar duas necessidades de casamento apenas porque os dois cônjuges existem na árvore.

Uniões diferentes DEVEM gerar necessidades distintas.

Não deduplicar casamento por nome.

Usar identidade canônica da União.

## 8. Idempotência

Materialização deve ser idempotente.

Rodar novamente o mesmo reconciliador/materializador com a mesma obrigação NÃO pode criar outra Tarefa.

Avançar fase NÃO pode recriar Tarefa existente.

Retroceder fase NÃO pode recriar Tarefa existente.

Voltar a avançar NÃO pode recriar Tarefa existente.

Reexecutar reconciliação NÃO pode duplicar Tarefa.

## 9. Fase

Movimentar a fase macro do Processo NÃO:

- conclui Tarefa automaticamente;
- apaga Tarefa;
- cancela Tarefa;
- reseta Tarefa;
- recria Tarefa;
- altera conclusão anterior.

A fase macro representa posição do Processo.

As obrigações preservam seu próprio estado.

## 10. Tarefas concluídas e pendentes

Tarefa concluída permanece concluída.

Tarefa pendente permanece pendente.

Navegação de fase não altera isso automaticamente.

## 11. Reabertura

Reabrir trabalho NÃO cria nova identidade de Tarefa.

Preservar taskId.

Criar novo ciclo de execução/histórico quando a arquitetura assim exigir.

Histórico anterior permanece preservado.

## 12. Tarefa histórica

Uma Tarefa de fase anterior pode ser executada/concluída sem alterar automaticamente a fase macro atual do Processo.

## 13. Responsabilidade

Responsabilidade operacional pertence à Tarefa.

Atribuir, transferir ou remover responsável NÃO cria nova Tarefa.

taskId permanece o mesmo.

## 14. Visibilidade

VISIBILIDADE DE PROCESSO != OWNERSHIP DE TAREFA.

Um usuário pode ter permissão para enxergar Família/Processo mesmo sem possuir tarefa atribuída naquele Processo.

Operação/Minha Fila usa scope de responsabilidade de Tarefa.

Processos usa permissões próprias do módulo.

Nunca aplicar um único filtro responsavelId indistintamente sobre todos os grains.

## 15. Projeções

Home, Central Operacional, Operação, Minha Fila, Tarefas e Projetos, Notificações operacionais

NÃO são novas fontes de verdade.

São projeções da realidade canônica.

Nenhuma delas deve inventar Tarefa a partir de Documento, Step, Notification ou estrutura legada.

## 16. Central Operacional

Grain da Central Operacional = TAREFA.

Agrupamento visual principal = FAMÍLIA.

Família é agrupamento visual, NÃO nova unidade operacional.

Se existem 10 Tarefas canônicas no scope: a família deve representar 10 Tarefas.

Não 10 + documentos. Não 10 + steps. Não 10 + notificações.

## 17. Contadores

Contadores de Tarefa devem contar Tarefa canônica única.

Preferir lógica equivalente a `COUNT(DISTINCT tarefa.id)` sob o mesmo filtro/scope da lista.

Nunca usar `array.length` de JOIN multiplicado como quantidade de Tarefas.

Lista e contador devem fechar matematicamente.

## 18. "Ação"

O termo "ação" é perigoso e deve ter significado explícito.

Nunca assumir automaticamente: ação = tarefa.

Antes de usar ou alterar uma métrica chamada "ação", determinar seu grain real.

Se "ação" significar Step, não chamar de Tarefa. Se significar Notification, não chamar de Tarefa. Se for combinação de grains, documentar explicitamente.

## 19. Notificações

Notification NÃO é Tarefa.

Uma Tarefa pode gerar zero, uma ou várias notificações.

Quantidade de notificações nunca deve ser usada como quantidade de Tarefas.

## 20. Genealogia

Genealogia possui ownership da estrutura genealógica: pessoas, relações, uniões, linhagem.

Ela não deve criar duplicidade documental simplesmente por possuir relações com documentos.

Toda Tarefa de Genealogia deve possuir obrigação operacional própria e identificável.

Nada altera NecessidadeDocumental fora do reconciliador (`reconciliarNecessidades`/`materializarGenealogia`, `src/services/genealogia/materializar-genealogia.ts`). `Pessoa.documentacao` NUNCA dispensa quem está NA linhagem (requerente/ascendente direto confirmado) — só quem está FORA dela. Toda gravação em Pessoa/União chama o reconciliador SÍNCRONO (nunca via fila/`after()`) — achado real, processo 675, 29/09/2026: reconciliação assíncrona deixava necessidade convergir e Documento/Passo/Tarefa presos no estado anterior. `NEC-001` (Saúde) prova a convergência das quatro camadas por processo.

## 21. Motor documental

Fluxo conceitual:

```
REGRA DOCUMENTAL
→ NECESSIDADE DOCUMENTAL
→ DOCUMENTO OPERACIONAL
→ TAREFA DE EXECUÇÃO
→ WORKFLOW
→ STEPS
```

Não assumir que todas as partes atuais do código já seguem isso. Se houver caminho paralelo, identificar antes de alterar.

## 22. Gerenciamento

Regras de negócio configuráveis devem nascer do cadastro canônico de Gerenciamento.

Não criar opções de negócio hardcoded quando existe ou deve existir cadastro mestre correspondente.

Fluxo esperado: `CADASTRO MESTRE → REGRA → OPERAÇÃO → PROJEÇÃO`.

## 23. Ownership

Cada verdade crítica deve possuir UM owner de escrita.

Exemplos conceituais: necessidade documental → motor documental; tarefa → motor operacional/materializador; step → task-step-sync; responsabilidade → lifecycle/assignment da Tarefa; fase → serviço canônico de fase.

Se encontrar dois owners para a mesma verdade: NÃO crie um terceiro. Classifique como dívida arquitetural.

## 24. Código legado

Código antigo não deve ser considerado automaticamente canônico apenas porque ainda funciona.

Classificar como: CANÔNICO, LEGADO ATIVO, COMPATIBILIDADE, PROJEÇÃO, HISTÓRICO, MIGRAÇÃO, MORTO, INDETERMINADO.

Nunca introduzir dependência nova em estrutura legada sem justificar.

## 25. Não criar V2 para escapar do problema

É proibido contornar conflito arquitetural criando arbitrariamente: TarefaV2, MotorV2, CentralNova, WorkflowNovo, NovaAgregacao, NovaFila.

Primeiro consolidar ownership existente.

## 26. Bug de contador

Antes de corrigir qualquer contador:

1. identificar o grain esperado;
2. contar entidades canônicas no banco;
3. identificar taskIds/documentIds reais;
4. verificar JOIN;
5. verificar DISTINCT;
6. verificar estruturas somadas;
7. verificar scope;
8. localizar a camada da divergência.

Nunca mascarar duplicidade física com DISTINCT. Nunca alterar materialização quando a duplicidade existe apenas na projeção.

## 27. Bug de duplicidade

Antes de chamar algo de duplicado, comparar identidade canônica.

Mesmo nome NÃO significa mesma entidade. Exemplo: "Certidão de casamento de Pessoa A" e "Certidão de casamento de Pessoa B" podem ser corretas se pertencem a Uniões diferentes.

Duplicidade real ocorre quando duas estruturas representam a MESMA obrigação canônica.

## 28. Santin — caso-canário

O cenário Santin deve permanecer como referência de sanidade arquitetural.

A estrutura observada possui 3 pessoas relevantes e 6 documentos documentais aparentes (Pessoa A: nascimento/casamento/óbito; Pessoa B: nascimento/casamento; Pessoa C: nascimento).

Se o motor possuir 6 Tarefas de Emissão e 4 Tarefas legítimas de Genealogia: TOTAL = 10 Tarefas canônicas.

Uma projeção NÃO pode transformar isso em 16 Tarefas apenas porque existem também 6 Documentos.

Toda divergência deve ser explicada por IDs e grain.

## 29. Prova por IDs

Nunca considerar uma contagem operacional validada apenas porque os números coincidem.

Sempre que houver investigação crítica, comparar conjuntos de IDs (ex.: `Central.taskIds`, `Home.taskIds`, `Operacao.taskIds`). Sob mesmo QuerySpec/scope, os conjuntos devem representar a mesma realidade.

## 30. Testes inegociáveis

Mudança no motor operacional deve preservar testes para: materialização idempotente; ausência de duplicidade; avanço de fase; retrocesso de fase; reconciliação repetida; tarefas concluídas; tarefas pendentes; tarefas históricas; reabertura preservando taskId; responsabilidade; admin x operacional; processo visível sem depender de ownership da Tarefa; documento != tarefa; step != tarefa; necessidade != tarefa; união e casamento; agregação por família; contadores; cardinalidade; projeções consistentes.

## 31. Regra de investigação

Para qualquer bug operacional seguir esta ordem:

```
REGRA DE NEGÓCIO → IDENTIDADE CANÔNICA → MATERIALIZAÇÃO → PERSISTÊNCIA → QUERY → AGREGAÇÃO → API → INTERFACE
```

Não começar corrigindo a interface sem rastrear a origem.

## 32. Regra de alteração

Antes de modificar código do motor, responder internamente:

- Qual entidade possui ownership?
- Qual é o grain?
- Quem escreve? Quem lê?
- Existe caminho legado? Existe segunda fonte de verdade?
- Existe risco de duplicidade?
- Existe teste protegendo?
- Qual camada realmente contém o bug?

Se não souber responder, INVESTIGAR ANTES DE ALTERAR.

## 33. Regra de finalização

"tsc passou" NÃO significa motor correto. "build passou" NÃO significa regra de negócio correta. "página abriu" NÃO significa cardinalidade correta.

Só considerar alteração do motor concluída quando: invariantes passam; cardinalidades fecham; IDs fecham; projeções fecham; scope fecha; testes de contrato passam; não foi criada nova fonte paralela de verdade.

## 34. Princípio supremo

```
UMA REALIDADE DE NEGÓCIO
= UMA IDENTIDADE CANÔNICA
= UM OWNER DE ESCRITA
= VÁRIAS PROJEÇÕES.
```

Nunca criar várias verdades para representar o mesmo trabalho.

## 35. Como construir módulos

1. Todo módulo novo ou refeito começa por um protótipo e um mandato escrito em `docs/` (ex.: `docs/<modulo>-prototipo.html` e `docs/<modulo>-mandato.md`). Sem esses documentos, não comece a codar: peça-os.

2. Antes de codar, faça o PASSO 0 (só leitura): compare o mandato com o protótipo e com o que já existe em produção, e liste o que será reaproveitado, o que falta criar e os riscos para processos reais. Aguarde OK.

3. Execute um bloco por vez: implementar + testes, commit + deploy, evidência real em produção no processo 651 (família de teste), relatório com hash/deploy/evidência, e PARE até receber "próximo".

4. Se o mandato e o protótipo divergirem, ou faltar informação, pergunte. Nunca invente escopo nem resuma o mandato por conta própria.

5. Processos reais em produção: sem scripts em massa, migrations só aditivas, e se algo quebrar, reverter primeiro e reportar depois.

6. O prazo nunca pausa por culpa de terceiro. Nome de fase/passo nunca por literal no código: use o cadastro.

## 36. Gate de deploy — todo deploy passa pela suíte crítica

**Todo deploy passa pela suíte crítica; teste novo para cada bug corrigido.**

- O `npm run build` (Vercel) roda `scripts/ci/gate-build.mjs` ANTES de qualquer efeito em produção (antes do guard de migration e do `prod-migrate-guard`, que escrevem no banco real). Ele sobe um Postgres real descartável, monta o banco com as MESMAS migrations SQL de produção (`scripts/ci/criar-banco-de-teste.mjs` — nunca `db push`, que não cria índices parciais/CHECKs) e roda cada arquivo de `scripts/ci/suite-critica.json` num banco novo. Um arquivo vermelho ou estourando o tempo derruba o build; a produção continua na versão anterior. NÃO existe variável para pular o gate.
- **Bug corrigido = teste novo.** Todo fix de bug entra com um teste que falhava antes do fix e passa depois, e esse teste é registrado em `scripts/ci/suite-critica.json` (se for do motor/operação/sino/guards). Fix sem teste não é fix.
- **Nada de skip silencioso.** Um teste que não pode rodar no gate por motivo alheio declara, NO PRÓPRIO ARQUIVO, a linha `// SUITE: isolado — <motivo escrito>`; o executor lista todo isolado, com o motivo, em cada run. Isolado sem motivo é erro.
- **Banco de teste = produção.** Sempre montado por `criar-banco-de-teste.mjs` (baseline + migrations não absorvidas + fixture mínima) e conferido por "zero diferença contra o schema.prisma". Migration nova entra em `MIGRATIONS_POS_BASELINE` (`scripts/baseline-verificar.test.ts`) no mesmo commit.
- Rodar local: `npm run test:critica` (gate completo com Postgres efêmero) · `npm run test:suite -- --todas` (diagnóstico de tudo).

## 37. Árvore genealógica = única fonte de verdade documental

**A árvore genealógica é a única fonte de verdade documental. Toda necessidade, documento gerado a partir dela, tarefa, passo e contagem DERIVAM da árvore. Qualquer mudança na árvore (casado/solteiro, falecido/vivo, pai/mãe, linha reta, requerente, pessoa incluída/removida) propaga na mesma transação para tudo o que derivou dela. Nunca fica sobra. Nunca falta.**

- **Transação única.** Toda gravação que muda a árvore (Pessoa, União, vínculo de requerente, remoção de pessoa, proposta do motor registral) passa por `aplicarMudancaNaArvore`/`propagarNaTransacao` (`src/services/genealogia/propagar-arvore.ts`): a mudança, o Nº Linhagem, o reconciliador oficial (`materializarGenealogia(processoId, tx)`), a convergência das tarefas (`reconciliarTarefas({ db: tx })`) e UMA linha de auditoria legível por fato (`NECESSIDADE_REMOVIDA_PELA_ARVORE` / `_CRIADA_` / `_REATIVADA_`) acontecem na mesma `$transaction` (maxWait 20s / timeout 60s). Falhou qualquer parte → rollback de tudo e a resposta HTTP é ERRO — nunca 200 com falha engolida, nunca `after()`/fila/`catch` mudo.
- **O que sai da árvore não é apagado.** Necessidade removida → `DISPENSADA`; Documento derivado → `NAO_EXIGIDO` (novo `StatusDocumento`; anexos, solicitações e histórico ficam; `CANCELADO` continua sendo decisão humana sobre o papel); passos abertos → `CANCELADO`; tarefa aberta → `CANCELADA` se nunca iniciada, ou marcada com `causaRemovidaEm` se já iniciada — sempre com o motivo `necessidade removida pela árvore: <o que mudou>`. Se a árvore voltar a exigir, o MESMO registro é reativado (necessidade, documento, passo, tarefa) — nunca duplicado, e a tarefa reativada volta sem responsável herdado.
- **Uma definição de "documento inativo".** `src/lib/documentos/status-inativos.ts` (`STATUS_DOCUMENTO_INATIVOS = CANCELADO | NAO_EXIGIDO`, `documentoAtivo`). Toda leitura de "documento ainda conta como requerido/pendente/pronto, vira passo ou tarefa?" usa a constante; `status: { not: 'CANCELADO' }` em Documento é proibido.
- **Nada nasce de Documento solto.** Passo e tarefa só nascem de NECESSIDADE ativa (`carregarContextoEscopo`, `reconciliarTarefas`): Documento sem necessidade (órfão) ou com necessidade dispensada nunca é causa de tarefa; tarefa aberta sobre ele é "causa perdida" (cancelada se não iniciada; marcada se iniciada). Documento automático órfão ainda não recebido sai de jogo (`tirarDocumentosOrfaosDeJogo`).
- **Fato acontecido não se desfaz sozinho.** Necessidade já `EM_ATENDIMENTO`/`ATENDIDA`/`NAO_LOCALIZADA` cuja causa sumiu NÃO é dispensada pela árvore: registra o alerta `NECESSIDADE_ATENDIDA_SEM_CAUSA` e o Saúde (`ARV-002`) a aponta para decisão humana. União com certidão já andada não se apaga (409 `UNIAO_COM_FATO`). Desmarcar `casado` não apaga a União (a União é o fato; o CHECK `sujeito_xor` proíbe apagar união referenciada por necessidade) — apagar a União passa por `removerNecessidadesDaUniao` na mesma transação.
- **Regra documental é a outra metade.** Publicar/inativar/arquivar/reabrir/editar regra (`/api/gerenciamento/regras-documentais/[id]`, `/matriz-documental/[id]`) reconcilia os processos abertos que têm a regra (`propagarMudancaDeRegra`), idempotente; a última regra inativada dispensa as necessidades órfãs (o reconciliador não retorna mais cedo).
- **O que fica fora da transação (e por quê).** `materializarExecucaoDaFase` (workflow publicado da fase), honorários e avanço automático usam o client global e não aceitam `tx`: rodam DEPOIS do commit, idempotentes, e o erro SOBE (`PropagacaoPosCommitError`, `salvo: true`). Tudo o que SAI da árvore é 100% atômico; só o trabalho NOVO na fase pode precisar de repetição.
- **Contagens.** Geral, Documentos, Torre, Foco, Central e Home leem a MESMA função (`documentacaoRequeridaDoProcesso`/`resolverCompletudeDocumental`): o requisito é a NECESSIDADE; necessidade removida e Documento `NAO_EXIGIDO` nunca contam.
- **Testes.** `scripts/arvore-fonte-da-verdade-{a-casado,b-falecido,c-pai-mae,d-requerente,e-incluir-remover,f-linha-reta,g-regra,contagens}.test.ts`, `scripts/arvore-caso-edison-junior.test.ts`, `scripts/arvore-preview-tarefas-abertas.test.ts`, `scripts/saude-arv002-arvore-e-derivados.test.ts` — todos na suíte crítica. Novo caminho que escreve Pessoa/União/vínculo sem `propagarNaTransacao` é defeito.

## 38. REGRA FIXA DE ORDEM DAS CERTIDÕES — vale para TODA lista e exportação do sistema

Decisão permanente do dono (06/10/2026). Vale para: Torre (Tarefas, Processos, Minha operação, Radar, Relatório de controle, Histórico), Operação, página do processo, aba Documentos, central da fase e exportações CSV/Excel/PDF.

**A regra, dentro de uma mesma FAMÍLIA:**
1. **Geração:** G1 primeiro, depois G2, G3… A geração é a **calculada pela árvore** (`src/lib/genealogia/geracao.ts`: o ancestral que origina o direito é G1, os filhos G2…, irmãos na MESMA geração). **O cônjuge fica na geração do parceiro.** Nunca `Pessoa.numeroLinhagem` (é um número de sequência — percurso em profundidade que ordena a pasta documental; irmãos recebem números diferentes; continua existindo, com o mesmo significado, só não é o "G" nem a chave de ordem).
2. **Dentro da geração:** linha reta antes de fora da linha; depois a **ordem de nascimento** da pessoa.
3. **Dentro da pessoa:** **Nascimento, Casamento, Óbito**, depois os outros documentos.

Essa é a ÚNICA ordem possível dentro de uma família. **Risco, prazo, status (inclusive CANCELADA/não exigida) ou criação NUNCA reordenam certidões dentro da família**; esses critérios só decidem a ordem ENTRE famílias (qual família aparece primeiro) e valem para o "Ordenar por" da Torre, que ordena FAMÍLIAS. Lista que não está agrupada por família: aplica-se família → a regra acima.

**Implementação (uma só):** `lib/operacional/ordem-certidoes.ts` (`compararCertidoesDaFamilia`, `ordenarCertidoesDaFamilia`, `ordenarListaPorFamilia`, `ordenarLinhasDeCertidao`). Nenhuma lista pode ter ordenação própria de certidão — nem `sort` por prazo/status/`numeroLinhagem`, nem "canceladas no fim", nem `orderBy` de banco para certidão (o Relatório de controle ordena em memória pela regra e pagina os ids). Toda lista nova de certidões passa por essa função e entra no teste `scripts/ordem-certidoes-todas-as-listas.test.ts` (suíte crítica).

**Também permanente:** a "linha reta" é o caminho de filiação entre o ancestral de origem e PELO MENOS UM requerente (qualquer quantidade de requerentes e de ramos) — `montarPessoasDoProcesso` não olha só o primeiro requerente. Teste: `scripts/geracao-e-linha-reta-salvarani.test.ts`.

## 39. "Localizar registro" aberto reabre a Genealogia e trava a Emissão (06/10/2026)

Nunca se solicita certidão cujos dados registrais não foram localizados. Pessoa/união que entra na linhagem depois de a Genealogia concluir (ou passo "Localizar registro" reaberto depois do avanço): o passo nasce/continua aberto, a instância da Genealogia volta a ATIVO (histórico preservado, log `GENEALOGIA_REABERTA`), o passo "Solicitar certidão" da MESMA necessidade (ainda não iniciado) vai a BLOQUEADO com motivo "Aguardando Genealogia" e a tarefa (uma por obrigação, mesmo taskId) mostra o "Localizar registro" até localizar; concluído, libera sozinho e a Genealogia fecha de novo. Vale para pessoa e para união (casamento). Implementação única: `src/services/genealogia/trava-emissao-por-genealogia.ts` (`reconciliarGenealogiaEEmissaoTx`), chamada por `aplicarPasso`/`reabrirPassoTx`, `materializarGenealogia`, `materializarExecucaoDaFase` e `reconciliarMotorDeFases`. Teste: `scripts/localizar-registro-pessoa-tardia.test.ts`.

## 40. REGRAS FIXAS DE INTEGRIDADE (06/10/2026, caso Fogli) — cada uma com trava no ponto de escrita E vigia

1. **Nenhuma certidão em Emissão com "Localizar registro" não concluído.** Trava: `aplicarPasso` recusa abrir/iniciar/concluir `solicitar_certidao` com o registro aberto (`DEPENDENCIA_PENDENTE`); `trava-emissao-por-genealogia.ts` bloqueia/libera sozinho (§39).
2. **Nenhuma fase concluída (ou 100%) com passo obrigatório aberto.** Trava: o gate (`computeGate`) + a reabertura automática da Genealogia (§39).
3. **Certidão exigida nunca sai da lista nem é cancelada sem decisão humana explícita.** Trava: `PUT /api/pessoas/[id]` devolve 409 `REMOCAO_DE_CERTIDAO_JA_ANDADA` se a edição tira da lista uma certidão que já andou, e só grava com `confirmarRemocaoDeCertidao` + motivo (≥10), registrado como `decisaoHumana`; a tela mostra o modal de confirmação. O aviso "já andou, pede decisão humana" é UM por situação (nunca repetido a cada edição).
4. **Toda pessoa na linha com certidão exigida tem tarefa, na fase correta** (Genealogia enquanto o registro não foi localizado).
5. **Toda tarefa aberta, de qualquer fase, é atribuível pela Torre:** a página do processo (`/torre/processo/[id]`) é UMA lista "Tarefas abertas do processo" com TODAS as abertas, coluna **Fase**, grupos da fase mais antiga para a mais nova e §38 dentro de cada grupo; "Próxima ação", "Distribuir as N", "Abertas", "Sem responsável" e o cabeçalho da aba Tarefas contam o MESMO conjunto.
6. **Barra de fases, Central Operacional e Torre mostram o mesmo estado** (mesma fonte: instância/passos/projeção; a divergência é achado do vigia).
7. **Tela × banco:** "Editar Pessoa" lê a lista de certidões do servidor ao abrir (nunca do cache da árvore).
8. **Sugestão nunca atribui sozinha:** toda atribuição por sugestão ("Precisa de você", "Distribuir…") devolve a prévia "Atribuir X a Y?" (HTTP 428, nada gravado) e só grava com `confirmado` + assinatura da prévia (`src/lib/torre-confirmacao.ts`, `ConfirmarAtribuicao.tsx`); o histórico registra a origem ("via sugestão do Precisa de você (confirmada por …)" × "manual").

**VIGIA (somente leitura): `INT-001`** em `lib/saude/verificacoes/integridade-invariantes.ts` (R1–R7 acima; roda no diagnóstico/cron da Saúde e sob demanda por `executarVigiaDeIntegridade()`); cita certidão + pessoa + família e nunca corrige sozinho. Teste: `scripts/regras-fixas-integridade.test.ts` (+ `localizar-registro-pessoa-tardia.test.ts`).

---

Este arquivo é o roteador. Antes de alterar um domínio específico, ver também `docs/architecture/` — em especial `06-fonte-da-verdade.md`, `05-materializacao.md`, `04-invariantes.md`, `12-materializador-documental-unico.md` — e `15-motor-operacional-tarefa-workflow-step.md` para o motor operacional genérico (Tarefa/Workflow/Step), consolidado em 10/09/2026, e `16-tarefas-e-projetos-projecao-gerencial.md` para "Tarefas e Projetos" como projeção administrativa (marco gerencial, aguardando atribuição, filtros de data), consolidado em 11/09/2026, e `17-eventos-historico-notificacoes.md` para a cadeia evento→histórico→atenção→notificação (porta canônica, matriz evento→notificação, RETORNO/ACOMPANHAMENTO/EM_RISCO/FASE_CONCLUIDA), consolidado em 12/09/2026, e `18-projecoes-consistencia-entre-telas.md` para a convergência de Tarefas e Projetos/Lista/Kanban/Central em `tarefa-projecoes.ts` (EM_RISCO exposto, ownership corrigido, filtro/paginação, CANCELADA≠CONCLUÍDA, deep-links), consolidado em 13/09/2026, e `19-circuito-operacional-completo.md` para a validação de ponta a ponta do circuito (atribuição→execução→espera→follow-up→retorno→reatribuição→EM_RISCO→fase), fechando o Plano de Estabilização de 6 etapas, consolidado em 13/09/2026, e `20-emissao-documental-diagnostico.md` para o diagnóstico (sem implementação) de quanto da regra final de Emissão Documental já é suportado pelo motor estabelecido — PRONTA PARA CONFIGURAÇÃO, com reconciliação financeira cartório×Ledger como único item pendente de decisão —, e `21-integridade-sistemica-grafo-dependencias.md` para o princípio arquitetural permanente: nenhuma mutação é local, toda mudança de estado deve propagar suas consequências pelo grafo de dependências respeitando ownership/compartilhamento/histórico/financeiro/semântica até o sistema convergir para uma única verdade canônica — ler antes de qualquer CREATE/UPDATE/DELETE/CANCEL/REASSIGN/REOPEN estrutural —, e `22-integridade-sistemica-auditoria.md` para a auditoria real desse grafo: ⚠ `DELETE /api/processos/[processoId]` cascateia (schema `onDelete: Cascade` real, verificado) até `ObrigacaoEconomica` (Ledger) sem passar pelo guard que `pessoa-ciclo-vida.ts`/`DELETE /api/arvore/[arvoreid]` já implementam — CRÍTICO, correção pendente de autorização —, e `Fornecedor`×`OrgaoProtocolo` como source of truth concorrente para o mesmo terceiro financeiro/operacional, consolidado em 13/09/2026, aprofundado e fechado em `23-integridade-sistemica-consolidacao-final.md` (18 gaps classificados, grafo completo de exclusão de Processo, matriz de decisão, plano em ordem de dependência, veredito) — G1 CORRIGIDO em `26-delete-processo-lifecycle-seguro.md` — `processo-ciclo-vida.ts` bloqueia exclusão com fato financeiro materializado, DELETE de Processo não toca mais Árvore/Família, permissão `processos.excluirDefinitivo` (EXCLUSIVA); , `27-emissao-documental-estado-real-e-minha-operacao.md` para a prova (dado real de produção) de que o workflow "Solicitar Certidão" já existe publicado (id=12, versão 4, 5 passos, uma única Tarefa do início ao fim — Tarefa 3570/Processo 592) e de que "Minha Operação" já existe como `/operacao`/`CentralTarefas` — a extensão real desta rodada foi só expor `emRisco`/`acompanhamentoVencido`/`retornoRecebido` como filtro, e `25-fechamento-compreensao-sistemica.md` (fechamento de 11 NÃO DETERMINADOS + 4 contradições + teste adversarial), achado maior: existe `FINANCEIRO_LEGADO_ESCRITA_BLOQUEADA` (interruptor de corte Receita/Custo→ObrigacaoEconomica já pronto no código, nunca acionado) e `SolicitacaoDocumento.canal` é o campo realmente ativo (o declarado "canônico" `canalOperacionalId` está sempre null na prática) — ler antes de tocar nesses dois pontos, e `29-minha-operacao-e-semantica-4-passos.md` para a decisão de negócio definitiva (14-15/09/2026): Emissão Documental tem EXATAMENTE 4 passos operacionais (conferir+validar certidão unificados no passo 4, como subtarefas do mesmo Step — nunca um quinto Step), o passo 4 é executado integralmente por quem detém a Tarefa (SEM handoff automático para Marco/Admin — reatribuição continua sendo capacidade genérica e opcional do motor), e a semântica canônica de Minha Operação: uma Tarefa por obrigação, AGUARDANDO_TERCEIRO/follow-up/retorno como ESTADO da mesma Tarefa (nunca nova Tarefa), próxima ação composta do rótulo real do passo (nunca só "Responsável deve agir até X"), motivo de risco sempre humanizado antes de chegar à usuária, notificação independente da fila — ler antes de alterar Emissão Documental ou Minha Operação, e `docs/architecture/30-catalogo-de-fases-reconciliacao.md` para o Catálogo de Fases como fonte única (`CatalogoFase`/`CatalogoFaseRevisao`, versionamento, publicação, retroação/reconciliação automática, idempotência, limites entre Catálogo de Fases × Workflow Macro × Workflow Interno) — módulo FECHADO desde 22/09/2026 (mandato "blindagem", suíte `npm run test:fases`, 22 arquivos/555 verificações, gate em CI): nenhuma mudança de arquitetura, contrato, cardinalidade, reconciliação ou projeção de Fases sem solicitação explícita e a suíte inteira passando — ler antes de tocar em qualquer coisa sob Gerenciamento → Processos → Estrutura → Fases, e `docs/architecture/31-hierarquia-pais-tipo-modalidade-workflow-macro.md` para a hierarquia País/Região → Tipo de Processo → Modalidade → Workflow Macro (Tipo = só nacionalidade nunca modalidade no nome/código; Modalidade = só ADMINISTRATIVA/JUDICIAL, nunca texto livre; um Tipo habilita as duas simultaneamente via N:N real; cada par Tipo+Modalidade tem seu próprio Workflow Macro, identificado por `@@unique([tipoProcessoId, modalidadeId])`; ModalidadeLegal/EnquadramentoLegal permanecem inexistentes) — CONGELADO desde 22/09/2026 (mandato "Reconstrução da hierarquia", suíte `npm run test:hierarquia-pais-tipo-modalidade`, 48 verificações, gate em CI): nenhuma mudança de arquitetura, cardinalidade, unicidade ou contrato sem solicitação explícita e a suíte inteira passando — ler antes de tocar em Gerenciamento → Processos → Cadastros (Países e Regiões / Tipos de Processo / Modalidades) ou em Workflow Macro, e `docs/architecture/32-torre-de-controle.md` para o mandato "Torre de Controle" (tela única de Administrador substituindo `/tarefas` e `/operacao/distribuicao`, executado em blocos — documento cresce um bloco por vez): Bloco A (29/09/2026) fechado — `escopo=equipe` em `GET /api/operacao/tarefas` para Administrador/gestor operacional (`operacao.distribuirTarefas`), com `pais`/`faseMacroKey`/`processoId`/`estadoOperacao`/`responsavelId` opcionais —, e Bloco B (29/09/2026) fechado — `ContatoTerceiro.resultado` (vocabulário fechado) faz "cobrança sem resposta" ser fato, não contagem cega: `cobrancasSemResposta` (não o total) decide `escalada`, exposto em `LinhaGerencial`/`ResumoSubtarefasDoPasso` e corrigido também no dossiê de tarefa única (`dossieDaTarefa` não passava o mapa de progresso por subtarefa para `projetar()` — só a fila em lote passava); mini-formulário único (`RegistrarContatoModal`) nas 3 portas de cobrança (Cobrar/Cobrar todos os vencidos/Contato com o cartório no drawer); "Adiar" sem `window.prompt` (`AdiarAcompanhamentoModal`, dias 1–15, motivo 10–300) grava em `TarefaHistorico`, que `montarAndamentoDaOperacao` (Andamento) passou a ler além de `LogAuditoria` — e ajuste pós-conferência (29/09/2026): `computarProximoAcontecimento` (`lib/operacional/proximo-acontecimento.ts`) lia a DIMENSÃO D (próximo acompanhamento) de `metadata.operacao.proximoAcompanhamento` (campo do motor antigo, nunca escrito pelo motor de subtarefas — sempre `undefined`), divergindo do rótulo (que já lia `SubtaskExecution.proximoAcompanhamentoEm`); e `contextoDeParada` só lia `LogAuditoria` para `esperandoDesde`, mas o caminho automático (`bloquearTarefa`, task-step-sync.ts) só grava `WorkflowEvento` — as duas fontes de "desde quando espera" agora são mescladas cronologicamente. Ambos corrigidos e a fonte única (`SubtaskExecution.proximoAcompanhamentoEm`, dias CORRIDOS) passou a valer para rótulo/booleano/KPI — e Bloco C (29/09/2026) fechado: `Tarefa.orgaoId` (espelha `Documento.orgaoId`, mesmo cadastro `OrgaoProtocolo` — sem entidade nova), gravado pela mesma porta `vincular-orgao-lote`; `GET /api/gerenciamento/orgaos-protocolo/[id]/estatisticas` reaproveita `visaoGerencial`/`ContatoTerceiro.groupBy`, nenhum contador novo; migração dos 57 tarefas com documento em produção (39 vinculadas por cópia direta, 18 gaps reais documentados — nomes de cidade sem candidato confiável nunca viram vínculo por chute) — e Bloco D fechado após correção pós-conferência ao vivo (29/09/2026): `alterarPrazo` (`lib/operacional/tarefa-ciclo.ts`) para Tarefa de Emissão Documental COM `SolicitacaoDocumento` já existente escreve `previsaoRetorno` (a fonte que a projeção lê) E espelha `Tarefa.dataPrazo` (nunca só um — CERT-001 audita os dois batendo, e PRZ-001/Kanban/notificações ainda leem `Tarefa.dataPrazo` bruto, migração da Parte 1 foi parcial); sem `SolicitacaoDocumento` ainda cai no caminho antigo (só `Tarefa.dataPrazo` — preserva o override pontual pré-solicitação de `resolverPoliticaTemporal`/SLA por cartório, que reaproveita a MESMA primitiva); `LinhaGerencial` ganhou `repactuacoes`/`ultimaRepactuacao` (lidos de `LogAuditoria`, batched, em `enriquecerLinhas` E `dossieDaTarefa`); CERT-001 confirmado antes (1 achado)/depois (0) da correção — ler antes de tocar em `lib/operacional/tarefa-projecoes.ts`, `lib/operacional/proximo-acontecimento.ts`, `src/services/subtarefas-da-etapa.ts`, `src/services/andamento-operacional.ts`, `src/app/api/operacao/tarefas/vincular-orgao-lote/route.ts`, `lib/operacional/tarefa-ciclo.ts` ou em qualquer bloco E–J do mandato. **Disciplina de sessão única**: antes de iniciar um bloco novo, checar `ListAgents` — sessão concorrente detectada = PARAR e avisar o usuário, nunca revisar/completar sozinho.

## 41. REGRAS INEGOCIÁVEIS DO MARCO (07/10/2026) — cada uma com teste na suíte crítica (quebra o build) E vigia de leitura da produção

Combinadas várias vezes; nenhuma entrega pode quebrá-las. Teste: `scripts/regras-inegociaveis-do-marco.test.ts` (+ os testes citados). Vigia de produção (só SELECT): `npx tsx scripts/vigia-regras-do-marco.ts [--profundo]`; Saúde do Sistema: INT-003.

- **a)** Emissão documental fica TRAVADA («Aguardando Genealogia») enquanto a tarefa de Genealogia da MESMA certidão estiver aberta — na TELA (gaveta: sem «Iniciar», sem «Disponível») E no SERVIDOR (`concluirSubtarefaCorrentePeloPasso` recusa passo BLOQUEADO).
- **b)** Em NENHUM seletor de atribuição vem pessoa pré-selecionada: todo «Atribuir a» começa em «— escolha a pessoa —» (`src/lib/ui/atribuicao.ts`) e o botão só habilita com pessoa escolhida (e tarefas selecionadas, no lote). Teste: `seletores-sem-pessoa-preselecionada.test.ts`.
- **c)** A tarefa que muda de fase nasce SEM responsável; nunca herda quem concluiu a anterior (`mudouDeFaseComDono` — as DUAS portas de reancoragem em `tarefa-canonica.ts`).
- **d)** Atribuição de tarefas só na página do processo (`/torre/processo/[id]`). As portas que duplicavam a página foram FECHADAS (07/10/2026): as telas mostram o responsável atual e o atalho «Abrir processo para atribuir», e o SERVIDOR recusa (422, `ATRIBUICAO_SO_NA_PAGINA_DO_PROCESSO`) atribuir/transferir/devolver à fila sem a origem da página (`lib/operacional/atribuicao-origem.ts`). Ficam: o lote da Torre, «Distribuir» do processo, a equipe da Torre e a sucessão em massa. Porta nova fora disso quebra o teste (`scripts/atribuicao-so-na-pagina-do-processo.test.ts`).
- **e)** Ordem fixa das certidões em TODA lista: geração, depois Nascimento, Casamento, Óbito (`ordem-certidoes.ts`; ver §38).
- **f)** As 4 subtarefas da Emissão são OBRIGATÓRIAS; anexo, comprovante ou dado preenchido NUNCA é obrigatório (`REQUERIMENTO_ENVIADO_OBRIGATORIO = false`; pedidos antigos não têm comprovante).
- **g)** A certidão só entra em Feito com os 4 passos concluídos (R8 do vigia INT-002 + regra g do INT-003).
- **h)** Nenhuma informação ou contador aparece repetido em dois lugares da mesma tela (detector `acharContadoresRepetidos`; telas novas com contador repetido quebram o teste).
- **i)** Contadores batem: sem responsável + com cada pessoa = abertas (cabeçalho × tabela × Caminho — `conferirContadores`).
- **j)** FLUXO ÚNICO DO RECEBIMENTO: a linha do Aguardando só tem «Abrir»; na gaveta, o passo 2 só tem «Iniciar →», que abre «Registrar recebimento» (conclui 2 e 3 pelo modal, anexo opcional, data passada ok). Nenhum outro caminho conclui mais de um passo sem a gaveta; passo bloqueado/fora de ordem NUNCA aparece «Disponível» e o servidor o recusa (`scripts/fluxo-recebimento-selo-datas.test.ts`, regra j do INT-003).
- **k)** Toda data digitada é `dd/mm/aaaa` (`CampoDataTexto`, máscara fixa; valor interno ISO). `<input type="date">`/`datetime-local` é proibido em qualquer tela (o navegador mostra mm/dd/aaaa).
- **l)** Certidão RECEBIDA só com «Receber certidão» concluída na Emissão (Registrar recebimento); VALIDADA só com «Conferir e validar» (passo 4) concluído. «Localizar registro» na Genealogia NUNCA recebe nem valida — só preenche dados registrais e árvore. Uma lógica só, no servidor: `etapaDaCertidao` em `lib/operacional/documento-estado.ts` (bolinha da árvore, coluna «Certidão» e contagens leem dela); vigia regra l do INT-003 (`scripts/certidao-recebida-so-pela-emissao.test.ts`).
- **m)** O local do óbito tem colunas próprias na Pessoa (`local_obito`, `estado_obito`, `pais_obito`; `local_emigracao` é só emigração). A certidão de óbito localizada e a árvore dizem o mesmo lugar: cidade com cidade, estado com estado, país com país (parêntese no fim ignorado); diferente só grava com a confirmação árvore × cadastro. Vigia regra m do INT-003 (`scripts/local-obito-colunas.test.ts`).
- **n)** A Torre tem UMA função por dado: responsável (`lib/operacional/responsavel-canonico.ts`: donos por processo, sem dono), e — nos itens seguintes — fases, risco e contagens. Aba nenhuma calcula a sua versão; só desenha. Vigia `compararAbasDaTorre` (`lib/operacional/torre-coerencia-abas.ts`, regra n do INT-003) lê o que cada aba vai desenhar a partir das MESMAS linhas e reprova divergência (`scripts/torre-abas-coerentes.test.ts`). Tarefa aberta, vencida ou sem responsável nunca é erro.
- **o)** Documentos por pessoa — UMA regra para o dono da certidão de casamento (`titularDaUniao`, `src/services/genealogia/titular-uniao.ts`: o cônjuge da linha reta que MANTÉM o casamento; pessoa dispensada nunca é dono e não herda a necessidade da união), recalculada em toda reconciliação (`reapontarDonoDoCasamento`, `dono-casamento.ts`: só o titular muda — status, histórico e contagens ficam). O dossiê conta certidão RECEBIDA e VALIDADA (`etapaDaCertidao`), não necessidade atendida só por registro localizado. Vigia `divergenciasDeDocumentosPorPessoa` (`lib/operacional/coerencia-documentos-pessoa.ts`) reprova: casamento fora do dono, dispensada com exigência aberta, painel × aba Documentos × árvore × Torre divergentes (`scripts/casamento-dono-unico.test.ts`).
- **p)** Toda dispensa de necessidade registra QUEM fez: `dispensarNecessidade(id, motivo, db, manual, autor)` exige `autor` (`{usuarioId, origem}`; `dispensaDoSistema(origem)` quando é o sistema) e grava a linha `NECESSIDADE_DISPENSADA` com usuário/sistema e motivo, em todos os caminhos (cancelar operação do documento, tela da necessidade, união desfeita, reconciliação da Genealogia). Vigia `detectarRegraP` reprova dispensa sem essa linha (a partir de 08/10/2026; histórico antigo não é reescrito) — `scripts/dispensa-sempre-com-autor.test.ts`.
- **q)** A GENEALOGIA SEMPRE PREVALECE, sem exceção (Marco, 08/10/2026): a árvore a acompanha SOZINHA (sem botão) — vazio na árvore → grava; valor DIFERENTE → também grava (conflito, texto quase igual e local do óbito inclusos), com o valor antigo no histórico (reversível); igual → nada; Genealogia vazia → nada (nunca apaga); nome e nacionalidade nunca. NÃO existe lista de «ambíguos» por semelhança nem exceção para o local do óbito (colunas próprias `local_obito/estado_obito/pais_obito`; `local_emigracao` não é tocado). Texto único «Cidade - Estado» é separado só quando seguro (`separarLugarUnico`) — senão revisão manual; data impossível/lixo é dado INVÁLIDO e não grava. Casos antigos: `relatorioDeCasosAntigos` / `aplicarLoteDeCasosAntigos`. Vigia `detectarRegraQ` reprova árvore ≠ Genealogia — `scripts/sincronizacao-automatica-genealogia.test.ts`.
- **r)** Cada passo da Emissão abre a janela do PRÓPRIO passo (`janelaDaSubtarefa`, `lib/operacional/janela-do-passo.ts`): passo 2 «Receber confirmação do pedido» → Central da etapa (tela de confirmação do pedido: protocolo, valor, anexo do protocolo, observações); SÓ o passo 3 «Receber certidão» → «Registrar recebimento», e só com o passo 2 concluído (o serviço conclui apenas o 3 e recusa `CONFIRMACAO_PENDENTE`). Todos os pontos de entrada chegam ao `WorkflowTab`. Vigia `detectarRegraR` reprova passo 3 concluído sem o 2 — `scripts/passo2-abre-confirmacao-passo3-recebimento.test.ts`.
