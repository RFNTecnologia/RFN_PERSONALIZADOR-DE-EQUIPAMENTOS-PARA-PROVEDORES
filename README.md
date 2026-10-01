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

 No PowerShell, copie o modelo e prepare a configuração local:
 
 ```powershell
 Copy-Item .env.example .env
 ./scripts/bootstrap-local.ps1
```

O bootstrap preserva o `.env`, reutiliza a URI da API local anterior quando disponível e gera as credenciais administrativas ausentes sem mostrá-las. Confira `API_ADMIN_PASSWORD` no `.env` para entrar no painel. Para outro banco, preencha `DATABASE_URL` ou `SUPABASE_DB_URL` antes de executar. Uma URI Supabase pode usar Session pooler quando a conexão direta não funcionar; codifique caracteres especiais conforme as regras de URI.

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
- [x] Backup PostgreSQL local criptografado e agendado; restauração completa testada em instância descartável.
- [ ] Cópia off-site dos backups configurada e restauração testada em outra máquina. O backup DPAPI atual só pode ser descriptografado pela conta Windows que o criou.
- [ ] Um CPE de laboratório fez Inform, apareceu no GenieACS e teve parâmetros reais confirmados.
- [ ] Perfis foram testados por modelo e firmware antes de qualquer aplicação em lote.
- [ ] Procedimentos de rotação de senhas, recuperação e atualização documentados.

O projeto não pode configurar DNS, emitir/renovar certificados, habilitar backups no projeto Supabase ou confirmar parâmetros de um CPE sem acesso a esses serviços e equipamentos. Não tente impedir reset físico: após reset, a personalização só pode ser reaplicada quando o equipamento voltar a alcançar o ACS e o firmware permitir.

## Backup PostgreSQL local

Para a conexão PostgreSQL local já configurada neste ambiente, o backup manual é:

```powershell
.\scripts\backup-database.ps1
```

Os dumps são verificados e cifrados com DPAPI para a conta Windows atual, em `%LOCALAPPDATA%\RFN_Personalizar-roteadores\backups`, com retenção local de 30 dias. Para instalar a tarefa diária às 02:15:

```powershell
.\scripts\backup-database.ps1 -InstallSchedule
```

A tarefa requer esta conta conectada e o Docker Desktop ativo. A restauração do backup inicial foi testada em um PostgreSQL descartável e isolado. DPAPI não substitui uma cópia off-site: configure armazenamento externo cifrado e um procedimento de recuperação em outra máquina antes de produção. Backups gerenciados do Supabase devem ser habilitados no próprio projeto quando `DATABASE_URL` apontar para Supabase.

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
