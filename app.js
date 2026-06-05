/*
 * =================================
   Zenime - APP.JS
 * =================================
 */

// --- Global App State ---
const state = {
  currentView: 'browse', // 'browse' | 'mylist' | 'detail'
  previousView: 'browse',
  currentDetailId: null,
  currentPage: 1,
  totalPages: 1,
  genresList: [], // Dynamically loaded anime genres
  activeGenres: new Set(), // Selected genre IDs for filtering
  searchQuery: '',
  searchScope: 'all', // all | airing | upcoming
  isSearchMode: false, // true when user committed a search (Enter or suggestion pick)
  filters: {
    type: '',
    status: '',
    sort: 'popularity'
  },
  
  // Watchlist List Tab Filter
  mylistTab: 'all', // 'all' | 'watching' | 'completed' | 'onhold' | 'dropped'
  
  // Authentication State
  currentUser: null, // Logged-in user object { username, list: { animeId: { ... } } }
  
  // API Fetch Cache (avoids hitting rate limits for tooltips, characters, recs)
  cache: {
    animeDetails: {}, // id -> details data
    animeCharacters: {}, // id -> characters data
    animeRecommendations: {}, // id -> recommendations data
    featuredAnime: null
  },

  heroCarousel: {
    slides: [],
    index: 0,
    timerId: null,
    progressRafId: null,
    progressStart: 0,
    isPaused: false,
    isTransitioning: false,
    intervalMs: 5500,
    activeBackdrop: 'a'
  },
  
  // Rate-limiting queue configuration
  apiQueue: [],
  isProcessingQueue: false,
  lastApiCallTime: 0,
  minApiInterval: 400 // Jikan limits: 3 requests/sec max, so 400ms interval is safe
};

// --- Constant Fallback Genres (used if Jikan API fails or is rate-limited)
const FALLBACK_GENRES = [
  { mal_id: 1, name: 'Action' },
  { mal_id: 2, name: 'Adventure' },
  { mal_id: 4, name: 'Comedy' },
  { mal_id: 8, name: 'Drama' },
  { mal_id: 10, name: 'Fantasy' },
  { mal_id: 22, name: 'Romance' },
  { mal_id: 24, name: 'Sci-Fi' },
  { mal_id: 36, name: 'Slice of Life' },
  { mal_id: 37, name: 'Supernatural' },
  { mal_id: 41, name: 'Suspense' }
];

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initAuthSession();
  initEventListeners();
  loadGenres();
  loadFeaturedAnime();
  loadCatalog();
  loadTopPicks();
  loadPopularAnime();
  loadTop10Week();
  initRouting();
  
  // Initialize Lucide Icons
  if (window.lucide) {
    lucide.createIcons();
  }
});

// ==========================================================================
// 1. DYNAMIC API QUEUE & RATE LIMITER (Jikan Core)
// ==========================================================================

/**
 * Throttled fetch wrapper. Respects Jikan rate limit by maintaining 
 * a minimum duration between queries.
 */
function fetchThrottled(url) {
  return new Promise((resolve, reject) => {
    state.apiQueue.push({ url, resolve, reject });
    processApiQueue();
  });
}

async function processApiQueue() {
  if (state.isProcessingQueue || state.apiQueue.length === 0) return;
  state.isProcessingQueue = true;

  while (state.apiQueue.length > 0) {
    const now = Date.now();
    const elapsed = now - state.lastApiCallTime;
    const waitTime = Math.max(0, state.minApiInterval - elapsed);

    if (waitTime > 0) {
      await new Promise(r => setTimeout(r, waitTime));
    }

    const { url, resolve, reject } = state.apiQueue.shift();
    state.lastApiCallTime = Date.now();

    try {
      const response = await fetch(url);
      if (response.status === 429) {
        // Rate-limited: push back to queue, backoff and retry
        console.warn('API Rate limited (429). Retrying...');
        state.apiQueue.unshift({ url, resolve, reject });
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      if (!response.ok) {
        throw new Error(`API returned error code ${response.status}`);
      }
      const data = await response.json();
      resolve(data);
    } catch (err) {
      console.error(`Fetch failed for: ${url}`, err);
      reject(err);
    }
  }

  state.isProcessingQueue = false;
}

// ==========================================================================
// 2. SIMULATED USER REGISTRATION & AUTHENTICATION
// ==========================================================================

function initAuthSession() {
  const session = localStorage.getItem('aniflow_session');
  if (session) {
    try {
      const sessionData = JSON.parse(session);
      // Fetch users database
      const users = JSON.parse(localStorage.getItem('aniflow_users') || '[]');
      const matchedUser = users.find(u => u.username === sessionData.username);
      if (matchedUser) {
        state.currentUser = matchedUser;
        updateHeaderAuthUI();
        return;
      }
    } catch (e) {
      console.error("Error parsing auth session.", e);
    }
  }
  state.currentUser = null;
  updateHeaderAuthUI();
}

function updateHeaderAuthUI() {
  const authSection = document.getElementById('auth-header-section');
  if (!authSection) return;

  if (state.currentUser) {
    authSection.innerHTML = `
      <div class="profile-dropdown-wrapper" id="profile-dropdown-wrapper">
        <button type="button" class="header-link-btn profile-dropdown-btn" id="profile-dropdown-btn">
          <i data-lucide="user"></i>
          <span>${escapeHTML(state.currentUser.username)}</span>
          <i data-lucide="chevron-down" style="width: 14px; height: 14px;"></i>
        </button>
        <div class="dropdown-menu hide" id="profile-dropdown-menu">
          <button class="dropdown-item" id="dropdown-btn-mylist"><i data-lucide="list"></i> My Watchlist</button>
          <button class="dropdown-item" id="dropdown-btn-logout"><i data-lucide="log-out"></i> Sign Out</button>
        </div>
      </div>
    `;
    
    // Add dropdown toggle logic
    const dropdownBtn = document.getElementById('profile-dropdown-btn');
    const dropdownMenu = document.getElementById('profile-dropdown-menu');
    if (dropdownBtn && dropdownMenu) {
      dropdownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdownMenu.classList.toggle('hide');
      });
      document.addEventListener('click', () => {
        dropdownMenu.classList.add('hide');
      });
    }

    // Attach actions
    document.getElementById('dropdown-btn-mylist').addEventListener('click', () => {
      switchView('mylist');
    });
    document.getElementById('dropdown-btn-logout').addEventListener('click', () => {
      logoutUser();
    });
  } else {
    authSection.innerHTML = `
      <button type="button" class="header-link-btn header-sign-in" id="btn-show-login">Sign in</button>
    `;
    document.getElementById('btn-show-login').addEventListener('click', () => {
      toggleAuthModal(true);
    });
  }
  
  if (window.lucide) lucide.createIcons();
}

function toggleAuthModal(show, isRegisterMode = false) {
  const authModal = document.getElementById('auth-modal');
  const title = document.getElementById('auth-modal-title');
  const subtitle = document.getElementById('auth-modal-subtitle');
  const submitBtn = document.getElementById('auth-submit-btn');
  const switchText = document.getElementById('auth-switch-text');
  const switchBtn = document.getElementById('btn-auth-switch');
  const errorMsg = document.getElementById('auth-error-msg');
  const form = document.getElementById('auth-form');

  if (!authModal) return;

  errorMsg.classList.add('hide');
  form.reset();

  if (show) {
    authModal.classList.remove('hide');
    authModal.dataset.mode = isRegisterMode ? 'signup' : 'signin';
    
    if (isRegisterMode) {
      title.textContent = 'Create Account';
      subtitle.textContent = 'Join AniFlow to manage your custom list';
      submitBtn.textContent = 'Sign Up';
      switchText.textContent = 'Already have an account?';
      switchBtn.textContent = 'Sign In';
    } else {
      title.textContent = 'Sign In';
      subtitle.textContent = 'Welcome back to AniFlow';
      submitBtn.textContent = 'Login';
      switchText.textContent = "Don't have an account?";
      switchBtn.textContent = 'Create Account';
    }
  } else {
    authModal.classList.add('hide');
  }
}

function registerUser(username, password) {
  const errorMsg = document.getElementById('auth-error-msg');
  
  if (username.length < 3) {
    showAuthError("Username must be at least 3 characters.");
    return;
  }
  if (password.length < 6) {
    showAuthError("Password must be at least 6 characters.");
    return;
  }

  const users = JSON.parse(localStorage.getItem('aniflow_users') || '[]');
  if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
    showAuthError("Username already exists.");
    return;
  }

  // Create new user
  const newUser = {
    username: username,
    password: password, // Simulated plain text for local sandboxed storage
    list: {} //MAL_ID -> { status, progress, rating, totalEpisodes, title, poster, type }
  };

  users.push(newUser);
  localStorage.setItem('aniflow_users', JSON.stringify(users));
  
  showToast("Account created! Please log in.", "success");
  toggleAuthModal(true, false); // Switch to login screen
}

function loginUser(username, password) {
  const users = JSON.parse(localStorage.getItem('aniflow_users') || '[]');
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase() && u.password === password);

  if (!user) {
    showAuthError("Incorrect username or password.");
    return;
  }

  state.currentUser = user;
  localStorage.setItem('aniflow_session', JSON.stringify({ username: user.username }));
  
  toggleAuthModal(false);
  updateHeaderAuthUI();
  showToast(`Welcome back, ${user.username}!`, "success");
  
  // Reload current views
  if (state.currentView === 'mylist') {
    renderMyList();
  } else {
    loadCatalog();
  }
}

function logoutUser() {
  localStorage.removeItem('aniflow_session');
  state.currentUser = null;
  updateHeaderAuthUI();
  showToast("Signed out successfully.", "info");
  switchView('browse');
}

function showAuthError(msg) {
  const errorMsg = document.getElementById('auth-error-msg');
  errorMsg.textContent = msg;
  errorMsg.classList.remove('hide');
}

// ==========================================================================
// 3. THEME TOGGLER
// ==========================================================================

function initTheme() {
  let theme = localStorage.getItem('aniflow_theme');
  if (!theme) {
    // Check system preference
    theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  document.documentElement.setAttribute('data-theme', theme);
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', nextTheme);
  localStorage.setItem('aniflow_theme', nextTheme);
  showToast(`Switched to ${nextTheme} mode.`, "info");
}

// ==========================================================================
// 4. EVENT LISTENERS
// ==========================================================================

function initEventListeners() {
  // Logo redirect to browse (also clears active search)
  document.getElementById('btn-logo').addEventListener('click', () => {
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = '';
    document.getElementById('search-clear-btn')?.classList.add('hide');
    if (state.isSearchMode) {
      state.searchQuery = '';
      state.isSearchMode = false;
      document.getElementById('featured-hero')?.classList.remove('search-result-hero');
    }
    if (state.currentView === 'detail') {
      closeAnimeDetailPage();
    } else {
      switchView('browse');
    }
  });

  initImdbHeader();

  // Nav actions
  document.getElementById('nav-btn-browse').addEventListener('click', () => {
    closeHeaderMenu();
    if (state.currentView === 'detail') {
      closeAnimeDetailPage();
    } else {
      switchView('browse');
    }
  });

  document.getElementById('nav-btn-mylist').addEventListener('click', () => {
    closeHeaderMenu();
    goToMyList();
  });

  document.getElementById('nav-btn-watchlist')?.addEventListener('click', () => {
    goToMyList();
  });

  // Theme toggle
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
  document.getElementById('btn-theme-menu')?.addEventListener('click', () => {
    toggleTheme();
    closeHeaderMenu();
  });

  // Auth modal switch
  document.getElementById('btn-auth-switch').addEventListener('click', () => {
    const mode = document.getElementById('auth-modal').dataset.mode;
    toggleAuthModal(true, mode === 'signin');
  });

  // Auth form submission
  document.getElementById('auth-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const username = document.getElementById('auth-username').value.trim();
    const password = document.getElementById('auth-password').value.trim();
    const mode = document.getElementById('auth-modal').dataset.mode;

    if (mode === 'signup') {
      registerUser(username, password);
    } else {
      loginUser(username, password);
    }
  });

  // Close modals
  document.getElementById('auth-modal-close').addEventListener('click', () => toggleAuthModal(false));
  document.getElementById('details-modal-close')?.addEventListener('click', () => toggleDetailsModal(false));
  document.getElementById('btn-detail-back')?.addEventListener('click', closeAnimeDetailPage);
  document.getElementById('page-save-watchlist')?.addEventListener('click', saveWatchlistState);
  document.getElementById('page-delete-watchlist')?.addEventListener('click', deleteWatchlistItem);
  document.getElementById('page-watchlist-toggle')?.addEventListener('click', () => {
    document.getElementById('page-watchlist-form')?.classList.toggle('hide');
  });
  document.getElementById('page-poster-bookmark')?.addEventListener('click', () => {
    document.getElementById('page-watchlist-form')?.classList.remove('hide');
    document.getElementById('page-watchlist-panel')?.scrollIntoView({ behavior: 'smooth' });
  });
  document.getElementById('page-jump-cast')?.addEventListener('click', () => {
    document.getElementById('cast-section')?.scrollIntoView({ behavior: 'smooth' });
  });
  document.getElementById('page-jump-recs')?.addEventListener('click', () => {
    document.getElementById('detail-recs-section')?.scrollIntoView({ behavior: 'smooth' });
  });
  document.getElementById('picks-scroll-next')?.addEventListener('click', () => {
    const track = document.getElementById('top-picks-track');
    if (track) track.scrollBy({ left: 520, behavior: 'smooth' });
  });
  document.getElementById('popular-scroll-next')?.addEventListener('click', () => {
    const track = document.getElementById('popular-anime-track');
    if (track) track.scrollBy({ left: 520, behavior: 'smooth' });
  });
  document.getElementById('top-picks-more')?.addEventListener('click', (e) => {
    e.preventDefault();
    scrollToCatalog();
  });

  // Search input — suggestions while typing; main grid updates on Enter or pick
  const searchInput = document.getElementById('search-input');
  const searchClear = document.getElementById('search-clear-btn');
  let suggestionDebounceTimeout = null;

  searchInput.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    if (val.length > 0) {
      searchClear.classList.remove('hide');
    } else {
      searchClear.classList.add('hide');
      clearSearchMode();
    }

    clearTimeout(suggestionDebounceTimeout);
    suggestionDebounceTimeout = setTimeout(() => {
      loadSearchSuggestions(val);
    }, 300);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = searchInput.value.trim();
      if (val.length > 0) {
        performSearch(val);
      }
    }
    if (e.key === 'Escape') {
      document.getElementById('search-suggestions').classList.add('hide');
      closeHeaderMenu();
      closeLangDropdown();
    }
  });

  document.getElementById('btn-search-submit')?.addEventListener('click', () => {
    const val = searchInput.value.trim();
    if (val.length > 0) {
      performSearch(val);
    }
  });

  document.getElementById('search-scope')?.addEventListener('change', (e) => {
    state.searchScope = e.target.value;
    if (state.isSearchMode && state.searchQuery) {
      performSearch(state.searchQuery, { silent: true });
    }
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.classList.add('hide');
    clearSearchMode();
  });

  // Filter changes (exit search mode — filters apply to browse catalog)
  document.getElementById('filter-type').addEventListener('change', (e) => {
    exitSearchForBrowse();
    state.filters.type = e.target.value;
    state.currentPage = 1;
    loadCatalog();
  });

  document.getElementById('filter-status').addEventListener('change', (e) => {
    exitSearchForBrowse();
    state.filters.status = e.target.value;
    state.currentPage = 1;
    loadCatalog();
  });

  document.getElementById('filter-sort').addEventListener('change', (e) => {
    exitSearchForBrowse();
    state.filters.sort = e.target.value;
    state.currentPage = 1;
    loadCatalog();
  });

  document.getElementById('btn-clear-filters').addEventListener('click', () => {
    document.getElementById('filter-type').value = '';
    document.getElementById('filter-status').value = '';
    document.getElementById('filter-sort').value = 'popularity';
    state.filters.type = '';
    state.filters.status = '';
    state.filters.sort = 'popularity';
    state.activeGenres.clear();
    
    // Uncheck all active genre pills
    document.querySelectorAll('.genre-pill.active').forEach(p => p.classList.remove('active'));
    
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = '';
    document.getElementById('search-clear-btn')?.classList.add('hide');
    state.searchQuery = '';
    state.isSearchMode = false;
    document.getElementById('featured-hero')?.classList.remove('search-result-hero');
    
    state.currentPage = 1;
    loadFeaturedAnime();
    loadCatalog();
    showToast("Filters and search reset.", "info");
  });

  // Toggle genre filters expansion
  document.getElementById('toggle-genres-btn').addEventListener('click', () => {
    const container = document.getElementById('genre-pills-list');
    const chevron = document.querySelector('#toggle-genres-btn .chevron-icon');
    container.classList.toggle('active');
    if (container.classList.contains('active')) {
      chevron.style.transform = 'rotate(0deg)';
      container.style.maxHeight = '250px';
    } else {
      chevron.style.transform = 'rotate(-90deg)';
      container.style.maxHeight = '0px';
    }
  });

  // Hero carousel controls
  initHeroCarouselControls();

  // Surprise me (Random Anime)
  document.getElementById('btn-random').addEventListener('click', handleRandomAnime);
  document.getElementById('btn-random-menu')?.addEventListener('click', () => {
    closeHeaderMenu();
    handleRandomAnime();
  });

  // Pagination buttons
  document.getElementById('btn-prev').addEventListener('click', () => {
    if (state.currentPage > 1) {
      state.currentPage--;
      loadCatalog();
      scrollToCatalog();
    }
  });

  document.getElementById('btn-next').addEventListener('click', () => {
    if (state.currentPage < state.totalPages) {
      state.currentPage++;
      loadCatalog();
      scrollToCatalog();
    }
  });

  // Watchlist Save changes
  document.getElementById('btn-save-watchlist-item')?.addEventListener('click', saveWatchlistState);
  document.getElementById('btn-delete-watchlist-item')?.addEventListener('click', deleteWatchlistItem);

  // Dynamic details tabs toggler
  document.querySelectorAll('.detail-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.detail-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.detail-tab-panel').forEach(p => p.classList.remove('active'));
      
      btn.classList.add('active');
      const panelId = `panel-${btn.dataset.tab}`;
      document.getElementById(panelId).classList.add('active');
    });
  });

  // My List Watchlist status filtering tabs
  document.querySelectorAll('[data-list-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('[data-list-tab]').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.mylistTab = tab.dataset.listTab;
      renderMyList();
    });
  });

  // Close modals on clicking backdrop overlay
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.add('hide');
      }
    });
  });
}

function goToMyList() {
  if (!state.currentUser) {
    showToast('Please sign in to view your watchlist.', 'warning');
    toggleAuthModal(true);
    return;
  }
  if (state.currentView === 'detail') {
    unloadDetailTrailer();
    history.pushState({ view: 'mylist' }, '', '#mylist');
  }
  switchView('mylist');
}

function switchView(viewName, options = {}) {
  if (state.currentView === 'detail' && viewName !== 'detail') {
    unloadDetailTrailer();
  }

  state.currentView = viewName;

  document.getElementById('nav-btn-browse')?.classList.toggle('active', viewName === 'browse');
  document.getElementById('nav-btn-mylist')?.classList.toggle('active', viewName === 'mylist');

  document.getElementById('view-browse').classList.toggle('active', viewName === 'browse');
  document.getElementById('view-mylist').classList.toggle('active', viewName === 'mylist');
  document.getElementById('view-detail')?.classList.toggle('active', viewName === 'detail');
  document.body.classList.toggle('detail-page-active', viewName === 'detail');

  if (viewName === 'mylist') {
    renderMyList();
  } else if (viewName === 'browse' && !options.skipCatalog) {
    loadCatalog();
  }
}

function initRouting() {
  window.addEventListener('popstate', (e) => {
    if (e.state?.view === 'detail' && e.state.malId) {
      switchView('detail', { skipCatalog: true });
      renderAnimeDetailPage(e.state.malId, { skipHistory: true });
    } else {
      const target = e.state?.view || 'browse';
      switchView(target, { skipCatalog: true });
    }
  });

  const hashMatch = location.hash.match(/^#anime\/(\d+)$/);
  if (hashMatch) {
    openAnimeDetailPage(parseInt(hashMatch[1], 10), { replaceHistory: true });
  }
}

function openAnimeDetailPage(malId, options = {}) {
  if (state.currentView !== 'detail') {
    state.previousView = state.currentView;
  }
  state.currentDetailId = malId;

  const hash = `#anime/${malId}`;
  if (!options.skipHistory) {
    if (options.replaceHistory) {
      history.replaceState({ view: 'detail', malId }, '', hash);
    } else {
      history.pushState({ view: 'detail', malId }, '', hash);
    }
  }

  switchView('detail', { skipCatalog: true });
  renderAnimeDetailPage(malId, options);
  if (options.scrollToTrailer) {
    // Small delay to let the DOM render before scrolling
    setTimeout(() => {
      const trailerWrap = document.getElementById('page-trailer-wrap');
      if (trailerWrap) {
        trailerWrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 300);
  } else {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function closeAnimeDetailPage() {
  unloadDetailTrailer();
  const prev = state.previousView || 'browse';
  const hash = prev === 'mylist' ? '#mylist' : '';
  history.pushState({ view: prev }, '', hash || window.location.pathname);
  switchView(prev);
}

function unloadDetailTrailer() {
  const frame = document.getElementById('page-trailer-iframe');
  if (frame) frame.src = '';
}

function scrollToCatalog() {
  const layout = document.querySelector('.catalog-layout');
  if (layout) {
    const yOffset = -80; // Margin below Sticky Header
    const y = layout.getBoundingClientRect().top + window.pageYOffset + yOffset;
    window.scrollTo({ top: y, behavior: 'smooth' });
  }
}

// ==========================================================================
// 5. TOAST NOTIFICATION UTILITIES
// ==========================================================================

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let iconName = 'info';
  if (type === 'success') iconName = 'check-circle';
  if (type === 'warning') iconName = 'alert-triangle';
  if (type === 'danger') iconName = 'x-circle';

  toast.innerHTML = `
    <div class="toast-icon"><i data-lucide="${iconName}"></i></div>
    <div class="toast-message">${escapeHTML(message)}</div>
  `;

  container.appendChild(toast);
  if (window.lucide) lucide.createIcons();

  // Auto remove toast after 3.5 seconds
  setTimeout(() => {
    toast.style.transform = 'translateX(120%)';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ==========================================================================
// 6. GENRES & FEATURED SLIDER LOADER
// ==========================================================================

async function loadGenres() {
  const container = document.getElementById('genre-pills-list');
  if (!container) return;

  try {
    const data = await fetchThrottled('https://api.jikan.moe/v4/genres/anime');
    state.genresList = data.data || FALLBACK_GENRES;
  } catch (err) {
    console.warn("Failed fetching genres from Jikan. Loading fallbacks.", err);
    state.genresList = FALLBACK_GENRES;
  }

  container.innerHTML = '';
  state.genresList.forEach(genre => {
    const pill = document.createElement('span');
    pill.className = 'genre-pill';
    pill.textContent = genre.name;
    pill.dataset.id = genre.mal_id;
    
    pill.addEventListener('click', () => {
      const id = parseInt(genre.mal_id);
      if (state.activeGenres.has(id)) {
        state.activeGenres.delete(id);
        pill.classList.remove('active');
      } else {
        state.activeGenres.add(id);
        pill.classList.add('active');
      }
      exitSearchForBrowse();
      const searchInput = document.getElementById('search-input');
      if (searchInput) searchInput.value = '';
      document.getElementById('search-clear-btn')?.classList.add('hide');
      state.currentPage = 1;
      loadCatalog();
    });

    container.appendChild(pill);
  });
}

const HERO_INTERVAL_MS = 5500;

async function loadFeaturedAnime() {
  stopHeroCarousel();

  try {
    const [airingRes, upcomingRes] = await Promise.all([
      fetchThrottled('https://api.jikan.moe/v4/seasons/now?limit=15'),
      fetchThrottled('https://api.jikan.moe/v4/top/anime?filter=upcoming&limit=10')
    ]);

    const slides = buildHeroSlides(airingRes.data || [], upcomingRes.data || []);

    if (slides.length === 0) {
      const fallback = await fetchThrottled('https://api.jikan.moe/v4/seasons/now?limit=8');
      const fallbackSlides = (fallback.data || []).filter(isHeroRelevantAnime);
      if (fallbackSlides.length > 0) {
        initHeroCarousel(fallbackSlides);
        return;
      }
      showHeroFallbackMessage();
      return;
    }

    initHeroCarousel(slides);
  } catch (err) {
    console.error('Failed loading hero carousel.', err);
    showHeroFallbackMessage();
  }
}

/** Merge top airing + upcoming; prefer 2025–2026 titles. */
function buildHeroSlides(airingList, upcomingList) {
  const seen = new Set();
  const merged = [];

  const add = (anime, kind) => {
    if (!anime?.mal_id || seen.has(anime.mal_id)) return;
    if (!isHeroRelevantAnime(anime)) return;
    seen.add(anime.mal_id);
    merged.push({ ...anime, _heroKind: kind });
  };

  airingList.forEach(a => add(a, 'airing'));
  upcomingList.forEach(a => add(a, 'upcoming'));

  return merged.slice(0, 18);
}

function isHeroRelevantAnime(anime) {
  const year = anime.year || anime.aired?.prop?.from?.year;
  const status = (anime.status || '').toLowerCase();
  const isCurrentStatus =
    status.includes('airing') || status.includes('upcoming') || status.includes('not yet');

  if (isCurrentStatus) return true;
  if (year && year >= 2025) return true;
  return !year;
}

function initHeroCarousel(slides) {
  slides.forEach(anime => {
    state.cache.animeDetails[anime.mal_id] = anime;
  });

  state.heroCarousel.slides = slides;
  state.heroCarousel.index = 0;
  state.cache.featuredAnime = slides[0];

  renderHeroDots();
  setHeroBackdropImmediate(slides[0], 'a');
  populateFeaturedHero(slides[0], { skipAnimation: true });
  startHeroCarousel();
}

function initHeroCarouselControls() {
  const hero = document.getElementById('featured-hero');
  const prevBtn = document.getElementById('hero-prev');
  const nextBtn = document.getElementById('hero-next');
  const dots = document.getElementById('hero-dots');

  if (!hero) return;

  prevBtn?.addEventListener('click', () => {
    goToHeroSlide(state.heroCarousel.index - 1, 'prev');
  });

  nextBtn?.addEventListener('click', () => {
    goToHeroSlide(state.heroCarousel.index + 1, 'next');
  });

  dots?.addEventListener('click', (e) => {
    const btn = e.target.closest('.hero-dot');
    if (!btn) return;
    const idx = parseInt(btn.dataset.index, 10);
    if (!Number.isNaN(idx)) {
      goToHeroSlide(idx);
    }
  });

  hero.addEventListener('mouseenter', () => {
    state.heroCarousel.isPaused = true;
    pauseHeroProgress();
  });

  hero.addEventListener('mouseleave', () => {
    if (state.isSearchMode || state.heroCarousel.slides.length <= 1) return;
    state.heroCarousel.isPaused = false;
    resetHeroCarouselTimer();
  });
}

function startHeroCarousel() {
  stopHeroCarousel();
  if (state.isSearchMode || state.heroCarousel.slides.length <= 1) return;

  state.heroCarousel.isPaused = false;
  resetHeroCarouselTimer();
}

function stopHeroCarousel() {
  if (state.heroCarousel.timerId) {
    clearInterval(state.heroCarousel.timerId);
    state.heroCarousel.timerId = null;
  }
  pauseHeroProgress();
}

function resetHeroCarouselTimer() {
  if (state.heroCarousel.timerId) {
    clearInterval(state.heroCarousel.timerId);
  }
  pauseHeroProgress();

  if (state.isSearchMode || state.heroCarousel.slides.length <= 1 || state.heroCarousel.isPaused) {
    return;
  }

  startHeroProgress();
  state.heroCarousel.timerId = setInterval(() => {
    if (!state.heroCarousel.isPaused && !state.heroCarousel.isTransitioning) {
      goToHeroSlide(state.heroCarousel.index + 1, 'next');
    }
  }, HERO_INTERVAL_MS);
}

function startHeroProgress() {
  pauseHeroProgress();
  const bar = document.getElementById('hero-progress-bar');
  if (!bar) return;

  state.heroCarousel.progressStart = performance.now();
  const tick = (now) => {
    const elapsed = now - state.heroCarousel.progressStart;
    const pct = Math.min(100, (elapsed / HERO_INTERVAL_MS) * 100);
    bar.style.width = `${pct}%`;
    if (pct < 100 && state.heroCarousel.progressRafId !== null) {
      state.heroCarousel.progressRafId = requestAnimationFrame(tick);
    }
  };
  bar.style.width = '0%';
  state.heroCarousel.progressRafId = requestAnimationFrame(tick);
}

function pauseHeroProgress() {
  if (state.heroCarousel.progressRafId) {
    cancelAnimationFrame(state.heroCarousel.progressRafId);
    state.heroCarousel.progressRafId = null;
  }
  const bar = document.getElementById('hero-progress-bar');
  if (bar) bar.style.width = '0%';
}

function goToHeroSlide(index, direction = 'next') {
  const slides = state.heroCarousel.slides;
  if (!slides.length || state.heroCarousel.isTransitioning) return;

  const len = slides.length;
  const nextIndex = ((index % len) + len) % len;
  if (nextIndex === state.heroCarousel.index) return;

  state.heroCarousel.isTransitioning = true;
  const content = document.getElementById('hero-slide-content');
  const poster = document.getElementById('hero-poster-accent');

  content?.classList.add('is-sliding-out');
  poster?.classList.add('hide');

  setTimeout(() => {
    state.heroCarousel.index = nextIndex;
    const anime = slides[nextIndex];
    state.cache.featuredAnime = anime;

    crossfadeHeroBackdrop(anime);
    populateFeaturedHero(anime, { skipAnimation: true });

    content?.classList.remove('is-sliding-out');
    content?.classList.add('is-sliding-in');

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        content?.classList.remove('is-sliding-in');
        poster?.classList.remove('hide');
        state.heroCarousel.isTransitioning = false;
        updateHeroDotsActive();
        if (!state.isSearchMode && !state.heroCarousel.isPaused) {
          resetHeroCarouselTimer();
        }
      });
    });
  }, 420);
}

function renderHeroDots() {
  const dots = document.getElementById('hero-dots');
  if (!dots) return;

  const slides = state.heroCarousel.slides;
  dots.innerHTML = '';

  if (slides.length <= 1) {
    dots.style.display = 'none';
    return;
  }

  dots.style.display = 'flex';
  slides.forEach((_, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `hero-dot${i === 0 ? ' active' : ''}`;
    btn.dataset.index = String(i);
    btn.setAttribute('aria-label', `Go to slide ${i + 1}`);
    dots.appendChild(btn);
  });
}

function updateHeroDotsActive() {
  document.querySelectorAll('.hero-dot').forEach((dot, i) => {
    dot.classList.toggle('active', i === state.heroCarousel.index);
  });
}

function setHeroBackdropImmediate(anime, layerKey) {
  const el = document.getElementById(layerKey === 'a' ? 'hero-backdrop-a' : 'hero-backdrop-b');
  const other = document.getElementById(layerKey === 'a' ? 'hero-backdrop-b' : 'hero-backdrop-a');
  const url = getHeroImageUrl(anime);
  if (el) el.style.backgroundImage = `url('${url}')`;
  el?.classList.add('is-active');
  other?.classList.remove('is-active');
  state.heroCarousel.activeBackdrop = layerKey;
}

function crossfadeHeroBackdrop(anime) {
  const nextKey = state.heroCarousel.activeBackdrop === 'a' ? 'b' : 'a';
  const nextEl = document.getElementById(nextKey === 'a' ? 'hero-backdrop-a' : 'hero-backdrop-b');
  const prevEl = document.getElementById(nextKey === 'a' ? 'hero-backdrop-b' : 'hero-backdrop-a');
  const url = getHeroImageUrl(anime);

  if (nextEl) nextEl.style.backgroundImage = `url('${url}')`;
  nextEl?.classList.add('is-active');
  prevEl?.classList.remove('is-active');
  state.heroCarousel.activeBackdrop = nextKey;
}

function getHeroImageUrl(anime) {
  return anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || '';
}

function getHeroBadgeLabel(anime) {
  if (state.isSearchMode) return 'Search Result';
  const kind = anime._heroKind;
  const status = (anime.status || '').toLowerCase();
  if (kind === 'upcoming' || status.includes('not yet')) return 'Coming Soon';
  return 'Airing Now';
}

function populateFeaturedHero(anime, options = {}) {
  const badgeEl = document.getElementById('hero-badge');
  const titleEl = document.getElementById('hero-title');
  const synopsisEl = document.getElementById('hero-synopsis');
  const typeEl = document.getElementById('hero-meta-type');
  const episodesEl = document.getElementById('hero-meta-episodes');
  const statusEl = document.getElementById('hero-meta-status');
  const scoreEl = document.getElementById('hero-meta-score');
  const genresEl = document.getElementById('hero-genres');
  const posterEl = document.getElementById('hero-poster-accent');
  const viewDetailsBtn = document.getElementById('hero-btn-details');
  const addWatchlistBtn = document.getElementById('hero-btn-add');

  if (!titleEl) return;

  if (badgeEl) badgeEl.textContent = getHeroBadgeLabel(anime);

  titleEl.textContent = anime.title_english || anime.title;
  synopsisEl.textContent = anime.synopsis || 'No synopsis available.';

  if (!options.skipAnimation) {
    setHeroBackdropImmediate(anime, state.heroCarousel.activeBackdrop);
  }

  const posterUrl = anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url;
  if (posterEl && posterUrl) {
    posterEl.src = posterUrl;
    posterEl.alt = anime.title_english || anime.title;
    posterEl.classList.remove('hide');
  }

  typeEl.textContent = anime.type || 'TV';
  episodesEl.textContent = anime.episodes ? `${anime.episodes} Ep` : 'N/A Ep';
  statusEl.textContent = anime.status || 'Unknown';
  scoreEl.textContent = anime.score ? `★ ${anime.score}` : '★ N/A';

  genresEl.innerHTML = '';
  (anime.genres || []).slice(0, 4).forEach(genre => {
    const tag = document.createElement('span');
    tag.className = 'genre-tag';
    tag.textContent = genre.name;
    genresEl.appendChild(tag);
  });

  viewDetailsBtn.onclick = () => openAnimeDetailPage(anime.mal_id);
  addWatchlistBtn.onclick = () => {
    if (!state.currentUser) {
      showToast('Please sign in to track anime lists.', 'warning');
      toggleAuthModal(true);
    } else {
      openWatchlistEditor(anime.mal_id);
    }
  };
}

function showHeroFallbackMessage() {
  document.getElementById('hero-title').textContent = 'Welcome to AniFlow';
  document.getElementById('hero-synopsis').textContent =
    'Search for anime or browse the catalog below.';
  document.getElementById('hero-dots').style.display = 'none';
}

// ==========================================================================
// 7. CATALOG LOAD & GRID POPULATOR
// ==========================================================================

function toggleBrowseSubviews() {
  const landingSections = document.getElementById('browse-landing-sections');
  const catalogLayout = document.querySelector('.catalog-layout');
  
  const hasActiveFilters = state.activeGenres.size > 0 || state.filters.type !== '' || state.filters.status !== '' || state.filters.sort !== 'popularity';
  const showCatalog = state.isSearchMode || hasActiveFilters;
  
  if (showCatalog) {
    landingSections?.classList.add('hide');
    catalogLayout?.classList.remove('hide');
  } else {
    landingSections?.classList.remove('hide');
    catalogLayout?.classList.add('hide');
  }
}

async function loadCatalog() {
  const grid = document.getElementById('anime-grid');
  if (!grid) return;

  toggleBrowseSubviews();

  // Committed search uses performSearch instead of the browse catalog endpoint
  if (state.isSearchMode && state.searchQuery) {
    await performSearch(state.searchQuery, { silent: true });
    return;
  }

  const hasActiveFilters = state.activeGenres.size > 0 || state.filters.type !== '' || state.filters.status !== '' || state.filters.sort !== 'popularity';
  if (!state.isSearchMode && !hasActiveFilters) {
    setPaginationVisibility(false);
    return;
  }

  renderGridSkeletons();
  setHeroVisibility(true);

  const { url, title } = getBrowseCatalogRequest();
  updateCatalogHeader(false, '', title);

  try {
    const data = await fetchThrottled(url);
    
    if (data.data && data.data.length > 0) {
      // Store in details cache
      data.data.forEach(item => {
        state.cache.animeDetails[item.mal_id] = item;
      });

      renderCatalogGrid(data.data);
      
      // Update pagination values
      state.totalPages = data.pagination.last_visible_page || 1;
      document.getElementById('page-num').textContent = `Page ${state.currentPage} of ${state.totalPages}`;
      document.getElementById('btn-prev').disabled = state.currentPage <= 1;
      document.getElementById('btn-next').disabled = state.currentPage >= state.totalPages;
      
      const totalCount = data.pagination.items.total || data.data.length;
      document.getElementById('results-count').textContent = `Showing ${data.data.length} of ${totalCount} results`;
      setPaginationVisibility(true);
    } else {
      renderEmptyCatalog();
    }
  } catch (err) {
    console.error("Failed executing catalog search query.", err);
    grid.innerHTML = `
      <div class="no-items-message" style="grid-column: 1 / -1;">
        <i data-lucide="alert-circle" style="color: var(--danger);"></i>
        <p>Failed to pull catalog data. Jikan API might be throttled. Please wait a second and hit Reset Filters!</p>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
  }
}

/**
 * Build the browse catalog API URL.
 * Default: MAL Top lists (popular / airing / rated). Genre/type filters use /anime with correct sort.
 */
function getBrowseCatalogRequest() {
  const page = state.currentPage;
  const limit = 24;
  const hasGenreFilter = state.activeGenres.size > 0;
  const hasTypeFilter = !!state.filters.type;
  const needsFilteredEndpoint =
    hasGenreFilter ||
    hasTypeFilter ||
    state.filters.status === 'complete' ||
    state.filters.sort === 'title' ||
    state.filters.sort === 'episodes';

  if (!needsFilteredEndpoint) {
    if (state.filters.sort === 'start_date') {
      return {
        url: `https://api.jikan.moe/v4/seasons/now?page=${page}&limit=${limit}`,
        title: 'Latest This Season'
      };
    }

    if (state.filters.sort === 'score') {
      return {
        url: `https://api.jikan.moe/v4/top/anime?page=${page}&limit=${limit}`,
        title: 'Highest Rated Anime'
      };
    }

    let filter = 'bypopularity';
    let title = 'Most Popular Anime';

    if (state.filters.status === 'airing') {
      filter = 'airing';
      title = 'Top Airing Now';
    } else if (state.filters.status === 'upcoming') {
      filter = 'upcoming';
      title = 'Upcoming Anime';
    }

    return {
      url: `https://api.jikan.moe/v4/top/anime?filter=${filter}&page=${page}&limit=${limit}`,
      title
    };
  }

  return {
    url: buildFilteredAnimeUrl(page, limit),
    title: hasGenreFilter || hasTypeFilter ? 'Filtered Anime' : 'Browse Results'
  };
}

/** Anime list endpoint when genre/type/status filters are active. */
function buildFilteredAnimeUrl(page, limit) {
  let queryParams = `page=${page}&limit=${limit}&sfw=true`;

  if (state.filters.type) {
    queryParams += `&type=${state.filters.type}`;
  }
  if (state.filters.status) {
    queryParams += `&status=${state.filters.status}`;
  }
  if (state.activeGenres.size > 0) {
    queryParams += `&genres=${Array.from(state.activeGenres).join(',')}`;
  }

  let order_by = 'popularity';
  // MAL popularity is a rank (1 = most popular) — ascending shows popular first
  let sort = 'asc';

  if (state.filters.sort === 'score') {
    order_by = 'score';
    sort = 'desc';
  } else if (state.filters.sort === 'title') {
    order_by = 'title';
    sort = 'asc';
  } else if (state.filters.sort === 'start_date') {
    order_by = 'start_date';
    sort = 'desc';
  } else if (state.filters.sort === 'episodes') {
    order_by = 'episodes';
    sort = 'desc';
  }

  queryParams += `&order_by=${order_by}&sort=${sort}`;
  return `https://api.jikan.moe/v4/anime?${queryParams}`;
}

function renderGridSkeletons() {
  const grid = document.getElementById('anime-grid');
  grid.innerHTML = '';
  for (let i = 0; i < 12; i++) {
    const skeleton = document.createElement('div');
    skeleton.className = 'skeleton-card';
    skeleton.innerHTML = `
      <div class="skeleton-poster"></div>
      <div class="skeleton-text title"></div>
      <div class="skeleton-text sub"></div>
    `;
    grid.appendChild(skeleton);
  }
}

function renderCatalogGrid(items) {
  const grid = document.getElementById('anime-grid');
  grid.innerHTML = '';

  items.forEach(anime => {
    const card = createImdbPickCard(anime);
    grid.appendChild(card);
  });

  if (window.lucide) lucide.createIcons();
}

function renderEmptyCatalog() {
  const grid = document.getElementById('anime-grid');
  grid.innerHTML = `
    <div class="no-items-message" style="grid-column: 1 / -1;">
      <i data-lucide="inbox"></i>
      <p>No results match your search keywords or filter pills. Try another query!</p>
    </div>
  `;
  document.getElementById('results-count').textContent = 'Showing 0 results';
  if (window.lucide) lucide.createIcons();
}

// ==========================================================================
// 8. INTERACTIVE HOVER BOX (TOOLTIP) LOGIC
// ==========================================================================

let hoverTimer = null;

function bindHoverTooltip(cardElement, malId) {
  const tooltip = document.getElementById('hover-tooltip');
  
  cardElement.addEventListener('mouseenter', (e) => {
    // Clear any pending triggers
    clearTimeout(hoverTimer);
    
    // Add small delay to avoid popups when user is scrolling quickly
    hoverTimer = setTimeout(() => {
      const anime = state.cache.animeDetails[malId];
      if (!anime) return;
      
      populateHoverTooltip(anime);
      positionHoverTooltip(cardElement);
      tooltip.classList.add('active');
    }, 450);
  });

  cardElement.addEventListener('mouseleave', () => {
    clearTimeout(hoverTimer);
    tooltip.classList.remove('active');
  });
}

function populateHoverTooltip(anime) {
  const title = document.getElementById('tooltip-title');
  const score = document.getElementById('tooltip-score-val');
  const studio = document.getElementById('tooltip-studio');
  const type = document.getElementById('tooltip-type');
  const year = document.getElementById('tooltip-year');
  const synopsis = document.getElementById('tooltip-synopsis');
  const genresContainer = document.getElementById('tooltip-genres');
  const status = document.getElementById('tooltip-status');
  const episodes = document.getElementById('tooltip-episodes');

  title.textContent = anime.title_english || anime.title;
  score.textContent = anime.score ? anime.score.toFixed(1) : 'N/A';
  
  // Find studio
  const studioName = (anime.studios && anime.studios.length > 0) ? anime.studios[0].name : 'N/A';
  studio.textContent = studioName;

  type.textContent = anime.type || 'TV';
  year.textContent = anime.year || (anime.aired && anime.aired.prop && anime.aired.prop.from.year) || 'N/A';
  synopsis.textContent = anime.synopsis || "No description provided.";
  
  genresContainer.innerHTML = '';
  (anime.genres || []).slice(0, 3).forEach(genre => {
    const pill = document.createElement('span');
    pill.className = 'tooltip-genre-pill';
    pill.textContent = genre.name;
    genresContainer.appendChild(pill);
  });

  status.textContent = anime.status || 'Unknown';
  episodes.textContent = anime.episodes ? `${anime.episodes} Episodes` : 'Episode count N/A';
}

function positionHoverTooltip(card) {
  const tooltip = document.getElementById('hover-tooltip');
  const cardRect = card.getBoundingClientRect();
  
  const tooltipWidth = 320;
  const padding = 15;
  
  let left = cardRect.right + padding;
  // If the box goes beyond the right viewport edge, flip it to show on the left of the card
  if (left + tooltipWidth > window.innerWidth) {
    left = cardRect.left - tooltipWidth - padding;
  }
  
  // Vertical positioning: try to center it aligned with the card
  let top = cardRect.top + (cardRect.height / 2) - (tooltip.offsetHeight / 2);
  
  // Prevent clipping off top/bottom window edges
  if (top < padding) {
    top = padding;
  } else if (top + tooltip.offsetHeight > window.innerHeight - padding) {
    top = window.innerHeight - tooltip.offsetHeight - padding;
  }
  
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

// ==========================================================================
// 9. ANIME DETAIL PAGE (IMDb-style, same window)
// ==========================================================================

async function showAnimeDetails(malId) {
  openAnimeDetailPage(malId);
}

async function renderAnimeDetailPage(malId) {
  let anime = state.cache.animeDetails[malId];
  if (!anime) {
    try {
      const data = await fetchThrottled(`https://api.jikan.moe/v4/anime/${malId}`);
      anime = data.data;
      state.cache.animeDetails[malId] = anime;
    } catch (err) {
      showToast('Could not load anime details.', 'danger');
      closeAnimeDetailPage();
      return;
    }
  }

  activeDetailAnime = anime;
  const title = anime.title_english || anime.title;
  const year = anime.year || anime.aired?.prop?.from?.year || 'N/A';
  const type = anime.type || 'TV';
  const eps = anime.episodes ? `${anime.episodes} eps` : 'N/A eps';
  const duration = anime.duration ? ` · ${anime.duration}` : '';

  document.getElementById('page-title-main').textContent = title;
  document.getElementById('page-title-meta').textContent =
    `${year} · ${type} · ${eps}${duration}`;

  document.getElementById('page-score-val').textContent =
    anime.score ? anime.score.toFixed(1) : 'N/A';
  document.getElementById('page-score-votes').textContent =
    anime.scored_by ? `${(anime.scored_by / 1000).toFixed(0)}K ratings` : '—';
  document.getElementById('page-rank-val').textContent =
    anime.popularity ? `#${anime.popularity}` : '—';

  const posterUrl = anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url;
  document.getElementById('page-poster').src = posterUrl;
  document.getElementById('page-poster').alt = title;

  const trailerFrame = document.getElementById('page-trailer-iframe');
  const trailerPlaceholder = document.getElementById('page-trailer-placeholder');
  const youtubeId = anime.trailer?.youtube_id;
  
  if (youtubeId) {
    // Always build a clean embed URL from youtube_id.
    // Jikan's embed_url contains enablejsapi=1&wl=myanimelist.net which causes
    // Error 153 ("Video player configuration error") on other domains.
    const cleanEmbedUrl = `https://www.youtube.com/embed/${youtubeId}?autoplay=1&mute=1&rel=0`;
    trailerFrame.src = cleanEmbedUrl;
    trailerFrame.classList.remove('hide');
    trailerPlaceholder.classList.add('hide');
  } else {
    trailerFrame.src = '';
    trailerFrame.classList.add('hide');
    trailerPlaceholder.classList.remove('hide');
  }

  // Update YouTube direct trailer link facts item
  const trailerLinkContainer = document.getElementById('page-trailer-link-container');
  const trailerLink = document.getElementById('page-trailer-link');
  const youtubeUrl = anime.trailer?.url || (youtubeId ? `https://www.youtube.com/watch?v=${youtubeId}` : null);

  if (youtubeUrl) {
    if (trailerLink) trailerLink.href = youtubeUrl;
    trailerLinkContainer?.classList.remove('hide');
  } else {
    trailerLinkContainer?.classList.add('hide');
  }

  const genresEl = document.getElementById('page-genres');
  genresEl.innerHTML = '';
  (anime.genres || []).forEach(g => {
    const pill = document.createElement('span');
    pill.className = 'title-genre-pill';
    pill.textContent = g.name;
    genresEl.appendChild(pill);
  });

  document.getElementById('page-synopsis').textContent =
    anime.synopsis || 'No synopsis available.';
  document.getElementById('page-studio').textContent =
    anime.studios?.[0]?.name || 'N/A';
  document.getElementById('page-aired').textContent =
    anime.aired?.string || 'N/A';
  document.getElementById('page-status').textContent = anime.status || 'N/A';

  initPageWatchlistEditor(anime);
  loadPageCast(malId);
  loadPageRecommendations(malId);

  if (window.lucide) lucide.createIcons();
}

function toggleDetailsModal(show) {
  const modal = document.getElementById('details-modal');
  if (!modal) return;
  if (show) {
    modal.classList.remove('hide');
    document.body.style.overflow = 'hidden';
  } else {
    modal.classList.add('hide');
    document.body.style.overflow = '';
    const frame = document.getElementById('modal-trailer-iframe');
    if (frame) frame.src = '';
  }
}

async function loadPageCast(malId) {
  const container = document.getElementById('page-cast-grid');
  container.innerHTML = '<div class="genre-loading">Loading cast...</div>';

  let data = state.cache.animeCharacters[malId];
  if (!data) {
    try {
      const resp = await fetchThrottled(`https://api.jikan.moe/v4/anime/${malId}/characters`);
      data = resp.data || [];
      state.cache.animeCharacters[malId] = data;
    } catch (err) {
      container.innerHTML = '<div class="genre-loading">Failed to load cast.</div>';
      return;
    }
  }

  document.getElementById('page-cast-count').textContent = String(data.length);
  document.getElementById('page-char-count').textContent = String(data.length);

  container.innerHTML = '';
  if (data.length === 0) {
    container.innerHTML = '<div class="genre-loading">No cast listed.</div>';
    return;
  }

  data.slice(0, 24).forEach(role => {
    const jaVa = (role.voice_actors || []).find(va => va.language === 'Japanese');
    const avatarUrl = jaVa?.person?.images?.jpg?.image_url
      || role.character?.images?.jpg?.image_url
      || '';

    const row = document.createElement('div');
    row.className = 'cast-member';
    row.innerHTML = `
      <div class="cast-avatar-wrap">
        <img class="cast-avatar" src="${avatarUrl}" alt="" loading="lazy">
        <span class="cast-add-btn">+</span>
      </div>
      <div>
        <div class="cast-name">${escapeHTML(jaVa ? jaVa.person.name : role.character.name)}</div>
        <div class="cast-role">${escapeHTML(jaVa ? role.character.name : role.role)}</div>
      </div>
    `;
    container.appendChild(row);
  });
}

async function loadPageRecommendations(malId) {
  const track = document.getElementById('page-recs-track');
  track.innerHTML = '<div class="genre-loading">Loading...</div>';

  let data = state.cache.animeRecommendations[malId];
  if (!data) {
    try {
      const resp = await fetchThrottled(`https://api.jikan.moe/v4/anime/${malId}/recommendations`);
      data = resp.data || [];
      state.cache.animeRecommendations[malId] = data;
    } catch (err) {
      track.innerHTML = '<div class="genre-loading">Failed to load recommendations.</div>';
      return;
    }
  }

  track.innerHTML = '';
  if (data.length === 0) {
    track.innerHTML = '<div class="genre-loading">No recommendations.</div>';
    return;
  }

  data.slice(0, 12).forEach(rec => {
    track.appendChild(createImdbPickCard(rec.entry));
  });

  if (window.lucide) lucide.createIcons();
}

// ==========================================================================
// TOP PICKS — IMDb-style horizontal row
// ==========================================================================

async function loadTopPicks() {
  const track = document.getElementById('top-picks-track');
  if (!track) return;

  try {
    const data = await fetchThrottled(
      'https://api.jikan.moe/v4/top/anime?filter=favorite&limit=14'
    );
    const items = data.data || [];
    items.forEach(a => {
      state.cache.animeDetails[a.mal_id] = a;
    });
    renderTopPicksRow(items);
  } catch (err) {
    track.innerHTML = '<div class="genre-loading">Could not load top picks.</div>';
  }
}

function renderTopPicksRow(items) {
  const track = document.getElementById('top-picks-track');
  if (!track) return;
  track.innerHTML = '';
  items.forEach(anime => {
    track.appendChild(createImdbPickCard(anime));
  });
  if (window.lucide) lucide.createIcons();
}

function createImdbPickCard(anime) {
  const card = document.createElement('article');
  card.className = 'imdb-pick-card';
  const title = anime.title_english || anime.title;
  const score = anime.score ? anime.score.toFixed(1) : 'N/A';
  const youtubeId = anime.trailer?.youtube_id;
  const hasTrailer = !!(youtubeId || anime.trailer?.embed_url || anime.trailer?.url);

  card.innerHTML = `
    <div class="pick-poster-wrap">
      <button type="button" class="pick-bookmark" data-action="bookmark" title="Open details">
        <i data-lucide="plus"></i>
      </button>
      <img src="${anime.images?.jpg?.image_url || ''}" alt="${escapeHTML(title)}" loading="lazy">
    </div>
    <div class="pick-rating-row">
      <i data-lucide="star" class="star-filled"></i>
      <span>${score}</span>
    </div>
    <h3 class="pick-title">${escapeHTML(title)}</h3>
    <button type="button" class="pick-watchlist-btn" data-action="watchlist">
      <i data-lucide="plus"></i> Watchlist
    </button>
    <div class="pick-card-footer">
      ${hasTrailer ? `<button type="button" class="pick-trailer-link" data-action="trailer"><i data-lucide="play"></i> Trailer</button>` : '<span></span>'}
      <button type="button" class="pick-info-btn" data-action="info" title="Details">i</button>
    </div>
  `;

  card.querySelector('.pick-poster-wrap').addEventListener('click', () => {
    openAnimeDetailPage(anime.mal_id);
  });
  card.querySelector('.pick-title').addEventListener('click', () => {
    openAnimeDetailPage(anime.mal_id);
  });
  card.querySelector('[data-action="info"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openAnimeDetailPage(anime.mal_id);
  });
  card.querySelector('[data-action="bookmark"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openAnimeDetailPage(anime.mal_id);
  });
  card.querySelector('[data-action="watchlist"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!state.currentUser) {
      showToast('Please sign in to use your watchlist.', 'warning');
      toggleAuthModal(true);
    } else {
      openAnimeDetailPage(anime.mal_id);
    }
  });
  card.querySelector('[data-action="trailer"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    // Navigate to the detail page and auto-scroll to the trailer
    openAnimeDetailPage(anime.mal_id, { scrollToTrailer: true });
  });

  // Bind tooltip hover box triggers
  bindHoverTooltip(card, anime.mal_id);

  return card;
}

// ==========================================================================
// POPULAR ANIME — IMDb-style horizontal row
// ==========================================================================

async function loadPopularAnime() {
  const track = document.getElementById('popular-anime-track');
  if (!track) return;

  try {
    const data = await fetchThrottled(
      'https://api.jikan.moe/v4/top/anime?filter=bypopularity&page=2&limit=14'
    );
    const items = data.data || [];
    items.forEach(a => {
      state.cache.animeDetails[a.mal_id] = a;
    });
    renderPopularAnimeRow(items);
  } catch (err) {
    track.innerHTML = '<div class="genre-loading">Could not load popular anime.</div>';
  }
}

function renderPopularAnimeRow(items) {
  const track = document.getElementById('popular-anime-track');
  if (!track) return;
  track.innerHTML = '';
  items.forEach(anime => {
    track.appendChild(createImdbPickCard(anime));
  });
  if (window.lucide) lucide.createIcons();
}

// ==========================================================================
// TOP 10 WEEK — Custom layout (ranks 1-3 wide, ranks 4-10 vertical)
// ==========================================================================

async function loadTop10Week() {
  const container = document.getElementById('top-10-container');
  if (!container) return;

  try {
    const data = await fetchThrottled(
      'https://api.jikan.moe/v4/top/anime?filter=airing&limit=10&min_score=7'
    );
    const items = data.data || [];
    items.forEach(a => {
      state.cache.animeDetails[a.mal_id] = a;
    });
    renderTop10(items);
  } catch (err) {
    container.innerHTML = '<div class="genre-loading">Could not load Top 10.</div>';
  }
}

function createTop10WideCard(anime, rank) {
  const card = document.createElement('div');
  card.className = 'top-10-wide-card';
  const title = anime.title_english || anime.title;
  const score = anime.score ? anime.score.toFixed(1) : 'N/A';
  const year = anime.year || anime.aired?.prop?.from?.year || 'N/A';
  const type = anime.type || 'TV';
  const episodes = anime.episodes ? `${anime.episodes} eps` : 'N/A eps';
  const synopsis = anime.synopsis || 'No description available.';
  const youtubeId = anime.trailer?.youtube_id;

  card.innerHTML = `
    <div class="wide-poster-wrap">
      <button type="button" class="wide-bookmark" data-action="bookmark" title="Open details">
        <i data-lucide="plus"></i>
      </button>
      <img src="${anime.images?.jpg?.image_url || ''}" alt="${escapeHTML(title)}" loading="lazy">
    </div>
    <div class="wide-info">
      <div class="wide-header-row">
        <div class="wide-rank-ribbon">#${rank}</div>
      </div>
      <h3 class="wide-title">${escapeHTML(title)}</h3>
      <div class="wide-meta">
        <span>${year}</span>
        <span>•</span>
        <span>${type}</span>
        <span>•</span>
        <span>${episodes}</span>
      </div>
      <div class="wide-rating-row">
        <i data-lucide="star" class="star-filled"></i>
        <span>${score}</span>
        <button class="rate-btn" data-action="rate"><i data-lucide="star" style="width:12px; height:12px;"></i> Rate</button>
      </div>
      <button type="button" class="wide-watchlist-btn" data-action="watchlist">
        <i data-lucide="plus"></i> Watchlist
      </button>
      <p class="wide-desc">${escapeHTML(synopsis)}</p>
    </div>
  `;

  card.querySelector('.wide-poster-wrap').addEventListener('click', () => {
    openAnimeDetailPage(anime.mal_id);
  });
  card.querySelector('.wide-title').addEventListener('click', () => {
    openAnimeDetailPage(anime.mal_id);
  });
  card.querySelector('[data-action="bookmark"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openAnimeDetailPage(anime.mal_id);
  });
  card.querySelector('[data-action="watchlist"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!state.currentUser) {
      showToast('Please sign in to use your watchlist.', 'warning');
      toggleAuthModal(true);
    } else {
      openAnimeDetailPage(anime.mal_id);
    }
  });
  card.querySelector('[data-action="rate"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openAnimeDetailPage(anime.mal_id);
  });

  // Bind tooltip hover box triggers
  bindHoverTooltip(card, anime.mal_id);

  return card;
}

function createTop10VerticalCard(anime, rank) {
  const card = document.createElement('div');
  card.className = 'top-10-vertical-card';
  const title = anime.title_english || anime.title;
  const score = anime.score ? anime.score.toFixed(1) : 'N/A';

  card.innerHTML = `
    <div class="vertical-poster-wrap">
      <div class="vertical-rank-ribbon">#${rank}</div>
      <img src="${anime.images?.jpg?.image_url || ''}" alt="${escapeHTML(title)}" loading="lazy">
    </div>
    <div class="vertical-rating-row">
      <i data-lucide="star" class="star-filled"></i>
      <span>${score}</span>
    </div>
    <h4 class="vertical-title">${escapeHTML(title)}</h4>
  `;

  card.addEventListener('click', () => {
    openAnimeDetailPage(anime.mal_id);
  });

  // Bind tooltip hover box triggers
  bindHoverTooltip(card, anime.mal_id);

  return card;
}

function renderTop10(items) {
  const container = document.getElementById('top-10-container');
  if (!container) return;
  container.innerHTML = '';

  if (items.length === 0) {
    container.innerHTML = '<div class="genre-loading">No entries.</div>';
    return;
  }

  // Ranks 1-3
  const topRow = document.createElement('div');
  topRow.className = 'top-10-row-top';
  items.slice(0, 3).forEach((anime, idx) => {
    topRow.appendChild(createTop10WideCard(anime, idx + 1));
  });
  container.appendChild(topRow);

  // Ranks 4-10
  if (items.length > 3) {
    const bottomRow = document.createElement('div');
    bottomRow.className = 'top-10-row-bottom';
    items.slice(3, 10).forEach((anime, idx) => {
      bottomRow.appendChild(createTop10VerticalCard(anime, idx + 4));
    });
    container.appendChild(bottomRow);
  }

  if (window.lucide) lucide.createIcons();
}

async function handleRandomAnime() {
  showToast("Fetching a surprise title...", "info");
  try {
    const data = await fetchThrottled('https://api.jikan.moe/v4/random/anime');
    const anime = data.data;
    if (anime) {
      state.cache.animeDetails[anime.mal_id] = anime;
      showAnimeDetails(anime.mal_id);
    }
  } catch (err) {
    showToast("Failed to fetch random anime. Try again.", "danger");
  }
}

// ==========================================================================
// 10. WATCHLIST WRITER & DASHBOARD RENDER
// ==========================================================================

let activeDetailAnime = null;

function initPageWatchlistEditor(anime) {
  activeDetailAnime = anime;
  const statusSelect = document.getElementById('page-list-status');
  const progressRow = document.getElementById('page-watchlist-progress-row');
  const progressInput = document.getElementById('page-progress-episodes');
  const progressTotal = document.getElementById('page-progress-total');
  const ratingSelect = document.getElementById('page-progress-rating');
  const deleteBtn = document.getElementById('page-delete-watchlist');
  const form = document.getElementById('page-watchlist-form');
  const toggleBtn = document.getElementById('page-watchlist-toggle');

  if (!state.currentUser) {
    statusSelect.value = '';
    statusSelect.disabled = true;
    progressRow.classList.add('hide');
    deleteBtn.classList.add('hide');
    form.classList.add('hide');
    toggleBtn.innerHTML = '<i data-lucide="plus"></i><span>Sign in to add</span>';
    toggleBtn.onclick = () => toggleAuthModal(true);
    if (window.lucide) lucide.createIcons();
    return;
  }

  statusSelect.disabled = false;
  toggleBtn.onclick = () => form.classList.toggle('hide');

  const item = state.currentUser.list[anime.mal_id];
  if (item) {
    statusSelect.value = item.status;
    progressRow.classList.remove('hide');
    progressInput.value = item.progress;
    progressTotal.textContent = anime.episodes || '?';
    progressInput.max = anime.episodes || 9999;
    ratingSelect.value = item.my_rating || 0;
    deleteBtn.classList.remove('hide');
    toggleBtn.innerHTML = '<i data-lucide="check"></i><span>On your list</span>';
    form.classList.remove('hide');
  } else {
    statusSelect.value = '';
    progressRow.classList.add('hide');
    deleteBtn.classList.add('hide');
    toggleBtn.innerHTML = '<i data-lucide="plus"></i><span>Add to Watchlist</span>';
    form.classList.add('hide');
  }

  statusSelect.onchange = (e) => {
    if (e.target.value !== '') {
      progressRow.classList.remove('hide');
      progressTotal.textContent = anime.episodes || '?';
      progressInput.max = anime.episodes || 9999;
      if (!progressInput.value || progressInput.value === '0') {
        progressInput.value =
          e.target.value === 'completed' && anime.episodes ? anime.episodes : 0;
      }
    } else {
      progressRow.classList.add('hide');
    }
  };

  if (window.lucide) lucide.createIcons();
}

function openWatchlistEditor(malId) {
  openAnimeDetailPage(malId);
  setTimeout(() => {
    document.getElementById('page-watchlist-form')?.classList.remove('hide');
    document.getElementById('page-watchlist-panel')?.scrollIntoView({ behavior: 'smooth' });
  }, 400);
}

function saveWatchlistState() {
  if (!state.currentUser || !activeDetailAnime) return;

  const statusSelect = document.getElementById('page-list-status');
  const progressInput = document.getElementById('page-progress-episodes');
  const ratingSelect = document.getElementById('page-progress-rating');

  const status = statusSelect.value;
  if (!status) {
    showToast("Please choose a watch status first.", "warning");
    return;
  }

  let progress = parseInt(progressInput.value) || 0;
  if (progress < 0) progress = 0;
  
  const totalEps = activeDetailAnime.episodes;
  if (totalEps && progress > totalEps) {
    progress = totalEps;
  }

  const rating = parseInt(ratingSelect.value) || 0;

  state.currentUser.list[activeDetailAnime.mal_id] = {
    mal_id: activeDetailAnime.mal_id,
    title: activeDetailAnime.title_english || activeDetailAnime.title,
    poster: activeDetailAnime.images.jpg.image_url,
    type: activeDetailAnime.type || 'TV',
    total_episodes: totalEps || 0,
    status: status,
    progress: progress,
    my_rating: rating,
    updatedAt: Date.now()
  };

  syncUserDatabase();
  showToast(`Saved: ${activeDetailAnime.title_english || activeDetailAnime.title}`, 'success');

  initPageWatchlistEditor(activeDetailAnime);

  if (state.currentView === 'mylist') {
    renderMyList();
  } else if (state.currentView === 'browse') {
    loadCatalog();
    loadTopPicks();
  }
}

function deleteWatchlistItem() {
  if (!state.currentUser || !activeDetailAnime) return;

  if (state.currentUser.list[activeDetailAnime.mal_id]) {
    delete state.currentUser.list[activeDetailAnime.mal_id];
    syncUserDatabase();
    showToast('Removed from list.', 'info');
  }

  initPageWatchlistEditor(activeDetailAnime);

  if (state.currentView === 'mylist') {
    renderMyList();
  } else if (state.currentView === 'browse') {
    loadCatalog();
    loadTopPicks();
  }
}

function syncUserDatabase() {
  if (!state.currentUser) return;
  
  const users = JSON.parse(localStorage.getItem('aniflow_users') || '[]');
  const index = users.findIndex(u => u.username.toLowerCase() === state.currentUser.username.toLowerCase());
  
  if (index !== -1) {
    users[index].list = state.currentUser.list;
    localStorage.setItem('aniflow_users', JSON.stringify(users));
    // Update session state
    localStorage.setItem('aniflow_session', JSON.stringify({ username: state.currentUser.username }));
  }
}

function renderMyList() {
  const container = document.getElementById('mylist-items-container');
  const totalCountEl = document.getElementById('stat-total-count');
  const epsCountEl = document.getElementById('stat-episodes-count');
  const avgScoreEl = document.getElementById('stat-avg-score');
  const usernameEl = document.getElementById('mylist-username');
  const avatarEl = document.getElementById('mylist-avatar');

  if (!state.currentUser) return;

  usernameEl.textContent = state.currentUser.username;
  avatarEl.textContent = state.currentUser.username.charAt(0);

  // Compute profile statistics
  const listItems = Object.values(state.currentUser.list);
  const totalCount = listItems.length;
  
  let totalEps = 0;
  let ratedCount = 0;
  let scoreSum = 0;
  
  listItems.forEach(item => {
    totalEps += (item.progress || 0);
    if (item.my_rating && item.my_rating > 0) {
      ratedCount++;
      scoreSum += item.my_rating;
    }
  });

  const avgScore = ratedCount > 0 ? (scoreSum / ratedCount).toFixed(1) : '0.0';

  totalCountEl.textContent = totalCount;
  epsCountEl.textContent = totalEps;
  avgScoreEl.textContent = avgScore;

  // Filter items matching active dashboard tab
  let filteredItems = listItems;
  if (state.mylistTab !== 'all') {
    filteredItems = listItems.filter(item => item.status === state.mylistTab);
  }

  // Sort list entries by updatedAt desc
  filteredItems.sort((a, b) => b.updatedAt - a.updatedAt);

  container.innerHTML = '';
  if (filteredItems.length === 0) {
    container.innerHTML = `
      <div class="no-items-message">
        <i data-lucide="inbox"></i>
        <p>No items found in category "${state.mylistTab}".</p>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  filteredItems.forEach(item => {
    const row = document.createElement('div');
    row.className = 'mylist-item-row';
    row.innerHTML = `
      <div class="mylist-item-title-col">
        <img class="mylist-item-poster" src="${item.poster}" alt="${item.title}" loading="lazy">
        <div class="mylist-item-title-info">
          <span class="mylist-item-title">${escapeHTML(item.title)}</span>
          <span class="mylist-item-meta">${item.type}</span>
        </div>
      </div>
      
      <div class="progress-tracker">
        <button class="progress-tracker-btn" data-action="decrement"><i data-lucide="minus" style="width:14px; height:14px;"></i></button>
        <span class="progress-nums">${item.progress} / ${item.total_episodes || '?'}</span>
        <button class="progress-tracker-btn" data-action="increment"><i data-lucide="plus" style="width:14px; height:14px;"></i></button>
      </div>

      <div class="grid-center font-bold text-accent">
        ${item.my_rating ? `★ ${item.my_rating}` : '—'}
      </div>

      <div class="watchlist-row-status">
        <span class="status-indicator-tag status-${item.status}">
          <span class="tab-dot dot-${item.status}"></span>
          ${item.status}
        </span>
      </div>

      <div class="row-actions-group">
        <button class="row-action-btn" data-action="edit" title="Edit State"><i data-lucide="edit-3" style="width:16px; height:16px;"></i></button>
        <button class="row-action-btn btn-delete-row" data-action="delete" title="Delete"><i data-lucide="trash" style="width:16px; height:16px;"></i></button>
      </div>
    `;

    // Row Click Details Overlay trigger
    row.querySelector('.mylist-item-title-col').onclick = () => showAnimeDetails(item.mal_id);

    // Watchlist decrement action
    row.querySelector('[data-action="decrement"]').onclick = (e) => {
      e.stopPropagation();
      if (item.progress > 0) {
        item.progress--;
        item.updatedAt = Date.now();
        syncUserDatabase();
        renderMyList();
      }
    };

    // Watchlist increment action
    row.querySelector('[data-action="increment"]').onclick = (e) => {
      e.stopPropagation();
      if (!item.total_episodes || item.progress < item.total_episodes) {
        item.progress++;
        // If they reach total eps, automatically tag completed
        if (item.total_episodes && item.progress === item.total_episodes) {
          item.status = 'completed';
        }
        item.updatedAt = Date.now();
        syncUserDatabase();
        renderMyList();
      } else {
        showToast("Maximum episodes reached.", "warning");
      }
    };

    // Edit watchlist row click
    row.querySelector('[data-action="edit"]').onclick = (e) => {
      e.stopPropagation();
      showAnimeDetails(item.mal_id);
    };

    // Row delete click
    row.querySelector('[data-action="delete"]').onclick = (e) => {
      e.stopPropagation();
      if (confirm(`Remove "${item.title}" from your watchlist?`)) {
        delete state.currentUser.list[item.mal_id];
        syncUserDatabase();
        showToast("Removed from watchlist.", "info");
        renderMyList();
      }
    };

    container.appendChild(row);
  });

  if (window.lucide) lucide.createIcons();
}

// ==========================================================================
// 11. SEARCH — COMMIT TO MAIN SCREEN (ENTER / SUGGESTION PICK)
// ==========================================================================

/**
 * Commit a search: show only relevant matches on the main grid (not the dropdown).
 */
async function performSearch(query, options = {}) {
  const { silent = false } = options;
  const trimmed = query.trim();
  if (!trimmed) return;

  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = trimmed;

  state.searchQuery = trimmed;
  state.isSearchMode = true;
  state.currentPage = 1;

  toggleBrowseSubviews();

  document.getElementById('search-suggestions').classList.add('hide');
  document.getElementById('search-clear-btn').classList.remove('hide');

  if (!silent) {
    renderGridSkeletons();
    updateCatalogHeader(true, trimmed);
    setHeroVisibility(false);
    setPaginationVisibility(false);
    scrollToCatalog();
  }

  try {
    let searchUrl = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(trimmed)}&limit=25&sfw=true`;
    if (state.searchScope === 'airing') {
      searchUrl += '&status=airing';
    } else if (state.searchScope === 'upcoming') {
      searchUrl += '&status=upcoming';
    }
    const data = await fetchThrottled(searchUrl);
    const rawItems = data.data || [];
    const ranked = filterSearchResults(rawItems, trimmed);
    const filtered = pickSearchDisplayItems(ranked, trimmed);

    if (filtered.length > 0) {
      filtered.forEach(item => {
        state.cache.animeDetails[item.mal_id] = item;
      });

      renderCatalogGrid(filtered);
      document.getElementById('results-count').textContent =
        filtered.length === 1
          ? `Showing "${filtered[0].title_english || filtered[0].title}"`
          : `${filtered.length} matches for "${trimmed}"`;

      // Spotlight search result (static hero, no carousel)
      stopHeroCarousel();
      populateFeaturedHero(filtered[0]);
      setHeroVisibility(true);
      document.getElementById('featured-hero').classList.add('search-result-hero');
    } else {
      renderEmptyCatalog();
      document.getElementById('results-count').textContent = `No results for "${trimmed}"`;
      setHeroVisibility(false);
    }
  } catch (err) {
    console.error('Search failed.', err);
    const grid = document.getElementById('anime-grid');
    grid.innerHTML = `
      <div class="no-items-message" style="grid-column: 1 / -1;">
        <i data-lucide="alert-circle" style="color: var(--danger);"></i>
        <p>Search failed. The API may be busy — wait a moment and press Enter again.</p>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
  }
}

/** Rank API hits so titles that actually match the query appear first. */
function filterSearchResults(items, query) {
  const q = query.toLowerCase().trim();
  if (!q) return items;

  const scoreTitle = (anime) => {
    const titles = [
      anime.title,
      anime.title_english,
      ...(anime.title_synonyms || [])
    ].filter(Boolean).map(t => t.toLowerCase());

    let best = 0;
    for (const t of titles) {
      if (t === q) best = Math.max(best, 100);
      else if (t.startsWith(q)) best = Math.max(best, 80);
      else if (t.includes(q)) best = Math.max(best, 50);
      else {
        const words = q.split(/\s+/).filter(Boolean);
        if (words.every(w => t.includes(w))) best = Math.max(best, 30);
      }
    }
    return best;
  };

  const scored = items
    .map(anime => ({ anime, score: scoreTitle(anime) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length > 0) {
    return scored.map(({ anime }) => anime);
  }

  // Fallback: return API order if nothing matched our title filter
  return items;
}

/** Prefer a single exact match; otherwise the best-ranked title hit. */
function pickSearchDisplayItems(ranked, query) {
  if (!ranked.length) return [];

  const q = query.toLowerCase().trim();
  const exact = ranked.filter(anime => {
    const titles = [anime.title, anime.title_english, ...(anime.title_synonyms || [])]
      .filter(Boolean)
      .map(t => t.toLowerCase());
    return titles.some(t => t === q);
  });

  if (exact.length === 1) return exact;
  if (exact.length > 1) return exact;

  return [ranked[0]];
}

function exitSearchForBrowse() {
  if (!state.isSearchMode) return;
  state.isSearchMode = false;
  state.searchQuery = '';
  toggleBrowseSubviews();
  document.getElementById('featured-hero')?.classList.remove('search-result-hero');
  updateCatalogHeader(false);
  setPaginationVisibility(true);
  if (state.heroCarousel.slides.length > 0) {
    startHeroCarousel();
  }
}

function clearSearchMode() {
  state.searchQuery = '';
  state.isSearchMode = false;
  state.currentPage = 1;
  document.getElementById('search-suggestions').classList.add('hide');
  document.getElementById('featured-hero')?.classList.remove('search-result-hero');
  updateCatalogHeader(false);
  setHeroVisibility(true);
  setPaginationVisibility(true);
  loadFeaturedAnime();
  loadCatalog();
}

function updateCatalogHeader(isSearch, query = '', browseTitle = 'Most Popular Anime') {
  const titleEl = document.getElementById('catalog-title');
  if (!titleEl) return;
  titleEl.textContent = isSearch ? `Results for "${query}"` : browseTitle;
}

function setHeroVisibility(show) {
  const hero = document.getElementById('featured-hero');
  if (hero) hero.classList.toggle('hide', !show);
}

function setPaginationVisibility(show) {
  const pagination = document.getElementById('pagination');
  if (pagination) pagination.classList.toggle('hide', !show);
}

// ==========================================================================
// 12. LIVE SEARCH SUGGESTIONS DROP-DOWN
// ==========================================================================

async function loadSearchSuggestions(query) {
  const suggestionsBox = document.getElementById('search-suggestions');
  if (!suggestionsBox) return;

  if (!query || query.length < 3) {
    suggestionsBox.classList.add('hide');
    return;
  }

  try {
    let suggestUrl = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=5&sfw=true`;
    if (state.searchScope === 'airing') suggestUrl += '&status=airing';
    else if (state.searchScope === 'upcoming') suggestUrl += '&status=upcoming';
    const data = await fetchThrottled(suggestUrl);
    const items = data.data || [];

    if (items.length > 0) {
      suggestionsBox.innerHTML = '';
      items.forEach(anime => {
        const row = document.createElement('div');
        row.className = 'suggestion-item';
        row.innerHTML = `
          <img class="suggestion-poster" src="${anime.images.jpg.image_url}" alt="${anime.title}">
          <div class="suggestion-info">
            <span class="suggestion-title">${escapeHTML(anime.title_english || anime.title)}</span>
            <span class="suggestion-meta">${anime.type || 'TV'} • ${anime.year || 'N/A'}</span>
          </div>
        `;

        row.addEventListener('click', () => {
          const title = anime.title_english || anime.title;
          document.getElementById('search-input').value = title;
          performSearch(title);
        });

        suggestionsBox.appendChild(row);
      });
      suggestionsBox.classList.remove('hide');
    } else {
      suggestionsBox.classList.add('hide');
    }
  } catch (err) {
    console.error("Failed pulling search suggestions.", err);
    suggestionsBox.classList.add('hide');
  }
}

// Close suggestions dropdown when user clicks elsewhere
document.addEventListener('click', (e) => {
  const container = document.getElementById('search-suggestions');
  const searchBlock = document.querySelector('.header-search-block');
  if (container && searchBlock && !searchBlock.contains(e.target)) {
    container.classList.add('hide');
  }
});

// ==========================================================================
// IMDb-STYLE HEADER — MENU, LANG, FILTERS
// ==========================================================================

function initImdbHeader() {
  const menuBtn = document.getElementById('btn-header-menu');
  const menuPanel = document.getElementById('header-menu-panel');
  const menuBackdrop = document.getElementById('header-menu-backdrop');
  const filtersBtn = document.getElementById('btn-menu-filters');
  const langBtn = document.getElementById('btn-lang');
  const langDropdown = document.getElementById('lang-dropdown');

  menuBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !menuPanel.classList.contains('hide');
    if (isOpen) {
      closeHeaderMenu();
    } else {
      openHeaderMenu();
    }
  });

  menuBackdrop?.addEventListener('click', closeHeaderMenu);

  filtersBtn?.addEventListener('click', () => {
    closeHeaderMenu();
    switchView('browse');
    const sidebar = document.getElementById('sidebar-filters');
    if (sidebar) {
      sidebar.classList.toggle('sidebar-mobile-open');
      const isOpen = sidebar.classList.contains('sidebar-mobile-open');
      filtersBtn.innerHTML = isOpen
        ? '<i data-lucide="sliders-horizontal"></i> Hide Filters'
        : '<i data-lucide="sliders-horizontal"></i> Show Filters';
      if (window.lucide) lucide.createIcons();
      if (isOpen) {
        sidebar.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  });

  langBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    langDropdown?.classList.toggle('hide');
    langBtn.setAttribute('aria-expanded', langDropdown?.classList.contains('hide') ? 'false' : 'true');
  });

  document.querySelectorAll('.lang-option').forEach(opt => {
    opt.addEventListener('click', () => {
      const lang = opt.dataset.lang;
      localStorage.setItem('aniflow_lang', lang);
      document.getElementById('lang-label').textContent = lang === 'ja' ? 'JA' : 'EN';
      document.querySelectorAll('.lang-option').forEach(o => o.classList.toggle('active', o === opt));
      closeLangDropdown();
      showToast(`Language set to ${lang === 'ja' ? 'Japanese' : 'English'}.`, 'info');
    });
  });

  const savedLang = localStorage.getItem('aniflow_lang') || 'en';
  const savedOpt = document.querySelector(`.lang-option[data-lang="${savedLang}"]`);
  if (savedOpt) {
    document.getElementById('lang-label').textContent = savedLang === 'ja' ? 'JA' : 'EN';
    document.querySelectorAll('.lang-option').forEach(o => o.classList.remove('active'));
    savedOpt.classList.add('active');
  }

  document.addEventListener('click', (e) => {
    if (!document.getElementById('header-lang')?.contains(e.target)) {
      closeLangDropdown();
    }
    if (!document.getElementById('app-header')?.contains(e.target)) {
      closeHeaderMenu();
    }
  });
}

function openHeaderMenu() {
  document.getElementById('header-menu-panel')?.classList.remove('hide');
  document.getElementById('header-menu-backdrop')?.classList.remove('hide');
  document.getElementById('btn-header-menu')?.setAttribute('aria-expanded', 'true');
}

function closeHeaderMenu() {
  document.getElementById('header-menu-panel')?.classList.add('hide');
  document.getElementById('header-menu-backdrop')?.classList.add('hide');
  document.getElementById('btn-header-menu')?.setAttribute('aria-expanded', 'false');
}

function closeLangDropdown() {
  document.getElementById('lang-dropdown')?.classList.add('hide');
  document.getElementById('btn-lang')?.setAttribute('aria-expanded', 'false');
}

// ==========================================================================
// 13. HELPER UTILITIES
// ==========================================================================

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}
