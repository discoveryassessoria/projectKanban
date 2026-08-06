# 11 — Assistente de Parametrização (CONGELADO em 06/08/2026)

**Status:** implementação oficial. Evolução só incremental.

---

## O problema que ele resolve

Preencher a configuração do Discovery exigia atravessar seis telas em três
módulos e saber, de cabeça, que o preço da Tabela de Valores só vale se o
componente da Aplicabilidade Econômica estiver ativo **e** a regra de Regras
Documentais estiver publicada. O administrador não errava por falta de tela —
errava por falta de **ordem** e de **retorno**.

---

## A decisão

O assistente é **camada de condução**. Ele não é dono de nenhum dado que coleta.

| O quê | Onde vive | O assistente… |
|---|---|---|
| Regra documental | `MatrizDocumental` | embute `RegrasDocumentaisTab` |
| Serviço | `ItemCatalogo` | embute `ProdutosServicosTab` |
| Configuração financeira | `ProdutoFinanceiro` | embute `AplicabilidadeEconomicaTab` |
| Preço | `TabelaValor` | embute `TabelaValoresTab` |
| Fornecedor | `Fornecedor` | embute `FornecedoresTab` |
| Moeda | cadastro de moedas | embute `MoedasTab` |
| **Progresso do assistente** | `AssistenteParametrizacaoProgresso` | **é dono** |

A tabela própria guarda quatro coisas: escopo, etapa, usuário, datas. Nada mais.

**Por quê:** se guardasse cópia da configuração, um cadastro feito pela tela
administrativa — fora do assistente — faria os dois divergirem no mesmo dia. É a
definição de segunda fonte da verdade.

---

## Invariantes congelados

1. **O estado é derivado, nunca guardado.** As 14 etapas leem as entidades
   canônicas a cada consulta. Preencher o preço faz a pendência sumir na leitura
   seguinte, sem rotina de limpeza.

2. **A simulação é o motor, não uma prévia dele.** Chama
   `resolverElegibilidadeDocumental` e `resolverPrecoPorConfigDB` — os mesmos do
   runtime. Um cálculo próprio "só para prever" divergiria exatamente quando
   importasse: na véspera da publicação.

3. **A publicação é tudo-ou-nada.** Valida antes de escrever qualquer coisa e
   escreve numa transação só, ativando componentes **antes** de publicar regras —
   para que em nenhum instante exista regra publicada apontando para componente
   inativo.

4. **Uma regra só decide o que impede publicar.** `impedimentosDePublicacao` é
   consumida pelo estado (que habilita o botão) e pela publicação (que executa).
   `COMPONENTE_INATIVO` e `REGRA_NAO_PUBLICADA` ficam de fora: são exatamente o
   que publicar resolve.

5. **A conclusão orquestra os canônicos.** `concluirParametrizacao` chama
   `publicarParametrizacao`, `materializarExecucaoDaFase`,
   `reconciliarDocumentalFinanceiro`, `resolveOperationalProjection`,
   `listarObrigacoes` e `montarPlanilhaDocumental`. Não reimplementa nenhum.

6. **Nada depende de terminal.** O ciclo inteiro roda por
   `POST /api/gerenciamento/parametrizacao/concluir`, com progresso em NDJSON.
   Um guard de teste reprova `execSync`/`child_process` no serviço e na rota.

7. **Idempotência vem dos serviços chamados**, não de lógica própria: publicar
   ignora o publicado, materializar reaproveita passo existente, a projeção
   documental tem chave única no banco.

8. **Erro isola a etapa.** Uma etapa que falha não derruba as que não dependem
   dela; o relatório diz o que rodou, o que foi pulado e por quê.

---

## Regras de evolução

Toda mudança futura **deve**:

- reutilizar os mesmos serviços de domínio;
- manter o assistente sem propriedade sobre configuração;
- manter o estado derivado.

Toda mudança futura **não pode**:

- criar tabela que espelhe configuração já existente;
- criar caminho de publicação, materialização ou reconciliação alternativo;
- calcular preço, elegibilidade ou pendência fora dos resolvedores canônicos;
- substituir uma tela administrativa embutida por formulário próprio;
- relaxar `impedimentosDePublicacao` para "destravar" um botão.

---

## Superfície oficial

**Rota:** Gerenciamento › Sistema › Assistente de Parametrização (`?screen=paramwizard`)

| Endpoint | Papel |
|---|---|
| `GET /api/gerenciamento/parametrizacao` | estado das 14 etapas |
| `POST /api/gerenciamento/parametrizacao` | salva só progresso |
| `GET .../simular` | motor real, sem escrita |
| `POST .../publicar` | publicação coordenada |
| `POST .../concluir` | ciclo completo, NDJSON |
| `GET /api/gerenciamento/pendencias-parametrizacao` | pendências derivadas |

**Serviços:** `estado-parametrizacao`, `simulacao-parametrizacao`,
`publicacao-coordenada`, `concluir-parametrizacao`, `pendencias-parametrizacao`.

**Migrations:** `20260806b_assistente_parametrizacao` (uma tabela de progresso).

**Testes:** `test:assistente` (40), `test:pre-cadastro` (13).

---

## O que ficou de fora, e por quê

- **Cópia de configuração entre tipos de processo** — exige decidir o que é
  equivalente entre nacionalidades; é decisão de negócio.
- **Gestão contratual** (contrato, proposta, aditivo) — domínio inexistente no
  schema. Sem ele, "incluído no contrato" não tem onde se apoiar.
- **Materialização e reconciliação disparadas por etapa isolada** — hoje rodam
  dentro da conclusão. Separá-las é incremental, se fizer falta.
