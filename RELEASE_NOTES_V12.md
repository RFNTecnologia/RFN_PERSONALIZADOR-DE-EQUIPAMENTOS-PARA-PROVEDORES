# RFN Personalizar Roteadores — V12

## Base
V12 deriva do pacote RFN_Personalizar-roteadores entregue em 02/10/2026.

## Laboratório MR60X
- Catálogo determinístico para MERCUSYS MR60X.
- Caminhos exatos de PPPoE, Wi-Fi, TR-069 e VLAN observados no dump do modelo.
- RefreshObject, getParameterValues e write-probe seguro.
- Histórico persistente em `lab_runs`.
- `queued` é tratado apenas como tarefa aceita/enfileirada pelo ACS; a aplicação no CPE é confirmada por Inform/refresh posterior.

## Reset Recovery
A lógica experimental baseada em `Device.User.1/2` foi removida da V12. O endpoint antigo responde HTTP 410.

## Segurança do pacote
O release não contém `.env` nem o diretório `.git`. Use `.env.example` como modelo e gere novos segredos para o ambiente.

## V12.1 — fechamento do ciclo de tarefas
O laboratório não chama mais toda tarefa de 'queued'. Ele respeita os códigos do NBI: 200 significa execução concluída, 202 significa enfileirada para próximo Inform. Leituras executadas consultam novamente o CPE e registram o valor observado.
