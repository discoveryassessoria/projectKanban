# ADR 13 — Árvore Genealógica: Camada de Projeção e Baseline Congelada

**Status:** aceito · **Congelada em:** 08/08/2026
**Baseline:** `Genealogical Tree Baseline v1.0` · tag `genealogical-tree-v1.0-stable`
**Declaração verificável:** `docs/architecture/baseline-arvore-v1.json`
**Contratos:** `src/lib/genealogia/contratos.ts`
**Guard:** `npm run test:arvore-arquitetura` (obrigatório no build)

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
| explicação determinística| tomadora de decisão de negócio     |

Ela é dona de **um** domínio, e é curto: **relação genealógica** (`Pessoa`,
`Uniao`, `Arvore` e as posições visuais dos nós). Tudo o mais ela **lê**.

### Responsabilidades oficiais (16)

representar relações familiares · calcular linhagens · foco por requerente ·
projeções visuais · diagnóstico · Explain Engine · Simulador Read-Only ·
navegação · agregação de projeções · resumo operacional · busca · filtros ·
indicadores · heatmap · timeline oficial · comparação entre requerentes.

Nenhuma outra sem ADR.

### Responsabilidades proibidas

materializar documentos · criar tarefas · criar custos · criar receitas ·
executar workflow · alterar regra documental, financeira ou operacional ·
decidir negócio · possuir motor paralelo · criar segunda árvore ou segunda fonte
da verdade · duplicar resolver ou regra · acessar Prisma direto da UI ou dos
motores puros · importar repositório ou implementação interna de outro domínio.

### Owners canônicos

Declarados em `OWNERS_CANONICOS` — o guard lê o **mesmo mapa**, então lista e
verificação não podem divergir.

| Entidade | Dono da escrita |
| --- | --- |
| `NecessidadeDocumental` | `src/services/necessidade-documental.ts` |
| `Documento` / `DocumentoArquivo` | Sistema Documental (`materializarExecucaoDaFase` → `materializarGenealogia`) |
| `PhaseWorkflowInstance` / `PhaseWorkflowStepInstance` | motor de workflow |
| `Tarefa` | motor de workflow — a tarefa é **projeção** do passo |
| `ObrigacaoEconomica` / `LedgerFinanceiro` / `DistribuicaoEconomica` | Motor Financeiro V3 |
| `ProdutoFinanceiro` | Configuração Financeira (Cadastro Mestre) |

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

Proibido: `Domain → Tree UI` · `Tree UI → Prisma` · `Tree UI → Repository` ·
motor puro → componente React.

### Contratos

A árvore conhece o resto do sistema **apenas** por `contratos.ts`:
`GenealogyPersonProjection` · `GenealogyLineageProjection` ·
`GenealogyOperationalProjection` · `GenealogyFinancialProjection` ·
`PersonChangeImpactProjection`.

Regra que os mantém honestos: **todo campo é ou genealógico (a árvore é dona) ou
uma decisão já tomada pelo módulo dono** — nunca um insumo a partir do qual a
árvore consiga recalcular a decisão dele. Por isso `condicoes`, `publicoAlvo`,
`varianteKey`, `documentosAceitos`, `matrizSnapshot` e `pricingRuleId` são
proibidos nos contratos, e o guard reprova se aparecerem.

### Preview de impacto: read-only por construção

```
PREVIEW                                EXECUÇÃO REAL
  aplica a proposta (Pessoa/Uniao)       persiste a alteração
  → materializarGenealogia(tx)           → evento canônico
  → mede o delta                         → materializarGenealogia
  → THROW → rollback                     → reconciliação
```

A transação termina **sempre** lançando `RollbackDaSimulacao`. Não existe caminho
de saída que faça commit — a diferença entre "não escrevemos" e "não é possível
escrever". Se a Regra Documental mudar amanhã, o preview muda junto, porque é a
mesma função.

## Invariantes permanentes

1. uma única fonte da verdade por domínio
2. preview sempre read-only
3. Explain Engine determinístico, sem modelo de linguagem
4. zero motores paralelos
5. zero escrita direta em domínio alheio
6. layout base preservado
7. identidade visual preservada
8. dependências unidirecionais
9. projeções consumidas apenas por contratos oficiais

## Governança

Alterações futuras têm **três** categorias, e nenhuma outra:

- **BUG** — comportamento inesperado. Não exige ADR.
- **MELHORIA PONTUAL** — refinamento sem tocar arquitetura, fronteira ou layout.
  Não exige ADR.
- **EVOLUÇÃO** — capacidade nova. **Exige ADR**, revisão arquitetural, análise de
  impacto e aprovação formal. Sem ADR, a alteração é recusada.

Toda alteração na árvore roda: lint · typecheck · build · baseline · guards ·
testes da árvore, de linhagem, do Explain Engine, do simulador, de diagnóstico e
de fronteira. **Nenhum teste pode ser removido** — e isso é verificado, não
combinado (ver abaixo).

## Verificação

`npm run test:arvore-arquitetura` — sete blocos: escrita (ORM, SQL cru e HTTP),
imports, projeção paralela, owner único, direção de dependência, preview ×
execução, e **baseline**.

O bloco de baseline protege **as próprias proteções**: lê
`baseline-arvore-v1.json` e reprova se um guard for apagado, desligado da cadeia
do `build`, ficar sem script npm, ou se uma suíte encolher abaixo do piso de
asserções do dia do congelamento. Nada disso era protegido antes — apagar um
guard deixava o CI verde.

Os guards foram **testados por mutação**, não apenas escritos:

| Violação injetada | Resultado |
| --- | --- |
| escrita ORM em `Tarefa` | reprovou |
| SQL cru em `NecessidadeDocumental` | reprovou |
| import de `prisma` no motor puro | reprovou |
| import de materializador | reprovou |
| avaliação de Regra Documental na árvore | reprovou |
| resolução de preço na árvore | reprovou |
| `DELETE /api/documentos` por HTTP | reprovou |
| motor puro importando componente | reprovou |
| guard desligado da baseline do build | reprovou |
| `status` do JSON alterado para "ABERTA" | reprovou |
| responsabilidade removida da baseline | reprovou |
| invariante removido da baseline | reprovou |
| arquivo de guard apagado do disco | reprovou |

Um guard que nunca falhou não é evidência de nada.

## Soluções rejeitadas, e por quê

**Camada de IA explicativa (LLM).** Chegou a ser pedida e foi rejeitada por
decisão do usuário, com dois motivos que se somam: um modelo responde bem quando
não sabe, e uma explicação plausível e errada sobre genealogia custa um processo;
e enviar a genealogia de um cliente para fora é decisão de produto e privacidade,
não efeito colateral de uma funcionalidade. O Explain Engine determinístico
substituiu-a — e responde melhor, porque distingue o que texto fluente achata:
"não iniciado" ≠ "buscado e não encontrado"; "nada impede" ≠ "está tudo pronto";
suspeita com 65% de confiança ≠ contradição provada.

**Reimplementar as Regras Documentais dentro do preview.** Seria a segunda
implementação da regra, e ela mudaria de opinião sem o preview perceber. O
preview roda o materializador oficial e reverte.

**Recalcular o estado final no ANTES × DEPOIS.** Seria uma segunda opinião sobre
o mesmo futuro, e as duas discordariam no primeiro caso de borda. O DEPOIS é
`antes + delta`, aritmética pura.

**Chamar o motor financeiro na simulação.** `aplicarHonorariosPorRequerente` usa
o `prisma` global e escreveria **fora** da transação, onde o rollback não alcança.
O impacto financeiro é relatado como aplicabilidade, sem valor inventado.

**Recalcular o layout no modo linhagem.** Compactar a linhagem exigiria rodar o
dagre de novo — e trocar o desenho foi exatamente a mudança reprovada em 30/07. O
foco é aplicado **depois** do layout e só decide opacidade e visibilidade.

**Pintar o heatmap dentro do cartão.** O cartão é o objeto congelado. O anel é
`box-shadow` no wrapper do nó: `PersonNode` não recebe prop, não sabe que o modo
existe, e sombra não ocupa espaço — nenhum nó se desloca.

**Score de saúde de 0 a 100.** Daria nota parecida para "falta muita coisa fácil"
e "tem uma coisa que impede tudo", que são situações opostas. A saúde tem três
estados fechados.

**Inventar a filiação do processo 513 para enriquecer a validação.** O dado não
existe (0 uniões, 0 documentos, nenhuma pessoa espanhola no banco). Preencher
seria fabricar a genealogia de um cliente real. O motor, sozinho, propôs a
hipótese como *sugestão a confirmar* — que é o comportamento correto.

## Histórico

- **07/08** — motor operacional: linhagem multi-requerente, foco pós-dagre,
  dossiê por pessoa, perguntas determinísticas.
- **08/08** — preview de impacto (rollback por construção); elo causal da União
  ligado ao materializador oficial (casar não disparava nada); fronteira
  congelada em CI; removida a última escrita direta (`DELETE /api/documentos/:id`,
  que sobrevivia pendurada numa permissão que ninguém concede); Modo Auditor;
  Explain Engine sem LLM; heatmap no wrapper; polimento de UX; **baseline v1.0**.

## Limitações conhecidas (registradas, não resolvidas)

- `buildTreeNodesAndEdges` desenha apenas a **componente conexa** de
  `pessoaPrincipal`: pessoa sem vínculo existe no banco, na busca, no diagnóstico
  e no painel, mas não aparece no canvas. Corrigir toca o builder do layout
  congelado — exige ADR.
- `removerPessoaDaArvore` em modo HARD apaga o `ProcessoRequerente` e a
  reinserção não o recria. É domínio do ciclo de vida da Pessoa, fora da árvore.
- Produção tem hoje um único processo com árvore povoada; os números de
  desempenho de 500/1.000 pessoas vêm da suíte sintética.

## Ver também

- ADR 12 — Materializador Documental Único
- `docs/architecture/06-fonte-da-verdade.md`
- `docs/architecture/baseline-arvore-v1.json` — a declaração que o CI verifica
- `scripts/arvore-layout-congelado.test.ts` — o **desenho** também é congelado
