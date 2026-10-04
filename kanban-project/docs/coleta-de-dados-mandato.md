# MANDATO — Link de coleta de dados do cliente (pré-cadastro do processo)

Aprovado pelo dono do produto em 03/10/2026 (conversa de PASSO 0, CLAUDE.md §35). Este documento é a
especificação. Qualquer divergência: perguntar, não decidir.

## 1. O que é

Um link público, **por processo**, que o cliente abre sem login para enviar os próprios dados (e os de
familiares) e anexar documentos. O que ele envia **não entra no cadastro de clientes**: fica como
**pré-cadastro do processo**, só para consulta, até a conferência feita pelo administrador quando o
processo é movido para Genealogia.

## 2. Regras de negócio (decididas)

1. **Escopo:** um link por processo. Só pode ser gerado com o processo em "Aguardando fechamento"
   (`a_iniciar`). Fora dela o botão fica desabilitado, com explicação.
2. **Pessoas:** várias por link (o cliente e os familiares). Cada pessoa informa o **papel**:
   requerente, contratante ou os dois.
3. **Campos (iguais aos do cadastro de cliente):** nome, CPF (obrigatório, com conferência dos dígitos),
   RG, data de nascimento, sexo, estado civil, nacionalidade, telefone (com seletor de país/DDI), e-mail,
   endereço completo (logradouro, número, complemento, bairro, cidade, estado, CEP, país). **Sem**
   passaporte e **sem** CRNM. **Sem** país/estado/cidade de nascimento (nenhuma das duas tabelas de cliente
   tem esses campos; só existem na `Pessoa` da árvore, onde o link não escreve).
4. **Documentos (opcionais para enviar):** **RG ou CNH** e **comprovante de endereço** (até 3 arquivos por
   tipo). A lista do processo mostra quem está sem documento.
5. **Consentimento:** caixa obrigatória; data, hora e versão do texto ficam gravadas no envio.
6. **Reenvio:** se a mesma pessoa reenviar com o **mesmo CPF** enquanto o link está ativo, o envio
   **pendente** é atualizado (não cria outro). Fica o contador/data de reenvios; arquivos anteriores não são
   apagados. A página pública **nunca** mostra dados já enviados.
7. **Pré-cadastro (enquanto "Aguardando fechamento"):** lista no processo, somente consulta, com
   contador, para o administrador montar o contrato. **Não existe botão "Aprovar" por pessoa.**
8. **Conferência (ao mover para Genealogia):** abre antes do movimento. O administrador escolhe quem
   entra e o papel de cada um. Os confirmados viram clientes vinculados ao processo; o link encerra.
   **Não existe fila depois disso**: quem entrar depois é cadastrado manualmente.
9. **"Seguir sem cadastrar ninguém":** pede confirmação dizendo quantos envios serão descartados.
10. **Expiração:** o link vale enquanto o processo está em `a_iniciar` e não foi encerrado. Sai de
    `a_iniciar` (qualquer porta) ⇒ encerrado. O administrador também pode **encerrar a qualquer momento**.
11. **Retenção:** dados e arquivos de envios **descartados** são apagados 30 dias após o encerramento do
    link; fica apenas o registro de que houve o envio (sem dado pessoal).
12. **Permissão:** gerar link, ver o pré-cadastro, conferir e encerrar = `clientes.criar`.
13. **Aviso:** só a lista no processo, com contador. Sem sino/notificação.

## 3. Como a conferência grava (duas tabelas de hoje)

`Contratante` e `Requerente` são duas tabelas sem chave comum além de `personId → Pessoa` (que a criação
pela tela não preenche). Decisão: **uma linha por papel, sem duplicar dentro de nenhuma tabela**.

- Requerente → cria ou **reaproveita** em `Requerente` + vínculo `ProcessoRequerente`.
- Contratante → cria ou **reaproveita** em `Contratante` + vínculo `ProcessoContratante`.
- Os dois → uma linha em cada tabela, criadas juntas a partir do mesmo envio. O envio guarda **os dois
  ids** (`requerenteId`, `contratanteId`) — servirá para unir quando existir o cadastro único.
- **CPF igual:** a busca é feita na tabela do papel (com e sem máscara). Existe ⇒ vincula o existente (com
  aviso antes de confirmar). Existe só na outra tabela ⇒ cria no papel novo (cópia dos dados, como já
  acontece hoje).
- **Nome igual com CPF diferente:** só avisa. A regra que hoje recusa nome idêntico **não trava** a
  conferência. (CPF igual segue a regra de reaproveitar.)
- **Nenhuma `Pessoa` é criada.** `vincularRequerente` é o único ponto que cria `Pessoa` para requerente.

## 4. Árvore

- A conferência **não** chama `vincularRequerente`, não toca árvore e não gera necessidade/tarefa.
  Cadastro no processo ≠ dentro da árvore.
- `vincularRequerente` entra depois, quando o usuário, na árvore, escolhe a pessoa em "requerentes
  disponíveis" (fluxo que já existe).
- Efeito conhecido: o evento financeiro `requerente.adicionado` (honorários) só dispara quando a pessoa
  entra na árvore — igual a quem entra hoje pelo cadastro do processo.

## 5. Fase: a porta única

Todas as portas que tiram o processo de `a_iniciar` passam por `executarPlano` (`phase-advance.ts`):
`advance`, `forceAdvance`, `movePhaseManual`, rotas `advance`, `advance/force`, `avancar-fase`, `fase`
(arrastar card), `phase/move`, Torre ("Precisa de você"). A regra mora ali:

- Saindo de `a_iniciar` com envios **PENDENTES** ⇒ rejeita com `CONFERENCIA_PENDENTE` (nada muda).
- A conferência resolve **todos** os pendentes (confirmado ou descartado) e então o movimento passa.
- Automação (cron, reconciliador, recalcular) **já não sai** de `a_iniciar` (`AVANCO_MANUAL_OBRIGATORIO`):
  não há caminho automático que precise de conferência. Scripts operacionais que movem processo recebem o
  erro `CONFERENCIA_PENDENTE` (falham alto).
- O erro **nunca** é silencioso: cada porta humana mostra a mensagem e abre o modal de conferência.

## 6. Segurança

- Código do link aleatório e longo (sem login); rotas públicas listadas uma a uma no middleware.
- Limite de envios por IP; limite de tamanho (10 MB), só imagem e PDF, no máximo 3 arquivos por tipo.
- **Arquivos privados:** prefixo `privado/coleta/` (mesmo padrão dos documentos gerados). Envio direto do
  navegador por URL assinada de curta duração; o banco guarda só a **chave**; leitura só por URL assinada
  emitida a quem tem `clientes.criar`.
- IP guardado só como hash. Toda ação do administrador grava `LogAuditoria`.

## 7. Dados (migration SÓ ADITIVA)

- `ColetaLink`: processo, código, criado por/em, encerrado em, motivo do encerramento.
- `ColetaEnvio`: link, CPF (só dígitos, para o reenvio), dados da pessoa (JSON), papel declarado,
  consentimento (em, versão), status (`PENDENTE` | `CONFIRMADO` | `DESCARTADO`), `requerenteId`,
  `contratanteId`, reenvios, decisão (por/em), purgado em.
- `ColetaArquivo`: envio, tipo (`IDENTIDADE` | `COMPROVANTE_ENDERECO`), chave privada, nome, tamanho, mime.

## 8. PENDÊNCIA SEPARADA (fora deste mandato — exige tarefa própria)

**Anexos de cliente ficam em endereço público.** O fluxo atual de anexos de `Contratante`/`Requerente`
grava `R2_PUBLIC_URL/<chave>` — endereço adivinhável, servido sem autenticação — e a aba "Observações e
Anexos" só exibe arquivo com URL pública. Para esta entrega (decisão A): na **confirmação**, os arquivos do
envio são copiados do prefixo privado para o padrão atual dos anexos (passam a ter endereço público, como
todos os outros) e as cópias privadas são apagadas. Antes da confirmação os arquivos são privados.
Tornar privados **todos** os anexos de cliente (e a aba passar a abri-los por URL assinada) é uma tarefa
própria, ainda não aberta.

## 8b. PENDÊNCIAS DO PRÓXIMO BLOCO — armazenamento da coleta (registradas em 04/10/2026, após o teste real)

Achadas no teste de ponta a ponta em produção (processo 847 "Teste link"). Nada disto foi corrigido ainda; a
proposta vem antes do código.

**P0 — O armazenamento "privado" não é privado.** O endereço público do bucket (`R2_PUBLIC_URL`, domínio `pub-….dev`)
serve o bucket INTEIRO: um arquivo em `privado/coleta/<link>/<uuid>/...` abriu SEM autenticação (HTTP 200, conteúdo
legível). O prefixo `privado/` é só um nome, não uma barreira. O comentário de `storage-privado.ts` ("nenhum arquivo
aqui é servido pelo domínio público") está errado. A proteção hoje é só o uuid no caminho (não adivinhável).
Alcance provável: também `privado/documentos/*` (procurações e documentos gerados, com CPF/RG/endereço) — NÃO foi
verificado, de propósito, para não abrir esses arquivos. Opções: (A) bucket separado, sem endereço público, para
`privado/` (+ variável nova; migrar o que já existe); (B) regra de bloqueio de `/privado/*` no domínio público
(Cloudflare, fora do código, não verificável daqui).

**a) Arquivo enviado sem o formulário concluído.** O navegador sobe o arquivo (URL assinada) ANTES de enviar o
formulário; se o cliente desiste, o objeto fica em `privado/coleta/<link>/…` sem nenhuma linha no banco. Nada o
apaga nunca (a purga só olha envios descartados).

**b) Arquivos de link cujo processo foi excluído.** `ColetaLink → Processo`, `ColetaEnvio → ColetaLink` e
`ColetaArquivo → ColetaEnvio` são `ON DELETE CASCADE`: apagar o processo apaga as linhas, inclusive a CHAVE do
arquivo — e o objeto no storage fica sem referência alguma (órfão para sempre, impossível de localizar pelo banco).
(Confirmado pelo schema e pela migration; o caminho de exclusão de processo não trata a coleta.)

**c) Envios pendentes de processo que nunca saiu de "Aguardando fechamento".** Dados pessoais, CPF e arquivos
ficam por prazo indeterminado; a retenção de 30 dias cobre só os DESCARTADOS.

**d) (derivada) Anexos de cliente em endereço público** — ver §8; agravada pelo P0.

Registro do teste real (04/10/2026, processo 847): link gerado → 3 pessoas enviadas pela URL pública de produção com
RG e comprovante → pré-cadastro com 3 pendentes e 0 cadastros oficiais → saída de fase barrada com
`CONFERENCIA_PENDENTE` → conferência (Requerente, Contratante, "os dois") → "os dois" = 1 Requerente + 1 Contratante
com os dois ids no envio → nenhuma Pessoa criada, árvore intocada → 6 arquivos copiados para anexos e cópias
privadas apagadas → link encerrado (`CONFERENCIA`) → envio no link encerrado recusado (404). Tudo removido ao final
(somente itens com "TESTE COLETA" no nome); contagens voltaram à linha de base.

## 9. Testes e critério de aceite

Cada regra acima tem teste na suíte crítica: reenvio por CPF; CPF inválido; consentimento obrigatório;
link encerrado/expirado/inexistente (mesma resposta genérica); página pública sem dado devolvido; guarda
`CONFERENCIA_PENDENTE` em todas as portas; conferência idempotente; papel "os dois"; CPF igual reaproveita;
nome igual não trava; árvore intocada; descarte + retenção de 30 dias; permissão `clientes.criar`.
