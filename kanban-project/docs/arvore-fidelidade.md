# Árvore Genealógica — fidelidade visual e regras do desenho

Documento de referência do módulo. Explica o que o desenho promete, o que ele
deliberadamente NÃO faz, e onde cada decisão mora no código.

## 1. Superfície

Canvas de ponta a ponta, papel claro (`TREE.fundo`), sem grade e sem textura.
Não existe faixa de cabeçalho: os comandos flutuam sobre o desenho.

| Elemento | Onde | Arquivo |
|---|---|---|
| Controles da referência | canto superior direito | `motor/controles-arvore.tsx` |
| Controles Discovery (histórico, busca, sugestões, tela cheia, exportar) | canto superior esquerdo | idem |
| Minimapa | canto inferior esquerdo | `motor/minimapa.tsx` |
| Gaveta da pessoa | coluna direita, sobre o canvas | `motor/painel-pessoa.tsx` |

Os sete comandos da referência, nesta ordem: **visualização · configurações ·
início · enquadrar · centralizar · afastar · aproximar**.

## 2. A regra absoluta do casal

**No modo Paisagem cada cônjuge tem o seu próprio card.** Nunca um card de
casal, nunca duas pessoas como duas linhas de um mesmo container.

É a única divergência deliberada em relação à referência visual, e ela é de
domínio: no Discovery cada pessoa tem ficha, exigência documental, situação e
seleção próprias. Um card compartilhado obrigaria a inventar um sujeito ("o
casal") que não existe em nenhum outro lugar do sistema.

O que garante isso:

* o layout trata o casal como dois nós com folga mínima (`FOLGAS.*.casal`,
  nunca menor que 4px, mesmo que a configuração peça 0);
* a folga conjugal é sempre MENOR que a folga entre famílias — o par continua
  sendo lido como par;
* o vínculo conjugal é um conector, não um container;
* a linha de descendência nasce da **âncora da união** (nó lógico invisível), e
  não da borda de um dos cônjuges;
* o dado do CASAMENTO (data e lugar) é rotulado sobre o conector, porque é dado
  da união e não de nenhuma das duas pessoas.

Provas: `scripts/arvore-casal-cards.test.ts` (estrutural + estático) e o cenário
`03-casal-cards-separados` da suíte visual (DOM real, com clique).

## 3. Lugares vagos

`pai`, `mae`, `conjuge` e `filho` — cada um nasce na posição estrutural que a
pessoa ocupará, com o filete de gênero correspondente. Nenhum registro é criado;
nenhuma pessoa fictícia entra no grafo. Quando o lugar natural está ocupado, o
slot procura o próximo espaço livre em vez de sumir.

## 4. Limites de escopo (Constituição)

A árvore **mostra e leva**; não gere. Em particular:

* documento pertence ao Sistema Documental (Documento Mestre, Necessidade
  Documental, Documento do Processo, Pasta Documental);
* a aba "Fontes" da página da pessoa LISTA exigências oficiais e leva à Pasta
  Documental — não cria, não versiona, não aprova;
* não existe aba "Recordações": não há módulo oficial de mídia de pessoa, e
  criar um só para imitar o nome da referência seria inventar domínio;
* "Colaborar" foi mapeado para **Auditoria**, que é o que o Discovery tem.

## 5. Linha do tempo e mapa

A referência põe um mapa ao lado da linha do tempo. Aqui não há mapa desenhado,
e isso é deliberado: o Discovery não guarda coordenada de evento. Desenhar um
pino exigiria geocodificar o texto do lugar em silêncio, e o resultado seria
lido como dado conferido. O painel "Lugares" lista as localidades reais,
agrupadas por contenção literal de segmentos (`"Caxias do Sul"` ⊂
`"Caxias do Sul, RS"`), e explica na tela por que não há mapa.

## 6. Testes

```
npm run test:arvore          # motor, navegação, regra do casal, guarda, escala
npm run test:arvore-casal    # só a regra absoluta do casal
npm run dev                  # em outro terminal
npm run test:arvore-visual   # 20 cenários, comparação por pixel
npm run test:arvore-visual:aprovar   # regrava as referências
```

As referências aprovadas vivem em `tests/visual/arvore/` (versionadas). As fotos
reprovadas caem em `capturas/arvore/falhas/`, que é descartável.

A superfície fotografada é `/arvore-render`, com fixtures fixas e sem banco —
mesma entrada, mesmo desenho, sempre. Parâmetros: `caso`, `vista`, `gaveta`,
`pais`.
