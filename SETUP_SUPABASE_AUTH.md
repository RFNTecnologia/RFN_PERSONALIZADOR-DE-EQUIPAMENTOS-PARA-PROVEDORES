# RFN V12.3 — Integração Supabase Auth

## O que foi integrado
- Login por e-mail/senha com Supabase Auth.
- Sessão de acesso administrativa sincronizada em cookie HttpOnly, SameSite=Strict.
- Backend valida o token com Supabase Auth e exige `profiles.role = 'admin'` para as APIs do painel.
- `/api/auth/me` passa a ser endpoint de verificação usado pelo Nginx para proteger `/genieacs/`.
- Logout encerra a sessão local e solicita logout ao Supabase.
- Renovação do token pelo refresh token.
- Configuração por `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` no `.env`.

## Configurar
1. Faça backup e atualize os arquivos na pasta original do projeto.
2. Copie `.env.example` para `.env`, se ainda não existir. A URL e a publishable key do projeto RFN já estão preenchidas no modelo.
3. Mantenha `DATABASE_URL` apontando para o PostgreSQL operacional que já contém os dados do RFN. Os perfis/Auth são consultados no projeto Supabase indicado por `SUPABASE_URL`; não é obrigatório mover os dados operacionais para o banco remoto só para usar Supabase Auth. Não use a publishable key como senha do banco e não compartilhe a senha do banco no chat.
4. Confirme que `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` no `.env` pertencem ao mesmo projeto configurado em `frontend/index.html`. Neste pacote, o frontend está configurado para o projeto RFN `fhlwmpeakyxrvnzwyiwv`.
5. Execute `./scripts/bootstrap-local.ps1` no PowerShell para gerar os segredos locais ausentes, depois valide `docker compose config -q`.
6. Reconstrua e reinicie: `docker compose up -d --build api nginx` (ou `docker compose up -d --build` se for uma instalação nova e todos os serviços precisarem iniciar).
7. Crie o usuário no Supabase Dashboard → Authentication → Users (e-mail/senha). Confirme o e-mail se a configuração do projeto exigir.
8. Promova explicitamente a primeira conta administrativa, substituindo o e-mail abaixo:

```sql
update public.profiles
set role = 'admin', updated_at = now()
where email = 'SEU_EMAIL_ADMIN@EXEMPLO.COM';
```

9. Entre no painel com o e-mail e senha dessa conta. Usuários novos recebem `operator` e não têm acesso administrativo até serem promovidos explicitamente.

## Observações de segurança
- Nunca coloque uma secret/service-role key no frontend ou no `.env` desta integração.
- A publishable key é própria para cliente; a proteção administrativa vem da validação do token e do papel no backend.
- A aplicação mantém as tabelas operacionais em `DATABASE_URL` e lê `public.profiles` pelo Supabase REST usando o token do usuário; assim a política RLS `profiles_select_own` é aplicada sem duplicar o papel do usuário no banco local.
- Configure URLs de redirecionamento e SMTP no Supabase Auth se for usar confirmação de e-mail/recuperação de senha.
- Teste login, logout, sessão expirada, usuário `operator` e acesso direto a `/genieacs/` antes de produção HTTPS.
- O backend ainda usa a conexão PostgreSQL direta para consultas operacionais. A proteção de APIs ocorre no middleware Express; a RLS de `profiles` protege acessos via API Supabase.
