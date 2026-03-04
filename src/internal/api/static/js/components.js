// dockercd UI components — pure render functions returning HTML strings
'use strict';

var Components = (function() {

  function esc(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function timeAgo(dateStr) {
    if (!dateStr) return 'never';
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    var seconds = Math.floor((Date.now() - d.getTime()) / 1000);
    if (seconds < 60) return seconds + 's ago';
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + 'm ago';
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + 'h ago';
    var days = Math.floor(hours / 24);
    return days + 'd ago';
  }

  function formatTime(dateStr) {
    if (!dateStr) return '-';
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleString();
  }

  function syncBadgeClass(status) {
    switch ((status || '').toLowerCase()) {
      case 'synced': return 'badge-synced';
      case 'outofsync': return 'badge-outofsync';
      case 'error': return 'badge-error';
      default: return 'badge-unknown';
    }
  }

  function healthBadgeClass(status) {
    switch ((status || '').toLowerCase()) {
      case 'healthy': return 'badge-healthy';
      case 'progressing': return 'badge-progressing';
      case 'degraded': return 'badge-degraded';
      default: return 'badge-unknown';
    }
  }

  function cardStatusClass(app) {
    var h = (app.status.healthStatus || '').toLowerCase();
    var s = (app.status.syncStatus || '').toLowerCase();
    if (h === 'degraded' || s === 'error') return 'status-degraded';
    if (h === 'progressing' || s === 'outofsync') return 'status-progressing';
    if (h === 'healthy' && s === 'synced') return 'status-healthy';
    return 'status-unknown';
  }

  function shortSHA(sha) {
    return sha ? sha.substring(0, 7) : '';
  }

  function repoShort(url) {
    if (!url) return '';
    return url.replace(/^https?:\/\//, '').replace(/\.git$/, '');
  }

  function portLinks(ports) {
    if (!ports || ports.length === 0) return '';
    var seen = {};
    var unique = [];
    ports.forEach(function(p) {
      if (p.hostPort && !seen[p.hostPort]) {
        seen[p.hostPort] = true;
        unique.push(p);
      }
    });
    if (unique.length === 0) return '';
    return unique.map(function(p) {
      return '<a href="http://localhost:' + esc(p.hostPort) + '" target="_blank" ' +
        'class="port-link" onclick="event.stopPropagation()">:' + esc(p.hostPort) + '</a>';
    }).join(' ');
  }

  // Returns unique host ports across all services as span elements (safe inside <a> cards)
  function cardPortSpans(services) {
    if (!services || services.length === 0) return '';
    var seen = {};
    var unique = [];
    services.forEach(function(svc) {
      if (!svc.ports) return;
      svc.ports.forEach(function(p) {
        if (p.hostPort && !seen[p.hostPort]) {
          seen[p.hostPort] = true;
          unique.push(p.hostPort);
        }
      });
    });
    if (unique.length === 0) return '';
    return unique.map(function(port) {
      return '<span class="port-link" onclick="event.preventDefault();event.stopPropagation();' +
        'window.open(\'http://localhost:' + esc(port) + '\',\'_blank\')">:' + esc(port) + '</span>';
    }).join(' ');
  }

  function badge(text, cls) {
    return '<span class="badge ' + cls + '">' + esc(text) + '</span>';
  }

  function syncBadge(status) {
    return badge(status || 'Unknown', syncBadgeClass(status));
  }

  function healthBadge(status) {
    return badge(status || 'Unknown', healthBadgeClass(status));
  }

  function resultBadge(result) {
    var cls = 'badge-unknown';
    switch ((result || '').toLowerCase()) {
      case 'success': cls = 'badge-success'; break;
      case 'failure': cls = 'badge-failure'; break;
      case 'skipped': cls = 'badge-skipped'; break;
    }
    return badge(result || 'Unknown', cls);
  }

  function severityBadge(severity) {
    var cls = 'badge-info';
    switch ((severity || '').toLowerCase()) {
      case 'warning': cls = 'badge-warning'; break;
      case 'error': cls = 'badge-error'; break;
    }
    return badge(severity || 'info', cls);
  }

  // --- Cards ---

  function appCard(app, appStatsMap) {
    var name = app.metadata.name;
    var projectName = app.spec.destination.projectName || name;
    var repo = repoShort(app.spec.source.repoURL);
    var sha = shortSHA(app.status.lastSyncedSHA);
    var syncTime = timeAgo(app.status.lastSyncTime);
    var statusCls = cardStatusClass(app);

    var errorLine = '';
    if (app.status.lastError) {
      errorLine = '<div class="card-error" title="' + esc(app.status.lastError) + '">' + esc(app.status.lastError) + '</div>';
    }

    var portsHtml = cardPortSpans(app.status.services);
    var portsLine = portsHtml ? '<div class="card-ports">' + portsHtml + '</div>' : '';

    // Mini metrics strip from per-app stats
    var metricsLine = '';
    var as = appStatsMap && (appStatsMap[projectName] || appStatsMap[name]);
    if (as) {
      var cpuPct = Math.min(100, as.cpuPercent || 0);
      var memPct = as.memoryLimitMB > 0 ? Math.min(100, (as.memoryUsageMB / as.memoryLimitMB) * 100) : 0;
      metricsLine = '<div class="card-metrics" data-app-stats="' + esc(projectName) + '">' +
        stubBar('CPU', cpuPct) +
        stubBar('MEM', memPct) +
        statPill('NET', '\u2193' + formatSize(as.networkRxMB) + ' \u2191' + formatSize(as.networkTxMB)) +
        statPill('PIDs', as.pids || 0) +
      '</div>';
    }

    return '<a href="#/apps/' + encodeURIComponent(name) + '" class="app-card ' + statusCls + '">' +
      '<div class="card-header">' +
        '<span class="card-name">' + esc(name) + '</span>' +
        '<div class="card-badges">' +
          syncBadge(app.status.syncStatus) +
          healthBadge(app.status.healthStatus) +
        '</div>' +
      '</div>' +
      portsLine +
      metricsLine +
      '<div class="card-repo">' + esc(repo) + '</div>' +
      errorLine +
      '<div class="card-footer">' +
        '<span>' + esc(syncTime) + '</span>' +
        (sha ? '<span class="card-sha">' + esc(sha) + '</span>' : '') +
      '</div>' +
    '</a>';
  }

  function appGrid(apps, appStatsMap) {
    if (!apps || apps.length === 0) {
      return '<div class="empty-state">' +
        '<h2>No Applications</h2>' +
        '<p>No applications are configured yet.</p>' +
      '</div>';
    }
    var sorted = apps.slice().sort(function(a, b) {
      var aName = a.metadata.name;
      var bName = b.metadata.name;
      if (aName === 'dockercd') return -1;
      if (bName === 'dockercd') return 1;
      return aName.localeCompare(bName);
    });
    var statsMap = appStatsMap || {};
    return '<div class="app-grid">' + sorted.map(function(a) { return appCard(a, statsMap); }).join('') + '</div>';
  }

  // --- Detail: Overview ---

  function overviewTab(app) {
    var src = app.spec.source;
    var dst = app.spec.destination;
    var pol = app.spec.syncPolicy;
    var st = app.status;

    var errorAlert = '';
    if (st.lastError) {
      errorAlert = '<div class="alert alert-error">' + esc(st.lastError) + '</div>';
    }

    var policyFlags =
      '<div class="policy-flags">' +
        policyFlag('Automated', pol.automated) +
        policyFlag('Prune', pol.prune) +
        policyFlag('Self-Heal', pol.selfHeal) +
      '</div>';

    var servicesTable = '';
    if (st.services && st.services.length > 0) {
      var rows = st.services.map(function(svc) {
        return '<tr>' +
          '<td>' + esc(svc.name) + '</td>' +
          '<td class="mono">' + esc(svc.image) + '</td>' +
          '<td>' + (portLinks(svc.ports) || '-') + '</td>' +
          '<td>' + healthBadge(svc.health) + '</td>' +
          '<td>' + esc(svc.state || '-') + '</td>' +
        '</tr>';
      }).join('');

      servicesTable = '<h3 style="font-size:0.85rem;margin-bottom:0.5rem;color:var(--text-secondary)">Services</h3>' +
        '<div class="table-wrap"><table>' +
        '<thead><tr><th>Name</th><th>Image</th><th>Ports</th><th>Health</th><th>State</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div>';
    }

    return errorAlert +
      '<div class="meta-grid">' +
        '<div class="meta-card">' +
          '<h3>Source</h3>' +
          metaItem('Repository', repoShort(src.repoURL)) +
          metaItem('Branch', src.targetRevision || 'main') +
          metaItem('Path', src.path || '.') +
          metaItem('Compose Files', (src.composeFiles || []).join(', ') || '-') +
        '</div>' +
        '<div class="meta-card">' +
          '<h3>Destination</h3>' +
          metaItem('Docker Host', dst.dockerHost || '-') +
          metaItem('Project', dst.projectName || '-') +
        '</div>' +
        '<div class="meta-card">' +
          '<h3>Status</h3>' +
          metaItem('Head SHA', shortSHA(st.headSHA) || '-', true) +
          metaItem('Last Synced', shortSHA(st.lastSyncedSHA) || '-', true) +
          metaItem('Last Sync', st.lastSyncTime ? formatTime(st.lastSyncTime) : 'never') +
        '</div>' +
        '<div class="meta-card">' +
          '<h3>Sync Policy</h3>' +
          '<div style="padding:0.3rem 0">' + policyFlags + '</div>' +
          metaItem('Poll Interval', pol.pollInterval || '-') +
        '</div>' +
      '</div>' +
      servicesTable;
  }

  function metaItem(label, value, mono) {
    var cls = mono ? ' mono' : '';
    return '<div class="meta-item"><span class="meta-label">' + esc(label) + '</span><span class="meta-value' + cls + '">' + esc(value) + '</span></div>';
  }

  function policyFlag(name, enabled) {
    var cls = enabled ? 'enabled' : 'disabled';
    var icon = enabled ? '\u2713' : '\u2717';
    return '<span class="policy-flag ' + cls + '">' + icon + ' ' + esc(name) + '</span>';
  }

  // --- Detail: Diff ---

  function diffTab(diff) {
    if (!diff || diff.inSync) {
      return '<div class="diff-synced">\u2713 Application is in sync</div>';
    }

    var html = '';
    if (diff.summary) {
      html += '<p style="margin-bottom:1rem;color:var(--text-secondary)">' + esc(diff.summary) + '</p>';
    }

    if (diff.toCreate && diff.toCreate.length > 0) {
      html += diffSection('create', '+CREATE', diff.toCreate);
    }
    if (diff.toUpdate && diff.toUpdate.length > 0) {
      html += diffSection('update', '~UPDATE', diff.toUpdate);
    }
    if (diff.toRemove && diff.toRemove.length > 0) {
      html += diffSection('remove', '-REMOVE', diff.toRemove);
    }
    return html || '<div class="diff-synced">\u2713 No differences detected</div>';
  }

  function diffSection(type, label, items) {
    var html = '<div class="diff-section">';
    html += '<div class="diff-section-header ' + type + '">' + esc(label) + ' (' + items.length + ')</div>';
    items.forEach(function(item) {
      html += '<div class="diff-item">';
      html += '<div class="diff-item-header ' + type + '">' + esc(item.serviceName) + '</div>';
      if (item.fields && item.fields.length > 0) {
        html += '<div class="diff-fields">';
        item.fields.forEach(function(f) {
          html += '<div class="diff-field">' +
            '<span class="diff-field-name">' + esc(f.field) + '</span>' +
            '<span class="diff-field-old">' + esc(f.live || '(none)') + '</span>' +
            '<span class="diff-field-new">' + esc(f.desired || '(none)') + '</span>' +
          '</div>';
        });
        html += '</div>';
      }
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  // --- Detail: History ---

  function historyTab(records) {
    if (!records || records.length === 0) {
      return '<div class="empty-state"><p>No sync history</p></div>';
    }

    var rows = records.map(function(r) {
      var duration = r.durationMs ? (r.durationMs / 1000).toFixed(1) + 's' : '-';
      return '<tr>' +
        '<td class="muted">' + formatTime(r.startedAt || r.createdAt) + '</td>' +
        '<td class="mono">' + esc(shortSHA(r.commitSHA)) + '</td>' +
        '<td>' + esc(r.operation) + '</td>' +
        '<td>' + resultBadge(r.result) + '</td>' +
        '<td>' + esc(duration) + '</td>' +
        '<td class="muted">' + esc(r.error || '-') + '</td>' +
      '</tr>';
    }).join('');

    return '<div class="table-wrap"><table>' +
      '<thead><tr><th>Time</th><th>SHA</th><th>Operation</th><th>Result</th><th>Duration</th><th>Error</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  // --- Detail: Events ---

  function eventsTab(events) {
    if (!events || events.length === 0) {
      return '<div class="empty-state"><p>No events</p></div>';
    }

    var rows = events.map(function(e) {
      return '<tr>' +
        '<td class="muted">' + formatTime(e.createdAt) + '</td>' +
        '<td>' + esc(e.type) + '</td>' +
        '<td>' + esc(e.message) + '</td>' +
        '<td>' + severityBadge(e.severity) + '</td>' +
      '</tr>';
    }).join('');

    return '<div class="table-wrap"><table>' +
      '<thead><tr><th>Time</th><th>Type</th><th>Message</th><th>Severity</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  // --- Resource Bars (htop-style) ---

  function resourceBar(label, value, max, unit) {
    var pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
    var cls = pct < 50 ? 'low' : (pct < 80 ? 'medium' : 'high');
    var valText = value.toFixed(1) + (unit ? ' ' + unit : '');
    if (max > 0 && unit) valText += ' / ' + max.toFixed(0) + ' ' + unit;
    return '<div class="resource-bar">' +
      '<div class="resource-bar-fill ' + cls + '" style="width:' + pct.toFixed(1) + '%"></div>' +
      '<span class="resource-bar-label">' + esc(label) + '</span>' +
      '<span class="resource-bar-value">' + esc(valText) + ' (' + pct.toFixed(0) + '%)</span>' +
    '</div>';
  }

  // --- Service Card ---

  function serviceCard(svc) {
    var healthCls = 'health-' + (svc.health || 'unknown').toLowerCase();
    var html = '<div class="service-card ' + healthCls + '">';
    html += '<div class="svc-header">' +
      '<span class="svc-name">' + esc(svc.name) + '</span>' +
      healthBadge(svc.health) +
    '</div>';
    html += '<div class="svc-image">' + esc(svc.image) + '</div>';

    if (svc.metrics) {
      var m = svc.metrics;
      html += '<div class="svc-metrics">';
      html += resourceBar('CPU', m.cpuPercent, 100, '%');
      html += resourceBar('MEM', m.memoryUsageMB, m.memoryLimitMB, 'MB');
      html += '</div>';
      html += '<div class="svc-stats">';
      if (m.uptime) html += '<span class="mini-stat">Up <span class="mini-stat-value">' + esc(m.uptime) + '</span></span>';
      html += '<span class="mini-stat">Net \u2193<span class="mini-stat-value">' + m.networkRxMB.toFixed(1) + 'MB</span> \u2191<span class="mini-stat-value">' + m.networkTxMB.toFixed(1) + 'MB</span></span>';
      if (m.pids > 0) html += '<span class="mini-stat">PIDs <span class="mini-stat-value">' + m.pids + '</span></span>';
      html += '</div>';
    } else {
      html += '<div class="svc-stats"><span class="mini-stat">' + esc(svc.state || '-') + '</span></div>';
    }
    html += '</div>';
    return html;
  }

  // --- Service Detail Tabs ---

  function serviceOverviewTab(detail) {
    var html = '<div class="meta-grid">';

    // Identity card
    html += '<div class="meta-card">';
    html += '<h3>Container</h3>';
    html += metaItem('Image', detail.image || '-');
    html += metaItem('Container ID', detail.containerId ? detail.containerId.substring(0, 12) : '-', true);
    html += metaItem('Container Name', detail.containerName || '-');
    html += metaItem('Status', detail.status || '-');
    html += metaItem('Health', detail.health || 'Unknown');
    html += '</div>';

    // Config card
    html += '<div class="meta-card">';
    html += '<h3>Configuration</h3>';
    html += metaItem('Restart Policy', detail.restartPolicy || '-');
    if (detail.command && detail.command.length > 0) {
      html += metaItem('Command', detail.command.join(' '));
    }
    if (detail.entrypoint && detail.entrypoint.length > 0) {
      html += metaItem('Entrypoint', detail.entrypoint.join(' '));
    }
    html += '</div>';

    // Ports card
    if (detail.ports && detail.ports.length > 0) {
      html += '<div class="meta-card">';
      html += '<h3>Ports</h3>';
      detail.ports.forEach(function(p) {
        var mapping = p.hostPort ? p.hostPort + ' \u2192 ' + p.containerPort : p.containerPort;
        html += metaItem(p.protocol || 'tcp', mapping);
      });
      html += '</div>';
    }

    // Volumes card
    if (detail.volumes && detail.volumes.length > 0) {
      html += '<div class="meta-card">';
      html += '<h3>Volumes</h3>';
      detail.volumes.forEach(function(v) {
        var ro = v.readOnly ? ' (ro)' : '';
        html += metaItem(v.target, esc(v.source) + ro);
      });
      html += '</div>';
    }

    html += '</div>';

    // Networks
    if (detail.networks && detail.networks.length > 0) {
      html += '<div class="meta-card" style="margin-bottom:1rem">';
      html += '<h3>Networks</h3>';
      html += '<div style="padding:0.3rem 0;font-size:0.85rem;color:var(--text-primary)">' + detail.networks.map(function(n) { return esc(n); }).join(', ') + '</div>';
      html += '</div>';
    }

    // Environment (collapsible)
    if (detail.environment && Object.keys(detail.environment).length > 0) {
      var envKeys = Object.keys(detail.environment).sort();
      html += '<div class="meta-card" style="margin-bottom:1rem">';
      html += '<h3>Environment</h3>';
      html += '<span class="env-toggle" data-target="env-list">Show ' + envKeys.length + ' variables</span>';
      html += '<div id="env-list" class="env-list">';
      html += '<div class="table-wrap" style="margin-top:0.5rem"><table>';
      envKeys.forEach(function(k) {
        html += '<tr><td class="mono" style="font-size:0.75rem;color:var(--text-secondary)">' + esc(k) + '</td><td class="mono" style="font-size:0.75rem">' + esc(detail.environment[k]) + '</td></tr>';
      });
      html += '</table></div></div></div>';
    }

    // Labels (collapsible)
    if (detail.labels && Object.keys(detail.labels).length > 0) {
      var labelKeys = Object.keys(detail.labels).sort();
      html += '<div class="meta-card" style="margin-bottom:1rem">';
      html += '<h3>Labels</h3>';
      html += '<span class="env-toggle" data-target="label-list">Show ' + labelKeys.length + ' labels</span>';
      html += '<div id="label-list" class="env-list">';
      html += '<div class="table-wrap" style="margin-top:0.5rem"><table>';
      labelKeys.forEach(function(k) {
        html += '<tr><td class="mono" style="font-size:0.75rem;color:var(--text-secondary)">' + esc(k) + '</td><td class="mono" style="font-size:0.75rem">' + esc(detail.labels[k]) + '</td></tr>';
      });
      html += '</table></div></div></div>';
    }

    return html;
  }

  function serviceMetricsTab(detail) {
    if (!detail.metrics) {
      return '<div class="empty-state"><p>No metrics available — container may not be running</p></div>';
    }

    var m = detail.metrics;
    var html = '<div style="max-width:600px">';
    html += '<div style="margin-bottom:1rem">';
    html += resourceBar('CPU', m.cpuPercent, 100, '%');
    html += '</div>';
    html += '<div style="margin-bottom:1.5rem">';
    html += resourceBar('MEM', m.memoryUsageMB, m.memoryLimitMB, 'MB');
    html += '</div>';
    html += '</div>';

    html += '<div class="meta-grid">';
    html += '<div class="meta-card">';
    html += '<h3>Stats</h3>';
    if (m.uptime) html += metaItem('Uptime', m.uptime);
    html += metaItem('PIDs', String(m.pids || 0));
    html += metaItem('CPU', m.cpuPercent.toFixed(1) + '%');
    html += metaItem('Memory', m.memoryUsageMB.toFixed(1) + ' / ' + m.memoryLimitMB.toFixed(0) + ' MB');
    html += '</div>';
    html += '<div class="meta-card">';
    html += '<h3>I/O</h3>';
    html += metaItem('Network Rx', m.networkRxMB.toFixed(2) + ' MB');
    html += metaItem('Network Tx', m.networkTxMB.toFixed(2) + ' MB');
    html += metaItem('Block Read', m.blockReadMB.toFixed(2) + ' MB');
    html += metaItem('Block Write', m.blockWriteMB.toFixed(2) + ' MB');
    html += '</div>';
    html += '</div>';

    return html;
  }

  function serviceLogsTab(lines, appName, svcName) {
    var html = '<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.75rem">';
    html += '<button class="btn" id="log-refresh-btn">Refresh</button>';
    html += '<span style="font-size:0.8rem;color:var(--text-muted)">' + (lines ? lines.length : 0) + ' lines</span>';
    html += '</div>';
    html += '<div class="log-viewer" id="log-viewer">';
    html += renderLogLines(lines);
    html += '</div>';
    return html;
  }

  function renderLogLines(lines) {
    if (!lines || lines.length === 0) {
      return '<div style="color:var(--text-muted);padding:1rem">No logs available</div>';
    }
    return lines.map(function(line) {
      return '<div class="log-line">' + esc(line) + '</div>';
    }).join('');
  }

  // --- Resource Tree (ArgoCD-style 3-column graph) ---

  function healthDot(status) {
    var s = (status || 'unknown').toLowerCase();
    return '<span class="health-dot health-dot-' + s + '"></span>';
  }

  function resourceNodeHealth(status) {
    var s = (status || 'unknown').toLowerCase();
    return '<div class="resource-node-health">' + healthDot(s) +
      '<span>' + esc(status || 'Unknown') + '</span></div>';
  }

  function deploymentTree(app, services) {
    var st = app.status;
    var appName = app.metadata.name;
    var appHealth = (st.healthStatus || 'unknown').toLowerCase();
    var appSync = (st.syncStatus || 'unknown').toLowerCase();
    var svcs = (services && services.length > 0) ? services :
               (st.services && st.services.length > 0) ? st.services : [];

    var html = '<div class="resource-tree" id="resource-tree">';
    html += '<svg class="resource-lines" id="resource-lines"></svg>';

    // Column 1: Application
    html += '<div class="resource-column">';
    html += '<div class="resource-column-header">Application</div>';
    html += '<div class="resource-node node-app status-' + appHealth + '" data-node-id="app">';
    html += '<div class="resource-node-icon">\u2388</div>';
    html += '<div class="resource-node-body">';
    html += '<div class="resource-node-name">' + esc(appName) + '</div>';
    html += '<div class="resource-node-detail">' + esc(repoShort(app.spec.source.repoURL)) + '</div>';
    if (st.lastSyncedSHA) {
      html += '<div class="resource-node-detail mono">' + esc(shortSHA(st.lastSyncedSHA)) + '</div>';
    }
    html += '<div class="resource-node-badges">' + syncBadge(st.syncStatus) + healthBadge(st.healthStatus) + '</div>';
    html += '</div></div>';
    html += '</div>';

    // Column 2: Services
    html += '<div class="resource-column">';
    html += '<div class="resource-column-header">Services</div>';
    if (svcs.length > 0) {
      svcs.forEach(function(svc) {
        var h = (svc.health || 'unknown').toLowerCase();
        var svcLink = '#/apps/' + encodeURIComponent(appName) + '/services/' + encodeURIComponent(svc.name);
        html += '<a href="' + svcLink + '" class="resource-node-link">';
        html += '<div class="resource-node node-svc health-' + h + '" data-node-id="svc-' + esc(svc.name) + '" data-connect-from="app">';
        html += '<div class="resource-node-icon">\u2699</div>';
        html += '<div class="resource-node-body">';
        html += '<div class="resource-node-name">' + esc(svc.name) + '</div>';
        html += '<div class="resource-node-detail mono">' + esc(svc.image || '') + '</div>';
        var svcPorts = portLinks(svc.ports);
        if (svcPorts) html += '<div class="resource-node-detail">' + svcPorts + '</div>';
        html += resourceNodeHealth(svc.health);
        html += '</div></div>';
        html += '</a>';
      });
    } else {
      html += '<div class="resource-node node-svc health-unknown" data-node-id="svc-none" data-connect-from="app">';
      html += '<div class="resource-node-icon">\u2699</div>';
      html += '<div class="resource-node-body"><div class="resource-node-name">No services</div></div></div>';
    }
    html += '</div>';

    // Column 3: Containers
    html += '<div class="resource-column">';
    html += '<div class="resource-column-header">Containers</div>';
    if (svcs.length > 0) {
      svcs.forEach(function(svc) {
        var h = (svc.health || 'unknown').toLowerCase();
        var stateText = svc.state || (h === 'healthy' ? 'running' : '-');
        var ctrLink = '#/apps/' + encodeURIComponent(appName) + '/services/' + encodeURIComponent(svc.name);
        html += '<a href="' + ctrLink + '" class="resource-node-link">';
        html += '<div class="resource-node node-ctr health-' + h + '" data-node-id="ctr-' + esc(svc.name) + '" data-connect-from="svc-' + esc(svc.name) + '">';
        html += '<div class="resource-node-icon">\u25A3</div>';
        html += '<div class="resource-node-body">';
        html += '<div class="resource-node-name">' + esc(svc.name) + '-1</div>';
        html += '<div class="resource-node-detail">' + esc(stateText) + '</div>';
        html += resourceNodeHealth(svc.health);
        html += '</div></div>';
        html += '</a>';
      });
    } else {
      html += '<div class="resource-node node-ctr health-unknown" data-node-id="ctr-none" data-connect-from="svc-none">';
      html += '<div class="resource-node-icon">\u25A3</div>';
      html += '<div class="resource-node-body"><div class="resource-node-name">-</div></div></div>';
    }
    html += '</div>';

    html += '</div>';
    return html;
  }

  // --- System Info Panel ---

  // --- System Info Panel ---

  function systemInfoPanel(info, hostStats) {
    var html = '<div class="system-panel-wrap">';
    // Compact stats strip
    html += '<div id="host-stats-panel">';
    if (hostStats) {
      html += renderHostStats(hostStats, info);
    }
    html += '</div>';
    // Static Docker Host — compact inline strip
    if (info && info.host) {
      var h = info.host;
      html += '<div class="host-info-strip">';
      html += '<span class="host-info-title">HOST</span>';
      html += hostInfoItem('Engine', h.serverVersion);
      html += hostInfoItem('OS', h.os);
      html += hostInfoItem('Arch', h.architecture);
      html += hostInfoItem('Storage', h.storageDriver);
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  function hostInfoItem(label, value) {
    return '<span class="host-info-item"><span class="host-info-label">' + esc(label) + '</span> ' +
      '<span class="host-info-value">' + esc(String(value || '-')) + '</span></span>';
  }

  // Compact stub bar: label on left, short bar, percentage on right
  function stubBar(label, pct) {
    pct = Math.min(100, Math.max(0, pct || 0));
    var cls = pct < 50 ? 'low' : (pct < 80 ? 'medium' : 'high');
    return '<div class="stub-bar">' +
      '<span class="stub-bar-label">' + esc(label) + '</span>' +
      '<div class="stub-bar-track">' +
        '<div class="stub-bar-fill ' + cls + '" style="width:' + pct.toFixed(1) + '%"></div>' +
      '</div>' +
      '<span class="stub-bar-pct">' + pct.toFixed(0) + '%</span>' +
    '</div>';
  }

  // Tiny vertical bar for per-CPU cores
  function cpuCoreBars(perCpu) {
    if (!perCpu || perCpu.length === 0) return '';
    var allZero = perCpu.every(function(v) { return v === 0; });
    if (allZero) return '';
    var html = '<div class="cpu-cores">';
    for (var i = 0; i < perCpu.length; i++) {
      var pct = Math.min(100, Math.max(0, perCpu[i] || 0));
      var cls = pct < 50 ? 'low' : (pct < 80 ? 'medium' : 'high');
      html += '<div class="cpu-core-col" title="Core ' + i + ': ' + pct.toFixed(0) + '%">' +
        '<div class="cpu-core-fill ' + cls + '" style="height:' + pct.toFixed(1) + '%"></div>' +
      '</div>';
    }
    html += '</div>';
    return html;
  }

  function statPill(label, value) {
    return '<span class="stat-pill"><span class="stat-pill-label">' + esc(label) + '</span> <span class="stat-pill-value">' + esc(String(value)) + '</span></span>';
  }

  function renderHostStats(data, hostInfo) {
    var s = data && data.stats ? data.stats : data;
    if (!s) return '';
    var cpuCores = s.cpuCores || (hostInfo && hostInfo.host ? hostInfo.host.cpus : 0);
    var cpuPct = cpuCores > 0 ? (s.cpuPercent || 0) / cpuCores : 0;
    var memPct = s.memoryLimitMB > 0 ? ((s.memoryUsageMB || 0) / s.memoryLimitMB * 100) : 0;

    var html = '<div class="host-strip">';

    // CPU section: core bars + stub bar
    html += '<div class="host-strip-section">';
    html += cpuCoreBars(s.perCpuPercent);
    html += stubBar('CPU', cpuPct);
    html += '</div>';

    html += '<div class="host-strip-div"></div>';

    // MEM section: stub bar + usage text
    html += '<div class="host-strip-section">';
    html += stubBar('MEM', memPct);
    html += '<span class="host-strip-detail">' + formatSize(s.memoryUsageMB) + ' / ' + formatSize(s.memoryLimitMB) + '</span>';
    html += '</div>';

    html += '<div class="host-strip-div"></div>';

    // NET + DISK I/O
    html += '<div class="host-strip-section host-strip-io">';
    html += '<span class="host-strip-io-item"><span class="io-label">NET</span> <span class="io-down">\u2193</span>' + formatSize(s.networkRxMB) + ' <span class="io-up">\u2191</span>' + formatSize(s.networkTxMB) + '</span>';
    html += '<span class="host-strip-io-item"><span class="io-label">DISK</span> R:' + formatSize(s.blockReadMB) + ' W:' + formatSize(s.blockWriteMB) + '</span>';
    html += '</div>';

    html += '<div class="host-strip-div"></div>';

    // Pills: PIDs, Containers, disk usage
    html += '<div class="host-strip-section host-strip-pills">';
    html += statPill('PIDs', s.pids || 0);
    html += statPill('CTN', (s.containersRunning || 0) + '/' + (s.containersTotal || 0));
    if (s.diskUsage) {
      var du = s.diskUsage;
      html += statPill('IMG', du.imagesCount + ' \u00b7 ' + formatSize(du.imagesSizeMB));
      html += statPill('VOL', du.volumesCount + ' \u00b7 ' + formatSize(du.volumesSizeMB));
      html += statPill('CACHE', formatSize(du.buildCacheSizeMB));
    }
    html += '</div>';

    html += '</div>';
    return html;
  }

  function formatMem(mb) {
    if (!mb) return '-';
    if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB';
    return mb + ' MB';
  }

  function formatSize(mb) {
    if (mb === undefined || mb === null) return '0';
    if (mb >= 1024) return (mb / 1024).toFixed(1) + 'G';
    if (mb >= 1) return mb.toFixed(0) + 'M';
    return (mb * 1024).toFixed(0) + 'K';
  }

  // Render inner content of a card-metrics div (for targeted updates)
  function cardMetricsInner(as) {
    var cpuPct = Math.min(100, as.cpuPercent || 0);
    var memPct = as.memoryLimitMB > 0 ? Math.min(100, (as.memoryUsageMB / as.memoryLimitMB) * 100) : 0;
    return stubBar('CPU', cpuPct) +
      stubBar('MEM', memPct) +
      statPill('NET', '\u2193' + formatSize(as.networkRxMB) + ' \u2191' + formatSize(as.networkTxMB)) +
      statPill('PIDs', as.pids || 0);
  }

  // --- Toast ---

  function toast(message, type) {
    var container = document.getElementById('toasts');
    if (!container) return;
    var el = document.createElement('div');
    el.className = 'toast toast-' + (type || 'info');
    el.textContent = message;
    container.appendChild(el);
    setTimeout(function() {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.3s';
      setTimeout(function() { el.remove(); }, 300);
    }, 4000);
  }

  return {
    portLinks: portLinks,
    appGrid: appGrid,
    appCard: appCard,
    overviewTab: overviewTab,
    diffTab: diffTab,
    historyTab: historyTab,
    eventsTab: eventsTab,
    syncBadge: syncBadge,
    healthBadge: healthBadge,
    resourceBar: resourceBar,
    serviceCard: serviceCard,
    deploymentTree: deploymentTree,
    systemInfoPanel: systemInfoPanel,
    renderHostStats: renderHostStats,
    cardMetricsInner: cardMetricsInner,
    toast: toast,
    timeAgo: timeAgo,
    esc: esc,
    hostHealthBadge: hostHealthBadge,
    hostCard: hostCard,
    hostGrid: hostGrid,
    addHostForm: addHostForm,
    hostInfoSection: hostInfoSection,
    hostAppsTable: hostAppsTable,
    serviceOverviewTab: serviceOverviewTab,
    serviceMetricsTab: serviceMetricsTab,
    serviceLogsTab: serviceLogsTab,
    renderLogLines: renderLogLines
  };
})();
