# Phase 1: Link Curto com Preview WhatsApp — Discussion Log

> **Audit trail only.** Não usar como input para planning, research ou execução.
> Decisões estão capturadas no CONTEXT.md — este log preserva as alternativas consideradas.

**Date:** 2026-06-11
**Phase:** 01-link-curto-whatsapp
**Areas discussed:** Storage engine, Cybersecurity, Ciclo de vida dos links, Cache do proxy de imagem

---

## Contexto de entrada

Usuária informou que o volume real é **5.000 links/mês** (vs. estimativa do SPEC de < 500/ano). Isso motivou a revisão da decisão de storage e a introdução de expiração de links.

---

## Storage engine

| Opção | Descrição | Selecionada |
|-------|-----------|-------------|
| Postgres no Railway | Free tier até $5/mês, robusto, 60k+ registros sem problema | ✓ |
| SQLite + volume Railway | Arquivo único, precisa montar volume persistente | |

**Escolha:** Postgres no Railway
**Notes:** Usuária não sabia se já tinha Postgres no Railway (não tinha). Escolheu Postgres como serviço novo. Para acesso: `pg` (node-postgres) direto, sem ORM. Motivo: 1 tabela com 5 operações simples, Prisma seria overhead.

---

## Cybersecurity

| Opção | Descrição | Selecionada |
|-------|-----------|-------------|
| Todas as 4 mitigações | SSRF allowlist, redirect validation, rate limit 60/min, SQL parametrizado | ✓ |
| Só críticas (SSRF + SQL) | Rate limit e validar URL podem vir depois | |

**Escolha:** Todas as 4 mitigações
**Allowlist CDN selecionada:** Shopee (`*.shopee.com.br`, `*.szcdn.com`), Amazon (`*.ssl-images-amazon.com`, `*.cloudfront.net`), ML (`*.mlstatic.com`)
**Notes:** Usuária iniciou a discussão de segurança — foi adicionada como área extra durante o discuss. Boa prática de segurança para um link shortener.

---

## Ciclo de vida dos links

| Opção | Descrição | Selecionada |
|-------|-----------|-------------|
| Redirecionar normalmente (sem expiração) | Link vive para sempre | |
| Redirecionar para busca do produto | Link expirado → busca com tag de afiliado | ✓ |
| Link para de funcionar após 45 dias | Retorna página "deal encerrado" | |
| Deletar após 90 dias | Limpeza automática, perde histórico | |
| Nunca deletar | Postgres aguenta, dados analíticos preservados | ✓ |

**Escolha de expiração:** 45 dias → redirect para busca do produto com tag de afiliado
**Escolha de limpeza:** Nunca deletar registros
**Notes:** Usuária sugeriu "gerar um link novo se ele venceu" — interpretado como redirecionar para busca da plataforma original com tag de afiliado (não literal "novo link"). Esta decisão **revisa o SPEC** que tinha expiração como out of scope.

---

## Cache do proxy de imagem

| Opção | Descrição | Selecionada |
|-------|-----------|-------------|
| Cache em memória + headers HTTP | Map LRU 200 entradas + Cache-Control: 24h | ✓ |
| Só headers HTTP | Mais simples, risco de rate-limit CDN | |
| Disco no Railway | Volume persistente + gerenciamento de espaço | |

**Escolha:** Cache em memória (LRU 200 entradas) + `Cache-Control: public, max-age=86400`
**Notes:** Balança simplicidade (sem disco/volume extra) com performance (hot images servidas do Map em memória).

---

## Claude's Discretion

- Estrutura da URL de busca para links expirados (formato exato dos query params por plataforma)
- Tamanho do pool de conexões Postgres
- Estratégia de retry em falha de conexão Postgres

## Deferred Ideas

- Subdomínio mais curto (`l.thaisbonomi.com.br`) — configuração DNS/Railway, zero código
- Meta API integration — chip pendente, usa os mesmos links curtos quando configurado
- Dashboard web de analytics
- "Renovar deal" com novo preço — feature de gestão separada
- QR Code por link
