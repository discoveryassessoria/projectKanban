# Conformidade da Árvore Genealógica com a experiência de referência

Referência funcional: **FamilySearch Family Tree**. Fidelidade de experiência tem
prioridade sobre criatividade — quando existe solução consolidada lá, ela é
adotada aqui. Nenhum código, marca, logotipo ou ativo é copiado: o que se segue é
a **especificação de comportamento**, reimplementada.

Fontes consultadas (documentação pública):

- [Landscape view in Family Tree](https://www.familysearch.org/en/help/helpcenter/article/what-does-the-landscape-view-do-in-family-tree)
- [What are the different pedigree views in Family Tree?](https://www.familysearch.org/en/help/helpcenter/article/what-are-the-different-pedigree-views-in-family-tree)
- [Use the portrait pedigree view](https://www.familysearch.org/en/help/helpcenter/article/what-is-the-portrait-pedigree-view-in-family-tree)
- [Use the fan chart view](https://www.familysearch.org/en/help/helpcenter/article/how-do-i-use-the-fan-chart-view-in-family-tree)
- [What the descendancy view does](https://www.familysearch.org/en/help/helpcenter/article/what-does-the-descendancy-view-do-in-family-tree)
- [The new landscape and portrait views](https://www.familysearch.org/en/help/helpcenter/article/new-landscape-and-pedigree-views)

Legenda: **✓** equivalente · **△** parcial · **✗** inexistente

---

## 1. Estrutura da tela e controles

| Item da referência | Estado | Observação |
|---|---|---|
| Seletor de vista no canto superior direito, rotulado com a vista atual | ✓ | `SeletorVista` |
| Botão de Opções à direita do seletor | ✓ | `MenuOpcoes` |
| Zoom +/− no canto superior direito | ✓ | estava flutuando embaixo; corrigido |
| Ícone Início — volta à pessoa inicial **e fecha** as linhas expandidas | ✓ | `voltarAoRequerente` zera `ramos` |
| Ícone Recentrar — volta à pessoa inicial **mantendo** as expansões | ✓ | `recentrar` |
| Pan arrastando o fundo | ✓ | `use-viewport` com inércia |
| Opções: escolher quais ícones aparecem | ✓ | Mostrar no card: retratos, datas, lugares, códigos |
| Opções: imprimir gráfico | ✓ | export PDF do Discovery, em `acoesExtras` |
| Opções: mostrar/ocultar pais e cônjuges alternativos | ✗ | os indicadores existem no card; o *toggle* não |

## 2. Paisagem

| Item | Estado | Observação |
|---|---|---|
| Pessoa em foco no centro | ✓ | modo `ramo` |
| Ascendentes de um lado, descendentes do outro | ✓ | orientação horizontal |
| Setas de expansão no fim das linhas | ✓ | `ControleRamo` |
| Cada clique expande **2 gerações**; clicar de novo recolhe | ✓ | `PASSO_EXPANSAO = 2` |
| Botão "Filhos" na caixa do casal revela a prole | ✗ | descendentes já aparecem, mas sem esse botão |
| Ícones no card: sugestões de pesquisa | ✓ | |
| Ícones no card: problemas de dados | ✓ | |
| Ícone de múltiplos cônjuges | △ | indicador presente; **alternar** entre cônjuges não (a árvore desenha todos em cadeia) |
| Ícone de pais alternativos | △ | indicador presente; alternância não |

## 3. Retrato

| Item | Estado | Observação |
|---|---|---|
| Vertical, foco e descendentes embaixo, ascendentes acima | ✓ | |
| Mesmos controles da Paisagem | ✓ | |
| Ícone de duas pessoas no canto superior do card | ✓ | pais alternativos |
| Setas à esquerda/direita para navegar entre irmãos | ✗ | irmãos são alcançáveis pelo teclado, não por setas no card |

## 4. Leque

| Item | Estado | Observação |
|---|---|---|
| Foco no centro, gerações em anéis concêntricos | ✓ | endereçamento Sosa |
| 4 a 7 gerações, escolhidas nas Opções | ✓ | |
| Exibir: Linhas familiares | ✓ | por quadrante |
| Exibir: Local de nascimento | ✓ | |
| Exibir: Fontes | ✓ | mapeado para a **situação documental** (fonte oficial no Discovery) |
| Exibir: Pendências de pesquisa | ✓ | mapeado para a completude do motor |
| Exibir: Histórias / Fotos | — | não existem no domínio do Discovery |
| Setores vazios mostram onde a linha termina | ✓ | clicáveis para cadastrar |
| Modo escuro do leque | ✗ | a árvore é superfície clara por decisão de produto |

## 5. Descendência

| Item | Estado | Observação |
|---|---|---|
| Lista vertical (não grafo) | ✓ | virtualizada |
| Setas para baixo à esquerda dos nomes | ✓ | |
| Até 4 gerações, configurável nas Opções | ✓ | |
| Retratos desligáveis para caber mais gente | ✓ | |
| Indicadores de problema e sugestão por linha | ✓ | |
| Clicar seleciona a pessoa como novo ponto de partida | ✓ | duplo clique re-enraíza |

## 6. Pessoa

| Item | Estado | Observação |
|---|---|---|
| Clicar no nome abre painel lateral à direita | ✓ | `PainelPessoa` |
| Painel tem botão que reposiciona a árvore na pessoa | ✓ | "Ver árvore a partir desta pessoa" |
| Painel leva à ficha completa | ✓ | |
| Código da pessoa visível e clicável para copiar | ✓ | |
| Adicionar informação a partir do painel | △ | edição existe; adicionar direto no painel, não |

## 7. Busca e navegação

| Item | Estado | Observação |
|---|---|---|
| Localizar pessoa na árvore | ✓ | ⌘K / `/`; abre vazio, sem listar funções |
| Histórico voltar/avançar | ✓ | interno, não mexe no do navegador |
| Pessoas visitadas | ✓ | |
| Buscar alguém fora do que está na tela o revela | ✓ | `expandirAte` abre as fronteiras necessárias |

## 8. Vistas ausentes

| Item | Estado | Observação |
|---|---|---|
| Primeiro Ancestral (First Ancestor) | ✗ | 5ª vista da referência, não implementada |

---

## Diferenças deliberadas (Discovery)

Permitidas pela regra: identidade visual, regras de negócio e funcionalidades
exclusivas do Discovery.

- **Linha de cidadania** destacada em todas as vistas (filete na cor do país).
- **Indicador documental** oficial vindo do Sistema Documental — a árvore exibe
  e leva até lá, nunca gere documento.
- **Irmandade classificada** (inteiro / meio paterno / meio materno / a
  confirmar) no painel de relações.
- **Estatísticas da árvore** com agrupamento fonético de sobrenomes, para
  grafias de imigração (Bianchi/Bianqui/Bianchy no mesmo grupo).
- **Superfície clara própria**, com o acento institucional dourado do Discovery.

## Ausências por falta de entidade no domínio

- **Adoção e vínculo não biológico**: `Pessoa` só tem `paiId`/`maeId`; não existe
  modelo de Relação Familiar. A árvore declara o limite em vez de simular.
