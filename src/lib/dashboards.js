import { supabase } from './supabase.js';
import { signOut } from './auth.js';
import './dashboard.css';
import './evolution.css';
import './control.css';
import './tree-tools.css';
import './roster.css';
import './field-details.css';

const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const notify = (message, bad = false) => {
  const node = document.querySelector('#notice');
  if (node) { node.textContent = message; node.className = `notice${bad ? ' error' : ''}`; }
};
const fail = (error) => notify(error.message || String(error), true);
let studentNotificationChannel = null;
let notificationRefreshTimer = null;
async function uploadOwnedImage(file, userId, folder) {
  if (!file?.size) return null;
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  if (file.size > 8 * 1024 * 1024) throw new Error('Image must be 8 MB or smaller.');
  const extension = (file.name.split('.').pop() || 'img').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const path = `${userId}/${folder}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from('xenoworld-images').upload(path, file, { contentType:file.type, upsert:false });
  if (error) throw error;
  return path;
}
const scheduleStudentRefresh = (app, profile, user) => {
  clearTimeout(notificationRefreshTimer);
  notificationRefreshTimer = setTimeout(() => renderStudentDashboard(app, profile, user), 300);
};

export async function renderTeacherDashboard(app, profile, user) {
  const { data: classrooms, error } = await supabase.from('classrooms').select('id, name, join_code').eq('teacher_id', user.id).order('created_at');
  if (error) throw error;
  if (!classrooms?.length) {
    app.innerHTML = `<main class="session-screen"><section class="session-card"><span class="brand-mark">X</span><p class="eyebrow">EDUCATOR CONTROL CENTRE</p><h1>Open your classroom.</h1><p>Create a classroom space for your students. You can add your source planet and distribute it after students join.</p><form id="create-classroom" class="stack-form"><label>Classroom name</label><input name="name" required placeholder="Biology · Period 2"><button class="primary-button">CREATE CLASSROOM <b>→</b></button></form><div id="notice" class="notice"></div><button id="sign-out" class="text-button">Sign out</button></section></main>`;
    app.querySelector('#sign-out').onclick = signOut;
    app.querySelector('#create-classroom').onsubmit = async (event) => {
      event.preventDefault(); const name = new FormData(event.currentTarget).get('name').trim();
      try { const result = await supabase.from('classrooms').insert({ name, teacher_id: user.id }).select('id').single(); if (result.error) throw result.error; await renderTeacherDashboard(app, profile, user); } catch (e) { fail(e); }
    };
    return;
  }
  const classroom = classrooms[0];
  const [{ data: sourcePlanets, error: planetError }, { data: members, error: memberError }, { data: activity, error: activityError }] = await Promise.all([
    supabase.from('planets').select('*').eq('classroom_id', classroom.id).order('created_at', { ascending: false }).limit(1),
    supabase.from('classroom_members').select('student_id, joined_at').eq('classroom_id', classroom.id).order('joined_at'),
    supabase.from('activity_logs').select('id, action, created_at, student_id').eq('classroom_id', classroom.id).order('created_at', { ascending: false }).limit(8),
  ]);
  if (planetError) throw planetError; if (memberError) throw memberError; if (activityError) throw activityError;
  const planet = sourcePlanets?.[0];
  let templates = [];
  let deployed = [];
  if (planet) {
    const [{ data: t, error: te }, { data: d, error: de }] = await Promise.all([
      supabase.from('planet_species').select('*').eq('planet_id', planet.id).order('created_at'),
      supabase.from('student_planets').select('id, student_id, name').eq('source_planet_id', planet.id),
    ]);
    if (te) throw te; if (de) throw de; templates = t || []; deployed = d || [];
  }
  const studentPlanetIds = deployed.map((d) => d.id);
  let classSpecies = [];
  if (studentPlanetIds.length) { const { data, error } = await supabase.from('species').select('id, planet_id, student_id, parent_species_id, name, generation, is_extinct, created_at').in('planet_id', studentPlanetIds).order('created_at', { ascending: false }); if (error) throw error; classSpecies = data || []; }
  const [{ data: eventHistory, error: eventError }, { data: extinctHistory, error: extinctError }, { data: announcements, error: announcementsError }] = await Promise.all([
    supabase.from('environmental_events').select('id, name, event_type, description, created_at').eq('classroom_id', classroom.id).order('created_at', { ascending: false }).limit(6),
    supabase.from('extinction_events').select('id, species_id, planet_id, reason, created_at, restored_at').eq('classroom_id', classroom.id).order('created_at', { ascending: false }).limit(8),
    supabase.from('announcements').select('id, title, published_at').eq('classroom_id', classroom.id).order('created_at', { ascending: false }).limit(5),
  ]);
  if (eventError) throw eventError; if (extinctError) throw extinctError; if (announcementsError) throw announcementsError;
  const extinctCount = classSpecies.filter((s) => s.is_extinct).length;
  const livingCount = classSpecies.length - extinctCount;
  const maxGeneration = classSpecies.reduce((max, s) => Math.max(max, s.generation || 0), 0);
  const ids = [...new Set([...(members || []).map((m) => m.student_id), ...(activity || []).map((a) => a.student_id).filter(Boolean)])];
  let profiles = [];
  if (ids.length) { const { data, error: profileError } = await supabase.from('profiles').select('id, display_name, role').in('id', ids); if (profileError) throw profileError; profiles = data || []; }
  const profileMap = Object.fromEntries(profiles.map((p) => [p.id, p.display_name || 'Student']));
  const memberCards = (members || []).map((m) => { const world = deployed.find((d) => d.student_id === m.student_id); const studentSpecies = classSpecies.filter((s) => s.student_id === m.student_id); const count = studentSpecies.length; const childMap = new Map(); studentSpecies.forEach((s) => { if (s.parent_species_id) { const children = childMap.get(s.parent_species_id) || []; children.push(s); childMap.set(s.parent_species_id, children); } }); const treeBranch = (s) => `<li><span>${escapeHtml(s.name)} <small>GEN ${s.generation}${s.is_extinct ? ' · EXTINCT' : ''}</small></span>${childMap.get(s.id)?.length ? `<ul>${childMap.get(s.id).map(treeBranch).join('')}</ul>` : ''}</li>`; const roots = studentSpecies.filter((s) => !s.parent_species_id); const tree = roots.length ? `<ul class="teacher-mini-tree">${roots.map(treeBranch).join('')}</ul>` : '<p class="muted">No species records yet.</p>'; return `<div class="member-row"><span class="avatar">${escapeHtml((profileMap[m.student_id] || 'S').slice(0,1).toUpperCase())}</span><span class="member-name"><strong>${escapeHtml(profileMap[m.student_id] || 'Student')}</strong><small>Joined ${new Date(m.joined_at).toLocaleDateString()} · ${count} species</small></span><details class="teacher-tree"><summary>VIEW TREE</summary>${tree}</details><b class="member-state">${world ? 'WORLD READY' : 'AWAITING WORLD'}</b></div>`; }).join('') || '<p class="muted">Students appear here after joining with the classroom code.</p>';
  const speciesCards = templates.map((s, i) => `<div class="template-chip"><span class="species-icon">${i === 0 ? '◈' : '✧'}</span><span><strong>${escapeHtml(s.name)}</strong><small>${escapeHtml(s.diet || 'Diet not set')} · ${escapeHtml(s.habitat || 'Habitat not set')}</small></span></div>`).join('');
  const speciesOptions = classSpecies.map((s) => `<option value="${s.id}" data-student="${s.student_id}" data-extinct="${s.is_extinct}">${escapeHtml(s.name)} · Gen ${s.generation}${s.is_extinct ? ' · EXTINCT' : ''}</option>`).join('');
  const studentOptions = (members || []).map((m) => `<option value="${m.student_id}">${escapeHtml(profileMap[m.student_id] || 'Student')}</option>`).join('');
  const historyItems = [...(eventHistory || []).map((e) => ({...e, kind:'ENVIRONMENT'})), ...(extinctHistory || []).map((e) => ({...e, name:classSpecies.find((s) => s.id === e.species_id)?.name || 'Species', event_type:e.restored_at ? 'RESTORED' : 'EXTINCTION', kind:'SPECIES'})), ...(announcements || []).map((a) => ({...a, name:a.title, event_type:'ANNOUNCEMENT', kind:'LESSON'})), ...(activity || []).map((a) => ({...a, name:`${profileMap[a.student_id] || 'Researcher'} · ${a.action.replaceAll('_',' ')}`, event_type:'ACTIVITY'}))].sort((a,b) => new Date(b.created_at || b.published_at) - new Date(a.created_at || a.published_at)).slice(0,10).map((e) => `<div class="history-row"><span class="history-type">${escapeHtml(e.event_type)}</span><span><strong>${escapeHtml(e.name)}</strong><small>${new Date(e.created_at || e.published_at).toLocaleString()}</small></span></div>`).join('') || '<p class="muted">Classroom events and announcements will appear here.</p>';
  app.innerHTML = `<main class="control-shell">
    <aside class="control-sidebar"><a class="brand" href="/teacher/index.html"><span class="brand-mark">X</span><span>XENOWORLD<small>EDUCATOR CONTROL</small></span></a><div class="side-label">COMMAND</div><a class="side-link active" href="#overview">◉ &nbsp; Overview</a><a class="side-link" href="#planet-builder">◎ &nbsp; Source planet</a><a class="side-link" href="#students">◌ &nbsp; Students</a><a class="side-link" href="#god-mode">⚡ &nbsp; God Mode</a><a class="side-link" href="#classroom-comms">✦ &nbsp; Classroom</a><div class="sidebar-bottom"><span class="online-dot"></span> NETWORK ONLINE<button id="sign-out" class="side-signout">Sign out ↗</button></div></aside>
    <section class="control-main"><header class="control-header"><div><p class="eyebrow">CLASSROOM COMMAND // ${escapeHtml(classroom.name.toUpperCase())}</p><h1>Planetary control.</h1></div><div class="teacher-user"><span class="avatar">${escapeHtml((profile.display_name || 'T').slice(0,1).toUpperCase())}</span><span>${escapeHtml(profile.display_name || user.email)}<small>TEACHER</small></span></div></header>
      <div id="notice" class="notice"></div><section class="metrics-grid"><article class="metric-card"><small>CLASSROOM MEMBERS</small><strong>${members?.length || 0}</strong><span>Researcher accounts</span></article><article class="metric-card"><small>WORLDS DEPLOYED</small><strong>${deployed.length}</strong><span>Independent planet copies</span></article><article class="metric-card"><small>LIVING / EXTINCT SPECIES</small><strong>${livingCount} / ${extinctCount}</strong><span>Across student biospheres</span></article><article class="metric-card"><small>MAX GENERATION</small><strong>${maxGeneration}</strong><span>Class evolutionary record</span></article></section>
      <div class="control-grid"><section class="panel planet-panel" id="planet-builder"><div class="panel-heading"><div><p class="eyebrow">STAGE 02 // WORLD DESIGN</p><h2>${planet ? 'Source planet' : 'Create your source planet'}</h2></div><span class="panel-index">01</span></div>
        ${planet ? `<div class="planet-summary"><span class="mini-planet">◉</span><div><h3>${escapeHtml(planet.name)}</h3><p>${escapeHtml(planet.description || 'No description supplied.')}</p><div class="tag-row"><span>${escapeHtml(planet.water_availability || 'Water unspecified')}</span><span>${planet.gravity == null ? 'Gravity unspecified' : `${planet.gravity} g`}</span><span>${planet.published_at ? 'PUBLISHED' : 'DRAFT'}</span></div></div></div><div class="source-species"><h3>Original species</h3>${speciesCards || '<p class="muted">No source species have been added.</p>'}</div>
          ${!planet.published_at ? `<button id="publish-planet" class="primary-button">PUBLISH AND DISTRIBUTE <b>→</b></button>` : `<button id="distribute-planet" class="primary-button" ${templates.length < 2 ? 'disabled' : ''}>DISTRIBUTE TO CLASS <b>→</b></button><p class="hint">${deployed.length} student worlds currently hold a copy.</p>`}`
          : `<form id="create-planet" class="stack-form two-col"><label>Planet name<input name="name" required placeholder="e.g. Vespera-9"></label><label>Gravity (Earth = 1)<input name="gravity" type="number" step="0.01" min="0" placeholder="0.84"></label><label class="wide">Description<textarea name="description" rows="2" placeholder="Describe the planet and its major features"></textarea></label><label>Atmosphere<input name="atmosphere" placeholder="Nitrogen, oxygen, argon"></label><label>Temperature range<input name="temperature" placeholder="-20°C to 36°C"></label><label>Water availability<input name="water" placeholder="Abundant / seasonal / scarce"></label><label>Terrain<input name="terrain" placeholder="Tidal forests, basalt plains"></label><label class="wide">Planet image<input name="image" type="file" accept="image/*"></label><button class="primary-button wide">SAVE SOURCE PLANET <b>→</b></button></form>`}
      </section>
      <section class="panel species-panel"><div class="panel-heading"><div><p class="eyebrow">BIOSPHERE // SEED LIFE</p><h2>Original species</h2></div><span class="panel-index">02</span></div>
        ${planet && !planet.published_at && templates.length < 2 ? `<form id="add-species" class="stack-form"><p class="hint">Add ${2 - templates.length} original species to unlock publication. These profiles are copied to every student world.</p>${Array.from({ length: 2 - templates.length }, (_, i) => `<div class="species-form-card"><strong>Species ${templates.length + i + 1}</strong><label>Name<input name="species_name_${i}" required placeholder="Species name"></label><label>Description<textarea name="species_desc_${i}" rows="2" placeholder="Appearance and ecological role"></textarea></label><label>Physical characteristics<input name="species_traits_${i}" placeholder="Color, size, notable traits"></label><label>Species image<input name="species_image_${i}" type="file" accept="image/*"></label><div class="species-fields"><label>Body structure<input name="species_body_${i}" placeholder="Six limbs, plated shell"></label><label>Locomotion<input name="species_move_${i}" placeholder="Gliding, burrowing"></label><label>Diet<input name="species_diet_${i}" placeholder="Herbivore, filter feeder"></label><label>Habitat<input name="species_habitat_${i}" placeholder="Coastal caves"></label><label>Reproduction<input name="species_reproduction_${i}"></label><label>Lifespan<input name="species_lifespan_${i}"></label><label>Population<input name="species_population_${i}" type="number" min="0"></label><label>Predators<input name="species_predators_${i}" placeholder="Comma-separated species"></label><label>Defensive adaptations<input name="species_defenses_${i}" placeholder="Camouflage, venom"></label><label>Environmental tolerances<input name="species_tolerances_${i}" placeholder="Cold, low oxygen"></label></div></div>`).join('')}<button class="primary-button">SAVE ORIGINAL SPECIES <b>→</b></button></form>` : `<p class="muted">${templates.length >= 2 ? 'Two original species are ready for distribution.' : 'Create and save a planet first.'}</p>`}
      </section></div>
      <section class="panel students-panel" id="students"><div class="panel-heading"><div><p class="eyebrow">LIVE CLASSROOM ROSTER</p><h2>Student worlds</h2></div><span class="panel-index">${String(members?.length || 0).padStart(2,'0')}</span></div><div class="member-list">${memberCards}</div></section>
      <section class="god-mode panel" id="god-mode"><div class="panel-heading"><div><p class="eyebrow">GOD MODE // SPECIES CONTROL</p><h2>Extinction and recovery</h2></div><span class="panel-index">03</span></div><div class="god-grid"><form id="target-extinction" class="stack-form"><h3>Target a species</h3><label>Student<select name="student" required><option value="">Choose student</option>${studentOptions}</select></label><label>Species<select name="species" required><option value="">Choose living species</option>${speciesOptions}</select></label><label>Reason<input name="reason" placeholder="Lesson scenario or cause"></label><button class="danger-button">TRIGGER EXTINCTION</button></form><div class="stack-form"><h3>Class-wide actions</h3><label>Species to restore<select id="restore-species"><option value="">Choose extinct species</option>${speciesOptions}</select></label><button id="restore-button" class="outline-button">RESTORE SPECIES</button><div class="action-divider"></div><label>Random extinction targets<select id="random-students" multiple size="4">${studentOptions}</select><small>Leave blank to select one species for every student.</small></label><button id="random-per-student" class="danger-button" ${livingCount ? '' : 'disabled'}>RANDOM EXTINCTION · ONE PER TARGET</button><button id="random-class" class="danger-button secondary-danger" ${livingCount ? '' : 'disabled'}>RANDOM EXTINCTION · ONE IN CLASS</button><p class="hint">Random actions only select living species. A permanent event record is created.</p></div></div></section>
      <div class="control-grid extras-grid"><section class="panel" id="classroom-comms"><div class="panel-heading"><div><p class="eyebrow">CLIMATE CONTROL // ENVIRONMENT</p><h2>Environmental event</h2></div><span class="panel-index">04</span></div><form id="environment-form" class="stack-form"><label>Event type<select name="type"><option value="temperature">Temperature shift</option><option value="water">Water shortage</option><option value="atmosphere">Atmospheric change</option><option value="volcanic">Volcanic eruption</option><option value="meteor">Meteor impact</option><option value="habitat">Habitat destruction</option><option value="custom">Custom event</option></select></label><label>Event name<input name="name" required placeholder="e.g. The Long Drought"></label><label>Description<textarea name="description" rows="2" required placeholder="Describe the change to the environment"></textarea></label><label>Magnitude or details<input name="magnitude" placeholder="e.g. −12°C, 30% less surface water"></label><label>Target students <select name="students" multiple size="4">${studentOptions}</select><small>Leave blank to affect the whole class. Select one or more for a targeted event.</small></label><button class="primary-button">APPLY ENVIRONMENTAL EVENT <b>→</b></button></form></section>
      <section class="panel"><div class="panel-heading"><div><p class="eyebrow">LESSON BROADCAST // CLASSROOM</p><h2>Announcement</h2></div><span class="panel-index">05</span></div><form id="announcement-form" class="stack-form"><label>Lesson title<input name="title" required placeholder="Lesson: Adaptation and survival"></label><label>Lesson number<input name="lesson" placeholder="Lesson 04"></label><label>Description<textarea name="description" rows="2"></textarea></label><label>Instructions<textarea name="instructions" rows="3" required placeholder="What should students do next?"></textarea></label><label>Lesson image<input name="image" type="file" accept="image/*"></label><label>Target students <select name="students" multiple size="4">${studentOptions}</select><small>Leave blank to send the announcement to the whole class.</small></label><button class="primary-button">PUBLISH ANNOUNCEMENT <b>→</b></button></form><div class="action-divider"></div><form id="assignment-form" class="stack-form"><h3>Species assignment</h3><label>Assignment title<input name="title" required placeholder="Survival challenge"></label><label>Species<select name="species"><option value="">Choose a species for each student</option>${templates.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('')}</select></label><label>Assignment mode<select name="mode"><option value="student_choice">Students choose</option><option value="specific">Assign selected species</option><option value="random">Random species per student</option></select></label><label>Instructions<textarea name="description" rows="2"></textarea></label><button class="outline-button">CREATE ASSIGNMENT</button></form></section></div>
      <section class="panel history-panel"><div class="panel-heading"><div><p class="eyebrow">AUDIT TRAIL // LIVE CLASSROOM</p><h2>Recent events and lessons</h2></div><span class="panel-index">LOG</span></div><div class="history-list">${historyItems}</div></section>
    </section></main>`;

  app.querySelector('#sign-out').onclick = signOut;
  const planetForm = app.querySelector('#create-planet');
  if (planetForm) planetForm.onsubmit = async (event) => {
    event.preventDefault(); const f = new FormData(planetForm);
    try {
      const imagePath = await uploadOwnedImage(f.get('image'), user.id, 'planets');
      const { error: insertError } = await supabase.from('planets').insert({ classroom_id: classroom.id, created_by: user.id, name: f.get('name').trim(), description: f.get('description'), image_path:imagePath, gravity: f.get('gravity') || null, atmosphere: { composition: f.get('atmosphere') }, temperature: { range: f.get('temperature') }, water_availability: f.get('water'), terrain: [f.get('terrain')].filter(Boolean) });
      if (insertError) throw insertError; await renderTeacherDashboard(app, profile, user);
    } catch (e) { fail(e); }
  };
  const speciesForm = app.querySelector('#add-species');
  if (speciesForm) speciesForm.onsubmit = async (event) => {
    event.preventDefault(); const f = new FormData(speciesForm); const rows = [];
    for (let i = 0; i < 2 - templates.length; i++) rows.push({ planet_id: planet.id, name: f.get(`species_name_${i}`).trim(), image_path:await uploadOwnedImage(f.get(`species_image_${i}`), user.id, 'species'), description: f.get(`species_desc_${i}`) || '', characteristics:{ physical:f.get(`species_traits_${i}`) || '' }, body_structure: f.get(`species_body_${i}`) || '', locomotion: f.get(`species_move_${i}`) || '', diet: f.get(`species_diet_${i}`) || '', habitat: f.get(`species_habitat_${i}`) || '', reproduction:f.get(`species_reproduction_${i}`) || '', lifespan:f.get(`species_lifespan_${i}`) || '', population:f.get(`species_population_${i}`) || null, predators:(f.get(`species_predators_${i}`) || '').split(',').map((x) => x.trim()).filter(Boolean), defensive_adaptations:(f.get(`species_defenses_${i}`) || '').split(',').map((x) => x.trim()).filter(Boolean), environmental_tolerances:{ notes:f.get(`species_tolerances_${i}`) || '' } });
    try { const { error: insertError } = await supabase.from('planet_species').insert(rows); if (insertError) throw insertError; await renderTeacherDashboard(app, profile, user); } catch (e) { fail(e); }
  };
  const publish = app.querySelector('#publish-planet');
  if (publish) publish.onclick = async () => {
    if (templates.length < 2) { notify('Add two original species before publishing.', true); return; }
    if (!window.confirm('Publish this source planet? Students will be able to receive copies.')) return;
    try { const { error: updateError } = await supabase.from('planets').update({ published_at: new Date().toISOString() }).eq('id', planet.id); if (updateError) throw updateError; const { error: distError } = await supabase.rpc('distribute_classroom_planet', { source_id: planet.id }); if (distError) throw distError; await renderTeacherDashboard(app, profile, user); notify('Planet published and distributed to current class members.'); } catch (e) { fail(e); }
  };
  const distribute = app.querySelector('#distribute-planet');
  if (distribute) distribute.onclick = async () => {
    if (!window.confirm('Create independent planet copies for any students who joined since the last distribution? Existing copies will not be overwritten.')) return;
    try { const { data, error: rpcError } = await supabase.rpc('distribute_classroom_planet', { source_id: planet.id }); if (rpcError) throw rpcError; await renderTeacherDashboard(app, profile, user); notify(`Created worlds for ${data} student(s).`); } catch (e) { fail(e); }
  };
  const targetForm = app.querySelector('#target-extinction');
  targetForm.onsubmit = async (event) => {
    event.preventDefault(); const f = new FormData(targetForm); const chosen = classSpecies.find((s) => s.id === f.get('species'));
    if (!chosen || chosen.student_id !== f.get('student') || chosen.is_extinct) { notify('Choose a living species from the selected student.', true); return; }
    if (!window.confirm(`Make ${chosen.name} extinct? Students will see it marked in their family tree.`)) return;
    try { const { error } = await supabase.rpc('extinguish_species', { p_species_id: chosen.id, p_reason: f.get('reason') || '' }); if (error) throw error; await renderTeacherDashboard(app, profile, user); notify(`${chosen.name} was recorded as extinct.`); } catch (e) { fail(e); }
  };
  targetForm.elements.student.onchange = () => {
    const studentId = targetForm.elements.student.value;
    [...targetForm.elements.species.options].forEach((option) => { if (option.value) option.hidden = option.dataset.student !== studentId || option.dataset.extinct === 'true'; });
    targetForm.elements.species.value = '';
  };
  const restoreSelect = app.querySelector('#restore-species');
  [...restoreSelect.options].forEach((option) => { if (option.value) option.hidden = option.dataset.extinct !== 'true'; });
  app.querySelector('#restore-button').onclick = async () => {
    const selected = classSpecies.find((s) => s.id === restoreSelect.value && s.is_extinct);
    if (!selected) { notify('Choose an extinct species to restore.', true); return; }
    if (!window.confirm(`Restore ${selected.name} to its ecosystem?`)) return;
    try { const { error } = await supabase.rpc('restore_species', { p_species_id: selected.id }); if (error) throw error; await renderTeacherDashboard(app, profile, user); notify(`${selected.name} has been restored.`); } catch (e) { fail(e); }
  };
  app.querySelector('#random-per-student').onclick = async () => {
    const selectedStudents = [...app.querySelector('#random-students').selectedOptions].map((option) => option.value);
    const targets = selectedStudents.length ? members.filter((m) => selectedStudents.includes(m.student_id)) : members || [];
    const picks = targets.map((m) => { const available = classSpecies.filter((s) => s.student_id === m.student_id && !s.is_extinct); return available.length ? available[Math.floor(Math.random() * available.length)] : null; }).filter(Boolean);
    if (!picks.length) { notify('No students have living species available.', true); return; }
    if (!window.confirm(`Randomly eliminate one living species for each of ${picks.length} eligible selected student(s)?`)) return;
    try { for (const item of picks) { const { error } = await supabase.rpc('extinguish_species', { p_species_id:item.id, p_reason:'Random class event' }); if (error) throw error; } await renderTeacherDashboard(app, profile, user); notify(`Recorded ${picks.length} random extinction event(s).`); } catch (e) { fail(e); }
  };
  app.querySelector('#random-class').onclick = async () => {
    const eligible = classSpecies.filter((s) => !s.is_extinct);
    if (!eligible.length) { notify('No living species are available.', true); return; }
    const selected = eligible[Math.floor(Math.random() * eligible.length)];
    if (!window.confirm(`Randomly select one species across the class: ${selected.name}. Continue?`)) return;
    try { const { error } = await supabase.rpc('extinguish_species', { p_species_id:selected.id, p_reason:'Random class event' }); if (error) throw error; await renderTeacherDashboard(app, profile, user); notify(`${selected.name} was randomly selected and recorded extinct.`); } catch (e) { fail(e); }
  };
  app.querySelector('#environment-form').onsubmit = async (event) => {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    const targets = f.getAll('students');
    if (!window.confirm(`Apply “${f.get('name')}” to ${targets.length ? `${targets.length} selected student(s)` : 'all current student worlds'}?`)) return;
    try { const { error } = await supabase.rpc('apply_classroom_event', { p_classroom_id:classroom.id, p_name:f.get('name'), p_description:f.get('description'), p_event_type:f.get('type'), p_payload:{ magnitude:f.get('magnitude') || '' }, p_target_student_ids:targets.length ? targets : null }); if (error) throw error; await renderTeacherDashboard(app, profile, user); notify('Environmental event applied and added to the class event history.'); } catch (e) { fail(e); }
  };
  app.querySelector('#announcement-form').onsubmit = async (event) => {
    event.preventDefault(); const f = new FormData(event.currentTarget); const publishedAt = new Date().toISOString();
    try {
      const selectedIds = f.getAll('students'); const targetMembers = selectedIds.length ? members.filter((m) => selectedIds.includes(m.student_id)) : members;
      const imagePath = await uploadOwnedImage(f.get('image'), user.id, 'announcements');
      const { data: notice, error } = await supabase.from('announcements').insert({ classroom_id:classroom.id, teacher_id:user.id, title:f.get('title'), lesson_number:f.get('lesson') || null, description:f.get('description') || '', instructions:f.get('instructions'), image_path:imagePath, target_student_ids:selectedIds.length ? selectedIds : null, published_at:publishedAt }).select('id').single();
      if (error) throw error;
      if (targetMembers.length) { const message = `${f.get('lesson') ? `${f.get('lesson')} · ` : ''}${f.get('description') ? `${f.get('description')}\n\n` : ''}${f.get('instructions')}`; const rows = targetMembers.map((m) => ({ classroom_id:classroom.id, student_id:m.student_id, announcement_id:notice.id, title:f.get('title'), body:message })); const { error: notificationError } = await supabase.from('notifications').insert(rows); if (notificationError) throw notificationError; }
      await renderTeacherDashboard(app, profile, user); notify('Announcement published and sent to the class.');
    } catch (e) { fail(e); }
  };
  app.querySelector('#assignment-form').onsubmit = async (event) => {
    event.preventDefault(); const f = new FormData(event.currentTarget); const mode = f.get('mode');
    const template = templates.find((s) => s.id === f.get('species'));
    if (mode === 'specific' && !template) { notify('Select a source species for this assignment.', true); return; }
    const recipients = (members || []).map((member) => {
      const living = classSpecies.filter((s) => s.student_id === member.student_id && !s.is_extinct && s.generation === 0);
      if (mode === 'specific') return { assignment_id:null, student_id:member.student_id, species_id:living.find((s) => s.name === template.name)?.id || null };
      if (mode === 'random') return { assignment_id:null, student_id:member.student_id, species_id:living.length ? living[Math.floor(Math.random() * living.length)].id : null };
      return { assignment_id:null, student_id:member.student_id, species_id:null };
    });
    if (mode !== 'student_choice' && recipients.some((r) => !r.species_id)) { notify('Every student needs a living copy of the selected seed species before this assignment can be made.', true); return; }
    try {
      const { data: assignment, error } = await supabase.from('assignments').insert({ classroom_id:classroom.id, teacher_id:user.id, title:f.get('title'), description:f.get('description') || '', species_id:null, mode, target_student_ids:null }).select('id').single();
      if (error) throw error;
      if (recipients.length) { const { error: recipientError } = await supabase.from('assignment_recipients').insert(recipients.map((row) => ({ ...row, assignment_id:assignment.id }))); if (recipientError) throw recipientError; }
      if (members.length) { const { error: notificationError } = await supabase.from('notifications').insert(members.map((m) => ({ classroom_id:classroom.id, student_id:m.student_id, title:`New assignment: ${f.get('title')}`, body:f.get('description') || 'Check your species assignments.' }))); if (notificationError) throw notificationError; }
      await renderTeacherDashboard(app, profile, user); notify('Assignment created with individual species selections.');
    } catch (e) { fail(e); }
  };
}

export async function renderStudentDashboard(app, profile, user) {
  const [{ data: memberships, error: memberError }, { data: worlds, error: worldError }] = await Promise.all([
    supabase.from('classroom_members').select('classroom_id, joined_at').eq('student_id', user.id),
    supabase.from('student_planets').select('id, name, description, classroom_id, image_path, atmosphere, temperature, gravity, water_availability, terrain, environmental_conditions, created_at').eq('student_id', user.id).order('created_at', { ascending: false }),
  ]);
  if (memberError) throw memberError; if (worldError) throw worldError;
  const { data: notifications, error: notificationError } = await supabase.from('notifications').select('id, title, body, read_at, created_at, announcement_id').eq('student_id', user.id).order('created_at', { ascending: false }).limit(30);
  if (notificationError) throw notificationError;
  const announcementIds = [...new Set((notifications || []).map((n) => n.announcement_id).filter(Boolean))];
  let announcementMap = {};
  if (announcementIds.length) {
    const { data, error } = await supabase.from('announcements').select('id, image_path, lesson_number, description').in('id', announcementIds);
    if (error) throw error;
    for (const item of data || []) {
      const { data: signed } = item.image_path ? await supabase.storage.from('xenoworld-images').createSignedUrl(item.image_path, 3600) : { data:null };
      announcementMap[item.id] = { ...item, image_url:signed?.signedUrl || '' };
    }
  }
  const rooms = memberships || [];
  const classroomIds = [...new Set([...rooms.map((m) => m.classroom_id), ...(worlds || []).map((w) => w.classroom_id)])];
  let classroomMap = {};
  if (classroomIds.length) { const { data, error } = await supabase.from('classrooms').select('id, name').in('id', classroomIds); if (error) throw error; classroomMap = Object.fromEntries((data || []).map((c) => [c.id, c.name])); }
  let assignments = [];
  if (classroomIds.length) { const { data, error } = await supabase.from('assignments').select('id, title, description, mode, due_at, species_id, created_at').in('classroom_id', classroomIds).order('created_at', { ascending: false }); if (error) throw error; assignments = data || []; }
  let assignmentRecipients = [];
  if (assignments.length) { const { data, error } = await supabase.from('assignment_recipients').select('assignment_id, species_id').in('assignment_id', assignments.map((a) => a.id)).eq('student_id', user.id); if (error) throw error; assignmentRecipients = data || []; }
  const planetIds = (worlds || []).map((w) => w.id);
  let species = [];
  if (planetIds.length) {
    const { data, error } = await supabase.from('species').select('*').in('planet_id', planetIds).order('generation').order('created_at');
    if (error) throw error;
    species = await Promise.all((data || []).map(async (s) => {
      if (!s.image_path) return s;
      const { data: signed, error: imageError } = await supabase.storage.from('xenoworld-images').createSignedUrl(s.image_path, 3600);
      return { ...s, image_url: imageError ? '' : signed?.signedUrl || '' };
    }));
  }
  const planetCards = await Promise.all((worlds || []).map(async (world) => {
    const count = species.filter((s) => s.planet_id === world.id).length;
    const event = world.environmental_conditions?.active_event;
    let imageUrl = '';
    if (world.image_path) { const { data } = await supabase.storage.from('xenoworld-images').createSignedUrl(world.image_path, 3600); imageUrl = data?.signedUrl || ''; }
    return `<article class="student-world-card"><div class="world-art" ${imageUrl ? `style="background-image:linear-gradient(#06131b38,#06131b88),url('${escapeHtml(imageUrl)}');background-size:cover;background-position:center"` : ''}><div class="mini-planet large">◉</div><span>WORLD COPY // ${escapeHtml(classroomMap[world.classroom_id] || 'CLASSROOM')}</span></div><div class="world-meta"><p class="eyebrow">PERSONAL PLANET</p><h2>${escapeHtml(world.name)}</h2><p>${escapeHtml(world.description || 'A new world, ready to explore.')}</p><div class="world-stats"><span>${count} species</span>${world.gravity != null ? `<span>${escapeHtml(world.gravity)} g</span>` : ''}${world.water_availability ? `<span>${escapeHtml(world.water_availability)}</span>` : ''}${event ? `<span class="event-tag">EVENT · ${escapeHtml(event)}</span>` : ''}</div><details class="planet-conditions"><summary>PLANET CONDITIONS</summary><p><b>Atmosphere</b> ${escapeHtml(world.atmosphere?.composition || 'Not recorded')}</p><p><b>Temperature</b> ${escapeHtml(world.temperature?.range || world.temperature?.event_change || 'Not recorded')}</p><p><b>Terrain</b> ${escapeHtml((world.terrain || []).join(', ') || 'Not recorded')}</p>${event ? `<p><b>Current event</b> ${escapeHtml(world.environmental_conditions?.description || event)}</p>` : ''}</details></div></article>`;
  }));
  const renderProfile = (s, compact = false) => `<details class="species-profile ${compact ? 'compact' : ''}" id="species-${s.id}"><summary><span class="species-thumb">${s.image_url ? `<img src="${escapeHtml(s.image_url)}" alt="${escapeHtml(s.name)}">` : '✧'}</span><span class="species-title"><strong>${escapeHtml(s.name)}</strong><small>GEN ${s.generation} · ${s.is_extinct ? 'EXTINCT' : 'LIVING'}</small></span><span class="species-chevron">⌄</span></summary><div class="species-body">${s.image_url ? `<img class="species-feature" src="${escapeHtml(s.image_url)}" alt="${escapeHtml(s.name)}">` : ''}<p>${escapeHtml(s.description || 'No description recorded.')}</p><div class="profile-grid">${[['Body structure',s.body_structure],['Locomotion',s.locomotion],['Diet',s.diet],['Habitat',s.habitat],['Reproduction',s.reproduction],['Lifespan',s.lifespan],['Population',s.population == null ? '' : String(s.population)],['Predators',Array.isArray(s.predators) ? s.predators.join(', ') : ''],['Defenses',Array.isArray(s.defensive_adaptations) ? s.defensive_adaptations.join(', ') : ''],['Environmental tolerances',JSON.stringify(s.environmental_tolerances || {})],['Evolutionary changes',s.evolutionary_changes],['Research notes',s.student_notes]].filter(([,v]) => v).map(([label,value]) => `<div><small>${escapeHtml(label)}</small><span>${escapeHtml(value)}</span></div>`).join('')}</div><div class="species-actions"><button class="outline-button copy-species" data-species-id="${s.id}">COPY COMPLETE PROFILE</button>${s.image_url ? `<button class="outline-button download-species" data-species-id="${s.id}">DOWNLOAD IMAGE ↓</button>` : ''}</div></div></details>`;
  const children = new Map(); species.forEach((s) => { if (s.parent_species_id) { const list = children.get(s.parent_species_id) || []; list.push(s); children.set(s.parent_species_id, list); } });
  const renderBranch = (s) => `<li><div class="tree-node">${renderProfile(s, true)}</div>${children.get(s.id)?.length ? `<ul>${children.get(s.id).map(renderBranch).join('')}</ul>` : ''}</li>`;
  const roots = species.filter((s) => !s.parent_species_id);
  const speciesList = species.map((s) => renderProfile(s)).join('');
  const descendantOptions = species.filter((s) => !s.is_extinct).map((s) => `<option value="${s.id}">${escapeHtml(s.name)} · Gen ${s.generation}</option>`).join('');
  app.innerHTML = `<main class="student-shell"><header class="student-header"><a class="brand" href="/index.html"><span class="brand-mark">X</span><span>XENOWORLD<small>FIELD RESEARCH PORTAL</small></span></a><div class="student-user"><span class="avatar">${escapeHtml((profile.display_name || 'R').slice(0,1).toUpperCase())}</span>${escapeHtml(profile.display_name || user.email)}<button id="sign-out" class="side-signout">Sign out ↗</button></div></header><section class="student-welcome"><p class="eyebrow">RESEARCHER ID VERIFIED // ${rooms.length} CLASSROOM${rooms.length === 1 ? '' : 'S'}</p><h1>Your field log.</h1><p>Every world is your own. Observe its life, explore its conditions, and track what changes.</p></section><div id="notice" class="notice"></div>
    <section class="worlds-section"><div class="section-title"><div><p class="eyebrow">ACTIVE BIOSPHERES</p><h2>My planets</h2></div><span class="panel-index">${String(worlds?.length || 0).padStart(2,'0')}</span></div>${planetCards.length ? `<div class="world-grid">${planetCards.join('')}</div>` : `<div class="empty-state"><div class="empty-orbit">◎</div><h3>Your planet is on its way.</h3><p>Join your classroom with the code from your teacher. Your teacher will distribute your individual copy after you join.</p></div>`}</section>
    ${species.length ? `<section class="student-evolution"><div class="section-title"><div><p class="eyebrow">BIOLOGICAL RECORDS</p><h2>Species profiles</h2></div><span class="panel-index">${String(species.length).padStart(2,'0')}</span></div><div class="species-profile-list">${speciesList}</div></section><section class="tree-section"><div class="section-title"><div><p class="eyebrow">ANCESTRY // DESCENT</p><h2>Evolutionary family tree</h2></div><span class="panel-index">${roots.length} ROOTS</span></div><div class="tree-tools"><button id="tree-zoom-out" class="outline-button" aria-label="Zoom out">−</button><button id="tree-zoom-in" class="outline-button" aria-label="Zoom in">+</button><button id="tree-reset" class="outline-button">RESET VIEW</button></div><div class="tree-viewport" id="tree-viewport"><div class="tree-canvas" id="tree-canvas"><ul class="family-tree">${roots.map(renderBranch).join('')}</ul></div></div><p class="hint">Drag to pan. Use + / − or Ctrl/⌘ + scroll to zoom. Select a species to open its profile.</p></section><section class="descendant-panel"><div><p class="eyebrow">NEXT GENERATION // STUDENT SUBMISSION</p><h2>Add an evolutionary descendant</h2><p>Choose a living parent and submit the species you developed with your external AI.</p></div><form id="descendant-form" class="stack-form descendant-form"><label>Parent species<select name="parent" required><option value="">Choose a living parent</option>${descendantOptions}</select></label><label>New species name<input name="name" required maxlength="100" placeholder="Name your descendant"></label><label>Species image<input name="image" type="file" accept="image/*" required></label><label>Description<textarea name="description" rows="2" placeholder="Describe the new organism"></textarea></label><div class="species-fields"><label>Body structure<input name="body_structure"></label><label>Locomotion<input name="locomotion"></label><label>Diet<input name="diet"></label><label>Habitat<input name="habitat"></label><label>Reproduction<input name="reproduction"></label><label>Lifespan<input name="lifespan"></label><label>Population<input name="population" type="number" min="0"></label><label>Defenses<input name="defenses" placeholder="Camouflage, venom"></label><label>Predators<input name="predators" placeholder="Predator species"></label><label>Environmental tolerances<input name="tolerances" placeholder="Cold, low oxygen"></label></div><label>Evolutionary changes<textarea name="changes" rows="2" placeholder="What changed from its parent, and why?"></textarea></label><label>Research notes<textarea name="notes" rows="2" placeholder="Optional notes"></textarea></label><button class="primary-button">ADD DESCENDANT TO FAMILY TREE <b>→</b></button></form></section>` : ''}
    <section class="join-panel"><div><p class="eyebrow">CLASSROOM ACCESS</p><h2>Join a class</h2><p>Enter the join code shared by your teacher.</p></div><form id="join-classroom" class="join-form"><input name="code" required minlength="6" maxlength="12" autocomplete="off" placeholder="e.g. A4B7C921"><button class="primary-button">JOIN <b>→</b></button></form></section>
    ${assignments.length ? `<section class="notification-history"><div class="section-title"><div><p class="eyebrow">FIELD TASKS</p><h2>Species assignments</h2></div><span class="panel-index">${assignments.length}</span></div>${assignments.map((a) => { const recipient = assignmentRecipients.find((r) => r.assignment_id === a.id); const assignedSpecies = species.find((s) => s.id === recipient?.species_id); return `<article class="notification-item"><span class="notification-mark">⌁</span><div><strong>${escapeHtml(a.title)}</strong><p>${escapeHtml(a.description || 'Your teacher has assigned a species activity.')}</p><small>${escapeHtml(a.mode.replace('_',' '))}${assignedSpecies ? ` · YOUR SPECIES: ${escapeHtml(assignedSpecies.name)}` : a.mode === 'student_choice' ? ' · CHOOSE ANY SPECIES' : ''}${a.due_at ? ` · DUE ${new Date(a.due_at).toLocaleDateString()}` : ''}</small></div></article>`; }).join('')}</section>` : ''}
    <section class="notification-history"><div class="section-title"><div><p class="eyebrow">CLASSROOM MESSAGES</p><h2>Notifications</h2></div><span class="panel-index">${notifications?.length || 0}</span></div>${notifications?.length ? notifications.map((n) => `<article class="notification-item ${n.read_at ? '' : 'unread'}"><span class="notification-mark">✦</span><div><strong>${escapeHtml(n.title)}</strong><p>${escapeHtml(n.body)}</p><small>${new Date(n.created_at).toLocaleString()}${n.read_at ? '' : ' · NEW'}</small></div></article>`).join('') : '<p class="muted">Teacher announcements and classroom notices will appear here.</p>'}</section></main>`;
  app.querySelector('#sign-out').onclick = signOut;
  const unread = (notifications || []).find((n) => !n.read_at);
  if (unread) {
    const announcement = announcementMap[unread.announcement_id];
    const overlay = document.createElement('div'); overlay.className = 'announcement-overlay'; overlay.innerHTML = `<section class="announcement-dialog" role="dialog" aria-modal="true" aria-labelledby="announcement-title"><p class="eyebrow">${escapeHtml(announcement?.lesson_number || 'NEW CLASS ANNOUNCEMENT')}</p><h2 id="announcement-title">${escapeHtml(unread.title)}</h2>${announcement?.image_url ? `<img class="announcement-image" src="${escapeHtml(announcement.image_url)}" alt="Lesson image">` : ''}<p>${escapeHtml(unread.body)}</p><small>${new Date(unread.created_at).toLocaleString()}</small><button id="read-announcement" class="primary-button">CONTINUE TO MY WORLD <b>→</b></button></section>`; app.append(overlay);
    overlay.querySelector('#read-announcement').onclick = async () => { const { error } = await supabase.from('notifications').update({ read_at:new Date().toISOString() }).eq('id', unread.id); if (error) { fail(error); return; } await renderStudentDashboard(app, profile, user); };
  }
  if (studentNotificationChannel) await supabase.removeChannel(studentNotificationChannel);
  studentNotificationChannel = supabase.channel(`student-live-${user.id}`)
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'notifications', filter:`student_id=eq.${user.id}` }, () => scheduleStudentRefresh(app, profile, user))
    .on('postgres_changes', { event:'UPDATE', schema:'public', table:'species', filter:`student_id=eq.${user.id}` }, () => scheduleStudentRefresh(app, profile, user))
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'environmental_events' }, (payload) => { if (classroomIds.includes(payload.new.classroom_id)) scheduleStudentRefresh(app, profile, user); })
    .subscribe();
  app.querySelectorAll('.copy-species').forEach((button) => button.onclick = async () => {
    const s = species.find((item) => item.id === button.dataset.speciesId);
    const profileText = [`Name: ${s.name}`, `Generation: ${s.generation}`, `Description: ${s.description}`, `Physical characteristics: ${JSON.stringify(s.characteristics || {})}`, `Body structure: ${s.body_structure}`, `Locomotion: ${s.locomotion}`, `Diet: ${s.diet}`, `Habitat: ${s.habitat}`, `Reproduction: ${s.reproduction}`, `Lifespan: ${s.lifespan}`, `Population: ${s.population ?? ''}`, `Predators: ${(s.predators || []).join(', ')}`, `Defensive adaptations: ${(s.defensive_adaptations || []).join(', ')}`, `Environmental tolerances: ${JSON.stringify(s.environmental_tolerances || {})}`, `Evolutionary changes: ${s.evolutionary_changes || ''}`, `Student notes: ${s.student_notes || ''}`].join('\n');
    try { await navigator.clipboard.writeText(profileText); notify('Complete species profile copied.'); }
    catch { const area = document.createElement('textarea'); area.value = profileText; document.body.append(area); area.select(); document.execCommand('copy'); area.remove(); notify('Complete species profile copied.'); }
  });
  app.querySelectorAll('.download-species').forEach((button) => button.onclick = async () => {
    const s = species.find((item) => item.id === button.dataset.speciesId);
    try { const response = await fetch(s.image_url); if (!response.ok) throw new Error('Image download failed'); const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${s.name.replace(/[^a-z0-9_-]+/gi,'_')}.${(s.image_path.split('.').pop() || 'jpg').replace(/[^a-z0-9]/gi,'')}`; anchor.click(); URL.revokeObjectURL(url); }
    catch (e) { notify(e.message || 'Could not download image.', true); }
  });
  const tree = app.querySelector('#tree-viewport');
  if (tree) {
    let scale = 1; let origin = null; let offsetX = 0; let offsetY = 0; const canvas = app.querySelector('#tree-canvas');
    const paint = () => { canvas.style.transform = `translate(${offsetX}px,${offsetY}px) scale(${scale})`; };
    app.querySelector('#tree-zoom-in').onclick = () => { scale = Math.min(1.65, scale + .12); paint(); };
    app.querySelector('#tree-zoom-out').onclick = () => { scale = Math.max(.55, scale - .12); paint(); };
    app.querySelector('#tree-reset').onclick = () => { scale = 1; offsetX = 0; offsetY = 0; paint(); };
    tree.onwheel = (event) => { if (event.ctrlKey || event.metaKey) { event.preventDefault(); scale = Math.max(.55, Math.min(1.65, scale + (event.deltaY < 0 ? .08 : -.08))); paint(); } };
    tree.onpointerdown = (event) => { if (event.target.closest('button,a,summary')) return; origin = { x:event.clientX-offsetX, y:event.clientY-offsetY }; tree.setPointerCapture(event.pointerId); };
    tree.onpointermove = (event) => { if (!origin) return; offsetX = event.clientX-origin.x; offsetY = event.clientY-origin.y; paint(); };
    tree.onpointerup = () => { origin = null; };
  }
  const descendantForm = app.querySelector('#descendant-form');
  if (descendantForm) descendantForm.onsubmit = async (event) => {
    event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button'); const f = new FormData(form); const parent = species.find((s) => s.id === f.get('parent')); const file = f.get('image');
    if (!parent || !file?.size) { notify('Choose a living parent and an image file.', true); return; }
    if (file.size > 8 * 1024 * 1024) { notify('Image must be 8 MB or smaller.', true); return; }
    button.disabled = true;
    try {
      const extension = (file.name.split('.').pop() || 'img').replace(/[^a-z0-9]/gi, '').toLowerCase();
      const imagePath = `${user.id}/species/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from('xenoworld-images').upload(imagePath, file, { contentType: file.type || 'application/octet-stream', upsert: false });
      if (uploadError) throw uploadError;
      const values = { planet_id: parent.planet_id, student_id: user.id, parent_species_id: parent.id, name: f.get('name').trim(), image_path: imagePath, description: f.get('description') || '', body_structure: f.get('body_structure') || '', locomotion: f.get('locomotion') || '', diet: f.get('diet') || '', habitat: f.get('habitat') || '', reproduction: f.get('reproduction') || '', lifespan: f.get('lifespan') || '', population: f.get('population') || null, predators: (f.get('predators') || '').split(',').map((x) => x.trim()).filter(Boolean), defensive_adaptations: (f.get('defenses') || '').split(',').map((x) => x.trim()).filter(Boolean), environmental_tolerances: { notes: f.get('tolerances') || '' }, evolutionary_changes: f.get('changes') || '', student_notes: f.get('notes') || '', generation: parent.generation + 1 };
      const { data: child, error: speciesError } = await supabase.from('species').insert(values).select('id').single();
      if (speciesError) throw speciesError;
      const { error: relationError } = await supabase.from('evolutionary_relationships').insert({ parent_species_id: parent.id, child_species_id: child.id, planet_id: parent.planet_id });
      if (relationError) throw new Error(`Species record saved, but the family tree link needs repair: ${relationError.message}`);
      await supabase.from('activity_logs').insert({ classroom_id: worlds.find((w) => w.id === parent.planet_id)?.classroom_id || null, student_id: user.id, actor_id: user.id, action: 'species_descendant_added', details: { species_id: child.id, parent_species_id: parent.id, name: values.name, generation: values.generation } });
      await renderStudentDashboard(app, profile, user); notify(`${values.name} was added as generation ${parent.generation + 1}.`);
    } catch (e) { fail(e); button.disabled = false; }
  };
  app.querySelector('#join-classroom').onsubmit = async (event) => {
    event.preventDefault(); const button = event.currentTarget.querySelector('button'); button.disabled = true;
    try { const { error } = await supabase.rpc('join_classroom', { class_code: new FormData(event.currentTarget).get('code') }); if (error) throw error; await renderStudentDashboard(app, profile, user); notify('You joined the classroom. Your teacher can now distribute your planet.'); } catch (e) { fail(e); button.disabled = false; }
  };
}
