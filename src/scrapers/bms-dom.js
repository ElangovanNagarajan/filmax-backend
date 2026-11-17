// Reading a BookMyShow cinema page WITHOUT its CSS class names.
//
// BookMyShow's classes are styled-components hashes ("sc-1412vr2-0") that are
// regenerated on its frontend deploys, so any selector built on them breaks
// without warning. These readers rely only on what a person sees: a movie
// title, then show-time buttons like "10:00 AM". Two independent readers:
//
//   readShowsFromDom  — walks the page structure. Keeps each button's colour,
//                       which carries seat availability.
//   readShowsFromText — parses the page's visible text line by line. Knows
//                       nothing about structure, so it survives a redesign
//                       that rearranges every element; but it has no colours.
//
// Both functions run INSIDE the browser via page.evaluate, so each must be
// self-contained (no imports, no outer variables).

export function readShowsFromDom() {
  const TIME = /^\d{1,2}:\d{2}\s*[AaPp][Mm]$/;
  const LANGS = ['english', 'hindi', 'tamil', 'telugu', 'malayalam', 'kannada', 'bengali', 'marathi', 'gujarati', 'punjabi', 'odia', 'urdu', 'japanese', 'korean', 'french', 'spanish', 'german', 'chinese'];
  const FORMAT = /^,?\s*(2D|3D|IMAX\s*2D|IMAX\s*3D|IMAX|4DX(?:\s*3D)?|ICE|SCREEN\s*X|MX4D|DOLBY.*|EPIQ|P\[XL\]|PXL)\b/i;
  const firstLine = (el) => ((el.innerText || '').split('\n').map((l) => l.trim()).find(Boolean) || '');
  const isMeta = (l) => !l || TIME.test(l) || LANGS.includes(l.toLowerCase()) || FORMAT.test(l) || /^[A-Z]{2,4}$/.test(l)
    || /^(filling fast|almost full|sold out|available|non-cancellable|cancellation available|subtitles?)$/i.test(l) || /₹|rs\.?\s*\d/i.test(l);
  const timesIn = (el) => ((el.innerText || '').match(/\b\d{1,2}:\d{2}\s*[AaPp][Mm]\b/g) || []).length;

  // 1. Show-time buttons: the outermost element still containing exactly one
  //    time, starting from each leaf whose text is a time.
  const chips = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (el.children.length) continue;
    if (!TIME.test((el.textContent || '').trim())) continue;
    let chip = el;
    while (chip.parentElement && chip.parentElement !== document.body && timesIn(chip.parentElement) === 1) chip = chip.parentElement;
    chips.add(chip);
  }

  // 2. Each button's movie: the nearest ancestor whose first visible line is
  //    not a time / language / format — i.e. starts with the title.
  const out = [];
  for (const chip of chips) {
    const lines = (chip.innerText || '').split('\n').map((l) => l.trim()).filter(Boolean);
    const time = lines.find((l) => TIME.test(l));
    if (!time) continue;
    let block = chip.parentElement, title = '';
    for (let up = 0; block && up < 12; up++, block = block.parentElement) {
      const fl = firstLine(block);
      if (!isMeta(fl) && fl.length >= 2 && fl.length <= 100) { title = fl; break; }
    }
    if (!title) continue;
    let language = '', format = '';
    for (const l of (block.innerText || '').split('\n').map((x) => x.trim()).filter(Boolean).slice(1, 6)) {
      if (TIME.test(l)) break;
      if (!language && LANGS.includes(l.toLowerCase())) language = l;
      const f = l.match(FORMAT); if (!format && f) format = f[1].toUpperCase();
    }
    const subtitle = lines.find((l, i) => i > 0 && /^[A-Z]{2,4}$/.test(l)) || '';
    // Colour of the time text carries availability (green / amber / red).
    const timeEl = [...chip.querySelectorAll('*')].find((e) => !e.children.length && TIME.test((e.textContent || '').trim())) || chip;
    const m = (getComputedStyle(timeEl).color || '').match(/(\d+),\s*(\d+),\s*(\d+)/);
    out.push({ movieTitle: title, time, language, format, subtitle, rgb: m ? [+m[1], +m[2], +m[3]] : [0, 0, 0] });
  }
  return out;
}

export function readShowsFromText() {
  const TIME = /^\d{1,2}:\d{2}\s*[AaPp][Mm]$/;
  const LANGS = ['english', 'hindi', 'tamil', 'telugu', 'malayalam', 'kannada', 'bengali', 'marathi', 'gujarati', 'punjabi', 'odia', 'urdu', 'japanese', 'korean', 'french', 'spanish', 'german', 'chinese'];
  const FORMAT = /^,?\s*(2D|3D|IMAX|4DX|ICE|SCREEN\s*X|MX4D|DOLBY|EPIQ|PXL)/i;
  const isMeta = (l) => LANGS.includes(l.toLowerCase()) || FORMAT.test(l) || /^[A-Z]{2,4}$/.test(l) || /^[•·|,]/.test(l)
    || /^(filling fast|almost full|sold out|available|non-cancellable|cancellation available|subtitles?|ua|u|a|ua\d+\+|\d+\+)$/i.test(l) || /₹|rs\.?\s*\d/i.test(l);
  const lines = (document.body.innerText || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const out = [];
  let title = '';
  for (const l of lines) {
    if (TIME.test(l)) { if (title) out.push({ movieTitle: title, time: l }); continue; }
    if (isMeta(l)) continue;
    if (l.length >= 2 && l.length <= 100) title = l;
  }
  return out;
}
