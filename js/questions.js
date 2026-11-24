export const types = {
  meaning: 'Bedeutung', spelling: 'Rechtschreibung', text: 'Texteingabe',
  gap: 'Lückentext', correction: 'Fehler finden', match: 'Wort zuordnen'
};

export const modes = {
  classic: 'Klassisch', spelling: 'Rechtschreibduell', meaning: 'Bedeutungsduell',
  mixed: 'Gemischter Modus', quick: 'Schnellspiel', words: 'Wörterflotte'
};

export const levels = {1: 'Leicht', 2: 'Mittel', 3: 'Schwer'};

export function normalize(value) {
  return String(value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('de');
}

export function accepts(question, value) {
  return [question.answer, ...(question.aliases || [])].some(answer => normalize(answer) === normalize(value));
}

export function shuffle(items, random = Math.random) {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function seeded(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export function validateCatalog(catalog) {
  const words = catalog?.words;
  const validText = (value, limit = 260) => typeof value === 'string' && value.trim().length > 0 && value.length <= limit;
  const strings = (list, count) => Array.isArray(list) && list.length <= count && list.every(value => validText(value));
  if (!Array.isArray(words) || !words.length || words.length > 100) throw Error('Ein Katalog braucht 1 bis 100 Wörter.');
  const seen = new Set();
  return {words: words.map(row => {
    if (!row || !validText(row.word, 40) || !validText(row.meaning) || !validText(row.example) ||
        !strings(row.wrong, 3) || !strings(row.meaningChoices || [], 3) || !strings(row.aliases || [], 5) || ![1, 2, 3].includes(row.difficulty) ||
        !Array.isArray(row.questions || []) || (row.questions || []).length > 12 || seen.has(normalize(row.word))) {
      throw Error('Wörter müssen eindeutig sein und Bedeutung, Beispielsatz sowie eine gültige Schwierigkeit haben.');
    }
    const aliases = (row.aliases || []).map(value => value.trim());
    const wrong = [...new Set(row.wrong.map(value => value.trim()))].filter(value => !accepts({answer: row.word, aliases}, value));
    seen.add(normalize(row.word));
    const questions = (row.questions || []).map(question => {
      if (!question || !Object.prototype.hasOwnProperty.call(types, question.type) || !validText(question.prompt) ||
          !validText(question.answer) || !strings(question.wrong || [], 3)) throw Error('Eine eigene Frage ist unvollständig.');
      return {type: question.type, prompt: question.prompt.trim(), answer: question.answer.trim(),
        wrong: [...new Set((question.wrong || []).map(value => value.trim()))].filter(value => normalize(value) !== normalize(question.answer))};
    });
    return {word: row.word.trim(), meaning: row.meaning.trim(), example: row.example.trim(),
      difficulty: row.difficulty, wrong, aliases, questions,
      meaningChoices: [...new Set((row.meaningChoices || []).map(value => value.trim()))]
        .filter(value => normalize(value) !== normalize(row.meaning))};
  })};
}

export function questionPool(catalog, mode = 'mixed', level = 3) {
  const allowed = {
    classic: ['meaning', 'spelling', 'match'], spelling: ['text', 'gap', 'correction'],
    meaning: ['meaning', 'match']
  }[mode] || Object.keys(types);
  const words = catalog.words.filter(row => row.difficulty <= level);
  return (words.length ? words : catalog.words).flatMap(row => {
    const {word, meaning, example, wrong, aliases} = row;
    const meanings = catalog.words.filter(other => other !== row && normalize(other.meaning) !== normalize(meaning));
    const otherWords = catalog.words.filter(other => !accepts({answer: word, aliases}, other.word));
    const position = catalog.words.indexOf(row);
    const distract = (list, key) => list.slice(position % Math.max(1, list.length)).concat(list).slice(0, list.length)
      .map(other => other[key]).filter((item, index, all) => all.indexOf(item) === index).slice(0, 3);
    return [
      {type: 'meaning', prompt: 'Was bedeutet „' + word + '“?', answer: meaning, wrong: row.meaningChoices?.length ? row.meaningChoices : distract(meanings, 'meaning')},
      {type: 'spelling', prompt: 'Welche Schreibweise passt zu dieser Bedeutung? ' + meaning, answer: word, wrong, aliases},
      {type: 'text', prompt: meaning + '. Wie lautet das Fremdwort?', answer: word, aliases},
      ...(example.includes('______') ? [{type: 'gap', prompt: example, answer: word, aliases}] : []),
      ...(wrong.length ? [{type: 'correction', prompt: 'Korrigiere „' + wrong[0] + '“.', answer: word, aliases}] : []),
      {type: 'match', prompt: 'Welches Wort passt? ' + meaning, answer: word, aliases, wrong: distract(otherWords, 'word')},
      ...row.questions
    ].filter(question => allowed.includes(question.type)).map(question => ({
      ...question, word, options: ['meaning', 'spelling', 'match'].includes(question.type) && question.wrong?.length
        ? [question.answer, ...question.wrong] : []
    }));
  });
}

export function getQuestion(pool, seed, index) {
  const batch = pool.length > 2 ? Math.floor(index / pool.length) : 0;
  const batchRandom = number => seeded((seed + Math.imul(number, 2654435761)) >>> 0);
  const random = batchRandom(batch);
  const ordered = shuffle(pool, random);
  if (batch > 0) {
    const previous = shuffle(pool, batchRandom(batch - 1));
    if (ordered[0] === previous[previous.length - 1]) [ordered[0], ordered[1]] = [ordered[1], ordered[0]];
  }
  const question = ordered[index % pool.length];
  return {...question, options: shuffle(question.options, random)};
}
