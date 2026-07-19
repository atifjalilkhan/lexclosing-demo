(function () {
  const messagesEl = document.getElementById('messages');
  const form = document.getElementById('composerForm');
  const input = document.getElementById('composerInput');
  const sendBtn = document.getElementById('composerSend');

  let sessionId = null;

  function addBotBubble(text) {
    const el = document.createElement('div');
    el.className = 'msg bot';
    el.textContent = text;
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  function addUserBubble(text) {
    const el = document.createElement('div');
    el.className = 'msg user';
    el.textContent = text;
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  function addTyping() {
    const el = document.createElement('div');
    el.className = 'typing';
    el.id = 'typingIndicator';
    el.textContent = 'Typing…';
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  function removeTyping() {
    const el = document.getElementById('typingIndicator');
    if (el) el.remove();
  }

  function scrollToBottom() {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }

  function renderQuickReplies(options) {
    if (!options || options.length === 0) return;
    const wrap = document.createElement('div');
    wrap.className = 'quick-replies';
    options.forEach((opt) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = opt;
      btn.addEventListener('click', () => sendMessage(opt));
      wrap.appendChild(btn);
    });
    messagesEl.appendChild(wrap);
    scrollToBottom();
  }

  function renderTracker(container, tracker) {
    const trackerEl = document.createElement('div');
    trackerEl.className = 'stage-tracker';
    tracker.stages.forEach((stage, i) => {
      const step = document.createElement('div');
      let cls = 'stage-step';
      if (i < tracker.currentIndex) cls += ' completed';
      if (i === tracker.currentIndex) cls += ' current';
      step.className = cls;
      step.innerHTML = `<div class="line"></div><div class="dot"></div><div class="label">${stage}</div>`;
      trackerEl.appendChild(step);
    });
    container.appendChild(trackerEl);
  }

  function renderStatusResults(results) {
    const wrap = document.createElement('div');
    wrap.className = 'msg bot result-card';

    results.forEach((r) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.style.marginBottom = '10px';
      card.innerHTML = `
        <div class="case-number-badge mono">${escapeHtml(r.caseNumber)}</div>
        <div style="margin-top:6px; font-weight:600;">${escapeHtml(r.clientName)}</div>
        <div style="color: var(--muted); font-size: 0.85rem;">${escapeHtml(r.transactionType)}</div>
      `;
      renderTracker(card, r.tracker);
      wrap.appendChild(card);
    });

    messagesEl.appendChild(wrap);
    scrollToBottom();
  }

  function renderIntakeComplete(caseNumber, tracker) {
    const wrap = document.createElement('div');
    wrap.className = 'msg bot result-card';
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<div class="case-number-badge mono">${escapeHtml(caseNumber)}</div>`;
    renderTracker(card, tracker);
    wrap.appendChild(card);
    messagesEl.appendChild(wrap);
    scrollToBottom();
  }

  function renderSummary(summary) {
    const wrap = document.createElement('div');
    wrap.className = 'msg bot result-card';
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div style="font-weight:600; margin-bottom:8px;">Please confirm</div>
      <div><strong>Name:</strong> ${escapeHtml(summary.firstName)} ${escapeHtml(summary.lastName)}</div>
      <div><strong>Phone:</strong> ${escapeHtml(summary.phone)}</div>
      <div><strong>Email:</strong> ${escapeHtml(summary.email)}</div>
      <div><strong>Transaction type:</strong> ${escapeHtml(summary.accidentType)}</div>
      <div><strong>Property address:</strong> ${escapeHtml(summary.accidentDate)}</div>
      <div><strong>Description:</strong> ${escapeHtml(summary.description)}</div>
    `;
    wrap.appendChild(card);
    messagesEl.appendChild(wrap);
    scrollToBottom();
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  async function sendMessage(text) {
    if (!text) return;
    addUserBubble(text);
    input.value = '';
    sendBtn.disabled = true;
    addTyping();

    try {
      const res = await fetch('/api/chat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: text }),
      });
      const data = await res.json();
      removeTyping();

      if (!res.ok) {
        addBotBubble(data.error || 'Something went wrong. Please try again.');
        return;
      }

      handleReply(data);
    } catch (err) {
      removeTyping();
      addBotBubble('Connection error — please check your internet connection and try again.');
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  }

  function handleReply(data) {
    if (data.reply) addBotBubble(data.reply);

    if (data.type === 'confirm_summary' && data.summary) {
      renderSummary(data.summary);
    } else if (data.type === 'status_result' && data.results) {
      renderStatusResults(data.results);
    } else if (data.type === 'intake_complete' && data.tracker) {
      renderIntakeComplete(data.caseNumber, data.tracker);
    }

    if (data.quickReplies) renderQuickReplies(data.quickReplies);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    sendMessage(input.value.trim());
  });

  async function start() {
    addTyping();
    try {
      const res = await fetch('/api/chat/start', { method: 'POST' });
      const data = await res.json();
      removeTyping();
      sessionId = data.sessionId;
      handleReply(data);
    } catch (err) {
      removeTyping();
      addBotBubble('Could not connect to the intake system. Please refresh the page or call our office directly.');
    }
  }

  start();
})();
