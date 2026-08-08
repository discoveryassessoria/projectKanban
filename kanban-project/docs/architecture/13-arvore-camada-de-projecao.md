# ADR 13 — Árvore Genealógica como Camada de Inteligência e Projeção

**Status:** aceito · **Data:** 08/08/2026
**Guard:** `npm run test:arvore-arquitetura` (obrigatório no build)
**Contratos:** `src/lib/genealogia/contratos.ts`

---

## Contexto

A Árvore Genealógica é a tela mais central do Discovery: é dela que o operador
enxerga pessoas, linhagem, pendência documental, tarefa e valor. Justamente por
concentrar tudo isso, ela é o lugar mais fácil do sistema para um segundo motor
nascer sem que ninguém perceba.

Já nasceu uma vez. A árvore lia `Pessoa.documentos` — o `Documento` cru — e
pintava semáforo documental por conta própria. Era regra do Sistema Documental
morando dentro da árvore: duas fontes para a mesma verdade. Nada quebrava. Lint,
tsc, build e testes passavam; só a informação na tela discordava do módulo dono,
e ninguém tinha como saber qual das duas estava certa.

O mesmo padrão se repetiu em escala maior no projeto: dois materializadores
documentais convivendo, cada um gravando um `varianteKey` diferente para a mesma
obrigação, produzindo certidão duplicada por meses sem sinal automático.

A conclusão que este ADR registra: **em fronteira de domínio, convenção não
segura. Só build vermelho segura.**

## Decisão

A Árvore Genealógica é, permanentemente:

| É                        | Não é                              |
| ------------------------ | ---------------------------------- |
| visualização             | fonte da verdade documental        |
| navegação                | motor de workflow                  |
| diagnóstico              | motor de tarefas                   |
| agregação de projeções   | motor financeiro                   |
| simulação **read-only**  | materializador                     |

Ela é dona de **um** domínio, e é curto: **relação genealógica** (`Pessoa`,
`Uniao`, `Arvore` e as posições visuais dos nós). Tudo o mais ela **lê**.

### Owners canônicos

Declarados em código, em `OWNERS_CANONICOS` — o guard lê o mesmo mapa, então
lista e verificação não podem divergir:

| Entidade                    | Dono da escrita                                     |
| --------------------------- | --------------------------------------------------- |
| `NecessidadeDocumental`     | `src/services/necessidade-documental.ts`              |
| `Documento` / `DocumentoArquivo` | Sistema Documental (`materializarExecucaoDaFase` → `materializarGenealogia`) |
| `PhaseWorkflowInstance` / `PhaseWorkflowStepInstance` | motor de workflow (`src/services/phase-workflow.ts`) |
| `Tarefa`                    | motor de workflow — a tarefa é **projeção** do passo  |
| `ObrigacaoEconomica` / `LedgerFinanceiro` / `DistribuicaoEconomica` | Motor Financeiro V3 |
| `ProdutoFinanceiro`         | Configuração Financeira (Cadastro Mestre)             |

### Direção da dependência

```
Árvore / UI
   ↓
Application Services & Projections   (rotas /api/.../genealogia/*, simular-impacto)
   ↓
Domain Services                      (materializador, workflow, financeiro)
   ↓
Repositories / Prisma
   ↓
Database
```

Proibido em qualquer circunstância:

- `Domain → Tree UI`
- `Tree UI → Prisma`
- `Tree UI → Repository`
- motor puro → componente React

### Contratos

A árvore conhece o resto do sistema **apenas** por
`src/lib/genealogia/contratos.ts`:

`GenealogyPersonProjection` · `GenealogyLineageProjection` ·
`GenealogyOperationalProjection` · `GenealogyFinancialProjection` ·
`PersonChangeImpactProjection`

Regra que os mantém honestos: **todo campo é ou genealógico (a árvore é dona) ou
uma decisão já tomada pelo módulo dono** — nunca um insumo a partir do qual a
árvore consiga recalcular a decisão dele. Por isso `condicoes`, `publicoAlvo`,
`varianteKey`, `documentosAceitos`, `matrizSnapshot` e `pricingRuleId` estão
proibidos nos contratos, e o guard reprova se aparecerem: com eles em mãos, a
árvore conseguiria reavaliar a Regra Documental — e voltaria a ser motor.

### Preview de impacto: read-only por construção

O preview responde "o que esta alteração vai provocar?" **sem** reimplementar
nenhuma regra. Ele aplica a mudança proposta e roda `materializarGenealogia` — o
materializador oficial, o mesmo do save real — dentro de uma transação que
termina **sempre** lançando `RollbackDaSimulacao`.

```
PREVIEW                                EXECUÇÃO REAL
  aplica a proposta (Pessoa/Uniao)       persiste a alteração
  → materializarGenealogia(tx)           → evento canônico
  → mede o delta                         → materializarGenealogia
  → THROW → rollback                     → reconciliação
```

Não existe caminho de saída que faça commit. Isso é a diferença entre "não
escrevemos" e "não é possível escrever". Consequência prática: se a Regra
Documental mudar amanhã, o preview muda junto — porque é a mesma função.

O preview **não** chama o motor financeiro: `aplicarHonorariosPorRequerente` usa
o `prisma` global internamente e escreveria **fora** da transação, onde o
rollback não alcança. O impacto financeiro é relatado como aplicabilidade, sem
valor — valor é resolvido pela Tabela de Preços na execução.

## Consequências

**Ganhamos:** uma fronteira verificável em vez de combinada; preview que não
pode divergir da execução; e a impossibilidade estrutural de um segundo motor
nascer dentro da árvore sem o CI reclamar.

**Pagamos:** para a árvore passar a exibir um dado novo de outro domínio, é
preciso acrescentá-lo aos contratos de propósito, e justificar. Isso é atrito —
e é o atrito que se quer.

**Aceitamos:** o preview abre uma transação de escrita (revertida). Por isso o
smoke de produção **não** o executa: o contrato de rollback se prova em
`kanban_test`, medindo o banco inteiro antes e depois.

## Verificação

`npm run test:arvore-arquitetura` — seis fronteiras: escrita, imports, projeção,
owner único, direção de dependência, preview × execução.

O guard foi **testado por mutação**: oito violações injetadas (escrita ORM, SQL
cru, import de prisma, import de materializador, avaliação de regra, resolução de
preço, DELETE por HTTP em `/api/documentos`, motor puro importando componente) e
as oito foram reprovadas. Um guard que nunca falhou não é evidência de nada.

## Histórico

- **08/08/2026** — removida a única escrita remanescente: `DELETE
  /api/documentos/:id` disparado pela árvore. Sobrevivia pendurada na permissão
  `arvore.excluir_documento`, que ninguém mais concede — invisível na tela, viva
  no código, pronta para voltar assim que a permissão fosse recriada por engano.

## Ver também

- ADR 12 — Materializador Documental Único
- `docs/architecture/06-fonte-da-verdade.md`
- `scripts/arvore-layout-congelado.test.ts` — o **desenho** também é congelado
