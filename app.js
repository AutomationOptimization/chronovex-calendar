import {
  addDays,
  dateFromISO,
  dateToISO,
  eventsOverlap,
  findNextOpenSlot,
  formatTime,
  formatWeekRange,
  getMonthMatrix,
  minutesFromTime,
  startOfWeek,
  timeFromMinutes,
} from "./calendar-core.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const STORAGE_KEY = "chronovex-state-v1";
const now = new Date();
const todayISO = dateToISO(now);

const ICONS = {
  "align-left": '<path d="M4 6h16M4 12h12M4 18h16"/>',
  "arrow-right": '<path d="m9 18 6-6-6-6"/><path d="M3 12h12"/>',
  "arrow-up": '<path d="m6 12 6-6 6 6M12 6v12"/>',
  battery: '<rect x="3" y="6" width="17" height="12" rx="2"/><path d="M23 10v4M7 10v4M11 10v4M15 10v4"/>',
  bolt: '<path d="m13 2-9 12h8l-1 8 9-12h-8z"/>',
  calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 9h18"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  "chevron-left": '<path d="m15 18-6-6 6-6"/>',
  "chevron-right": '<path d="m9 18 6-6-6-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  layers: '<path d="m12 2 9 5-9 5-9-5zM3 12l9 5 9-5M3 17l9 5 9-5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  "map-pin": '<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0z"/><circle cx="12" cy="10" r="2"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  "move-horizontal": '<path d="m8 7-5 5 5 5M16 7l5 5-5 5M3 12h18"/>',
  orbit: '<circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="10" ry="5" transform="rotate(-28 12 12)"/>',
  "panel-right": '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  plane: '<path d="m22 2-7 20-4-9-9-4zM22 2 11 13"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h7M15 18h5"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="13" cy="18" r="2"/>',
  sparkles: '<path d="m12 3 1.4 4.1L17.5 9l-4.1 1.4L12 14.5l-1.4-4.1L6.5 9l4.1-1.9zM19 15l.7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.8M16 3.2a4 4 0 0 1 0 7.6"/>',
  wand: '<path d="m15 4 5 5L8 21l-5-5zM6 14l5 5M18 2v3M22 6h-3M5 2v3M2 5h3"/>',
  wave: '<path d="M3 12c2.2-6 4.4-6 6.6 0s4.4 6 6.6 0 3.4-4 4.8-3"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
};

function icon(name, className = "") {
  const body = ICONS[name] || '<circle cx="12" cy="12" r="8"/>';
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

function hydrateIcons(root = document) {
  $$('[data-icon]', root).forEach((node) => { node.innerHTML = icon(node.dataset.icon); });
}

const CALENDARS = [
  { id: "work", name: "Work", color: "#55d6ff" },
  { id: "studio", name: "Studio", color: "#a895ff" },
  { id: "focus", name: "Focus", color: "#c7f65b" },
  { id: "life", name: "Life", color: "#ff746a" },
  { id: "ritual", name: "Rituals", color: "#f8c45c" },
];
const calendarById = (id) => CALENDARS.find((calendar) => calendar.id === id) || CALENDARS[0];
const makeId = () => `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;

function seedEvents() {
  const d = (offset) => dateToISO(addDays(now, offset));
  return [
    { id: "ritual-0", title: "Morning ritual", date: d(0), start: "07:30", end: "08:15", calendar: "ritual", flexible: false, energy: "low", location: "Home", notes: "Coffee, pages, and a quiet start." },
    { id: "pulse-0", title: "Product pulse", date: d(0), start: "10:00", end: "10:45", calendar: "work", flexible: false, energy: "medium", location: "Atlas room", notes: "Weekly product signal review." },
    { id: "critique-0", title: "Design critique", date: d(0), start: "11:00", end: "12:00", calendar: "studio", flexible: false, energy: "high", location: "Studio channel", notes: "Bring the newest interaction pass." },
    { id: "deep-0", title: "Deep work · system map", date: d(0), start: "14:00", end: "15:30", calendar: "focus", flexible: true, energy: "high", location: "Focus room", notes: "No messages. Define the new orchestration model." },
    { id: "client-0", title: "Client synthesis", date: d(0), start: "14:45", end: "15:30", calendar: "work", flexible: false, energy: "medium", location: "Meet", notes: "Turn research into the decision frame." },
    { id: "lunch-0", title: "Lunch with Maya", date: d(1), start: "12:30", end: "13:30", calendar: "life", flexible: true, energy: "low", location: "Lula Cafe", notes: "" },
    { id: "flight-0", title: "Flight to New York", date: d(1), start: "16:20", end: "19:10", calendar: "life", flexible: false, energy: "low", location: "ORD → LGA", notes: "Boarding at 3:45 PM." },
    { id: "buffer-0", title: "Travel buffer", date: d(1), start: "14:50", end: "15:50", calendar: "ritual", flexible: true, energy: "low", location: "", notes: "Auto-added by travel context." },
    { id: "gym-0", title: "Strength session", date: d(2), start: "08:00", end: "09:00", calendar: "life", flexible: true, energy: "medium", location: "East Bank Club", notes: "" },
    { id: "planning-0", title: "Next-week architecture", date: d(4), start: "09:30", end: "11:00", calendar: "focus", flexible: true, energy: "high", location: "", notes: "Close the week with a clean plan." },
    { id: "review-prev", title: "Research review", date: d(-1), start: "13:00", end: "14:00", calendar: "studio", flexible: false, energy: "medium", location: "Library", notes: "" },
  ];
}

const defaults = {
  selectedDate: todayISO,
  cursorDate: todayISO,
  miniCursor: todayISO,
  view: "week",
  hiddenCalendars: [],
  lenses: { energy: true, focus: false, travel: false },
  settings: { accent: "lime", density: "balanced", use24: false, weekends: true, quiet: true, workStart: 8, workEnd: 18 },
  events: seedEvents(),
};

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || !Array.isArray(saved.events)) return structuredClone(defaults);
    return { ...structuredClone(defaults), ...saved, settings: { ...defaults.settings, ...saved.settings }, lenses: { ...defaults.lenses, ...saved.lenses } };
  } catch { return structuredClone(defaults); }
}

let state = loadState();
let editingId = null;
let previousEvents = null;
let focusTimer = null;

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* private mode */ }
}
function visibleEvents() { return state.events.filter((event) => !state.hiddenCalendars.includes(event.calendar)); }
function eventsOn(date) { return visibleEvents().filter((event) => event.date === date).sort((a,b) => minutesFromTime(a.start) - minutesFromTime(b.start)); }
function eventDuration(event) { return Math.max(15, minutesFromTime(event.end) - minutesFromTime(event.start)); }
function formatClock(value) { return formatTime(value, state.settings.use24 ? "24h" : "12h"); }
function escapeHTML(value = "") { return String(value).replace(/[&<>'"]/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[char])); }
function longDate(iso, options = {}) { return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", ...options }).format(dateFromISO(iso)); }
function isToday(iso) { return iso === todayISO; }

function applySettings() {
  document.documentElement.dataset.accent = state.settings.accent;
  document.documentElement.dataset.density = state.settings.density;
  $$('#accent-options button').forEach((button) => button.classList.toggle('is-active', button.dataset.accent === state.settings.accent));
  $$('#density-control button').forEach((button) => button.classList.toggle('is-active', button.dataset.density === state.settings.density));
  $('#setting-24h').checked = state.settings.use24;
  $('#setting-weekends').checked = state.settings.weekends;
  $('#setting-quiet').checked = state.settings.quiet;
  $('#work-start').value = String(state.settings.workStart);
  $('#work-end').value = String(state.settings.workEnd);
}

function renderMiniCalendar() {
  const focus = dateFromISO(state.miniCursor);
  const matrix = getMonthMatrix(focus, { today: todayISO }).flat();
  const title = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(focus);
  $('#mini-calendar').innerHTML = `
    <div class="mini-head"><strong>${title}</strong><div>
      <button data-action="mini-previous" aria-label="Previous month">${icon('chevron-left')}</button>
      <button data-action="mini-next" aria-label="Next month">${icon('chevron-right')}</button>
    </div></div>
    <div class="mini-weekdays">${['M','T','W','T','F','S','S'].map((day) => `<span>${day}</span>`).join('')}</div>
    <div class="mini-days">${matrix.map((cell) => {
      const hasEvents = state.events.some((event) => event.date === cell.iso);
      return `<button class="mini-day ${cell.inCurrentMonth ? '' : 'is-outside'} ${cell.isToday ? 'is-today' : ''} ${cell.iso === state.selectedDate ? 'is-selected' : ''} ${hasEvents ? 'has-events' : ''}" data-action="select-date" data-date="${cell.iso}">${cell.date.getDate()}</button>`;
    }).join('')}</div>`;
}

function renderCalendarList() {
  $('#calendar-list').innerHTML = CALENDARS.map((calendar) => {
    const count = state.events.filter((event) => event.calendar === calendar.id).length;
    const off = state.hiddenCalendars.includes(calendar.id);
    return `<button class="calendar-toggle ${off ? 'is-off' : ''}" data-action="toggle-calendar" data-calendar="${calendar.id}">
      <span class="calendar-dot" style="--dot-color:${calendar.color}"></span><span>${calendar.name}</span><span class="calendar-count">${count}</span>
    </button>`;
  }).join('');
}

function renderTimezoneStrip() {
  const base = new Date();
  const time = (zone) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: zone }).format(base);
  $('#timezone-strip').innerHTML = `<span class="tz-row-label">Worldline</span>
    <span class="tz-time is-home"><span>Chicago</span><strong>${time('America/Chicago')}</strong></span>
    <span class="tz-time"><span>New York</span><strong>${time('America/New_York')}</strong></span>
    <span class="tz-time"><span>London</span><strong>${time('Europe/London')}</strong></span>
    <button data-action="timezone">${icon('plus')} Add zone</button>`;
  $('#sidebar-time').textContent = `${time('America/Chicago')} · CDT`;
}

function currentDays() {
  if (state.view === 'day') return [dateFromISO(state.selectedDate)];
  const first = startOfWeek(dateFromISO(state.cursorDate));
  const count = state.settings.weekends ? 7 : 5;
  return Array.from({ length: count }, (_, index) => addDays(first, index));
}

function overlapsOnDay(event) {
  return eventsOn(event.date).some((other) => other.id !== event.id && eventsOverlap(event, other));
}

function eventCard(event, { proposed = false, original = false } = {}) {
  const calendar = calendarById(event.calendar);
  const start = minutesFromTime(event.start);
  const duration = eventDuration(event);
  const startHour = 6 * 60;
  const top = Math.max(0, (start - startHour) / 60);
  const height = Math.max(.38, duration / 60);
  const conflict = overlapsOnDay(event);
  return `<button class="calendar-event ${event.flexible ? 'is-flexible' : ''} ${conflict ? 'is-conflict' : ''} ${proposed ? 'is-proposed' : ''} ${original ? 'is-original' : ''}"
    style="--event-color:${calendar.color};top:calc(var(--hour-h) * ${top});height:calc(var(--hour-h) * ${height} - 3px)" data-action="edit-event" data-event-id="${event.id}" draggable="${!original}">
    <span class="event-title">${escapeHTML(event.title)}</span>
    <span class="event-meta">${formatClock(event.start)} · ${duration}m${event.location ? ` · ${escapeHTML(event.location)}` : ''}</span>
    <span class="event-badges">${event.flexible ? icon('move-horizontal') : icon('lock')}</span>
    <span class="event-resize" aria-hidden="true"></span>
  </button>`;
}

function renderWeek() {
  const days = currentDays();
  const startHour = 6;
  const endHour = 22;
  const dayCount = days.length;
  const headers = days.map((date) => {
    const iso = dateToISO(date);
    const name = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date);
    const weather = ['18°','21°','24°','22°','19°','23°','25°'][date.getDay()];
    return `<button class="day-heading ${isToday(iso) ? 'is-today' : ''} ${iso === state.selectedDate ? 'is-selected' : ''}" data-action="select-day" data-date="${iso}">
      <span class="day-name">${name}</span><span class="day-number">${date.getDate()}</span><span class="day-weather">${weather}</span>
    </button>`;
  }).join('');
  const allDay = days.map((date) => `<div class="all-day-cell">${eventsOn(dateToISO(date)).filter((event) => event.allDay).map((event) => `<div class="all-day-pill">${escapeHTML(event.title)}</div>`).join('')}</div>`).join('');
  const labels = Array.from({ length: endHour - startHour + 1 }, (_, index) => `<span class="time-label" style="top:calc(var(--hour-h) * ${index})">${formatClock(timeFromMinutes((startHour + index) * 60))}</span>`).join('');
  const columns = days.map((date) => {
    const iso = dateToISO(date);
    const slots = Array.from({ length: (endHour - startHour) * 2 }, (_, index) => {
      const minute = startHour * 60 + index * 30;
      return `<button class="time-slot" style="top:calc(var(--hour-h) * ${index / 2})" data-action="create-slot" data-date="${iso}" data-time="${timeFromMinutes(minute)}" aria-label="Create event ${longDate(iso)} at ${formatClock(minute)}"></button>`;
    }).join('');
    const quiet = state.settings.quiet ? `<div class="quiet-block" style="top:0;height:calc(var(--hour-h) * ${Math.max(0,state.settings.workStart-startHour)})"></div><div class="quiet-block" style="top:calc(var(--hour-h) * ${state.settings.workEnd-startHour});bottom:0"></div>` : '';
    const proposedIds = new Set(state.reflow?.proposals?.map((proposal) => proposal.id) || []);
    let cards = eventsOn(iso).filter((event) => !event.allDay && !proposedIds.has(event.id)).map((event) => eventCard(event)).join('');
    if (state.reflow?.proposals) {
      state.reflow.proposals.filter((proposal) => proposal.date === iso).forEach((proposal) => {
        const source = state.events.find((event) => event.id === proposal.id);
        if (source) cards += eventCard(source, { original: true }) + eventCard({ ...source, start: proposal.start, end: proposal.end }, { proposed: true });
      });
    }
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const currentLine = isToday(iso) && currentMinutes >= startHour*60 && currentMinutes <= endHour*60 ? `<div class="current-time-line" style="top:calc(var(--hour-h) * ${(currentMinutes-startHour*60)/60})"></div>` : '';
    return `<div class="day-column ${isToday(iso) ? 'is-today' : ''} ${(date.getDay() === 0 || date.getDay() === 6) ? 'is-weekend' : ''} ${state.lenses.energy ? 'energy-on' : ''}" data-date="${iso}">${quiet}${slots}${cards}${currentLine}</div>`;
  }).join('');
  const viewClass = state.view === 'day' ? 'day-view' : 'week-view';
  $('#calendar-stage').innerHTML = `<div class="${viewClass}" style="--day-count:${dayCount};--visible-hours:${endHour-startHour}">
    <div class="week-header"><div class="week-corner">${icon('clock')}</div>${headers}</div>
    <div class="all-day-row"><div class="all-day-label">All day</div>${allDay}</div>
    <div class="week-scroll"><div class="week-grid"><div class="time-gutter">${labels}</div>${columns}</div></div>
  </div>`;
  requestAnimationFrame(() => {
    const scroll = $('.week-scroll');
    if (scroll && !scroll.dataset.positioned) { scroll.scrollTop = Math.max(0, (state.settings.workStart - startHour - .4) * parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hour-h'))); scroll.dataset.positioned = 'true'; }
  });
}

function renderMonth() {
  const focus = dateFromISO(state.cursorDate);
  let cells = getMonthMatrix(focus, { today: todayISO }).flat();
  if (!state.settings.weekends) cells = cells.filter((cell) => ![0,6].includes(cell.date.getDay()));
  const count = state.settings.weekends ? 7 : 5;
  const weekdayNames = state.settings.weekends ? ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'] : ['Monday','Tuesday','Wednesday','Thursday','Friday'];
  $('#calendar-stage').innerHTML = `<div class="month-view" style="--day-count:${count}"><div class="month-weekdays">${weekdayNames.map((name) => `<span>${name}</span>`).join('')}</div><div class="month-grid">
    ${cells.map((cell) => {
      const dayEvents = eventsOn(cell.iso);
      return `<button class="month-cell ${cell.inCurrentMonth ? '' : 'is-outside'} ${cell.isToday ? 'is-today' : ''}" data-action="select-month-day" data-date="${cell.iso}">
        <span class="month-number">${cell.date.getDate()}</span><span class="month-events">${dayEvents.slice(0,3).map((event) => `<span class="month-event" style="--event-color:${calendarById(event.calendar).color}"><span>${escapeHTML(event.title)}</span></span>`).join('')}${dayEvents.length > 3 ? `<span class="month-more">+${dayEvents.length-3} more</span>` : ''}</span>
      </button>`;
    }).join('')}</div></div>`;
}

function renderAgenda() {
  const start = dateFromISO(state.cursorDate);
  const groups = Array.from({ length: 21 }, (_, index) => dateToISO(addDays(start,index))).map((date) => ({ date, events: eventsOn(date) })).filter((group) => group.events.length);
  $('#calendar-stage').innerHTML = `<div class="agenda-view"><div class="agenda-header"><div><h2>Your temporal thread</h2><p>The next three weeks, distilled into what matters.</p></div><div class="agenda-summary"><span>${groups.reduce((sum,g) => sum+g.events.length,0)} moments</span><span>${groups.reduce((sum,g) => sum+g.events.filter(e=>e.flexible).length,0)} flexible</span></div></div>
    ${groups.length ? groups.map((group) => `<section class="agenda-group"><div class="agenda-date"><strong>${longDate(group.date,{weekday:'long'})}</strong><span>${group.date === todayISO ? 'Today' : new Intl.DateTimeFormat('en-US',{month:'long',day:'numeric'}).format(dateFromISO(group.date))}</span></div><div class="agenda-events">${group.events.map((event) => `<button class="agenda-item" data-action="edit-event" data-event-id="${event.id}"><span class="agenda-time">${formatClock(event.start)}</span><span class="agenda-color" style="--event-color:${calendarById(event.calendar).color}"></span><span class="agenda-copy"><strong>${escapeHTML(event.title)}</strong><small>${escapeHTML(event.location || calendarById(event.calendar).name)} · ${eventDuration(event)} min</small></span><span class="agenda-flex">${event.flexible ? `${icon('move-horizontal')} flexible` : ''}</span></button>`).join('')}</div></section>`).join('') : `<div class="empty-state"><div>${icon('calendar')}<h3>Clear horizons</h3><p>No moments are scheduled in this range. Use the command dock to shape one.</p></div></div>`}</div>`;
}

function renderHeader() {
  const focus = dateFromISO(state.cursorDate);
  let title;
  if (state.view === 'month') title = new Intl.DateTimeFormat('en-US',{month:'long',year:'numeric'}).format(focus);
  else if (state.view === 'day') title = new Intl.DateTimeFormat('en-US',{weekday:'long',month:'short',day:'numeric'}).format(dateFromISO(state.selectedDate));
  else if (state.view === 'agenda') title = 'Coming up';
  else title = formatWeekRange(focus);
  $('#range-title').textContent = title;
  $('#date-eyebrow').textContent = state.reflow ? 'REFLOW PREVIEW' : state.view === 'month' ? 'PANORAMIC LENS' : 'YOUR TIME CANVAS';
  $$('[data-view]').forEach((button) => button.classList.toggle('is-active', button.dataset.view === state.view));
}

function getConflicts(date = state.selectedDate) {
  const events = eventsOn(date);
  const ids = new Set();
  events.forEach((event, index) => events.slice(index+1).forEach((other) => {
    if (eventsOverlap(event,other)) { ids.add(event.id); ids.add(other.id); }
  }));
  return ids;
}

function renderFlow() {
  const selected = state.selectedDate;
  const dayEvents = eventsOn(selected);
  const conflicts = getConflicts(selected).size;
  const busy = dayEvents.reduce((sum,event) => sum + eventDuration(event),0);
  const openHours = Math.max(0, (state.settings.workEnd-state.settings.workStart) - busy/60);
  $('#flow-day-title').textContent = selected === todayISO ? 'Today' : longDate(selected,{weekday:'long'});
  $('#flow-metrics').innerHTML = `<div class="flow-metric"><strong>${openHours.toFixed(1)}</strong><span>Open hours</span></div><div class="flow-metric ${conflicts ? 'has-conflict' : ''}"><strong>${conflicts}</strong><span>Friction</span></div><div class="flow-metric"><strong>${dayEvents.filter((event)=>event.flexible).length}</strong><span>Elastic</span></div>`;
  const flexible = dayEvents.find((event) => event.flexible);
  const suggestion = $('#suggestion-card');
  suggestion.hidden = !flexible;
  if (flexible) {
    $('#suggestion-title').textContent = conflicts ? 'Your day has a pressure point.' : 'Your deep work can feel lighter.';
    $('#suggestion-copy').textContent = conflicts ? 'Reflow can move flexible moments out of conflict without touching fixed commitments.' : 'Shift flexible work toward your predicted energy peak.';
    const slot = findEnergySlot(flexible);
    $('#suggestion-move').innerHTML = `<span class="move-time old">${formatClock(flexible.start)}</span>${icon('arrow-right')}<span class="move-time new">${slot ? formatClock(slot.start) : 'Protected'}</span>`;
  }
  const upcoming = visibleEvents().filter((event) => event.date > todayISO || (event.date === todayISO && minutesFromTime(event.end) > now.getHours()*60+now.getMinutes())).sort((a,b) => a.date.localeCompare(b.date) || minutesFromTime(a.start)-minutesFromTime(b.start)).slice(0,4);
  $('#up-next-list').innerHTML = upcoming.length ? upcoming.map((event) => `<button class="up-next-item" data-action="edit-event" data-event-id="${event.id}" style="--event-color:${calendarById(event.calendar).color}"><span class="up-next-bar"></span><span><strong>${escapeHTML(event.title)}</strong><small>${event.date === todayISO ? 'Today' : longDate(event.date)} · ${escapeHTML(event.location || calendarById(event.calendar).name)}</small></span><span class="up-next-time">${formatClock(event.start)}</span></button>`).join('') : `<div class="empty-state"><p>Your horizon is clear.</p></div>`;
}

function render() {
  applySettings();
  renderHeader();
  renderMiniCalendar();
  renderCalendarList();
  if (state.view === 'month') renderMonth();
  else if (state.view === 'agenda') renderAgenda();
  else renderWeek();
  renderFlow();
  renderTimezoneStrip();
  $('#reflow-bar').hidden = !state.reflow;
  if (state.reflow) $('#reflow-count').textContent = `${state.reflow.proposals.length} proposed move${state.reflow.proposals.length === 1 ? '' : 's'}`;
  $$('.lens-row').forEach((row) => {
    const on = state.lenses[row.dataset.lens];
    row.classList.toggle('is-on',on); $('.toggle',row)?.classList.toggle('is-on',on);
  });
}

function toast(title, copy = '', action = null) {
  const node = document.createElement('div');
  node.className = 'toast';
  node.innerHTML = `<span class="toast-icon">${icon('sparkles')}</span><span><strong>${escapeHTML(title)}</strong>${copy ? `<small>${escapeHTML(copy)}</small>` : ''}</span>${action ? `<button data-toast-action="${action.id}">${escapeHTML(action.label)}</button>` : ''}`;
  if (action) node.querySelector('button').addEventListener('click', () => { action.run(); node.remove(); });
  $('#toast-region').append(node);
  setTimeout(() => { node.classList.add('is-leaving'); setTimeout(() => node.remove(),220); }, 4300);
}

function shiftMonth(iso, amount) {
  const date = dateFromISO(iso);
  date.setDate(1); date.setMonth(date.getMonth()+amount);
  return dateToISO(date);
}

function navigate(amount) {
  const focus = dateFromISO(state.cursorDate);
  if (state.view === 'month') focus.setMonth(focus.getMonth()+amount);
  else focus.setDate(focus.getDate()+amount*(state.view === 'week' ? 7 : state.view === 'agenda' ? 21 : 1));
  state.cursorDate = dateToISO(focus);
  if (state.view === 'day') state.selectedDate = state.cursorDate;
  state.miniCursor = state.cursorDate;
  state.reflow = null; saveState(); render();
}

function setView(view) {
  state.view = view;
  if (view === 'day') state.cursorDate = state.selectedDate;
  state.reflow = null; saveState(); render();
}

function populateEventCalendars() {
  $('#event-calendar').innerHTML = CALENDARS.map((calendar) => `<option value="${calendar.id}">${calendar.name}</option>`).join('');
  const hours = Array.from({length:24},(_,hour) => `<option value="${hour}">${formatTime(hour*60,state.settings.use24?'24h':'12h')}</option>`).join('');
  $('#work-start').innerHTML = hours; $('#work-end').innerHTML = hours;
}

function openEventDialog(event = null, prefill = {}) {
  editingId = event?.id || null;
  const start = event?.start || prefill.start || '09:00';
  const end = event?.end || timeFromMinutes(Math.min(minutesFromTime(start)+60,1439));
  $('#dialog-kicker').textContent = event ? 'EDIT MOMENT' : 'NEW MOMENT';
  $('#dialog-title').textContent = event ? 'Tune this moment' : 'Shape your time';
  $('#event-title').value = event?.title || prefill.title || '';
  $('#event-date').value = event?.date || prefill.date || state.selectedDate;
  $('#event-start').value = start; $('#event-end').value = end;
  $('#event-calendar').value = event?.calendar || prefill.calendar || 'work';
  $('#event-location').value = event?.location || '';
  $('#event-energy').value = event?.energy || prefill.energy || 'medium';
  $('#event-notes').value = event?.notes || '';
  $('#event-form').dataset.flex = (event?.flexible || prefill.flexible) ? 'flexible' : 'fixed';
  $$('.constraint-option').forEach((button) => button.classList.toggle('is-active', button.dataset.flex === $('#event-form').dataset.flex));
  $('#delete-event').hidden = !event;
  updateEventColor();
  $('#event-dialog').showModal();
  setTimeout(() => $('#event-title').focus(),60);
}

function updateEventColor() { $('#event-color-dot').style.background = calendarById($('#event-calendar').value).color; }

function saveEvent(form) {
  const data = new FormData(form);
  let start = data.get('start'); let end = data.get('end');
  if (minutesFromTime(end) <= minutesFromTime(start)) end = timeFromMinutes(Math.min(minutesFromTime(start)+30,1439));
  const event = { id: editingId || makeId(), title: String(data.get('title')).trim(), date: data.get('date'), start, end, calendar: data.get('calendar'), location: String(data.get('location')||'').trim(), energy: data.get('energy'), notes: String(data.get('notes')||'').trim(), flexible: form.dataset.flex === 'flexible' };
  if (!event.title) return;
  const index = state.events.findIndex((item) => item.id === editingId);
  if (index >= 0) state.events[index] = event; else state.events.push(event);
  state.selectedDate = event.date; state.cursorDate = event.date; state.reflow = null;
  saveState(); $('#event-dialog').close(); render();
  toast(index >= 0 ? 'Moment updated' : 'Moment created', `${longDate(event.date)} · ${formatClock(event.start)}`);
}

function deleteEvent() {
  const event = state.events.find((item) => item.id === editingId); if (!event) return;
  previousEvents = structuredClone(state.events);
  state.events = state.events.filter((item) => item.id !== editingId);
  saveState(); $('#event-dialog').close(); render();
  toast('Moment released', event.title, { id:'undo-delete', label:'Undo', run:()=>{ state.events=previousEvents; saveState(); render(); } });
}

function findEnergySlot(event) {
  const duration = eventDuration(event);
  const others = state.events.filter((item) => item.id !== event.id);
  const candidates = [];
  for (let minute = state.settings.workStart*60; minute + duration <= state.settings.workEnd*60; minute += 15) {
    const candidate = { date:event.date, start:timeFromMinutes(minute), end:timeFromMinutes(minute+duration) };
    if (!others.some((other) => eventsOverlap(candidate,other))) candidates.push(candidate);
  }
  return candidates.sort((a,b) => Math.abs(minutesFromTime(a.start)-570)-Math.abs(minutesFromTime(b.start)-570))[0] || null;
}

function previewReflow() {
  const flexible = eventsOn(state.selectedDate).filter((event) => event.flexible);
  const proposals = flexible.map((event) => ({ event, slot: findEnergySlot(event) })).filter(({event,slot}) => slot && (slot.start !== event.start || getConflicts(event.date).has(event.id))).slice(0,3).map(({event,slot}) => ({ id:event.id, date:event.date, start:slot.start, end:slot.end }));
  if (!proposals.length) { toast('Your day is already fluid','No safe move would improve this rhythm.'); return; }
  state.reflow = { proposals }; render();
}

function applyReflow() {
  if (!state.reflow) return;
  previousEvents = structuredClone(state.events);
  state.reflow.proposals.forEach((proposal) => {
    const event = state.events.find((item) => item.id === proposal.id);
    if (event) { event.start = proposal.start; event.end = proposal.end; }
  });
  const count = state.reflow.proposals.length; state.reflow = null; saveState(); render();
  toast('Day reflowed',`${count} flexible moment${count===1?'':'s'} moved toward your energy peak.`,{ id:'undo-reflow',label:'Undo',run:()=>{ state.events=previousEvents; saveState(); render(); } });
}

function weekdayAhead(name) {
  const target = ['sun','mon','tue','wed','thu','fri','sat'].findIndex((day) => name.toLowerCase().startsWith(day));
  if (target < 0) return null;
  const date = new Date(now); let delta = (target-date.getDay()+7)%7; if (delta===0) delta=7;
  return dateToISO(addDays(date,delta));
}

function parseCommand(raw) {
  const text = raw.trim(); const lower = text.toLowerCase();
  if (!text) return null;
  if (/^(go to |show )?today$/.test(lower)) return { action:'today' };
  if (lower.includes('reflow')) return { action:'reflow' };
  let date = state.selectedDate;
  if (lower.includes('tomorrow')) date = dateToISO(addDays(now,1));
  else if (lower.includes('today')) date = todayISO;
  else if (lower.includes('next week')) date = dateToISO(addDays(startOfWeek(now),7));
  else {
    const day = lower.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
    if (day) date = weekdayAhead(day[1]);
  }
  let duration = 60;
  const durationMatch = lower.match(/(?:for\s+)?(\d+)\s*(minutes?|mins?|hours?|hrs?)/);
  if (durationMatch) duration = Number(durationMatch[1]) * (/hour|hr/.test(durationMatch[2]) ? 60 : 1);
  const timeMatch = lower.match(/(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  let start;
  if (timeMatch) start = timeFromMinutes(minutesFromTime(`${timeMatch[1]}:${timeMatch[2]||'00'} ${timeMatch[3]}`));
  else {
    const slot = findNextOpenSlot(state.events,date,duration,state.settings.workStart*60,state.settings.workEnd*60);
    start = slot?.startTime || '09:00';
  }
  const known = [
    ['deep work','Deep work','focus',true,'high'],['gym','Gym','life',true,'medium'],['lunch','Lunch','life',true,'low'],['meeting','Meeting','work',false,'medium'],['team sync','Team sync','work',false,'medium'],['design','Design session','studio',true,'high'],['focus','Focus block','focus',true,'high'],
  ].find(([phrase]) => lower.includes(phrase));
  let title = known?.[1];
  if (!title) {
    title = text.replace(/\b(today|tomorrow|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,'').replace(/\b(at|for|find|schedule|create|add|book|me|a|an)\b/gi,'').replace(/\d+\s*(am|pm|minutes?|mins?|hours?|hrs?)/gi,'').replace(/\s+/g,' ').trim();
    title = title ? title[0].toUpperCase()+title.slice(1) : 'New moment';
  }
  return { action:'create', event:{ title,date,start,end:timeFromMinutes(Math.min(minutesFromTime(start)+duration,1439)),calendar:known?.[2]||'work',flexible:known?.[3]??true,energy:known?.[4]||'medium',location:'',notes:`Created from: “${text}”` } };
}

function runCommand() {
  const input = $('#command-input'); const parsed = parseCommand(input.value);
  if (!parsed) { input.focus(); return; }
  if (parsed.action === 'today') { goToday(); input.value=''; return; }
  if (parsed.action === 'reflow') { previewReflow(); input.value=''; return; }
  if (parsed.action === 'create') {
    const event = { id:makeId(),...parsed.event }; state.events.push(event); state.selectedDate=event.date; state.cursorDate=event.date; saveState(); input.value=''; render();
    toast('Chronovex shaped your time',`${event.title} · ${longDate(event.date)} at ${formatClock(event.start)}`,{id:'edit-created',label:'Tune',run:()=>openEventDialog(event)});
  }
}

function openSearch(query='') {
  $('#search-dialog').showModal(); $('#global-search').value=query; renderSearch(query); setTimeout(()=>$('#global-search').focus(),40);
}

function renderSearch(query='') {
  const term = query.trim().toLowerCase();
  const matches = visibleEvents().filter((event) => !term || `${event.title} ${event.location} ${calendarById(event.calendar).name}`.toLowerCase().includes(term)).sort((a,b)=>a.date.localeCompare(b.date)||minutesFromTime(a.start)-minutesFromTime(b.start)).slice(0,8);
  const commands = [
    { label:'Create a new moment', action:'create-event', icon:'plus' },{ label:'Return to today', action:'today', icon:'calendar' },{ label:'Preview intelligent Reflow', action:'preview-reflow', icon:'wand' },{ label:'Tune your canvas', action:'open-settings', icon:'sliders' },
  ].filter((item)=>!term||item.label.toLowerCase().includes(term));
  $('#search-results').innerHTML = `<div class="search-section-label">Moments</div>${matches.map((event)=>`<button class="search-result" data-action="search-open-event" data-event-id="${event.id}"><span class="search-result-icon" style="--event-color:${calendarById(event.calendar).color}">${icon('calendar')}</span><span><strong>${escapeHTML(event.title)}</strong><small>${longDate(event.date)} · ${escapeHTML(event.location||calendarById(event.calendar).name)}</small></span><time>${formatClock(event.start)}</time></button>`).join('') || `<div class="empty-state"><p>No moments found.</p></div>`}<div class="search-section-label">Actions</div>${commands.map((item)=>`<button class="search-result" data-action="search-command" data-command="${item.action}"><span class="search-result-icon">${icon(item.icon)}</span><span><strong>${item.label}</strong><small>Chronovex command</small></span><kbd>↵</kbd></button>`).join('')}`;
}

function openSettings() { $('#settings-drawer').classList.add('is-open'); $('#settings-drawer').setAttribute('aria-hidden','false'); $('#drawer-scrim').classList.add('is-open'); }
function closeDrawers() { $('#settings-drawer').classList.remove('is-open'); $('#settings-drawer').setAttribute('aria-hidden','true'); $('#drawer-scrim').classList.remove('is-open'); $('#sidebar').classList.remove('is-open'); $('#flow-panel').classList.remove('is-open'); }
function goToday() { state.selectedDate=todayISO; state.cursorDate=todayISO; state.miniCursor=todayISO; state.reflow=null; saveState(); render(); }

async function shareAvailability() {
  const days = currentDays();
  const lines = days.map((date)=>{ const iso=dateToISO(date); const slot=findNextOpenSlot(state.events,iso,60,state.settings.workStart*60,state.settings.workEnd*60); return slot ? `${longDate(iso)}: ${formatClock(slot.startTime)}–${formatClock(slot.endTime)}` : `${longDate(iso)}: fully held`; });
  const text=`My Chronovex availability\n${lines.join('\n')}`;
  try { await navigator.clipboard.writeText(text); toast('Availability copied','A human-readable week summary is ready to share.'); } catch { toast('Availability ready',lines[0]); }
}

function startFocus() {
  const event = eventsOn(state.selectedDate).find((item)=>item.calendar==='focus') || visibleEvents().find((item)=>item.calendar==='focus');
  if (!event) { toast('No focus moment found','Create a Focus event first.'); return; }
  const overlay=document.createElement('div'); overlay.className='focus-overlay'; overlay.innerHTML=`<div class="focus-card"><button class="brand-mark" aria-label="Chronovex"><span class="brand-orbit"></span><span class="brand-core"></span></button><span class="dialog-kicker">FOCUS SHIELD ACTIVE</span><h2>${escapeHTML(event.title)}</h2><p>${longDate(event.date)} · protected from interruption</p><div class="focus-timer">${String(Math.max(1,eventDuration(event))).padStart(2,'0')}:00</div><div class="focus-actions"><button class="ghost-button" data-action="exit-focus">Exit shield</button><button class="apply-button" data-action="complete-focus">${icon('check')} Complete</button></div></div>`; document.body.append(overlay);
  let seconds=Math.max(60,eventDuration(event)*60); const display=$('.focus-timer',overlay); focusTimer=setInterval(()=>{ seconds--; display.textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`; if(seconds<=0) stopFocus(true); },1000);
}
function stopFocus(done=false) { clearInterval(focusTimer); $('.focus-overlay')?.remove(); if(done) toast('Focus complete','A protected moment, fully lived.'); }

function handleAction(action, element) {
  switch (action) {
    case 'previous': navigate(-1); break;
    case 'next': navigate(1); break;
    case 'today': goToday(); break;
    case 'create-event': openEventDialog(); break;
    case 'create-slot': openEventDialog(null,{date:element.dataset.date,start:element.dataset.time}); break;
    case 'edit-event': {
      if (element.classList.contains('is-original')) break;
      const event=state.events.find((item)=>item.id===element.dataset.eventId); if(event) openEventDialog(event); break;
    }
    case 'select-day': state.selectedDate=element.dataset.date; state.cursorDate=element.dataset.date; saveState(); render(); break;
    case 'select-date': state.selectedDate=element.dataset.date; state.cursorDate=element.dataset.date; state.miniCursor=element.dataset.date; saveState(); render(); break;
    case 'select-month-day': state.selectedDate=element.dataset.date; state.cursorDate=element.dataset.date; setView('day'); break;
    case 'mini-previous': state.miniCursor=shiftMonth(state.miniCursor,-1); renderMiniCalendar(); break;
    case 'mini-next': state.miniCursor=shiftMonth(state.miniCursor,1); renderMiniCalendar(); break;
    case 'toggle-calendar': {
      const id=element.dataset.calendar; state.hiddenCalendars=state.hiddenCalendars.includes(id)?state.hiddenCalendars.filter((item)=>item!==id):[...state.hiddenCalendars,id]; saveState(); render(); break;
    }
    case 'open-search': openSearch(); break;
    case 'close-dialog': $('#event-dialog').close(); break;
    case 'delete-event': deleteEvent(); break;
    case 'preview-reflow': previewReflow(); break;
    case 'cancel-reflow': state.reflow=null; render(); break;
    case 'apply-reflow': applyReflow(); break;
    case 'dismiss-suggestion': $('#suggestion-card').hidden=true; toast('Suggestion quieted','Chronovex will keep observing your rhythm.'); break;
    case 'open-agenda': setView('agenda'); break;
    case 'run-command': runCommand(); break;
    case 'open-settings': openSettings(); break;
    case 'close-settings': case 'close-drawers': closeDrawers(); break;
    case 'toggle-sidebar': $('#sidebar').classList.toggle('is-open'); break;
    case 'collapse-flow': {
      if (matchMedia('(max-width:820px)').matches) $('#flow-panel').classList.remove('is-open');
      else { const hidden=$('#flow-panel').hidden; $('#flow-panel').hidden=!hidden; document.documentElement.style.setProperty('--flow-w',hidden?'306px':'0px'); }
      break;
    }
    case 'share-availability': shareAvailability(); break;
    case 'focus-mode': startFocus(); break;
    case 'exit-focus': stopFocus(false); break;
    case 'complete-focus': stopFocus(true); break;
    case 'timezone': toast('Worldline is active','Chicago, New York, and London are aligned above your canvas.'); break;
    case 'open-orbit': toast('Rhythm lens enabled','Energy contours are now visible behind your week.'); state.lenses.energy=true; saveState(); render(); break;
    case 'open-automations': toast('Orchestra is standing by','Try “Find 90 minutes for deep work Friday” in the command dock.'); $('#command-input').focus(); break;
    case 'profile': toast('Local-first calendar','Your calendar stays private in this browser.'); break;
    case 'new-calendar': toast('Calendar palette','Use Create to choose from Work, Studio, Focus, Life, or Rituals.'); break;
    case 'reset-demo': state=structuredClone(defaults); saveState(); closeDrawers(); populateEventCalendars(); render(); toast('Demo calendar restored','Your original Chronovex canvas is back.'); break;
    case 'search-open-event': {
      $('#search-dialog').close(); const event=state.events.find((item)=>item.id===element.dataset.eventId); if(event) openEventDialog(event); break;
    }
    case 'search-command': $('#search-dialog').close(); handleAction(element.dataset.command,element); break;
    case 'view-week': setView('week'); break;
  }
}

document.addEventListener('click',(event)=>{
  const viewButton=event.target.closest('[data-view]'); if(viewButton){ setView(viewButton.dataset.view); return; }
  const accent=event.target.closest('[data-accent]'); if(accent){ state.settings.accent=accent.dataset.accent; saveState(); applySettings(); render(); return; }
  const density=event.target.closest('[data-density]'); if(density){ state.settings.density=density.dataset.density; saveState(); applySettings(); render(); return; }
  const lens=event.target.closest('[data-lens]'); if(lens){ const id=lens.dataset.lens; state.lenses[id]=!state.lenses[id]; saveState(); render(); return; }
  const action=event.target.closest('[data-action]'); if(action) handleAction(action.dataset.action,action);
});

$('#event-form').addEventListener('submit',(event)=>{ event.preventDefault(); saveEvent(event.currentTarget); });
$('#event-calendar').addEventListener('change',updateEventColor);
$$('.constraint-option').forEach((button)=>button.addEventListener('click',()=>{ $('#event-form').dataset.flex=button.dataset.flex; $$('.constraint-option').forEach((item)=>item.classList.toggle('is-active',item===button)); }));
$('#event-start').addEventListener('change',()=>{ if(minutesFromTime($('#event-end').value)<=minutesFromTime($('#event-start').value)) $('#event-end').value=timeFromMinutes(Math.min(minutesFromTime($('#event-start').value)+60,1439)); });
$('#command-input').addEventListener('keydown',(event)=>{ if(event.key==='Enter'){event.preventDefault();runCommand();} });
$('#global-search').addEventListener('input',(event)=>renderSearch(event.target.value));
$('#global-search').addEventListener('keydown',(event)=>{ if(event.key==='Enter'){ const first=$('.search-result',$('#search-results')); if(first) first.click(); } });
$('#setting-24h').addEventListener('change',(event)=>{ state.settings.use24=event.target.checked; saveState(); populateEventCalendars(); render(); });
$('#setting-weekends').addEventListener('change',(event)=>{ state.settings.weekends=event.target.checked; saveState(); render(); });
$('#setting-quiet').addEventListener('change',(event)=>{ state.settings.quiet=event.target.checked; saveState(); render(); });
$('#work-start').addEventListener('change',(event)=>{ state.settings.workStart=Number(event.target.value); if(state.settings.workEnd<=state.settings.workStart) state.settings.workEnd=Math.min(23,state.settings.workStart+8); saveState(); render(); });
$('#work-end').addEventListener('change',(event)=>{ state.settings.workEnd=Number(event.target.value); if(state.settings.workEnd<=state.settings.workStart) state.settings.workStart=Math.max(0,state.settings.workEnd-8); saveState(); render(); });

let draggedId=null;
document.addEventListener('dragstart',(event)=>{ const card=event.target.closest('.calendar-event'); if(!card)return; draggedId=card.dataset.eventId; event.dataTransfer.effectAllowed='move'; event.dataTransfer.setData('text/plain',draggedId); });
document.addEventListener('dragover',(event)=>{ if(event.target.closest('.time-slot')) event.preventDefault(); });
document.addEventListener('drop',(event)=>{
  const slot=event.target.closest('.time-slot'); if(!slot||!draggedId)return; event.preventDefault();
  const item=state.events.find((entry)=>entry.id===draggedId); if(!item)return;
  const duration=eventDuration(item); previousEvents=structuredClone(state.events); item.date=slot.dataset.date; item.start=slot.dataset.time; item.end=timeFromMinutes(Math.min(minutesFromTime(item.start)+duration,1439)); state.selectedDate=item.date; saveState(); render(); toast('Moment moved',`${longDate(item.date)} · ${formatClock(item.start)}`,{id:'undo-drag',label:'Undo',run:()=>{state.events=previousEvents;saveState();render();}}); draggedId=null;
});

document.addEventListener('keydown',(event)=>{
  const typing=['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);
  if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();openSearch();return;}
  if(event.key==='Escape'){ closeDrawers(); if($('#search-dialog').open) $('#search-dialog').close(); if($('.focus-overlay')) stopFocus(false); }
  if(!typing && event.key.toLowerCase()==='c'){ event.preventDefault(); openEventDialog(); }
  if(!typing && event.key.toLowerCase()==='t'){ event.preventDefault(); goToday(); }
  if(!typing && event.key.toLowerCase()==='r'){ event.preventDefault(); previewReflow(); }
});

function init() {
  hydrateIcons(); populateEventCalendars(); applySettings(); render();
  setInterval(renderTimezoneStrip,30000);
  setTimeout(()=>toast('Chronovex is alive','Try dragging a moment or asking for deep work in the command dock.'),650);
  if('serviceWorker' in navigator && location.protocol.startsWith('http')) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
}

init();
