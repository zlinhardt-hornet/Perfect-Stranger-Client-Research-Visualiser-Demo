/* ==========================================================================
   Perfect Stranger — Research Board Generator
   Paste research notes (headers + "- " bullets, Milanote-style) and get a
   structured client research board. Runs entirely client-side (GitHub
   Pages friendly, no backend, no API key).
   ========================================================================== */

var STORAGE_KEY = 'psboard:data';

/* ---------------------------------------------------------------------- */
/* HTML escaping — every field below can come from pasted user text, so   */
/* everything gets escaped before it touches innerHTML.                   */
/* ---------------------------------------------------------------------- */
function esc(str){
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, function(c){
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
  });
}

function safeUrl(url){
  if (!url) return '';
  var u = String(url).trim();
  if (/^(https?:|mailto:)/i.test(u)) return u;
  return '';
}

/* ==========================================================================
   PARSER
   Accepts loosely-structured notes:

     Company Name (TICKER) — Status
     Optional one-line mission/tagline

     Section Header:
     - bullet one
     - Label: bullet with an explicit card title
     - another bullet (Source: press)

     Leadership:
     - Name — Title — CONFIDENCE — Source
     - * Name — Title — CONFIDENCE — Source | photo: https://... | link: https://...

     Decision:
     - Verdict sentence (pursue / pass / caution keywords drive the color)
     - reasoning bullet
     - reasoning bullet

     Next Steps:
     - step one
     - step two

   "Leadership", "Decision"/"Recommendation"/"Verdict", "Next Steps" and
   "About"/"Overview"/"Company"/"Story" are pulled out into their own UI
   blocks; every other header becomes a Milanote-style column.
   ========================================================================== */

var SPECIAL = {
  leadership: /^leadership\b/i,
  decision: /^(decision|recommendation|verdict)\b/i,
  nextsteps: /^next\s*steps?\b/i,
  about: /^(about|overview|company|story)\b/i
};

function parseFreeform(raw){
  var lines = String(raw || '').replace(/\r\n/g, '\n').split('\n');
  var headerRe = /^([^:\n]{2,80}):\s*$/;

  var preamble = [];
  var sections = [];
  var current = null;
  var sawHeader = false;

  lines.forEach(function(rawLine){
    var line = rawLine.trim();
    if (!line) return;

    var bulletMatch = line.match(/^[-•*]\s+(.*)$/);
    var headerMatch = !bulletMatch && line.match(headerRe);

    if (headerMatch) {
      current = { header: headerMatch[1].trim(), bullets: [] };
      sections.push(current);
      sawHeader = true;
    } else if (bulletMatch) {
      if (!current) { current = { header: 'Notes', bullets: [] }; sections.push(current); }
      current.bullets.push(bulletMatch[1].trim());
    } else if (!sawHeader) {
      preamble.push(line);
    } else if (current && current.bullets.length) {
      // wrapped continuation line — glue onto the previous bullet
      current.bullets[current.bullets.length - 1] += ' ' + line;
    }
  });

  // --- company header line: "Name (TICKER) — Status" ---
  var nameLine = preamble[0] || '';
  var tickerMatch = nameLine.match(/\(([^)]+)\)/);
  var statusMatch = nameLine.match(/[—-]\s*([A-Za-z][A-Za-z ]*)$/);
  var name = nameLine
    .replace(/\([^)]+\)/, '')
    .replace(/[—-]\s*[A-Za-z][A-Za-z ]*$/, '')
    .trim();

  var company = {
    name: name || nameLine || 'Untitled Company',
    ticker: tickerMatch ? tickerMatch[1].trim() : '',
    status: statusMatch ? statusMatch[1].trim() : 'Prospect',
    mission: preamble[1] || '',
    story: ''
  };

  var leadership = [];
  var columns = [];
  var decision = { verdict: '', level: 'caution', reasoning: [], nextsteps: [] };
  var aboutBullets = [];

  sections.forEach(function(sec){
    var h = sec.header;
    if (SPECIAL.leadership.test(h)) {
      sec.bullets.forEach(function(b){ leadership.push(parseLeadershipLine(b)); });
    } else if (SPECIAL.decision.test(h)) {
      if (sec.bullets.length) {
        decision.verdict = sec.bullets[0];
        decision.reasoning = sec.bullets.slice(1);
        decision.level = detectLevel(decision.verdict);
      }
    } else if (SPECIAL.nextsteps.test(h)) {
      decision.nextsteps = sec.bullets;
    } else if (SPECIAL.about.test(h)) {
      aboutBullets = aboutBullets.concat(sec.bullets);
    } else {
      columns.push({ title: h, cards: sec.bullets.map(splitBullet) });
    }
  });

  if (aboutBullets.length) {
    company.story = aboutBullets.join(' ');
  } else if (columns.length) {
    company.story = columns[0].cards.map(function(c){ return c.body; }).join(' ');
  }

  return { company: company, leadership: leadership, columns: columns, decision: decision };
}

function splitBullet(rawText){
  var text = rawText;
  var source = '';
  var srcMatch = text.match(/\(Source:\s*([^)]+)\)\s*$/i);
  if (srcMatch) {
    source = srcMatch[1].trim();
    text = text.slice(0, srcMatch.index).trim();
  }

  var colonIdx = text.indexOf(':');
  var before = colonIdx > -1 ? text.slice(0, colonIdx) : '';
  var isLabel = colonIdx > 0 && colonIdx < 40 && before.split(' ').length <= 4 && !/[()]/.test(before);

  var title, body;
  if (isLabel) {
    title = before.trim();
    body = text.slice(colonIdx + 1).trim();
  } else {
    var words = text.split(' ');
    title = words.slice(0, 5).join(' ') + (words.length > 5 ? '…' : '');
    body = text;
  }
  return { card: title, body: body, source: source };
}

function parseLeadershipLine(rawText){
  var text = rawText.trim();
  var photo = '', link = '';

  var parts = text.split('|').map(function(s){ return s.trim(); });
  text = parts[0];
  parts.slice(1).forEach(function(p){
    var m = p.match(/^(photo|link)\s*:\s*(.+)$/i);
    if (m) {
      if (m[1].toLowerCase() === 'photo') photo = m[2].trim();
      else link = m[2].trim();
    }
  });

  var target = false;
  if (text.charAt(0) === '*') { target = true; text = text.slice(1).trim(); }

  var fields = text.split(/\s+—\s+/);
  if (fields.length < 2) fields = text.split(/\s+-\s+/);

  return {
    name: (fields[0] || '').trim(),
    title: (fields[1] || '').trim(),
    confidence: normalizeConfidence(fields[2]),
    source: (fields[3] || '').trim(),
    target: target,
    photo: photo,
    link: link
  };
}

function normalizeConfidence(raw){
  var r = (raw || '').toLowerCase();
  if (/unverif|fabricat/.test(r)) return 'unverified';
  if (/high/.test(r)) return 'high';
  if (/low/.test(r)) return 'low';
  return 'medium';
}

function detectLevel(text){
  var t = (text || '').toLowerCase();
  if (/no-?go|not realistic|pass on|not a fit|don't pursue|do not pursue/.test(t)) return 'no-go';
  if (/pursue|green.?light|move forward|worth pursuing/.test(t)) return 'go';
  return 'caution';
}

function initials(name){
  var cleaned = (name || '').replace(/["'“”]/g, '').trim();
  var words = cleaned.split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].charAt(0).toUpperCase();
  return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
}

var AVATAR_PALETTE = ['#5b7c99', '#a9683d', '#5f8a6b', '#7a5f8a', '#8a5f5f', '#5f7a8a', '#8a7a5f'];
var COLUMN_PALETTE = ['#5b7c99', '#a9683d', '#5f8a6b', '#7a5f8a', '#8a5f5f', '#5f7a8a', '#8a7a5f'];

function colorFor(str, palette){
  var sum = 0;
  for (var i = 0; i < (str || '').length; i++) sum += str.charCodeAt(i);
  return palette[sum % palette.length];
}

/* ==========================================================================
   DEMO DATA — the YETI brief, written the way a researcher would naturally
   type it up. This is what ships in the textarea by default.
   ========================================================================== */

var DEMO_TEXT = [
'YETI Holdings (NYSE: YETI) — Prospect',
'Premium, near-indestructible gear "built for the wild."',
'',
'Positioning:',
'- Snapshot: YETI Holdings (NYSE: YETI). Premium outdoor brand: coolers, drinkware, and bags. Founded 2006 in Austin, Texas by brothers Roy and Ryan Seiders. Public since 2018. ~$1.7B revenue scale.',
'- Statement: premium, near-indestructible, "built for the wild." Grew from a hunting/fishing/rodeo heritage base into a broad outdoor-lifestyle brand.',
'',
'State of Brand:',
'- Strengths: iconic premium brand with fierce loyalty; famous in-house creative agency (~76-person team, formed ~2019) keeps full control of the brand narrative; strong ambassador network; cinematic brand content (e.g. the documentary "A Thousand Casts"). (Source: press)',
'- Tensions: sales softness and margin/tariff pressure; viral competitors like Stanley winning on TikTok trends YETI deliberately avoids; activist investor Engaged Capital pushed for change in 2025. (Source: press)',
'- Opportunity: under pressure to expand product categories (bags) and international markets (UK, Europe, Canada, Australia) faster than an in-house team can fully staff. (Source: internal analysis)',
'',
'Audience:',
'- Core: outdoor enthusiasts, originally hunting/fishing/rodeo in the US South, now a broad cross-section of outdoor and lifestyle consumers. Expanding into non-heritage and international markets. (Source: press)',
'',
'Marketing Approach:',
'- "Low and slow" brand building. Community and ambassador driven. Makes cinematic films and documentaries rather than chasing trends. Former CMO principle: don\'t hand your brand narrative to influencers or TikTok. Marketing is run in-house. (Source: press)',
'',
'Marcom & Leadership:',
'- CMO transition: Paulie Dery (former CMO) departed to AG1; current CMO status unclear. Worth verifying. (Source: The Drum — verify)',
'- Creative bench: Executive Creative Directors Carlos Rangel & Ginny Golden, Creative Director Michelle Maben — inside a ~76-person in-house agency. (Source: press profile — verify)',
'',
'Opportunities for Perfect Stranger:',
'- Honest read: like A24, YETI has a strong in-house creative team, so this is a production/capacity play, not a brand-strategy takeover.',
'- Cinematic content production at scale — they make a lot of branded films, a natural production fit.',
'- Category-launch creative as they enter new product lines (bags, etc).',
'- International campaign localization as they expand geographies.',
'- The activist-driven pressure to expand fast is a real capacity gap an outside partner can fill.',
'',
'Ways In:',
'- Creative/production leadership — recent flux after their CMO departed, worth verifying, could be an opening.',
'- International expansion team as they scale UK/Europe.',
'- Lead with production and film craft, not "we\'ll run your brand."',
'',
'Leadership:',
'- * Matt Reintjes — President & CEO — HIGH — SEC filings, Fast Company',
'- Roy Seiders — Co-founder & Chairman (CEO until 2015) — HIGH — SEC',
'- Ryan Seiders — Co-founder — HIGH — company history',
'- * Paulie Dery — Former CMO (departed to AG1; role status unclear) — MEDIUM — The Drum / press, verify current CMO',
'- * Carlos Rangel — Executive Creative Director — MEDIUM — press profile, verify',
'- Ginny Golden — Executive Creative Director — MEDIUM — press profile, verify',
'- Michelle Maben — Creative Director — MEDIUM — press profile, verify',
'- Michael McMullen — CFO — LOW — data broker, verify via SEC',
'- "Bessie Paucek" — CEO — UNVERIFIED — data broker (exa.ai). Conflicts with SEC filings, which name Matt Reintjes. Do not use.',
'',
'Decision:',
'- Pursue — as a production and creative-capacity partner, not a brand overhaul.',
'- YETI\'s in-house team is strong, so this isn\'t a strategy takeover — it\'s a capacity and craft play.',
'- Activist pressure (Engaged Capital, 2025) is forcing faster category and international expansion than the in-house team can staff alone.',
'- A recent CMO departure creates a live opening worth tracking.',
'',
'Next Steps:',
'- Verify current CMO status and confirm the creative-leadership org chart.',
'- Approach through the production/craft angle — lead with a reel, not a pitch to "run their brand."',
'- Target Matt Reintjes, Paulie Dery, and Carlos Rangel as first-touch contacts.'
].join('\n');

/* ==========================================================================
   RENDER HELPERS (shared by both views)
   ========================================================================== */

var modalOverlay, modalContent;

function openModal(html){
  modalContent.innerHTML =
    '<button class="modal-close" aria-label="Close" data-close>✕</button>' + html;
  modalOverlay.classList.add('open');
}
function closeModal(){
  modalOverlay.classList.remove('open');
}

function avatarHtml(name, photo, size){
  var color = colorFor(name || '', AVATAR_PALETTE);
  var cls = size ? ' m-avatar' : '';
  var safePhoto = safeUrl(photo);
  if (safePhoto) {
    return '<div class="avatar' + cls + '" style="background:' + color + '"><img src="' + esc(safePhoto) + '" alt=""></div>';
  }
  return '<div class="avatar' + cls + '" style="background:' + color + '">' + esc(initials(name)) + '</div>';
}

function renderAbout(company){
  var box = document.getElementById('aboutBox');
  box.innerHTML =
    '<h2>' + esc(company.name) + '</h2>' +
    '<div class="ticker-row">' +
      (company.ticker ? '<span class="ticker">' + esc(company.ticker) + '</span>' : '') +
      '<span class="pill">' + esc(company.status || 'Prospect') + '</span>' +
    '</div>' +
    (company.mission ? '<p class="mission">“' + esc(company.mission) + '”</p>' : '') +
    '<p class="story-preview">' + esc(company.story || 'No overview provided.') + '</p>' +
    '<p class="expand-hint">Click to read more →</p>';

  // onclick (not addEventListener) — this node is reused across generates,
  // an addEventListener would stack a stale-closure handler on every call.
  box.onclick = function(){
    openModal(
      '<h2>' + esc(company.name) + '</h2>' +
      '<p class="m-sub">' + esc(company.ticker) + (company.ticker ? ' · ' : '') + esc(company.status || 'Prospect') + '</p>' +
      (company.mission ? '<p class="mission" style="margin-top:6px">“' + esc(company.mission) + '”</p>' : '') +
      '<p class="m-body">' + esc(company.story || 'No overview provided.') + '</p>'
    );
  };
}

function renderLeadership(list){
  var grid = document.getElementById('leadershipGrid');
  grid.innerHTML = '';
  list.forEach(function(person){
    var el = document.createElement('div');
    el.className = 'lmini' + (person.target ? ' target' : '');
    el.innerHTML =
      (person.target ? '<span class="target-star" title="Target contact">🎯</span>' : '') +
      avatarHtml(person.name, person.photo, false) +
      '<div class="lmini-body">' +
        '<p class="lname">' + esc(person.name) + '</p>' +
        '<p class="ltitle">' + esc(person.title) + '</p>' +
        '<span class="badge ' + esc(person.confidence) + '">' + esc(person.confidence) + '</span>' +
      '</div>';
    el.addEventListener('click', function(){ openLeadershipModal(person); });
    grid.appendChild(el);
  });
}

function openLeadershipModal(person){
  var isFlag = person.confidence === 'unverified';
  var links = [];
  var safeLink = safeUrl(person.link);
  if (safeLink) links.push('<a href="' + esc(safeLink) + '" target="_blank" rel="noopener">View source ↗</a>');

  openModal(
    avatarHtml(person.name, person.photo, true) +
    (person.target ? '<span class="badge medium" style="background:var(--gold-bg);color:var(--gold);margin-bottom:6px">🎯 target contact</span>' : '') +
    '<h2>' + esc(person.name) + '</h2>' +
    '<p class="m-sub">' + esc(person.title) + '</p>' +
    '<span class="badge ' + esc(person.confidence) + '">' + esc(person.confidence) + ' confidence</span>' +
    (isFlag ? '<p class="m-note" style="background:var(--red-bg);color:var(--red)">⚠ Flagged: this record conflicts with a higher-confidence source. Verify before using.</p>' : '') +
    (links.length ? '<div class="m-links">' + links.join('') + '</div>' : '') +
    (person.source ? '<p class="m-source">Source: ' + esc(person.source) + '</p>' : '')
  );
}

function renderColumns(columns){
  var board = document.getElementById('board');
  board.innerHTML = '';

  columns.forEach(function(col){
    var section = document.createElement('section');
    section.className = 'column';

    var header = document.createElement('div');
    header.className = 'column-header';
    var dotColor = colorFor(col.title, COLUMN_PALETTE);
    header.innerHTML =
      '<h2><span class="chevron">▾</span><span class="dot" style="background:' + dotColor + '"></span>' + esc(col.title) + '</h2>' +
      '<span class="count">' + col.cards.length + '</span>';
    header.addEventListener('click', function(){ section.classList.toggle('collapsed'); });

    var cardsWrap = document.createElement('div');
    cardsWrap.className = 'column-cards';

    col.cards.forEach(function(card){
      var article = document.createElement('article');
      article.className = 'card';
      article.setAttribute('draggable', 'true');
      article.innerHTML =
        '<p class="card-title">' + esc(card.card) + '</p>' +
        '<p>' + esc(card.body) + '</p>' +
        (card.source ? '<span class="source-tag">' + esc(card.source) + '</span>' : '');
      cardsWrap.appendChild(article);
    });

    section.appendChild(header);
    section.appendChild(cardsWrap);
    board.appendChild(section);
  });
}

function renderDecision(decision){
  var box = document.getElementById('decisionBox');
  if (!decision || !decision.verdict) {
    box.style.display = 'none';
    return;
  }
  box.className = 'decision ' + decision.level;
  var labels = { go: 'Realistic target', caution: 'Worth exploring', 'no-go': 'Not a fit' };

  box.innerHTML =
    '<div class="decision-head">' +
      '<span class="verdict-tag">' + esc(labels[decision.level] || decision.level) + '</span>' +
    '</div>' +
    '<h2>' + esc(decision.verdict) + '</h2>' +
    '<div class="decision-grid">' +
      '<div><h4>Why</h4><ul>' + decision.reasoning.map(function(r){ return '<li>' + esc(r) + '</li>'; }).join('') + '</ul></div>' +
      '<div><h4>Next steps</h4><ul>' + decision.nextsteps.map(function(s){ return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></div>' +
    '</div>';
}

function applyStagger(){
  var columns = document.querySelectorAll('.column');
  columns.forEach(function(col, i){
    col.style.animationDelay = (i * 70) + 'ms';
    var cards = col.querySelectorAll('.card');
    cards.forEach(function(card, j){
      card.style.animationDelay = ((i * 70) + 120 + j * 60) + 'ms';
    });
  });
}

function setupDragReorder(){
  var draggedEl = null;
  var sourceContainer = null;

  document.querySelectorAll('.card').forEach(function(card){
    card.addEventListener('dragstart', function(){
      draggedEl = card;
      sourceContainer = card.parentElement;
      setTimeout(function(){ card.classList.add('dragging'); }, 0);
    });
    card.addEventListener('dragend', function(){
      card.classList.remove('dragging');
      draggedEl = null;
      sourceContainer = null;
    });
  });

  function getDragAfterElement(container, y){
    var els = Array.prototype.slice.call(container.querySelectorAll('.card:not(.dragging)'));
    return els.reduce(function(closest, child){
      var box = child.getBoundingClientRect();
      var offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) return { offset: offset, element: child };
      return closest;
    }, { offset: -Infinity, element: null }).element;
  }

  document.querySelectorAll('.column-cards').forEach(function(container){
    container.addEventListener('dragover', function(e){
      if (!draggedEl || sourceContainer !== container) return;
      e.preventDefault();
      var afterElement = getDragAfterElement(container, e.clientY);
      if (afterElement == null) container.appendChild(draggedEl);
      else container.insertBefore(draggedEl, afterElement);
    });
  });
}

function renderBoard(data){
  document.title = data.company.name + ' — Research Board';
  var titleEl = document.getElementById('companyTitle');
  if (titleEl) titleEl.textContent = data.company.name + ' — Research Board';

  renderAbout(data.company);
  renderLeadership(data.leadership);
  renderColumns(data.columns);
  renderDecision(data.decision);

  applyStagger();
  setupDragReorder();
}

/* ==========================================================================
   SINGLE-PAGE APP CONTROLLER
   Two views live in the same document (#pasteView / #boardView) — no page
   navigation, no new tab. localStorage only persists the last board so a
   refresh doesn't lose it; "New search" clears it for a clean slate.
   ========================================================================== */

function switchToBoardView(){
  document.getElementById('pasteView').style.display = 'none';
  document.getElementById('boardView').style.display = '';
  window.scrollTo(0, 0);
}
function switchToPasteView(){
  document.getElementById('boardView').style.display = 'none';
  document.getElementById('pasteView').style.display = '';
  window.scrollTo(0, 0);
}

function init(){
  modalOverlay = document.getElementById('modalOverlay');
  modalContent = document.getElementById('modalContent');
  modalOverlay.addEventListener('click', function(e){
    if (e.target === modalOverlay || e.target.hasAttribute('data-close')) closeModal();
  });
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape') closeModal();
  });

  var textarea = document.getElementById('pasteInput');
  var generateBtn = document.getElementById('generateBtn');
  var sampleBtn = document.getElementById('sampleBtn');
  var clearBtn = document.getElementById('clearBtn');
  var newSearchBtn = document.getElementById('newSearchBtn');
  var errorBox = document.getElementById('errorBox');

  textarea.value = DEMO_TEXT;

  function showError(msg){
    errorBox.textContent = msg;
    errorBox.classList.add('show');
  }
  function hideError(){
    errorBox.classList.remove('show');
    errorBox.textContent = '';
  }

  generateBtn.addEventListener('click', function(){
    hideError();
    var raw = textarea.value;
    if (!raw.trim()) { showError('Paste some notes first — or click "Load YETI sample".'); return; }

    var data;
    try {
      data = parseFreeform(raw);
    } catch (e) {
      showError('Could not parse that text. Check the format guide above.');
      return;
    }

    if (!data.company.name || (!data.leadership.length && !data.columns.length)) {
      showError('Didn\'t find any recognizable sections. Make sure headers end in ":" and bullets start with "- ".');
      return;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    renderBoard(data);
    switchToBoardView();
  });

  sampleBtn.addEventListener('click', function(){
    textarea.value = DEMO_TEXT;
    hideError();
  });

  clearBtn.addEventListener('click', function(){
    textarea.value = '';
    hideError();
    textarea.focus();
  });

  newSearchBtn.addEventListener('click', function(){
    localStorage.removeItem(STORAGE_KEY);
    switchToPasteView();
  });

  // restore the last generated board on reload, if there is one
  var stored;
  try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { stored = null; }
  if (stored) {
    renderBoard(stored);
    switchToBoardView();
  }
}

/* ==========================================================================
   BOOTSTRAP
   ========================================================================== */
document.addEventListener('DOMContentLoaded', init);
