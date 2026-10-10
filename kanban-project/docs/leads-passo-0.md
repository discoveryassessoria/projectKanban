# PASSO 0 — Leads (levantamento, só leitura)

Feito em 10/10/2026 sobre o commit `12779f4` (main). Nada foi alterado no sistema para este
levantamento. Compara `docs/leads-mandato.md` com `docs/leads-prototipo.html` e com o que existe hoje.

## 1. Mandato × protótipo

Os dois dizem a mesma coisa. O protótipo desenha as regras 19 a 28 do mandato (situações, lista,
conversa, painel, responsável, devolver, encerrar, sino). O motor (regras 1 a 18) não tem tela.

Diferenças em relação ao **primeiro** protótipo de Leads (10/10/2026, no artefato de Design):

| Primeiro protótipo | Agora | Motivo |
| --- | --- | --- |
| Atendente continua pelo aplicativo do WhatsApp | Atendente responde pela tela de Leads | Número só na API não tem aplicativo |
| Situações "Conversa agendada", "Pronto para fechar", "Virou processo" | Fora do mandato (§6) | Dependem de decisão comercial e de "criar processo a partir do lead" |
| Aba "Distribuição dos leads" (manual, rodízio, país, carga) | Só manual (§6) | O modo automático ainda não foi escolhido |
| Atendentes de exemplo fixos | Usuários reais com `leads.atender` | — |

## 2. O que existe hoje em produção

- **Nada de WhatsApp nem de lead.** "whatsapp" aparece só como canal de solicitação a cartório
  (`CanalSolicitacaoDocumento`) e como botão de copiar mensagem. Não existe model `Lead`.
- `model Mensagem` já existe (chat do aplicativo do cliente, por processo). Por isso as tabelas novas se
  chamam `LeadConversa` e `LeadMensagem`.
- A fase "Aguardando fechamento" (`a_iniciar`) e o link de coleta (`ColetaLink`) são o passo seguinte ao
  lead. Este mandato não toca neles.

## 3. O que será reaproveitado

| Necessidade | O que já existe |
| --- | --- |
| Chamada à IA | Padrão de `src/lib/genealogia/importar-arvore/visao-cliente.ts` (`fetch` direto, tempo limite, sem SDK) e a `ANTHROPIC_API_KEY` |
| Rota pública que se confere sozinha | Precedente do link de coleta (`/api/coleta/`) e dos crons; lista `API_PUBLICA` do `middleware.ts` |
| Cron com rastro | `lib/operacional/cron-rastro.ts`, modelo `cron/coleta-purga` |
| Permissão em rota | `verificarPermissao` / `extrairUsuarioComPermissoes` (`src/lib/verificar-permissao.ts`) |
| Permissões e perfis | `PERMISSOES`, `MODULOS_PERMISSOES` (`src/lib/permissoes.ts`); sem migration (Json) |
| Menu lateral | `menuItems` em `src/components/bitrix-sidebar.tsx` + `itemDeMenuVisivel` |
| Tela lista + detalhe | Casca de `/torre` (`HeaderBarApp`, `api()` de `torre-base.tsx`, estilos `torre.css`) |
| Sino | Porta canônica `somarAoAviso` (`lib/operacional/notificacao-canonica.ts`), aviso agrupado |
| Seletor de pessoa | `ROTULO_ESCOLHA_DA_PESSOA` / `PESSOA_ESCOLHIDA_INICIAL` (`src/lib/ui/atribuicao.ts`) |
| Telefone | `src/lib/telefone/` |
| Teste com banco | `scripts/_banco-de-teste.ts` + suíte crítica |

## 4. O que falta criar

- 1 migration aditiva (2 tabelas, índices, 2 chaves estrangeiras para `Usuario`), declarada em
  `MIGRATIONS_POS_BASELINE` no mesmo commit.
- `src/services/leads/` (5 arquivos, §7 do mandato).
- 1 rota pública (`/api/whatsapp/webhook`), 1 cron (`/api/cron/leads-retomar`), 7 rotas `/api/leads`.
- Página `/leads` e componentes em `src/components/leads/`.
- 3 chaves de permissão e 1 bloco "Leads" em `MODULOS_PERMISSOES`.
- 1 tipo de aviso novo no sino (`TipoAviso`, `textoDoAviso`, `FatoSomavel`) e um resolvedor "todos os
  usuários com a permissão X", que hoje não existe.
- Testes na suíte crítica (§10 do mandato).

## 5. Riscos para os processos reais

**Risco para dados de processo: nenhum identificado.** O módulo não escreve em Processo, Pessoa, União,
Documento, Tarefa, Necessidade nem em tabela de cliente. A migration só cria tabelas.

Riscos do próprio módulo e do deploy:

1. **A migration só entra em produção com o deploy especial.** O build de produção para se houver
   migration pendente; alguém com acesso à Vercel precisa definir `MIGRATE_ON_BUILD=1` e
   `EU_CONFIRMO_ESCRITA_EM_PRODUCAO` para aquele deploy e remover depois
   (`scripts/migration-pendente-guard.mjs`). Enquanto isso não é feito, **nenhum** deploy de produção
   passa. Por isso a migration vai num PR só dela, combinado antes.
2. **Primeiro uso de `after()` no repositório.** Não há precedente de trabalho depois da resposta. A
   chamada do webhook pode durar até cerca de 60 segundos (espera, IA, envio com pausas). Mitigação:
   `maxDuration` declarado, nenhuma transação aberta durante as esperas, e o cron de retomada como rede
   de segurança.
3. **Conexões do banco.** O pool é de 5 conexões por instância (`lib/prisma.ts`). O webhook faz
   consultas curtas e solta a conexão entre elas.
4. **Rota pública nova.** `isApiPublica` casa por prefixo: a entrada será o caminho exato
   `/api/whatsapp/webhook`, nunca `/api/leads` nem `/api/whatsapp`.
5. **Gate de build.** Os testes rodam sem as variáveis do WhatsApp e da IA: nenhum arquivo do módulo pode
   falhar ao ser importado sem elas, e os testes usam WhatsApp e IA simulados.
6. **Guards que uma tela nova aciona:** seletor de pessoa (`seletores-sem-pessoa-preselecionada`),
   detector de "porta de atribuição" de Tarefa (`_regras-do-marco-codigo.ts`), `text-white` sobre fundo
   escuro, campos de data, e `select` obrigatório em toda consulta de `Usuario`. O responsável pelo lead
   usa rota e nomes próprios porque **não é** atribuição de Tarefa; se algum guard acusar, o caso entra na
   lista nominal com a justificativa, nunca é contornado.
7. **Sino.** Sem `processoId`, os avisos do mesmo tipo de um usuário viram um só. Para lead isso é o
   comportamento desejado (regra 27), mas exige o tipo e o texto próprios, senão sai como "Tarefas avulsas".
8. **Custo da IA.** Cada lead atendido custa cerca de 25 centavos de dólar com o modelo padrão
   (estimativa, não medição). O modo de teste limita o gasto enquanto o módulo não abre ao público.
9. **Divergência entre CLAUDE.md §41 e o teste de crons:** o §41 diz que cron novo sem rastro quebra
   `cron-rastro.test.ts`, mas o teste só percorre a lista `CRONS_COM_RASTRO`. O cron de leads entra na
   lista de qualquer forma.

## 6. O que depende de pessoa com acesso (não dá para fazer pelo código)

- Na Vercel: criar as variáveis do WhatsApp e, no deploy da migration, as duas de confirmação.
- Na Meta: token permanente (usuário do sistema), endereço do webhook e passar o aplicativo
  "Discovery Atendimento" de "In development" para "Live".
- Confirmar que a `ANTHROPIC_API_KEY` está configurada em produção.

## 7. Aguardando

OK do dono do produto para: (a) as regras **[CONFIRMAR]** da seção 4 do mandato; (b) começar o Bloco 1.
