// admin.js

// ---------- helpers for labels ----------

function prettyBuildingLabel(building) {
  if (building === 'elem') return 'Elementary';
  if (building === 'ms') return 'Middle School';
  if (building === 'hs') return 'High School';
  return 'All / N/A';
}

/**
 * Turn a question key like "safety_reporting_hs" into a readable label:
 * "Safety Reporting" (building is shown separately).
 * You can customize this map with your exact wording if you’d like.
 */
function prettyQuestionLabel(key) {
  // Strip building suffix for label
  var base = key.replace(/_(elem|ms|hs)$/, '');
  var words = base.split('_');

  // Optional nicer replacements by prefix
  var prefixMap = {
    community: 'School Community',
    comm: 'Communicating Effectively',
    success: 'Supporting Student Success',
    advocacy: 'Speaking Up for Every Child',
    decision: 'Decision Making',
    safety: 'School Safety'
  };

  var prefix = words[0];
  if (prefixMap[prefix]) {
    // Show "Category – rest of words"
    var rest = words.slice(1).join(' ');
    rest = rest
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); })
      .trim();
    if (rest) {
      return prefixMap[prefix] + ' – ' + rest;
    }
    return prefixMap[prefix];
  }

  // Fallback: just title-case the whole thing
  return base
    .replace(/\b\w/g, function (c) { return c.toUpperCase(); })
    .replace(/_/g, ' ');
}

// ---------- DOM references ----------

var tokenInput = document.getElementById('adminTokenInput');
var loadBtn = document.getElementById('loadSummaryBtn');
var resetBtn = document.getElementById('resetBtn');
var statusLine = document.getElementById('statusLine');
var summaryRoot = document.getElementById('summaryRoot');

// ---------- event wiring ----------

loadBtn.addEventListener('click', function () {
  var token = (tokenInput.value || '').trim();
  if (!token) {
    alert('Please enter the admin token.');
    return;
  }
  loadSummary(token);
});

resetBtn.addEventListener('click', function () {
  var token = (tokenInput.value || '').trim();
  if (!token) {
    alert('Enter the admin token before resetting.');
    return;
  }

  var confirmed = confirm(
    'This will permanently delete ALL stored submissions for this survey.\n\n' +
      'Use this only at the beginning of a new survey year.\n\n' +
      'Are you sure you want to continue?'
  );

  if (!confirmed) return;

  resetAllResponses(token);
});

// Press Enter in token box to load
tokenInput.addEventListener('keydown', function (e) {
  if (e.key === 'Enter') {
    loadBtn.click();
  }
});

// ---------- backend calls ----------

async function loadSummary(token) {
  statusLine.textContent = 'Loading summary…';
  summaryRoot.innerHTML = '';
  loadBtn.disabled = true;

  try {
    const res = await fetch(
      `/admin/summary?token=${encodeURIComponent(token)}`
    );

    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Unable to load summary');
    }

    renderSummary(data.summary);
    statusLine.textContent = 'Summary loaded.';
  } catch (err) {
    console.error(err);
    statusLine.textContent = 'Error: ' + err.message;
    alert('Error loading summary: ' + err.message);
  } finally {
    loadBtn.disabled = false;
  }
}

async function resetAllResponses(token) {
  statusLine.textContent = 'Sending reset request…';
  resetBtn.disabled = true;

  try {
    const res = await fetch(
      `/admin/reset?token=${encodeURIComponent(token)}`
    );
    const data = await res.json().catch(function () { return {}; });

    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Reset failed');
    }

    alert('All submissions have been cleared successfully.');
    statusLine.textContent =
      'All submissions cleared. The summary below (if any) reflects the previous data until you reload.';
    summaryRoot.innerHTML =
      '<p class="muted">All submissions have been cleared. Once new responses are collected, click “Load summary” again.</p>';
  } catch (err) {
    console.error(err);
    statusLine.textContent = 'Reset error: ' + err.message;
    alert('Reset failed: ' + err.message);
  } finally {
    resetBtn.disabled = false;
  }
}

// ---------- render functions ----------

function renderSummary(summary) {
  summaryRoot.innerHTML = '';

  if (!summary) {
    summaryRoot.innerHTML =
      '<p class="muted">No summary data returned from the backend.</p>';
    return;
  }

  // --- Top-level card with overall info + counts ---
  var topCard = document.createElement('section');
  topCard.className = 'card';
  topCard.innerHTML =
    '<p class="card-title">Overview</p>' +
    '<p class="card-subtitle">High-level information about this survey run.</p>';

  var grid = document.createElement('div');
  grid.className = 'summary-grid';

  var totalSubmissions = summary.totalSubmissions || 0;

  grid.appendChild(summaryItem('Total responses', totalSubmissions, 'All buildings, all grades'));
  grid.appendChild(summaryItem('Number of questions', Object.keys(summary.questions || {}).length, 'Scale questions that returned data'));
  grid.appendChild(summaryItem('Free-response questions', Object.keys(summary.freeText || {}).length, 'Questions with at least one open-ended response'));

  topCard.appendChild(grid);
  summaryRoot.appendChild(topCard);

  // --- Distribution by question (scale 1–5) ---
  if (summary.questions && Object.keys(summary.questions).length > 0) {
    var scaleCard = document.createElement('section');
    scaleCard.className = 'card';
    scaleCard.innerHTML =
      '<p class="section-title">Scale questions (1–5)</p>' +
      '<p class="section-description">Each card shows the distribution of ratings for a question. These are based on the data returned by the backend summary.</p>';

    Object.keys(summary.questions)
      .sort()
      .forEach(function (qKey) {
        var q = summary.questions[qKey];
        var qElem = renderQuestionCard(qKey, q);
        scaleCard.appendChild(qElem);
      });

    summaryRoot.appendChild(scaleCard);
  }

  // --- Open-ended responses ---
  if (summary.freeText && Object.keys(summary.freeText).length > 0) {
    var freeCard = document.createElement('section');
    freeCard.className = 'card';
    freeCard.innerHTML =
      '<p class="section-title">Open-ended Responses</p>' +
      '<p class="section-description">Grouped by question and building. These are exactly as written by families, ready to print or copy into reports.</p>';

    Object.keys(summary.freeText)
      .sort()
      .forEach(function (qKey) {
        var buildingMap = summary.freeText[qKey] || {};
        Object.keys(buildingMap)
          .sort()
          .forEach(function (buildingKey) {
            var responses = buildingMap[buildingKey] || [];
            var groupElem = renderOpenEndedGroup(qKey, buildingKey, responses);
            freeCard.appendChild(groupElem);
          });
      });

    summaryRoot.appendChild(freeCard);
  }
}

function summaryItem(label, value, caption) {
  var div = document.createElement('div');
  div.innerHTML =
    '<div class="summary-item-label">' +
    label +
    '</div>' +
    '<div class="summary-item-value">' +
    value +
    '</div>' +
    '<div class="summary-item-caption">' +
    caption +
    '</div>';
  return div;
}

function renderQuestionCard(qKey, q) {
  var container = document.createElement('div');
  container.className = 'question-card';

  var avg = typeof q.average === 'number'
    ? q.average.toFixed(2)
    : '–';

  var title = document.createElement('p');
  title.className = 'question-title';
  title.textContent = prettyQuestionLabel(qKey);

  var subtitle = document.createElement('p');
  subtitle.className = 'question-subtitle';
  subtitle.textContent =
    'Average: ' + avg + ' (n = ' + (q.responses || 0) + ' responses)';
  container.appendChild(title);
  container.appendChild(subtitle);

  // Bars 1–5
  for (var rating = 1; rating <= 5; rating++) {
    var count = (q.counts && q.counts[rating]) || 0;
    var percent = q.responses ? (count / q.responses) * 100 : 0;

    var row = document.createElement('div');
    row.className = 'bar-row';

    var label = document.createElement('span');
    label.className = 'bar-label';
    label.textContent = rating;

    var track = document.createElement('div');
    track.className = 'bar-track';

    var fill = document.createElement('div');
    fill.className = 'bar-fill';
    fill.style.width = percent.toFixed(1) + '%';

    track.appendChild(fill);

    var countSpan = document.createElement('span');
    countSpan.className = 'bar-count';
    countSpan.textContent = count;

    row.appendChild(label);
    row.appendChild(track);
    row.appendChild(countSpan);
    container.appendChild(row);
  }

  return container;
}

function renderOpenEndedGroup(qKey, buildingKey, responses) {
  var wrapper = document.createElement('div');
  wrapper.className = 'open-ended-group';

  var questionLine = document.createElement('div');
  questionLine.className = 'open-ended-question';
  questionLine.textContent = prettyQuestionLabel(qKey);

  var meta = document.createElement('div');
  meta.className = 'open-ended-meta';

  var building = prettyBuildingLabel(buildingKey);
  meta.textContent =
    building + ' · ' + responses.length + ' response' + (responses.length === 1 ? '' : 's');

  var list = document.createElement('ul');
  list.className = 'open-ended-list';

  responses.forEach(function (txt) {
    var li = document.createElement('li');
    li.textContent = txt;
    list.appendChild(li);
  });

  wrapper.appendChild(questionLine);
  wrapper.appendChild(meta);
  wrapper.appendChild(list);

  return wrapper;
}
