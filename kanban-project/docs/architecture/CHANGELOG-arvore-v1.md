# Changelog — Genealogical Tree Baseline v1.0

**Tag:** `genealogical-tree-v1.0-stable` · **Congelada em:** 08/08/2026
**Intervalo:** `3d1dadc6` → `915b45cf` (9 commits, 32 arquivos, +9.903/−86)
**ADR:** `13-arvore-camada-de-projecao.md` · **Baseline:** `baseline-arvore-v1.json`

---

## O que mudou, em uma frase

A Árvore deixou de ser um desenho passivo e passou a explicar o processo,
prever o efeito de uma alteração antes dela acontecer, e proteger as próprias
fronteiras no CI — **sem que o canvas em modo normal mudasse um único pixel**.

---

## Capacidades adicionadas

### Linhagem e foco
- **Linhagem por requerente**: cadeia de transmissão de cada requerente até o
  ascendente transmissor, com pessoas compartilhadas identificadas.
- **Foco aplicado DEPOIS do dagre** — a decisão que sustenta a promessa visual.
  Trocar de requerente é um `Map` novo, não um layout novo: nenhum card se move
  e as posições arrastadas continuam valendo.
- **Modo linhagem** com esmaecimento a 20% ou ocultação, ramos recolhíveis
  (`+N irmãos`), "mostrar relacionados" e breadcrumb clicável.

### Inteligência
- **Diagnóstico** com saúde em três estados fechados — sem score. Um número de 0
  a 100 daria nota parecida para "falta muita coisa fácil" e "tem uma coisa que
  impede tudo", que são situações opostas.
- **Próxima melhor ação** com fila FIXA de 7 prioridades e fonte declarada.
- **Explain Engine determinístico** ("Por que isso?"): cadeia causal com fonte em
  cada elo, que APONTA para a Regra Documental em vez de reexplicá-la.
- **Heatmap** por pessoa, aplicado no wrapper do nó — o cartão congelado não
  recebe prop nem sabe que o modo existe.
- **Timeline** da pessoa, consumindo a projeção de eventos que já existia.
- **Comparação entre requerentes** e busca com contexto ("Bisavô de Marco").

### Preview de impacto
- **Simulação read-only por construção**: aplica a mudança proposta, roda
  `materializarGenealogia` — o materializador OFICIAL — e termina SEMPRE lançando
  `RollbackDaSimulacao`. Não existe caminho que faça commit.
- **ANTES × DEPOIS**: o depois é `antes + delta`, aritmética pura. A cor vem da
  direção declarada por linha, não do sinal do número.

### UX
- Faixa fixa de contexto (rótulo em cima de todo número), contadores nos filtros,
  placeholders de pai/mãe que explicam o impacto real da ausência, e fim do modal
  que abria só para dizer que não havia nada a fazer.

---

## Bugs corrigidos

| # | Defeito | Causa |
| --- | --- | --- |
| 1 | **Casar não gerava exigência.** Criar/editar/excluir União não disparava o materializador — e é a união que produz a certidão de casamento. | Elo causal ausente em `/api/unioes`. Corrigido no domínio da união, reusando o motor único. |
| 2 | **A árvore apagava documento.** `DELETE /api/documentos/:id` disparado pela árvore — dono é o Sistema Documental. | Sobrevivia pendurado na permissão `arvore.excluir_documento`, que ninguém concede: invisível na tela, vivo no código. |
| 3 | **ESC fechava o processo inteiro.** Regressão introduzida nesta evolução. | Dois donos do mesmo Escape. Resolvido com handler em fase de captura que só consome quando há camada a fechar. |
| 4 | **Requerente removido nunca podia voltar.** O predicado de disponibilidade ignorava `removidaEm`. | Remoção é soft; quem saía da árvore contava como membro para sempre. |
| 5 | **Membro invisível.** Pessoa na árvore, presente na busca, no diagnóstico e no painel — ausente do canvas. | O builder desenhava só a componente conexa da pessoa principal. Classificado inicialmente por mim como evolução; era bug — ver ADR. |

---

## Fronteira congelada

- **ADR 13** com responsabilidades, proibições, owners, contratos, direção de
  dependência, invariantes, governança e **as soluções rejeitadas com o motivo**.
- **Contratos estreitos** (`contratos.ts`): `condicoes`, `publicoAlvo`,
  `varianteKey`, `documentosAceitos` são proibidos — com eles a árvore
  reavaliaria a Regra Documental e voltaria a ser motor.
- **Guard de fronteira** com 7 blocos: escrita (ORM, SQL cru e HTTP), imports,
  projeção paralela, owner único, direção, preview × execução, e baseline.
- **A baseline protege as próprias proteções**: apagar um guard, desligá-lo do
  build, ou encolher uma suíte passa a ser CI vermelho.

### Guards testados por mutação

18 violações injetadas, **18 reprovadas**: escrita ORM · SQL cru · import de
prisma · import de materializador · avaliação de regra documental · resolução de
preço · DELETE por HTTP · motor puro importando componente · guard desligado do
build · status "ABERTA" no JSON · responsabilidade removida · invariante
removido · guard apagado do disco · predicado de membership ignorando
`removidaEm` · builder filtrando por conexidade.

Um guard que nunca falhou não é evidência de nada.

---

## Verificação no congelamento

| Suíte | Verificações |
| --- | --- |
| `test:arvore-layout` (desenho congelado) | 16 |
| `test:arvore-arquitetura` (fronteira + baseline) | 41 |
| `test:arvore-inteligencia` | 45 |
| `test:arvore-motor` | 187 |
| `test:arvore-preview` (integração, kanban_test) | 33 |
| `test:arvore-membership` (integração, kanban_test) | 24 |
| `smoke:prod-arvore` (produção, somente leitura) | 12 |
| **Total** | **358** |

lint 0/0 · tsc limpo · build ✓ · guards de baseline 59/59

**Prova visual:** canvas em modo normal comparado ao baseline capturado ANTES de
toda esta evolução — **0 de 1.296.000 pixels diferentes**.

**Desempenho:** linhagem + foco em 1–2 ms com 500 e 1.000 pessoas (suíte
sintética). Em produção: carregamento 2,3 s · troca de requerente 459 ms ·
preview 55 ms.

---

## Limitações registradas

- `removerPessoaDaArvore` em modo HARD apaga o `ProcessoRequerente`, e a
  reinserção não o recria. É domínio do ciclo de vida da Pessoa, fora da árvore.
- Produção tem um único processo com árvore povoada; os números de 500/1.000
  pessoas vêm da suíte sintética, não de dado real.
- Itens da rodada de polimento não executados: microanimações, revisão
  sistemática de espaçamento/hover/focus e medição de contraste.

---

## A partir daqui

Três categorias, e nenhuma outra: **BUG** e **MELHORIA PONTUAL** não exigem ADR;
**EVOLUÇÃO** exige ADR, revisão arquitetural, análise de impacto e aprovação.

E a lição que o item 5 deixou registrada: **classificar pelo contrato, não pela
implementação.** O que o código faz hoje não é prova do que ele deveria fazer.
