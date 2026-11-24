import {el, button, field, row, section, select, read, store, backLink} from './ui.js';
import {accepts, getQuestion, normalize, questionPool, types, levels, modes, validateCatalog} from './questions.js';
import {sound, soundSettings} from './sounds.js';

export function soundsPage(back, update) {
  const meter = el('output', {}, Math.round(soundSettings.volume * 100) + '%');
  const volume = el('input', {type:'range', min:0, max:100, value:Math.round(soundSettings.volume * 100),
    onInput:event => {
      soundSettings.volume = Number(event.target.value) / 100;
      meter.textContent = event.target.value + '%';
      update();
    }, onChange:() => sound('right')});
  const muted = el('input', {type:'checkbox', checked:soundSettings.muted, onChange:event => {
    soundSettings.muted = event.target.checked;
    update();
  }});
  const theme = select({dark:'Dunkel', light:'Hell', system:'System'}, document.documentElement.dataset.theme, {
    onChange:event => {
      document.documentElement.dataset.theme = event.target.value;
      store('theme', event.target.value);
    }
  });
  return section('Einstellungen', el('div', {className:'form-grid'}, field('Farbschema', theme),
    field('Lautstärke', row(volume, meter))), el('label', {className:'check'}, muted, ' Stummschalten'), row(backLink(back)));
}

export function learnPage(catalog, reviewWords, questionBlock, back, fromBattle) {
  const progress = Object.assign(Object.create(null), read('progress', {}));
  const body = el('div', {className:'study-content'});
  const metrics = el('p', {className:'muted'});
  const query = el('input', {type:'search', placeholder:'Fremdwort oder Bedeutung', onInput:() => {
    index = 0;
    renderStudy();
  }});
  let index = 0;
  let mode = reviewWords ? 'review' : 'cards';
  let flipped = false;
  let answered;
  let question;
  let quizIndex = 0;
  const quizSeed = Math.floor(Math.random() * 4294967296);
  const tabs = el('div', {className:'row study-tabs'});
  const items = Object.entries({cards:'Karteikarten', spelling:'Rechtschreibtraining', quiz:'Zufallsquiz', review:'Fehler wiederholen'});

  function updateProgress() {
    const rows = catalog.words.map(word => progress[normalize(word.word)]);
    metrics.textContent = rows.filter(value => value && value.right > value.wrong).length + ' von ' +
      catalog.words.length + ' Wörtern im Lernfortschritt · ' +
      rows.reduce((total, value) => total + (value?.right || 0), 0) + ' richtige Antworten';
  }

  function renderStudy() {
    updateProgress();
    tabs.replaceChildren(...items.map(([id, title]) => button(title, () => {
      mode = id;
      index = 0;
      answered = undefined;
      flipped = false;
      renderStudy();
    }, {className:mode === id ? 'primary' : '', ariaPressed:String(mode === id)})));
    const term = normalize(query.value);
    const matches = catalog.words.filter(word => normalize(word.word + ' ' + word.meaning).includes(term));
    const review = new Set((reviewWords || []).map(normalize));
    const words = mode === 'review' ? matches.filter(word => review.has(normalize(word.word)) ||
        (progress[normalize(word.word)]?.needsReview)) : matches;
    if (!words.length && !answered) {
      body.replaceChildren(el('p', {className:'notice'}, mode === 'review' ? 'Keine passenden Fehler zum Wiederholen vorhanden.' : 'Keine passenden Fremdwörter gefunden.'));
      return;
    }
    const display = words[index % words.length];
    if (mode === 'cards') {
      body.replaceChildren(button(el('div', {}, el('span', {className:'kicker'}, (index % words.length + 1) + ' von ' + words.length),
        el('h3', {}, display.word),
        flipped ? el('div', {}, el('p', {}, display.meaning), el('p', {className:'muted'}, display.example.replace('______', display.word)))
          : el('p', {className:'muted'}, 'Tippe für Bedeutung und Beispielsatz.')), () => {
        flipped = !flipped;
        renderStudy();
        body.querySelector('.flashcard').focus({preventScroll:true});
      }, {className:'flashcard', ariaPressed:String(flipped)}),
      row(button('Vorheriges Wort', () => { index = (index + words.length - 1) % words.length; flipped = false; renderStudy(); }),
        button('Nächstes Wort', () => { index = (index + 1) % words.length; flipped = false; renderStudy(); })));
      return;
    }
    if (answered) {
      body.replaceChildren(el('div', {className:'question', role:'status'}, el('h3', {}, answered.correct ? 'Richtige Antwort!' : 'Richtige Lösung: ' + question.answer),
        el('p', {className:'muted'}, question.prompt), button('Nächste Frage', () => {
          answered = undefined;
          quizIndex++;
          renderStudy();
        }, {className:'primary'})));
      return;
    }
    const qPool = questionPool({words}, mode === 'spelling' ? 'spelling' : 'mixed', 3);
    question = getQuestion(qPool, quizSeed, quizIndex);
    body.replaceChildren(questionBlock(question, answer => {
      const correct = accepts(question, answer);
      const key = normalize(question.word);
      const previous = progress[key] || {right:0, wrong:0};
      progress[key] = {right:previous.right + Number(correct), wrong:previous.wrong + Number(!correct), needsReview:!correct};
      try { store('progress', progress); }
      catch { metrics.textContent = 'Der Browser hat den lokalen Speicher deaktiviert.'; }
      if (correct && mode === 'review') reviewWords = reviewWords?.filter(word => normalize(word) !== key);
      answered = {correct};
      sound(correct ? 'right' : 'wrong');
      renderStudy();
    }));
  }
  renderStudy();
  return section('Fremdwörter lernen', metrics, field('Suchen', query), tabs, body,
    row(fromBattle ? button('Zurück zum Ergebnis', back) : backLink(back)));
}

export function teacherPage(initial, base, back, notify) {
  let catalog = initial;
  const list = el('div', {className:'teacher-list'});
  const editor = el('div', {className:'teacher-editor'});
  const preferences = read('options', {});
  const file = el('input', {type:'file', accept:'.json,application/json', onChange:async event => {
    const input = event.target;
    if (!input.files?.[0]) return;
    try {
      if (input.files[0].size > 400000) throw Error('Die Datei ist größer als 400 KB.');
      commit(validateCatalog(JSON.parse(await input.files[0].text())));
      notify('Lokaler Katalog importiert.');
    } catch (error) { notify(error.message, true); }
    finally { input.value = ''; }
  }});
  function commit(value) {
    const validated = validateCatalog(value);
    store('catalog', validated);
    catalog = validated;
    draw();
  }
  function draw() {
    list.replaceChildren(...catalog.words.map((word, index) => button(word.word, () => edit(index), {className:'small'})));
    editor.replaceChildren();
  }
  function edit(index) {
    const current = catalog.words[index] || {word:'', meaning:'', example:'', difficulty:2, wrong:[], aliases:[], questions:[]};
    const text = (value, limit, required = true) => el('input', {value, maxLength:limit, required});
    const word = text(current.word, 40);
    const meaning = text(current.meaning, 260);
    const example = text(current.example, 260);
    const difficulty = select(levels, current.difficulty);
    const wrong = text(current.wrong.join(' | '), 200, false);
    const meaningChoices = text((current.meaningChoices || []).join(' | '), 800, false);
    const aliases = text(current.aliases.join(' | '), 210, false);
    const custom = el('div', {className:'custom-questions'});
    const forms = [];
    const split = input => input.value.split('|').map(value => value.trim()).filter(Boolean);
    function add(question = {type:'meaning',prompt:'',answer:'',wrong:[]}) {
      if (forms.length >= 12) { notify('Pro Wort sind bis zu zwölf eigene Fragen möglich.', true); return; }
      const type = select(types, question.type);
      const prompt = text(question.prompt, 260);
      const answer = text(question.answer, 260);
      const options = text(question.wrong.join(' | '), 600, false);
      const group = {type, prompt, answer, options};
      forms.push(group);
      const card = el('fieldset', {}, el('legend', {}, 'Eigene Frage'), el('div', {className:'form-grid'},
        field('Fragetyp', type), field('Frage', prompt), field('Richtige Antwort', answer),
        field('Falsche Optionen (mit | trennen)', options)), button('Frage entfernen', () => {
          forms.splice(forms.indexOf(group), 1);
          card.remove();
        }, {className:'ghost'}));
      custom.append(card);
    }
    current.questions.forEach(add);
    editor.replaceChildren(el('form', {onSubmit:event => {
      event.preventDefault();
      try {
        const updated = {word:word.value, meaning:meaning.value, example:example.value, difficulty:+difficulty.value,
          wrong:split(wrong), aliases:split(aliases), meaningChoices:split(meaningChoices), questions:forms.map(group => ({
            type:group.type.value, prompt:group.prompt.value, answer:group.answer.value, wrong:split(group.options)
          }))};
        const words = [...catalog.words];
        words[index] = updated;
        commit({words});
        notify('Wort gespeichert.');
      } catch (error) { notify(error.message, true); }
    }}, el('h3', {}, current.word ? current.word + ' bearbeiten' : 'Neues Fremdwort'), el('div', {className:'form-grid'},
      field('Fremdwort', word), field('Bedeutung', meaning), field('Beispielsatz (______ für die Lücke)', example),
      field('Schwierigkeit', difficulty), field('Bis zu drei falsche Schreibweisen (mit | trennen)', wrong),
      field('Weitere zulässige Schreibweisen (mit | trennen)', aliases),
      field('Bis zu drei falsche Bedeutungen (mit | trennen)', meaningChoices)),
      custom, row(button('Eigene Frage hinzufügen', () => add()), el('button', {type:'submit', className:'primary'}, 'Wort speichern'),
        current.word ? button('Wort löschen', () => {
          if (!window.confirm('„' + current.word + '“ aus dem lokalen Katalog löschen?')) return;
          try { commit({words:catalog.words.filter((_, position) => position !== index)}); notify('Wort gelöscht.'); }
          catch (error) { notify(error.message, true); }
        }, {className:'ghost'}) : null, button('Abbrechen', () => editor.replaceChildren(), {className:'ghost'}))));
    word.focus();
  }
  draw();
  const mode = select(modes, preferences.mode || 'classic');
  const level = select(levels, preferences.level || 2);
  const special = el('input', {type:'checkbox', checked:preferences.special || false});
  return section('Lehrermodus', el('p', {className:'muted'}, 'Der Katalog liegt in diesem Browser. Beim Erstellen einer Lobby kannst du ihn für diese Partie freigeben.'),
    row(button('Fremdwort hinzufügen', () => edit(catalog.words.length), {className:'primary'}),
      button('JSON exportieren', () => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(catalog, null, 2)], {type:'application/json'}));
        const link = el('a', {download:'woerterflotte-katalog.json', href:url});
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }),
      button('Tafelwörter wiederherstellen', () => {
        if (!window.confirm('Lokale Änderungen durch den Originalkatalog ersetzen?')) return;
        try { commit(base); notify('Originalkatalog wiederhergestellt.'); }
        catch (error) { notify(error.message, true); }
      }, {className:'ghost'})),
    field('JSON importieren', file), list, editor,
    el('h3', {}, 'Vorgaben für die nächste Partie'), el('div', {className:'form-grid'}, field('Spielmodus', mode), field('Schwierigkeit', level)),
    el('label', {className:'check'}, special, ' Spezialfähigkeiten'),
    row(button('Vorgaben und Lehrerkatalog übernehmen', () => {
      try {
        store('catalog', catalog);
        store('options', {...read('options', {}), mode:mode.value, level:+level.value, special:special.checked, custom:true,
          ...(mode.value === 'quick' ? {size:6,count:2,time:15} : {})});
        notify('Vorgaben für die nächste Partie gespeichert.');
        back(true);
      } catch (error) { notify(error.message, true); }
    }, {className:'primary'}), backLink(() => back(false))));
}
