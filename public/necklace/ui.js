// DOM side of the necklace page: labels, tooltip, detail panel, sensor list, Front/Back toggle, Esc/F keys.
// State is { state: 'overview'|'hover'|'focused', hoverId, focusedId, side: 'front'|'back' }.
// The UI emits select(id), back, hover(id|null), flip(side). main.js decides what those do in 3D.

const ICONS = {
  touch: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/>',
  buzzer: '<path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a9 9 0 0 1 0 12"/>',
  baro: '<circle cx="12" cy="12" r="9"/><path d="m12 12 4-4"/><path d="M7 16.5h10"/>',
  brain: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
};
const svg = (id, size = 20) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[id] || ''}</svg>`;

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) n.append(c);
  return n;
}

export function createUI({ root = document.body, data }) {
  const { IDS, COMPONENTS } = data;
  const $ = (sel) => root.querySelector(sel);
  const labelsEl = $('#labels'), tooltip = $('#tooltip'), panel = $('#panel'), list = $('#list');
  const flipBtn = $('#flip'), hint = $('#hint'), fallback = $('#fallback'), errEl = $('#err');

  const listeners = {};
  const emit = (evt, ...args) => (listeners[evt] || []).forEach((cb) => cb(...args));
  const on = (evt, cb) => { (listeners[evt] ||= []).push(cb); };

  const model = { state: 'overview', hoverId: null, focusedId: null, side: 'front' };
  const pos = {}; // last label positions
  let origin = null; // button that started the current focus, so Esc can give focus back
  let fell = false;

  // ---- Build DOM ----
  const labels = {}, listBtns = {};
  for (const id of IDS) {
    const c = COMPONENTS[id];
    const lab = el('button', { class: 'hs-label', type: 'button', 'data-id': id, 'aria-label': `${c.name}, ${c.tag}`, hidden: '' }, [
      el('span', { class: 'hs-dot', 'aria-hidden': 'true' }),
      el('span', { class: 'hs-name', text: c.short }),
    ]);
    labels[id] = lab; labelsEl.append(lab);

    const btn = el('button', { class: 'btn list-btn', type: 'button', 'data-id': id, 'aria-pressed': 'false', 'aria-label': c.name }, [
      el('span', { class: 'list-ic', html: svg(id) }),
      el('span', { class: 'list-txt' }, [el('span', { class: 'list-name', text: c.short }), el('span', { class: 'mono list-tag', text: c.tag })]),
    ]);
    listBtns[id] = btn; list.append(btn);

    const li = el('li', {}, [
      el('h2', { class: 'display', text: `${c.name} (${c.tag})` }),
      el('p', { class: 'fb-tip', text: c.tip }),
      ...c.body.map((t) => el('p', { text: t })),
    ]);
    fallback.append(li);
  }

  // ---- Panel ----
  panel.inert = true;
  panel.setAttribute('aria-hidden', 'true');
  function renderPanel(id) {
    panel.replaceChildren();
    if (!id) return;
    const c = COMPONENTS[id];
    const head = el('div', { class: 'panel-head' }, [
      el('span', { class: 'panel-ic', html: svg(id, 22) }),
      el('div', { class: 'panel-titles' }, [
        el('p', { class: 'eyebrow', text: `Sensor ${IDS.indexOf(id) + 1} of ${IDS.length} · ${c.tag}` }),
        el('h2', { class: 'display', id: 'panelTitle', text: c.name }),
      ]),
    ]);
    const closeBtn = el('button', { class: 'icon-btn panel-close', type: 'button', 'aria-label': 'Close and return to the overview' }, [
      el('span', { html: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>' }),
    ]);
    closeBtn.addEventListener('click', () => emit('back'));
    head.append(closeBtn);
    const body = el('div', { class: 'panel-body' }, c.body.map((t) => el('p', { text: t })));
    const facts = el('dl', { class: 'facts' });
    for (const f of c.facts) facts.append(el('div', {}, [el('dt', { class: 'eyebrow', text: f.k }), el('dd', { class: 'mono', text: f.v })]));
    const back = el('button', { class: 'btn panel-back', type: 'button', text: 'Back to overview' });
    back.addEventListener('click', () => emit('back'));
    panel.append(head, body, facts, back);
  }

  // ---- Rendering ----
  function render(prev) {
    const f = model.focusedId, h = model.hoverId;
    model.state = f ? 'focused' : h ? 'hover' : 'overview';
    root.dataset.state = model.state;
    root.dataset.side = model.side;
    for (const id of IDS) {
      listBtns[id].setAttribute('aria-pressed', String(f === id));
      listBtns[id].classList.toggle('is-hover', h === id && !f);
      labels[id].classList.toggle('is-hover', h === id);
      labels[id].classList.toggle('is-active', f === id);
    }
    if (prev.focusedId !== f) {
      if (f) { renderPanel(f); panel.inert = false; panel.setAttribute('aria-hidden', 'false'); panel.classList.add('is-open'); }
      else { panel.classList.remove('is-open'); panel.inert = true; panel.setAttribute('aria-hidden', 'true'); setTimeout(() => { if (!model.focusedId) renderPanel(null); }, 400); }
    }
    const back = model.side === 'back';
    flipBtn.setAttribute('aria-pressed', String(back));
    flipBtn.setAttribute('aria-label', back ? 'Showing the back. Flip to the front (F)' : 'Showing the front. Flip to the back (F)');
    flipBtn.querySelectorAll('.seg').forEach((s) => s.classList.toggle('is-on', s.dataset.side === model.side));
    hint.hidden = fell || back || !!f;
    renderTooltip();
  }

  function renderTooltip() {
    const id = model.hoverId;
    if (!id || model.focusedId) { tooltip.hidden = true; return; }
    const c = COMPONENTS[id];
    if (tooltip.dataset.id !== id) {
      tooltip.dataset.id = id;
      tooltip.replaceChildren(el('strong', { text: c.name }), el('span', { text: c.tip }));
    }
    tooltip.hidden = false;
    placeTooltip();
  }

  function placeTooltip() {
    const id = model.hoverId;
    if (!id || tooltip.hidden) return;
    let p = pos[id];
    let x, y;
    if (p && p.visible && model.side === 'back') { x = p.x; y = p.y; }
    else { const r = listBtns[id].getBoundingClientRect(); x = r.left + r.width / 2; y = r.top - 8; p = { below: false }; }
    const gap = 22, m = 12;
    const w = tooltip.offsetWidth, h = tooltip.offsetHeight;
    const vw = root.clientWidth || innerWidth, vh = innerHeight;
    let left = x - w / 2;
    left = Math.max(m, Math.min(vw - w - m, left));
    let top = y - h - gap;       // above the marker by default
    let below = false;
    if (top < 64) { top = y + gap; below = true; } // flip under it near the top edge
    if (top + h > vh - m) top = Math.max(64, vh - h - m);
    tooltip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    tooltip.style.setProperty('--arrow-x', `${Math.round(Math.max(14, Math.min(w - 14, x - left)))}px`);
    tooltip.classList.toggle('is-below', below);
  }

  // ---- Interaction ----
  const coarse = matchMedia('(pointer: coarse)');
  function tap(id, pointerType) {
    const touch = pointerType === 'touch' || (pointerType !== 'mouse' && pointerType !== 'pen' && pointerType !== '' && coarse.matches);
    if (touch && model.hoverId !== id && model.focusedId !== id) { setState({ hoverId: id }); emit('hover', id); return; }
    select(id, document.activeElement);
  }
  function select(id, trigger) {
    origin = trigger && trigger.matches?.('button') ? trigger : listBtns[id];
    const viaKeyboard = !!origin && (origin === document.activeElement);
    emit('select', id);
    if (viaKeyboard) requestAnimationFrame(() => panel.querySelector('.panel-close')?.focus({ preventScroll: true }));
  }

  for (const id of IDS) {
    const lab = labels[id], btn = listBtns[id];
    lab.addEventListener('click', (e) => tap(id, e.pointerType));
    lab.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') emit('hover', id); });
    lab.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') emit('hover', null); });
    lab.addEventListener('focus', () => emit('hover', id));
    lab.addEventListener('blur', () => emit('hover', null));
    btn.addEventListener('click', () => select(id, btn));
    btn.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') emit('hover', id); });
    btn.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') emit('hover', null); });
    btn.addEventListener('focus', () => emit('hover', id));
    btn.addEventListener('blur', () => emit('hover', null));
  }
  flipBtn.addEventListener('click', () => emit('flip', model.side === 'front' ? 'back' : 'front'));
  addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape' && model.focusedId) {
      e.preventDefault();
      const o = origin; emit('back');
      requestAnimationFrame(() => (o || listBtns[IDS[0]]).focus({ preventScroll: true }));
    } else if ((e.key === 'f' || e.key === 'F') && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) {
      e.preventDefault(); emit('flip', model.side === 'front' ? 'back' : 'front');
    }
  });
  addEventListener('resize', placeTooltip);

  // ---- Public API ----
  function setState(s = {}) {
    const prev = { ...model };
    Object.assign(model, s);
    render(prev);
  }
  function setLabelPos(id, p) {
    const lab = labels[id]; if (!lab) return;
    pos[id] = p;
    const show = !!p && p.visible && model.side === 'back' && !fell;
    if (lab.hidden === show) lab.hidden = !show;
    if (show) lab.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
    if (id === model.hoverId) placeTooltip();
  }
  function setSide(side) { setState({ side }); }
  function showError(msg) {
    fell = true;
    errEl.textContent = msg || 'The 3D view is not available here.';
    errEl.hidden = false;
    fallback.hidden = false;
    list.hidden = true; flipBtn.hidden = true; hint.hidden = true; tooltip.hidden = true; labelsEl.hidden = true;
    root.classList.add('is-fallback');
    $('#loading')?.setAttribute('hidden', '');
  }

  setState({});
  return { setState, on, setLabelPos, setSide, showError, tap, labelEl: (id) => labels[id], getState: () => ({ ...model }) };
}
