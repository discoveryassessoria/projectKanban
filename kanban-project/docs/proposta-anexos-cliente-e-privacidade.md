# Proposta — anexos de cliente no bucket público e três pontos de privacidade da coleta

**Status:** PROPOSTA (nada foi executado). Levantamento feito em 05/10/2026, só por leitura: listagem do bucket (nomes, tamanhos e datas
dos objetos; **nenhum arquivo foi aberto**), contagens no banco de produção, leitura do código. Nenhum dado, objeto ou migration foi alterado.
Contexto e decisões anteriores: `docs/coleta-de-dados-mandato.md` §8 e §8b.

---

## 1. Levantamento dos anexos de cliente no bucket público (`discovery-documents`)

### 1.1 Os números de hoje

| Onde | Objetos | Tamanho | Observação |
|---|---|---|---|
| `documentos/` | 285 | ≈ 479 MB | anexos de cliente (RG, certidões, comprovantes) |
| `analise-documental/` | 1 | 0,1 MB | |
| `app-uploads/` | 1 | 2,8 MB | |
| **Total a tratar neste bloco** | **287** | **≈ 481,9 MB** | nenhum deles existe ainda no bucket privado |
| `privado/` (já copiados em 04/10) | 43 | 3,7 MB | só falta apagar do público (ver §1.6) |

O número "298" do mandato é de antes de 04/10: em 04/10 os 13 arquivos do processo do Antão foram movidos para o prefixo
`backup-reset-antao-20261004/` do bucket privado (ele hoje tem 56 objetos: 43 + 13). Conta fechada: 298 − 13 = 285 em `documentos/`.

Perfil dos 287: 140 `.jpg`, 77 `.png`, 61 `.pdf`, 9 `.jpeg`. Maior arquivo: 57 MB. Onze arquivos passam de 10 MB (233 MB juntos).
Datas dos objetos: mai 4 · jun 23 · jul 167 · ago 12 · set 79 · out 2 (os 2 de outubro são de 03/10).

### 1.2 Achado principal: nenhum desses arquivos é referenciado por alguma linha do banco

- `AnexoProcesso`, `AnexoContratante`, `AnexoRequerente`, `AnexoProtocolo`, `DocumentoArquivo`, `ReceitaDocumento`: **0 linhas** cada.
- Varredura de todas as colunas de texto/JSON do banco (1.230 colunas) procurando `documentos/`, `app-uploads/`,
  `analise-documental/` e o endereço público do bucket: só aparecem as 43 chaves de `privado/documentos/` (documentos gerados e modelos)
  e 1 registro de auditoria. **Nenhuma linha aponta para os 287.**
- Consequência: os 287 são **objetos órfãos** — sobras de dados anteriores à limpeza geral de produção (as linhas de anexo foram
  apagadas e os arquivos ficaram no bucket). Hoje **nenhuma tela do sistema abre nenhum deles**.
- **"De quais processos" não dá para responder pelo banco**: não há vínculo. Pistas parciais pelo nome da chave: 148 chaves trazem um
  número no caminho (`documentos/<n>/solicitacao|certidao|anexos/…`, 80 números diferentes — 80 de solicitação, 57 de certidão, 11 de anexos) e 137 só
  têm um carimbo de data e o nome do arquivo. Esses 80 números não coincidem com nenhum `Processo.id` atual; não consegui confirmar se
  coincidem com `Documento.id` antigos (a consulta falhou e não foi repetida). Atribuir arquivo a pessoa só abrindo o conteúdo, o que **não** foi feito.

### 1.3 O risco real hoje

O endereço público (`R2_PUBLIC_URL`) serve o bucket inteiro sem autenticação. Esses 287 arquivos contêm dados pessoais e estão abertos
a quem souber o endereço (a chave não é secreta: carimbo de data + nome do arquivo). Como ninguém no sistema os usa, **o valor deles é só
de arquivo/retenção; o dano possível é só de exposição**. Isso muda a proposta: não há "migrar e reapontar linhas" para esses 287 — há
"guardar com segurança ou descartar" (decisão sua, §1.7).

### 1.4 Proposta de migração dos 287 (cópia verificada, um a um)

1. **Congelar a lista.** Gerar o manifesto (chave, tamanho, ETag, tipo, data) dos 287, sem abrir arquivo. Esse manifesto é a lista oficial.
2. **Copiar dentro do próprio storage** (cópia servidor-a-servidor, sem baixar nada) para o bucket privado, mantendo a chave idêntica sob
   o prefixo `legado-anexos/` (ex.: `legado-anexos/documentos/…`). É o mesmo método do script `scripts/r2-migrar-privado.ts` (já usado nos 43).
   Idempotente: o que já está no destino é pulado.
3. **Verificar cada objeto**: tamanho + ETag + tipo iguais na origem e no destino. Qualquer divergência para tudo e é reportada. A prova
   de conjunto: 287 = 287 objetos, mesma soma de bytes (≈ 481,9 MB).
4. **Observação de 24 h** (como no bloco anterior). Esperado: nenhuma leitura no bucket antigo, já que nada o referencia.
5. **Autorização explícita sua ("apaga")** e só então apagar do público, chave a chave, **re-conferindo o destino imediatamente antes de
   cada exclusão**. Nada é apagado sem esse aviso.
6. Registrar a conclusão no mandato (§8b) com o manifesto guardado fora do repositório.

### 1.5 Como o sistema passa a ler do bucket privado (para os anexos NOVOS)

Hoje as rotas que gravam anexo em endereço público são `/api/storage/presign` e `/api/app/upload/presign`; as telas que abrem
`urlArquivo` direto são, no mínimo: `contratantes-tabela.tsx` (aba "Observações e Anexos"), `kanban/ProcessoProtocolos.tsx`,
`api/anexos/route.ts` e `api/protocolos/[id]/anexos/route.ts`. Proposta:

- **Gravar** no bucket privado, com chave sob `privado/anexos/<tipo>/<id>/<uuid>/<nome>` (o prefixo `privado/` já é a regra do modo duplo).
- **O banco passa a guardar a chave**, não o endereço. Sem migration: a coluna `urlArquivo` continua `String`; o leitor aceita os dois
  formatos (endereço antigo → extrai a chave; chave nova → usa direto). Quando não houver mais valor antigo, o formato único é a chave.
- **Ler** por uma porta única do servidor (ex.: "abrir anexo"), que confere a permissão do usuário sobre aquele processo/pessoa e devolve
  uma URL assinada de curta duração (minutos). As telas acima deixam de abrir o endereço direto e passam a chamar essa porta.
- **Coleta de dados (link do cliente):** na confirmação, o arquivo hoje é copiado do `privado/coleta/…` para o endereço público e a cópia
  privada é apagada (decisão A do mandato). Com a nova porta, a confirmação passa a **mover dentro do bucket privado**
  (`privado/coleta/…` → `privado/anexos/…`), sem nunca tocar o público.
- Teste de contrato no gate: nenhuma rota de upload devolve endereço público; nenhuma tela usa `urlArquivo` como `href` direto.

### 1.6 Ordem segura (resumo)

0. (já combinado) apagar do público os 43 `privado/` **só depois de 05/10/2026 18:02 UTC e com o seu "apaga"**;
1. Decidir o destino dos 287 (§1.7) → 2. manifesto → 3. cópia → 4. verificação → 5. 24 h de observação → 6. "apaga" → 7. código novo
   (gravar privado + porta de leitura assinada + telas) com o modo duplo e leitura dos dois formatos → 8. observar → 9. por último,
   **desligar o endereço público do bucket antigo** na Cloudflare (a barreira definitiva; fora do código) e remover o "plano B" do código.
   Os passos 7–9 só começam depois de 1–6, para o novo código nunca competir com a limpeza.

### 1.7 O que preciso que você decida

- Os 287 órfãos: **guardar** (arquivo no bucket privado, como acima) ou **descartar** (apagar do público sem cópia)? Recomendo guardar
  até você conferir se algum interessa (há RG e certidões de pessoas reais); descartar é irreversível.
- Os 2 objetos de 03/10 podem ser de teste; confirmo com você antes de tratá-los como os outros.

---

## 2. Três pontos de privacidade ainda abertos (coleta de dados do cliente)

Estado medido hoje em produção: 0 links, 0 envios, 0 arquivos de coleta; nenhum objeto sob `privado/coleta/` em nenhum dos dois buckets.
**Ou seja: hoje não há exposição ativa nesses três pontos** — o risco é de comportamento futuro, e cada correção abaixo é preventiva.

### a) Arquivo enviado sem completar o formulário fica no bucket privado para sempre

- **Como acontece:** o navegador sobe o arquivo (URL assinada) antes de enviar o formulário. Se o cliente desiste, o objeto fica em
  `privado/coleta/<link>/<uuid>/…` sem nenhuma linha no banco (`ColetaArquivo` só é criada no envio). A purga olha só envios descartados.
- **Risco real:** foto de RG/comprovante de quem desistiu acumula sem prazo e sem como ser localizada pelo banco (retenção além da finalidade).
  Como o bucket é privado (sem endereço público), não é exposição pública — é retenção indevida de dado pessoal.
- **Correção proposta:** uma rotina diária (no mesmo molde do cron `coleta-purga`) que **lista o prefixo `privado/coleta/` e apaga o objeto
  que (1) não tem linha em `ColetaArquivo` e (2) tem mais de 48 h**. A folga de 48 h protege quem está preenchendo agora. Primeiro em
  modo "só relatar" por uma semana, depois apagando. Não uso regra de ciclo de vida do R2 por idade, porque ela apagaria também arquivos
  com linha no banco (envios ainda pendentes).

### b) Processo apagado deixa arquivos órfãos no bucket

- **Como acontece:** `ColetaLink → Processo`, `ColetaEnvio → ColetaLink`, `ColetaArquivo → ColetaEnvio` (e os anexos) são `ON DELETE CASCADE`.
  Apagar o processo apaga as linhas — inclusive a chave do arquivo — e o objeto no storage perde qualquer referência. O caminho de
  exclusão de processo (`excluirProcesso`, `processo-ciclo-vida.ts`) não apaga nenhum objeto do storage (confirmado: os únicos pontos do
  código que removem objeto são a coleta, a geração de documento e o armazenamento privado de modelos).
- **Risco real:** é exatamente o que os 287 arquivos de hoje demonstram — dados pessoais que sobreviveram à exclusão dos registros e ficaram
  inalcançáveis pelo banco (e, no caso dos anexos, em endereço **público**). Vale para: arquivos da coleta, anexos de processo/cliente/protocolo
  e documentos gerados (`privado/documentos/…`; cascata dessas versões ainda a conferir).
- **Correção proposta (regra "exclusão não deixa órfão"):**
  1. No plano de exclusão do processo, **levantar as chaves** de tudo que o processo possui no storage (coleta, anexos, protocolos, documentos
     gerados) **antes** de apagar as linhas e registrá-las na auditoria da exclusão;
  2. apagar os objetos **depois** do commit da exclusão, com nova tentativa se falhar (e relatório do que não foi apagado);
  3. um conferidor semanal (**só relatório**) que compara os objetos do bucket com as chaves do banco e lista os órfãos — para pegar o que
     escapar e para limpar o legado; apagar órfão encontrado continua exigindo a sua autorização.
  Teste com prova por IDs: criar processo com arquivos → excluir → nenhum objeto sobra.

### c) Envios pendentes de processos que nunca avançam nunca são limpos

- **Como acontece:** a retenção de 30 dias só atinge envios **descartados** de links já **encerrados**. Um envio `PENDENTE` em link ativo —
  por exemplo, de processo parado em "Aguardando fechamento" por meses — guarda CPF, dados e arquivos sem prazo. Também não entram na
  purga os pendentes de um link encerrado por mudança de fase que ninguém conferiu.
- **Risco real:** dado pessoal de pessoas que talvez nunca virem cliente, guardado indefinidamente. Hoje 0 pendentes (nada exposto agora).
- **Correção proposta:** definir um **prazo de validade do link** (sugestão: 60 dias, renovável por quem gerou o link) calculado a partir da
  criação ou do último envio — sem coluna nova, então sem migration. Link vencido é encerrado automaticamente (motivo novo "VENCIDO"), e os
  pendentes dele passam a seguir a mesma contagem de 30 dias dos descartados (arquivos e dados apagados, fica só o registro sem dado pessoal).
  A tela mostra "expira em N dias" e avisa o administrador 7 dias antes. **Preciso do seu prazo** (60 dias é só sugestão).

---

## 3. Sequência sugerida de execução (quando você autorizar)

1. Apagar do público os 43 `privado/` (após 05/10 18:02 UTC, com o seu "apaga").
2. Você decide o destino dos 287 → cópia verificada → 24 h → "apaga".
3. Ponto (b) (exclusão sem órfão) — é o que impede novos órfãos; vem antes de qualquer outra limpeza.
4. Ponto (a) (varredura de arquivo sem formulário) e ponto (c) (validade do link).
5. Anexos novos no bucket privado com porta de leitura assinada; por fim desligar o endereço público do bucket antigo.

## 4. Limites deste levantamento

- Não abri nenhum arquivo: não sei quem são as pessoas nem a quais processos pertenciam os 287.
- Não confirmei se os 80 números embutidos nas chaves são `Documento.id` antigos (a consulta falhou e não foi repetida).
- Não conferi a regra de cascata das versões de documentos gerados.
- O estado do bucket é de 05/10/2026; objetos novos podem ter surgido depois.
