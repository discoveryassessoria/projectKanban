# Kanban de Atividades por Prazo

## 📋 Descrição

Este componente implementa um sistema de kanban onde as atividades são organizadas por proximidade do prazo, proporcionando uma visualização clara e intuitiva da urgência das tarefas.

## 🎯 Funcionalidades Principais

### 🔍 Classificação Automática por Prazo
- **Vencido** 🔴 - Atividades com prazo já expirado
- **Hoje** 🟠 - Atividades que vencem hoje
- **Próximos 3 dias** 🟡 - Atividades que vencem nos próximos 3 dias  
- **Próxima semana** 🔵 - Atividades que vencem na próxima semana
- **Futuro** 🟢 - Atividades com prazo mais distante
- **Sem prazo** ⚪ - Atividades sem data de término definida

### 🎨 Interface Visual
- Layout em colunas horizontais com scroll suave
- Cards de atividades com informações completas
- Indicadores visuais de urgência (cores, badges, ícones)
- Responsivo para desktop e mobile
- Animações suaves e estados de hover

### 🔧 Funcionalidades de Gestão
- **Filtros avançados**: projeto, status, responsável, nome
- **Gerenciamento de status**: criar, editar e deletar status customizados
- **Atualização em tempo real**: contadores e estatísticas dinâmicas
- **Estados vazios**: mensagens informativas quando não há dados

## 🏗️ Arquitetura

### Componentes Principais

1. **PrazoActivities** - Componente principal com tabs
2. **StatusCard** - Coluna do kanban com header e contador
3. **ActivityCard** - Card individual da atividade
4. **ActivityFilters** - Sistema de filtros em sheet lateral
5. **CustomStatusManager** - Gerenciamento de status personalizados
6. **StatusModal** - Modal para criar/editar status

### Utilitários

- **prazoUtils.ts** - Lógica de classificação e ordenação por prazo
- **kanban.css** - Estilos customizados para o kanban

### APIs

- **GET /api/activities** - Lista atividades com filtros
- **GET /api/status** - Lista todos os status
- **POST /api/status** - Cria novo status
- **PUT /api/status/[id]** - Edita status existente
- **DELETE /api/status/[id]** - Remove status (se não estiver em uso)

## 🚀 Como Usar

### Navegação

O componente possui duas abas principais:

1. **Kanban por Prazo** - Visualização principal das atividades
2. **Gerenciar Status** - Administração de status personalizados

### Filtros

Acesse os filtros através do botão "Filtros" que oferece:

- **Nome da atividade** - Busca textual
- **Projeto** - Seleção por projeto específico
- **Status** - Filtro por status da atividade
- **Responsável** - Busca por nome do usuário

### Interações

- **Clique em atividade** - Abre detalhes (implementação futura)
- **Hover em cards** - Efeitos visuais de destaque
- **Badges de filtro** - Remoção individual com botão X
- **Atualização** - Botão refresh para recarregar dados

## 🎨 Indicadores Visuais

### Cores por Urgência
- **Vermelho** - Vencido (alta prioridade)
- **Laranja** - Hoje (urgente)
- **Amarelo** - Próximos 3 dias (atenção)
- **Azul** - Próxima semana (moderado)
- **Verde** - Futuro (baixa prioridade)
- **Cinza** - Sem prazo (neutro)

### Elementos de UI
- Contadores dinâmicos nas colunas
- Badges com número de atividades
- Ícones representativos para cada categoria
- Avatares dos responsáveis
- Indicadores de urgência animados

## 📱 Responsividade

- **Desktop** - Layout completo com todas as colunas visíveis
- **Tablet** - Scroll horizontal otimizado
- **Mobile** - Colunas compactas com largura fixa

## 🔧 Extensibilidade

### Novos Status
Facilmente adicione novos status através da interface de gerenciamento.

### Filtros Customizados
A arquitetura permite adicionar novos filtros modificando o componente `ActivityFilters`.

### Integrações
APIs RESTful permitem integração com outros sistemas e automações.

## 📊 Performance

- **Filtros client-side** para resposta instantânea
- **Carregamento assíncrono** com estados de loading
- **Otimização de re-renders** com React hooks
- **CSS otimizado** para animações suaves

## 🎯 Próximos Passos

- [ ] Modal de detalhes da atividade
- [ ] Drag & drop entre colunas (se necessário)
- [ ] Notificações de prazos próximos
- [ ] Exportação de relatórios
- [ ] Integração com calendário
- [ ] Comentários e anexos nas atividades

## 🛠️ Tecnologias Utilizadas

- **Next.js 14** - Framework React
- **TypeScript** - Tipagem estática
- **Tailwind CSS** - Estilização
- **Radix UI** - Componentes base
- **Prisma** - ORM para banco de dados
- **Lucide React** - Ícones

---

Este sistema de kanban por prazo oferece uma solução completa e intuitiva para gerenciamento de atividades, focando na visualização clara da urgência e permitindo uma gestão eficiente do tempo e prioridades.