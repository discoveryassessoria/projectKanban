# 05 — Parametrização: o que foi recuperado e o que precisa de decisão

**06/08/2026.** Este documento é o resultado de **executar** a recuperação que o
programa de parametrização exige — varrer todas as fontes oficiais permitidas e
cadastrar tudo que fosse determinístico. Ele não é um diagnóstico prévio: é o
relatório do que a varredura encontrou.

---

## 1. Fontes varridas

Todas as fontes que o programa autoriza, na ordem que ele define:

| # | Fonte | Como foi lida | Resultado |
|---|---|---|---|
| 1 | Cadastros mestres atuais | consulta direta a produção | catálogo de fases íntegro; zero regra documental; zero regra econômica |
| 2 | Tabelas oficiais | `TabelaValor` em produção | 4 linhas, **todas `natureza = VENDA`** (honorários) |
| 3 | Contratos e propostas | busca por entidade no schema | **não existe** model de Contrato/Proposta/Aditivo |
| 4 | Histórico de lançamentos | 3 backups JSON de processos (172 processos) | 93 receitas, **todas honorários**, sem vínculo documental; 1 custo, **cancelado** |
| 5 | Versões anteriores | 5 dumps `pg_restore` (14/07 a 16/07) | ver §2 |
| 6 | Migrations | 114 arquivadas + 10 ativas | **nenhuma** semeia configuração |
| 7 | Seeds oficiais | 16 seeds | ver §3 |
| 8 | Commits Git | `git log -S` sobre criação de Matriz | nenhum commit jamais criou regra de Matriz |
| 9 | Backups | os 5 dumps + 3 JSON acima | ver §2 |
| 10 | Configurações publicadas | `PhaseInternalWorkflow`, `MacroWorkflow` | íntegros e publicados |
| 11 | Registros de fornecedores | `Fornecedor` em produção e nos 5 dumps | **0 em todos** |
| 12 | Documentos internos aprovados | repositório | nenhum documento de preço |

---

## 2. O que os cinco backups contêm

| Backup | Matriz | PhaseEconomicRule | TabelaValor | **com valor > 0** | Fornecedor |
|---|---:|---:|---:|---:|---:|
| `INCIDENTE-forense` 14/07 | 2 | 5 | 14 | **0** | 0 |
| `PRE-F1` 14/07 | 2 | 5 | 14 | **0** | 0 |
| `PRE-config-unica` 15/07 | 2 | 0 | 14 | **0** | 0 |
| `PRE-hardening-preco` 15/07 | 2 | 0 | 14 | **0** | 0 |
| `prod-pre-lote-a` | 2 | 5 | 14 | **0** | 0 |

> **`TabelaValor` com valor > 0 = ZERO em toda a história do sistema.**
> As 14 linhas são todas `[AJUSTAR] Custo/Receita padrão global`, valor `0.0`,
> arquivadas. Os únicos valores positivos que existiram são dois `valorPadrao`
> em `ProdutoFinanceiro` explicitamente rotulados **`[TESTE]`** (150,00 e 90,00)
> — e `valorPadrao` foi **eliminado como fonte de preço** pela regra
> preço-fonte-única: o motor não o lê.

---

## 3. O que os seeds contêm

`prisma/seed-precos-tabela-valores.ts`, no próprio cabeçalho:

```
// Valores = PLACEHOLDER [AJUSTAR] (Marco troca na tela).
...
data: { ..., valor: 0, modoCalculo: 'fixed' }, // valor 0 = [AJUSTAR]
```

Os seeds **nunca** tiveram preço. Foram escritos como andaime para a tela.

---

## 4. ESTRUTURA RECUPERADA (determinística)

Isto existiu de fato e é recuperável — são nomes de cadastro, não invenção:

**Componentes econômicos por fase** (de `PhaseEconomicRule`, backup 14/07):

| Fase | Componente | Config. de custo | Config. de receita |
|---|---|---|---|
| `emissao_documental` | Certidão Inteiro Teor | `CIT_CUSTO` *(marcado TESTE)* | `CIT_RECEITA` *(TESTE)* |
| `traducao` | Tradução Juramentada | `TRAD_CUSTO` | `TRAD_RECEITA` |
| `apostilamento` | Apostilamento Certidão | `APOST_CERT_CUSTO` | `APOST_CERT_RECEITA` |
| `apostilamento` | Apostilamento Tradução | `APOST_TRAD_CUSTO` | `APOST_TRAD_RECEITA` |
| `retificacao` | Retificação | `RETIF_CUSTO` | `RETIF_RECEITA` |

Confere com a cadeia que você descreveu: emissão → apostilamento da certidão →
tradução → apostilamento da tradução. **A estrutura estava certa; o que nunca
existiu foi o valor.**

**Catálogo de fases** — já em produção, íntegro, não precisa de nada:

| Tipo de processo | Sequência publicada |
|---|---|
| 14 · Nacionalidade Alemã | genealogia\* → emissao_documental\* → analise_documental\* → retificacao → emissao_documental_retificada → traducao\* → apostilamento\* → aguardando_protocolo\* → protocolado\* → finalizado\* |
| 18 · Nacionalidade Espanhola | igual, **sem `traducao`** |
| 19 · Nacionalidade Italiana · Judicial | igual à alemã |

`*` = obrigatória.

---

## 5. NÃO RECUPERÁVEL — o que exige decisão de negócio

### 5.1 Preços (bloqueia custos e receitas)

Zero preço documental jamais existiu. Para cada componente da §4, falta:

| Campo | Fonte necessária |
|---|---|
| valor de **custo** | tabela do fornecedor / cartório / tradutor |
| valor de **venda** | tabela comercial da Discovery |
| moeda | decisão comercial |
| unidade (documento / lauda / página / requerente) | decisão comercial |
| vigência | decisão comercial |
| variação por país / estado / cartório / idioma / urgência | decisão comercial |

### 5.2 Fornecedores (bloqueia custo com beneficiário)

`Fornecedor = 0` em produção e em todos os backups. Nenhum cartório, tradutor,
apostilador ou correspondente jamais foi cadastrado. Sem fornecedor não há
"custo por fornecedor" nem tabela de custo por prestador.

### 5.3 Matriz Documental (bloqueia a materialização documental)

As 2 regras históricas apontam para `tipoProcessoId = 5`, **que não existe mais**
— os tipos vigentes são 14, 18 e 19. Mapear 5 → qual deles é adivinhação, e as
duas regras cobrem só nascimento e casamento de um único tipo.

Para cada tipo de processo × fase, falta decidir: quais documentos são exigidos,
de quem (linha reta / requerente / cônjuge), sob qual condição, obrigatório ou
condicional, e a partir de qual fase.

### 5.4 Contrato (bloqueia toda a §8 do programa)

**Não existe entidade de Contrato, Proposta ou Aditivo no schema.** Sem ela não
há como:

- declarar origem comercial da receita;
- saber o que está incluído no contrato;
- impedir cobrança duplicada de serviço já contratado;
- aplicar franquia ou escopo contratado;
- calcular margem contra o contratado.

Isso não é dado faltando — é **domínio inexistente**. Criá-lo é arquitetura
nova, de porte comparável ao motor financeiro, e é decisão sua, não de
engenharia.

---

## 6. Por que a estrutura não foi cadastrada sozinha

Cadastrar os 5 componentes + 8 configurações financeiras **sem preço** produziria:

- nenhum custo e nenhuma receita a mais (o motor resolve preço pela Tabela e, sem
  preço vigente, registra `PendenciaFinanceira` em vez de lançar);
- 13 linhas novas no cadastro mestre de produção, derivadas de uma fatia de teste
  de julho, **sem aprovação comercial**;
- e, sem Matriz vigente, o motor sequer chega ao componente — ele começa pela
  Matriz e para ali.

Ou seja: efeito funcional **zero**, com custo de poluir o cadastro. Por isso está
aqui como estrutura recuperada e pronta para cadastro, e não cadastrada à
revelia.

**O caminho de cadastro já existe e está funcionando** — `POST/PUT/DELETE` em
`gerenciamento/matriz-documental`, `gerenciamento/regras-documentais` (com
publicação) e `gerenciamento/aplicabilidade-economica`. Não falta máquina.

---

## 7. Ficha de decisão mínima para destravar

O menor conjunto que faz o primeiro custo nascer de verdade, para **um** tipo de
processo:

1. **Matriz** — para o tipo 14, 18 ou 19: quais tipos documentais são exigidos,
   em qual fase, para quem, com qual obrigatoriedade.
2. **Componentes** — quais dos 5 da §4 valem para cada tipo documental.
3. **Preço de custo** — valor, moeda, unidade e vigência de cada componente.
4. **Preço de venda** — idem, se o serviço for cobrado do cliente.
5. **Fornecedor** — quem recebe o pagamento de cada componente.
6. **Política** — absorvido / reembolsável / repassado com margem / incluído no
   contrato.

Com (1) a (3) a Planilha Documental-Financeira passa a mostrar número. Com (4) a
(6) a receita e a margem passam a existir.
