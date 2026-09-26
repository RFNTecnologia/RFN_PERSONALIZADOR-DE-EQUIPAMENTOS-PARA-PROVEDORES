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

## IMPORTANTE

Antes de produção:
1. Troque todas as senhas no `.env`.
2. Gere um `GENIEACS_UI_JWT_SECRET` forte.
3. Configure DNS e HTTPS.
4. Não exponha MongoDB, Redis, PostgreSQL ou NBI diretamente à Internet.
5. Configure autenticação/ACL da API.
6. Valide os parâmetros TR-069 efetivamente suportados por cada firmware.
7. Não use este projeto para bloquear o reset físico do equipamento; o objetivo é reprovisionar depois do reset quando o CPE voltar a alcançar o ACS.

## Instalação

```bash
cp .env.example .env
nano .env

# Preencha SUPABASE_DB_URL com a URI PostgreSQL em Supabase > Connect.
# Use Session pooler se a conexão direta não estiver disponível na sua rede.

docker compose build
docker compose up -d

docker compose ps
docker compose logs -f genieacs
```

Na primeira inicialização, a API aplica os arquivos SQL de `backend/migrations`
ao banco configurado. A chave secreta da API do Supabase não é a senha PostgreSQL:
use a URI de conexão do banco e mantenha qualquer chave secreta fora do frontend.

Acesse:
- Portal/API: `http://SEU_IP/`
- GenieACS UI: `http://SEU_IP/genieacs/`
- ACS/CWMP para CPE: `http://SEU_DOMINIO:7547/`

Em produção, use HTTPS para a interface administrativa e, quando suportado/configurado no CPE, CWMP sobre HTTPS.

## Primeiro teste

1. Cadastre um equipamento na API ou pelo SQL.
2. Configure no CPE o ACS URL para `http(s)://SEU_DOMINIO:7547/`.
3. Ligue o equipamento à Internet.
4. Verifique:
```bash
docker compose logs -f genieacs
```
5. Abra a UI do GenieACS e confirme o CPE.

## Estrutura

- `backend/`: API da plataforma
- `frontend/`: painel inicial
- `genieacs/`: extensões e configuração
- `nginx/`: proxy
- `backend/migrations/`: esquema e migrations do banco
- `postgres/`: configuração opcional do PostgreSQL em contêiner
