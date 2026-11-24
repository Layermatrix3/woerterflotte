import test from 'node:test';
import assert from 'node:assert/strict';
import {turnDetails, hullTiles} from '../js/battle-view.js';

test('Beide Seiten bekommen passende Anweisungen zu Frage, Zielwahl und Schuss', () => {
  const names = ['Ada','Kim'];
  assert.match(turnDetails({phase:'question',turn:0},0,names,6).title,/Du bist dran/);
  assert.match(turnDetails({phase:'question',turn:0},1,names,6).title,/Ada beantwortet/);
  assert.match(turnDetails({phase:'target',turn:1},0,names,6).title,/Kim zielt/);
  assert.match(turnDetails({phase:'pending',turn:1,pending:{cell:14}},0,names,6).title,/Ankommender Schuss auf C3/);
  assert.match(turnDetails({phase:'pending',turn:1,pending:{cell:14,power:'radar'}},1,names,6).title,/Radar scannt C3/);
  assert.match(turnDetails({phase:'over',winner:0},1,names,6).title,/Ada gewinnt/);
});

test('Schiffe werden korrekt ausgerichtet und nur über ihre eigenen Felder gezeichnet', () => {
  const ships = [{name:'Chor',cells:[1,7,13,19],letters:['C','H','O','R']}, {name:'Zerstörer',cells:[4,5]}];
  const tiles = hullTiles(ships,6);
  assert.equal(tiles.get(1).part,'stern');
  assert.equal(tiles.get(7).cabin,true);
  assert.equal(tiles.get(19).direction,'vertical');
  assert.equal(tiles.get(19).letter,'R');
  assert.equal(tiles.get(5).part,'bow');
  assert.equal(tiles.get(5).direction,'horizontal');
  assert.equal(tiles.has(0),false);
});
