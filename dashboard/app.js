// Apogee's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, a filterable table, a per-protocol detail view and the method. No network:
// every byte it shows is in data.js. The page recomputes nothing the program did not already
// compute; the numbers it shows are the program's own rows, so the screenshots and the code agree.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var rows = DATA.rows || [];

  var state = { q: '', category: 'all', verdict: 'all', watch: false, sort: 'rank', dir: 1, selected: null };

  function $(id) { return document.getElementById(id); }
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        else node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    var sign = n < 0 ? '-' : '';
    if (a >= 1e9) return sign + '$' + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return sign + '$' + (a / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return sign + '$' + (a / 1e3).toFixed(1) + 'K';
    return sign + '$' + Math.round(a);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return n.toFixed(1) + 'y';
  }
  function fmtFactor(log10) {
    var f = Math.pow(10, log10);
    return 'x' + (f >= 100 ? f.toFixed(0) : f >= 10 ? f.toFixed(1) : f.toFixed(2));
  }

  // ---- header, KPIs, validation -------------------------------------------------
  $('asof').textContent = 'Snapshot ' + DATA.as_of + ' · ' + DATA.n_comps + ' traded comps · model ' + DATA.model_name;

  var winnerScore = null;
  DATA.variant_scores.forEach(function (s) { if (s.variant === DATA.winner) winnerScore = s; });
  var kpis = [
    [String(DATA.board_size), 'pre-token protocols ranked'],
    [DATA.watchlist_size + '/40', 'watchlist covered'],
    [String(DATA.n_comps), 'traded comps fitted'],
    [winnerScore ? winnerScore.wf_median.toFixed(4) : 'n/a', 'walk-forward median log error'],
    [winnerScore ? winnerScore.blind_median.toFixed(4) : 'n/a', 'blind holdout median log error'],
    [String(DATA.verdict_counts.farm || 0), 'farm verdicts'],
  ];
  kpis.forEach(function (k) {
    $('kpis').appendChild(el('div', { class: 'kpi' }, el('b', { text: k[0] }), el('span', { text: k[1] })));
  });

  var v = $('validation');
  v.appendChild(el('h2', { text: 'Validation — twenty-nine variants, one protocol, no favourites' }));
  v.appendChild(el('p', { class: 'muted', text: 'Every variant is scored on the same snapshot with the same two tests: a walk-forward time-split (comps ordered by listing date, 3 expanding folds, ' + DATA.n_wf + ' test predictions) and a blind holdout (5 seeded 75/25 splits, ' + DATA.n_blind + ' test predictions). A–D are the first entry\u2019s field, rerun unchanged as controls — their numbers reproduce its published ones. E–M are the previous entry\u2019s challengers. N–T and U, W, X, Y, Z, K1, K2 are this entry\u2019s: recency-weighted comps, a two-knot curve, a growth-by-segment interaction, category offsets on the two-segment base, and the robust and ridge fits and other hinge placements on the winning base itself. A challenger ships only by beating the shipped model I by 0.005 on walk-forward while being no worse on blind — none did, so I ships again.' }));
  var vt = el('table', {});
  var vhead = el('tr', {}, el('th', { text: 'Variant' }), el('th', { text: 'Walk-forward median error' }), el('th', { text: 'Walk-forward within 2x' }), el('th', { text: 'Blind median error' }), el('th', { text: 'Blind within 2x' }));
  vt.appendChild(el('thead', {}, vhead));
  var vbody = el('tbody', {});
  DATA.variant_scores.forEach(function (s) {
    vbody.appendChild(el('tr', { class: s.variant === DATA.winner ? 'winner' : '' },
      el('td', { text: s.variant + ' — ' + s.label + (s.variant === DATA.winner ? ' (winner)' : '') }),
      el('td', { text: s.wf_median.toFixed(4) }),
      el('td', { text: (s.wf_within2 * 100).toFixed(1) + '%' }),
      el('td', { text: s.blind_median.toFixed(4) }),
      el('td', { text: (s.blind_within2 * 100).toFixed(1) + '%' })));
  });
  vt.appendChild(vbody);
  v.appendChild(vt);
  v.appendChild(el('p', { text: 'Winning model: ' + DATA.model_formula + '.' }));
  v.appendChild(el('p', { text: 'The no-token clock was tested, not assumed. In three forms — J (log-days on the single-slope curve), L (log-days) and M (years) on the two-segment curve — it made the walk-forward error far worse (0.59–0.65 against 0.44) while the blind test stayed indifferent: fitted on early listings, the clock prices the listing era, and the sign reverses on later cohorts. Recency weighting failed the same way (N1–N3: 0.50–0.54): old comps carry the signal, and recent listings are a different era. A second hinge overfits on 128 comps (O: 0.56). So the clock is carried on every row and in every detail view, and priced into none. Each estimate is the median of 200 bootstrap refits, with a p10–p90 band and a rank range (10th–90th percentile of rank across refits).' }));
  var cov = DATA.coverage;
  var excl = Object.keys(cov.excluded_by_reason).map(function (k) { return k + ' ' + cov.excluded_by_reason[k]; }).join(', ');
  v.appendChild(el('p', { class: 'muted', text: 'Coverage: ' + cov.total + ' protocols = ' + cov.board + ' on the board + ' + cov.token_recorded + ' recording a token + ' + cov.excluded + ' excluded (' + (excl || 'none') + ').' }));

  // ---- methodology --------------------------------------------------------------
  var m = $('method');
  m.appendChild(el('h2', { text: 'Methodology' }));
  m.appendChild(el('p', { text: 'Comps: one per ticker (grouped by CoinGecko id, falling back to symbol; largest TVL per group), market cap above zero and TVL above zero — ' + DATA.n_comps + ' comps in this snapshot. Features are log10(TVL), seven-day growth clipped to [-90, 200] per cent (unreported counts as 0), the no-token clock (days and years from the listing date to the snapshot date, median-imputed when unlisted), and the chain count. Every feature was offered to the bake-off; the tests above decided which ones price.' }));
  m.appendChild(el('p', { text: 'The winning curve is two-segment: below the comps\u2019 median TVL the market pays one slope for size, above it another — the single-slope curve of the first entry is variant B/C above, and the hinge is what the walk-forward test kept. The board ranks every protocol that records no token and passes the house watchlist exclusions — category Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC or CEX; a version marker at the end of the name; a whole word wrapped, staked or staking; or an exchange name at the start — with no $50M floor. No name is ever special-cased.' }));
  m.appendChild(el('h3', { text: 'The farm plan, dated and netted to the dollar' }));
  var a = DATA.assumptions;
  var part = Object.keys(a.participation).map(function (k) { return k + ' ' + (a.participation[k] * 100).toFixed(0) + '%'; }).join(', ');
  var gas = Object.keys(a.gas_per_tx_usd_estimates).map(function (k) { return k + ' $' + a.gas_per_tx_usd_estimates[k]; }).join(', ');
  var ul = el('ul', {},
    el('li', { text: 'Horizon ' + a.horizon_weeks + ' weeks from the snapshot date; every step names its week and its dates. The community is assumed to take a ' + (a.community_share * 100).toFixed(0) + '% share of the token.' }),
    el('li', { text: 'Participation (the share of TVL assumed to farm): ' + part + '; ' + (a.default_participation * 100).toFixed(0) + '% for other categories. Competing capital = participation x TVL.' }),
    el('li', { text: 'Deposit by TVL: ' + a.deposit_tiers + '.' }),
    el('li', { text: 'Gas is priced per chain, not flat: one setup transaction per chain plus one weekly transaction on the main chain. Estimates per transaction (November 2026): ' + gas + '; $' + a.default_gas_per_tx_usd + ' for any other chain. ' + a.gas_note }),
    el('li', { text: 'Gross at the low end = p10 x community share x deposit / (deposit + competing capital). Fees = ' + a.fees + '. Hours = ' + a.farm_hours + '. Capital cost = ' + a.capital_cost + '.' }),
    el('li', { text: 'The weekly step names the action the protocol\u2019s own mechanism calls for: repay and re-borrow for a lender, harvest and re-deposit for a yield vault, close and reopen the hedge for a derivatives desk — a plan that repeats one generic action every week is not a plan.' }),
    el('li', { text: 'Net = gross - fees - capital cost. Verdict farm when net is at least $200 and at least $25 an hour; thin when net is above $0; otherwise skip.' }),
    el('li', { text: 'Break-even is the implied value at which the low-end gross exactly covers fees plus capital cost.' }));
  m.appendChild(ul);
  m.appendChild(el('p', { class: 'muted', text: 'Limits: the snapshot is one day (its as_of date); a protocol that records no token may still have one its record does not carry; growth and age are the snapshot\u2019s own figures, and the model cannot see what the snapshot does not record. Source: ' + DATA.source }));

  // ---- filters ------------------------------------------------------------------
  var cats = [];
  rows.forEach(function (r) { if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category); });
  cats.sort();
  var catSel = $('cat');
  cats.forEach(function (c) { catSel.appendChild(el('option', { value: c, text: c })); });

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  function sortRows(list) {
    var key = state.sort;
    var dir = state.dir;
    return list.slice().sort(function (a, b) {
      var av = a[key];
      var bv = b[key];
      if (av === null || av === undefined) av = '';
      if (bv === null || bv === undefined) bv = '';
      var cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      if (cmp === 0) cmp = a.rank - b.rank;
      return cmp * dir;
    });
  }

  function renderTable() {
    var list = sortRows(filtered());
    var tbody = $('rows');
    tbody.textContent = '';
    list.forEach(function (r) {
      var tr = el('tr', { class: state.selected === r.slug ? 'selected' : '', onClick: function () { select(r.slug, true); } },
        el('td', { text: String(r.rank) }),
        el('td', { class: 'name' }, el('b', { text: r.name }), document.createTextNode(' '), el('span', { class: 'slug', text: r.slug }), r.watchlist ? el('span', { class: 'watch', text: 'WATCH' }) : null),
        el('td', { text: r.category || '—' }),
        el('td', { text: fmtUsd(r.tvl_usd) }),
        el('td', { text: fmtPct(r.change_7d) }),
        el('td', { text: fmtAge(r.age_years) }),
        el('td', { text: fmtUsd(r.implied_value_usd) }),
        el('td', { text: fmtUsd(r.implied_p10) + ' – ' + fmtUsd(r.implied_p90) }),
        el('td', { text: '#' + r.rank_lo + '–' + r.rank_hi }),
        el('td', { text: fmtUsd(r.net) }),
        el('td', { text: fmtUsd(r.usd_per_hour) }),
        el('td', {}, el('span', { class: 'badge ' + r.verdict, text: r.verdict })));
      tbody.appendChild(tr);
    });
    $('count').textContent = list.length + ' of ' + rows.length + ' protocols';
  }

  // ---- detail -------------------------------------------------------------------
  function select(slug, pushHash) {
    var r = null;
    rows.forEach(function (x) { if (x.slug === slug) r = x; });
    state.selected = r ? r.slug : null;
    var d = $('detail');
    if (!r) {
      d.hidden = true;
      d.textContent = '';
      renderTable();
      return;
    }
    d.hidden = false;
    d.textContent = '';
    d.appendChild(el('button', { class: 'close', text: 'Close', onClick: function () { select(null, true); } }));
    var h = el('h2', {}, document.createTextNode('#' + r.rank + ' ' + r.name + ' '), el('span', { class: 'slug', text: r.slug }));
    d.appendChild(h);
    d.appendChild(el('p', { class: 'muted', text: (r.category || 'Uncategorised') + ' · ' + r.chains.join(', ') + ' · TVL ' + fmtUsd(r.tvl_usd) + ' · 7-day change ' + fmtPct(r.change_7d) + (r.listed_at ? ' · tracked since ' + r.listed_at + ' · ' + fmtAge(r.age_years) + ' with no token recorded' : ' · no listing date recorded') + (r.watchlist ? ' · on the house watchlist' : '') }));
    var kv = el('div', { class: 'kv' },
      el('div', {}, el('b', { text: fmtUsd(r.implied_value_usd) }), el('span', { text: 'Implied value (bootstrap median)' })),
      el('div', {}, el('b', { text: fmtUsd(r.implied_p10) + ' – ' + fmtUsd(r.implied_p90) }), el('span', { text: 'Value band p10–p90' })),
      el('div', {}, el('b', { text: '#' + r.rank_lo + '–' + r.rank_hi }), el('span', { text: 'Rank range across 200 refits' })),
      el('div', {}, el('b', { text: fmtUsd(r.net) + ' net · ' + fmtUsd(r.usd_per_hour) + '/hr' }), el('span', { text: 'Farm plan, low end' })));
    d.appendChild(kv);
    if (r.parts && r.parts.length) {
      d.appendChild(el('h3', { text: 'How this number is built' }));
      var pt = el('table', {});
      var pbody = el('tbody', {});
      r.parts.forEach(function (p) {
        pbody.appendChild(el('tr', {},
          el('td', { text: p.label }),
          el('td', { text: p.key === 'base' ? fmtUsd(Math.pow(10, p.log10)) : fmtFactor(p.log10) })));
      });
      pbody.appendChild(el('tr', { class: 'winner' },
        el('td', { text: 'Point estimate before the bootstrap band' }),
        el('td', { text: fmtUsd(Math.pow(10, r.parts.reduce(function (s, p) { return s + p.log10; }, 0))) })));
      pt.appendChild(pbody);
      d.appendChild(pt);
      d.appendChild(el('p', { class: 'muted', text: 'The size curve prices the protocol off its TVL alone; each further row multiplies that base. The implied value above is the median of 200 bootstrap refits of the same model, so it need not equal the point estimate to the dollar.' }));
    }
    if (r.neighbours && r.neighbours.length) {
      d.appendChild(el('h3', { text: 'Priced against these traded tokens' }));
      var nt = el('table', {});
      nt.appendChild(el('thead', {}, el('tr', {}, el('th', { text: 'Traded token' }), el('th', { text: 'TVL' }), el('th', { text: 'Market cap' }), el('th', { text: 'Cap / TVL' }))));
      var nbody = el('tbody', {});
      r.neighbours.forEach(function (nb) {
        nbody.appendChild(el('tr', {},
          el('td', { text: nb.name }),
          el('td', { text: fmtUsd(nb.tvl_usd) }),
          el('td', { text: fmtUsd(nb.mcap_usd) }),
          el('td', { text: 'x' + (nb.mcap_usd / nb.tvl_usd).toFixed(2) })));
      });
      nt.appendChild(nbody);
      d.appendChild(nt);
      d.appendChild(el('p', { class: 'muted', text: 'The traded tokens nearest this protocol in TVL — the anchors its segment of the size curve is fitted through.' }));
    }
    d.appendChild(el('h3', { text: 'Farm plan — ' + r.verdict + ' (deposit ' + fmtUsd(r.deposit) + ', break-even ' + fmtUsd(r.breakeven) + ')' }));
    var ol = el('ol', {});
    r.farm_steps.forEach(function (s) { ol.appendChild(el('li', { text: s })); });
    d.appendChild(ol);
    d.appendChild(el('p', { class: 'muted', text: 'Gross at the low end ' + fmtUsd(r.gross_low) + ' · fees ' + fmtUsd(r.fees) + ' · capital cost ' + fmtUsd(r.capital_cost) + ' · ' + r.hours + ' hours over ' + DATA.assumptions.horizon_weeks + ' weeks.' }));
    renderTable();
    if (pushHash) {
      try { history.replaceState(null, '', '#p=' + r.slug); } catch (e) { /* hash only */ }
      d.scrollIntoView({ block: 'start' });
    }
  }

  // ---- wiring -------------------------------------------------------------------
  $('q').addEventListener('input', function (e) { state.q = e.target.value; renderTable(); });
  catSel.addEventListener('change', function (e) { state.category = e.target.value; renderTable(); });
  $('verdict').addEventListener('change', function (e) { state.verdict = e.target.value; renderTable(); });
  $('watch').addEventListener('change', function (e) { state.watch = e.target.checked; renderTable(); });
  document.querySelectorAll('#table thead th').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = key === 'name' || key === 'category' || key === 'verdict' ? 1 : -1; }
      renderTable();
    });
  });

  function readHash() {
    var h = window.location.hash.replace(/^#/, '');
    var p = null;
    var cat = null;
    h.split('&').forEach(function (part) {
      var kv = part.split('=');
      if (kv[0] === 'p') p = decodeURIComponent(kv[1] || '');
      if (kv[0] === 'cat') cat = decodeURIComponent(kv[1] || '');
    });
    if (cat && cats.indexOf(cat) >= 0) {
      state.category = cat;
      catSel.value = cat;
    }
    if (p) select(p, true);
    else renderTable();
  }
  window.addEventListener('hashchange', readHash);

  renderTable();
  readHash();
})();
