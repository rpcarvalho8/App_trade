# Dossiê de produto e negócio — gestão de condomínios

Este pacote reúne **tudo o que o código e a documentação existente permitem afirmar** sobre o projecto, e **reformula o plano** para o objectivo de mercado:

> Um produto simples e eficaz, utilizável em **todos os tipos de condomínio**, que **reduza ao máximo a dependência de terceiros** na gestão (administradora, Excel do contabilista, WhatsApp, reconciliação manual).

## Como usar esta pasta

| Ficheiro | Para quê |
|----------|----------|
| [dossie-produto-e-negocio.md](./dossie-produto-e-negocio.md) | Fonte de verdade: estado actual, visão, business plan, diagramas, plano de implementação, gaps |
| [NOTAS.md](./NOTAS.md) | As tuas notas de mercado — cola aqui o que tens vindo a retirar; o agente da **nova conversa** deve tratar este ficheiro como prioridade sobre o dossiê |
| [PROMPT-NOVA-CONVERSA.md](./PROMPT-NOVA-CONVERSA.md) | Texto pronto a colar num **novo** agente Cursor |

## Repositórios

| Repo | Papel |
|------|--------|
| [rpcarvalho8/condominio](https://github.com/rpcarvalho8/condominio) | Código actual (produção do condomínio piloto). **Casa certa deste dossiê a médio prazo.** |
| [rpcarvalho8/condominio_buildingmind_v2](https://github.com/rpcarvalho8/condominio_buildingmind_v2) | Antecessor / snapshot; a v2 README ainda fala em Banco CTT e JWT — **não usar como fonte de verdade** |
| [rpcarvalho8/App_trade](https://github.com/rpcarvalho8/App_trade) | Trading OS. Esta pasta `docs-condominio/` está aqui **só porque o agente desta conversa só consegue escrever neste repo**. Não misturar código de trading com o de condomínios. |

## Branch desta revisão

`cursor/plano-negocio-condominios-95f1` (neste `App_trade`) — **só documentação**. Não altera `trading-os/`.

A conversa de trading e a branch `cursor/mesa-operacao-xauusd-solusd-95f1` ficam intactas.

Quando abrires a nova conversa, aponta-a a **esta branch** (para editar `NOTAS.md` e o dossiê) **ou** copia `docs-condominio/` para `condominio/docs/negocio/` e trabalha lá. Não implementes a app de condomínios dentro de `App_trade`.
