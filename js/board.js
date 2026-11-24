export const fleet = [
  {name: 'Flugzeugträger', length: 5}, {name: 'Schlachtschiff', length: 4},
  {name: 'Kreuzer', length: 3}, {name: 'U-Boot', length: 3}, {name: 'Zerstörer', length: 2}
];

export function shipSpecs(config, catalog) {
  if (config.mode !== 'words') return fleet.slice(0, config.count);
  const candidates = [...new Set(catalog.words.map(row => row.word.toLocaleUpperCase('de')))]
    .filter(word => /^[A-ZÄÖÜẞ]+$/u.test(word) && [...word].length <= config.size && [...word].length >= 2)
    .sort((a, b) => a.length - b.length);
  if (candidates.length < config.count) throw Error('Für diese Flotte braucht der Katalog mehr passende Wörter.');
  return candidates.slice(0, config.count).map(word => ({name: word, letters: [...word], length: [...word].length}));
}

export function coordinates(cell, size) {
  return String.fromCharCode(65 + Math.floor(cell / size)) + (cell % size + 1);
}

export function placement(size, start, length, vertical, existing) {
  if (!Number.isInteger(start) || start < 0 || start >= size * size) return null;
  const position = vertical ? Math.floor(start / size) : start % size;
  if (position + length > size) return null;
  const cells = Array.from({length}, (_, index) => start + index * (vertical ? size : 1));
  const occupied = new Set(existing.flatMap(ship => ship?.cells || []));
  return cells.some(cell => occupied.has(cell)) ? null : cells;
}

export function randomFleet(size, specs, random = Math.random) {
  const board = [];
  function fill(index) {
    if (index === specs.length) return true;
    const {length} = specs[index];
    const starts = Array.from({length: size * size * 2}, (_, cell) => cell);
    while (starts.length) {
      const [start] = starts.splice(Math.floor(random() * starts.length), 1);
      const cells = placement(size, start >> 1, length, Boolean(start & 1), board);
      if (!cells) continue;
      board.push({...specs[index], cells});
      if (fill(index + 1)) return true;
      board.pop();
    }
    return false;
  }
  if (!fill(0)) throw Error('Diese Flotte passt nicht auf das Spielfeld.');
  return board;
}

export function neighbors(cell, size, diagonal = false) {
  const row = Math.floor(cell / size);
  const col = cell % size;
  const nearby = [];
  for (let y = -1; y <= 1; y++) {
    for (let x = -1; x <= 1; x++) {
      if ((diagonal || !x || !y) && row + y >= 0 && row + y < size && col + x >= 0 && col + x < size) {
        nearby.push((row + y) * size + col + x);
      }
    }
  }
  return nearby;
}

export function chooseShot(size, shots, level, random = Math.random) {
  const free = Array.from({length: size * size}, (_, cell) => cell).filter(cell => !shots[cell]);
  if (level > 1) {
    const hits = Object.keys(shots).filter(cell => shots[cell] === 'hit').map(Number);
    const targets = [...new Set(hits.flatMap(cell => neighbors(cell, size)))].filter(cell => !shots[cell]);
    if (targets.length) {
      if (level === 3) targets.sort((a, b) => neighbors(b, size).filter(cell => shots[cell] === 'hit').length -
        neighbors(a, size).filter(cell => shots[cell] === 'hit').length);
      return targets[Math.floor(random() * (level === 3 ? 1 : targets.length))];
    }
    const pattern = free.filter(cell => (Math.floor(cell / size) + cell % size) % 2 === 0);
    if (level === 3 && pattern.length) return pattern[Math.floor(random() * pattern.length)];
  }
  return free[Math.floor(random() * free.length)];
}
