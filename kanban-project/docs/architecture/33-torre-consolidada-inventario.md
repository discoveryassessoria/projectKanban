# Torre de Controle consolidada — inventário (06/10/2026)

Decisão do dono: **"nada responde duas vezes; eu olho a tela e vejo o que está acontecendo."**

## A Lei da Torre (regra fixa — também no CLAUDE.md §41)

- **L1** Cada informação aparece em UM lugar. Onde mais for necessária, é link para esse lugar, nunca cópia.
- **L2** Cada aba responde UMA pergunta, escrita no cabeçalho (`PERGUNTA_DA_ABA`, `PerguntaDaAba`).
- **L3** Todo número é a própria lista: clicar abre as linhas que o compõem, vindas da MESMA consulta.
- **L4** Só a aba Tarefas atribui responsável (por linha e em lote), sempre com confirmação explícita e origem no histórico.
- **L5** Estado de fase tem uma fonte só (barra de fases, Caminho do processo, Central e Torre leem dela).
- **L6** Bloco ou aba novo diz que pergunta responde e qual bloco existente substitui.

## As 5 abas

| Aba | Pergunta | O que mostra |
|---|---|---|
| Hoje | O que está pegando hoje? | Frase do dia (era o Briefing) · 6 números clicáveis (Atrasadas, Vencem hoje, Vencem amanhã, Sem responsável, Bloqueadas, Aguardando terceiros há tempo demais) · decisões do dia como linhas com link. **Nenhum botão de ação.** |
| Tarefas | Quem faz o quê? | Todas as tarefas abertas, de todas as fases e famílias, agrupadas por família, ordem fixa das certidões (§38). Visões, filtros, lote, gaveta, Feito, transversal. **Único lugar que atribui** (confirmação 428 → `confirmado`+assinatura) e que remove responsável. |
| Famílias | Como está cada família? | Lista por fase (Saúde da fase, passos das certidões, filtros incl. Bola) ⇄ Matriz família × fases (o antigo Radar). Página do processo: Caminho (fonte única de fase), cartões, Decisões do processo, **a tabela da aba Tarefas filtrada pelo processo**, canceladas, fatos, comentários. |
| Equipe | A equipe dá conta? | Carga, aptidão, ausência, previsão. Distribuir / Redistribuir / Mover carteira / Aplicar saída são **proposta** com prévia (428) e só gravam após confirmação. |
| Terceiros | O que estamos esperando de fora? | Cartões por tipo de terceiro, **órgãos** que nos devem resposta (com "Cobrar este órgão" e link para os pedidos em Tarefas), régua de cobrança por órgão. |

## Onde cada coisa estava e onde está

| Antes | Pergunta | Agora |
|---|---|---|
| Visão geral › cartões Situação/Agenda | O que está pegando? | **Hoje** (6 números); o resto vira link/filtro de Tarefas |
| Visão geral › Frase do dia / Briefing do dia (modal) | Como está o dia? | **Hoje** (frase) |
| Visão geral › Funil por fase | Onde os processos se acumulam? | Some (os números repetiam a Saúde da fase); a Saúde da fase e os passos moram em **Famílias** |
| Visão geral › "As 5 palavras" | vocabulário | Some (texto fixo) |
| Precisa de você (aba + embutido + Revisar o dia) | Que decisões só o gestor resolve? | Lista em **Hoje** (linhas com link); as ações que não são atribuição foram para **Decisões deste processo** (página do processo); atribuição → link "Atribuir na Torre"; "Revisar o dia" saiu |
| Radar | Em que fase cada família está? | **Famílias**, vista "Matriz" (alternador); o filtro de bola vira filtro da lista |
| Processos | Como está cada família? | **Famílias**, vista "Lista" |
| Minha operação (aba da Torre) | Minha fila | Só em **/operacao** (sem redirecionar o admin); menu "Operação" para todos |
| Tarefas | Quem faz o quê? | **Tarefas** (inalterada) |
| Equipe › Distribuir/Redistribuir/Mover/Aplicar saída (gravavam direto) | A equipe dá conta? | **Equipe**, como proposta com prévia e confirmação |
| Terceiros › lista por pedido/tarefa | O que esperamos de fora? | **Terceiros** lista **órgãos**; pedidos ficam em Tarefas (visão "Aguardando terceiros") |
| Página do processo › tabela "Certidões da fase atual" | — | Componente da aba Tarefas (`TorreTarefas`) filtrado pelo processo |
| Atribuir na Central Operacional, gaveta da certidão, Operação, tabela-família, processo-expandido, `/operacao/distribuicao`, `/tarefas` | — | Removido: responsável + link "Atribuir na Torre"; as duas rotas redirecionam para a aba Tarefas |
| Menu "Tarefas e Projetos" e "Distribuição" | — | Saíram do menu |

## Números que mudaram (L3)

- **Aguardando terceiros** = todo pedido com a bola com terceiro, com ou sem responsável (antes 9 na aba Tarefas × 10 em Terceiros). O KPI `cartorio` (partição "Sem responsável + Aguardando + Com a equipe") continua só com responsável.
- **Canceladas**: UMA consulta (`listarCanceladasDaTorre`) para a aba Tarefas e para a página do processo. Certidões inativas **sem tarefa** (a árvore deixou de exigir) aparecem à parte, nunca somadas.
- **Próxima ação / Distribuir as N / Abertas / Sem responsável / cartões**: todos da lista de tarefas abertas do processo (todas as fases; fase mais antiga primeiro).

## Testes
`scripts/torre-lei-duplicidade-e-contadores.test.ts` (duplicidade + L3 com dados semeados), `scripts/atribuir-so-na-torre.test.ts` (L4), `scripts/regras-fixas-integridade.test.ts`.
