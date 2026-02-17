// dockercd SPA — hash router, state manager, page controllers
'use strict';

(function() {

  // --- State ---
  var state = {
    apps: [],
    systemInfo: null,
    currentApp: null,
    currentTab: 'overview',
    refreshTimer: null,
    syncing: {}
  };

  var DEFAULT_REFRESH_INTERVAL = 600000; // 10 minutes

  function getRefreshInterval() {
    var saved = localStorage.getItem('dockercd_refresh_interval');
    return saved ? parseInt(saved, 10) : DEFAULT_REFRESH_INTERVAL;
  }

  function initRefreshSelector() {
    var sel = document.getElementById('refresh-interval');
    if (!sel) return;
    var val = getRefreshInterval();
    sel.value = String(val);
    sel.addEventListener('change', function() {
      var ms = parseInt(this.value, 10);
      localStorage.setItem('dockercd_refresh_interval', ms);
      // Restart refresh with new interval if currently running
      if (state.refreshTimer) {
        var fn = state.refreshFn;
        if (fn) startRefresh(fn);
      }
    });
  }

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

    Promise.all([
      API.listApps(),
      API.getSystemInfo().catch(function() { return null; })
    ]).then(function(results) {
      state.apps = results[0].items || [];
      state.systemInfo = results[1];
      renderDashboard();
      startRefresh(refreshDashboard);
    }).catch(function(err) {
      setContent('<div class="empty-state"><h2>Error loading applications</h2><p>' + Components.esc(err.message) + '</p></div>');
    });
  }

  function renderDashboard() {
    var html = '';
    if (state.systemInfo) {
      html += Components.systemInfoPanel(state.systemInfo);
    }
    html += Components.appGrid(state.apps);
    setContent(html);
  }

  function refreshDashboard() {
    if (document.hidden) return;
    Promise.all([
      API.listApps(),
      API.getSystemInfo().catch(function() { return null; })
    ]).then(function(results) {
      state.apps = results[0].items || [];
      state.systemInfo = results[1];
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
      API.getEvents(name),
      API.getAppMetrics(name).catch(function() { return null; })
    ]).then(function(results) {
      state.currentApp = {
        app: results[0],
        diff: results[1],
        history: (results[2].items || []),
        events: (results[3].items || []),
        metrics: results[4] ? (results[4].items || []) : []
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

    // Merge metrics into services for the deployment tree
    var services = mergeMetrics(app.status.services, d.metrics);

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
        tabBtn('resources', 'Resources') +
        tabBtn('diff', 'Diff') +
        tabBtn('history', 'History') +
        tabBtn('events', 'Events') +
      '</div>' +
      '<div id="tab-overview" class="tab-content' + (state.currentTab === 'overview' ? ' active' : '') + '">' +
        Components.deploymentTree(app, services) +
        Components.overviewTab(app) +
      '</div>' +
      '<div id="tab-resources" class="tab-content' + (state.currentTab === 'resources' ? ' active' : '') + '">' +
        resourcesTab(services) +
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

    // Draw SVG connectors between resource tree nodes
    requestAnimationFrame(drawTreeLines);

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

  function mergeMetrics(services, metricsItems) {
    if (!metricsItems || metricsItems.length === 0) return services || [];
    if (!services || services.length === 0) return metricsItems;

    // Build lookup by service name
    var metricsMap = {};
    metricsItems.forEach(function(m) {
      metricsMap[m.name] = m;
    });

    return services.map(function(svc) {
      var m = metricsMap[svc.name];
      if (m && m.metrics) {
        return { name: svc.name, image: svc.image, health: svc.health, state: svc.state, metrics: m.metrics };
      }
      return svc;
    });
  }

  function resourcesTab(services) {
    if (!services || services.length === 0) {
      return '<div class="empty-state"><p>No service metrics available</p></div>';
    }

    var hasMetrics = services.some(function(s) { return s.metrics; });
    if (!hasMetrics) {
      return '<div class="empty-state"><p>Metrics not available — containers may not be running</p></div>';
    }

    var html = '<div class="service-cards">';
    services.forEach(function(svc) {
      html += Components.serviceCard(svc);
    });
    html += '</div>';
    return html;
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
      API.getEvents(name),
      API.getAppMetrics(name).catch(function() { return null; })
    ]).then(function(results) {
      state.currentApp = {
        app: results[0],
        diff: results[1],
        history: (results[2].items || []),
        events: (results[3].items || []),
        metrics: results[4] ? (results[4].items || []) : []
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
    state.refreshFn = fn;
    state.refreshTimer = setInterval(fn, getRefreshInterval());
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

  // --- SVG tree line drawing ---

  function drawTreeLines() {
    var tree = document.getElementById('resource-tree');
    var svg = document.getElementById('resource-lines');
    if (!tree || !svg) return;

    var treeRect = tree.getBoundingClientRect();
    svg.setAttribute('width', tree.scrollWidth);
    svg.setAttribute('height', tree.scrollHeight);
    svg.setAttribute('viewBox', '0 0 ' + tree.scrollWidth + ' ' + tree.scrollHeight);
    svg.innerHTML = '';

    // Arrow marker definition
    var defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    var marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', 'arrowhead');
    marker.setAttribute('markerWidth', '8');
    marker.setAttribute('markerHeight', '6');
    marker.setAttribute('refX', '8');
    marker.setAttribute('refY', '3');
    marker.setAttribute('orient', 'auto');
    var polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    polygon.setAttribute('points', '0 0, 8 3, 0 6');
    polygon.setAttribute('fill', '#4a4f57');
    marker.appendChild(polygon);
    defs.appendChild(marker);
    svg.appendChild(defs);

    var targets = tree.querySelectorAll('[data-connect-from]');
    for (var i = 0; i < targets.length; i++) {
      var target = targets[i];
      var sourceId = target.getAttribute('data-connect-from');
      var source = tree.querySelector('[data-node-id="' + sourceId + '"]');
      if (!source) continue;

      var srcRect = source.getBoundingClientRect();
      var tgtRect = target.getBoundingClientRect();

      // Coordinates relative to the tree container
      var x1 = srcRect.right - treeRect.left;
      var y1 = srcRect.top + srcRect.height / 2 - treeRect.top;
      var x2 = tgtRect.left - treeRect.left;
      var y2 = tgtRect.top + tgtRect.height / 2 - treeRect.top;

      var dx = (x2 - x1) * 0.5;
      var d = 'M' + x1 + ',' + y1 +
              ' C' + (x1 + dx) + ',' + y1 +
              ' ' + (x2 - dx) + ',' + y2 +
              ' ' + x2 + ',' + y2;

      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', '#4a4f57');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('marker-end', 'url(#arrowhead)');
      svg.appendChild(path);
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
    initRefreshSelector();
    if (!location.hash) location.hash = '#/apps';
    navigate();
  });

})();
