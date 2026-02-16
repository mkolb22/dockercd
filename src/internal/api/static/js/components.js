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

  function appCard(app) {
    var name = app.metadata.name;
    var repo = repoShort(app.spec.source.repoURL);
    var sha = shortSHA(app.status.lastSyncedSHA);
    var syncTime = timeAgo(app.status.lastSyncTime);
    var statusCls = cardStatusClass(app);

    var errorLine = '';
    if (app.status.lastError) {
      errorLine = '<div class="card-error" title="' + esc(app.status.lastError) + '">' + esc(app.status.lastError) + '</div>';
    }

    return '<a href="#/apps/' + encodeURIComponent(name) + '" class="app-card ' + statusCls + '">' +
      '<div class="card-header">' +
        '<span class="card-name">' + esc(name) + '</span>' +
        '<div class="card-badges">' +
          syncBadge(app.status.syncStatus) +
          healthBadge(app.status.healthStatus) +
        '</div>' +
      '</div>' +
      '<div class="card-repo">' + esc(repo) + '</div>' +
      errorLine +
      '<div class="card-footer">' +
        '<span>' + esc(syncTime) + '</span>' +
        (sha ? '<span class="card-sha">' + esc(sha) + '</span>' : '') +
      '</div>' +
    '</a>';
  }

  function appGrid(apps) {
    if (!apps || apps.length === 0) {
      return '<div class="empty-state">' +
        '<h2>No Applications</h2>' +
        '<p>No applications are configured yet.</p>' +
      '</div>';
    }
    return '<div class="app-grid">' + apps.map(appCard).join('') + '</div>';
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
          '<td>' + healthBadge(svc.health) + '</td>' +
          '<td>' + esc(svc.state || '-') + '</td>' +
        '</tr>';
      }).join('');

      servicesTable = '<h3 style="font-size:0.85rem;margin-bottom:0.5rem;color:var(--text-secondary)">Services</h3>' +
        '<div class="table-wrap"><table>' +
        '<thead><tr><th>Name</th><th>Image</th><th>Health</th><th>State</th></tr></thead>' +
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
    appGrid: appGrid,
    appCard: appCard,
    overviewTab: overviewTab,
    diffTab: diffTab,
    historyTab: historyTab,
    eventsTab: eventsTab,
    syncBadge: syncBadge,
    healthBadge: healthBadge,
    toast: toast,
    timeAgo: timeAgo,
    esc: esc
  };
})();
