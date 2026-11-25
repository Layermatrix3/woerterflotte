const nouns = [
  ['Hund','der'],['Pause','die'],['Buch','das'],['Wolke','die'],['Tisch','der'],
  ['Fenster','das'],['Schule','die'],['Schiff','das'],['Stift','der'],['Tafel','die'],
  ['Zimmer','das'],['Fuchs','der'],['Sonne','die'],['Garten','der'],['Rad','das'],
  ['Karte','die'],['Museum','das'],['Regen','der'],['Geduld','die'],['Lehrling','der'],
  ['Ergebnis','das'],['Abenteuer','das'],['Gedanke','der'],['Entscheidung','die']
];

const plurals = [
  ['Baum','Bäume',['Baums','Baumer','Baumen']],['Buch','Bücher',['Buche','Buchen','Buchs']],
  ['Haus','Häuser',['Hausen','Hause','Hauser']],['Kind','Kinder',['Kinde','Kinds','Kinden']],
  ['Glas','Gläser',['Glase','Glasen','Glaser']],['Nuss','Nüsse',['Nussen','Nusser','Nussens']],
  ['Maus','Mäuse',['Mausen','Mauser','Mauss']],['Fahrrad','Fahrräder',['Fahrraden','Fahrräde','Fahrrads']],
  ['Museum','Museen',['Museums','Museume','Museamer']],['Koffer','Koffer',['Koffern','Koffers','Koffere']],
  ['Stadt','Städte',['Stadten','Stadter','Städten']],['Praktikum','Praktika',['Praktikumme','Praktiker','Praktikume']]
];

const english = [
  ['Apfel','apple'],['Hund','dog'],['Buch','book'],['Wasser','water'],['Tür','door'],['Freund','friend'],
  ['Schule','school'],['Brot','bread'],['Fenster','window'],['Regen','rain'],['Wolke','cloud'],['Insel','island'],
  ['Fluss','river'],['Brücke','bridge'],['Flasche','bottle'],['Tasche','bag'],['Frühstück','breakfast'],
  ['Nachmittag','afternoon'],['Frage','question'],['Antwort','answer'],['Abenteuer','adventure'],
  ['Unterschied','difference'],['Entscheidung','decision'],['Wissenschaft','science'],['Erfahrung','experience'],
  ['Verbesserung','improvement'],['Umwelt','environment'],['Bibliothek','library'],['Erklärung','explanation']
];

export const subjectModes = ['math','german','english'];

export function subjectQuestions(mode, level) {
  if (mode === 'math') {
    const math = (expression, answer) => ({type:'math',word:expression,prompt:expression + ' = ?',answer:String(answer),options:[]});
    const result = [];
    for (let a = 2; a <= (level === 1 ? 8 : 13); a++) {
      for (let b = 2; b <= (level === 1 ? 8 : 9); b++) {
        result.push(math(a + ' + ' + b,a+b),math((a+b) + ' − ' + b,a));
        if (level >= 2) result.push(math(a + ' × ' + b,a*b),math((a*b) + ' ÷ ' + b,a));
        if (level === 3) result.push(math(a + ' × (' + b + ' + 3)',a*(b+3)));
      }
    }
    return result;
  }
  if (mode === 'german') {
    const articles = nouns.slice(0,level === 1 ? 15 : nouns.length).map(([word,answer]) => ({
      type:'grammar',word,answer,prompt:'Welcher Artikel passt zu „' + word + '“?',options:['der','die','das']
    }));
    const pluralQuestions = plurals.slice(0,level === 1 ? 5 : level === 2 ? 9 : plurals.length)
      .map(([word,answer,wrong]) => ({type:'grammar',word,answer,prompt:'Wie lautet die Mehrzahl von „' + word + '“?',
        options:[answer,...new Set(wrong)]}));
    return [...articles,...pluralQuestions];
  }
  if (mode === 'english') {
    const words = english.slice(0,level === 1 ? 12 : level === 2 ? 20 : english.length);
    return words.flatMap(([word,answer], index) => {
      const distractors = [1,3,7].map(offset => words[(index+offset)%words.length]);
      return [
        {type:'english',word,answer,prompt:'Was heißt „' + word + '“ auf Englisch?',options:[answer,...distractors.map(row => row[1])]},
        {type:'english',word,answer:word,prompt:'Was bedeutet „' + answer + '“ auf Deutsch?',options:[word,...distractors.map(row => row[0])]}
      ];
    });
  }
}
