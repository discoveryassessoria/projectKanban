# ADR 15 — Desenho da árvore genealógica em camadas para casais (06/10/2026)

**Decisão do dono (pedido explícito, 06/10/2026):** refazer a lógica de desenho da aba Árvore Genealógica do processo. Libera, SÓ para isto, a regra de layout congelado (30/07): troca-se o ALGORITMO DE POSIÇÃO; cartões, cores, tipografia, canvas claro, controles e minimapa não mudam.

**O que muda**
- `src/lib/genealogia/layout/arvore-camadas.ts` (puro): geração = linha (coluna na paisagem), cônjuge na geração do parceiro, casal encostado, pessoa com várias uniões no meio (1º casamento à esquerda/acima, 2º à direita/abaixo, demais seguem), filhos sob o ponto médio de cada casal em ordem de nascimento, largura por ramo de baixo para cima com contornos por geração (Reingold–Tilford adaptado a casais). Família do cônjuge: ramo à parte, alinhado por geração e colocado ao lado.
- Linha de casamento: segmento entre os lados que se tocam, escolhido pela POSIÇÃO REAL dos cartões (`ladosDoCasal`), recalculado a cada movimento. Filiação: do meio do casal, barra, descida (`linha-de-filiacao.tsx`).
- O dagre e as cinco passadas de correção saem do desenho (a dependência continua declarada).

**Posições manuais (`Arvore.posicoesNodes`)**
- Antes: a cada arrasto gravava-se a posição de TODOS os cartões em `paisagem`/`retrato`, e ela vencia sempre o desenho automático.
- Agora: o automático é o padrão; arrastar grava SÓ o cartão movido em `manual-paisagem`/`manual-retrato` (nunca usado na outra disposição), marcado na tela (contorno tracejado + aviso com contador). Reset = por árvore, só a disposição visível, com Desfazer. As chaves antigas ficam intactas no banco e deixam de ser aplicadas. Nenhuma posição de outra árvore é tocada.

**Linhagem** continua sendo foco aplicado DEPOIS do desenho (não move cartão); logo obedece às mesmas regras.

Guarda: `scripts/arvore-desenho-camadas.test.ts` (suíte crítica).
