// dockercd API client
'use strict';

var API = (function() {
  var BASE = '/api/v1';

  function APIError(status, body) {
    this.status = status;
    this.message = (body && body.error) || 'Request failed';
    this.code = (body && body.code) || '';
  }
  APIError.prototype = Object.create(Error.prototype);
  APIError.prototype.constructor = APIError;

  function parseJSON(res) {
    return res.text().then(function(text) {
      if (!text) return {};
      try {
        return JSON.parse(text);
      } catch (err) {
        return { error: text };
      }
    });
  }

  function login() {
    var token = window.prompt('API token');
    if (!token) {
      return Promise.reject(new APIError(401, { error: 'authentication required', code: 'UNAUTHORIZED' }));
    }
    return fetch(BASE + '/auth/session', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ token: token })
    }).then(function(res) {
      return parseJSON(res).then(function(data) {
        if (!res.ok) throw new APIError(res.status, data);
        return data;
      });
    });
  }

  function request(method, path, body, retried) {
    var opts = {
      method: method,
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(BASE + path, opts).then(function(res) {
      return parseJSON(res).then(function(data) {
        if (res.status === 401 && !retried) {
          return login().then(function() {
            return request(method, path, body, true);
          });
        }
        if (!res.ok) throw new APIError(res.status, data);
        return data;
      });
    });
  }

  return {
    APIError: APIError,

    listApps: function() {
      return request('GET', '/applications');
    },

    getApp: function(name) {
      return request('GET', '/applications/' + encodeURIComponent(name));
    },

    syncApp: function(name) {
      return request('POST', '/applications/' + encodeURIComponent(name) + '/sync');
    },

    getDiff: function(name) {
      return request('GET', '/applications/' + encodeURIComponent(name) + '/diff');
    },

    getHistory: function(name) {
      return request('GET', '/applications/' + encodeURIComponent(name) + '/history');
    },

    getEvents: function(name) {
      return request('GET', '/applications/' + encodeURIComponent(name) + '/events');
    },

    getSystemInfo: function() {
      return request('GET', '/system');
    },

    getAppMetrics: function(name) {
      return request('GET', '/applications/' + encodeURIComponent(name) + '/metrics');
    },

    getHostStats: function() {
      return request('GET', '/system/stats');
    },

    getPollInterval: function() {
      return request('GET', '/settings/poll-interval');
    },

    setPollInterval: function(intervalMs) {
      return request('PUT', '/settings/poll-interval', { intervalMs: intervalMs });
    },

    getServiceDetail: function(appName, svcName) {
      return request('GET', '/applications/' + encodeURIComponent(appName) + '/services/' + encodeURIComponent(svcName));
    },

    getServiceLogs: function(appName, svcName, tail) {
      return request('GET', '/applications/' + encodeURIComponent(appName) + '/services/' + encodeURIComponent(svcName) + '/logs?tail=' + (tail || 200));
    },

    rollbackApp: function(name, targetSHA) {
      return request('POST', '/applications/' + encodeURIComponent(name) + '/rollback', { targetSHA: targetSHA });
    }
  };
})();
