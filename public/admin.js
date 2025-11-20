// admin.js – Roy-Hart Climate Survey admin dashboard

(function () {
  const tokenInput = document.getElementById('admin-token');
  const loadBtn = document.getElementById('load-summary');
  const statusEl = document.getElementById('status');
  const summaryCard = document.getElementById('summary-card');
  const summaryMeta = document.getElementById('summary-meta');
  const summaryContent = document.getElementById('summary-content');
  const freeCard = document.getElementById('free-card');
  const freeContent = document.getElementById('free-content');

  // Restore token from localStorage if available
  const STORAGE_KEY = 'rh_climate_admin_token';
  const savedToken = window.localStorage.getItem(STORAGE_KEY) || '';
  if (savedToken) tokenInput.value = savedToken;

  loadBtn.addEventListener('click', () => {
    const token = tokenInput.value.trim();
    if (!token) {
      setStatus('Please enter a token.', 'error');
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, token);
    fetchSummary(token);
  });
// Turn building codes into friendly names
function prettyBuildingLabel(building) {
  if (building === 'elem') return 'Elementary';
  if (building === 'ms') return 'Middle School';
  if (building === 'hs') return 'High School';
  return 'All / N/A';
}

/**
 * Turn keys like "safety_reporting_hs" into a readable label.
 * Building suffix (_elem/_ms/_hs) is stripped; building is shown separately.
 * You can customize the category names in prefixMap as you like.
 */
function prettyQuestionLabel(key) {
  // Remove building suffix for the main label
  var base = key.replace(/_(elem|ms|hs)$/, '');
  var words = base.split('_');

  var prefixMap = {
    community: 'School Community',
    comm: 'Communicating Effectively',
    success: 'Supporting Student Success',
    advocacy: 'Speaking Up for Every Child',
    decision: 'Decision Making',
    safety: 'School Safety'
  };

  var prefix = words[0];
  var restWords = words.slice(1);

  // Nice “Category – Rest of words”
  if (prefixMap[prefix]) {
    var rest = restWords
      .join(' ')
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); })
      .trim();

    return rest ? prefixMap[prefix] + ' – ' + rest : prefixMap[prefix];
  }

  // Fallback: title-case the whole thing
  return base
    .replace(/\b\w/g, function (c) { return c.toUpperCase(); })
    .replace(/_/g, ' ');
}

  function setStatus(msg, type) {
    statusEl.textContent = msg || '';
    statusEl.className = '';
    if (type) statusEl.classList.add(type);
  }

  async function fetchSummary(token) {
    setStatus('Loading summary…', 'info');
    summaryCard.hidden = true;
    freeCard.hidden = true;

    try {
      const url = `/admin/summary?token=${encodeURIComponent(token)}`;
      const resp = await fetch(url, { method: 'GET' });

      if (resp.status === 403) {
        setStatus('Forbidden: token is incorrect.', 'error');
        return;
      }
      if (!resp.ok) {
        setStatus(`Server error (${resp.status}).`, 'error');
        return;
      }

      const data = await resp.json();
      if (!data.ok) {
        setStatus(data.error || 'Unknown error from server.', 'error');
        return;
      }

      renderSummary(data.summary);
      renderFreeText(data.summary.freeText || {});
      setStatus(
        'Summary loaded. You can print this page with Ctrl+P / ⌘+P.',
        'success'
      );
    } catch (err) {
      console.error(err);
      setStatus('Network error while loading summary.', 'error');
    }
  }

  // ------------ Summary rendering ------------

  function renderSummary(summary) {
    summaryCard.hidden = false;

    const total = summary.totalSubmissions || 0;
    summaryMeta.innerHTML = `
      <span><strong>${total}</strong> total submissions</span>
      <span>Survey ID: <code>${summary.surveyId}</code></span>
    `;

    const questions = Object.values(summary.questions || {});
    if (!questions.length) {
      summaryContent.innerHTML = '<p>No scale-question data yet.</p>';
      return;
    }

    // Group questions by category & building
    const groups = new Map();
    for (const q of questions) {
      const meta = parseQuestionMeta(q.key);
      const groupKey = `${meta.categoryLabel}|${meta.buildingLabel}`;
      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          categoryLabel: meta.categoryLabel,
          buildingLabel: meta.buildingLabel,
          questions: [],
        });
      }
      groups.get(groupKey).questions.push(q);
    }

    // Sort groups for stable layout
    const groupList = Array.from(groups.values()).sort((a, b) => {
      const c = a.categoryLabel.localeCompare(b.categoryLabel);
      if (c !== 0) return c;
      return a.buildingLabel.localeCompare(b.buildingLabel);
    });

    const container = document.createElement('div');
    container.className = 'grid';

    for (const group of groupList) {
      const card = document.createElement('div');
      card.className = 'section-card';

      const title = document.createElement('div');
      title.className = 'section-title';
      title.textContent = group.categoryLabel;
      card.appendChild(title);

      const subtitle = document.createElement('div');
      subtitle.className = 'section-subtitle';
      subtitle.textContent = group.buildingLabel;
      card.appendChild(subtitle);

      // Each question in this group
      group.questions
        .slice()
        .sort((a, b) => a.key.localeCompare(b.key))
        .forEach((q) => {
          card.appendChild(renderQuestionRow(q));
        });

      container.appendChild(card);
    }

    summaryContent.innerHTML = '';
    summaryContent.appendChild(container);
  }

  function renderQuestionRow(q) {
    const wrapper = document.createElement('div');
    wrapper.className = 'question-row';

    const label = document.createElement('div');
    label.className = 'question-label';
    label.textContent = q.key;
    wrapper.appendChild(label);

    const barRow = document.createElement('div');
    barRow.className = 'bar-row';

    const barTrack = document.createElement('div');
    barTrack.className = 'bar-track';

    const counts = q.counts || {};
    const maxCount = Math.max(1, ...[1, 2, 3, 4, 5].map((k) => counts[k] || 0));

    [1, 2, 3, 4, 5].forEach((score) => {
      const count = counts[score] || 0;
      const segment = document.createElement('div');
      segment.className = `bar bar-${score}`;
      const pct = (count / maxCount) * 100;
      segment.style.width = `${pct}%`;
      barTrack.appendChild(segment);
    });

    const barLabel = document.createElement('div');
    barLabel.className = 'bar-label';

    const avg =
      typeof q.average === 'number'
        ? q.average.toFixed(2)
        : '–';

    barLabel.textContent = `${q.responses || 0} resp · avg ${avg}`;

    barRow.appendChild(barTrack);
    barRow.appendChild(barLabel);

    wrapper.appendChild(barRow);
    return wrapper;
  }

  // ------------ Free-text rendering ------------

  function renderFreeText(freeTextObj) {
    freeContent.innerHTML = '';

    const entries = Object.entries(freeTextObj || {});
    if (!entries.length) {
      freeCard.hidden = true;
      return;
    }

    const rows = entries.map(([key, rawResponses]) => {
      let responses;
      if (Array.isArray(rawResponses)) {
        responses = rawResponses.map(String);
      } else if (rawResponses == null) {
        responses = [];
      } else {
        responses = [String(rawResponses)];
      }

      const meta = parseQuestionMeta(key);
      return { key, meta, responses };
    });

    // Sort by category, then building, then key
    rows.sort((a, b) => {
      const c = a.meta.categoryLabel.localeCompare(b.meta.categoryLabel);
      if (c !== 0) return c;
      const d = a.meta.buildingLabel.localeCompare(b.meta.buildingLabel);
      if (d !== 0) return d;
      return a.key.localeCompare(b.key);
    });

    for (const row of rows) {
      const wrapper = document.createElement('div');
      wrapper.className = 'free-section';

      const header = document.createElement('div');
      header.className = 'free-header';
      header.textContent = `${row.meta.categoryLabel} – ${row.meta.buildingLabel}`;
      wrapper.appendChild(header);

      const metaLine = document.createElement('div');
      metaLine.className = 'free-meta';
      metaLine.innerHTML =
        `<code>${row.key}</code> · ${row.responses.length} response` +
        (row.responses.length === 1 ? '' : 's');
      wrapper.appendChild(metaLine);

      const ul = document.createElement('ul');
      ul.className = 'free-list';
      row.responses.forEach((text) => {
        const li = document.createElement('li');
        li.textContent = text;
        ul.appendChild(li);
      });
      wrapper.appendChild(ul);

      freeContent.appendChild(wrapper);
    }

    freeCard.hidden = false;
  }

  // ------------ Helpers ------------

  function parseQuestionMeta(key) {
    // Building suffix
    let buildingLabel = 'All / N/A';
    let base = key;

    if (key.endsWith('_elem')) {
      buildingLabel = 'Elementary';
      base = key.replace(/_elem$/, '');
    } else if (key.endsWith('_ms')) {
      buildingLabel = 'Middle School';
      base = key.replace(/_ms$/, '');
    } else if (key.endsWith('_hs')) {
      buildingLabel = 'High School';
      base = key.replace(/_hs$/, '');
    }

    // Category from prefix
    const cat = base.split('_')[0]; // community, comm, success, advocacy, decision, safety
    const categoryMap = {
      community: 'School Community',
      comm: 'Communicating Effectively',
      success: 'Supporting Student Success',
      advocacy: 'Speaking Up for Every Child',
      decision: 'Decision Making',
      safety: 'School Safety',
    };

    const categoryLabel = categoryMap[cat] || 'Other';

    return { categoryLabel, buildingLabel };
  }
})();
