# MANDATO TORRE DE CONTROLE — Blocos E a J (especificação completa)

Fonte da verdade visual: `docs/torre-controle-prototipo.html`.
Fonte da verdade de regras: este documento + o mandato original A–J + ADENDO DE FIDELIDADE + decisões do inventário.
Blocos A–D já estão em produção e conferidos (fila da equipe, cobranças/escalada, órgão na tarefa, repactuação). Não refazer.

---

## 0. REGRAS INEGOCIÁVEIS

1. **Fidelidade:** a tela é IDÊNTICA ao protótipo: mesma estrutura, textos, ordem, abas, colunas, cores de risco, botões, toasts e "Desfazer". Dado sem fonte = CRIAR a fonte. Nunca remover elemento.
2. **Nada de dado de exemplo em produção.** No protótipo, as famílias Álvarez Pérez, Fogli, Panza, Alonso Puigdomenech e Medina Olivares, as tarefas 9101–9501, os tempos de cartório fixos, "124 verificações", "9,9 / 2,1", as tendências ("▲ +1 vs semana passada") e a auditoria semeada são ilustração. Tudo vem do banco. Se não houver dado, mostra o estado vazio do protótipo ("Nada depende de você agora.", "sem histórico · régua N d" etc.).
3. **Nomes nunca fixos no código.** "Atribuir a Gabriel", "Atribuir a Daniela", "Marco Rovatti", "Daniela 15 · Gabriel 12 · Marco 8" são exemplos. O botão mostra o nome da pessoa SUGERIDA pela regra (ex.: "Atribuir a {sugerido}"). Limites, aptidões e régua vêm do cadastro.
4. **O prazo NUNCA pausa por culpa de terceiro** (cartório, tradutor, órgão, juiz, cliente). `slaPausadoEm` continua sem uso. Bloqueio mostra o motivo e "O prazo continua contando."
5. **Uma fonte por dado:** a Torre lê as MESMAS projeções da Operação (estadoOperacao, esperandoDe/Desde/HaDias, totalCobrancas, cobrancasSemResposta, escalada, acompanhamentoVencido, repactuacoes, orgao, passoAtual etc.). Nada recalculado na tela. Integridade = o mesmo motor do painel de Saúde.
6. **Toda ação que muda estado grava LogAuditoria** (autor, ação, alvo, justificativa) e aparece na aba Auditoria. Repactuar, bloquear e reabrir passo exigem justificativa obrigatória.
7. **Processos REAIS em produção** (675 Antão, 676 Salvarani): sem script em massa, migrations só aditivas, e se quebrar, reverter primeiro. Testes e evidências no 651 Cibils (família de teste).
8. **Nome de fase/passo nunca por literal no código:** use o cadastro (Gerenciamento).
9. **Auto-atribuição (regra r1) implementada com o toggle DESLIGADO.**
10. **Acesso:** Torre só para perfil Administrador/gerência operacional ("Acesso: Administrador · gerência operacional").

---

## BLOCO E — Fontes de dados novas (backend; sem tela ainda)

Criar as fontes que o protótipo exige e que ainda não existem. Para cada uma: modelo, migração aditiva, endpoint, teste e auditoria.

E1. **Capacidade Operacional por pessoa** (cadastro no Gerenciamento): limite de tarefas ativas, aptidões (país × fase), papel. Capacidade medida = tarefas concluídas por semana (média real das últimas 4 semanas). Fila em semanas = ativas ÷ capacidade.
E2. **Ausência:** período (de/até) + sucessor. Durante a ausência, a carteira vai para o sucessor apto de menor carga e volta no retorno (regra r4). Auditado.
E3. **Bloqueio com motivo:** motivo (texto obrigatório), quem desbloqueia (ex.: financeiro/cliente), quando, por quem. Tarefa bloqueada aparece com a bola "Bloqueada". Prazo continua contando.
E4. **Comentários por tarefa e por família** com @menção a usuário. A menção gera notificação para a pessoa. Autor e data. Auditado.
E5. **Reabrir passo** com justificativa obrigatória. Volta o passo concluído para execução, pelo motor, sem editar direto.
E6. **Prioridade** da tarefa (Baixa/Média/Alta), alterável individualmente e em lote.
E7. **Visões salvas:** filtro + agrupamento + nome, compartilháveis com a equipe ("Salvar visão").
E8. **Histórico por cartório/órgão:** tempo aprendido = mediana e pior caso (dias entre envio e recebimento) com n. Com menos de 3 pedidos concluídos, usa a régua do Gerenciamento ("sem histórico · régua N d"). Contador de "registro não localizado" por órgão. Canal de contato do órgão (e-mail, telefone, correio registrado) e troca de canal gravada na solicitação.
E9. **Métricas de processo:** progresso real = certidões recebidas ÷ requeridas; dias na fase (pela data real de entrada na fase no log de transição); próximo marco (texto derivado do estado real, ex.: "17 pedidos ao cartório; 6 enviados, 11 a enviar").
E10. **Série diária de indicadores** (snapshot 1×/dia) para a tendência "vs semana passada" dos 8 KPIs. Backlog: tarefas abertas por semana vs fechadas por semana.
E11. **Tempo médio real por fase** (por processo e geral), a partir do log de transição.

Entrega do E: endpoints + testes + evidência no 651. Nenhuma mudança visual.

---

## BLOCO F — Motor "Precisa de você" (backend)

Endpoint único que devolve a lista de decisões do Administrador, ordenada por score de risco (maior primeiro). Cada item: tipo, título, detalhe, sugestão do sistema, ação 1 e ação 2 (as duas executam de verdade, via endpoints existentes ou novos, com auditoria).

Score por tarefa (como no protótipo): sem dono +3; vencida (prazo < hoje) +3 com "atraso nosso"; cobranças sem resposta ≥ 2 +2; tarefa em fase que o processo deixou +3; divergência entre fontes +3; bloqueada +2. Faixas: ≥ 6 crítico, ≥ 3 atenção, senão ok.

Tipos (textos e botões iguais ao protótipo):
- **Fase deixada:** tarefa aberta em fase anterior à atual do processo. Ações: "Atribuir a {sugerido}" / "Encerrar (não devida)" (encerrar com justificativa, auditado).
- **Divergência:** estado da tarefa diferente entre Tarefa/Central/Relatório. Ações: "Reconciliar" (endpoint Reconciliar do inventário) / "Ver 3 fontes".
- **Sem dono:** sugestão calculada pela regra de atribuição (apto → menos ativas → empate pelos últimos 30 d → ausente vai para o sucessor), com o motivo ("0 ativas, apto a Espanha…"). Ações: "Atribuir a {sugerido}" / "Escolher outro".
- **Escalada:** ≥ 2 cobranças sem resposta. Ações: "Registrar ligação" / "Trocar canal".
- **Bloqueada:** ações "Cobrar cliente" (= Mensagem no chat do processo, decisão do inventário) / "Desbloquear".
- **Carga:** pessoa no limite (ativas ≥ limite do cadastro). Ações: "Redistribuir N" (move as "a enviar" aptas para quem tem carga menor) / "Ver equipe".
- **Parede à frente:** processo que vai entrar numa fase sem passos executáveis (achados CAD-012/WF-004 do painel de Saúde). Ações: "Abrir Gerenciamento" / "Ignorar 7 d".

Também no F:
- **Briefing do dia:** texto gerado a partir dos números reais (mesma estrutura da frase do protótipo), abre ao entrar e pelo botão "☀ Briefing do dia".
- **Revisar o dia:** percorre as decisões uma a uma ("Revisar o dia · X de N"), com botões ação 1 / ação 2 / "Pular" e resumo final ("Decisões tomadas: …").
- **Desfazer:** toda atribuição (individual ou em lote) pode ser desfeita pelo toast por alguns segundos; o desfazer também é auditado.

---

## BLOCO G — Ações sobre tarefas (backend + endpoints; usados pela Torre e pela Operação)

- **Lote:** atribuir a {pessoa}, prioridade alta, repactuar prazo (uma justificativa única para todas), cobrar cartório. Barra "N sel." + "Limpar".
- **Ação rápida por linha:** "Atribuir" (sem dono) / "Cobrar" (aguardando terceiro) / "Iniciar" (não iniciada, executa o passo de envio pelo motor).
- **Cobrar todos os vencidos (N):** cobra todas as solicitações com acompanhamento vencido pelo canal cadastrado.
- **Cobrar por cartório** e **Contatos** (histórico de contatos registrados com o órgão).
- **Registrar ligação**, **Trocar canal** (gravado na solicitação).
- **Painel espelhado da tarefa** (drawer): bola com / prazo da tarefa / próximo acompanhamento / responsável; passos 1/4…4/4 com o atual destacado; ação principal pelo motor; "Atribuir a {sugerido}", "Repactuar prazo", "Bloquear com motivo", "Reabrir passo". Mesmo painel real do processo (Workflow / Dados registrais / Andamento / Anexos).

Todas reutilizam os endpoints de A–D quando já existem. Nada duplicado.

---

## BLOCO H — Equipe e Regras

**Aba Equipe:** por pessoa: nome, papel, aptidões, status de ausência; Carga (barra "ativas de limite · fecha N/sem", verde < 70%, âmbar ≥ 70%, vermelho ≥ 100%); Ativas; Atrasadas; Aguard.; Fila (semanas: ≥ 2 vermelho, ≥ 1 âmbar, senão "livre"); ações "Marcar ausência/Cancelar ausência", "Mover carteira", "Simular saída" (mostra o impacto antes, com "Aplicar"/"Fechar").
**Previsão de carga, próximas 4 semanas:** vencimentos por pessoa por semana, com a escala de cor do protótipo e as datas das semanas calculadas a partir de hoje.

**Aba Regras** (tudo gravado no Gerenciamento; a Torre abre a porta e permite simular antes de ativar):
- r1 Atribuição automática por país e fase (DESLIGADA por padrão).
- r2 Régua de cobrança (texto lido do cadastro real: diasAposCobranca, escalarApos, esperas dos passos; NÃO usar os números do protótipo).
- r3 Limite de carga por pessoa (do cadastro E1; ao atingir, a nova tarefa vai para "Precisa de você").
- r4 Ausência redireciona carteira.
- r5 Tempo por cartório aprendido (após 3 pedidos concluídos, previsão pela mediana do cartório).
Cada regra: status ativa/inativa, "Simular" (resultado calculado com os dados reais de hoje) e "Ativar/Desativar". Tudo auditado.

---

## BLOCO I — Integridade, Auditoria, Foco e Relatório

- **Aba Integridade:** achados do MESMO motor do painel de Saúde (não criar outro), com gravidade, achado, efeito e ação de correção ao lado; "Ignorar 7 d"; "Rodar diagnóstico agora". Frase: "O sistema se vigia. Meta: divergências = 0."
- **Aba Auditoria:** LogAuditoria de processo e tarefa (quando, autor, ação, alvo, justificativa), com "Exportar CSV" (download pelo sistema).
- **Foco da família** (abre ao clicar numa família no Radar ou em Processos): cabeçalho (família · país · código; fase · X de Y certidões recebidas), 4 números (abertas, vencidas, com o cartório, sem responsável), tabela (Certidão, Cartório, Bola com, Prazo, Responsável), Linha do tempo real, Comentários com @menção (E4) e botão "Relatório de controle".
- **Relatório de controle** = o relatório por família filtrado (decisão do inventário), versão interna.

---

## BLOCO J — A tela da Torre

- Rota própria, item "Torre de Controle" no menu entre Operação e Calendário, visível só para Administrador.
- Cabeçalho: data por extenso · usuário · perfil · "fonte: projeção da Operação"; filtro de nacionalidade (Todas/Espanha/Itália/Alemanha/Portugal, dos países cadastrados); busca; "☀ Briefing do dia"; "▶ Revisar o dia (N)".
- **8 KPIs clicáveis** (filtram a aba Tarefas; "Filtro: X ✕"): Atrasadas, Vencem em 7 dias, Sem responsável, Com o cartório, Cobranças vencidas, Escaladas pra mim, Processos em risco, Backlog abre/fecha por semana, cada um com a tendência real (E10).
- **9 abas com contadores:** Precisa de você (F), Radar, Tarefas, Equipe (H), Processos, Terceiros, Regras (H), Integridade (I), Auditoria (I).
- **Radar:** família × fase (as 9 fases do cadastro); a célula da fase atual mostra de quem é a bola e há quantos dias; cor = risco; legenda "no ritmo / atenção / crítico / fase atual"; clique abre o Foco.
- **Tarefas:** agrupar por Família/Responsável/Cartório/Fase/Sem agrupamento; visões (Todas as abertas, Vencidas, Sem responsável, Com o cartório, visões salvas); colunas Certidão·pessoa, Bola com, Etapa, Responsável, Prazo, Acomp., Risco, Abrir + ação rápida; seleção por grupo e por linha; barra de lote (G).
- **Processos:** Família, Fase, Progresso real, Dias na fase, Bola com, Risco, Próximo marco, Foco, Relatório.
- **Terceiros:** Cartório/órgão (UF · canal), Em aberto, Sem resposta (dias), Tempo aprendido, Não localizada, Próx. cobrança, Cobrar, Contatos; "Cobrar todos os vencidos (N)"; "Tempo médio real por fase" (E11) e backlog.
- **Absorção:** "Tarefas e Projetos" e "Distribuição" passam a redirecionar para a Torre (aba correspondente). Nada é apagado.
- **J.0:** antes da troca, snapshot de atribuições e estados; reatribuições da migração auditadas.
- Tema, fontes, cores de risco (vermelho/âmbar/azul/cinza/verde) e responsividade iguais ao protótipo.

---

## ORDEM E ENTREGA

PASSO 0 (antes de codar, só leitura): compare este documento com o texto do mandato original A–J e com o protótipo. Liste (a) o que o mandato original pede e não está aqui, (b) o que está aqui e já existe em produção (reaproveitar), (c) o que falta criar por bloco, e (d) os riscos para os processos reais. Aguarde OK.

Depois: E → F → G → H → I → J, um bloco por vez. Em cada bloco:
1. Implementar + testes automatizados.
2. Commit + deploy em produção.
3. Evidência real no 651: endpoint, resposta e o que aparece na tela.
4. Relatório: hash, id do deploy, evidência e o que conferir.
5. PARAR e aguardar "próximo".

Ao fim do J: URL da Torre + checklist item por item do protótipo (elemento → fonte do dado → como testar).

---

## Decisões do Passo 0 (29/09)

Valem sobre o texto deste mandato E JUNTO sobre o protótipo (`docs/torre-controle-prototipo.html`) sempre que os dois divergirem do que segue.

1. **E8 removido.** Não existe "tempo aprendido por cartório" — nunca dá para estipular prazo de cartório. A coluna "Tempo aprendido" da aba Terceiros vira **"Régua"** e mostra só a régua do Gerenciamento. A regra r5 sai da aba Regras. Nenhuma mediana/pior-caso em lugar nenhum.
2. **r4 (ausência redireciona carteira) não existe.** Ausência é só registro (E2, com sucessor sugerido). Mover tarefas é ação manual do gestor ("Mover carteira"), auditada — nunca automática.
3. **Item "Torre de Controle" no menu só no Bloco J.** Até lá, "Distribuição" e "Tarefas e Projetos" continuam exatamente como estão.
4. **Score do "Precisa de você" = exatamente o do protótipo** (não o texto original do Bloco F): sem dono +3, vencida +4, acompanhamento vencido +2, 2+ cobranças sem resposta +2, fase deixada +3, divergência +3, bloqueada +2, fase Apostilamento/Retificação +1 (baseline). Faixas: ≥6 crítico, ≥3 atenção, senão ok.
5. **KPI "Backlog" não filtra a lista** (é agregado, abre/fecha por semana) — os outros 7 KPIs filtram a aba Tarefas normalmente.
6. **Toast/Desfazer: 6 segundos** (igual ao protótipo).
7. **Rótulo de tarefa não iniciada sem prazo: "Iniciar até DD/MM"** — o mesmo da Operação (`tempo-operacional.ts`), nunca "nasce no envio" (texto do protótipo, descartado por conflitar com a régua única já em produção).
8. **"Cobrar" na aba Terceiros** cobra só o cartório daquela linha — criar endpoint de cobrança por órgão (o existente, `cobrar-todos-vencidos`, cobra tudo, sem filtro por órgão).
9. **Auditoria mostra só o que o sistema grava de verdade.** As linhas semeadas no protótipo (inclusive a de "retrocesso... instâncias supersedidas", que o código real de `retrocesso-de-fase.ts` nunca produz) eram ilustração — nunca replicar esse texto como se fosse real.
10. **#3827 (Atahualpa, Cibils/651) é a tarefa real** por trás do exemplo "Fase deixada" do protótipo — serve de caso de teste real do Bloco F, decisão de atribuição fica para o usuário quando o Bloco F estiver no ar.
11. **Cores: tokens do Discovery Design System**, mantendo o significado (vermelho/âmbar/azul/cinza/verde) e os mesmos estados do protótipo — nunca a paleta própria do HTML do protótipo.
