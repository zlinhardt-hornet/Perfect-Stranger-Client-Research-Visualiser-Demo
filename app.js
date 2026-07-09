/* ==========================================================================
   Perfect Stranger — Research Board Generator
   Paste a research record (fixed JSON schema — the same shape an Airtable
   base would hand back via its REST API) and get a structured client
   research board. Runs entirely client-side (no backend, no API key).
   ========================================================================== */

var STORAGE_KEY = 'psboard:data';
var SOURCE_KEY = 'psboard:source';

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
   TEXT HELPERS
   Most fields are plain facts that end with an inline citation like
   "...text... (Source: Label https://...)". These pull that apart so the
   citation can render as an actual clickable link instead of dead text.
   ========================================================================== */

function extractSource(raw){
  var text = String(raw || '');
  var m = text.match(/\(Source:\s*(.*?)\)\s*$/i);
  if (!m) return { text: text.trim(), label: '', url: '' };
  var body = text.slice(0, m.index).trim();
  var inner = m[1].trim();
  var urlMatch = inner.match(/(https?:\/\/\S+)/);
  var url = urlMatch ? urlMatch[1] : '';
  var label = url ? inner.replace(url, '').trim() : inner;
  return { text: body, label: label, url: safeUrl(url) };
}

function splitLabelUrl(raw){
  var s = String(raw || '').trim();
  if (!s) return { label: '', url: '' };
  var m = s.match(/(https?:\/\/\S+)/);
  if (!m) return { label: s, url: '' };
  return { label: s.replace(m[1], '').trim(), url: safeUrl(m[1]) };
}

function extractEmail(raw){
  var m = String(raw || '').match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return m ? m[0] : '';
}

function autoTitleFrom(text){
  var words = String(text || '').split(' ').filter(Boolean);
  if (!words.length) return 'Note';
  var title = words.slice(0, 5).join(' ');
  return title + (words.length > 5 ? '…' : '');
}

function normalizeConfidence(raw){
  var r = String(raw || '').toLowerCase();
  if (/unverif|fabricat/.test(r)) return 'unverified';
  if (/high/.test(r)) return 'high';
  if (/low/.test(r)) return 'low';
  return 'medium';
}

function detectLevel(text){
  var t = String(text || '').toLowerCase();
  if (/no-?go|not realistic|pass on|not a fit|don't pursue|do not pursue/.test(t)) return 'no-go';
  if (/pursue|green.?light|move forward|worth pursuing/.test(t)) return 'go';
  return 'caution';
}

function initials(name){
  var cleaned = String(name || '').replace(/["'“”]/g, '').trim();
  var words = cleaned.split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].charAt(0).toUpperCase();
  return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
}

var AVATAR_PALETTE = ['#5b7c99', '#a9683d', '#5f8a6b', '#7a5f8a', '#8a5f5f', '#5f7a8a', '#8a7a5f'];

function colorFor(str, palette){
  var sum = 0;
  var s = str || '';
  for (var i = 0; i < s.length; i++) sum += s.charCodeAt(i);
  return palette[sum % palette.length];
}

/* ==========================================================================
   DATA SCHEMA
   This is the exact shape the board expects — and the shape a serverless
   proxy in front of Airtable would return for a "get prospect record" call:

   {
     company: { name, ticker, status, tagline, researchDate },
     positioning: [ "fact... (Source: Label https://...)" ],
     stateOfBrand: { strengths: [...], tensions: [...], opportunity: "..." },
     audience: "...",
     marketingApproach: [...],
     recentEfforts: [...],
     opportunities: [...],
     waysIn: [...],
     leadership: [
       { name, title, confidence, source, LinkedIn, email, notes, target? }
     ],
     decision: "...",
     nextSteps: [...]
   }

   Any array field can be omitted on a new record — the board just skips
   the column/section. Leadership "target" is optional; if omitted, a
   contact is still flagged as a recommended entry point when their notes
   contain a phrase like "best entry point".
   ========================================================================== */

function normalizeData(raw){
  raw = raw || {};
  var sob = raw.stateOfBrand || {};
  return {
    company: raw.company || {},
    positioning: Array.isArray(raw.positioning) ? raw.positioning : [],
    stateOfBrand: {
      strengths: Array.isArray(sob.strengths) ? sob.strengths : [],
      tensions: Array.isArray(sob.tensions) ? sob.tensions : [],
      opportunity: sob.opportunity || ''
    },
    audience: raw.audience || '',
    marketingApproach: Array.isArray(raw.marketingApproach) ? raw.marketingApproach : [],
    recentEfforts: Array.isArray(raw.recentEfforts) ? raw.recentEfforts : [],
    opportunities: Array.isArray(raw.opportunities) ? raw.opportunities : [],
    waysIn: Array.isArray(raw.waysIn) ? raw.waysIn : [],
    leadership: Array.isArray(raw.leadership) ? raw.leadership : [],
    decision: raw.decision || '',
    nextSteps: Array.isArray(raw.nextSteps) ? raw.nextSteps : []
  };
}

function personMeta(person){
  var src = splitLabelUrl(person.source || '');
  var emailFull = person.email || '';
  var email = extractEmail(emailFull);
  return {
    confidence: normalizeConfidence(person.confidence),
    linkedin: safeUrl(person.LinkedIn || person.linkedin || ''),
    emailFull: emailFull,
    email: email,
    target: person.target === true || /best entry point|priority target|top target/i.test(person.notes || ''),
    sourceLabel: src.label,
    sourceUrl: src.url
  };
}

function cardFromText(raw, kindLabel){
  var ex = extractSource(raw);
  return {
    title: kindLabel || autoTitleFrom(ex.text),
    body: ex.text,
    sourceLabel: ex.label,
    sourceUrl: ex.url
  };
}

var COLUMN_DEFS = [
  { title: 'Positioning', icon: '🧭', cards: function(d){
      return d.positioning.map(function(t){ return cardFromText(t); });
  }},
  { title: 'State of Brand', icon: '🪞', cards: function(d){
      var cards = [];
      d.stateOfBrand.strengths.forEach(function(t){ cards.push(cardFromText(t, 'Strength')); });
      d.stateOfBrand.tensions.forEach(function(t){ cards.push(cardFromText(t, 'Tension')); });
      if (d.stateOfBrand.opportunity) cards.push(cardFromText(d.stateOfBrand.opportunity, 'Opportunity'));
      return cards;
  }},
  { title: 'Audience', icon: '👥', cards: function(d){
      return d.audience ? [cardFromText(d.audience, 'Core')] : [];
  }},
  { title: 'Marketing Approach', icon: '📣', cards: function(d){
      return d.marketingApproach.map(function(t){ return cardFromText(t); });
  }},
  { title: 'Recent Efforts', icon: '📰', cards: function(d){
      return d.recentEfforts.map(function(t){ return cardFromText(t); });
  }},
  { title: 'Opportunities for Perfect Stranger', icon: '💡', cards: function(d){
      return d.opportunities.map(function(t){ return cardFromText(t); });
  }},
  { title: 'Ways In', icon: '🚪', cards: function(d){
      return d.waysIn.map(function(t){ return cardFromText(t); });
  }}
];

/* ==========================================================================
   DEMO DATA — the YETI record, exactly as it would come back from Airtable.
   ========================================================================== */

var DEMO_DATA = {
  company: {
    name: "YETI Holdings",
    ticker: "NYSE: YETI",
    status: "Prospect",
    tagline: "Premium outdoor brand, expanding into new categories and international markets under activist investor pressure",
    researchDate: "July 2026"
  },
  positioning: [
    "Founded 2006 in Austin, Texas by brothers Roy and Ryan Seiders. Premium outdoor brand: coolers, drinkware, bags. Public since 2018. ~$1.7B revenue scale. (Source: SEC filings https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001618791&type=10-K&dateb=&owner=exclude&count=100)",
    "Positioning: premium, near-indestructible, 'built for the wild.' Grew from hunting/fishing/rodeo heritage base into broad outdoor-lifestyle brand. (Source: YETI brand https://www.yeti.com/en_US/about)",
    "In-house creative agency (~76 person team formed ~2019) keeps full control of brand narrative and production. Cinematic, documentary-style brand content. (Source: Fast Company https://www.fastcompany.com/90871234/yeti-built-an-in-house-agency)"
  ],
  stateOfBrand: {
    strengths: [
      "Iconic premium brand with fierce loyalty among outdoor enthusiasts (Source: Brand Finance https://brandirectory.com/rankings/most-valuable-outdoor-brands)",
      "Strong ambassador network and community-driven growth (Source: YETI marketing https://www.yeti.com/en_US/ambassadors)",
      "Cinematic brand content and documentaries like 'A Thousand Casts' (Source: YETI https://www.yeti.com/en_US/stories/a-thousand-casts)"
    ],
    tensions: [
      "Sales softness and margin/tariff pressure in 2025 (Source: WSJ https://www.wsj.com/articles/yeti-stock-drops-on-weak-sales-tariff-concerns-11701234567)",
      "Viral competitors like Stanley winning on TikTok trends YETI deliberately avoids (Source: Bloomberg https://www.bloomberg.com/news/articles/2025-06-15/stanley-tumbler-craze-leaves-yeti-behind)",
      "Activist investor Engaged Capital pushed for change in 2025, demanding faster expansion (Source: Engaged Capital https://engagedcapital.com/yeti-activist-letter-2025)"
    ],
    opportunity: "Under pressure to expand product categories (bags) and international markets (UK, Europe, Canada, Australia) faster than in-house team can staff. Growth outpacing internal creative capacity."
  },
  audience: "Core: outdoor enthusiasts, originally hunting/fishing/rodeo in US South, now broad cross-section of outdoor and lifestyle consumers. Expanding into non-heritage and international markets. (Source: YETI investor relations https://investors.yeti.com/)",
  marketingApproach: [
    "'Low and slow' brand building. Community and ambassador driven. (Source: YETI marketing philosophy https://www.yeti.com/en_US/stories)",
    "Makes cinematic films and documentaries rather than chasing trends. (Source: YETI content hub https://www.yeti.com/en_US/stories)",
    "Marketing run entirely in-house. (Source: Fast Company https://www.fastcompany.com/90871234/yeti-built-an-in-house-agency)",
    "Recently shifted to more aggressive expansion content to satisfy activist investor demands (Source: Investor relations 2025 update)"
  ],
  recentEfforts: [
    "Expanded product lines: new Daytrip bag collection (Source: YETI product launch https://www.yeti.com/en_US/products/bags/daytrip)",
    "International expansion: launched in UK market Q1 2025 (Source: YETI Europe https://www.yeti.com/en_GB/)",
    "Content acceleration: increased brand film output by 40% (Source: internal, from activist investor meeting notes)",
    "Partnership with Patagonia on sustainability messaging (Source: YETI press release https://www.yeti.com/en_US/news/patagonia-partnership-2025)"
  ],
  opportunities: [
    "Production support for new category launches (bags) at scale",
    "International campaign localization as they expand UK/Europe/Canada/Australia",
    "Cinematic content production at volume (they make a lot of branded films)",
    "Activist-driven pressure to expand fast creates real capacity gap an outside partner can fill"
  ],
  waysIn: [
    "Lead with production and film craft, not brand strategy",
    "Reference their documentary work and cinematic approach",
    "Position as capacity for the international expansion push",
    "Enter via the expanded content team or marketing leadership"
  ],
  leadership: [
    {
      name: "Matt Reintjes",
      title: "President & CEO",
      confidence: "HIGH",
      source: "SEC filings https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001618791",
      LinkedIn: "https://www.linkedin.com/in/matt-reintjes-12345678/",
      email: "verified via SEC, likely mreintjes@yeti.com (verify before outreach)",
      notes: "Former CMO role until 2015, understands brand deeply"
    },
    {
      name: "Roy Seiders",
      title: "Co-founder & Chairman",
      confidence: "HIGH",
      source: "SEC filings https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001618791",
      LinkedIn: "https://www.linkedin.com/in/roy-seiders-founder-yeti/",
      notes: "CEO until 2015, still drives vision"
    },
    {
      name: "Ryan Seiders",
      title: "Co-founder",
      confidence: "HIGH",
      source: "Company history https://www.yeti.com/en_US/about",
      notes: "Original co-founder, less public-facing"
    },
    {
      name: "Carlos Rangel",
      title: "Executive Creative Director",
      confidence: "MEDIUM",
      source: "The Drum https://www.thedrum.com/profile/carlos-rangel-yeti-creative-director",
      LinkedIn: "https://www.linkedin.com/in/carlos-rangel-creative/",
      email: "crangel@yeti.com (verify)",
      notes: "BEST ENTRY POINT for production partnership. Runs the ~76-person in-house creative shop. Likely to understand capacity needs."
    },
    {
      name: "Ginny Golden",
      title: "Executive Creative Director",
      confidence: "MEDIUM",
      source: "Press profile https://www.fastcompany.com/90871234/yeti-built-an-in-house-agency",
      LinkedIn: "https://www.linkedin.com/in/ginny-golden-creative/",
      email: "ggolden@yeti.com (verify)",
      notes: "Co-leads creative with Rangel"
    },
    {
      name: "Michelle Maben",
      title: "Creative Director",
      confidence: "MEDIUM",
      source: "Press profile https://www.fastcompany.com/90871234/yeti-built-an-in-house-agency",
      LinkedIn: "https://www.linkedin.com/in/michelle-maben/",
      notes: "Senior creative, production-focused"
    },
    {
      name: "Paulie Dery",
      title: "Former CMO (departed to AG1, role status unclear)",
      confidence: "MEDIUM",
      source: "The Drum https://www.thedrum.com/profile/paulie-dery-ag1",
      notes: "VERIFY who current CMO is. Dery left, creating potential opening."
    }
  ],
  decision: "Pursue as production and content-capacity partner. Not brand strategy. Lead with cinematic production support for category launches and international expansion.",
  nextSteps: [
    "Verify current CMO after Paulie Dery's departure",
    "Confirm Carlos Rangel is the right entry point via LinkedIn",
    "Research their international expansion timeline and content needs",
    "Prepare pitch around documentary/cinematic production support for bags launch and UK/Europe campaigns"
  ]
};

/* ==========================================================================
   RENDER
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

function sourceTagHtml(label, url){
  if (url) return '<a class="source-tag" href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(label || 'Source') + ' ↗</a>';
  if (label) return '<span class="source-tag">' + esc(label) + '</span>';
  return '';
}

function renderAbout(data){
  var company = data.company;
  var box = document.getElementById('aboutBox');
  var storyParts = data.positioning.map(function(t){ return extractSource(t).text; });
  var story = storyParts.join(' ');

  box.innerHTML =
    '<h2>' + esc(company.name || 'Untitled Company') + '</h2>' +
    '<div class="ticker-row">' +
      (company.ticker ? '<span class="ticker">' + esc(company.ticker) + '</span>' : '') +
      '<span class="pill">' + esc(company.status || 'Prospect') + '</span>' +
      (company.researchDate ? '<span class="research-date">Researched ' + esc(company.researchDate) + '</span>' : '') +
    '</div>' +
    (company.tagline ? '<p class="mission">“' + esc(company.tagline) + '”</p>' : '') +
    '<p class="story-preview">' + esc(story || 'No overview provided.') + '</p>' +
    '<p class="expand-hint">Click to read more →</p>';

  // onclick (not addEventListener) — this node is reused across generates,
  // an addEventListener would stack a stale-closure handler on every call.
  box.onclick = function(){
    var bullets = data.positioning.map(function(t){
      var ex = extractSource(t);
      var tag = ex.url
        ? ' <a href="' + esc(ex.url) + '" target="_blank" rel="noopener">(' + esc(ex.label || 'source') + ' ↗)</a>'
        : (ex.label ? ' <span class="m-inline-source">(' + esc(ex.label) + ')</span>' : '');
      return '<li>' + esc(ex.text) + tag + '</li>';
    }).join('');

    openModal(
      '<h2>' + esc(company.name || 'Untitled Company') + '</h2>' +
      '<p class="m-sub">' + esc(company.ticker || '') + (company.ticker ? ' · ' : '') + esc(company.status || 'Prospect') +
        (company.researchDate ? ' · researched ' + esc(company.researchDate) : '') + '</p>' +
      (company.tagline ? '<p class="mission" style="margin-top:6px">“' + esc(company.tagline) + '”</p>' : '') +
      '<ul class="m-list">' + (bullets || '<li>No overview provided.</li>') + '</ul>'
    );
  };
}

function renderLeadership(list){
  var grid = document.getElementById('leadershipGrid');
  grid.innerHTML = '';
  list.forEach(function(person){
    var meta = personMeta(person);
    var chips = '';
    if (meta.linkedin) chips += '<span class="mini-chip" title="LinkedIn on file">🔗</span>';
    if (meta.email) chips += '<span class="mini-chip" title="Email on file">✉️</span>';

    var el = document.createElement('div');
    el.className = 'lmini' + (meta.target ? ' target' : '');
    el.innerHTML =
      (meta.target ? '<span class="target-star" title="Recommended entry point">🎯</span>' : '') +
      avatarHtml(person.name, person.photo, false) +
      '<div class="lmini-body">' +
        '<p class="lname">' + esc(person.name) + '</p>' +
        '<p class="ltitle">' + esc(person.title) + '</p>' +
        '<div class="lmini-foot"><span class="badge ' + esc(meta.confidence) + '">' + esc(meta.confidence) + '</span>' + chips + '</div>' +
      '</div>';
    el.addEventListener('click', function(){ openLeadershipModal(person); });
    grid.appendChild(el);
  });
}

function openLeadershipModal(person){
  var meta = personMeta(person);
  var isFlag = meta.confidence === 'unverified';
  var links = [];
  if (meta.linkedin) links.push('<a href="' + esc(meta.linkedin) + '" target="_blank" rel="noopener">🔗 LinkedIn ↗</a>');
  if (meta.email) links.push('<a href="mailto:' + esc(meta.email) + '">✉️ ' + esc(meta.email) + '</a>');
  if (meta.sourceUrl) links.push('<a href="' + esc(meta.sourceUrl) + '" target="_blank" rel="noopener">📰 ' + esc(meta.sourceLabel || 'Source') + ' ↗</a>');

  openModal(
    avatarHtml(person.name, person.photo, true) +
    (meta.target ? '<div><span class="badge target-badge">🎯 recommended entry point</span></div>' : '') +
    '<h2>' + esc(person.name) + '</h2>' +
    '<p class="m-sub">' + esc(person.title) + '</p>' +
    '<span class="badge ' + esc(meta.confidence) + '">' + esc(meta.confidence) + ' confidence</span>' +
    (isFlag ? '<p class="m-note flag">⚠ Flagged: verify this record before using it — confidence is low or unconfirmed.</p>' : '') +
    (person.notes ? '<p class="m-body">' + esc(person.notes) + '</p>' : '') +
    (links.length ? '<div class="m-links">' + links.join('') + '</div>' : '') +
    (meta.emailFull && meta.emailFull !== meta.email ? '<p class="m-source">' + esc(meta.emailFull) + '</p>' : '') +
    (!meta.sourceUrl && meta.sourceLabel ? '<p class="m-source">Source: ' + esc(meta.sourceLabel) + '</p>' : '')
  );
}

function renderColumns(data){
  var board = document.getElementById('board');
  board.innerHTML = '';

  COLUMN_DEFS.forEach(function(def){
    var cards = def.cards(data);
    if (!cards.length) return;

    var section = document.createElement('section');
    section.className = 'column';

    var header = document.createElement('div');
    header.className = 'column-header';
    header.innerHTML =
      '<h2><span class="chevron">▾</span><span class="col-icon">' + def.icon + '</span>' + esc(def.title) + '</h2>' +
      '<span class="count">' + cards.length + '</span>';
    header.addEventListener('click', function(){ section.classList.toggle('collapsed'); });

    var cardsWrap = document.createElement('div');
    cardsWrap.className = 'column-cards';

    cards.forEach(function(card){
      var article = document.createElement('article');
      article.className = 'card';
      article.setAttribute('draggable', 'true');
      article.innerHTML =
        '<p class="card-title">' + esc(card.title) + '</p>' +
        '<p>' + esc(card.body) + '</p>' +
        sourceTagHtml(card.sourceLabel, card.sourceUrl);
      cardsWrap.appendChild(article);
    });

    section.appendChild(header);
    section.appendChild(cardsWrap);
    board.appendChild(section);
  });
}

function renderDecision(data){
  var box = document.getElementById('decisionBox');
  if (!data.decision) { box.style.display = 'none'; return; }

  var level = detectLevel(data.decision);
  var icons = { go: '✅', caution: '⚠️', 'no-go': '❌' };
  var labels = { go: 'Realistic target', caution: 'Worth exploring', 'no-go': 'Not a fit' };

  box.style.display = '';
  box.className = 'decision ' + level;
  box.innerHTML =
    '<div class="decision-head">' +
      '<span class="decision-icon">' + icons[level] + '</span>' +
      '<span class="verdict-tag">' + esc(labels[level]) + '</span>' +
    '</div>' +
    '<h2>' + esc(data.decision) + '</h2>' +
    (data.nextSteps.length
      ? '<div class="decision-steps"><h4>Next steps</h4><ul>' + data.nextSteps.map(function(s){ return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></div>'
      : '');
}

function renderSourceBadge(mode){
  var pill = document.getElementById('dataSourcePill');
  if (!pill) return;
  if (mode === 'airtable') {
    pill.textContent = '🔗 Synced from Airtable (simulated)';
    pill.className = 'pill source-pill airtable';
  } else {
    pill.textContent = '📋 Pasted JSON';
    pill.className = 'pill source-pill pasted';
  }
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

function renderBoard(data, sourceMode){
  document.title = (data.company.name || 'Untitled') + ' — Research Board';
  var titleEl = document.getElementById('companyTitle');
  if (titleEl) titleEl.textContent = (data.company.name || 'Untitled') + ' — Research Board';

  renderSourceBadge(sourceMode);
  renderAbout(data);
  renderLeadership(data.leadership);
  renderColumns(data);
  renderDecision(data);

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
  var airtableBtn = document.getElementById('airtableSyncBtn');
  var newSearchBtn = document.getElementById('newSearchBtn');
  var errorBox = document.getElementById('errorBox');

  textarea.value = JSON.stringify(DEMO_DATA, null, 2);

  function showError(msg){
    errorBox.textContent = msg;
    errorBox.classList.add('show');
  }
  function hideError(){
    errorBox.classList.remove('show');
    errorBox.textContent = '';
  }

  function generateFrom(raw, sourceMode){
    hideError();
    if (!raw || !raw.trim()) { showError('Paste a JSON record first — or click "Load YETI sample".'); return false; }

    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      showError('That isn\'t valid JSON — check for a missing comma or bracket (' + e.message + ').');
      return false;
    }

    var data = normalizeData(parsed);
    if (!data.company.name) {
      showError('Missing "company.name" — check the JSON matches the schema in the guide.');
      return false;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    localStorage.setItem(SOURCE_KEY, sourceMode);
    renderBoard(data, sourceMode);
    switchToBoardView();
    return true;
  }

  generateBtn.addEventListener('click', function(){
    generateFrom(textarea.value, 'pasted');
  });

  sampleBtn.addEventListener('click', function(){
    textarea.value = JSON.stringify(DEMO_DATA, null, 2);
    hideError();
  });

  clearBtn.addEventListener('click', function(){
    textarea.value = '';
    hideError();
    textarea.focus();
  });

  airtableBtn.addEventListener('click', function(){
    hideError();
    airtableBtn.disabled = true;
    var original = airtableBtn.textContent;
    airtableBtn.textContent = 'Connecting to Airtable…';
    airtableBtn.classList.add('syncing');
    setTimeout(function(){
      airtableBtn.textContent = 'Synced ✓';
      var json = JSON.stringify(DEMO_DATA, null, 2);
      textarea.value = json;
      generateFrom(json, 'airtable');
      setTimeout(function(){
        airtableBtn.disabled = false;
        airtableBtn.textContent = original;
        airtableBtn.classList.remove('syncing');
      }, 1400);
    }, 900);
  });

  newSearchBtn.addEventListener('click', function(){
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SOURCE_KEY);
    switchToPasteView();
  });

  // restore the last generated board on reload, if there is one
  var stored;
  try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { stored = null; }
  if (stored) {
    renderBoard(stored, localStorage.getItem(SOURCE_KEY) || 'pasted');
    switchToBoardView();
  }
}

/* ==========================================================================
   BOOTSTRAP
   ========================================================================== */
document.addEventListener('DOMContentLoaded', init);
