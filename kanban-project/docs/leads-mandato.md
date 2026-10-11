# MANDATO — Leads (agente de primeiro atendimento no WhatsApp + tela de Leads)

Proposto em 10/10/2026, a partir das decisões do dono do produto na conversa de construção do agente
(mesma data). **Ainda não aprovado por inteiro**: a regra marcada com **[CONFIRMAR]** é proposta e precisa
do OK dele antes do Bloco 2. Protótipo: `docs/leads-prototipo.html`. Passo 0: `docs/leads-passo-0.md`.
Este documento é a especificação. Qualquer divergência: perguntar, não decidir.

## 1. O que é

Um número de WhatsApp só para leads novos, ligado direto à API oficial da Meta (sem plataforma parceira e
sem aplicativo no celular). Um **agente de IA** faz o primeiro atendimento: recebe a pessoa e levanta a
linhagem até onde ela sabe contar. Quando termina, ou quando o assunto não é dele, a conversa passa para o
**Marco**, que lê e responde pela tela **Leads** do sistema.

Não é plataforma separada: o recebimento do WhatsApp, o agente e a tela rodam dentro deste sistema, na
mesma hospedagem e no mesmo banco. Motivo: custo zero de infraestrutura nova.

## 2. Regras de negócio (decididas pelo dono do produto)

1. **Quem o agente atende:** só leads novos. O número é exclusivo de leads; clientes com processo não
   escrevem nele.
2. **Nome e jeito:** o agente se chama **Marco** e escreve como o Marco atende: cordial, direto, curto,
   sem cara de robô. A abertura é sempre três mensagens separadas: "Olá, boa tarde. Tudo bem?" /
   "Meu nome é Marco, prazer." / "Como posso ajudar?" (o cumprimento segue a hora).
3. **Obrigação do agente:** só o trabalho inicial e o levantamento da genealogia. **Nada mais.** Valores,
   forma de pagamento, parcelamento e garantia são do atendente humano.
4. **Texto das instruções:** é o texto aprovado na página de teste em 10/10/2026 (versão 17). Vive em um
   único arquivo do sistema (§7). Mudar o jeito de o agente atender = mudar esse arquivo; nenhuma regra de
   conversa fica espalhada no código.
5. **Países:** Itália (sem limite de geração, via judicial), Alemanha (sem limite de geração) e Portugal
   (filhos e netos; bisneto só com o pai ou a mãe, neto do português, vivo). Qualquer outro país, visto ou
   mudança de país: passa para o atendente na hora.
6. **Quando o agente passa a conversa com a triagem feita:** assim que souber o país, a linhagem até onde
   a pessoa sabe, o nome dela e se mais alguém tem interesse. A resposta é uma mensagem só, exatamente:
   **"Um momento, vou iniciar a sua busca genealógica para verificar o que consigo localizar."**
7. **Quando o agente passa antes disso** (resposta: só "Um momento, por favor."): outro país ou visto;
   pediu uma pessoa; perguntou se é robô, IA ou pessoa; insistiu em preço pela segunda vez; reclamou de
   verdade; já é cliente.
8. **O agente nunca diz que é robô, assistente virtual ou IA, e nunca afirma que é uma pessoa.** Se
   perguntarem, não responde à pergunta: passa para o atendente.
9. **Busca de registros:** o agente não pesquisa em site nenhum. Ele entrega a ficha e a lista de pessoas
   para pesquisar; a busca é feita por uma pessoa.
10. **Depois da passagem o agente se cala** naquela conversa. Quem responde é o Marco, pela tela de Leads.

## 3. Regras de funcionamento (decorrem das decisões acima e das regras do WhatsApp)

11. **Espera pelo fim da digitação:** o agente só responde depois de 6 segundos sem mensagem nova do lead,
    e responde tudo de uma vez. Se chegar mensagem enquanto a resposta é preparada, a resposta é refeita.
12. **Ritmo de pessoa:** marca a mensagem como lida, mostra "digitando…" e envia uma mensagem de cada vez.
13. **O que o agente não lê:** áudio, foto, documento e vídeo. Nesses casos responde "Um momento, por
    favor." e passa a conversa; o arquivo fica guardado nela para ser aberto pela tela.
14. **Se a IA falhar** (fora do ar ou resposta fora do formato duas vezes): "Um momento, por favor." e
    passa a conversa. O lead nunca fica sem resposta.
15. **Janela de 24 horas do WhatsApp:** só dá para responder até 24 horas depois da última mensagem do
    lead. Passou disso, a tela avisa e bloqueia o envio até ele escrever de novo.
16. **Pessoa respondeu, agente saiu:** se o Marco responde a um lead que ainda está com o agente, o agente
    para na hora (mesmo no meio de uma resposta) e a conversa passa a ser dele.
17. **Modo de teste:** enquanto a lista de telefones de teste estiver preenchida, o agente só responde a
    esses telefones e ignora todo o resto. É assim que a primeira conversa de verdade é feita.
18. **Desligado por padrão:** sem as chaves do WhatsApp configuradas, nada do módulo roda; o resto do
    sistema não muda.

## 4. Tela de Leads

19. **Quem vê e quem responde (decidido em 10/10/2026):** **somente o Marco.** Ninguém mais vê os leads
    nem responde. Não existe responsável por lead, distribuição nem passagem para outra pessoa.
20. **Permissão:** uma só, `leads.atender` (ver a tela, responder, devolver ao agente e encerrar). É
    **exclusiva** (`PERMISSOES_EXCLUSIVAS`): ser administrador não basta, ela só vale por concessão
    nominal no cadastro do usuário. Nasce concedida apenas ao usuário do Marco. O item "Leads" do menu só
    aparece para quem a tem.
21. **Situação do lead** (uma regra só, no servidor; a tela só desenha):
    - **Com o agente** — o agente está atendendo.
    - **Aguardando resposta** — já passou para o Marco e a última palavra foi do lead, ou ele ainda não
      respondeu.
    - **Respondido** — o Marco respondeu por último.
    - **Encerrado** — foi encerrado, com motivo.
22. **Lista:** filtros pelas quatro situações (abre em "Aguardando resposta") e busca por nome ou
    telefone. Cada linha: nome, última mensagem, hora, situação e país.
23. **Conversa:** todas as mensagens, com quem falou (lead, agente ou o nome de quem respondeu), campo de
    resposta e os arquivos que o lead mandou.
24. **Painel do lead:** o que o agente levantou (ficha), pessoas para pesquisar (com "Copiar para a
    pesquisa"), resumo e motivo da passagem.
25. **Devolver ao agente:** a conversa pode ser devolvida; o agente volta sabendo o que foi dito enquanto
    esteve fora.
26. **Encerrar [CONFIRMAR]:** exige motivo escrito. Lead encerrado que escreve de novo volta para o agente
    como conversa nova; o que já se sabia dele fica guardado.
27. **Aviso no sino:** quando um lead passa do agente para o Marco, e a cada mensagem nova de um lead que
    já está com ele. Um aviso só, com a contagem ("3 leads aguardando resposta"), que leva à lista
    filtrada. Recebe quem tem `leads.atender`.

## 5. O que o lead NÃO é

- **Lead não é Tarefa** (CLAUDE.md §1, §5): o grain é **LEAD**, um por telefone. Não entra em Torre,
  Operação, Minha Fila, Home nem em nenhum contador de tarefas.
- **Lead não é Processo, Contratante nem Requerente.** O módulo não escreve nessas tabelas.
- **Não há atribuição** no módulo: lead não tem responsável (regra 19). Nada do módulo chama as portas de
  atribuição de Tarefa (regra d do §41).
- **Aviso do sino não é fonte de verdade:** a situação do lead vem da conversa; o sino só aponta.

## 6. Fora deste mandato (blocos seguintes, cada um com decisão própria)

- Criar o processo a partir do lead (levar nome, país e linhagem para "Aguardando fechamento").
- Outras pessoas atendendo leads: responsável por lead, quem vê o quê e distribuição (manual, rodízio,
  por país, por carga). Hoje só o Marco atende (regra 19).
- Situações comerciais ("Conversa agendada", "Pronto para fechar") do primeiro protótipo.
- Puxar conversa depois das 24 horas (mensagem de modelo, que a Meta cobra).
- Enviar arquivo ou áudio pelo sistema. Neste mandato a resposta é só texto.
- Transcrição de áudio do lead.
- Trocar o modelo de IA por um mais barato (só depois de comparar as mesmas conversas).

## 7. Dados e código (migration SÓ ADITIVA)

**Duas tabelas novas, nenhuma alteração em tabela existente:**

- `LeadConversa` — uma por telefone (`telefone` único): nome no WhatsApp, estado (`AGENTE`, `EQUIPE`,
  `ENCERRADA`), motivo da passagem, ficha e linhagem (Json), resumo, contexto da IA (Json), datas (última
  mensagem do lead, última atividade, passagem, encerramento) e a trava de processamento
  (`processandoAte`).
- `LeadMensagem` — uma por mensagem: conversa, de quem (`LEAD`, `AGENTE`, `ATENDENTE`), autor (Usuario,
  quando a resposta é de uma pessoa), texto, identificador da Meta (`wamid`, único: é o que impede responder duas vezes a
  mesma mensagem), arquivo (id, tipo e nome na Meta) e a marca de "ainda não respondida pelo agente".

**Um dono de escrita** (CLAUDE.md §23): só `src/services/leads/` escreve nas duas tabelas.

- `src/services/leads/instrucoes.ts` — o texto das instruções do agente (regra 4).
- `src/services/leads/whatsapp.ts` — envio, "digitando", arquivos e conferência da assinatura da Meta.
- `src/services/leads/ia.ts` — chamada à IA (mesmo padrão de `visao-cliente.ts`: `fetch`, sem SDK).
- `src/services/leads/atendimento.ts` — a regra: receber, esperar, responder, passar, devolver, encerrar.
- `src/services/leads/situacao.ts` — a função única da situação do lead (regra 19) e de "pode responder".

**Rotas:**

- `GET|POST /api/whatsapp/webhook` — pública, caminho exato no `middleware.ts`. O `GET` confere a senha
  de verificação; o `POST` confere a assinatura da Meta, responde 200 na hora e continua depois da
  resposta (`after()`), sem segurar transação.
- `GET /api/cron/leads-retomar` — a cada 10 minutos, responde quem ficou sem resposta (rede de segurança).
  Com rastro, no `vercel.json`, no `middleware.ts` e na verificação CRON-006.
- `GET /api/leads`, `GET /api/leads/[id]`, `POST /api/leads/[id]/mensagens`,
  `POST /api/leads/[id]/devolver`, `POST /api/leads/[id]/encerrar`, `GET /api/leads/arquivo/[midiaId]` —
  todas com `leads.atender` conferida no servidor.

**Variáveis de ambiente** (nenhuma derruba o sistema quando falta): `WHATSAPP_TOKEN`,
`WHATSAPP_PHONE_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `LEADS_SO_ATENDER` (modo de teste),
`LEADS_MODELO` (padrão: Claude Sonnet 5.5). A IA usa a `ANTHROPIC_API_KEY` que o sistema já tem.

## 8. Segurança

- O webhook só aceita chamada com a assinatura da Meta válida (HMAC com a chave secreta do aplicativo).
- Nenhuma chave vai ao navegador: a tela fala só com as rotas `/api/leads`.
- O texto do lead é conversa, nunca instrução para o agente.
- O arquivo do lead é entregue pela rota do sistema, com permissão; o endereço da Meta nunca é exposto.
- A página `/leads` não é protegida pelo `middleware.ts`; a proteção real é `leads.atender` em cada rota.

## 9. Blocos

- **Bloco 1 — Motor (sem tela):** migration, serviços, webhook, cron e testes. Evidência: a Meta confirma
  o endereço e uma conversa completa é feita do celular do Marco em modo de teste, terminando na frase da
  busca genealógica, com a ficha gravada. (A evidência "no processo 651" do §35 não se aplica: lead não é
  processo. Nenhum processo é tocado.)
- **Bloco 2 — Tela de Leads:** permissão, menu, lista, conversa, resposta, devolver, encerrar, arquivos
  e aviso no sino.
- Só depois do Bloco 2 o modo de teste é desligado e um anúncio aponta para o número.

## 10. Testes e critério de aceite

Cada bloco entra com testes na suíte crítica (`scripts/ci/suite-critica.json`):

- duas mensagens seguidas viram uma pergunta só; mensagem repetida pela Meta é respondida uma vez;
- a frase da busca genealógica passa a conversa e o agente se cala;
- áudio, foto e documento passam a conversa e ficam guardados;
- IA fora do ar: "Um momento, por favor." e passagem;
- mensagem nova durante a resposta: a resposta velha é descartada;
- uma pessoa responde no meio da resposta do agente: o agente para;
- 24 horas vencidas: o envio é recusado com a explicação;
- assinatura falsa é recusada; sem as chaves, o webhook responde "não configurado" e nada grava;
- modo de teste ignora quem não está na lista;
- a situação do lead na lista, na conversa e no sino sai da mesma função;
- administrador sem a concessão nominal de `leads.atender` não vê o menu nem recebe dado das rotas;
- lead nunca aparece em contador de tarefas (Torre, Operação, Home).
