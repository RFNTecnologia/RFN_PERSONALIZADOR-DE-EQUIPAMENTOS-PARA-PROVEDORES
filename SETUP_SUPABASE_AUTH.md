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
1. Atualize a pasta do projeto com os arquivos desta versão e faça backup antes de substituir arquivos.
2. No `.env`, configure:
   - `SUPABASE_URL=https://fhlwmpeakyxrvnzwyiwv.supabase.co`
   - `SUPABASE_PUBLISHABLE_KEY=sb_publishable_ehrwtRtHihoUDaJA5iqfhw_CJJ-UodJ`
3. Mantenha `DATABASE_URL` apontando para o PostgreSQL usado pela API, com permissão para ler `public.profiles` e para executar as migrations da aplicação existentes.
4. Reconstrua e reinicie: `docker compose up -d --build api nginx`.
5. Crie o usuário no Supabase Dashboard → Authentication → Users (e-mail/senha). Confirme o e-mail se a configuração do projeto exigir.
6. Promova explicitamente a primeira conta administrativa, substituindo o e-mail abaixo:

```sql
update public.profiles
set role = 'admin', updated_at = now()
where email = 'SEU_EMAIL_ADMIN@EXEMPLO.COM';
```

7. Entre no painel com o e-mail e senha dessa conta. Usuários novos recebem `operator` e não têm acesso administrativo até serem promovidos explicitamente.

## Observações de segurança
- Nunca coloque uma secret/service-role key no frontend ou no `.env` desta integração.
- A publishable key é própria para cliente; a proteção administrativa vem da validação do token e do papel no backend.
- Configure URLs de redirecionamento e SMTP no Supabase Auth se for usar confirmação de e-mail/recuperação de senha.
- Teste login, logout, sessão expirada, usuário `operator` e acesso direto a `/genieacs/` antes de produção HTTPS.
- O backend ainda usa a conexão PostgreSQL direta para consultas operacionais. A proteção de APIs ocorre no middleware Express; a RLS de `profiles` protege acessos via API Supabase.
