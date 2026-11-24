import {accepts, getQuestion} from './questions.js';
import {neighbors} from './board.js';

export const powers = {radar:'Radar', double:'Doppelschuss', air:'Luftangriff', shield:'Schutzschild', joker:'Joker'};
export const ownStats = () => ({right: 0, wrong: 0, streak: 0, best: 0, time: 0, credits: 0, sunk: 0});

export function initialGame(config, seed, now) {
  return {
    revision: 0, seed, index: 0, turn: 0, phase: 'question', started: now,
    asked: now, deadline: now + config.time * 1000, remaining: 0,
    p: [{stats: ownStats()}, {stats: ownStats()}]
  };
}

function nextTurn(game, config, now) {
  game.turn = 1 - game.turn;
  game.index += 1;
  game.phase = 'question';
  game.asked = now;
  game.deadline = now + config.time * 1000;
  game.remaining = 0;
  delete game.power;
  delete game.joker;
}

export function cellAvailable(game, config, cell) {
  return Number.isInteger(cell) && cell >= 0 && cell < config.size ** 2 && !game.p[game.turn].shots?.[cell];
}

export function battleReport(game, config, board) {
  if (game?.phase !== 'pending' || !board?.length) return;
  const {cell,power} = game.pending;
  const {shots = {}} = game.p[game.turn];
  const occupied = index => board.some(ship => ship.cells.includes(index));
  if (power === 'radar') return {count:neighbors(cell,config.size,true).filter(index => !shots[index] && occupied(index)).length};
  if (game.p[1-game.turn].shield) return {hits:[],sunk:[]};
  const cells = (power === 'air' ? neighbors(cell,config.size) : [cell]).filter(index => !shots[index]);
  const hits = cells.filter(occupied);
  const sunk = board.filter(ship => ship.cells.some(index => hits.includes(index)) &&
    ship.cells.every(index => hits.includes(index) || shots[index] === 'hit'))
    .map(({name,cells}) => ({name,cells}));
  return {hits,sunk};
}

function validReport(report, cells, shots, config) {
  if (!Array.isArray(report.hits) || report.hits.length > cells.length ||
      !report.hits.every(cell => cells.includes(cell)) || !Array.isArray(report.sunk) ||
      report.sunk.length > config.count) return false;
  const unique = new Set();
  return report.sunk.every(ship => {
    if (!ship || typeof ship.name !== 'string' || ship.name.length > 40 || !Array.isArray(ship.cells) ||
        ship.cells.length < 2 || ship.cells.length > config.size || !ship.cells.some(cell => report.hits.includes(cell))) return false;
    return ship.cells.every(cell => {
      if (unique.has(cell) || (!report.hits.includes(cell) && shots[cell] !== 'hit')) return false;
      unique.add(cell);
      return true;
    });
  });
}

export function transition(previous, config, pool, actor, action, now, board, remoteReport) {
  if (!previous || previous.phase === 'over' || action.revision !== previous.revision) return;
  const game = JSON.parse(JSON.stringify(previous));
  const attacker = game.p[game.turn];
  const defender = game.p[1 - game.turn];
  const stats = attacker.stats;
  const {type} = action;

  if (type === 'resolve') {
    if (actor === game.turn || game.phase !== 'pending') return;
    const report = remoteReport || battleReport(game,config,board);
    if (!report) return;
    const {cell, power} = game.pending;
    delete game.pending;
    if (power === 'radar') {
      if (!Number.isInteger(report.count) || report.count < 0 || report.count > neighbors(cell,config.size,true).length) return;
      attacker.scan = {cell, count:report.count};
      game.phase = 'target';
      game.event = {kind: 'radar', actor: game.turn};
    } else {
      const cells = power === 'air' ? neighbors(cell, config.size) : [cell];
      const shots = attacker.shots ||= {};
      let kind = 'miss';
      let sunk = [];
      if (defender.shield) {
        delete defender.shield;
        kind = 'blocked';
      } else {
        const targets = cells.filter(index => !shots[index]);
        if (!validReport(report,targets,shots,config)) return;
        for (const index of targets) {
          const hit = report.hits.includes(index);
          shots[index] = hit ? 'hit' : 'miss';
          if (hit) kind = 'hit';
        }
        for (const ship of report.sunk) {
          ship.cells.forEach(index => { shots[index] = 'sunk'; });
          stats.sunk++;
          sunk.push(ship.name);
          (attacker.wrecks ||= []).push({name:ship.name,cells:ship.cells});
        }
        if (sunk.length) kind = 'sunk';
      }
      game.event = {kind, actor: game.turn, cell, ...(sunk.length ? {sunk} : {})};
      if (stats.sunk === config.count) {
        game.phase = 'over';
        game.winner = game.turn;
        game.finished = now;
      } else if (--game.remaining > 0) {
        game.phase = 'target';
      } else {
        nextTurn(game, config, now);
      }
    }
  } else {
    if (actor !== game.turn && type !== 'timeout') return;
    if (type === 'timeout' || type === 'answer') {
      if (game.phase !== 'question' || (type === 'timeout' ? now < game.deadline : now >= game.deadline)) return;
      const question = getQuestion(pool, game.seed, game.index);
      const correct = type === 'answer' && accepts(question, action.value);
      stats.time += Math.max(0, Math.min(config.time * 1000, now - game.asked));
      if (correct) {
        stats.right++;
        stats.streak++;
        stats.best = Math.max(stats.best, stats.streak);
        if (config.special && stats.streak % 3 === 0) stats.credits = Math.min(2, stats.credits + 1);
        game.phase = 'target';
        game.remaining = 1;
        game.event = {kind: 'right', actor};
      } else {
        stats.wrong++;
        stats.streak = 0;
        (attacker.errors ||= []).push({word: question.word, prompt: question.prompt, answer: question.answer});
        game.event = {kind: type === 'timeout' ? 'timeout' : 'wrong', actor: game.turn, answer: question.answer};
        nextTurn(game, config, now);
      }
    } else if (type === 'power') {
      if (!config.special || !stats.credits || !Object.prototype.hasOwnProperty.call(powers, action.power)) return;
      if (action.power === 'joker') {
        if (game.phase !== 'question' || game.joker || now >= game.deadline ||
            getQuestion(pool, game.seed, game.index).options.length < 4) return;
        game.joker = true;
      } else {
        if (game.phase !== 'target' || game.power || game.remaining !== 1 || game.usedPower === game.index) return;
        if (action.power === 'shield' && attacker.shield) return;
        game.usedPower = game.index;
        if (action.power === 'shield') attacker.shield = true;
        else if (action.power === 'double') game.remaining = 2;
        else game.power = action.power;
      }
      stats.credits--;
      delete game.event;
    } else if (type === 'fire') {
      if (game.phase !== 'target' || !cellAvailable(game, config, action.cell)) return;
      game.pending = {cell: action.cell, ...(game.power ? {power: game.power} : {})};
      delete game.power;
      delete game.event;
      game.phase = 'pending';
    } else return;
  }
  game.revision++;
  return game;
}

export function summary(game, player) {
  const {stats, shots = {}, errors = []} = game.p[player];
  const fired = Object.values(shots);
  const hits = fired.filter(value => value !== 'miss').length;
  return {...stats, errors, accuracy: fired.length ? Math.round(hits * 100 / fired.length) : 0,
    average: stats.right + stats.wrong ? stats.time / (stats.right + stats.wrong) / 1000 : 0,
    points: stats.right * 10 + hits * 5 + stats.sunk * 25};
}
