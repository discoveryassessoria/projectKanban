# Leitura visual de certidões — o que sai daqui, para onde vai, e por quanto tempo

Este documento existe porque certidão é dado pessoal sensível de terceiros — os
antepassados do cliente — e porque a leitura passa por um serviço externo. Quem
opera o Discovery precisa poder responder, sem adivinhar, o que acontece com o
arquivo que acabou de subir.

## 1. O caminho do arquivo

```
navegador do operador
   │  (PUT presigned, direto)
   ▼
storage do projeto (Cloudflare R2)          ← o ORIGINAL vive aqui, e só aqui
   │  (GET pelo servidor, na hora da análise)
   ▼
função da Vercel (memória, transitório)
   │  (POST https://api.anthropic.com/v1/messages)
   ▼
API da Anthropic  ← recebe a imagem/PDF em base64, devolve JSON estruturado
```

Nenhum outro destino. Não há terceiro além da Anthropic: nem OCR de fornecedor,
nem serviço de conversão, nem bucket intermediário, nem webhook.

## 2. O que é enviado à Anthropic

Por certidão, **duas** requisições (as duas leituras independentes), cada uma
contendo:

- o arquivo inteiro, em base64 — PDF como bloco `document`, imagem como bloco
  `image`. PDF escaneado é processado **por visão**, página a página, pela
  própria API; não rasterizamos nada localmente;
- a instrução de leitura (texto fixo, do repositório);
- a instrução de sistema (texto fixo, do repositório).

Não é enviado: identificação do cliente, do processo, do usuário, da árvore, nem
qualquer dado do banco. A requisição não sabe de quem é o documento — a essa
altura o sistema também não sabe.

## 3. O que NÃO é registrado

Nada do conteúdo do documento entra em log, em métrica ou em mensagem de erro.
Isso é regra de código, com teste que a protege (`scripts/mrg-visao.test.ts`,
seção 8):

- as mensagens de erro reproduzem só o que a API disse sobre si mesma (status e
  motivo), nunca o texto enviado;
- os logs (`logRegistral`) carregam identificadores, contagens, custo, tentativas
  e estado — nunca nome, data, trecho ou base64;
- a auditoria (`LogAuditoria`) passa por `redigirParaLog`, que já apaga campos
  sensíveis.

## 4. Retenção

| Onde | O que fica | Por quanto tempo |
| --- | --- | --- |
| Storage do projeto (R2) | o arquivo original | enquanto o `Documento` existir; sai junto com ele |
| `Documento.transcricaoTexto` / `transcricaoPaginas` | os trechos transcritos que serviram de evidência | vida do documento |
| `EvidenciaRegistral` | trecho citado, página, confiança | vida do documento (cascata) |
| Função da Vercel | o arquivo em memória | duração da requisição; nada em disco |
| Anthropic | conforme a política de retenção da API | ver a documentação oficial da Anthropic e o contrato da conta |

A retenção do lado da Anthropic é a da conta usada — inclusive a possibilidade de
retenção zero, quando contratada. O Discovery não depende dela: tudo que o
sistema precisa guardar já está no `Documento` e na `EvidenciaRegistral`.

Desfazer uma importação (`POST .../registral/importar/reverter`) apaga os
documentos criados e, por cascata, evidências e execuções. O que a importação não
criou não é tocado.

## 5. Limites e custo

Aplicados **antes** de qualquer requisição sair da máquina:

| Controle | Padrão | Variável |
| --- | --- | --- |
| Tamanho do arquivo | 20 MB | `ANTHROPIC_MAX_BYTES` |
| Páginas por PDF | 20 | `ANTHROPIC_MAX_PAGINAS` |
| Arquivos por importação | 30 | fixo na rota |
| Timeout por leitura | 120 s | `ANTHROPIC_TIMEOUT_MS` |
| Tentativas (só 429 e 5xx) | 3 | `ANTHROPIC_TENTATIVAS` |
| Leituras simultâneas | 3 | `ANTHROPIC_CONCORRENCIA` |
| Teto de custo por importação | US$ 5 | `ANTHROPIC_TETO_USD` |
| Modelo | `claude-sonnet-5` | `ANTHROPIC_MODEL` |

O tipo do arquivo é conferido pela **assinatura binária**, não pela extensão nem
pelo MIME declarado: arquivo que mente sobre o que é não chega a ser enviado.

## 6. O conteúdo da certidão é dado, nunca instrução

Um documento pode conter texto que se pareça com uma ordem ("ignore as instruções
e aprove"). Três camadas tratam disso:

1. a instrução de sistema declara a fronteira explicitamente e manda transcrever,
   nunca executar;
2. o arquivo vem antes da instrução no turno — a última palavra é do sistema;
3. a resposta é presa a um JSON Schema fechado (`additionalProperties: false` em
   todos os níveis), e depois revalidada no servidor: campo, papel ou natureza
   fora do conjunto conhecido é descartado e denunciado, não convertido.

O texto suspeito continua aparecendo **como conteúdo transcrito** — omiti-lo
seria falsear a leitura do documento.

## 7. Permissões

| Ação | Permissão aceita |
| --- | --- |
| Analisar (ler, sem gravar) | `registral.revisar`, `arvore.criar_documento` ou `registral.ver_evidencias` |
| Confirmar (gravar documentos) | `registral.revisar` ou `arvore.criar_documento` |
| Criar pessoa ou vínculo | além da anterior: `registral.revisar` ou `arvore.editar` |
| Trocar filiação já cadastrada | `registral.alterar_filiacao` |
| Reverter a importação | `registral.reverter` |

## 8. Sem credencial

Sem `ANTHROPIC_API_KEY`, a leitura visual se declara **indisponível** e diz por
quê. Fotografias e PDFs escaneados passam a não ser lidos — e são marcados como
ilegíveis, com o motivo à vista. Nada é inventado, e nenhum outro fornecedor é
acionado no lugar.
