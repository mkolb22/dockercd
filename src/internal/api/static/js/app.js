// dockercd SPA — hash router, state manager, page controllers
'use strict';

(function() {

  // --- State ---
  var state = {
    apps: [],
    systemInfo: null,
    hostStats: null,
    currentApp: null,
    currentTab: 'overview',
    refreshTimer: null,
    statsTimer: null,
    syncing: {},
    // Wave 3
    notifications: [],
    notificationPanelOpen: false,
    healthHistory: {},    // { serviceName: [healthString, ...] } — last 30 points
    cmdPaletteOpen: false,
    cmdPaletteQuery: '',
    cmdPaletteSelected: 0,
    cmdPaletteResults: []
  };

  var STATS_POLL_INTERVAL = 3000;

  var DEFAULT_REFRESH_INTERVAL = 600000; // 10 minutes

  function getRefreshInterval() {
    var saved = localStorage.getItem('dockercd_refresh_interval');
    return saved ? parseInt(saved, 10) : DEFAULT_REFRESH_INTERVAL;
  }

  function initRefreshSelector() {
    var sel = document.getElementById('refresh-interval');
    if (!sel) return;
    sel.addEventListener('change', function() {
      var ms = parseInt(this.value, 10);
      localStorage.setItem('dockercd_refresh_interval', ms);
      // Push poll interval to backend reconciler (sets global override for all apps)
      API.setPollInterval(ms).catch(function() {});
      // Restart refresh with new interval if currently running
      if (state.refreshTimer) {
        var fn = state.refreshFn;
        if (fn) startRefresh(fn);
      }
    });
    // Initialize dropdown from backend value (source of truth)
    API.getPollInterval().then(function(data) {
      var ms = data.intervalMs || getRefreshInterval();
      localStorage.setItem('dockercd_refresh_interval', ms);
      sel.value = String(ms);
    }).catch(function() {
      sel.value = String(getRefreshInterval());
    });
  }

  // --- Router ---

  function getRoute() {
    var hash = location.hash || '#/apps';
    var svcMatch = hash.match(/^#\/apps\/([^/]+)\/services\/(.+)$/);
    if (svcMatch) return { page: 'serviceDetail', appName: decodeURIComponent(svcMatch[1]), svcName: decodeURIComponent(svcMatch[2]) };
    var match = hash.match(/^#\/apps\/(.+)$/);
    if (match) return { page: 'detail', name: decodeURIComponent(match[1]) };
    return { page: 'dashboard' };
  }

  function navigate() {
    stopRefresh();
    stopStatsPoll();
    stopSSE();
    var route = getRoute();
    updateNavLinks(route);
    if (route.page === 'serviceDetail') {
      loadServiceDetail(route.appName, route.svcName);
    } else if (route.page === 'detail') {
      loadDetail(route.name);
    } else {
      loadDashboard();
    }
  }

  function updateNavLinks(route) {
    var appsLink = document.getElementById('nav-apps');
    if (appsLink) appsLink.classList.toggle('active', route.page === 'dashboard' || route.page === 'detail' || route.page === 'serviceDetail');
  }

  // --- Dashboard ---

  function loadDashboard() {
    updateBreadcrumb([{ label: 'Applications' }]);
    setContent('<div class="loading"><div class="spinner"></div>Loading...</div>');

    Promise.all([
      API.listApps(),
      API.getSystemInfo().catch(function() { return null; }),
      API.getHostStats().catch(function() { return null; })
    ]).then(function(results) {
      state.apps = results[0].items || [];
      state.systemInfo = results[1];
      state.hostStats = results[2];
      renderDashboard();
      startRefresh(refreshDashboard);
      startStatsPoll();
      // Async-fetch history for mini timeline dots on cards
      fetchCardHistories();
    }).catch(function(err) {
      setContent('<div class="empty-state"><h2>Error loading applications</h2><p>' + Components.esc(err.message) + '</p></div>');
    });
  }

  function fetchCardHistories() {
    state.apps.forEach(function(app) {
      var name = app.metadata.name;
      API.getHistory(name).then(function(data) {
        app._history = (data.items || []).slice(0, 5);
        // Re-render just the mini timeline if card exists
        if (getRoute().page === 'dashboard') {
          renderDashboard();
        }
      }).catch(function() {});
    });
  }

  function renderDashboard() {
    var html = '';
    if (state.systemInfo || state.hostStats) {
      html += Components.systemInfoPanel(state.systemInfo, state.hostStats);
    }
    var appStatsMap = state.hostStats && state.hostStats.stats ? state.hostStats.stats.apps : null;
    html += Components.appGrid(state.apps, appStatsMap);
    setContent(html);
    // Wave 3: seed health history and inject sparklines
    initHealthHistoryFromApps();
    requestAnimationFrame(injectSparklines);
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
        initHealthHistoryFromApps();
        requestAnimationFrame(injectSparklines);
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
      startSSE();
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

    // Timeline between header and tabs
    var timelineHtml = Components.renderTimeline(d.history, app.status.lastSyncedSHA);

    // Topology graph between timeline and tabs
    var topologyHtml = Components.renderTopologyGraph(services, name);

    var html =
      '<div class="detail-header">' +
        '<span class="detail-name">' + Components.esc(name) + '</span>' +
        Components.syncBadge(app.status.syncStatus) +
        Components.healthBadge(app.status.healthStatus) +
        '<div class="detail-actions">' +
          '<button class="btn btn-primary" id="sync-btn"' + syncBtnDisabled + '>' + syncBtnText + '</button>' +
        '</div>' +
      '</div>' +
      timelineHtml +
      topologyHtml +
      '<div id="service-panel-slot"></div>' +
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

    // Bind timeline dot clicks
    bindTimelineDots(name);

    // Bind topology node clicks to open service panel
    bindTopologyNodes(name, services);
  }

  function bindTimelineDots(appName) {
    var dots = document.querySelectorAll('.timeline-dot[data-sha]');
    dots.forEach(function(dot) {
      dot.addEventListener('click', function(e) {
        e.stopPropagation();
        var sha = this.getAttribute('data-sha');
        if (!sha) return;

        // Toggle active state
        dots.forEach(function(d) { d.classList.remove('dot-active'); });
        this.classList.add('dot-active');

        // Show loading in preview slot
        var slot = document.getElementById('rollback-preview-slot');
        if (!slot) return;
        slot.innerHTML = '<div class="rollback-preview"><div class="rollback-preview-loading"><div class="spinner" style="width:16px;height:16px;border:2px solid rgba(255,255,255,0.08);border-top-color:var(--color-accent);border-radius:50%;animation:spin 0.6s linear infinite"></div>Loading diff...</div></div>';

        // Fetch diff for this deployment
        API.getDiff(appName).then(function(diff) {
          if (!slot) return;
          slot.innerHTML = Components.renderRollbackPreview(sha, diff, appName);
          bindRollbackActions(appName, sha);
        }).catch(function(err) {
          slot.innerHTML = '<div class="rollback-preview"><div class="rollback-preview-body"><div class="empty-state"><p>Failed to load diff: ' + Components.esc(err.message) + '</p></div></div></div>';
        });
      });
    });
  }

  function bindRollbackActions(appName, sha) {
    var closeBtn = document.getElementById('rollback-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', function() {
        var slot = document.getElementById('rollback-preview-slot');
        if (slot) slot.innerHTML = '';
        document.querySelectorAll('.timeline-dot').forEach(function(d) {
          d.classList.remove('dot-active');
        });
      });
    }

    var rollbackBtn = document.getElementById('rollback-btn');
    if (rollbackBtn) {
      rollbackBtn.addEventListener('click', function() {
        var confirmSlot = document.getElementById('rollback-confirm-slot');
        if (confirmSlot) {
          confirmSlot.innerHTML = Components.renderRollbackConfirm(appName, sha);
          bindRollbackConfirm(appName, sha);
        }
      });
    }
  }

  function bindRollbackConfirm(appName, sha) {
    var yesBtn = document.getElementById('rollback-confirm-yes');
    var noBtn = document.getElementById('rollback-confirm-no');

    if (noBtn) {
      noBtn.addEventListener('click', function() {
        var confirmSlot = document.getElementById('rollback-confirm-slot');
        if (confirmSlot) confirmSlot.innerHTML = '';
      });
    }

    if (yesBtn) {
      yesBtn.addEventListener('click', function() {
        yesBtn.disabled = true;
        yesBtn.textContent = 'Rolling back...';

        API.rollbackApp(appName, sha).then(function(result) {
          if (result.result === 'success') {
            Components.toast('Rollback to ' + sha.substring(0, 7) + ' completed', 'success');
            addNotification('rollback', appName, 'Rolled back to ' + sha.substring(0, 7), true);
          } else {
            Components.toast('Rollback failed: ' + (result.error || 'unknown'), 'error');
            addNotification('rollback', appName, 'Rollback failed: ' + (result.error || 'unknown'), false);
          }
          // Re-fetch detail
          setTimeout(function() { refreshDetail(appName); }, 500);
        }).catch(function(err) {
          Components.toast('Rollback error: ' + err.message, 'error');
          yesBtn.disabled = false;
          yesBtn.textContent = 'Confirm Rollback';
        });
      });
    }
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

  // --- Service Detail ---

  function loadServiceDetail(appName, svcName) {
    state.currentApp = null;
    state.currentTab = 'overview';
    updateBreadcrumb([
      { label: 'Applications', href: '#/apps' },
      { label: appName, href: '#/apps/' + encodeURIComponent(appName) },
      { label: svcName }
    ]);
    setContent('<div class="loading"><div class="spinner"></div>Loading...</div>');

    Promise.all([
      API.getServiceDetail(appName, svcName),
      API.getServiceLogs(appName, svcName, 200).catch(function() { return { lines: [] }; })
    ]).then(function(results) {
      state.currentApp = {
        serviceDetail: results[0],
        serviceLogs: results[1].lines || []
      };
      renderServiceDetail(appName, svcName);
      startRefresh(function() { refreshServiceDetail(appName, svcName); });
    }).catch(function(err) {
      setContent('<div class="empty-state"><h2>Error</h2><p>' + Components.esc(err.message) + '</p></div>');
    });
  }

  function renderServiceDetail(appName, svcName) {
    var d = state.currentApp;
    if (!d || !d.serviceDetail) return;
    var detail = d.serviceDetail;

    var healthCls = (detail.health || 'unknown').toLowerCase();

    var html =
      '<div class="detail-header">' +
        '<span class="detail-name">' + Components.esc(svcName) + '</span>' +
        Components.healthBadge(detail.health) +
        '<span class="badge badge-unknown" style="font-family:var(--font-mono);font-size:0.7rem">' + Components.esc(detail.status || '-') + '</span>' +
      '</div>' +
      '<div class="tabs">' +
        tabBtn('overview', 'Overview') +
        tabBtn('metrics', 'Metrics') +
        tabBtn('logs', 'Logs') +
      '</div>' +
      '<div id="tab-overview" class="tab-content' + (state.currentTab === 'overview' ? ' active' : '') + '">' +
        Components.serviceOverviewTab(detail) +
      '</div>' +
      '<div id="tab-metrics" class="tab-content' + (state.currentTab === 'metrics' ? ' active' : '') + '">' +
        Components.serviceMetricsTab(detail) +
      '</div>' +
      '<div id="tab-logs" class="tab-content' + (state.currentTab === 'logs' ? ' active' : '') + '">' +
        Components.serviceLogsTab(d.serviceLogs, appName, svcName) +
      '</div>';

    setContent(html);

    // Bind tabs
    document.querySelectorAll('.tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        switchTab(this.getAttribute('data-tab'));
      });
    });

    // Bind log refresh button
    var logRefreshBtn = document.getElementById('log-refresh-btn');
    if (logRefreshBtn) {
      logRefreshBtn.addEventListener('click', function() {
        logRefreshBtn.disabled = true;
        logRefreshBtn.textContent = 'Loading...';
        API.getServiceLogs(appName, svcName, 500).then(function(data) {
          state.currentApp.serviceLogs = data.lines || [];
          var viewer = document.getElementById('log-viewer');
          if (viewer) {
            viewer.innerHTML = Components.renderLogLines(state.currentApp.serviceLogs);
            viewer.scrollTop = viewer.scrollHeight;
          }
          logRefreshBtn.disabled = false;
          logRefreshBtn.textContent = 'Refresh';
        }).catch(function() {
          logRefreshBtn.disabled = false;
          logRefreshBtn.textContent = 'Refresh';
        });
      });
    }

    // Auto-scroll logs to bottom
    var viewer = document.getElementById('log-viewer');
    if (viewer) viewer.scrollTop = viewer.scrollHeight;

    // Bind env/label toggles
    document.querySelectorAll('.env-toggle').forEach(function(toggle) {
      toggle.addEventListener('click', function() {
        var target = document.getElementById(this.getAttribute('data-target'));
        if (target) target.classList.toggle('open');
      });
    });
  }

  function refreshServiceDetail(appName, svcName) {
    if (document.hidden) return;
    API.getServiceDetail(appName, svcName).then(function(detail) {
      if (!state.currentApp) return;
      state.currentApp.serviceDetail = detail;
      var route = getRoute();
      if (route.page === 'serviceDetail' && route.appName === appName && route.svcName === svcName) {
        renderServiceDetail(appName, svcName);
      }
    }).catch(function() {});
  }

  // --- Sync ---

  function triggerSync(name) {
    state.syncing[name] = true;
    renderDetail(name);

    API.syncApp(name).then(function(result) {
      state.syncing[name] = false;
      if (result.result === 'success') {
        Components.toast('Sync completed successfully', 'success');
        addNotification('sync', name, 'Sync completed successfully', true);
      } else if (result.result === 'skipped') {
        Components.toast('Sync skipped — already in sync', 'info');
        addNotification('sync', name, 'Sync skipped — already in sync', true);
      } else {
        Components.toast('Sync failed: ' + (result.error || 'unknown error'), 'error');
        addNotification('sync', name, 'Sync failed: ' + (result.error || 'unknown'), false);
      }
      // Re-fetch after a short delay to let state settle
      setTimeout(function() { refreshDetail(name); }, 500);
    }).catch(function(err) {
      state.syncing[name] = false;
      Components.toast('Sync error: ' + err.message, 'error');
      renderDetail(name);
    });
  }

  // --- Stats Polling (independent 3s timer) ---

  function startStatsPoll() {
    stopStatsPoll();
    state.statsTimer = setInterval(refreshStats, STATS_POLL_INTERVAL);
  }

  function stopStatsPoll() {
    if (state.statsTimer) {
      clearInterval(state.statsTimer);
      state.statsTimer = null;
    }
  }

  function refreshStats() {
    if (document.hidden) return;
    if (getRoute().page !== 'dashboard') return;
    API.getHostStats().then(function(data) {
      state.hostStats = data;
      // Update host stats strip
      var panel = document.getElementById('host-stats-panel');
      if (panel) {
        panel.innerHTML = Components.renderHostStats(data, state.systemInfo);
      }
      // Update per-app card metrics in-place
      var apps = data && data.stats ? data.stats.apps : null;
      if (apps) {
        var cards = document.querySelectorAll('.card-metrics[data-app-stats]');
        for (var i = 0; i < cards.length; i++) {
          var proj = cards[i].getAttribute('data-app-stats');
          var as = apps[proj];
          if (as) {
            cards[i].innerHTML = Components.cardMetricsInner(as);
          }
        }
      }
    }).catch(function() {
      // Silently skip stats refresh errors
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

  // --- Topology: node click + service panel ---

  function bindTopologyNodes(appName, services) {
    var nodes = document.querySelectorAll('.topology-node[data-service]');
    nodes.forEach(function(node) {
      node.addEventListener('click', function() {
        var svcName = this.getAttribute('data-service');
        if (!svcName) return;
        // Find the service in the merged list
        var svc = null;
        for (var i = 0; i < services.length; i++) {
          if (services[i].name === svcName) { svc = services[i]; break; }
        }
        if (!svc) return;
        openServicePanel(svc);
      });
      // Add pointer cursor via style (SVG elements)
      node.style.cursor = 'pointer';
    });
  }

  function openServicePanel(service) {
    var slot = document.getElementById('service-panel-slot');
    if (!slot) return;

    slot.innerHTML = Components.renderServicePanel(service);

    var overlay = document.getElementById('service-panel-overlay');
    var panel = document.getElementById('service-panel');
    var closeBtn = document.getElementById('service-panel-close');

    if (!overlay || !panel) return;

    // Trigger open with rAF to allow transition
    requestAnimationFrame(function() {
      overlay.classList.add('open');
      panel.classList.add('open');
    });

    function closePanel() {
      panel.classList.remove('open');
      overlay.classList.remove('open');
      setTimeout(function() {
        if (slot) slot.innerHTML = '';
      }, 300);
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        closePanel();
      });
    }

    // Click outside (on overlay) closes panel
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) {
        closePanel();
      }
    });

    // Escape key closes panel
    function onEscape(e) {
      if (e.key === 'Escape') {
        closePanel();
        document.removeEventListener('keydown', onEscape);
      }
    }
    document.addEventListener('keydown', onEscape);
  }

  // --- SSE: real-time health updates for topology ---

  var sseSource = null;

  function startSSE() {
    if (sseSource) return;
    try {
      sseSource = new EventSource('/api/v1/events');
      sseSource.addEventListener('health', function(e) {
        try {
          var data = JSON.parse(e.data);
          updateTopologyHealth(data.service, data.health);
        } catch (err) { /* ignore parse errors */ }
      });
      sseSource.addEventListener('message', function(e) {
        try {
          var data = JSON.parse(e.data);
          if (data.type === 'health' && data.service && data.health) {
            updateTopologyHealth(data.service, data.health);
          }
        } catch (err) { /* ignore */ }
      });
      sseSource.onerror = function() {
        // Reconnect after a delay
        stopSSE();
        setTimeout(startSSE, 5000);
      };
    } catch (err) {
      // SSE not supported or failed
    }
  }

  function stopSSE() {
    if (sseSource) {
      sseSource.close();
      sseSource = null;
    }
  }

  function updateTopologyHealth(serviceName, newHealth) {
    if (!serviceName || !newHealth) return;

    // Wave 3: track sparkline data and fire notification on health change
    var prevHistory = state.healthHistory[serviceName];
    var prevHealth = prevHistory && prevHistory.length > 0 ? prevHistory[prevHistory.length - 1] : null;
    trackHealthPoint(serviceName, newHealth);

    if (prevHealth && prevHealth.toLowerCase() !== newHealth.toLowerCase()) {
      addNotification('health', serviceName, 'Health changed: ' + prevHealth + ' \u2192 ' + newHealth);
    }

    var h = newHealth.toLowerCase();
    var dotCls = 'dot-' + h;
    var healthCls = 'health-' + h;

    // Find topology node by data-service attribute
    var node = document.querySelector('.topology-node[data-service="' + serviceName + '"]');
    if (!node) return;

    // Update node health class
    node.className = node.className.replace(/health-\w+/g, '').trim() + ' ' + healthCls;

    // Update health indicator circle
    var indicator = node.querySelector('.health-indicator');
    if (indicator) {
      indicator.className = indicator.className.replace(/dot-\w+/g, '').trim() + ' ' + dotCls;
    }

    // Update health text
    var texts = node.querySelectorAll('text');
    for (var i = 0; i < texts.length; i++) {
      var t = texts[i];
      if (t.getAttribute('text-anchor') === 'end') {
        t.textContent = newHealth;
        var color = h === 'healthy' ? 'var(--color-healthy)' :
                    h === 'progressing' ? 'var(--color-progressing)' :
                    h === 'degraded' ? 'var(--color-degraded)' : 'var(--color-unknown)';
        t.setAttribute('fill', color);
      }
    }

    // Flash animation
    node.classList.add('health-flash');
    setTimeout(function() {
      node.classList.remove('health-flash');
    }, 700);
  }

  // --- DOM helpers ---

  function setContent(html) {
    var el = document.getElementById('app');
    if (el) el.innerHTML = html;
  }

  function updateBreadcrumb(items) {
    var detail = document.getElementById('nav-detail-name');
    if (!detail) return;
    if (items.length > 1) {
      var parts = [];
      for (var i = 1; i < items.length; i++) {
        var item = items[i];
        if (item.href) {
          parts.push('<a href="' + item.href + '" style="color:var(--text-muted);text-decoration:none">' + Components.esc(item.label) + '</a>');
        } else {
          parts.push(Components.esc(item.label));
        }
      }
      detail.innerHTML = '/ ' + parts.join(' / ');
      detail.style.display = '';
    } else {
      detail.textContent = '';
      detail.style.display = 'none';
    }
  }

  // --- Wave 3: Command Palette ---

  function buildCommandActions(query) {
    var results = [];
    var q = (query || '').toLowerCase().trim();
    var apps = state.apps || [];

    // Static actions
    var staticActions = [
      { id: 'home', title: 'Go to Dashboard', desc: 'Navigate to home', icon: '\u{1F3E0}', keywords: ['home', 'dashboard', 'main'], action: function() { location.hash = '#/apps'; } },
      { id: 'refresh', title: 'Refresh', desc: 'Reload current view', icon: '\u{1F504}', keywords: ['refresh', 'reload'], action: function() { navigate(); } }
    ];

    // App-based actions
    apps.forEach(function(app) {
      var name = app.metadata.name;
      results.push({
        title: name,
        desc: 'Navigate to ' + name,
        icon: '\u{1F50D}',
        keywords: ['navigate', name.toLowerCase()],
        action: function() { location.hash = '#/apps/' + encodeURIComponent(name); }
      });
      results.push({
        title: 'Sync ' + name,
        desc: 'Trigger sync for ' + name,
        icon: '\u{1F504}',
        keywords: ['sync', name.toLowerCase()],
        action: function() {
          location.hash = '#/apps/' + encodeURIComponent(name);
          setTimeout(function() { triggerSync(name); }, 300);
        }
      });
      results.push({
        title: 'Rollback ' + name,
        desc: 'Open rollback for ' + name,
        icon: '\u23EA',
        keywords: ['rollback', name.toLowerCase()],
        action: function() { location.hash = '#/apps/' + encodeURIComponent(name); }
      });
    });

    results = results.concat(staticActions);

    // Fuzzy filter
    if (q) {
      results = results.filter(function(r) {
        var hay = (r.title + ' ' + (r.desc || '') + ' ' + (r.keywords || []).join(' ')).toLowerCase();
        // Fuzzy: all chars of query appear in order
        var qi = 0;
        for (var hi = 0; hi < hay.length && qi < q.length; hi++) {
          if (hay[hi] === q[qi]) qi++;
        }
        return qi === q.length;
      });
      // Score by how early query appears
      results.sort(function(a, b) {
        var aIdx = (a.title + ' ' + (a.keywords || []).join(' ')).toLowerCase().indexOf(q);
        var bIdx = (b.title + ' ' + (b.keywords || []).join(' ')).toLowerCase().indexOf(q);
        if (aIdx === -1) aIdx = 999;
        if (bIdx === -1) bIdx = 999;
        return aIdx - bIdx;
      });
    }

    return results.slice(0, 12);
  }

  function openCommandPalette() {
    state.cmdPaletteOpen = true;
    state.cmdPaletteQuery = '';
    state.cmdPaletteSelected = 0;
    state.cmdPaletteResults = buildCommandActions('');
    renderCommandPalette();
  }

  function closeCommandPalette(animate) {
    if (!state.cmdPaletteOpen) return;
    var root = document.getElementById('cmd-palette-root');
    if (!root) { state.cmdPaletteOpen = false; return; }

    if (animate) {
      var overlay = document.getElementById('cmd-palette-overlay');
      if (overlay) {
        overlay.classList.add('closing');
        setTimeout(function() {
          root.innerHTML = '';
          state.cmdPaletteOpen = false;
        }, 120);
      } else {
        root.innerHTML = '';
        state.cmdPaletteOpen = false;
      }
    } else {
      root.innerHTML = '';
      state.cmdPaletteOpen = false;
    }
  }

  function renderCommandPalette() {
    var root = document.getElementById('cmd-palette-root');
    if (!root) return;
    root.innerHTML = Components.renderCommandPalette(state.cmdPaletteResults, state.cmdPaletteSelected);

    var input = document.getElementById('cmd-palette-input');
    if (input) {
      input.value = state.cmdPaletteQuery;
      input.focus();
      input.addEventListener('input', function() {
        state.cmdPaletteQuery = this.value;
        state.cmdPaletteResults = buildCommandActions(this.value);
        state.cmdPaletteSelected = 0;
        updatePaletteResults();
      });
    }

    // Click on overlay closes
    var overlay = document.getElementById('cmd-palette-overlay');
    if (overlay) {
      overlay.addEventListener('click', function(e) {
        if (e.target === overlay) closeCommandPalette(true);
      });
    }

    // Click on results
    var resultsEl = document.getElementById('cmd-palette-results');
    if (resultsEl) {
      resultsEl.addEventListener('click', function(e) {
        var row = e.target.closest('.cmd-palette-result');
        if (!row) return;
        var idx = parseInt(row.getAttribute('data-cmd-idx'), 10);
        executePaletteAction(idx);
      });
    }
  }

  function updatePaletteResults() {
    var resultsEl = document.getElementById('cmd-palette-results');
    if (!resultsEl) return;

    var results = state.cmdPaletteResults;
    if (!results || results.length === 0) {
      resultsEl.innerHTML = '<div class="cmd-palette-empty">No results</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      var sel = i === state.cmdPaletteSelected ? ' selected' : '';
      html += '<div class="cmd-palette-result' + sel + '" data-cmd-idx="' + i + '">';
      html += '<span class="cmd-palette-result-icon">' + (r.icon || '') + '</span>';
      html += '<div class="cmd-palette-result-text">';
      html += '<div class="cmd-palette-result-title">' + Components.esc(r.title) + '</div>';
      if (r.desc) {
        html += '<div class="cmd-palette-result-desc">' + Components.esc(r.desc) + '</div>';
      }
      html += '</div>';
      html += '</div>';
    }
    resultsEl.innerHTML = html;

    // Re-bind click
    resultsEl.addEventListener('click', function(e) {
      var row = e.target.closest('.cmd-palette-result');
      if (!row) return;
      var idx = parseInt(row.getAttribute('data-cmd-idx'), 10);
      executePaletteAction(idx);
    });
  }

  function executePaletteAction(idx) {
    var results = state.cmdPaletteResults;
    if (!results || idx < 0 || idx >= results.length) return;
    closeCommandPalette(false);
    results[idx].action();
  }

  function handlePaletteKeydown(e) {
    if (!state.cmdPaletteOpen) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      closeCommandPalette(true);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      state.cmdPaletteSelected = Math.min(state.cmdPaletteSelected + 1, (state.cmdPaletteResults.length || 1) - 1);
      updatePaletteSelection();
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      state.cmdPaletteSelected = Math.max(state.cmdPaletteSelected - 1, 0);
      updatePaletteSelection();
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      executePaletteAction(state.cmdPaletteSelected);
      return;
    }
  }

  function updatePaletteSelection() {
    var items = document.querySelectorAll('.cmd-palette-result');
    items.forEach(function(el, i) {
      el.classList.toggle('selected', i === state.cmdPaletteSelected);
    });
    // Scroll into view
    var sel = document.querySelector('.cmd-palette-result.selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  // --- Wave 3: Notification Center ---

  function addNotification(type, appName, message, success) {
    var n = {
      type: type,
      appName: appName || '',
      message: message,
      time: new Date().toISOString(),
      read: false,
      success: success !== undefined ? success : true
    };
    state.notifications.unshift(n);
    if (state.notifications.length > 50) {
      state.notifications = state.notifications.slice(0, 50);
    }
    updateNotificationBadge();
    if (state.notificationPanelOpen) {
      renderNotificationPanel();
    }
  }

  function updateNotificationBadge() {
    var unread = state.notifications.filter(function(n) { return !n.read; }).length;
    Components.renderNotificationBell(unread);
  }

  function toggleNotificationPanel() {
    state.notificationPanelOpen = !state.notificationPanelOpen;
    var panel = document.getElementById('notification-panel');
    if (!panel) return;

    if (state.notificationPanelOpen) {
      panel.style.display = '';
      renderNotificationPanel();
    } else {
      panel.style.display = 'none';
    }
  }

  function renderNotificationPanel() {
    var panel = document.getElementById('notification-panel');
    if (!panel) return;
    panel.innerHTML = Components.renderNotificationPanel(state.notifications);

    // Bind mark-all-read
    var markAll = document.getElementById('notification-mark-all');
    if (markAll) {
      markAll.addEventListener('click', function(e) {
        e.stopPropagation();
        state.notifications.forEach(function(n) { n.read = true; });
        updateNotificationBadge();
        renderNotificationPanel();
      });
    }

    // Bind notification clicks
    var items = panel.querySelectorAll('.notification-item');
    items.forEach(function(item) {
      item.addEventListener('click', function() {
        var idx = parseInt(this.getAttribute('data-notification-idx'), 10);
        var appName = this.getAttribute('data-notification-app');
        if (idx >= 0 && idx < state.notifications.length) {
          state.notifications[idx].read = true;
          updateNotificationBadge();
        }
        if (appName) {
          state.notificationPanelOpen = false;
          var notifPanel = document.getElementById('notification-panel');
          if (notifPanel) notifPanel.style.display = 'none';
          location.hash = '#/apps/' + encodeURIComponent(appName);
        }
      });
    });
  }

  // --- Wave 3: Health Sparklines ---

  function trackHealthPoint(serviceName, health) {
    if (!serviceName || !health) return;
    if (!state.healthHistory[serviceName]) {
      state.healthHistory[serviceName] = [];
    }
    var arr = state.healthHistory[serviceName];
    arr.push(health);
    if (arr.length > 30) {
      state.healthHistory[serviceName] = arr.slice(arr.length - 30);
    }
  }

  function initHealthHistoryFromApps() {
    // Seed one data point per service from current status
    (state.apps || []).forEach(function(app) {
      var services = app.status.services || [];
      services.forEach(function(svc) {
        if (svc.health && svc.name) {
          if (!state.healthHistory[svc.name] || state.healthHistory[svc.name].length === 0) {
            state.healthHistory[svc.name] = [svc.health];
          }
        }
      });
    });
  }

  function injectSparklines() {
    // Inject sparklines into dashboard cards next to health dots
    var dots = document.querySelectorAll('.card-health-dot');
    dots.forEach(function(dot) {
      // Find the parent card to identify the app
      var card = dot.closest('.app-card');
      if (!card) return;
      // Already injected?
      if (dot.parentElement.querySelector('.sparkline')) return;

      var href = card.getAttribute('href') || '';
      var nameMatch = href.match(/#\/apps\/(.+)$/);
      if (!nameMatch) return;
      var appName = decodeURIComponent(nameMatch[1]);

      // Find app and its services
      var app = null;
      for (var i = 0; i < state.apps.length; i++) {
        if (state.apps[i].metadata.name === appName) { app = state.apps[i]; break; }
      }
      if (!app || !app.status.services) return;

      // Build a composite sparkline from the first service (or aggregate worst-of)
      var services = app.status.services;
      var bestHistory = null;
      var bestLen = 0;
      services.forEach(function(svc) {
        var h = state.healthHistory[svc.name];
        if (h && h.length > bestLen) {
          bestHistory = h;
          bestLen = h.length;
        }
      });

      if (bestHistory && bestHistory.length >= 2) {
        var sparkHtml = Components.renderSparkline(bestHistory, 60, 16);
        if (sparkHtml) {
          dot.insertAdjacentHTML('afterend', sparkHtml);
        }
      }
    });
  }

  // --- Init ---

  // Global keyboard handler for command palette
  document.addEventListener('keydown', function(e) {
    // Cmd+K / Ctrl+K to toggle palette
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      if (state.cmdPaletteOpen) {
        closeCommandPalette(true);
      } else {
        openCommandPalette();
      }
      return;
    }
    // Forward to palette handler if open
    if (state.cmdPaletteOpen) {
      handlePaletteKeydown(e);
    }
  });

  // Close notification panel on outside click
  document.addEventListener('click', function(e) {
    if (!state.notificationPanelOpen) return;
    var bell = document.getElementById('notification-bell');
    var panel = document.getElementById('notification-panel');
    if (bell && bell.contains(e.target)) return;
    if (panel && panel.contains(e.target)) return;
    state.notificationPanelOpen = false;
    if (panel) panel.style.display = 'none';
  });

  window.addEventListener('hashchange', navigate);

  document.addEventListener('DOMContentLoaded', function() {
    initRefreshSelector();

    // Bind notification bell click
    var bell = document.getElementById('notification-bell');
    if (bell) {
      bell.addEventListener('click', function(e) {
        e.stopPropagation();
        toggleNotificationPanel();
      });
    }

    // Bind command palette hint click
    var hint = document.getElementById('cmd-palette-hint');
    if (hint) {
      hint.addEventListener('click', function() {
        openCommandPalette();
      });
    }

    if (!location.hash) location.hash = '#/apps';
    navigate();
  });

})();
