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

  function request(method, path) {
    return fetch(BASE + path, {
      method: method,
      headers: { 'Accept': 'application/json' }
    }).then(function(res) {
      return res.json().then(function(data) {
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
    }
  };
})();
