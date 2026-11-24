import {coordinates} from './board.js';

export function turnDetails(game, mine, names, size) {
  const own = game.turn === mine;
  const player = names[game.turn];
  if (game.phase === 'over') return {title:names[game.winner] + ' gewinnt!', instruction:'Der letzte Treffer hat die Partie entschieden.'};
  if (game.phase === 'question') return own
    ? {title:'Du bist dran', instruction:'Beantworte die Frage, um einen Schuss freizuschalten.'}
    : {title:player + ' beantwortet eine Frage', instruction:'Du kannst mitlesen. Warte auf deinen Zug.'};
  if (game.phase === 'target') return own
    ? {title:'Feuer frei!', instruction:'Tippe auf ein freies Feld der gegnerischen Flotte.'}
    : {title:player + ' zielt', instruction:'Behalte deine Flotte im Blick.'};
  const cell = coordinates(game.pending.cell, size);
  if (game.pending.power === 'radar') return own
    ? {title:'Radar scannt ' + cell, instruction:'Der Scan wird ausgewertet.'}
    : {title:player + ' scannt dein Feld', instruction:'Radar über ' + cell + '.'};
  return own
    ? {title:'Schuss auf ' + cell, instruction:'Der Schuss ist unterwegs.'}
    : {title:'Ankommender Schuss auf ' + cell, instruction:player + ' hat auf deine Flotte geschossen.'};
}

export function hullTiles(ships, size) {
  const tiles = new Map();
  for (const ship of ships) {
    if (!ship?.cells?.length) continue;
    const direction = ship.cells[1] - ship.cells[0] === size ? 'vertical' : 'horizontal';
    ship.cells.forEach((cell, index) => {
      const part = index === 0 ? 'stern' : index === ship.cells.length - 1 ? 'bow' : 'middle';
      tiles.set(cell, {direction, part, letter:ship.letters?.[index] || '', name:ship.name,
        cabin:index === Math.floor((ship.cells.length - 1) / 2)});
    });
  }
  return tiles;
}
