# 🚀 Guia Rápido - Primeiros Passos

## 📝 Pré-requisitos

Antes de testar o sistema, certifique-se de ter:
- ✅ Banco de dados configurado e rodando
- ✅ Pelo menos um usuário administrador no banco de dados

---

## 🔐 Criar Primeiro Administrador

Se você ainda não tem nenhum usuário admin no banco, use este script:

### Opção 1: Via Prisma Studio

```bash
npx prisma studio
```

1. Abra a tabela `Usuario`
2. Clique em "Add record"
3. Preencha:
   - **nome:** "Administrador"
   - **email:** "admin@example.com"
   - **senha:** Use um hash bcrypt (veja opção 2)
   - **tipo:** "admin"
4. Salve

### Opção 2: Via Script Node.js

Crie um arquivo temporário `create-admin.js`:

```javascript
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function createAdmin() {
  try {
    const senhaHash = await bcrypt.hash('admin123', 10);
    
    const admin = await prisma.usuario.create({
      data: {
        nome: 'Administrador',
        email: 'admin@example.com',
        senha: senhaHash,
        tipo: 'admin'
      }
    });
    
    console.log('✅ Admin criado com sucesso:', admin);
  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createAdmin();
```

Execute:

```bash
node create-admin.js
```

---

## 🧪 Testando a Implementação

### Passo 1: Iniciar o Servidor

```bash
npm run dev
```

### Passo 2: Fazer Login como Admin

1. Acesse: `http://localhost:3000/auth`
2. Use as credenciais:
   - **Email:** admin@example.com
   - **Senha:** admin123 (ou a senha que você definiu)
3. Clique em "Entrar"

### Passo 3: Verificar Sidebar

Após o login, você deve ver na sidebar:
- Dashboard
- Kanban
- Activities and projects
- Genealogical Tree
- Settings
- **[NOVO] Gerenciar Usuários** ⬅️ Deve aparecer para admins

### Passo 4: Acessar Gerenciamento de Usuários

1. Clique em "Gerenciar Usuários" na sidebar
2. Você será redirecionado para `/administrator`
3. Deve ver a página de gerenciamento com:
   - Botão "Novo Usuário"
   - Campo de busca
   - Tabela de usuários

### Passo 5: Criar Usuário Teste

1. Clique em "Novo Usuário"
2. Preencha:
   - **Nome:** "João Silva"
   - **Email:** "joao@example.com"
   - **Tipo:** "Usuário"
   - **Senha:** "senha123"
3. Clique em "Criar"
4. Deve aparecer mensagem de sucesso
5. Usuário deve aparecer na tabela

### Passo 6: Testar Como Usuário Comum

1. Faça logout (se houver botão) ou abra em navegador anônimo
2. Acesse: `http://localhost:3000/auth`
3. Faça login com:
   - **Email:** joao@example.com
   - **Senha:** senha123
4. Verifique que:
   - ✅ Login funcionou
   - ✅ NÃO aparece "Gerenciar Usuários" na sidebar
   - ✅ Ao tentar acessar `/administrator` → redireciona para `/dashboard`
   - ✅ Tela de login não tem opção de registro

---

## ✅ Checklist de Validação

### Para Admin:
- [ ] Login com conta admin funciona
- [ ] Link "Gerenciar Usuários" aparece na sidebar
- [ ] Consegue acessar `/administrator`
- [ ] Consegue criar novo usuário
- [ ] Consegue editar usuário comum
- [ ] Consegue deletar usuário comum
- [ ] NÃO consegue deletar outro admin
- [ ] Busca de usuários funciona

### Para Usuário Comum:
- [ ] Login com conta comum funciona
- [ ] Link "Gerenciar Usuários" NÃO aparece
- [ ] Ao acessar `/administrator` é redirecionado
- [ ] Tela de login não tem aba de registro

### Tela de Login:
- [ ] Apenas formulário de login visível
- [ ] Mensagem "Entre em contato com administrador" aparece
- [ ] Não há opção de criar conta

---

## 🐛 Solução de Problemas

### Erro: "Não autenticado"
**Causa:** Token não está sendo enviado
**Solução:** Verifique se o token está no localStorage após o login

### Erro: "Acesso negado"
**Causa:** Usuário não é admin
**Solução:** Verifique se o tipo do usuário é "admin" no banco

### Sidebar não mostra link admin
**Causa:** Hook useIsAdmin não está funcionando
**Solução:** 
1. Abra o console do navegador
2. Execute: `localStorage.getItem('user')`
3. Verifique se o tipo é "admin"

### Middleware redireciona sempre
**Causa:** Token inválido ou expirado
**Solução:**
1. Limpe o localStorage
2. Faça login novamente

---

## 📞 Próximos Passos

Agora que o sistema está funcionando:

1. ✅ Crie os usuários reais do sistema
2. ✅ Configure senhas fortes
3. ✅ Teste todas as operações
4. ✅ Documente os usuários criados
5. ✅ Configure backup do banco de dados

---

## 🎉 Pronto!

Seu sistema de gerenciamento de usuários está operacional!

Para mais detalhes técnicos, veja: `IMPLEMENTACAO_ADMIN_README.md`
