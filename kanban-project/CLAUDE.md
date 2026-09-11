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

---

Este arquivo é o roteador. Antes de alterar um domínio específico, ver também `docs/architecture/` — em especial `06-fonte-da-verdade.md`, `05-materializacao.md`, `04-invariantes.md`, `12-materializador-documental-unico.md` — e `15-motor-operacional-tarefa-workflow-step.md` para o motor operacional genérico (Tarefa/Workflow/Step), consolidado em 10/09/2026, e `16-tarefas-e-projetos-projecao-gerencial.md` para "Tarefas e Projetos" como projeção administrativa (marco gerencial, aguardando atribuição, filtros de data), consolidado em 11/09/2026.
