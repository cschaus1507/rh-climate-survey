// Roy-Hart Climate Survey Admin JS
// Talks to /admin/summary and renders overview, building/category aggregates,
// per-question details, and open-ended ("free") responses.

window.addEventListener('DOMContentLoaded', () => {
  const statusEl = document.getElementById('status');
  const loadBtn = document.getElementById('loadBtn');
  const printBtn = document.getElementById('printBtn');
  const adminInput = document.getElementById('adminToken');

  const overviewCard = document.getElementById('overviewCard');
  const surveyIdEl = document.getElementById('surveyId');
  const totalSubmissionsEl = document.getElementById('totalSubmissions');

  const buildingCard = document.getElementById('buildingCard');
  const buildingBody = document.getElementById('buildingBody');

  const categoryCard = document.getElementById('categoryCard');
  const categoryBody = document.getElementById('categoryBody');

  const questionsCard = document.getElementById('questionsCard');
  const questionsBody = document.getElementById('questionsBody');

  const freeCard = document.getElementById('freeCard');
  const freeContent = document.getElementById('freeContent');

  function setStatus(msg, isError) {
    statusEl.textContent = msg || '';
    let cls = 'status';
    if (msg) cls += isError ? ' error' : ' success';
    statusEl.className = cls;
  }

  const CATEGORY_LABELS = {
    community: 'School Community',
    comm: 'Communicating Effectively',
    success: 'Supporting Student Success',
    advocacy: 'Speaking Up for Every Child',
    decision: 'Decision Making',
    safety: 'School Safety'
  };

  const BUILDING_LABELS = {
    elem: 'Elementary School',
    ms: 'Middle School',
    hs: 'High School',
    na: 'All / N/A'
  };

  function parseQuestionMeta(key) {
    const parts = key.split('_');
    if (parts.length < 2) {
      return {
        rawKey: key,
        categoryKey: key,
        categoryLabel: key,
        buildingKey: 'na',
        buildingLabel: BUILDING_LABELS.na,
        questionId: key
      };
    }

    const categoryKey = parts[0];
    const buildingCode = parts[parts.length - 1];
    const buildingKey = ['elem', 'ms', 'hs'].includes(buildingCode)
      ? buildingCode
      : 'na';

    const questionId = parts.slice(0, parts.length - (buildingKey === 'na' ? 0 : 1)).join('_');
    const categoryLabel = CATEGORY_LABELS[categoryKey] || categoryKey;
    const buildingLabel = BUILDING_LABELS[buildingKey] || BUILDING_LABELS.na;

    return {
      rawKey: key,
      categoryKey,
      categoryLabel,
      buildingKey,
      buildingLabel,
      questionId
    };
  }

  async function loadSummary() {
    const token = adminInput.value.trim();
    if (!token) {
      setStatus('Please enter your admin token.', true);
      return;
    }

    setStatus('Loading summary…', false);
    loadBtn.disabled = true;

    try {
      const url = `/admin/summary?token=${encodeURIComponent(token)}`;
      const res = await fetch(url);
      const text = await res.text();
      console.log('Raw /admin/summary response:', text);

      if (!res.ok) {
        setStatus('HTTP error ' + res.status + '. Check token or server.', true);
        return;
      }

      let json;
      try {
        json = JSON.parse(text);
      } catch (err) {
        console.error('JSON parse error:', err);
        setStatus('Could not parse JSON from server.', true);
        return;
      }

      if (!json.ok) {
        setStatus('Server error: ' + (json.error || 'unknown'), true);
        return;
      }

      renderSummary(json.summary);
      setStatus('Summary loaded.', false);
    } catch (err) {
      console.error(err);
      setStatus('Network error while fetching summary.', true);
    } finally {
      loadBtn.disabled = false;
    }
  }

  function renderSummary(summary) {
    if (!summary) return;

    // --- Overview ---
    overviewCard.hidden = false;
    surveyIdEl.textContent = summary.surveyId || '';
    totalSubmissionsEl.textContent = summary.totalSubmissions ?? '0';

    const questionsObj = summary.questions || {};
    const allQuestions = Object.values(questionsObj).filter(q => q && q.type === 'scale');

    // --- By building ---
    const buildingStats = {};
    for (const q of allQuestions) {
      const meta = parseQuestionMeta(q.key);
      if (meta.buildingKey === 'na') continue; // skip non-building-specific

      const b = buildingStats[meta.buildingKey] || {
        name: meta.buildingLabel,
        responses: 0,
        sum: 0
      };
      b.responses += q.responses || 0;
      b.sum += q.sum || 0;
      buildingStats[meta.buildingKey] = b;
    }

    buildingBody.innerHTML = '';
    const buildingRows = Object.values(buildingStats);
    if (buildingRows.length) {
      buildingRows.sort((a, b) => a.name.localeCompare(b.name));
      for (const b of buildingRows) {
        const avg = b.responses ? (b.sum / b.responses) : null;
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${b.name}</td>
          <td>${b.responses}</td>
          <td>${avg != null ? avg.toFixed(2) : ''}</td>
        `;
        buildingBody.appendChild(tr);
      }
      buildingCard.hidden = false;
    } else {
      buildingCard.hidden = true;
    }

    // --- By category ---
    const categoryStats = {};
    for (const q of allQuestions) {
      const meta = parseQuestionMeta(q.key);
      const c = categoryStats[meta.categoryKey] || {
        name: meta.categoryLabel,
        responses: 0,
        sum: 0
      };
      c.responses += q.responses || 0;
      c.sum += q.sum || 0;
      categoryStats[meta.categoryKey] = c;
    }

    categoryBody.innerHTML = '';
    const categoryRows = Object.values(categoryStats);
    if (categoryRows.length) {
      categoryRows.sort((a, b) => a.name.localeCompare(b.name));
      for (const c of categoryRows) {
        const avg = c.responses ? (c.sum / c.responses) : null;
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${c.name}</td>
          <td>${c.responses}</td>
          <td>${avg != null ? avg.toFixed(2) : ''}</td>
        `;
        categoryBody.appendChild(tr);
      }
      categoryCard.hidden = false;
    } else {
      categoryCard.hidden = true;
    }

    // --- By question ---
    questionsBody.innerHTML = '';
    if (allQuestions.length) {
      const rows = allQuestions.map(q => {
        const meta = parseQuestionMeta(q.key);
        const counts = q.counts || {};
        const countsStr =
          '1:' + (counts['1'] || 0) + '  ' +
          '2:' + (counts['2'] || 0) + '  ' +
          '3:' + (counts['3'] || 0) + '  ' +
          '4:' + (counts['4'] || 0) + '  ' +
          '5:' + (counts['5'] || 0);
        const avg = q.average != null ? q.average : (q.responses ? q.sum / q.responses : null);

        return {
          categoryLabel: meta.categoryLabel,
          buildingLabel: meta.buildingLabel,
          key: q.key,
          responses: q.responses || 0,
          average: avg,
          countsStr
        };
      });

      rows.sort((a, b) => {
        const c = a.categoryLabel.localeCompare(b.categoryLabel);
        if (c !== 0) return c;
        const bld = a.buildingLabel.localeCompare(b.buildingLabel);
        if (bld !== 0) return bld;
        return a.key.localeCompare(b.key);
      });

      for (const r of rows) {
        const tr = document.createElement('tr');
        const avgDisplay = r.average != null ? r.average.toFixed(2) : '';
        const avgVal = r.average != null ? r.average : 0;

        tr.innerHTML = `
          <td>${r.categoryLabel}</td>
          <td>${r.buildingLabel}</td>
          <td><code>${r.key}</code></td>
          <td>${r.responses}</td>
          <td>${avgDisplay}</td>
          <td>${r.countsStr}</td>
          <td><progress max="5" value="${avgVal.toFixed(2)}"></progress></td>
        `;
        questionsBody.appendChild(tr);
      }

      questionsCard.hidden = false;
    } else {
      questionsCard.hidden = true;
    }

    // --- Free-text responses ---
    renderFreeText(summary.freeText || {});
  }

  function renderFreeText(freeTextObj) {
    freeContent.innerHTML = '';

    const items = Object.values(freeTextObj || {});
    if (!items.length) {
      freeCard.hidden = true;
      return;
    }

    // Normalize into array of { meta, responses[] }
    const rows = items.map(item => {
      const key = item.key || item.questionKey || item.id || '';
      const meta = parseQuestionMeta(key);

      // Try a few common property names for arrays of responses
      let responses = item.values || item.responses || item.texts || item.list || [];
      if (!Array.isArray(responses)) {
        responses = [String(responses)];
      }

      return {
        key,
        meta,
        responses
      };
    });

    // Sort by category, then building, then key
    rows.sort((a, b) => {
      const c = a.meta.categoryLabel.localeCompare(b.meta.categoryLabel);
      if (c !== 0) return c;
      const bld = a.meta.buildingLabel.localeCompare(b.meta.buildingLabel);
      if (bld !== 0) return bld;
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
      metaLine.innerHTML = `<code>${row.key}</code> · ${row.responses.length} response${row.responses.length === 1 ? '' : 's'}`;
      wrapper.appendChild(metaLine);

      const ul = document.createElement('ul');
      ul.className = 'free-list';
      row.responses.forEach(text => {
        const li = document.createElement('li');
        li.textContent = text;
        ul.appendChild(li);
      });
      wrapper.appendChild(ul);

      freeContent.appendChild(wrapper);
    }

    freeCard.hidden = false;
  }

  // Wire up buttons
  loadBtn.addEventListener('click', loadSummary);
  printBtn.addEventListener('click', () => window.print());

  console.log('Admin script initialized.');
});
