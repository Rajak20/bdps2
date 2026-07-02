// ── CONFIG — replace with your real Supabase project values ──────────────
const SUPABASE_URL = 'https://ichefgsvffueklutfizf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImljaGVmZ3N2ZmZ1ZWtsdXRmaXpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3ODI5OTIsImV4cCI6MjA5ODM1ODk5Mn0.0fnUSDYMKxLYS8yTTMbzZYMOsfWfODU9V9lkzu05VgA';
// ─────────────────────────────────────────────────────────────────────────

const { createClient } = supabase;
const _sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
API._supabase = _sb;

// ── APP STATE ─────────────────────────────────────────────────────────────
let currentUser = null;   // profile from /api/me
let currentPage = '';
let chartInstances = {};
let searchTimer = null;

// ── HELPERS: SCORE / TIER / COLOR ─────────────────────────────────────────
const TIERS = [
  { min:85, label:'Platinum', cls:'tier-plat',   emoji:'💎' },
  { min:70, label:'Gold',     cls:'tier-gold',   emoji:'🥇' },
  { min:50, label:'Silver',   cls:'tier-silver', emoji:'🥈' },
  { min:0,  label:'Bronze',   cls:'tier-bronze', emoji:'🥉' },
];
function getTier(s) { return TIERS.find(t => s >= t.min) || TIERS[3]; }
function scoreColor(s) {
  if (s >= 80) return 'var(--green)';
  if (s >= 60) return 'var(--accent)';
  if (s >= 40) return 'var(--yellow)';
  return 'var(--red)';
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}
function fmtNum(n) { return Number(n).toLocaleString(); }
function initials(name) {
  return (name || '?').split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase();
}

// ── TOAST ─────────────────────────────────────────────────────────────────
let toastId = 0;
function showToast(msg, type='', duration=3500) {
  const icons = { '':'ℹ️', success:'✅', error:'❌', warn:'⚠️' };
  const id = ++toastId;
  const el = document.createElement('div');
  el.className = `toast ${type ? 't-'+type : ''}`;
  el.id = `toast-${id}`;
  el.innerHTML = `<span class="toast-icon">${icons[type]||'ℹ️'}</span><span style="flex:1">${esc(msg)}</span><span class="toast-close" onclick="removeToast(${id})">✕</span>`;
  document.getElementById('toastContainer').appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => removeToast(id), duration);
}
function removeToast(id) {
  const el = document.getElementById(`toast-${id}`);
  if (!el) return;
  el.classList.add('hiding');
  setTimeout(() => el.remove(), 300);
}

// ── MODAL ─────────────────────────────────────────────────────────────────
function openModal(title, bodyHTML, large=false) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = bodyHTML;
  document.getElementById('modalBox').className = `modal-box${large?' lg':''}`;
  document.getElementById('modal').classList.add('open');
}
function closeModal() { document.getElementById('modal').classList.remove('open'); }
document.getElementById('modal').addEventListener('click', e => {
  if (e.target === document.getElementById('modal')) closeModal();
});

// ── CONFIRM DIALOG ────────────────────────────────────────────────────────
function confirmDialog(title, msg, onConfirm, danger=true) {
  document.getElementById('modalTitle').textContent = '';
  document.getElementById('modalBody').innerHTML = '';
  document.getElementById('modalBox').className = 'modal-box';
  document.getElementById('modalBody').innerHTML = `
    <div class="confirm-box">
      <div class="confirm-icon">${danger ? '⚠️' : '❓'}</div>
      <h3>${esc(title)}</h3>
      <p>${esc(msg)}</p>
      <div class="confirm-actions">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn ${danger?'btn-danger':'btn-primary'}" id="confirmBtn">Confirm</button>
      </div>
    </div>`;
  document.getElementById('modal').classList.add('open');
  document.getElementById('confirmBtn').onclick = () => { closeModal(); onConfirm(); };
}

// ── DESTROY CHARTS ────────────────────────────────────────────────────────
function destroyCharts() {
  Object.values(chartInstances).forEach(c => { try { c.destroy(); } catch(e){} });
  chartInstances = {};
}

// ── AUTH PAGES ────────────────────────────────────────────────────────────
function showAuth(page='login') {
  document.getElementById('appRoot').style.display = 'none';
  const r = document.getElementById('authRoot');

  if (page === 'login') {
    r.innerHTML = `
      <div class="auth-page">
        <div class="auth-card">
          <div class="auth-logo">
            <div class="auth-logo-icon">B</div>
            <div>
              <h1>BDPS</h1>
              <p>Business Digital Presence Scoring</p>
            </div>
          </div>
          <h2 class="auth-title">Welcome back</h2>
          <p class="auth-sub">Sign in to your account</p>
          <div id="authAlert"></div>
          <div class="fg">
            <label>Email address</label>
            <input type="email" id="loginEmail" placeholder="you@example.com" autocomplete="email">
            <div class="field-error">Please enter a valid email</div>
          </div>
          <div class="fg">
            <label>Password</label>
            <input type="password" id="loginPass" placeholder="••••••••" autocomplete="current-password">
            <div class="field-error">Password is required</div>
          </div>
          <button class="btn btn-primary btn-full" id="loginBtn" onclick="doLogin()">Sign In</button>
          <div class="auth-switch">Don't have an account? <a onclick="showAuth('register')">Create one</a></div>
        </div>
      </div>`;
    document.getElementById('loginEmail').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
    document.getElementById('loginPass').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
  } else {
    r.innerHTML = `
      <div class="auth-page">
        <div class="auth-card">
          <div class="auth-logo">
            <div class="auth-logo-icon">B</div>
            <div><h1>BDPS</h1><p>Business Digital Presence Scoring</p></div>
          </div>
          <h2 class="auth-title">Create account</h2>
          <p class="auth-sub">Start tracking your digital presence</p>
          <div id="authAlert"></div>
          <div class="fg">
            <label>Full Name</label>
            <input type="text" id="regName" placeholder="Your Name">
            <div class="field-error">Full name is required</div>
          </div>
          <div class="fg">
            <label>Email address</label>
            <input type="email" id="regEmail" placeholder="you@example.com" autocomplete="email">
            <div class="field-error">Please enter a valid email</div>
          </div>
          <div class="fg">
            <label>Password</label>
            <input type="password" id="regPass" placeholder="Min. 8 characters" autocomplete="new-password">
            <div class="field-error">Password must be at least 8 characters</div>
          </div>
          <div class="fg">
            <label>Confirm Password</label>
            <input type="password" id="regPass2" placeholder="Repeat password">
            <div class="field-error">Passwords do not match</div>
          </div>
          <button class="btn btn-primary btn-full" id="regBtn" onclick="doRegister()">Create Account</button>
          <div class="auth-switch">Already have an account? <a onclick="showAuth('login')">Sign in</a></div>
        </div>
      </div>`;
  }
}

function setAuthAlert(msg, type='error') {
  const a = document.getElementById('authAlert');
  if (!a) return;
  a.innerHTML = msg ? `<div class="alert alert-${type}">${esc(msg)}</div>` : '';
}

async function doLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass  = document.getElementById('loginPass').value;
  const btn   = document.getElementById('loginBtn');

  let valid = true;
  const emailFg = document.getElementById('loginEmail').closest('.fg');
  const passFg  = document.getElementById('loginPass').closest('.fg');
  emailFg.classList.remove('has-error'); passFg.classList.remove('has-error');

  if (!email || !email.includes('@')) { emailFg.classList.add('has-error'); valid = false; }
  if (!pass) { passFg.classList.add('has-error'); valid = false; }
  if (!valid) return;

  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Signing in…';
  setAuthAlert('');

  const { error } = await API.signIn(email, pass);
  if (error) {
    const msg = error.message || '';
    setAuthAlert(
      msg.includes('Invalid login credentials') || msg.includes('invalid_credentials')
        ? 'Incorrect email or password. Please try again.'
        : msg || 'Login failed. Please try again.'
    );
    btn.disabled = false; btn.textContent = 'Sign In';
    return;
  }
  // onAuthStateChange will handle the rest
}

async function doRegister() {
  const name  = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const pass  = document.getElementById('regPass').value;
  const pass2 = document.getElementById('regPass2').value;
  const btn   = document.getElementById('regBtn');

  let valid = true;
  const fgs = {
    name:  document.getElementById('regName').closest('.fg'),
    email: document.getElementById('regEmail').closest('.fg'),
    pass:  document.getElementById('regPass').closest('.fg'),
    pass2: document.getElementById('regPass2').closest('.fg'),
  };
  Object.values(fgs).forEach(f => f.classList.remove('has-error'));

  if (!name) { fgs.name.classList.add('has-error'); valid = false; }
  if (!email || !email.includes('@')) { fgs.email.classList.add('has-error'); valid = false; }
  if (!pass || pass.length < 8) { fgs.pass.classList.add('has-error'); valid = false; }
  if (pass !== pass2) { fgs.pass2.classList.add('has-error'); valid = false; }
  if (!valid) return;

  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Creating account…';
  setAuthAlert('');

  const { error } = await API.signUp(email, pass, name);
  if (error) {
    const msg = error.message || error.msg || JSON.stringify(error);
    setAuthAlert(msg === '{}' || !msg ? 'Sign up failed. Please check your Supabase settings.' : msg);
    btn.disabled = false; btn.textContent = 'Create Account';
    return;
  }
  setAuthAlert('Account created! You can now sign in.', 'success');
  btn.disabled = false; btn.textContent = 'Create Account';
}

async function doLogout() {
  await API.signOut();
  currentUser = null;
  showAuth('login');
}

// ── NAVIGATION ────────────────────────────────────────────────────────────
const NAV_ADMIN = [
  { id:'dashboard',      icon:'📊', label:'Dashboard' },
  { id:'businesses',     icon:'🏢', label:'Businesses' },
  { id:'analytics',      icon:'📈', label:'Analytics' },
  { id:'rankings',       icon:'🏆', label:'Rankings' },
  { id:'recommendations',icon:'💡', label:'Recommendations' },
  { id:'reports',        icon:'📄', label:'Reports' },
  { section:'Admin' },
  { id:'users',          icon:'👥', label:'Manage Users' },
  { section:'' },
  { id:'profile',        icon:'⚙️', label:'Settings' },
];
const NAV_USER = [
  { id:'dashboard',      icon:'📊', label:'Dashboard' },
  { id:'businesses',     icon:'🏢', label:'My Businesses' },
  { id:'analytics',      icon:'📈', label:'Analytics' },
  { id:'recommendations',icon:'💡', label:'Recommendations' },
  { section:'' },
  { id:'profile',        icon:'⚙️', label:'Settings' },
];

function buildNav() {
  const nav = currentUser?.role === 'admin' ? NAV_ADMIN : NAV_USER;
  const container = document.getElementById('sidebarNav');
  container.innerHTML = nav.map(item => {
    if (item.section !== undefined) {
      return item.section
        ? `<div class="nav-section-label">${item.section}</div>`
        : `<div class="nav-divider"></div>`;
    }
    return `<button class="nav-item" data-page="${item.id}">
      <span class="ni">${item.icon}</span>
      <span class="label">${item.label}</span>
    </button>`;
  }).join('');

  container.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.page));
  });
}

function setActiveNav(page) {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
}

function navigate(page) {
  destroyCharts();
  currentPage = page;
  setActiveNav(page);
  const c = document.getElementById('pageContent');
  c.innerHTML = '<div class="loading-page"><div class="spinner spinner-lg"></div></div>';

  const pages = {
    dashboard, businesses, analytics, rankings,
    recommendations, reports, profile,
    users: adminUsers,
  };
  if (pages[page]) pages[page](c);
}

function refreshPage() { if (currentPage) navigate(currentPage); }

// Search
document.getElementById('searchInput').addEventListener('input', e => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (!q) { if (currentPage) navigate(currentPage); return; }
  searchTimer = setTimeout(() => searchPage(q), 300);
});

async function searchPage(q) {
  destroyCharts();
  setActiveNav('');
  const c = document.getElementById('pageContent');
  c.innerHTML = '<div class="loading-page"><div class="spinner spinner-lg"></div></div>';
  try {
    const res = await API.getBusinesses({ q });
    const list = res.businesses || [];
    c.innerHTML = `
      <div class="ph"><h1>Search results for "${esc(q)}"</h1><p>${list.length} business${list.length!==1?'es':''} found</p></div>
      ${list.length ? bizTable(list) : `<div class="empty"><div class="empty-icon">🔍</div><h3>No results found</h3><p>Try a different name, city, or category</p></div>`}`;
  } catch(err) {
    c.innerHTML = errAlert(err.message);
  }
}

function errAlert(msg) {
  return `<div class="alert alert-error">⚠️ ${esc(msg)}</div>`;
}

// ── CONNECTION CHECK ──────────────────────────────────────────────────────
async function checkConn() {
  const dot = document.getElementById('connDot');
  const ok = await API.health().catch(() => false);
  if (dot) dot.className = `conn-dot${ok?' online':''}`;
}

// ── BOOTSTRAP ─────────────────────────────────────────────────────────────
_sb.auth.onAuthStateChange(async (event, session) => {
  if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
    if (!session) { showAuth('login'); return; }
    try {
      // Check Flask is reachable before calling /api/me
      const flaskOk = await API.health().catch(() => false);
      if (!flaskOk) {
        showAuth('login');
        setTimeout(() => setAuthAlert('Cannot reach backend server. Please try again later.'), 200);
        await API.signOut();
        return;
      }
      currentUser = await API.getMe();
      document.getElementById('authRoot').innerHTML = '';
      document.getElementById('appRoot').style.display = 'flex';
      document.getElementById('userName').textContent = currentUser.fullName || currentUser.email;
      document.getElementById('userAvatar').textContent = initials(currentUser.fullName || currentUser.email);
      document.getElementById('userRoleLabel').textContent = currentUser.role;
      buildNav();
      navigate('dashboard');
      checkConn();
      setInterval(checkConn, 20000);
    } catch (err) {
      console.error('Auth bootstrap error:', err);
      showAuth('login');
      setTimeout(() => setAuthAlert('Sign in failed: ' + (err.message || 'Could not reach server. Check Flask is running.')), 200);
      await API.signOut();
    }
  } else if (event === 'SIGNED_OUT') {
    showAuth('login');
  }
});

// ── DASHBOARD ─────────────────────────────────────────────────────────────
async function dashboard(c) {
  try {
    const [bizRes, stats] = await Promise.all([
      API.getBusinesses({ pageSize: 5, sort: 'created_at', order: 'desc' }),
      API.getAnalytics()
    ]);

    const recent = bizRes.businesses || [];
    const total = stats.total_businesses || 0;

    c.innerHTML = `
      <div class="ph"><h1>Dashboard</h1><p>Welcome back, ${esc(currentUser?.fullName || 'User')} 👋</p></div>
      <div class="stats-grid">
        ${statCard('🏢', stats.total_businesses || 0, 'Total Businesses', 'var(--accent-bg)')}
        ${statCard('📊', stats.average_score || 0, 'Average Score', 'var(--blue-bg)')}
        ${statCard('🏆', stats.highest_score || 0, 'Highest Score', 'var(--green-bg)')}
        ${statCard('💎', stats.tier_breakdown?.Platinum || 0, 'Platinum Tier', 'var(--purple-bg)')}
        ${statCard('🌐', (stats.website_adoption || 0)+'%', 'Have Website', 'var(--yellow-bg)')}
      </div>
      ${total === 0 ? `
        <div class="empty">
          <div class="empty-icon">🏢</div>
          <h3>No businesses yet</h3>
          <p>Add your first business to start tracking your digital presence</p>
          <button class="btn btn-primary" onclick="openAddModal()">➕ Add Business</button>
        </div>` : `
      <div class="three-col">
        <div class="card">
          <div class="card-title">📈 Score Distribution</div>
          <div class="chart-wrap"><canvas id="chartDist"></canvas></div>
        </div>
        <div class="card">
          <div class="card-title">🏅 Tier Breakdown</div>
          ${['Platinum','Gold','Silver','Bronze'].map((t,i) => {
            const counts = [stats.tier_breakdown?.Platinum||0,stats.tier_breakdown?.Gold||0,stats.tier_breakdown?.Silver||0,stats.tier_breakdown?.Bronze||0];
            const colors = ['var(--purple)','var(--yellow)','var(--text2)','var(--red)'];
            const emojis = ['💎','🥇','🥈','🥉'];
            const pct = total ? Math.round(counts[i]/total*100) : 0;
            return `<div style="margin-bottom:12px">
              <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
                <span>${emojis[i]} ${t}</span><span style="font-weight:600">${counts[i]}</span>
              </div>
              <div class="score-bar"><div class="score-fill" style="width:${pct}%;background:${colors[i]}"></div></div>
            </div>`;
          }).join('')}
        </div>
      </div>
      <div class="two-col">
        <div class="card">
          <div class="card-title">📂 Category Breakdown</div>
          <div class="chart-wrap"><canvas id="chartCat"></canvas></div>
        </div>
        <div class="card">
          <div class="card-title">🕐 Recently Added</div>
          ${recent.length === 0 ? '<p style="font-size:13px;color:var(--text2)">None yet</p>' : `
          <div class="tbl-wrap" style="margin-bottom:0">
          <table><tbody>
            ${recent.map(b => `<tr>
              <td><div style="font-weight:500;font-size:13px">${esc(b.name)}</div><div style="font-size:11px;color:var(--text2)">${esc(b.category)}</div></td>
              <td style="text-align:right"><span style="font-weight:700;color:${scoreColor(b.score)}">${b.score}</span></td>
            </tr>`).join('')}
          </tbody></table></div>`}
        </div>
      </div>`}`;

    if (total > 0) {
      setTimeout(() => {
        const catData = stats.category_breakdown || {};
        const cats = Object.keys(catData);
        const colors = ['#4f46e5','#10b981','#f59e0b','#ef4444','#8b5cf6','#3b82f6','#f97316','#ec4899'];

        const dCtx = document.getElementById('chartDist');
        if (dCtx) chartInstances.dist = new Chart(dCtx, {
          type:'doughnut',
          data:{labels:cats, datasets:[{data:cats.map(c=>catData[c]),backgroundColor:colors.slice(0,cats.length),borderWidth:2,borderColor:'#fff'}]},
          options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right',labels:{font:{size:11},boxWidth:11,padding:10}}}}
        });

        const tiers = ['Platinum','Gold','Silver','Bronze'];
        const tierCounts = tiers.map(t => stats.tier_breakdown?.[t]||0);
        const cCtx = document.getElementById('chartCat');
        if (cCtx) chartInstances.cat = new Chart(cCtx, {
          type:'bar',
          data:{labels:tiers, datasets:[{data:tierCounts,backgroundColor:['#8b5cf6','#f59e0b','#6b7280','#ef4444'],borderRadius:6,borderWidth:0}]},
          options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{stepSize:1}}}}
        });
      }, 0);
    }
  } catch(err) {
    c.innerHTML = errAlert(err.message || 'Failed to load dashboard');
  }
}

function statCard(icon, val, label, bg) {
  return `<div class="stat-card">
    <div class="stat-icon-wrap" style="background:${bg}">${icon}</div>
    <div class="stat-val">${val}</div>
    <div class="stat-lbl">${label}</div>
  </div>`;
}

// ── BUSINESSES ────────────────────────────────────────────────────────────
let bizState = { page:1, sort:'score', order:'desc', category:'', city:'' };

async function businesses(c) {
  bizState = { page:1, sort:'score', order:'desc', category:'', city:'' };
  c.innerHTML = `
    <div class="ph-row">
      <div><h1 class="page-title">Businesses</h1><p style="font-size:13px;color:var(--text2)">${currentUser?.role==='admin'?'All businesses across all users':'Your registered businesses'}</p></div>
      <button class="btn btn-primary" onclick="openAddModal()">➕ Add Business</button>
    </div>
    <div class="filter-bar">
      <select id="filterCat" onchange="bizFilter()">
        <option value="">All Categories</option>
        ${['Restaurant','Retail','Healthcare','Education','Hotel','Fitness','Tech','Beauty','Other'].map(c=>`<option>${c}</option>`).join('')}
      </select>
      <select id="filterSort" onchange="bizFilter()">
        <option value="score">Sort: Score</option>
        <option value="name">Sort: Name</option>
        <option value="rating">Sort: Rating</option>
        <option value="reviews">Sort: Reviews</option>
        <option value="created_at">Sort: Newest</option>
      </select>
      <select id="filterOrder" onchange="bizFilter()">
        <option value="desc">↓ Descending</option>
        <option value="asc">↑ Ascending</option>
      </select>
      <button class="btn btn-secondary btn-sm" onclick="resetBizFilters()">Reset</button>
    </div>
    <div id="bizOut"><div class="loading-page"><div class="spinner"></div></div></div>`;
  await loadBizPage(c);
}

async function loadBizPage(c) {
  const out = document.getElementById('bizOut');
  if (!out) return;
  out.innerHTML = '<div class="loading-page" style="height:200px"><div class="spinner"></div></div>';
  try {
    const res = await API.getBusinesses({
      page: bizState.page, pageSize: 10,
      sort: bizState.sort, order: bizState.order,
      category: bizState.category, city: bizState.city
    });
    const list = res.businesses || [];
    const pg = res.pagination;

    if (!list.length) {
      out.innerHTML = `<div class="empty"><div class="empty-icon">🏢</div><h3>No businesses found</h3>
        <p>Try changing your filters or <a style="color:var(--accent);cursor:pointer" onclick="openAddModal()">add one</a>.</p></div>`;
      return;
    }

    out.innerHTML = `
      <div class="tbl-wrap">
        ${bizTable(list, true)}
        ${pagination(pg)}
      </div>`;

    // re-attach pagination listeners
    out.querySelectorAll('.page-btn[data-pg]').forEach(btn => {
      btn.addEventListener('click', () => {
        bizState.page = parseInt(btn.dataset.pg);
        loadBizPage(c);
      });
    });
  } catch(err) {
    if (out) out.innerHTML = errAlert(err.message);
  }
}

function bizFilter() {
  bizState.page = 1;
  bizState.category = document.getElementById('filterCat')?.value || '';
  bizState.sort = document.getElementById('filterSort')?.value || 'score';
  bizState.order = document.getElementById('filterOrder')?.value || 'desc';
  loadBizPage();
}

function resetBizFilters() {
  bizState = { page:1, sort:'score', order:'desc', category:'', city:'' };
  document.getElementById('filterCat').value = '';
  document.getElementById('filterSort').value = 'score';
  document.getElementById('filterOrder').value = 'desc';
  loadBizPage();
}

function bizTable(list, actions=false) {
  const isAdmin = currentUser?.role === 'admin';
  return `<table>
    <thead><tr>
      <th>Business</th><th>Category</th><th>City</th>
      <th>Rating</th><th>Reviews</th><th>Score</th><th>Tier</th>
      ${actions ? '<th>Actions</th>' : ''}
    </tr></thead>
    <tbody>
      ${list.map(b => {
        const tier = getTier(b.score);
        const canEdit = isAdmin || b.ownerId === currentUser?.id;
        return `<tr>
          <td>
            <div style="font-weight:600;font-size:13px">${esc(b.name)}</div>
            <div style="font-size:11px;color:var(--text2)">${b.website?'✓ Website':'✗ No website'} ${b.instagram?'· '+esc(b.instagram):''}</div>
          </td>
          <td><span class="badge badge-blue">${esc(b.category)}</span></td>
          <td style="font-size:12px">${esc(b.city)}</td>
          <td><span style="font-weight:600">⭐ ${b.rating}</span></td>
          <td>${fmtNum(b.reviews)}</td>
          <td>
            <span style="font-weight:700;font-size:15px;color:${scoreColor(b.score)}">${b.score}</span>
            <div class="score-bar" style="width:60px"><div class="score-fill" style="width:${b.score}%;background:${scoreColor(b.score)}"></div></div>
          </td>
          <td><span class="badge ${tier.cls}">${tier.emoji} ${tier.label}</span></td>
          ${actions ? `<td style="white-space:nowrap">
            <button class="btn btn-sm btn-ghost" onclick="viewBiz(${b.id})">👁 View</button>
            ${canEdit ? `<button class="btn btn-sm btn-secondary" onclick="editBiz(${b.id})" style="margin:0 4px">✏️ Edit</button>
            <button class="btn btn-sm btn-danger" onclick="deleteBiz(${b.id})">🗑</button>` : ''}
          </td>` : ''}
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}

function pagination(pg) {
  if (!pg || pg.totalPages <= 1) return '';
  const { page, totalPages, total, pageSize } = pg;
  const start = (page-1)*pageSize+1;
  const end = Math.min(page*pageSize, total);
  let pages = [];
  for (let i = Math.max(1,page-2); i <= Math.min(totalPages,page+2); i++) pages.push(i);

  return `<div class="pagination">
    <button class="page-btn" data-pg="${page-1}" ${page<=1?'disabled':''}>‹</button>
    ${page > 3 ? `<button class="page-btn" data-pg="1">1</button><span class="page-info">…</span>` : ''}
    ${pages.map(p => `<button class="page-btn${p===page?' active':''}" data-pg="${p}">${p}</button>`).join('')}
    ${page < totalPages-2 ? `<span class="page-info">…</span><button class="page-btn" data-pg="${totalPages}">${totalPages}</button>` : ''}
    <button class="page-btn" data-pg="${page+1}" ${page>=totalPages?'disabled':''}>›</button>
    <span class="page-info">${start}–${end} of ${total}</span>
  </div>`;
}

// ── ADD / EDIT BUSINESS MODAL ─────────────────────────────────────────────
function openAddModal(prefill={}) {
  openModal(prefill.id ? `Edit: ${prefill.name}` : 'Add New Business', bizFormHTML(prefill), true);
  document.getElementById('bizForm').addEventListener('submit', async e => {
    e.preventDefault();
    await submitBizForm(prefill.id);
  });
}

function bizFormHTML(b={}) {
  const cats = ['Restaurant','Retail','Healthcare','Education','Hotel','Fitness','Tech','Beauty','Other'];
  return `<form id="bizForm" novalidate>
    <div class="form-row">
      <div class="fg">
        <label>Business Name *</label>
        <input name="name" required placeholder="e.g. The Grand Bistro" value="${esc(b.name||'')}">
        <div class="field-error">Business name is required</div>
      </div>
      <div class="fg">
        <label>Category *</label>
        <select name="category">
          ${cats.map(c=>`<option${b.category===c?' selected':''}>${c}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="fg">
        <label>City *</label>
        <input name="city" required placeholder="Chennai" value="${esc(b.city||'')}">
        <div class="field-error">City is required</div>
      </div>
      <div class="fg">
        <label>Google Rating (0–5)</label>
        <input name="rating" type="number" step="0.1" min="0" max="5" placeholder="4.5" value="${b.rating||''}">
        <div class="field-error">Rating must be 0–5</div>
      </div>
    </div>
    <div class="form-row">
      <div class="fg">
        <label>Google Reviews</label>
        <input name="reviews" type="number" min="0" placeholder="250" value="${b.reviews||''}">
        <div class="field-error">Must be 0 or more</div>
      </div>
      <div class="fg">
        <label>Instagram Followers</label>
        <input name="followers" type="number" min="0" placeholder="5000" value="${b.followers||''}">
        <div class="field-error">Must be 0 or more</div>
      </div>
    </div>
    <div class="form-row">
      <div class="fg">
        <label>Engagement Rate (%)</label>
        <input name="engagement" type="number" step="0.1" min="0" placeholder="3.5" value="${b.engagement||''}">
        <div class="field-error">Must be 0 or more</div>
      </div>
      <div class="fg">
        <label>Days Since Last Post</label>
        <input name="lastPost" type="number" min="0" placeholder="7" value="${b.lastPost||''}">
        <div class="field-error">Must be 0 or more</div>
      </div>
    </div>
    <div class="fg">
      <label>Instagram Handle</label>
      <input name="instagram" placeholder="@yourbusiness" value="${esc(b.instagram||'')}">
    </div>
    <div class="fg">
      <div class="checkbox-row">
        <input type="checkbox" name="website" id="websiteChk"${b.website?' checked':''}>
        <span>This business has a website</span>
      </div>
    </div>
    <div id="bizFormAlert"></div>
    <div class="modal-foot">
      <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button type="submit" class="btn btn-primary" id="bizSubmitBtn">${b.id ? '💾 Save Changes' : '➕ Add Business'}</button>
    </div>
  </form>`;
}

function validateBizForm(fd) {
  const errors = [];
  const fgs = document.querySelectorAll('#bizForm .fg');
  fgs.forEach(fg => fg.classList.remove('has-error'));

  const name = (fd.get('name')||'').trim();
  const city = (fd.get('city')||'').trim();
  const rating = parseFloat(fd.get('rating'));
  const reviews = parseInt(fd.get('reviews'));
  const followers = parseInt(fd.get('followers'));
  const engagement = parseFloat(fd.get('engagement'));
  const lastPost = parseInt(fd.get('lastPost'));

  if (!name) { markFieldError('name', 'Business name is required'); errors.push(1); }
  if (!city) { markFieldError('city', 'City is required'); errors.push(1); }
  if (fd.get('rating') && (isNaN(rating) || rating < 0 || rating > 5)) {
    markFieldError('rating', 'Rating must be between 0 and 5'); errors.push(1);
  }
  if (fd.get('reviews') && (isNaN(reviews) || reviews < 0)) {
    markFieldError('reviews', 'Reviews must be 0 or more'); errors.push(1);
  }
  if (fd.get('followers') && (isNaN(followers) || followers < 0)) {
    markFieldError('followers', 'Followers must be 0 or more'); errors.push(1);
  }
  return errors.length === 0;
}

function markFieldError(name, msg) {
  const input = document.querySelector(`#bizForm [name="${name}"]`);
  if (!input) return;
  const fg = input.closest('.fg');
  if (fg) {
    fg.classList.add('has-error');
    const errEl = fg.querySelector('.field-error');
    if (errEl && msg) errEl.textContent = msg;
  }
}

async function submitBizForm(editId) {
  const form = document.getElementById('bizForm');
  const fd = new FormData(form);
  if (!validateBizForm(fd)) return;

  const btn = document.getElementById('bizSubmitBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Saving…';

  const payload = {
    name: fd.get('name').trim(),
    category: fd.get('category'),
    city: fd.get('city').trim(),
    rating: parseFloat(fd.get('rating')) || 4.0,
    reviews: parseInt(fd.get('reviews')) || 0,
    website: !!fd.get('website'),
    instagram: fd.get('instagram').trim(),
    followers: parseInt(fd.get('followers')) || 0,
    engagement: parseFloat(fd.get('engagement')) || 0,
    lastPost: parseInt(fd.get('lastPost')) || 30,
  };

  try {
    let result;
    if (editId) {
      result = await API.updateBusiness(editId, payload);
      showToast(`${result.name} updated — Score: ${result.score}`, 'success');
    } else {
      result = await API.createBusiness(payload);
      showToast(`${result.name} added — Score: ${result.score}`, 'success');
    }
    closeModal();
    navigate(currentPage);
  } catch(err) {
    const alertEl = document.getElementById('bizFormAlert');
    if (alertEl) {
      const details = err.details ? err.details.join(', ') : '';
      alertEl.innerHTML = `<div class="alert alert-error">⚠️ ${esc(err.message)}${details ? ': '+esc(details) : ''}</div>`;
    }
    btn.disabled = false;
    btn.innerHTML = editId ? '💾 Save Changes' : '➕ Add Business';
  }
}

async function viewBiz(id) {
  try {
    const b = await API.getBusiness(id);
    const tier = getTier(b.score);
    const recs = await API.getRecommendations(id).catch(() => []);

    openModal(esc(b.name), `
      <div style="text-align:center;padding:14px 0 20px">
        <div style="font-size:52px;font-weight:800;color:${scoreColor(b.score)};line-height:1">${b.score}</div>
        <div style="font-size:13px;color:var(--text2);margin:6px 0">Digital Presence Score</div>
        <span class="badge ${tier.cls}" style="font-size:13px;padding:5px 14px">${tier.emoji} ${tier.label}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:18px">
        ${[['📍','City',b.city],['📂','Category',b.category],['⭐','Rating',b.rating+' / 5'],['💬','Reviews',fmtNum(b.reviews)],['👥','Followers',fmtNum(b.followers)],['📊','Engagement',b.engagement+'%'],['📅','Last Post',b.lastPost+' days ago'],['🌐','Website',b.website?'Yes':'No']].map(([icon,k,v])=>`
          <div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px">
            <div style="font-size:11px;color:var(--text2);margin-bottom:3px">${icon} ${k}</div>
            <div style="font-size:13px;font-weight:600">${esc(String(v))}</div>
          </div>`).join('')}
      </div>
      ${recs.length ? `<div style="font-size:13px;font-weight:700;margin-bottom:10px">💡 Recommendations (${recs.length})</div>
        ${recs.map(r=>`<div class="rec-card">
          <div class="rec-icon">${r.icon}</div>
          <div><div class="rec-title">${r.title}</div><div class="rec-desc">${r.description}</div>
          <div class="rec-meta">
            <span class="badge ${r.impact==='High'?'badge-red':r.impact==='Medium'?'badge-yellow':'badge-green'}">${r.impact}</span>
            <span class="badge badge-blue">${r.points}</span>
          </div></div></div>`).join('')}` : ''}
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
        ${(currentUser?.role==='admin'||b.ownerId===currentUser?.id) ? `<button class="btn btn-secondary btn-sm" onclick="closeModal();editBiz(${b.id})">✏️ Edit</button>` : ''}
        <button class="btn btn-secondary btn-sm" onclick="closeModal()">Close</button>
      </div>`, true);
  } catch(err) {
    showToast('Could not load business: ' + err.message, 'error');
  }
}

async function editBiz(id) {
  try {
    const b = await API.getBusiness(id);
    openAddModal(b);
  } catch(err) {
    showToast('Could not load business: ' + err.message, 'error');
  }
}

function deleteBiz(id) {
  confirmDialog('Delete Business', 'This will permanently delete the business and all its data. This cannot be undone.', async () => {
    try {
      await API.deleteBusiness(id);
      showToast('Business deleted', 'success');
      navigate(currentPage);
    } catch(err) {
      showToast('Could not delete: ' + err.message, 'error');
    }
  });
}

// ── ANALYTICS ─────────────────────────────────────────────────────────────
async function analytics(c) {
  try {
    const [stats, bizRes] = await Promise.all([API.getAnalytics(), API.getBusinesses({ pageSize:100 })]);
    const businesses = bizRes.businesses || [];
    const total = businesses.length;

    c.innerHTML = `
      <div class="ph"><h1>Analytics</h1><p>Deep-dive into your digital presence metrics</p></div>
      <div class="stats-grid">
        ${statCard('🏢', stats.total_businesses||0, 'Total Businesses', 'var(--accent-bg)')}
        ${statCard('📊', stats.average_score||0, 'Average Score', 'var(--blue-bg)')}
        ${statCard('🏆', stats.highest_score||0, 'Best Score', 'var(--green-bg)')}
        ${statCard('📉', stats.lowest_score||0, 'Lowest Score', 'var(--red-bg)')}
        ${statCard('🌐', (stats.website_adoption||0)+'%', 'Website Adoption', 'var(--yellow-bg)')}
      </div>
      ${total === 0
        ? `<div class="empty"><div class="empty-icon">📈</div><h3>No data yet</h3><p>Add businesses to see analytics</p></div>`
        : `<div class="two-col">
            <div class="card"><div class="card-title">📊 Score Distribution</div><div class="chart-wrap"><canvas id="aDistChart"></canvas></div></div>
            <div class="card"><div class="card-title">📂 By Category</div><div class="chart-wrap"><canvas id="aCatChart"></canvas></div></div>
          </div>
          <div class="two-col">
            <div class="card"><div class="card-title">🌐 Website vs No Website</div><div class="chart-wrap"><canvas id="aWebChart"></canvas></div></div>
            <div class="card"><div class="card-title">🏙️ Avg Score by City</div><div class="chart-wrap"><canvas id="aCityChart"></canvas></div></div>
          </div>
          <div class="card">
            <div class="card-title">📋 Metric Breakdown</div>
            <div style="overflow-x:auto"><table>
              <thead><tr><th>Metric</th><th>Weight</th><th>Your Average</th><th>Max</th></tr></thead>
              <tbody>
                ${[
                  ['⭐ Google Rating','25 pts',(businesses.reduce((a,b)=>a+b.rating,0)/(total||1)).toFixed(2)+' / 5','25'],
                  ['💬 Reviews','20 pts',Math.round(businesses.reduce((a,b)=>a+b.reviews,0)/(total||1)).toLocaleString()+' reviews','20'],
                  ['🌐 Website','15 pts',Math.round(businesses.filter(b=>b.website).length/total*100)+'% have one','15'],
                  ['👥 Followers','20 pts',Math.round(businesses.reduce((a,b)=>a+b.followers,0)/(total||1)).toLocaleString(),'20'],
                  ['📊 Engagement','15 pts',(businesses.reduce((a,b)=>a+b.engagement,0)/(total||1)).toFixed(1)+'%','15'],
                  ['📅 Activity','5 pts',Math.round(businesses.reduce((a,b)=>a+b.lastPost,0)/(total||1))+' days avg','5'],
                ].map(([m,w,v,mx])=>`<tr><td><strong>${m}</strong></td><td><span class="badge badge-blue">${w}</span></td><td>${v}</td><td>${mx} pts</td></tr>`).join('')}
              </tbody>
            </table></div>
          </div>`}`;

    if (total > 0) {
      setTimeout(() => {
        const ranges=['0–20','21–40','41–60','61–80','81–100'];
        const dCounts=[
          businesses.filter(b=>b.score<=20).length,
          businesses.filter(b=>b.score>=21&&b.score<=40).length,
          businesses.filter(b=>b.score>=41&&b.score<=60).length,
          businesses.filter(b=>b.score>=61&&b.score<=80).length,
          businesses.filter(b=>b.score>=81).length,
        ];
        const d1=document.getElementById('aDistChart');
        if(d1) chartInstances.dist=new Chart(d1,{type:'bar',data:{labels:ranges,datasets:[{data:dCounts,backgroundColor:['#ef4444','#f97316','#f59e0b','#3b82f6','#10b981'],borderRadius:6,borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{stepSize:1}}}}});

        const cats=[...new Set(businesses.map(b=>b.category))];
        const d2=document.getElementById('aCatChart');
        if(d2) chartInstances.cat=new Chart(d2,{type:'bar',data:{labels:cats,datasets:[{data:cats.map(cat=>businesses.filter(b=>b.category===cat).length),backgroundColor:'#4f46e5',borderRadius:6,borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{beginAtZero:true,ticks:{stepSize:1}}}}});

        const hasWeb=businesses.filter(b=>b.website).length;
        const d3=document.getElementById('aWebChart');
        if(d3) chartInstances.web=new Chart(d3,{type:'doughnut',data:{labels:['Has Website','No Website'],datasets:[{data:[hasWeb,total-hasWeb],backgroundColor:['#10b981','#ef4444'],borderWidth:2,borderColor:'#fff'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom'}}}});

        const cities=[...new Set(businesses.map(b=>b.city))];
        const cityAvgs=cities.map(city=>{const bs=businesses.filter(b=>b.city===city);return Math.round(bs.reduce((a,b)=>a+b.score,0)/bs.length);});
        const d4=document.getElementById('aCityChart');
        if(d4) chartInstances.city=new Chart(d4,{type:'bar',data:{labels:cities,datasets:[{data:cityAvgs,backgroundColor:'#8b5cf6',borderRadius:6,borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:false,min:0,max:100}}}});
      }, 0);
    }
  } catch(err) {
    c.innerHTML = errAlert(err.message);
  }
}

// ── RANKINGS ──────────────────────────────────────────────────────────────
async function rankings(c) {
  c.innerHTML = `
    <div class="ph"><h1>Rankings</h1><p>Businesses ranked by Digital Presence Score</p></div>
    <div class="filter-bar">
      <select id="rankCat" onchange="loadRankings()">
        <option value="">All Categories</option>
        ${['Restaurant','Retail','Healthcare','Education','Hotel','Fitness','Tech','Beauty','Other'].map(c=>`<option>${c}</option>`).join('')}
      </select>
      <button class="btn btn-secondary btn-sm" onclick="document.getElementById('rankCat').value='';loadRankings()">Reset</button>
    </div>
    <div id="rankOut"><div class="loading-page" style="height:200px"><div class="spinner"></div></div></div>`;
  await loadRankings();
}

async function loadRankings() {
  const out = document.getElementById('rankOut');
  if (!out) return;
  out.innerHTML = '<div class="loading-page" style="height:120px"><div class="spinner"></div></div>';
  try {
    const category = document.getElementById('rankCat')?.value || '';
    const list = await API.getRankings({ category });
    if (!list.length) {
      out.innerHTML = `<div class="empty"><div class="empty-icon">🏆</div><h3>No businesses found</h3></div>`;
      return;
    }
    out.innerHTML = `<div class="tbl-wrap"><table>
      <thead><tr><th>#</th><th>Business</th><th>Category</th><th>City</th><th>Score</th><th>Tier</th></tr></thead>
      <tbody>${list.map((b,i) => {
        const tier = getTier(b.score);
        const rank = i===0?'🥇':i===1?'🥈':i===2?'🥉':`#${i+1}`;
        return `<tr>
          <td style="font-size:18px;font-weight:700">${rank}</td>
          <td><div style="font-weight:600">${esc(b.name)}</div></td>
          <td><span class="badge badge-blue">${esc(b.category)}</span></td>
          <td>${esc(b.city)}</td>
          <td><span style="font-weight:700;font-size:16px;color:${scoreColor(b.score)}">${b.score}</span></td>
          <td><span class="badge ${tier.cls}">${tier.emoji} ${tier.label}</span></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  } catch(err) {
    if (out) out.innerHTML = errAlert(err.message);
  }
}

// ── RECOMMENDATIONS ───────────────────────────────────────────────────────
async function recommendations(c) {
  c.innerHTML = `<div class="ph"><h1>Recommendations</h1><p>Personalised AI-powered actions to improve your digital presence</p></div>
    <div id="recOut"><div class="loading-page" style="height:200px"><div class="spinner spinner-lg"></div></div></div>`;
  try {
    const res = await API.getBusinesses({ pageSize:100, sort:'score', order:'asc' });
    const list = res.businesses || [];
    const out = document.getElementById('recOut');
    if (!out) return;

    if (!list.length) {
      out.innerHTML = `<div class="empty"><div class="empty-icon">💡</div><h3>No businesses yet</h3>
        <p>Add a business to get personalised recommendations</p>
        <button class="btn btn-primary" onclick="openAddModal()">➕ Add Business</button></div>`;
      return;
    }

    const blocks = await Promise.all(list.map(async b => {
      try {
        const recs = await API.getRecommendations(b.id);
        if (!recs.length) return '';
        const tier = getTier(b.score);
        return `<div class="card" style="margin-bottom:18px">
          <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border)">
            <div style="width:48px;height:48px;border-radius:12px;background:${scoreColor(b.score)};display:flex;align-items:center;justify-content:center;color:#fff;font-size:18px;font-weight:800;flex-shrink:0">${b.score}</div>
            <div style="flex:1">
              <div style="font-weight:700;font-size:15px">${esc(b.name)}</div>
              <div style="font-size:12px;color:var(--text2)">${esc(b.category)} · ${esc(b.city)}</div>
            </div>
            <span class="badge ${tier.cls}">${tier.emoji} ${tier.label}</span>
            <button class="btn btn-sm btn-secondary" onclick="editBiz(${b.id})">✏️ Improve</button>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">
            ${recs.map(r=>`<div class="rec-card">
              <div class="rec-icon">${r.icon}</div>
              <div><div class="rec-title">${r.title}</div><div class="rec-desc">${r.description}</div>
              <div class="rec-meta">
                <span class="badge ${r.impact==='High'?'badge-red':r.impact==='Medium'?'badge-yellow':'badge-green'}">${r.impact}</span>
                <span class="badge badge-blue">${r.points}</span>
              </div></div>
            </div>`).join('')}
          </div>
        </div>`;
      } catch { return ''; }
    }));

    out.innerHTML = blocks.join('') || `<div class="empty"><div class="empty-icon">🎉</div><h3>Everything looks great!</h3><p>All your businesses are well optimised.</p></div>`;
  } catch(err) {
    document.getElementById('recOut').innerHTML = errAlert(err.message);
  }
}

// ── REPORTS ───────────────────────────────────────────────────────────────
async function reports(c) {
  try {
    const [stats, bizRes] = await Promise.all([API.getAnalytics(), API.getBusinesses({ pageSize:100, sort:'score', order:'desc' })]);
    const list = bizRes.businesses || [];
    const total = stats.total_businesses || 0;

    c.innerHTML = `
      <div class="ph"><h1>Reports</h1><p>Export and review your data</p></div>
      <div class="stats-grid">
        ${statCard('🏢', total, 'Total', 'var(--accent-bg)')}
        ${statCard('📊', stats.average_score||0, 'Avg Score', 'var(--blue-bg)')}
        ${statCard('💎', stats.tier_breakdown?.Platinum||0, 'Platinum', 'var(--purple-bg)')}
        ${statCard('🥇', stats.tier_breakdown?.Gold||0, 'Gold', 'var(--yellow-bg)')}
        ${statCard('🥈', stats.tier_breakdown?.Silver||0, 'Silver', 'var(--bg)')}
        ${statCard('🥉', stats.tier_breakdown?.Bronze||0, 'Bronze', 'var(--red-bg)')}
      </div>
      <div class="two-col">
        <div class="card">
          <div class="card-title">📤 Export</div>
          <p style="font-size:13px;color:var(--text2);margin-bottom:16px">Download your complete business data in CSV or JSON format.</p>
          <button class="btn btn-primary" onclick="doExportCsv(this)">⬇ Download CSV</button>
          <button class="btn btn-secondary" style="margin-left:8px" onclick="doExportJson()">⬇ Download JSON</button>
        </div>
        <div class="card">
          <div class="card-title">📊 Summary</div>
          ${total > 0 ? [
            ['Businesses with website', `${list.filter(b=>b.website).length} / ${total}`],
            ['Avg engagement rate', `${(list.reduce((a,b)=>a+b.engagement,0)/(total||1)).toFixed(1)}%`],
            ['Avg review count', Math.round(list.reduce((a,b)=>a+b.reviews,0)/(total||1)).toLocaleString()],
            ['Avg followers', Math.round(list.reduce((a,b)=>a+b.followers,0)/(total||1)).toLocaleString()],
          ].map(([k,v])=>`<div class="setting-row"><div class="setting-info"><p>${k}</p></div><strong>${v}</strong></div>`).join('') : '<p style="font-size:13px;color:var(--text2)">No data yet</p>'}
        </div>
      </div>
      ${total > 0 ? `<div class="card">
        <div class="card-title">📋 Full Report</div>
        <div style="overflow-x:auto"><table>
          <thead><tr><th>Business</th><th>Category</th><th>City</th><th>Rating</th><th>Reviews</th><th>Followers</th><th>Engagement</th><th>Score</th><th>Tier</th></tr></thead>
          <tbody>${list.map(b=>{const t=getTier(b.score);return`<tr>
            <td><strong>${esc(b.name)}</strong></td><td>${esc(b.category)}</td><td>${esc(b.city)}</td>
            <td>⭐ ${b.rating}</td><td>${fmtNum(b.reviews)}</td><td>${fmtNum(b.followers)}</td>
            <td>${b.engagement}%</td>
            <td style="font-weight:700;color:${scoreColor(b.score)}">${b.score}</td>
            <td><span class="badge ${t.cls}">${t.emoji} ${t.label}</span></td>
          </tr>`;}).join('')}</tbody>
        </table></div>
      </div>` : ''}`;
  } catch(err) {
    c.innerHTML = errAlert(err.message);
  }
}

async function doExportCsv(btn) {
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Downloading…';
  try {
    const blob = await API.downloadCsv();
    triggerDownload(blob, 'bdps_report.csv');
    showToast('CSV downloaded', 'success');
  } catch(err) {
    showToast('Download failed: ' + err.message, 'error');
  }
  btn.disabled = false; btn.innerHTML = '⬇ Download CSV';
}

async function doExportJson() {
  try {
    const res = await API.getBusinesses({ pageSize:1000 });
    const data = (res.businesses||[]).map(b=>({...b, tier: getTier(b.score).label}));
    triggerDownload(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}), 'bdps_report.json');
    showToast('JSON downloaded', 'success');
  } catch(err) {
    showToast('Export failed: ' + err.message, 'error');
  }
}

function triggerDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href:url, download:name }).click();
  URL.revokeObjectURL(url);
}

// ── PROFILE / SETTINGS ────────────────────────────────────────────────────
function profile(c) {
  if (!currentUser) return;
  c.innerHTML = `
    <div class="ph"><h1>Profile & Settings</h1><p>Manage your account and preferences</p></div>
    <div class="two-col">
      <div>
        <div class="card">
          <div class="card-title">👤 Personal Information</div>
          <div id="profileAlert"></div>
          <div class="fg"><label>Full Name</label><input id="pfName" value="${esc(currentUser.fullName||'')}"><div class="field-error">Name is required</div></div>
          <div class="fg"><label>Email</label><input value="${esc(currentUser.email||'')}" disabled style="background:var(--bg);color:var(--text2)"><div class="hint">Email cannot be changed here</div></div>
          <div class="fg"><label>Role</label><input value="${esc(currentUser.role)}" disabled style="background:var(--bg);color:var(--text2)"></div>
          <button class="btn btn-primary" onclick="saveProfile(this)">💾 Save Changes</button>
        </div>
        <div class="card">
          <div class="card-title">🔑 Change Password</div>
          <div id="passAlert"></div>
          <div class="fg"><label>New Password</label><input type="password" id="pfPass" placeholder="Min. 8 characters"></div>
          <div class="fg"><label>Confirm Password</label><input type="password" id="pfPass2" placeholder="Repeat password"></div>
          <button class="btn btn-primary" onclick="changePassword(this)">🔑 Update Password</button>
        </div>
      </div>
      <div>
        <div class="card">
          <div class="card-title">🎨 Preferences</div>
          <div class="setting-row">
            <div class="setting-info"><p>Dark Mode</p><span>Switch to a darker interface</span></div>
            <label class="toggle"><input type="checkbox" id="darkToggle" onchange="toggleDark(this.checked)"><span class="toggle-slider"></span></label>
          </div>
        </div>
        <div class="card">
          <div class="card-title">📊 Account Stats</div>
          <div class="setting-row"><div class="setting-info"><p>Account type</p></div><span class="badge ${currentUser.role==='admin'?'badge-purple':'badge-blue'}">${currentUser.role}</span></div>
          <div class="setting-row"><div class="setting-info"><p>Member since</p></div><strong>${currentUser.createdAt ? new Date(currentUser.createdAt).toLocaleDateString() : '—'}</strong></div>
        </div>
        <div class="card" style="border-color:var(--red-bg)">
          <div class="card-title" style="color:var(--red)">⚠️ Danger Zone</div>
          <p style="font-size:13px;color:var(--text2);margin-bottom:14px">Signing out will end your current session.</p>
          <button class="btn btn-danger" onclick="confirmDialog('Sign Out','Are you sure you want to sign out?',doLogout,false)">🚪 Sign Out</button>
        </div>
      </div>
    </div>`;
}

async function saveProfile(btn) {
  const name = document.getElementById('pfName').value.trim();
  const alertEl = document.getElementById('profileAlert');
  if (!name) {
    alertEl.innerHTML = `<div class="alert alert-error">Name is required</div>`;
    return;
  }
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Saving…';
  try {
    const updated = await API.updateMe({ fullName: name });
    currentUser.fullName = updated.fullName;
    document.getElementById('userName').textContent = updated.fullName;
    document.getElementById('userAvatar').textContent = initials(updated.fullName);
    alertEl.innerHTML = `<div class="alert alert-success">Profile updated successfully!</div>`;
    showToast('Profile saved', 'success');
  } catch(err) {
    alertEl.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
  btn.disabled = false; btn.innerHTML = '💾 Save Changes';
  setTimeout(() => { alertEl.innerHTML = ''; }, 3000);
}

async function changePassword(btn) {
  const pass  = document.getElementById('pfPass').value;
  const pass2 = document.getElementById('pfPass2').value;
  const alertEl = document.getElementById('passAlert');
  if (!pass || pass.length < 8) { alertEl.innerHTML=`<div class="alert alert-error">Password must be at least 8 characters</div>`; return; }
  if (pass !== pass2) { alertEl.innerHTML=`<div class="alert alert-error">Passwords do not match</div>`; return; }

  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Updating…';
  const { error } = await _sb.auth.updateUser({ password: pass });
  if (error) {
    alertEl.innerHTML = `<div class="alert alert-error">${esc(error.message)}</div>`;
  } else {
    alertEl.innerHTML = `<div class="alert alert-success">Password updated successfully!</div>`;
    document.getElementById('pfPass').value = '';
    document.getElementById('pfPass2').value = '';
    showToast('Password updated', 'success');
  }
  btn.disabled = false; btn.innerHTML = '🔑 Update Password';
  setTimeout(() => { alertEl.innerHTML = ''; }, 4000);
}

function toggleDark(on) {
  const vars = on
    ? { '--bg':'#111827','--bg-card':'#1f2937','--bg-hover':'#374151','--bg-input':'#1f2937','--text':'#f9fafb','--text2':'#9ca3af','--text3':'#6b7280','--border':'#374151','--border2':'#1f2937' }
    : { '--bg':'#f7f8fc','--bg-card':'#ffffff','--bg-hover':'#f1f3f9','--bg-input':'#ffffff','--text':'#1a1d2e','--text2':'#6b7280','--text3':'#9ca3af','--border':'#e5e7eb','--border2':'#f3f4f6' };
  Object.entries(vars).forEach(([k,v]) => document.documentElement.style.setProperty(k,v));
}

// ── ADMIN: USERS ──────────────────────────────────────────────────────────
async function adminUsers(c) {
  if (currentUser?.role !== 'admin') { c.innerHTML = errAlert('Admin access required'); return; }
  c.innerHTML = `
    <div class="ph"><h1>Manage Users</h1><p>View all registered users and their roles</p></div>
    <div id="usersOut"><div class="loading-page" style="height:200px"><div class="spinner"></div></div></div>`;
  await loadUsers();
}

async function loadUsers() {
  const out = document.getElementById('usersOut');
  if (!out) return;
  try {
    const users = await API.adminGetUsers();
    if (!users.length) {
      out.innerHTML = `<div class="empty"><div class="empty-icon">👥</div><h3>No users yet</h3></div>`;
      return;
    }
    out.innerHTML = `<div class="tbl-wrap"><table>
      <thead><tr><th>User</th><th>Email</th><th>Role</th><th>Businesses</th><th>Status</th><th>Joined</th><th>Actions</th></tr></thead>
      <tbody>${users.map(u => `<tr>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <div style="width:30px;height:30px;border-radius:50%;background:var(--accent-grd);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700">${initials(u.fullName||u.email)}</div>
            <div style="font-weight:600;font-size:13px">${esc(u.fullName||'—')}</div>
          </div>
        </td>
        <td style="font-size:12px;color:var(--text2)">${esc(u.email)}</td>
        <td><span class="badge ${u.role==='admin'?'badge-purple':'badge-blue'}">${u.role}</span></td>
        <td style="text-align:center">${u.businessCount||0}</td>
        <td><span class="badge ${u.isActive?'badge-green':'badge-red'}">${u.isActive?'Active':'Inactive'}</span></td>
        <td style="font-size:12px;color:var(--text2)">${u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}</td>
        <td>
          ${u.id !== currentUser?.id ? `
            <button class="btn btn-xs btn-secondary" onclick="toggleUserRole('${u.id}','${u.role==='admin'?'user':'admin'}')" title="${u.role==='admin'?'Remove admin':'Make admin'}">
              ${u.role==='admin'?'⬇ User':'⬆ Admin'}
            </button>` : '<span style="font-size:11px;color:var(--text3)">You</span>'}
        </td>
      </tr>`).join('')}</tbody>
    </table></div>
    <p style="font-size:12px;color:var(--text2);padding:10px 0">
      💡 Tip: To make someone admin, sign up through the app first, then promote them here.
    </p>`;
  } catch(err) {
    if (out) out.innerHTML = errAlert(err.message);
  }
}

async function toggleUserRole(userId, newRole) {
  confirmDialog(
    `Change role to ${newRole}`,
    `This will change this user's access level to ${newRole}. They will need to sign out and back in for changes to take effect.`,
    async () => {
      try {
        await API.adminSetRole(userId, newRole);
        showToast(`Role updated to ${newRole}`, 'success');
        loadUsers();
      } catch(err) {
        showToast('Failed: ' + err.message, 'error');
      }
    }, false
  );
}

// ── INITIAL LOAD ──────────────────────────────────────────────────────────
// Show login immediately while session check happens in background
showAuth('login');
