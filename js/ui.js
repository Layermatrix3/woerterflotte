export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (/^aria[A-Z]/.test(key)) node.setAttribute(key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase()), value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.flat(Infinity).filter(item => item != null && item !== false));
  return node;
}

export const button = (label, action, attrs = {}) =>
  el('button', {type:'button', onClick:action, ...attrs}, label);

export const section = (title, ...children) => el('section', {className:'panel'}, el('h2', {}, title), children);
export const row = (...children) => el('div', {className:'row'}, children);
export const field = (label, control) => el('label', {className:'field'}, el('span', {}, label), control);
export const select = (options, value, attrs = {}) => {
  const input = el('select', attrs, Object.entries(options).map(([v, label]) => el('option', {value:v}, label)));
  input.value = value;
  return input;
};

export function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem('wf-' + key)) ?? fallback; }
  catch { return fallback; }
}

export function store(key, value) {
  localStorage.setItem('wf-' + key, JSON.stringify(value));
}

export function backLink(action) {
  return button('Hauptmenü', action, {className:'ghost'});
}
