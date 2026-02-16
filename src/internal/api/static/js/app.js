// dockercd SPA — hash router, state manager, page controllers
'use strict';

(function() {

  // --- State ---
  var state = {
    apps: [],
    currentApp: null,
    currentTab: 'overview',
    refreshTimer: null,
    syncing: {}
  };

  var REFRESH_INTERVAL = 10000;

  // --- Router ---

  function getRoute() {
    var hash = location.hash || '#/apps';
    var match = hash.match(/^#\/apps\/(.+)$/);
    if (match) return { page: 'detail', name: decodeURIComponent(match[1]) };
    return { page: 'dashboard' };
  }

  function navigate() {
    stopRefresh();
    var route = getRoute();
    if (route.page === 'detail') {
      loadDetail(route.name);
    } else {
      loadDashboard();
    }
  }

  // --- Dashboard ---

  function loadDashboard() {
    updateBreadcrumb([{ label: 'Applications' }]);
    setContent('<div class="loading"><div class="spinner"></div>Loading...</div>');

    API.listApps().then(function(data) {
      state.apps = data.items || [];
      renderDashboard();
      startRefresh(refreshDashboard);
    }).catch(function(err) {
      setContent('<div class="empty-state"><h2>Error loading applications</h2><p>' + Components.esc(err.message) + '</p></div>');
    });
  }

  function renderDashboard() {
    setContent(Components.appGrid(state.apps));
  }

  function refreshDashboard() {
    if (document.hidden) return;
    API.listApps().then(function(data) {
      state.apps = data.items || [];
      // Only re-render if we're still on dashboard
      if (getRoute().page === 'dashboard') {
        renderDashboard();
      }
    }).catch(function() {
      // Silently skip refresh errors
    });
  }

  // --- Detail ---

  function loadDetail(name) {
    state.currentApp = null;
    state.currentTab = 'overview';
    updateBreadcrumb([
      { label: 'Applications', href: '#/apps' },
      { label: name }
    ]);
    setContent('<div class="loading"><div class="spinner"></div>Loading...</div>');

    Promise.all([
      API.getApp(name),
      API.getDiff(name),
      API.getHistory(name),
      API.getEvents(name)
    ]).then(function(results) {
      state.currentApp = {
        app: results[0],
        diff: results[1],
        history: (results[2].items || []),
        events: (results[3].items || [])
      };
      renderDetail(name);
      startRefresh(function() { refreshDetail(name); });
    }).catch(function(err) {
      setContent('<div class="empty-state"><h2>Error</h2><p>' + Components.esc(err.message) + '</p></div>');
    });
  }

  function renderDetail(name) {
    var d = state.currentApp;
    if (!d) return;
    var app = d.app;

    var syncBtnText = state.syncing[name] ? '<div class="spinner"></div>Syncing...' : 'Sync';
    var syncBtnDisabled = state.syncing[name] ? ' disabled' : '';

    var html =
      '<div class="detail-header">' +
        '<span class="detail-name">' + Components.esc(name) + '</span>' +
        Components.syncBadge(app.status.syncStatus) +
        Components.healthBadge(app.status.healthStatus) +
        '<div class="detail-actions">' +
          '<button class="btn btn-primary" id="sync-btn"' + syncBtnDisabled + '>' + syncBtnText + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="tabs">' +
        tabBtn('overview', 'Overview') +
        tabBtn('diff', 'Diff') +
        tabBtn('history', 'History') +
        tabBtn('events', 'Events') +
      '</div>' +
      '<div id="tab-overview" class="tab-content' + (state.currentTab === 'overview' ? ' active' : '') + '">' +
        Components.overviewTab(app) +
      '</div>' +
      '<div id="tab-diff" class="tab-content' + (state.currentTab === 'diff' ? ' active' : '') + '">' +
        Components.diffTab(d.diff) +
      '</div>' +
      '<div id="tab-history" class="tab-content' + (state.currentTab === 'history' ? ' active' : '') + '">' +
        Components.historyTab(d.history) +
      '</div>' +
      '<div id="tab-events" class="tab-content' + (state.currentTab === 'events' ? ' active' : '') + '">' +
        Components.eventsTab(d.events) +
      '</div>';

    setContent(html);

    // Bind sync button
    var btn = document.getElementById('sync-btn');
    if (btn) {
      btn.addEventListener('click', function() { triggerSync(name); });
    }

    // Bind tabs
    document.querySelectorAll('.tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        var id = this.getAttribute('data-tab');
        switchTab(id);
      });
    });
  }

  function tabBtn(id, label) {
    var cls = state.currentTab === id ? 'tab active' : 'tab';
    return '<button class="' + cls + '" data-tab="' + id + '">' + Components.esc(label) + '</button>';
  }

  function switchTab(id) {
    state.currentTab = id;
    document.querySelectorAll('.tab').forEach(function(t) {
      t.classList.toggle('active', t.getAttribute('data-tab') === id);
    });
    document.querySelectorAll('.tab-content').forEach(function(c) {
      c.classList.toggle('active', c.id === 'tab-' + id);
    });
  }

  function refreshDetail(name) {
    if (document.hidden) return;
    Promise.all([
      API.getApp(name),
      API.getDiff(name),
      API.getHistory(name),
      API.getEvents(name)
    ]).then(function(results) {
      state.currentApp = {
        app: results[0],
        diff: results[1],
        history: (results[2].items || []),
        events: (results[3].items || [])
      };
      if (getRoute().page === 'detail' && getRoute().name === name) {
        renderDetail(name);
      }
    }).catch(function() {
      // Silently skip refresh errors
    });
  }

  // --- Sync ---

  function triggerSync(name) {
    state.syncing[name] = true;
    renderDetail(name);

    API.syncApp(name).then(function(result) {
      state.syncing[name] = false;
      if (result.result === 'success') {
        Components.toast('Sync completed successfully', 'success');
      } else if (result.result === 'skipped') {
        Components.toast('Sync skipped — already in sync', 'info');
      } else {
        Components.toast('Sync failed: ' + (result.error || 'unknown error'), 'error');
      }
      // Re-fetch after a short delay to let state settle
      setTimeout(function() { refreshDetail(name); }, 500);
    }).catch(function(err) {
      state.syncing[name] = false;
      Components.toast('Sync error: ' + err.message, 'error');
      renderDetail(name);
    });
  }

  // --- Refresh ---

  function startRefresh(fn) {
    stopRefresh();
    state.refreshTimer = setInterval(fn, REFRESH_INTERVAL);
    updateRefreshDot(true);
  }

  function stopRefresh() {
    if (state.refreshTimer) {
      clearInterval(state.refreshTimer);
      state.refreshTimer = null;
    }
    updateRefreshDot(false);
  }

  function updateRefreshDot(active) {
    var dot = document.getElementById('refresh-dot');
    if (dot) {
      dot.className = active ? 'refresh-dot' : 'refresh-dot paused';
    }
  }

  // --- DOM helpers ---

  function setContent(html) {
    var el = document.getElementById('app');
    if (el) el.innerHTML = html;
  }

  function updateBreadcrumb(items) {
    var nav = document.getElementById('breadcrumb');
    if (!nav) return;
    nav.innerHTML = items.map(function(item, i) {
      var sep = i > 0 ? '<span class="sep">/</span>' : '';
      if (item.href) {
        return sep + '<a href="' + item.href + '">' + Components.esc(item.label) + '</a>';
      }
      return sep + '<span>' + Components.esc(item.label) + '</span>';
    }).join('');
  }

  // --- Init ---

  window.addEventListener('hashchange', navigate);

  document.addEventListener('DOMContentLoaded', function() {
    if (!location.hash) location.hash = '#/apps';
    navigate();
  });

})();
