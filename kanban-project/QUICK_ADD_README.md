# Quick Add Task - Funcionalidade de Criação Rápida de Atividades

## 📋 Visão Geral

A funcionalidade **Quick Add Task** permite criar atividades rapidamente diretamente nas colunas do kanban com o prazo já pré-definido baseado na coluna onde o botão é acionado.

## ✨ Como Usar

1. **Navegue para a tela de Atividades** (`/activities`)
2. **Passe o mouse sobre qualquer coluna** do kanban por prazo
3. **Clique no botão "+"** que aparece no canto superior direito da coluna
4. **Preencha o formulário**:
   - Nome da atividade (obrigatório)
   - Projeto (obrigatório) 
   - Descrição (opcional)
   - O prazo já vem definido pela coluna
5. **Pressione "Criar Atividade"** ou use o atalho **Ctrl + Enter**

## 🎯 Funcionalidades

### Hover Inteligente
- Botão aparece apenas quando necessário
- Delay de 300ms para evitar flickering
- Smooth animations

### Modal Otimizado
- Auto-focus no campo nome
- Validação em tempo real
- Atalhos de teclado (Ctrl + Enter para criar, Esc para fechar)
- Carregamento automático de projetos

### Cálculo Automático de Prazos
- **Vencido**: 1 dia atrás
- **Hoje**: Final do dia atual
- **Próximos 3 dias**: Em 2 dias
- **Próxima semana**: Em 5 dias  
- **Futuro**: Em 15 dias
- **Sem prazo**: Null

### Feedback Visual
- Toast notifications para sucesso/erro
- Loading states durante criação
- Badges de status em tempo real
- Auto-refresh da lista após criação

## 🔧 Estrutura Técnica

### Componentes Criados
- `QuickAddButton.tsx` - Botão de hover
- `QuickAddModal.tsx` - Modal de criação
- `Toast.tsx` + `Toaster.tsx` - Sistema de notificações

### Hooks
- `useQuickAddActivity.ts` - Lógica de criação e validações

### API
- Extensão do `/api/activities` com suporte a `prazo_category`
- Cálculo automático de `data_termino`

### UX/UI
- Animations suaves
- Tooltips informativos  
- Estados de loading
- Validações client-side

## 🚀 Tecnologias Utilizadas

- **React 18** com hooks
- **TypeScript** para type safety
- **Shadcn/UI** para componentes
- **Radix UI** primitives
- **Next.js 14** App Router
- **Prisma** para banco de dados

## 📱 Responsividade

A funcionalidade é totalmente responsiva e funciona bem em:
- Desktop (hover com mouse)
- Tablets (touch)
- Mobile (adaptado para touch)

## 🎨 Personalização

O visual pode ser customizado através das classes CSS e variants do shadcn/ui:
- Cores dos toasts
- Animações do botão
- Estilo do modal
- Tooltips

## 🐛 Tratamento de Erros

- Validação de campos obrigatórios
- Tratamento de erros de API
- Feedback visual para todos os estados
- Fallbacks para casos edge

---

**Desenvolvido como parte do sistema de gerenciamento de atividades do Kanban Project** 🚀