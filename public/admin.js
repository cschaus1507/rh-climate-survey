window.addEventListener('DOMContentLoaded', function () {
  const statusEl = document.getElementById('status');
  const debugEl = document.getElementById('debug');
  const loadBtn = document.getElementById('loadBtn');
  const adminInput = document.getElementById('adminToken');
  const summaryCard = document.getElementById('summaryCard');
  const surveyIdEl = document.getElementById('surveyId');
  const totalSubmissionsEl = document.getElementById('totalSubmissions');
  const questionsBody = document.getElementById('questionsBody');

  function setStatus(msg, isError) {
    statusEl.textContent = msg || '';
    statusEl.className = 'status' + (isError ? ' error' : ' success');
  }

  function setDebug(msg) {
    debugEl.textContent = msg || '';
  }

  async function loadSummary() {
    const token = adminInput.value.trim();
    if (!token) {
      setStatus('Please enter your admin token.', true);
      return;
    }

    setStatus('Loading...', false);
    setDebug('Button clicked. Fetching /admin/summary…');
    loadBtn.disabled = true;
    summaryCard.style.display = 'none';

    try {
      const url = `/admin/summary?token=${encodeURIComponent(token)}`;
      setDebug('Fetching: ' + url);

      const res = await fetch(url);
      const text = await res.text();

      console.log('Raw /admin/summary response:', text);
      setDebug('HTTP ' + res.status + '\n' + text);

      if (!res.ok) {
        setStatus('HTTP error ' + res.status, true);
        loadBtn.disabled = false;
        return;
      }

      let json;
      try {
        json = JSON.parse(text);
      } catch (e) {
        console.error('JSON parse error:', e);
        setStatus('Could not parse JSON from server. Check console.', true);
        loadBtn.disabled = false;
        return;
      }

      if (!json.ok) {
        setStatus('Server reported error: ' + (json.error || 'unknown'), true);
        loadBtn.disabled = false;
        return;
      }

      renderSummary(json.summary);
      setStatus('Loaded summary successfully.', false);
    } catch (err) {
      console.error(err);
      setDebug(String(err));
      setStatus('Network error, see console.', true);
    } finally {
      loadBtn.disabled = false;
    }
  }

  function renderSummary(summary) {
    if (!summary) return;
    summaryCard.style.display = 'block';

    surveyIdEl.textContent = summary.surveyId;
    totalSubmissionsEl.textContent = summary.totalSubmissions;

    const qObj = summary.questions || {};
    const questions = Object.values(qObj).filter(q => q.type === 'scale');
    questions.sort((a, b) => a.key.localeCompare(b.key));

    questionsBody.innerHTML = '';

    if (!questions.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="4">No scale questions found.</td>';
      questionsBody.appendChild(tr);
      return;
    }

    for (const q of questions) {
      const counts = q.counts || {};
      const countsStr =
        '1:' + (counts['1'] || 0) + ', ' +
        '2:' + (counts['2'] || 0) + ', ' +
        '3:' + (counts['3'] || 0) + ', ' +
        '4:' + (counts['4'] || 0) + ', ' +
        '5:' + (counts['5'] || 0);

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><code>${q.key}</code></td>
        <td>${q.responses}</td>
        <td>${q.average != null ? q.average.toFixed(2) : ''}</td>
        <td>${countsStr}</td>
      `;
      questionsBody.appendChild(tr);
    }
  }

  console.log('Admin script initialized, wiring click handler.');
  setDebug('Ready. Enter your token and click "Load summary".');
  loadBtn.addEventListener('click', loadSummary);
});
