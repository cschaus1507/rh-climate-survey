// admin.js – Roy-Hart Climate Survey admin dashboard

(function () {
  const tokenInput = document.getElementById('admin-token');
  const loadBtn = document.getElementById('load-summary');
  const resetBtn = document.getElementById('reset-data');
  const statusEl = document.getElementById('status');
  const summaryCard = document.getElementById('summary-card');
  const summaryMeta = document.getElementById('summary-meta');
  const summaryContent = document.getElementById('summary-content');
  const freeCard = document.getElementById('free-card');
  const freeContent = document.getElementById('free-content');

  const STORAGE_KEY = 'rh_climate_admin_token';

  // Map base question keys → full survey wording
  const QUESTION_TEXT = {
    // --- School Community ---
    community_welcomed:
      "Do you feel welcomed and included in your child's school community?",
    community_events:
      "Have you attended any school events or volunteered at your child's school?",
    community_meet_teacher:
      "Have you met with your child's teacher(s) to discuss your child's progress?",
    community_respect_diversity:
      "Do you feel that your child's school respects and values the diversity of families?",
    community_feedback_welcome:
      "Have you provided feedback to the school on how they can be more welcoming and inclusive?",
    community_free:
      "Please share any additional thoughts about the school community.",

    // --- Communicating Effectively ---
    comm_received_regular:
      "Have you received regular and clear communication from your child's school about events and activities?",
    comm_with_teacher:
      "Have you communicated with your child's teacher about any concerns or questions you have?",
    comm_conferences:
      "Have you attended any parent-teacher conferences or meetings?",
    comm_provided_contact:
      "Have you provided your contact information to the school to ensure that you receive important updates?",
    comm_feedback_improve:
      "Have you provided feedback to the school on how they can improve their communication with families?",
    communication_free:
      "Please share any additional thoughts about communication with the school.",

    // --- Supporting Student Success ---
    success_high_expectations:
      "Do you have high expectations for your child's academic success?",
    success_talked_importance:
      "Have you talked with your child about the importance of education and the opportunities it can provide?",
    success_extra_support:
      "Have you provided your child with additional resources or support to help them succeed?",
    success_comm_teacher:
      "Have you communicated with your child's teacher about any academic concerns or challenges your child may be facing?",
    success_free:
      "Please share any additional thoughts about supporting student success.",

    // --- Speaking Up for Every Child ---
    advocacy_responsive:
      "Do you feel that your child's school is responsive to your concerns or questions?",
    advocacy_for_child:
      "Have you advocated for your child's needs and interests with their school or teachers?",
    advocacy_participated:
      "Have you participated in any school or community efforts to advocate for all children?",
    advocacy_feedback_needs:
      "Have you provided feedback to the school on how they can better meet the needs of all children?",
    advocacy_encourage_child:
      "Have you encouraged your child to speak up for themselves and their peers?",
    advocacy_free:
      "Please share any additional thoughts about speaking up for every child.",

    // --- Decision Making ---
    decision_participated:
      "Have you participated in any school decision-making processes or committees?",
    decision_feedback_policies:
      "Have you provided feedback to the school on any policies or programs that affect your child or their classmates?",
    decision_collab_staff:
      "Have you worked collaboratively with your child's teacher or school staff to address any issues or concerns?",
    decision_support_leadership:
      "Have you supported your child in developing leadership skills and advocating for themselves and their peers?",
    decision_free:
      "Please share any additional thoughts about decision making and collaboration.",

    // --- School Safety ---
    safety_child_safe:
      "How safe do you feel your child is while at school?",
    safety_notify_quickly:
      "How confident are you that you would be notified quickly if there were a safety concern or emergency at school?",
    safety_physical_measures:
      "How confident are you in the school's physical safety measures (locked doors, visitor check-in, cameras, etc.)?",
    safety_supervision:
      "Do you feel the school grounds are supervised adequately during arrival, dismissal, and lunch?",
    safety_reporting:
      "Do you believe your child feels comfortable reporting bullying or unsafe behavior?",
    safety_knows_who:
      "Does your child know who to go to if they are feeling unsafe or need help?",
    safety_staff_trained:
      "How confident are you that staff are trained to respond appropriately in emergency situations?",
    safety_free:
      "Please share any additional thoughts about school safety."
  };

  // Restore token from localStorage if available
  const savedToken = window.localStorage.getItem(STORAGE_KEY) || '';
  if (savedToken) tokenInput.value = savedToken;

  // ---- UI helpers ----
  function setStatus(msg, type) {
    statusEl.textContent = msg || '';
    statusEl.className = '';
    if (type) statusEl.classList.add(type);
  }

  // Strip building suffix and map to full question text where possible
  function prettyQuestionLabel(key) {
    const base = key.replace(/_(elem|ms|hs)$/, '');
    if (QUESTION_TEXT[base]) return QUESTION_TEXT[base];

    // fallback: title-case the base key
    return base
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  function parseQuestionMeta(key) {
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

    const prefix = base.split('_')[0]; // community, comm, success, advocacy, decision, safety
    const categoryMap = {
      community: 'School Community',
      comm: 'Communicating Effectively',
      communication: 'Communicating Effectively',
      success: 'Supporting Student Success',
      advocacy: 'Speaking Up for Every Child',
      decision: 'Decision Making',
      safety: 'School Safety'
    };

    const categoryLabel = categoryMap[prefix] || 'Other';
    return { categoryLabel, buildingLabel };
  }

  // ---------- Event handlers ----------

  loadBtn.addEventListener('click', () => {
    const token = tokenInput.value.trim();
    if (!token) {
      setStatus('Please enter a token.', 'error');
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, token);
    fetchSummary(token);
  });

  tokenInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadBtn.click();
  });

  resetBtn.addEventListener('click', () => {
    const token = tokenInput.value.trim();
    if (!token) {
      setStatus('Enter the admin token before resetting.', 'error');
      return;
    }

    const confirmed = window.confirm(
      'This will permanently delete ALL stored submissions for this survey.\n\n' +
      'Use this only at the beginning of a new survey year.\n\n' +
      'Are you sure you want to continue?'
    );
    if (!confirmed) return;

    resetAllResponses(token);
  });

  // ---------- Backend calls ----------

  async function fetchSummary(token) {
    setStatus('Loading summary…');
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

  async function resetAllResponses(token) {
    setStatus('Sending reset request…');
    resetBtn.disabled = true;

    try {
      const url = `/admin/reset?token=${encodeURIComponent(token)}`;
      const resp = await fetch(url, { method: 'GET' });
      const data = await resp.json().catch(() => ({}));

      if (!resp.ok || !data.ok) {
        throw new Error(data.error || 'Reset failed');
      }

      setStatus('All submissions cleared. Reload summary after new responses arrive.', 'success');
      summaryCard.hidden = true;
      freeCard.hidden = true;
      summaryContent.innerHTML = '';
      freeContent.innerHTML = '';
      window.alert('All submissions have been cleared successfully.');
    } catch (err) {
      console.error(err);
      setStatus('Reset error: ' + err.message, 'error');
      window.alert('Reset failed: ' + err.message);
    } finally {
      resetBtn.disabled = false;
    }
  }

  // ---------- Summary rendering ----------

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
          questions: []
        });
      }
      groups.get(groupKey).questions.push(q);
    }

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
    label.textContent = prettyQuestionLabel(q.key);
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

  // ---------- Free-text rendering ----------

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
      header.textContent = prettyQuestionLabel(row.key);
      wrapper.appendChild(header);

      const metaLine = document.createElement('div');
      metaLine.className = 'free-meta';
      metaLine.textContent =
        `${row.meta.categoryLabel} – ${row.meta.buildingLabel} · ` +
        `${row.responses.length} response${row.responses.length === 1 ? '' : 's'}`;
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

    freeCard.hidden = true === false; // ensure it’s visible
    freeCard.hidden = false;
  }
})();
