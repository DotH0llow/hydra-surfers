# Hydra Surfers

Um runner 3D de três pistas, medieval, feito para um grupo fechado de ~30–40 amigos jogar durante uma temporada de 30 dias. Você foge da guarda real pela estrada do reino — vilas, florestas, muralhas, minas, cemitérios, campos de batalha, ruínas e pântanos — e compete com o grupo na mesma estrada, todo dia.

Feito com **Vite + TypeScript + three.js** (sem engine), UI em DOM sobre o canvas, publicado como **Cloudflare Worker com assets estáticos** mais uma pequena API em `/api` sobre **D1**.

## Jogar

| | Toque | Teclado |
|---|---|---|
| Trocar de pista | deslizar para os lados | ← → ou A D |
| Saltar | deslizar para cima | ↑, W ou Espaço |
| Rolar / cair rápido | deslizar para baixo | ↓, S ou Shift |
| Montaria | tocar duas vezes | E |
| Pausa | botão de pausa | Esc ou P |

## O que existe

**A estrada**
- Oito regiões que se sucedem na mesma corrida, cada uma com paleta, neblina, luz, cenário e padrões de obstáculo próprios. A ordem é uma função da seed: a mesma seed atravessa as mesmas regiões no mesmo metro.
- Obstáculos: barricadas (salte ou role por baixo), vigas suspensas (só rolando), carroças de carga (desvie ou corra pelo teto), carroças desgovernadas vindo na sua direção, rampas de feno, portais da muralha e pontes quebradas (só saltando).
- Eventos curtos na estrada (feira, emboscada, carroças soltas, ponte quebrada, tempestade com chuva, neblina) e clima por corrida (entardecer, neblina, noite, chuva). Eles só mudam densidade, moedas e luz.
- Poderes: Asas do Grifo (voo), Botas do Gigante, Amuleto Magnético, Bênção do Rei (2x), Égide (absorve um impacto), Ampulheta (desacelera a estrada sem tirar pontos).

**Habilidade**
- Combo que multiplica a pontuação; raspar perto de um obstáculo e esquivar no último instante (esquiva perfeita) dão pontos e combo.
- Depois de uns 4 minutos o cerco se fecha: intervalos mais curtos, padrões mais difíceis e zigue-zagues de carroças.
- Nenhuma estrada é impossível: um teste percorre milhares de estradas geradas (todos os desafios, com e sem Ampulheta) e prova que sempre há passagem.
- Sequência sem colisão, velocidade máxima, maior combo: tudo vira recorde pessoal.

**Por que voltar todo dia**
- **Corrida do Dia**: a mesma seed para todo o grupo, 3 tentativas válidas, placar próprio. O dia vira à meia-noite de Brasília.
- **Desafio semanal**: mutators diferentes a cada semana (uma só vida, galope, feira do rei, noite dos mortos…), 5 tentativas.
- **Torneios** de 48–72 h durante a temporada.
- **Contratos**: 3 diários e 4 semanais, os mesmos para todos. Os diários ficam abertos por três dias, então perder um dia não custa nada.
- **Sequência diária** de 7 dias; quebrar só reinicia o ciclo.
- **Temporada** de 30 níveis com recompensas cosméticas, equipamentos, títulos e peças de brasão, com bônus de XP para quem ficou para trás.
- **Conquistas** e **títulos** que aparecem ao lado do nome no placar; **brasão** montado por você.

**Builds**
- Uma arma, uma armadura e uma relíquia. Todo item dá algo e cobra algo (ex.: Moeda do Rei: +18% moedas, −5% pontos). Nas corridas ranqueadas o multiplicador da guilda e as melhorias da loja são desligados; a build continua valendo.

**O grupo**
- Livro dos Campeões: Diário, Semanal, Temporada e Torneio, e recordes de distância, moedas, combo e sequência limpa.
- **Fantasma** na Corrida do Dia: você corre ao lado do fantasma de quem está logo acima de você no placar (ou do seu melhor, se estiver em primeiro).
- Linha de rival na taverna ("#4 no Diário · 230 pontos atrás de Marina") e movimento de posição no fim da corrida.
- Missão do Reino: uma meta coletiva (ex.: 150.000 moedas somadas) com recompensa para todos.
- **Casas** (Leão, Corvo, Cervo, Serpente): escolha a sua no Brasão. A casa da semana é a de melhor média entre seus 5 melhores no Desafio Semanal; ter mais gente não ganha sozinho.

## Desenvolver

Requer Node 22 (ver `.nvmrc`).

```sh
npm ci
npm run dev          # http://localhost:5100 (ferramentas de dev: tecla `)
npm test             # testes unitários (vitest), incluindo a API contra SQLite real
npm run typecheck
npm run build        # build de produção em dist/
```

Parâmetros úteis na URL: `?debug=1` expõe `window.__game`, `?scenario=roof-run` começa num layout fixo, `?seed=123` fixa a estrada, `?mute=1`.

## Publicar

Veja [docs/DEPLOY.md](docs/DEPLOY.md) e [docs/ONLINE.md](docs/ONLINE.md). Resumo: crie o banco D1, cole o id em `wrangler.jsonc`, aplique `worker/schema.sql` e faça o deploy. Sem banco o jogo funciona com uma liga offline.

## Onde está cada coisa

```
src/game/        simulação determinística: corrida, jogador, obstáculos, spawner, regiões, eventos, habilidade, regras da corrida
src/meta/        progressão: contratos, conquistas, títulos, equipamentos, catálogo, modos, pipeline de fim de corrida
src/shared/      calendário, conteúdo da temporada e regras de plausibilidade (usados também pelo Worker)
src/online/      serviço de placar (http com fallback offline)
src/ui/          telas (taverna, contratos, arsenal, brasão, temporada, campeões, resultados)
worker/          API em Cloudflare Workers + D1 (schema.sql)
docs/            ASSETS, TUNING, DEVTOOLS, ONLINE, DEPLOY
```

A temporada inteira (datas, trilha de recompensas, desafios semanais, torneios, metas coletivas, preços) é editada em um só arquivo: [`src/shared/content/season.ts`](src/shared/content/season.ts).

Toda a arte e o som são placeholders procedurais definidos em `public/assets/manifest/*.json`; trocar por arquivos reais não exige código (ver [docs/ASSETS.md](docs/ASSETS.md)). Todo número de gameplay é ajustável ao vivo (ver [docs/TUNING.md](docs/TUNING.md)).
