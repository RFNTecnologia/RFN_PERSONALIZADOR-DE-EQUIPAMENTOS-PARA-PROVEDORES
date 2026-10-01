# RFN_Personalizar-roteadores — Fase 1

Stack inicial:
- GenieACS 1.2.x: ACS TR-069 (CWMP)
- MongoDB: banco do GenieACS
- Redis: fila/cache do GenieACS
- Supabase PostgreSQL: banco da plataforma do provedor
- Node.js/Express: API da plataforma
- Nginx: proxy reverso
- Docker Compose

## O que esta fase entrega

- Infraestrutura Docker pronta.
- ACS TR-069 exposto na porta 7547.
- NBI do GenieACS na porta 7557, somente na rede Docker.
- File Server do GenieACS na porta 7567, somente na rede Docker.
- UI do GenieACS na porta 3000, somente na rede Docker.
- API própria em /api.
- Cadastro inicial de clientes, equipamentos e perfis.
- Supabase PostgreSQL para os dados da plataforma.
- Estrutura para extensões/provisionamento por fabricante.
- Nginx como ponto único de entrada.

## Configuração inicial

No PowerShell, copie o modelo e gere os segredos:

```powershell
Copy-Item .env.example .env
.\scripts\generate-secrets.ps1
```

Copie os valores gerados para `.env` e defina `API_ADMIN_PASSWORD` com uma senha exclusiva de pelo menos 14 caracteres. Configure também `SUPABASE_DB_URL` com a URI PostgreSQL de Supabase > Connect. Use Session pooler se a conexão direta não funcionar na rede. Codifique caracteres especiais da senha conforme as regras de URI.

Na primeira inicialização, a API aplica os arquivos SQL de `backend/migrations`. As migrations precisam continuar idempotentes porque são verificadas a cada inicialização. A chave secreta da API do Supabase não é a senha PostgreSQL; não coloque chaves de serviço no frontend.

Valide e inicie o ambiente de desenvolvimento:

```powershell
docker compose config
docker compose build
docker compose up -d
docker compose ps
docker compose logs -f genieacs api nginx
```

O painel solicita o usuário e a senha configurados em `API_ADMIN_USERNAME` e `API_ADMIN_PASSWORD`. Entre primeiro no painel para abrir a interface `/genieacs/`; ambas exigem a mesma sessão. Há um usuário administrativo único; não há perfis ou contas individuais nesta fase.

## Produção com HTTPS

Configure DNS para o servidor e obtenha um certificado TLS. Coloque a cadeia em `certs/fullchain.pem` e a chave privada em `certs/privkey.pem`; a pasta `certs/` é ignorada pelo Git. Depois valide e inicie com o overlay:

```powershell
docker compose -f docker-compose.yml -f docker-compose.production.yml config
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d --build
```

O overlay redireciona HTTP para HTTPS e ativa cookies `Secure`. Sem os arquivos de certificado o Nginx de produção não inicia. No firewall, libere apenas `80`, `443` e `7547` conforme a necessidade. O NBI `7557`, File Server `7567`, UI interna `3000`, MongoDB, Redis e PostgreSQL não são publicados no host.

O TLS administrativo está preparado; o endpoint CWMP `7547` ainda não recebe certificado TLS nesta configuração. Não anuncie `https://` no ACS URL até configurar e testar TLS para CWMP no GenieACS/CPE. Restrinja a porta CWMP por firewall às redes dos CPEs sempre que possível.

## Checklist de liberação

- [ ] `docker compose config` e `docker compose ... config` com overlay de produção terminam sem erro.
- [ ] Segredos exclusivos definidos no `.env`; o arquivo não é versionado nem incluído em imagens.
- [ ] DNS, certificado, renovação do certificado e firewall conferidos.
- [ ] Login, logout, bloqueio de API anônima e bloqueio da UI GenieACS anônima testados.
- [ ] `/health`, healthcheck da API, logs e alertas operacionais verificados.
- [ ] Backups automáticos habilitados conforme o plano do Supabase e restauração testada; para PostgreSQL local, proteger também o volume `postgres_data`.
- [ ] Um CPE de laboratório fez Inform, apareceu no GenieACS e teve parâmetros reais confirmados.
- [ ] Perfis foram testados por modelo e firmware antes de qualquer aplicação em lote.
- [ ] Procedimentos de rotação de senhas, recuperação e atualização documentados.

O projeto não pode configurar DNS, emitir/renovar certificados, habilitar backups no projeto Supabase ou confirmar parâmetros de um CPE sem acesso a esses serviços e equipamentos. Não tente impedir reset físico: após reset, a personalização só pode ser reaplicada quando o equipamento voltar a alcançar o ACS e o firmware permitir.

## Primeiro teste com CPE

1. Acesse o painel por `http://SEU_IP/` em desenvolvimento ou `https://SEU_DOMINIO/` em produção e entre com a conta administrativa.
2. Configure no CPE o ACS URL `http://SEU_DOMINIO:7547/` enquanto CWMP TLS não estiver configurado.
3. Ligue o CPE à Internet e confira `docker compose logs -f genieacs`.
4. Confirme o dispositivo e seus parâmetros reais na UI do GenieACS.
5. Teste um perfil em laboratório antes de associá-lo a equipamentos de clientes.

## Estrutura

- `backend/`: API da plataforma
- `frontend/`: painel inicial
- `genieacs/`: extensões e configuração
- `nginx/`: proxy
- `backend/migrations/`: esquema e migrations do banco
- `postgres/`: configuração opcional do PostgreSQL em contêiner
