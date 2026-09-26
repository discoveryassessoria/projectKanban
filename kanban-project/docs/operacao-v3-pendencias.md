# Operação v3 — pendências conhecidas (não são bugs, são simplificações declaradas)

**Data:** 26/09/2026
**Contexto:** fechamento em 4 etapas (A–D) do hotfix "régua antiga" da família Cibils — ver histórico de commits de 26/09/2026 em `lib/operacional/tarefa-projecoes.ts`, `src/services/criar-processo.ts`, `src/app/api/operacao/tarefas/*`, `src/components/operacao/operacao-v3*.tsx`. Este documento lista o que a tela mostra que **não é dado real ainda** — pra não ser redescoberto como "bug" numa investigação futura.

## 1. Radar — 4 dos 9 cards são fixos em 0 (não 3)

`AbaRadar` (`src/components/operacao/operacao-v3-abas.tsx`, ~linhas 380-394) tem 9 cards. 5 são reais (leem `LinhaOperacaoV3` de verdade): Tarefas atrasadas, Acompanhamentos vencidos, Escaladas ao gestor, Sem órgão emissor, Pendência de fase anterior. **4 são hardcoded** — sempre verdes, sempre `0`, `onClick` aponta pra `onNaoLigado` (um handler que não faz nada além de admitir que não está ligado):

| card | por quê está em 0 | dá pra ligar com o dado que já existe? |
|---|---|---|
| Sem responsável | nenhuma checagem automática ainda | **sim, é o único dos 4 que é fácil** — `whereGerencial` já suporta `semResponsavel`, `facetasGerenciais` já agrupa por `responsavelId`. Só falta expor a contagem no escopo da Operação e ligar o card. |
| Dados inconsistentes | sem checagem automática — não existe hoje nenhum motor que valide consistência de cadastro pra reportar aqui | não, precisa de um motor de checagem que não existe |
| Anexo faltando | "recebida sem arquivo" — não existe hoje nenhuma leitura de anexo/arquivo cruzada com status da subtarefa | não, precisa desenhar o que "anexo" significa aqui primeiro |
| Erro do sistema | ex.: "lista não carregou (500)" — não existe hoje nenhum canal de erro operacional agregado por família/fila | não, precisa de instrumentação de erro que não existe |

Se algum desses 4 aparecer "quebrado" numa investigação futura (sempre 0, nunca muda), não é regressão — nunca foi ligado.

## 2. "Próximo marco" é uma string fixa, igual pra toda família

`AbaFamilias` (`operacao-v3-abas.tsx`, linha ~297):

```tsx
<div>Gargalo: <b>{f.gargalo}</b> · Próximo marco: <b>Análise documental</b></div>
```

`Gargalo` é real (calculado de `escalada`/`terceiroNome`/`aIniciar` das linhas da família). **"Análise documental" é um literal** — toda família mostra o mesmo texto, sem relação com a fase real dela. Não existe hoje uma função que derive "próximo marco" a partir do Workflow Macro/fase atual do processo; precisaria ler `resolverMacroWorkflowDoProcesso`/`primeiraFasePorOrdem` e mapear a PRÓXIMA fase depois da atual pra um rótulo — não foi feito neste fechamento.

Achado adicional (mesmo bloco, não pedido neste mandato, registrado por transparência): o botão **"Abrir processo"** (linha ~281) também está em `onClick={onNaoLigado}` — botão morto, não navega pra lugar nenhum ainda.

## 3. "Por que aqui" é uma aproximação, não a razão genealógica fina

`porQueAquiDe()` (`operacao-v3-derivacoes.ts`) — o protótipo original mostra a razão genealógica fina por pessoa (linha reta / colateral / requerente). A API não expõe isso hoje. A aproximação real:

```
TRANSVERSAL → "Transversal"
genealogia → "Trava a família"
numeroLinhagem != null → linhaReta ? "Linha reta · GN" : "Cônjuge · GN"   (corrigido 26/09/2026 — antes só olhava numeroLinhagem)
senão → nome do serviço, ou "—"
```

Isso cobre linha reta vs. cônjuge corretamente (fix deste fechamento), mas **não distingue colateral de requerente** — as duas caem no fallback de `numeroLinhagem`. Se precisar dessa granularidade, precisa de um campo novo na projeção (`Pessoa`/`Uniao` não carregam hoje "colateral"/"requerente" como conceito explícito e consultável em lote).

## O que este fechamento (Etapas A-D) resolveu de verdade

- **Etapa A**: `criarProcessoV2` materializa subtarefas do 1º passo na criação — fecha o gap que causou o hotfix inteiro.
- **Etapa B**: `/api/operacao/tarefas` — menos idas sequenciais ao banco (paralelização), índices que faltavam em `Tarefa`.
- **Etapa C**: os 3 endpoints de lote (iniciar/vincular-órgão/cobrar-todos-vencidos) com teste cobrindo o comportamento real.
- **Etapa D**: Genealogia sem Documento não abre mais um drawer quebrado — vai pra Árvore do processo.

Nada listado neste documento bloqueia o uso da tela — são simplificações conscientes da Etapa 3 original, mantidas conscientemente neste fechamento por não terem sido pedidas.
