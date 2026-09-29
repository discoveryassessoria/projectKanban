# 32 — Torre de Controle

Mandato "Torre de Controle" (29/09/2026): tela única de Administrador que substitui
`/tarefas` (Tarefas e Projetos) e `/operacao/distribuicao` (Distribuição). Executado em
blocos, na ordem, cada um com implementar → testar → push → deploy confirmado →
evidência real. Este documento cresce um bloco por vez — nunca reescrito, só
apensado.

Referência de tela (protótipo estático, fiel pixel a pixel — não recriar o motor
dele): `docs/torre-controle-prototipo.html`.

## Bloco A — Escopo de equipe na API (29/09/2026)

`GET /api/operacao/tarefas` ganhou `escopo=equipe`, para as 4 visões que já existiam
(`minha_fila`, `sem_responsavel`, `acompanhamento`, `feito`).

- **Quem pode**: `usuario.tipo === 'admin'` OU a permissão `operacao.distribuirTarefas`
  (já existia — "ser responsável por distribuir tarefas sem responsável" já É a
  definição de gestor operacional; reaproveitada, não criada permissão nova).
  Qualquer outro perfil que mande `escopo=equipe`: o parâmetro é ignorado, a resposta
  vem com `escopo:"individual"` — nunca um 403 por um parâmetro de mais.
- **O que muda**: em vez de forçar `responsavelId = usuário do token`, a consulta passa
  `responsavelId = null` (ninguém) por padrão — o que, em `visaoGerencial`/
  `whereGerencial`, significa "todo mundo, com ou sem responsável" (ausência de filtro,
  não `= null` literal). Filtros opcionais, todos NOVOS em `FiltrosGerenciais`:
  `responsavelId` (uma pessoa dentro da equipe), `pais` (`Processo.paisCanonico.
  countryKey`, resolvido no `where.processo`), `faseMacroKey`, `processoId` (já
  existiam), `estadoOperacao` (`LinhaGerencial.estadoOperacao` é DERIVADO — nunca
  coluna do banco — filtra em memória depois de `enriquecerLinhas`, via
  `filtrarPorEstadoOperacao`).
- **Onde**: `lib/operacional/tarefa-projecoes.ts` — `minhaFila`/
  `acompanhamentoDoUsuario`/`concluidasRecentesDoUsuario` aceitam `usuarioId: number |
  null` (`null` = escopo de equipe); `semResponsavel` ganhou os mesmos filtros opcionais
  (reaproveitando `whereGerencial`, nunca uma segunda leitura de query). Nenhuma tabela
  nova, nenhuma migração.
- **Verificado ao vivo em produção** (processo 651/Cibils): chamada como Marco
  (admin) com `escopo=equipe&processoId=651` devolve as 19 tarefas do processo,
  incluindo as 5 de Daniela (#3853/#3861/#3863/#3865/#3867, `responsavelNome:"Daniela
  Brait"`) e as 3 sem responsável (#3827/#3845/#3906). `responsavelId=12` (Daniela)
  dentro do escopo de equipe recorta para as 15 dela. Chamada como Daniela (operador
  comum, sem `operacao.distribuirTarefas`) com o MESMO `escopo=equipe`: devolve
  `escopo:"individual"` e só as 15 tarefas dela — o parâmetro foi corretamente
  ignorado.
