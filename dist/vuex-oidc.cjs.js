'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var oidcClient = require('oidc-client');

var objectAssign = function objectAssign(objects) {
  return objects.reduce(function (r, o) {
    Object.keys(o || {}).forEach(function (k) {
      r[k] = o[k];
    });
    return r;
  }, {});
};

var parseJwt = function parseJwt(token) {
  try {
    var base64Url = token.split('.')[1];
    var base64 = base64Url.replace('-', '+').replace('_', '/');
    return JSON.parse(window.atob(base64));
  } catch (error) {
    return {};
  }
};

var firstLetterUppercase = function firstLetterUppercase(string) {
  return string && string.length > 0 ? string.charAt(0).toUpperCase() + string.slice(1) : '';
};

var camelCaseToSnakeCase = function camelCaseToSnakeCase(string) {
  return string.split(/(?=[A-Z])/).join('_').toLowerCase();
};

var utils = /*#__PURE__*/Object.freeze({
  objectAssign: objectAssign,
  parseJwt: parseJwt,
  firstLetterUppercase: firstLetterUppercase,
  camelCaseToSnakeCase: camelCaseToSnakeCase
});

var defaultOidcConfig = {
  userStore: new oidcClient.WebStorageStateStore(),
  loadUserInfo: true
};

var requiredConfigProperties = ['authority', 'client_id', 'redirect_uri', 'response_type', 'scope'];

var settingsThatAreSnakeCasedInOidcClient = ['clientId', 'redirectUri', 'responseType', 'maxAge', 'uiLocales', 'loginHint', 'acrValues', 'postLogoutRedirectUri', 'popupRedirectUri', 'silentRedirectUri'];

var snakeCasedSettings = function snakeCasedSettings(oidcSettings) {
  settingsThatAreSnakeCasedInOidcClient.forEach(function (setting) {
    if (typeof oidcSettings[setting] !== 'undefined') {
      oidcSettings[camelCaseToSnakeCase(setting)] = oidcSettings[setting];
    }
  });
  return oidcSettings;
};

var getOidcConfig = function getOidcConfig(oidcSettings) {
  return objectAssign([defaultOidcConfig, snakeCasedSettings(oidcSettings), { automaticSilentRenew: false // automaticSilentRenew is handled in vuex and not by user manager
  }]);
};

var createOidcUserManager = function createOidcUserManager(oidcSettings) {
  var oidcConfig = getOidcConfig(oidcSettings);
  requiredConfigProperties.forEach(function (requiredProperty) {
    if (!oidcConfig[requiredProperty]) {
      throw new Error('Required oidc setting ' + requiredProperty + ' missing for creating UserManager');
    }
  });
  return new oidcClient.UserManager(oidcConfig);
};

var addUserManagerEventListener = function addUserManagerEventListener(oidcUserManager, eventName, eventListener) {
  var addFnName = 'add' + firstLetterUppercase(eventName);
  if (typeof oidcUserManager.events[addFnName] === 'function' && typeof eventListener === 'function') {
    oidcUserManager.events[addFnName](eventListener);
  }
};

var removeUserManagerEventListener = function removeUserManagerEventListener(oidcUserManager, eventName, eventListener) {
  var removeFnName = 'remove' + firstLetterUppercase(eventName);
  if (typeof oidcUserManager.events[removeFnName] === 'function' && typeof eventListener === 'function') {
    oidcUserManager.events[removeFnName](eventListener);
  }
};

var processSilentSignInCallback = function processSilentSignInCallback() {
  new oidcClient.UserManager().signinSilentCallback();
};

var tokenExp = function tokenExp(token) {
  if (token) {
    var parsed = parseJwt(token);
    return parsed.exp ? parsed.exp * 1000 : null;
  }
  return null;
};

var tokenIsExpired = function tokenIsExpired(token) {
  var tokenExpiryTime = tokenExp(token);
  if (tokenExpiryTime) {
    return tokenExpiryTime < new Date().getTime();
  }
  return false;
};

// Use native custom event or DIY for IE
function createCustomEvent(eventName, detail, params) {
  var prefixedEventName = 'vuexoidc:' + eventName;

  if (typeof window.CustomEvent === 'function') {
    params = objectAssign([params, { detail: detail }]);
    return new window.CustomEvent(prefixedEventName, params);
  }

  /* istanbul ignore next */
  params = params || { bubbles: false, cancelable: false };
  params = objectAssign([params, { detail: detail }]);
  var evt = document.createEvent('CustomEvent');
  evt.initCustomEvent(prefixedEventName, params.bubbles, params.cancelable, params.detail);
  return evt;
}

function dispatchCustomBrowserEvent(eventName) {
  var detail = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
  var params = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};

  if (window) {
    var event = createCustomEvent(eventName, objectAssign([{}, detail]), params);
    window.dispatchEvent(event);
  }
}

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) { arr2[i] = arr[i]; } return arr2; } else { return Array.from(arr); } }

var createStoreModule = (function (oidcSettings) {
  var storeSettings = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
  var oidcEventListeners = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};

  var oidcConfig = getOidcConfig(oidcSettings);
  var oidcUserManager = createOidcUserManager(oidcSettings);
  storeSettings = objectAssign([{ namespaced: false }, storeSettings]);

  // Add event listeners passed into factory function
  Object.keys(oidcEventListeners).forEach(function (eventName) {
    addUserManagerEventListener(oidcUserManager, eventName, oidcEventListeners[eventName]);
  });

  if (storeSettings.dispatchEventsOnWindow) {
    // Dispatch oidc-client events on window (if in browser)
    var userManagerEvents = ['userLoaded', 'userUnloaded', 'accessTokenExpiring', 'accessTokenExpired', 'silentRenewError', 'userSignedOut'];
    userManagerEvents.forEach(function (eventName) {
      addUserManagerEventListener(oidcUserManager, eventName, function (e) {
        var detail = e && e.detail ? e.detail : {};
        dispatchCustomBrowserEvent(eventName, detail);
      });
    });
  }

  var state = {
    access_token: null,
    id_token: null,
    user: null,
    is_checked: false,
    events_are_bound: false,
    error: null
  };

  var isAuthenticated = function isAuthenticated(state) {
    if (state.id_token) {
      return true;
    }
    return false;
  };

  var isOidcCallback = function isOidcCallback(route) {
    var meta = route.meta;
    if (Array.isArray(route.meta)) {
      meta = Object.assign.apply(Object, [{}].concat(_toConsumableArray(route.meta)));
    }
    if (meta.isOidcCallback) {
      return true;
    }
    return false;
  };

  var isPublic = function isPublic(route) {
    var meta = route.meta;
    if (Array.isArray(route.meta)) {
      meta = Object.assign.apply(Object, [{}].concat(_toConsumableArray(route.meta)));
    }
    if (meta.isPublic) {
      return true;
    }
    return false;
  };

  /* istanbul ignore next */
  var getters = {
    oidcIsAuthenticated: function oidcIsAuthenticated(state) {
      return isAuthenticated(state);
    },
    oidcUser: function oidcUser(state) {
      return state.user;
    },
    oidcAccessToken: function oidcAccessToken(state) {
      return tokenIsExpired(state.access_token) ? null : state.access_token;
    },
    oidcAccessTokenExp: function oidcAccessTokenExp(state) {
      return tokenExp(state.access_token);
    },
    oidcIdToken: function oidcIdToken(state) {
      return tokenIsExpired(state.id_token) ? null : state.id_token;
    },
    oidcIdTokenExp: function oidcIdTokenExp(state) {
      return tokenExp(state.id_token);
    },
    oidcAuthenticationIsChecked: function oidcAuthenticationIsChecked(state) {
      return state.is_checked;
    },
    oidcError: function oidcError(state) {
      return state.error;
    }
  };

  var actions = {
    oidcCheckAccess: function oidcCheckAccess(context, route) {
      return new Promise(function (resolve) {
        if (isOidcCallback(route)) {
          resolve(true);
          return;
        }
        var hasAccess = true;
        var getUserPromise = new Promise(function (resolve) {
          oidcUserManager.getUser().then(function (user) {
            resolve(user);
          }).catch(function () {
            resolve(null);
          });
        });
        var isAuthenticatedInStore = isAuthenticated(context.state);
        getUserPromise.then(function (user) {
          if (!user || user.expired) {
            if (isAuthenticatedInStore) {
              context.commit('unsetOidcAuth');
            }
            if (isPublic(route)) {
              if (oidcConfig.silent_redirect_uri) {
                context.dispatch('authenticateOidcSilent');
              }
            } else {
              context.dispatch('authenticateOidc', route.path);
              hasAccess = false;
            }
          } else {
            context.dispatch('oidcWasAuthenticated', user);
            if (!isAuthenticatedInStore) {
              if (oidcEventListeners && typeof oidcEventListeners.userLoaded === 'function') {
                oidcEventListeners.userLoaded(user);
              }
              if (storeSettings.dispatchEventsOnWindow) {
                dispatchCustomBrowserEvent('userLoaded', user);
              }
            }
          }
          resolve(hasAccess);
        });
      });
    },
    authenticateOidc: function authenticateOidc(context, redirectPath) {
      redirectPath += (document.location.search || '') + (document.location.hash || '');
      sessionStorage.setItem('vuex_oidc_active_route', redirectPath);
      oidcUserManager.signinRedirect().catch(function (err) {
        context.commit('setOidcError', err);
      });
    },
    oidcSignInCallback: function oidcSignInCallback(context) {
      return new Promise(function (resolve, reject) {
        oidcUserManager.signinRedirectCallback().then(function (user) {
          context.dispatch('oidcWasAuthenticated', user);
          resolve(sessionStorage.getItem('vuex_oidc_active_route') || '/');
        }).catch(function (err) {
          context.commit('setOidcError', err);
          context.commit('setOidcAuthIsChecked');
          reject(err);
        });
      });
    },
    authenticateOidcSilent: function authenticateOidcSilent(context) {
      oidcUserManager.signinSilent().then(function (user) {
        context.dispatch('oidcWasAuthenticated', user);
      }).catch(function (err) {
        context.commit('setOidcError', err);
        context.commit('setOidcAuthIsChecked');
      });
    },
    oidcWasAuthenticated: function oidcWasAuthenticated(context, user) {
      context.commit('setOidcAuth', user);
      if (!context.state.events_are_bound) {
        oidcUserManager.events.addAccessTokenExpired(function () {
          context.commit('unsetOidcAuth');
        });
        if (oidcSettings.automaticSilentRenew) {
          oidcUserManager.events.addAccessTokenExpiring(function () {
            context.dispatch('authenticateOidcSilent');
          });
        }
        context.commit('setOidcEventsAreBound');
      }
      context.commit('setOidcAuthIsChecked');
    },
    getOidcUser: function getOidcUser(context) {
      /* istanbul ignore next */
      oidcUserManager.getUser().then(function (user) {
        context.commit('setOidcUser', user);
      });
    },
    addOidcEventListener: function addOidcEventListener(context, payload) {
      /* istanbul ignore next */
      addUserManagerEventListener(oidcUserManager, payload.eventName, payload.eventListener);
    },
    removeOidcEventListener: function removeOidcEventListener(context, payload) {
      /* istanbul ignore next */
      removeUserManagerEventListener(oidcUserManager, payload.eventName, payload.eventListener);
    },
    signOutOidc: function signOutOidc(context) {
      /* istanbul ignore next */
      oidcUserManager.signoutRedirect().then(function () {
        context.commit('unsetOidcAuth');
      });
    }
  };

  /* istanbul ignore next */
  var mutations = {
    setOidcAuth: function setOidcAuth(state, user) {
      state.id_token = user.id_token;
      state.access_token = user.access_token;
      state.user = user.profile;
      state.error = null;
    },
    setOidcUser: function setOidcUser(state, user) {
      state.user = user.profile;
    },
    unsetOidcAuth: function unsetOidcAuth(state) {
      state.id_token = null;
      state.access_token = null;
      state.user = null;
    },
    setOidcAuthIsChecked: function setOidcAuthIsChecked(state) {
      state.is_checked = true;
    },
    setOidcEventsAreBound: function setOidcEventsAreBound(state) {
      state.events_are_bound = true;
    },
    setOidcError: function setOidcError(state, error) {
      state.error = error && error.message ? error.message : error;
    }
  };

  var module = objectAssign([storeSettings, {
    state: state,
    getters: getters,
    actions: actions,
    mutations: mutations
  }]);

  if (typeof module.dispatchEventsOnWindow !== 'undefined') {
    delete module.dispatchEventsOnWindow;
  }

  return module;
});

var createRouterMiddleware = (function (store, vuexNamespace) {
  return function (to, from, next) {
    store.dispatch((vuexNamespace ? vuexNamespace + '/' : '') + 'oidcCheckAccess', to).then(function (hasAccess) {
      if (hasAccess) {
        next();
      }
    });
  };
});

var vuexOidcCreateUserManager = createOidcUserManager;

var vuexOidcCreateStoreModule = createStoreModule;

var vuexOidcCreateRouterMiddleware = createRouterMiddleware;

var vuexOidcProcessSilentSignInCallback = processSilentSignInCallback;

var vuexOidcUtils = utils;

var vuexDispatchCustomBrowserEvent = dispatchCustomBrowserEvent;

exports.vuexOidcCreateUserManager = vuexOidcCreateUserManager;
exports.vuexOidcCreateStoreModule = vuexOidcCreateStoreModule;
exports.vuexOidcCreateRouterMiddleware = vuexOidcCreateRouterMiddleware;
exports.vuexOidcProcessSilentSignInCallback = vuexOidcProcessSilentSignInCallback;
exports.vuexOidcUtils = vuexOidcUtils;
exports.vuexDispatchCustomBrowserEvent = vuexDispatchCustomBrowserEvent;
