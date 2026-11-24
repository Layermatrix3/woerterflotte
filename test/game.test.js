import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {accepts, getQuestion, questionPool, seeded, validateCatalog, modes} from '../js/questions.js';
import {chooseShot, placement, randomFleet, shipSpecs} from '../js/board.js';
import {initialGame, summary, transition} from '../js/game.js';

const catalog = validateCatalog(JSON.parse(readFileSync(new URL('../data/fremdwoerter.json', import.meta.url))));
const config = {size:6,count:2,time:15,special:true,level:3,mode:'mixed'};
const pool = questionPool(catalog);
const random = seeded(1234);
const answer = game => getQuestion(pool, game.seed, game.index).answer;
const act = (game, actor, type, details = {}, now = game.asked + 100, board) =>
  transition(game, config, pool, actor, {type, revision:game.revision, ...details}, now, board);

test('100 Wörter, sechs Fragetypen und eine vollständige Runde ohne Wiederholungen', () => {
  assert.equal(catalog.words.length, 100);
  assert.equal(pool.length, 100 * 6);
  assert.equal(new Set(pool.map(question => question.type)).size, 6);
  for (const word of ['Akrobat','Chamäleon','Jongleur','Hypothese','Mikrofon','Roboter']) {
    assert.equal(pool.filter(question => question.word === word).length, 6);
  }
  assert.ok(catalog.words.every(word => new Set(word.wrong).size === 3));
  const prompts = Array.from({length:pool.length}, (_, index) => getQuestion(pool, 743, index).prompt);
  assert.equal(new Set(prompts).size, pool.length);
  assert.ok(accepts(getQuestion(pool.filter(q => q.word === 'Paragraph' && q.type === 'text'), 1, 0), ' paragraf '));
  assert.deepEqual(new Set(questionPool(catalog, 'spelling').map(q => q.options.length)), new Set([0]));
  assert.deepEqual(new Set(questionPool(catalog, 'meaning').map(q => q.type)), new Set(['meaning','match']));
  for (const mode of Object.keys(modes)) assert.ok(questionPool(catalog, mode, 1).length > 0);
});

test('Platzierung auf 6 × 6, 8 × 8 und 10 × 10, einschließlich Wortschiffe', () => {
  assert.equal(placement(6,5,2,false,[]), null);
  assert.equal(placement(6,30,2,true,[]), null);
  assert.equal(placement(6,0,2,false,[{cells:[1,7]}]), null);
  assert.deepEqual(placement(6,1,3,true,[]), [1,7,13]);
  for (const size of [6,8,10]) {
    for (const mode of ['classic','words']) {
      const specs = shipSpecs({size,mode,count:5}, catalog);
      for (let attempt = 0; attempt < 12; attempt++) {
        const board = randomFleet(size, specs, random);
        const cells = board.flatMap(ship => ship.cells);
        assert.equal(new Set(cells).size, cells.length);
        assert.equal(board.length, 5);
        assert.ok(cells.every(cell => cell >= 0 && cell < size ** 2));
        if (mode === 'words') {
          assert.ok(board.every(ship => ship.letters.length === ship.cells.length));
        }
      }
    }
  }
});

test('Zugfolge, richtige Lösung, Timeout, Koordinaten und alte Revisionen', () => {
  const started = initialGame(config, 123, 10_000);
  assert.equal(act(started, 0, 'fire', {cell:0}), undefined);
  assert.equal(act(started, 1, 'answer', {value:answer(started)}), undefined);
  assert.equal(act(started, 0, 'timeout', {}, started.deadline - 1), undefined);
  assert.equal(act(started, 0, 'answer', {value:answer(started)}, started.deadline), undefined);
  const expired = act(started, 1, 'timeout', {}, started.deadline);
  assert.equal(expired.turn, 1);
  assert.equal(expired.event.answer, answer(started));
  assert.equal(expired.p[0].errors[0].answer, answer(started));
  const game = act(expired, 1, 'answer', {value:answer(expired)});
  assert.equal(game.phase, 'target');
  assert.equal(act(game, 1, 'fire', {cell:36}), undefined);
  assert.equal(act(game, 1, 'fire', {cell:1, revision:0}), undefined);
  const pending = act(game, 1, 'fire', {cell:2});
  const board = [{name:'Schiff', cells:[0,1]}];
  assert.equal(act(pending, 1, 'resolve', {}, pending.asked + 120, board), undefined);
  assert.equal(act(pending, 1, 'fire', {cell:3}), undefined);
  assert.equal(act(pending, 0, 'resolve', {}, pending.asked + 120, board).p[1].shots[2], 'miss');
});

test('Treffer, Versenkung, Sieger und Ergebnisstatistik', () => {
  const board = [{name:'Thema', cells:[0,1]}, {name:'Chor', cells:[8,14]}];
  let game = initialGame(config, 743, 1000);
  for (const cell of [0,5,1,8,14]) {
    game = act(game, 0, 'answer', {value:answer(game)});
    game = act(game, 0, 'fire', {cell});
    game = act(game, 1, 'resolve', {}, game.asked + 150, board);
    if (game.phase === 'over') break;
    game = act(game, 1, 'answer', {value:'Falsche Antwort'});
  }
  assert.equal(game.winner, 0);
  assert.equal(game.event.sunk[0], 'Chor');
  assert.equal(game.p[0].shots[0], 'sunk');
  assert.equal(game.p[0].shots[5], 'miss');
  const player = summary(game, 0);
  assert.equal(player.right, 5);
  assert.equal(player.sunk, 2);
  assert.equal(player.accuracy, 80);
  assert.equal(player.best, 5);
  assert.equal(summary(game, 1).errors.length, 4);
  assert.equal(act(game, 0, 'answer', {value:answer(game)}), undefined);
});

test('Ladung nach drei richtigen Antworten, Doppelschuss, Radar, Luftangriff, Schild und Joker', () => {
  const board = [{name:'Alpha',cells:[0,1]},{name:'Beta',cells:[6,7]}];
  let game = initialGame(config, 82, 1000);
  for (let i = 0; i < 2; i++) {
    game = act(game, 0, 'answer', {value:answer(game)});
    game = act(game, 0, 'fire', {cell:10+i});
    game = act(game, 1, 'resolve', {}, game.asked + 150, board);
    game = act(game, 1, 'answer', {value:'Falsche Antwort'});
  }
  const gameBefore = game;
  game = act(game, 0, 'answer', {value:answer(game)});
  assert.equal(game.p[0].stats.credits, 1);
  const double = act(game, 0, 'power', {power:'double'});
  assert.equal(double.remaining, 2);
  let state = act(double, 0, 'fire', {cell:0});
  state = act(state, 1, 'resolve', {}, state.asked + 130, board);
  assert.equal(state.phase, 'target');
  assert.equal(state.remaining, 1);
  assert.equal(act(state, 0, 'fire', {cell:0}), undefined);
  for (const power of ['radar','air','shield']) {
    state = act(game, 0, 'power', {power});
    if (power === 'shield') state.p[1].shield = true;
    state = act(state, 0, 'fire', {cell:0});
    state = act(state, 1, 'resolve', {}, state.asked + 200, board);
    if (power === 'radar') {
      assert.equal(state.p[0].scan.count, 4);
      assert.equal(state.phase, 'target');
      assert.equal(state.p[0].shots[0], undefined);
    } else if (power === 'air') {
      assert.equal(Object.keys(state.p[0].shots).length, 5);
      assert.equal(state.p[0].shots[0], 'sunk');
    } else {
      assert.equal(state.event.kind, 'blocked');
      assert.equal(state.p[1].shield, undefined);
      assert.equal(state.p[0].shield, true);
    }
  }
  const joker = {...gameBefore, index:0};
  while (getQuestion(pool, joker.seed, joker.index).options.length < 4) joker.index++;
  joker.p[0].stats.credits = 1;
  assert.equal(act(joker, 0, 'power', {power:'joker'}).joker, true);
});

test('KI nutzt nur bekannte Treffer und zielt nie auf bereits beschossene Felder', () => {
  const shots = {0:'hit',1:'miss',7:'sunk'};
  assert.equal(chooseShot(6,shots,2,random), 6);
  assert.equal(chooseShot(6,shots,3,random), 6);
  for (let i = 0; i < 30; i++) assert.ok(!shots[chooseShot(6,shots,1,random)]);
});

test('Lehrerkatalog validiert benutzerdefinierte Fragen und lehnt doppelte Wörter ab', () => {
  const row = {...catalog.words[0], questions:[{type:'text',prompt:'Eine eigene Frage?',answer:'Prophet',wrong:[]}]};
  const custom = validateCatalog({words:[row]});
  assert.ok(questionPool(custom).some(q => q.prompt === 'Eine eigene Frage?'));
  assert.throws(() => validateCatalog({words:[row,{...row,word:' PROPHET '}]}), /eindeutig/);
});

test('Service Worker enthält alle lokalen Laufzeitressourcen und GitHub-Unterpfade bleiben relativ', () => {
  const root = new URL('../', import.meta.url);
  const read = path => readFileSync(new URL(path, root), 'utf8');
  const manifest = JSON.parse(read('manifest.json'));
  for (const path of [manifest.start_url, manifest.scope, ...manifest.icons.map(icon => icon.src)]) assert.ok(path.startsWith('./'));
  const scripts = ['app','ui','board','game','questions','multiplayer','firebase-config','pages','sounds'];
  for (const name of scripts) {
    assert.ok(read('sw.js').includes("'" + name + "'"));
    for (const [, imported] of read('js/' + name + '.js').matchAll(/from '\.\/(.+?)'/g)) assert.ok(read('js/' + imported));
  }
  const rules = JSON.parse(read('database.rules.json')).rules;
  assert.equal(rules['.read'], false);
  assert.equal(rules['.write'], false);
  assert.match(rules.rooms.$code['.write'], /auth != null/);
});

test('QR-Bibliothek erzeugt eine Matrix für einen GitHub-Pages-Einladungslink', async () => {
  const {runInNewContext} = await import('node:vm');
  const source = readFileSync(new URL('../js/vendor/qrcode.js', import.meta.url), 'utf8');
  const context = {};
  runInNewContext(source, context);
  const qr = context.qrcode(0, 'M');
  qr.addData('https://schule.github.io/woerterflotte/?lobby=4821');
  qr.make();
  assert.ok(qr.getModuleCount() >= 21);
  assert.equal(qr.isDark(0,0), true);
  assert.equal(qr.isDark(1,1), false);
});
