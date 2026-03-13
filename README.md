# Connect Four — 4 Levels

A polished, mobile-friendly Connect Four web game with four progressively harder AI opponents. No dependencies — pure HTML, CSS, and JavaScript.

## Play

Open `index.html` in any modern browser. No build step required.

## Levels

| Level | AI Name  | Strategy |
|-------|----------|----------|
| 1     | Rookie   | Plays random moves |
| 2     | Beginner | Snaps to win/block, otherwise random |
| 3     | Skilled  | Minimax search (depth 4) with alpha-beta pruning |
| 4     | Expert   | Minimax search (depth 7) with alpha-beta pruning + positional eval |

## Features

- Drop discs by clicking a column or the arrow buttons above the board
- Win detection highlights the four connected cells
- Level progress bar tracks completed levels
- Animated disc drop and win flash effects
- Responsive layout — works on mobile and desktop
- Clean modal overlays for win / lose / draw results

## Files

```
index.html   — markup and structure
styles.css   — all visual styles and animations
script.js    — game logic and AI engine
README.md    — this file
```
