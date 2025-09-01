(() => {
  const el = (sel, root = document) => root.querySelector(sel);
  const els = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const UI = {
    totalPoolBadge: el('#totalPoolBadge'),
    config: el('#config'),
    numPreguntas: el('#numPreguntas'),
    tiempoMin: el('#tiempoMin'),
    mezclarPreguntas: el('#mezclarPreguntas'),
    mezclarOpciones: el('#mezclarOpciones'),
    btnComenzar: el('#btnComenzar'),
    btnCargar: el('#btnCargar'),

    exam: el('#exam'),
    paginacion: el('#paginacion'),
    cronometro: el('#cronometro'),
    question: el('#question'),
    btnPrev: el('#btnPrev'),
    btnNext: el('#btnNext'),
    btnFinalizar: el('#btnFinalizar'),
    btnReset: el('#btnReset'),
    navigator: el('#navigator'),

    results: el('#results'),
    summary: el('#summary'),
    review: el('#review'),
    btnRevisar: el('#btnRevisar'),
    btnNuevo: el('#btnNuevo'),
  };

  const state = {
    pool: [], // banco completo
    questions: [], // examen seleccionado
    answers: new Map(), // key: index pregunta, value: Set<number> indices seleccionados (de 0..options-1)
    current: 0,
    shuffleQuestions: true,
    shuffleOptions: true,
    revealed: new Set(), // indices de preguntas reveladas
    timer: {
      totalSec: 0,
      remainingSec: 0,
      id: null,
      finishedByTime: false,
    },
    finished: false,
    evaluated: [], // por pregunta: true/false correcto
  };

  // Utilidades
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const toLetter = (idx) => LETTERS[idx] || `(${idx})`;
  const fromLetter = (ch) => LETTERS.indexOf(String(ch).trim().toUpperCase());
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const fmtTime = (sec) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };
  const shuffleInPlace = (arr, rng = Math.random) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  // Carga del banco
  async function loadPool() {
    const res = await fetch('questions.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`No se pudo cargar questions.json: ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Formato inválido: se esperaba un array');

    // Normalizar preguntas del banco
    state.pool = data.map((q, idx) => {
      const options = Array.isArray(q.options) ? q.options.slice() : [];
      const correctLetters = Array.isArray(q.correct) ? q.correct : [];
      const correctIdx = new Set(correctLetters.map(fromLetter).filter((i) => i >= 0));
      const type = correctIdx.size > 1 ? 'multi' : 'single';
      return {
        id: q.id || `q-${idx}`,
        text: q.question || '',
        options: options.map((text, i) => ({ text, correct: correctIdx.has(i) })),
        explanation: q.explanation || '',
        meta: q.meta || {},
        page: q.page ?? null,
        type,
      };
    });

    UI.totalPoolBadge.textContent = `Banco: ${state.pool.length}`;
    // Pre-fill cantidad con total del banco
    UI.numPreguntas.value = state.pool.length || 1;
  }

  function resetAll() {
    // Limpiar estado de examen, no recarga el banco
    state.questions = [];
    state.answers = new Map();
    state.current = 0;
    state.finished = false;
    state.evaluated = [];
    state.revealed = new Set();
    state.timer.finishedByTime = false;
    if (state.timer.id) {
      clearInterval(state.timer.id);
      state.timer.id = null;
    }

    // UI
    UI.config.classList.remove('hidden');
    UI.exam.classList.add('hidden');
    UI.results.classList.add('hidden');
    UI.question.innerHTML = '';
    UI.navigator.innerHTML = '';
    UI.summary.innerHTML = '';
    UI.review.innerHTML = '';
    UI.paginacion.textContent = 'Pregunta —/—';
    UI.cronometro.textContent = '00:00';
  }

  function startExam() {
    const total = state.pool.length;
    const n = clamp(parseInt(UI.numPreguntas.value || '0', 10) || total, 1, total);
    state.shuffleQuestions = !!UI.mezclarPreguntas.checked;
    state.shuffleOptions = !!UI.mezclarOpciones.checked;

    // Seleccionar y mezclar preguntas
    let selected = state.pool.slice();
    if (state.shuffleQuestions) shuffleInPlace(selected);
    selected = selected.slice(0, n).map((q) => ({
      ...q,
      options: q.options.map((o) => ({ ...o })),
    }));
    // Mezclar opciones (dentro de cada pregunta) si corresponde
    if (state.shuffleOptions) selected.forEach((q) => shuffleInPlace(q.options));

    state.questions = selected;
    state.answers = new Map();
    state.current = 0;
    state.finished = false;
    state.evaluated = Array(n).fill(false);
    state.revealed = new Set();

    // Timer
    const mins = clamp(parseInt(UI.tiempoMin.value || '0', 10) || 15, 1, 24 * 60);
    state.timer.totalSec = mins * 60;
    state.timer.remainingSec = state.timer.totalSec;
    state.timer.finishedByTime = false;
    if (state.timer.id) clearInterval(state.timer.id);
    state.timer.id = setInterval(() => {
      state.timer.remainingSec -= 1;
      if (state.timer.remainingSec <= 0) {
        state.timer.remainingSec = 0;
        updateTimer();
        clearInterval(state.timer.id);
        state.timer.id = null;
        state.timer.finishedByTime = true;
        gradeExam();
        return;
      }
      updateTimer();
    }, 1000);

    // UI
    UI.config.classList.add('hidden');
    UI.exam.classList.remove('hidden');
    UI.results.classList.add('hidden');
    updateTimer();
    renderNavigator();
    renderQuestion();
  }

  function updateTimer() {
    UI.cronometro.textContent = fmtTime(state.timer.remainingSec);
  }

  function renderNavigator() {
    const n = state.questions.length;
    UI.navigator.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const b = document.createElement('button');
      b.className = 'navbtn';
      b.textContent = String(i + 1);
      if (i === state.current) b.classList.add('navbtn--active');
      if (state.answers.has(i) && state.answers.get(i)?.size) b.classList.add('navbtn--answered');
      if (state.finished) {
        const ok = !!state.evaluated[i];
        b.classList.add(ok ? 'navbtn--correct' : 'navbtn--wrong');
      }
      b.addEventListener('click', () => {
        state.current = i;
        renderQuestion();
        renderNavigator();
      });
      UI.navigator.appendChild(b);
    }
  }

  function renderQuestion() {
    const i = state.current;
    const q = state.questions[i];
    if (!q) return;

    UI.paginacion.textContent = `Pregunta ${i + 1}/${state.questions.length}`;
    UI.btnPrev.disabled = i === 0;
    UI.btnNext.disabled = i === state.questions.length - 1;

    const selected = state.answers.get(i) || new Set();
    const disabled = state.finished; // al revelar no deshabilitamos por flexibilidad
    const isRevealed = state.finished || state.revealed.has(i);

    const container = document.createElement('div');
    const title = document.createElement('h2');
    title.className = 'question__title';
    title.textContent = q.text;
    container.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'question__meta';
    meta.textContent = q.type === 'multi' ? 'Selecciona todas las que correspondan' : 'Selecciona una opción';
    container.appendChild(meta);

    // Botón revelar/ocultar
    if (!state.finished) {
      const tools = document.createElement('div');
      tools.className = 'question__tools';
      const btnReveal = document.createElement('button');
      btnReveal.className = 'btn';
      btnReveal.textContent = isRevealed ? 'Ocultar explicación' : 'Revelar respuesta';
      btnReveal.addEventListener('click', () => {
        if (state.revealed.has(i)) {
          state.revealed.delete(i);
        } else {
          state.revealed.add(i);
        }
        renderQuestion();
        renderNavigator();
      });
      tools.appendChild(btnReveal);
      container.appendChild(tools);
    }

    const options = document.createElement('div');
    options.className = 'options';

    q.options.forEach((opt, idx) => {
      const line = document.createElement('label');
      line.className = 'option';
      const input = document.createElement('input');
      input.type = q.type === 'multi' ? 'checkbox' : 'radio';
      input.name = `q-${q.id}`;
      input.disabled = disabled;
      input.checked = selected.has(idx);
      input.addEventListener('change', (e) => {
        const set = new Set(state.answers.get(i) || []);
        if (q.type === 'multi') {
          if (e.target.checked) set.add(idx); else set.delete(idx);
        } else {
          set.clear();
          if (e.target.checked) set.add(idx);
        }
        state.answers.set(i, set);
        renderNavigator();
      });

      const letter = document.createElement('div');
      letter.className = 'option__letter';
      letter.textContent = toLetter(idx);

      const lab = document.createElement('div');
      lab.className = 'option__label';
      lab.textContent = opt.text;

      // Estilos de corrección
      if (isRevealed) {
        if (opt.correct) line.classList.add('option--correct');
        if (!opt.correct && selected.has(idx)) line.classList.add('option--wrong');
      }

      line.appendChild(input);
      line.appendChild(letter);
      line.appendChild(lab);
      options.appendChild(line);
    });

    container.appendChild(options);

    if (isRevealed) {
      const exp = document.createElement('div');
      exp.className = 'explanation';
      const correctLetters = q.options
        .map((o, idx) => (o.correct ? toLetter(idx) : null))
        .filter(Boolean)
        .join(', ');
      exp.innerHTML = `<strong>Respuesta correcta:</strong> ${correctLetters || '—'}<br/>` +
        (q.explanation ? q.explanation : '');
      container.appendChild(exp);
    }

    UI.question.innerHTML = '';
    UI.question.appendChild(container);
  }

  function next() {
    if (state.current < state.questions.length - 1) {
      state.current += 1;
      renderQuestion();
      renderNavigator();
    }
  }
  function prev() {
    if (state.current > 0) {
      state.current -= 1;
      renderQuestion();
      renderNavigator();
    }
  }

  function gradeExam() {
    // Detener timer si está activo
    if (state.timer.id) {
      clearInterval(state.timer.id);
      state.timer.id = null;
    }
    state.finished = true;

    const n = state.questions.length;
    let correctCount = 0;
    let answeredCount = 0;

    const perQuestion = [];
    for (let i = 0; i < n; i++) {
      const q = state.questions[i];
      const sel = state.answers.get(i) || new Set();
      const selArr = [...sel].sort((a, b) => a - b);
      if (selArr.length > 0) answeredCount += 1;
      const correct = q.options.map((o, idx) => (o.correct ? idx : null)).filter((v) => v !== null);
      const isCorrect = selArr.length === correct.length && selArr.every((v, k) => v === correct[k]);
      if (isCorrect) correctCount += 1;
      state.evaluated[i] = isCorrect;
      perQuestion.push({ i, isCorrect, selected: selArr, correct });
    }

    const wrongCount = n - correctCount;
    const remainingSec = state.timer.remainingSec;
    const usedSec = state.timer.totalSec - remainingSec;
    const pct = n ? Math.round((correctCount / n) * 100) : 0;

    // UI highlights
    renderQuestion();
    renderNavigator();

    // Resumen
    UI.results.classList.remove('hidden');
    UI.summary.innerHTML = '';

    const card = (value, label) => `
      <div class="summary__card">
        <div class="summary__value">${value}</div>
        <div class="summary__label">${label}</div>
      </div>`;
    UI.summary.innerHTML = [
      card(`${correctCount}/${n}`, 'Correctas'),
      card(`${wrongCount}/${n}`, 'Incorrectas'),
      card(`${pct}%`, 'Puntaje'),
      card(`${fmtTime(usedSec)} / ${fmtTime(state.timer.totalSec)}`, state.timer.finishedByTime ? 'Tiempo agotado' : 'Tiempo empleado'),
    ].join('');

    // Revisión detallada
    const review = document.createElement('div');
    state.questions.forEach((q, idx) => {
      const item = document.createElement('div');
      item.className = 'review-item';
      const h = document.createElement('h3');
      h.textContent = `(${idx + 1}) ${q.text}`;
      item.appendChild(h);
      const tags = document.createElement('div');
      tags.className = 'tags';
      const tag = document.createElement('span');
      tag.className = 'tag ' + (state.evaluated[idx] ? 'tag--ok' : 'tag--ko');
      tag.textContent = state.evaluated[idx] ? 'Correcta' : 'Incorrecta';
      const sel = state.answers.get(idx) || new Set();
      const selLetters = [...sel].sort((a, b) => a - b).map(toLetter).join(', ') || '—';
      const corrLetters = q.options.map((o, i) => (o.correct ? toLetter(i) : null)).filter(Boolean).join(', ');
      const tag2 = document.createElement('span');
      tag2.className = 'tag';
      tag2.textContent = `Marcadas: ${selLetters}`;
      const tag3 = document.createElement('span');
      tag3.className = 'tag';
      tag3.textContent = `Correctas: ${corrLetters}`;
      tags.appendChild(tag);
      tags.appendChild(tag2);
      tags.appendChild(tag3);
      item.appendChild(tags);
      const exp = document.createElement('div');
      exp.className = 'explanation';
      exp.innerHTML = q.explanation || '';
      item.appendChild(exp);
      review.appendChild(item);
    });
    UI.review.innerHTML = '';
    UI.review.appendChild(review);
  }

  // Eventos
  UI.btnComenzar.addEventListener('click', () => startExam());
  UI.btnCargar.addEventListener('click', async () => {
    try {
      await loadPool();
    } catch (e) {
      alert(e.message);
    }
  });
  UI.btnPrev.addEventListener('click', prev);
  UI.btnNext.addEventListener('click', next);
  UI.btnFinalizar.addEventListener('click', () => gradeExam());
  UI.btnReset.addEventListener('click', () => resetAll());
  UI.btnNuevo?.addEventListener('click', () => resetAll());
  UI.btnRevisar?.addEventListener('click', () => {
    // Enfocar en la sección del examen para navegar
    UI.exam.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // Inicialización
  loadPool().catch((e) => {
    console.error(e);
    UI.totalPoolBadge.textContent = 'Banco: error';
  });
})();
