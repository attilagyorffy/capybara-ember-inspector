(function(adapter) {

if (typeof define !== 'function' && typeof requireModule !== 'function') {
  var define, requireModule;

  (function() {
    var registry = {}, seen = {};

    define = function(name, deps, callback) {
      registry[name] = { deps: deps, callback: callback };
    };

    requireModule = function(name) {
      if (seen[name]) { return seen[name]; }
      seen[name] = {};

      var mod = registry[name];

      if (!mod) {
        throw new Error("Module: '" + name + "' not found.");
      }

      var deps = mod.deps,
          callback = mod.callback,
          reified = [],
          exports;

      for (var i=0, l=deps.length; i<l; i++) {
        if (deps[i] === 'exports') {
          reified.push(exports = {});
        } else {
          reified.push(requireModule(deps[i]));
        }
      }

      var value = callback.apply(this, reified);
      return seen[name] = exports || value;
    };

    define.registry = registry;
    define.seen = seen;
  })();
}

/**
  This is a wrapper for `ember-debug.js`
  Wraps the script in a function,
  and ensures that the script is executed
  only after the dom is ready
  and the application has initialized.

  Also responsible for sending the first tree.
**/

var currentAdapter = 'basic';
if (typeof adapter !== 'undefined') {
  currentAdapter = adapter;
}

(function(adapter) {

  // RSVP promise inspection
  // First thing because of
  var events = [], callbacks = {};
  if (!window.__PROMISE_INSTRUMENTATION__) {
    callbacks = window.__PROMISE_INSTRUMENTATION__ = {};
    var eventNames = ['created', 'fulfilled', 'rejected', 'chained'];

    for (var i = 0; i < eventNames.length; i++) {
      (function(eventName) {
        callbacks[eventName] = function(options) {
          events.push({
            eventName: eventName,
            options: options
          });
        };
      }(eventNames[i]));

    }
  }


  function inject() {
    window.EmberInspector = Ember.Debug = requireModule('ember_debug')['default'];
  }

  onEmberReady(function() {
    if (!window.Ember) {
      return;
    }
    // global to prevent injection
    if (window.NO_EMBER_DEBUG) {
      return;
    }
    // prevent from injecting twice
    if (!Ember.Debug) {
      inject();
      Ember.Debug.Adapter = requireModule('adapters/' + adapter)['default'];

      onApplicationStart(function() {
        Ember.Debug.setProperties({
          existingEvents: events,
          existingCallbacks: callbacks
        });
        Ember.Debug.start();
      });
    }
  });

  function onEmberReady(callback) {
    onReady(function() {
      if (window.Ember) {
        callback();
      } else {
        window.addEventListener('Ember.Application', callback, false);
      }
    });
  }

  function onReady(callback) {
    if (document.readyState === 'complete') {
      setTimeout(completed);
    } else {
      document.addEventListener( "DOMContentLoaded", completed, false);
      // For some reason DOMContentLoaded doesn't always work
      window.addEventListener( "load", completed, false );
    }

    function completed() {
      document.removeEventListener( "DOMContentLoaded", completed, false );
      window.removeEventListener( "load", completed, false );
      callback();
    }
  }

  // There's probably a better way
  // to determine when the application starts
  // but this definitely works
  function onApplicationStart(callback) {
    if (typeof Ember === 'undefined') {
      return;
    }
    var documentElement = document.documentElement;
    var interval = setInterval(function() {
      if ((documentElement.dataset.emberExtension || (EMBER_INSPECTOR_CONFIG && EMBER_INSPECTOR_CONFIG.remoteDebugSocket)) && Ember.BOOTED) {
       clearInterval(interval);
       callback();
      }
    }, 1);
  }

}(currentAdapter));

define("adapters/basic", 
  ["exports"],
  function(__exports__) {
    "use strict";
    var BasicAdapter = Ember.Object.extend({
      debug: function() {
        console.debug.apply(console, arguments);
      },
      log: function() {
        console.log.apply(console, arguments);
      },
      /**
        Used to send messages to EmberExtension

        @param {Object} type the message to the send
      */
      sendMessage: function(options) {},

      /**
        Register functions to be called
        when a message from EmberExtension is received

        @param {Function} callback
      */
      onMessageReceived: function(callback) {
        this.get('_messageCallbacks').pushObject(callback);
      },

      /**
        Inspect a specific element.  This usually
        means using the current environment's tools
        to inspect the element in the DOM.

        For example, in chrome, `inspect(elem)`
        will open the Elements tab in dev tools
        and highlight the element.

        @param {DOM Element} elem
      */
      inspectElement: function(elem) {},

      _messageCallbacks: Ember.computed(function() { return Ember.A(); }).property(),

      _messageReceived: function(message) {
        this.get('_messageCallbacks').forEach(function(callback) {
          callback.call(null, message);
        });
      }
    });

    __exports__["default"] = BasicAdapter;
  });
define("adapters/bookmarklet", 
  ["adapters/basic","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var BasicAdapter = __dependency1__["default"];
    var $ = Ember.$;

    __exports__["default"] = BasicAdapter.extend({
      init: function() {
        this._super();
        this._connect();
      },

      sendMessage: function(options) {
        options = options || {};
        window.emberInspector.w.postMessage(options, window.emberInspector.url);
      },

      _connect: function() {
        var self = this;
        window.addEventListener('message', function(e) {
          if (e.origin !== window.emberInspector.url) {
            return;
          }
          var message = e.data;
          if (message.from === 'devtools') {
            self._messageReceived(message);
          }
        });

        $(window).on('unload', function() {
            self.sendMessage({
              unloading: true
            });
        });
      }
    });
  });
define("adapters/chrome", 
  ["adapters/basic","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var BasicAdapter = __dependency1__["default"];

    var ChromeAdapter = BasicAdapter.extend({
      init: function() {
        this._super();
        this._connect();
      },

      sendMessage: function(options) {
        options = options || {};
        this.get('_chromePort').postMessage(options);
      },

      inspectElement: function(elem) {
        inspect(elem);
      },

      _channel: Ember.computed(function() {
        return new MessageChannel();
      }).property(),

      _chromePort: Ember.computed(function() {
        return this.get('_channel.port1');
      }).property(),

      _connect: function() {
        var channel = this.get('_channel'),
            self = this,
            chromePort = this.get('_chromePort');

        window.postMessage('debugger-client', [channel.port2], '*');

        chromePort.addEventListener('message', function(event) {
          var message = event.data;
          Ember.run(function() {
            self._messageReceived(message);
          });
        });

        chromePort.start();

      }
    });

    __exports__["default"] = ChromeAdapter;
  });
define("adapters/firefox", 
  ["adapters/basic","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var BasicAdapter = __dependency1__["default"];

    var FirefoxAdapter = BasicAdapter.extend({
      init: function() {
        this._super();
        this._connect();
      },

      debug: function() {
        // WORKAROUND: temporarily workaround issues with firebug console object:
        // - https://github.com/tildeio/ember-extension/issues/94
        // - https://github.com/firebug/firebug/pull/109
        // - https://code.google.com/p/fbug/issues/detail?id=7045
        try {
          this._super.apply(this, arguments);
        } catch(e) { }
      },
      log: function() {
        // WORKAROUND: temporarily workaround issues with firebug console object:
        // - https://github.com/tildeio/ember-extension/issues/94
        // - https://github.com/firebug/firebug/pull/109
        // - https://code.google.com/p/fbug/issues/detail?id=7045
        try {
          this._super.apply(this, arguments);
        } catch(e) { }
      },

      sendMessage: function(options) {
        options = options || {};
        var event = document.createEvent("CustomEvent");
        event.initCustomEvent("ember-debug-send", true, true, options);
        document.documentElement.dispatchEvent(event);
      },

      inspectElement: function(elem) {
        this.sendMessage({
          type: 'view:devtools:inspectDOMElement',
          elementSelector: "#" + elem.getAttribute('id')
        });
      },

      _connect: function() {
        var self = this;

        window.addEventListener('ember-debug-receive', function(event) {
          var message = event.detail;
          Ember.run(function() {
            // FIX: needed to fix permission denied exception on Firefox >= 30
            // - https://github.com/emberjs/ember-inspector/issues/147
            // - https://blog.mozilla.org/addons/2014/04/10/changes-to-unsafewindow-for-the-add-on-sdk/
            switch (typeof message) {
            case "string":
              message = JSON.parse(message);
              break;
            case "object":
              break;
            default:
              throw new Error("ember-debug-receive: string or object expected");
            }
            self._messageReceived(message);
          });
        });
      }

    });

    __exports__["default"] = FirefoxAdapter;
  });
define("adapters/websocket", 
  ["adapters/basic","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var BasicAdapter = __dependency1__["default"];

    var computed = Ember.computed;

    var WebsocketAdapter = BasicAdapter.extend({
      init: function() {
        this._super();
        this._connect();
      },

      sendMessage: function(options) {
        options = options || {};
        this.get('socket').emit('emberInspectorMessage', options);
      },

      socket: computed(function() {
        return window.EMBER_INSPECTOR_CONFIG.remoteDebugSocket;
      }).property(),

      _connect: function() {
        var self = this;
        this.get('socket').on('emberInspectorMessage', function(message) {
          Ember.run(function() {
            self._messageReceived(message);
          });
        });
      },
      
      _disconnect: function() {
        this.get('socket').removeAllListeners("emberInspectorMessage");
      },

      willDestroy: function() {
        this._disconnect();
      }
    });

    __exports__["default"] = WebsocketAdapter;
  });
define("container_debug", 
  ["mixins/port_mixin","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var PortMixin = __dependency1__["default"];

    var EmberObject = Ember.Object;
    var computed = Ember.computed;
    var oneWay = computed.oneWay;

    __exports__["default"] = EmberObject.extend(PortMixin, {
      namespace: null,

      port: oneWay('namespace.port').readOnly(),
      application: oneWay('namespace.application').readOnly(),
      objectInspector: oneWay('namespace.objectInspector').readOnly(),

      container: computed(function() {
        return this.get('application.__container__');
      }).property('application'),

      portNamespace: 'container',

      TYPES_TO_SKIP: computed(function() {
        return [
          'component-lookup',
          'container-debug-adapter',
          'resolver-for-debugging',
          'event_dispatcher'
        ];
      }).property(),

      typeFromKey: function(key) {
        return key.split(':').shift();
      },

      nameFromKey: function(key) {
        return key.split(':').pop();
      },

      shouldHide: function(type) {
        return type[0] === '-' || this.get('TYPES_TO_SKIP').indexOf(type) !== -1;
      },

      instancesByType: function() {
        var key, instancesByType = {};
        var cache = this.get('container').cache;
        // Detect if InheritingDict (from Ember < 1.8)
        if (typeof cache.dict !== 'undefined' && typeof cache.eachLocal !== 'undefined') {
          cache = cache.dict;
        }
        for (key in cache) {
          var type = this.typeFromKey(key);
          if (this.shouldHide(type) ){ continue; }
          if (instancesByType[type] === undefined) {
            instancesByType[type] = [];
          }
          instancesByType[type].push({
            fullName: key,
            instance: cache[key]
          });
        }
        return instancesByType;
      },

      getTypes: function() {
        var key, types = [];
        var instancesByType = this.instancesByType();
        for (key in instancesByType) {
          types.push({ name: key, count: instancesByType[key].length });
        }
        return types;
      },

      getInstances: function(type) {
        var instancesByType = this.instancesByType();
        return instancesByType[type].map(function(item) {
          return {
            name: this.nameFromKey(item.fullName),
            fullName: item.fullName,
            inspectable: this.get('objectInspector').canSend(item.instance)
          };
        }.bind(this));
      },

      messages: {
        getTypes: function() {
          this.sendMessage('types', {
            types: this.getTypes()
          });
        },
        getInstances: function(message) {
          this.sendMessage('instances', {
            instances: this.getInstances(message.containerType)
          });
        },
        sendInstanceToConsole: function(message) {
          var instance = this.get('container').lookup(message.name);
          this.get('objectToConsole').sendValueToConsole(instance);
        }
      }
    });
  });
define("data_debug", 
  ["mixins/port_mixin","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var PortMixin = __dependency1__["default"];

    var DataDebug = Ember.Object.extend(PortMixin, {
      init: function() {
        this._super();
        this.sentTypes = {};
        this.sentRecords = {};
      },

      sentTypes: {},
      sentRecords: {},

      releaseTypesMethod: null,
      releaseRecordsMethod: null,

      adapter: Ember.computed(function() {
        var container = this.get('application').__container__;
        // dataAdapter:main is deprecated
        return (container.resolve('data-adapter:main') && container.lookup('data-adapter:main')) ||
        (container.resolve('dataAdapter:main') && container.lookup('dataAdapter:main'));
      }).property('application'),

      namespace: null,

      port: Ember.computed.alias('namespace.port'),
      application: Ember.computed.alias('namespace.application'),
      objectInspector: Ember.computed.alias('namespace.objectInspector'),

      portNamespace: 'data',

      modelTypesAdded: function(types) {
        var self = this, typesToSend;
        typesToSend = types.map(function(type) {
          return self.wrapType(type);
        });
        this.sendMessage('modelTypesAdded', {
          modelTypes: typesToSend
        });
      },

      modelTypesUpdated: function(types) {
        var self = this;
        var typesToSend = types.map(function(type) {
          return self.wrapType(type);
        });
        self.sendMessage('modelTypesUpdated', {
          modelTypes: typesToSend
        });
      },

      wrapType: function(type) {
        var objectId = Ember.guidFor(type.object);
        this.sentTypes[objectId] = type;

        return {
          columns: type.columns,
          count: type.count,
          name: type.name,
          objectId: objectId
        };
      },


      recordsAdded: function(recordsReceived) {
        var self = this, records;
        records = recordsReceived.map(function(record) {
          return self.wrapRecord(record);
        });
        self.sendMessage('recordsAdded', {
          records: records
        });
      },

      recordsUpdated: function(recordsReceived) {
        var self = this;
        var records = recordsReceived.map(function(record) {
          return self.wrapRecord(record);
        });
        self.sendMessage('recordsUpdated', {
          records: records
        });
      },

      recordsRemoved: function(idx, count) {
        this.sendMessage('recordsRemoved', {
          index: idx,
          count: count
        });
      },

      wrapRecord: function(record) {
        var objectId = Ember.guidFor(record.object);
        var self = this;
        var columnValues = {};
        var searchKeywords = [];
        this.sentRecords[objectId] = record;
        // make objects clonable
        for (var i in record.columnValues) {
          columnValues[i] = this.get('objectInspector').inspect(record.columnValues[i]);
        }
        // make sure keywords can be searched and clonable
        searchKeywords = Ember.A(record.searchKeywords).filter(function(keyword) {
          return (typeof keyword === 'string' || typeof keyword === 'number');
        });
        return {
          columnValues: columnValues,
          searchKeywords: searchKeywords,
          filterValues: record.filterValues,
          color: record.color,
          objectId: objectId
        };
      },

      releaseTypes: function() {
        if(this.releaseTypesMethod) {
          this.releaseTypesMethod();
          this.releaseTypesMethod = null;
          this.sentTypes = {};
        }
      },

      releaseRecords: function(typeObjectId) {
        if (this.releaseRecordsMethod) {
          this.releaseRecordsMethod();
          this.releaseRecordsMethod = null;
          this.sentRecords = {};
        }
      },

      willDestroy: function() {
        this._super();
        this.releaseRecords();
        this.releaseTypes();
      },

      messages: {
        checkAdapter: function() {
          this.sendMessage('hasAdapter', { hasAdapter: !!this.get('adapter') });
        },

        getModelTypes: function() {
          var self = this;
          this.releaseTypes();
          this.releaseTypesMethod = this.get('adapter').watchModelTypes(
            function(types) {
              self.modelTypesAdded(types);
            }, function(types) {
            self.modelTypesUpdated(types);
          });
        },

        releaseModelTypes: function() {
          this.releaseTypes();
        },

        getRecords: function(message) {
          var type = this.sentTypes[message.objectId], self = this;
          this.releaseRecords();

          var releaseMethod = this.get('adapter').watchRecords(type.object,
            function(recordsReceived) {
              self.recordsAdded(recordsReceived);
            },
            function(recordsUpdated) {
              self.recordsUpdated(recordsUpdated);
            },
            function() {
              self.recordsRemoved.apply(self, arguments);
            }
          );
          this.releaseRecordsMethod = releaseMethod;
        },

        releaseRecords: function() {
          this.releaseRecords();
        },

        inspectModel: function(message) {
          this.get('objectInspector').sendObject(this.sentRecords[message.objectId].object);
        },

        getFilters: function() {
          this.sendMessage('filters', {
            filters: this.get('adapter').getFilters()
          });
        }
      }
    });

    __exports__["default"] = DataDebug;
  });
define("ember_debug", 
  ["adapters/basic","port","object_inspector","general_debug","render_debug","view_debug","route_debug","data_debug","promise_debug","container_debug","exports"],
  function(__dependency1__, __dependency2__, __dependency3__, __dependency4__, __dependency5__, __dependency6__, __dependency7__, __dependency8__, __dependency9__, __dependency10__, __exports__) {
    "use strict";
    var BasicAdapter = __dependency1__["default"];
    var Port = __dependency2__["default"];
    var ObjectInspector = __dependency3__["default"];
    var GeneralDebug = __dependency4__["default"];
    var RenderDebug = __dependency5__["default"];
    var ViewDebug = __dependency6__["default"];
    var RouteDebug = __dependency7__["default"];
    var DataDebug = __dependency8__["default"];
    var PromiseDebug = __dependency9__["default"];
    var ContainerDebug = __dependency10__["default"];

    var EmberDebug;

    EmberDebug = Ember.Namespace.extend({

      application: null,
      started: false,

      Port: Port,
      Adapter: BasicAdapter,


      // These two are used to make RSVP start instrumentation
      // even before this object is created
      // all events triggered before creation are injected
      // to this object as `existingEvents`
      existingEvents: Ember.computed(function() { return []; }).property(),
      existingCallbacks: Ember.computed(function() { return {}; }).property(),

      start: function() {
        if (this.get('started')) {
          this.reset();
          return;
        }
        this.set('started', true);

        this.set('application', getApplication());

        this.reset();

        this.get("adapter").debug("Ember Inspector Active");
      },

      destroyContainer: function() {
        var self = this;
        ['dataDebug',
        'viewDebug',
        'routeDebug',
        'objectInspector',
        'generalDebug',
        'renderDebug',
        'promiseDebug',
        'containerDebug',
        ].forEach(function(prop) {
          var handler = self.get(prop);
          if (handler) {
            Ember.run(handler, 'destroy');
            self.set(prop, null);
          }
        });
      },

      startModule: function(prop, Module) {
        this.set(prop, Module.create({ namespace: this }));
      },

      reset: function() {
        this.destroyContainer();
        Ember.run(this, function() {

          this.startModule('adapter', this.Adapter);
          this.startModule('port', this.Port);

          this.startModule('generalDebug', GeneralDebug);
          this.startModule('renderDebug', RenderDebug);
          this.startModule('objectInspector', ObjectInspector);
          this.startModule('routeDebug', RouteDebug);
          this.startModule('viewDebug', ViewDebug);
          this.startModule('dataDebug', DataDebug);
          this.startModule('promiseDebug', PromiseDebug);
          this.startModule('containerDebug', ContainerDebug);

          this.generalDebug.sendBooted();
          this.viewDebug.sendTree();
        });
      },

      inspect: function(obj) {
        this.get('objectInspector').sendObject(obj);
        this.get('adapter').log('Sent to the Object Inspector');
        return obj;
      }

    }).create();

    function getApplication() {
      var namespaces = Ember.Namespace.NAMESPACES,
          application;

      namespaces.forEach(function(namespace) {
        if(namespace instanceof Ember.Application) {
          application = namespace;
          return false;
        }
      });
      return application;
    }

    __exports__["default"] = EmberDebug;
  });
define("general_debug", 
  ["mixins/port_mixin","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var PortMixin = __dependency1__["default"];

    var GeneralDebug = Ember.Object.extend(PortMixin, {
      namespace: null,

      port: Ember.computed.alias('namespace.port'),

      application: Ember.computed.alias('namespace.application'),

      promiseDebug: Ember.computed.alias('namespace.promiseDebug'),

      portNamespace: 'general',

      sendBooted: function() {
        this.sendMessage('applicationBooted', {
          booted: Ember.BOOTED
        });
      },

      messages: {
        applicationBooted: function() {
          this.sendBooted();
        },
        getLibraries: function() {
          var libraries = arrayize(Ember.libraries);
          this.sendMessage('libraries', { libraries: libraries });
        },
        refresh: function() {
          window.location.reload();
        }
      }
    });

    function arrayize(enumerable) {
      return Ember.A(enumerable).map(function(item) {
        return item;
      });
    }

    __exports__["default"] = GeneralDebug;
  });
define("libs/promise_assembler", 
  ["models/promise","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    /**
      Original implementation and the idea behind the `PromiseAssembler`,
      `Promise` model, and other work related to promise inspection was done
      by Stefan Penner (@stefanpenner) thanks to McGraw Hill Education (@mhelabs)
      and Yapp Labs (@yapplabs).
     */

    var Promise = __dependency1__["default"];

    var get = Ember.get;
    var alias = Ember.computed.alias;

    var PromiseAssembler = Ember.Object.extend(Ember.Evented, {
      // RSVP lib to debug
      RSVP: Ember.RSVP,

      all: Ember.computed(function() { return Ember.A(); }).property(),

      promiseIndex: Ember.computed(function() { return {}; }).property(),

      // injected on creation
      promiseDebug: null,

      existingEvents: alias('promiseDebug.existingEvents'),
      existingCallbacks: alias('promiseDebug.existingCallbacks'),

      start: function() {
        this.RSVP.configure('instrument', true);
        var self = this;

        this.promiseChained = function(e) {
          chain.call(self, e);
        };
        this.promiseRejected = function(e) {
          reject.call(self, e);
        };
        this.promiseFulfilled = function(e) {
          fulfill.call(self, e);
        };
        this.promiseCreated = function(e) {
          create.bind(self)(e);
        };


        this.RSVP.on('chained', this.promiseChained);
        this.RSVP.on('rejected', this.promiseRejected);
        this.RSVP.on('fulfilled', this.promiseFulfilled);
        this.RSVP.on('created',  this.promiseCreated);

        if (this.get('existingEvents')) {
          var callbacks = this.get('existingCallbacks');
          for (var eventName in callbacks) {
            this.RSVP.off(eventName, callbacks[eventName]);
          }
          var events = Ember.A(this.get('existingEvents'));
          events.forEach(function(e) {
            self['promise' + Ember.String.capitalize(e.eventName)].call(self, e.options);
          });
        }
      },

      stop: function() {
        this.RSVP.configure('instrument', false);
        this.RSVP.off('chained', this.promiseChained);
        this.RSVP.off('rejected', this.promiseRejected);
        this.RSVP.off('fulfilled', this.promiseFulfilled);
        this.RSVP.off('created',  this.promiseCreated);

        this.get('all').forEach(function(item) {
          item.destroy();
        });
        this.set('all', Ember.A());
        this.set('promiseIndex', {});

        this.promiseChained = null;
        this.promiseRejected = null;
        this.promiseFulfilled = null;
        this.promiseCreated = null;
      },

      willDestroy: function() {
        this.stop();
        this._super();
      },

      createPromise: function(props) {
        var promise = Promise.create(props),
            index = this.get('all.length');

        this.get('all').pushObject(promise);
        this.get('promiseIndex')[promise.get('guid')] = index;
        return promise;
      },

      find: function(guid){
        if (guid) {
          var index = this.get('promiseIndex')[guid];
          if (index !== undefined) {
            return this.get('all').objectAt(index);
          }
        } else {
          return this.get('all');
        }
      },

      findOrCreate: function(guid) {
        return this.find(guid) || this.createPromise({
          guid: guid
        });
      },

      updateOrCreate: function(guid, properties){
        var entry = this.find(guid);
        if (entry) {
          entry.setProperties(properties);
        } else {
          properties = Ember.copy(properties);
          properties.guid = guid;
          entry = this.createPromise(properties);
        }

        return entry;
      }
    });

    __exports__["default"] = PromiseAssembler;

    PromiseAssembler.reopenClass({
      supported: function() {
        return !!Ember.RSVP.on;
      }
    });

    var fulfill = function(event) {
      var guid = event.guid;
      var promise = this.updateOrCreate(guid, {
        label: event.label,
        settledAt: event.timeStamp,
        state: 'fulfilled',
        value: event.detail
      });
      this.trigger('fulfilled', {
        promise: promise
      });
    };


    var reject = function(event) {
      var guid = event.guid;
      var promise = this.updateOrCreate(guid, {
        label: event.label,
        settledAt: event.timeStamp,
        state: 'rejected',
        reason: event.detail
      });
      this.trigger('rejected', {
        promise: promise
      });
    };

    function chain(event) {
      /*jshint validthis:true */
      var guid = event.guid,
          promise = this.updateOrCreate(guid, {
            label: event.label,
            chainedAt: event.timeStamp
          }),
          children = promise.get('children'),
          child = this.findOrCreate(event.childGuid);

      child.set('parent', promise);
      children.pushObject(child);

      this.trigger('chained', {
        promise: promise,
        child: child
      });
    }

    function create(event) {
      /*jshint validthis:true */
      var guid = event.guid;

      var promise = this.updateOrCreate(guid, {
        label: event.label,
        createdAt: event.timeStamp,
        stack: event.stack
      });

      // todo fix ordering
      if (Ember.isNone(promise.get('state'))) {
        promise.set('state', 'created');
      }
      this.trigger('created', {
        promise: promise
      });
    }
  });
define("mixins/port_mixin", 
  ["exports"],
  function(__exports__) {
    "use strict";
    __exports__["default"] = Ember.Mixin.create({
      port: null,
      messages: {},

      portNamespace: null,

      init: function() {
        this.setupPortListeners();
      },

      willDestroy: function() {
        this.removePortListeners();
      },

      sendMessage: function(name, message) {
        this.get('port').send(this.messageName(name), message);
      },

      setupPortListeners: function() {
        var port = this.get('port'),
            self = this,
            messages = this.get('messages');

        for (var name in messages) {
          if(messages.hasOwnProperty(name)) {
            port.on(this.messageName(name), this, messages[name]);
          }
        }
      },

      removePortListeners: function() {
        var port = this.get('port'),
            self = this,
            messages = this.get('messages');

        for (var name in messages) {
          if(messages.hasOwnProperty(name)) {
            port.off(this.messageName(name), this, messages[name]);
          }
        }
      },

      messageName: function(name) {
        var messageName = name;
        if (this.get('portNamespace')) {
          messageName = this.get('portNamespace') + ':' + messageName;
        }
        return messageName;
      }
    });
  });
define("models/profile_manager", 
  ["models/profile_node","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var ProfileNode = __dependency1__["default"];
    var scheduleOnce = Ember.run.scheduleOnce;

    /**
     * A class for keeping track of active rendering profiles as a list.
     */
    var ProfileManager = function() {
      this.profiles = [];
      this.current = null;
      this.currentSet = [];
      this._profilesAddedCallbacks = [];
    };

    ProfileManager.prototype = {
      began: function(timestamp, payload, now) {
        this.current = new ProfileNode(timestamp, payload, this.current, now);
        return this.current;
      },

      ended: function(timestamp, payload, profileNode) {
        if (payload.exception) { throw payload.exception; }

        this.current = profileNode.parent;
        profileNode.finish(timestamp);

        // Are we done profiling an entire tree?
        if (!this.current) {
          this.currentSet.push(profileNode);
          // If so, schedule an update of the profile list
          scheduleOnce('afterRender', this, this._profilesFinished);
        }
      },

      clearProfiles: function() {
        this.profiles.length = 0;
      },

      _profilesFinished: function() {
        var firstNode = this.currentSet[0],
            parentNode = new ProfileNode(firstNode.start, {template: 'View Rendering'});

        parentNode.time = 0;
        this.currentSet.forEach(function(n) {
          parentNode.time += n.time;
          parentNode.children.push(n);
        });
        parentNode.calcDuration();

        this.profiles.push(parentNode);
        this._triggerProfilesAdded([parentNode]);
        this.currentSet = [];
      },

      _profilesAddedCallbacks: undefined, // set to array on init

      onProfilesAdded: function(context, callback) {
        this._profilesAddedCallbacks.push({
          context: context,
          callback: callback
        });
      },

      offProfilesAdded: function(context, callback) {
        var index = -1, item;
        for (var i = 0, l = this._profilesAddedCallbacks.length; i < l; i++) {
          item = this._profilesAddedCallbacks[i];
          if (item.context === context && item.callback === callback) {
            index = i;
          }
        }
        if (index > -1) {
          this._profilesAddedCallbacks.splice(index, 1);
        }
      },

      _triggerProfilesAdded: function(profiles) {
        this._profilesAddedCallbacks.forEach(function(item) {
          item.callback.call(item.context, profiles);
        });
      }
    };

    __exports__["default"] = ProfileManager;
  });
define("models/profile_node", 
  ["exports"],
  function(__exports__) {
    "use strict";
    /**
      A tree structure for assembling a list of render calls so they can be grouped and displayed nicely afterwards.

      @class ProfileNode
    **/
    var get = Ember.get;
    var guidFor = Ember.guidFor;

    var ProfileNode = function(start, payload, parent, now) {
      var name;
      this.start = start;
      this.timestamp = now || Date.now();

      if (payload) {
        if (payload.template) {
          name = payload.template;
        } else if (payload.view) {
          var view = payload.view;
          name = get(view, 'instrumentDisplay') || get(view, '_debugContainerKey');
          if (name) {
            name = name.replace(/^view:/, '');
          }
          this.viewGuid = guidFor(view);
        }

        if (!name && payload.object) {
          name = payload.object.toString().replace(/:?:ember\d+>$/, '').replace(/^</, '');
          if (!this.viewGuid) {
            var match = name.match(/:(ember\d+)>$/);
            if (match && match.length > 1) {
              this.viewGuid = match[1];
            }
          }
        }
      }

      this.name = name || 'Unknown view';

      if (parent) { this.parent = parent; }
      this.children = [];
    };

    ProfileNode.prototype = {
      finish: function(timestamp) {
        this.time = (timestamp - this.start);
        this.calcDuration();

        // Once we attach to our parent, we remove that reference
        // to avoid a graph cycle when serializing:
        if (this.parent) {
          this.parent.children.push(this);
          this.parent = null;
        }
      },

      calcDuration: function() {
        this.duration = Math.round(this.time * 100) / 100;
      }
    };

    __exports__["default"] = ProfileNode;
  });
define("models/promise", 
  ["exports"],
  function(__exports__) {
    "use strict";
    var dateComputed = function() {
      return Ember.computed(
        function(key, date) {
          if (date !== undefined) {
            if (date instanceof Date) {
              return date;
            } else if (typeof date === 'number' || typeof date === 'string') {
              return new Date(date);
            }
          }
          return null;
      }).property();
    };

    __exports__["default"] = Ember.Object.extend({
      createdAt: dateComputed(),
      settledAt: dateComputed(),
      chainedAt: dateComputed(),

      parent: null,

      children: Ember.computed(function() {
        return Ember.A();
      }).property(),

      level: Ember.computed(function() {
        var parent = this.get('parent');
        if (!parent) {
          return 0;
        }
        return parent.get('level') + 1;
      }).property('parent.level'),

      isSettled: Ember.computed(function() {
        return this.get('isFulfilled') || this.get('isRejected');
      }).property('state'),

      isFulfilled: Ember.computed(function() {
        return this.get('state') === 'fulfilled';
      }).property('state'),

      isRejected: Ember.computed(function() {
        return this.get('state') === 'rejected';
      }).property('state')

    });
  });
define("object_inspector", 
  ["mixins/port_mixin","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var PortMixin = __dependency1__["default"];
    var EmberObject = Ember.Object;
    var typeOf = Ember.typeOf;
    var Descriptor = Ember.Descriptor;
    var emberInspect = Ember.inspect;
    var computed = Ember.computed;
    var oneWay = computed.oneWay;
    var ComputedProperty = Ember.ComputedProperty;
    var get = Ember.get;
    var set = Ember.set;
    var guidFor = Ember.guidFor;
    var emberMeta = Ember.meta;
    var isNone = Ember.isNone;

    function inspectValue(value) {
      var string;
      if (value instanceof EmberObject) {
        return { type: "type-ember-object", inspect: value.toString() };
      } else if (isComputed(value)) {
        string = "<computed>";
        return { type: "type-descriptor", inspect: string, computed: true };
      } else if (value instanceof Descriptor) {
        return { type: "type-descriptor", inspect: value.toString(), computed: true };
      } else {
        return { type: "type-" + typeOf(value), inspect: inspect(value) };
      }
    }

    function inspect(value) {
      if (typeof value === 'function') {
        return "function() { ... }";
      } else if (value instanceof EmberObject) {
        return value.toString();
      } else if (typeOf(value) === 'array') {
        if (value.length === 0) { return '[]'; }
        else if (value.length === 1) { return '[ ' + inspect(value[0]) + ' ]'; }
        else { return '[ ' + inspect(value[0]) + ', ... ]'; }
      } else if (value instanceof Error) {
        return 'Error: ' + value.message;
      } else if (value === null) {
        return 'null';
      } else if(typeOf(value) === 'date') {
        return value.toString();
      } else if (typeof value === 'object') {
        // `Ember.inspect` is able to handle this use case,
        // but it is very slow as it loops over all props,
        // so summarize to just first 2 props
        var ret = [], v, count = 0, broken = false;
        for (var key in value) {
          if (value.hasOwnProperty(key)) {
            if (count++ > 1) {
              broken = true;
              break;
            }
            v = value[key];
            if (v === 'toString') { continue; } // ignore useless items
            if (typeOf(v) === 'function') { v = "function() { ... }"; }
            if (typeOf(v) === 'array') { v = '[Array : ' + v.length + ']'; }
            if (typeOf(v) === 'object') { v = '[Object]'; }
            ret.push(key + ": " + v);
          }
        }
        var suffix = ' }';
        if (broken) {
          suffix = ' ...}';
        }
        return '{ ' + ret.join(', ') + suffix;
      } else {
        return emberInspect(value);
      }
    }

    var ObjectInspector = EmberObject.extend(PortMixin, {
      namespace: null,

      adapter: oneWay('namespace.adapter'),

      port: oneWay('namespace.port'),

      application: oneWay('namespace.application'),

      init: function() {
        this._super();
        this.set('sentObjects', {});
        this.set('boundObservers', {});
      },

      willDestroy: function() {
        this._super();
        for (var objectId in this.sentObjects) {
          this.releaseObject(objectId);
        }
      },

      sentObjects: {},

      boundObservers: {},

      portNamespace: 'objectInspector',

      messages: {
        digDeeper: function(message) {
          this.digIntoObject(message.objectId, message.property);
        },
        releaseObject: function(message) {
          this.releaseObject(message.objectId);
        },
        calculate: function(message) {
          var value;
          value = this.valueForObjectProperty(message.objectId, message.property, message.mixinIndex);
          this.sendMessage('updateProperty', value);
          message.computed = true;
          this.bindPropertyToDebugger(message);
        },
        saveProperty: function(message) {
          this.saveProperty(message.objectId, message.mixinIndex, message.property, message.value);
        },
        sendToConsole: function(message) {
          this.sendToConsole(message.objectId, message.property);
        },
        sendControllerToConsole: function(message) {
          var container = this.get('application.__container__');
          this.sendValueToConsole(container.lookup('controller:' + message.name));
        },
        sendRouteHandlerToConsole: function(message) {
          var container = this.get('application.__container__');
          this.sendValueToConsole(container.lookup('route:' + message.name));
        },
        inspectRoute: function(message) {
          var container = this.get('application.__container__');
          this.sendObject(container.lookup('router:main').router.getHandler(message.name));
        },
        inspectController: function(message) {
          var container = this.get('application.__container__');
          this.sendObject(container.lookup('controller:' + message.name));
        },
        inspectById: function(message) {
          var obj = this.sentObjects[message.objectId];
          this.sendObject(obj);
        },
        inspectByContainerLookup: function(message) {
          var container = this.get('application.__container__');
          this.sendObject(container.lookup(message.name));
        }
      },

      canSend: function(val) {
        return (val instanceof EmberObject) || typeOf(val) === 'array';
      },

      saveProperty: function(objectId, mixinIndex, prop, val) {
        var object = this.sentObjects[objectId];
        set(object, prop, val);
      },

      sendToConsole: function(objectId, prop) {
        var object = this.sentObjects[objectId];
        var value;

        if (isNone(prop)) {
          value = this.sentObjects[objectId];
        } else {
          value =  get(object, prop);
        }

        this.sendValueToConsole(value);
      },

      sendValueToConsole: function(value) {
        window.$E = value;
        if (value instanceof Error) {
          value = value.stack;
        }
        this.get("adapter").log('Ember Inspector ($E): ', value);
      },

      digIntoObject: function(objectId, property) {
        var parentObject = this.sentObjects[objectId],
          object = get(parentObject, property);

        if (this.canSend(object)) {
          var details = this.mixinsForObject(object);

          this.sendMessage('updateObject', {
            parentObject: objectId,
            property: property,
            objectId: details.objectId,
            name: object.toString(),
            details: details.mixins
          });
        }
      },

      sendObject: function(object) {
        if (!this.canSend(object)) {
          throw new Error("Can't inspect " + object + ". Only Ember objects and arrays are supported.");
        }
        var details = this.mixinsForObject(object);
        this.sendMessage('updateObject', {
          objectId: details.objectId,
          name: object.toString(),
          details: details.mixins
        });

      },


      retainObject: function(object) {
        var meta = emberMeta(object),
            guid = guidFor(object),
            self = this;

        meta._debugReferences = meta._debugReferences || 0;
        meta._debugReferences++;

        this.sentObjects[guid] = object;

        if (meta._debugReferences === 1 && object.reopen) {
          // drop object on destruction
          var _oldWillDestroy = object._oldWillDestroy = object.willDestroy;
          object.reopen({
            willDestroy: function() {
              self.dropObject(guid);
              return _oldWillDestroy.apply(this, arguments);
            }
          });
        }

        return guid;
      },

      releaseObject: function(objectId) {
        var object = this.sentObjects[objectId];
        if(!object) {
          return;
        }
        var meta = emberMeta(object),
            guid = guidFor(object);

        meta._debugReferences--;

        if (meta._debugReferences === 0) {
          this.dropObject(guid);
        }

      },

      dropObject: function(objectId) {
        var object = this.sentObjects[objectId];

        if (object.reopen) {
          object.reopen({ willDestroy: object._oldWillDestroy });
          delete object._oldWillDestroy;
        }

        this.removeObservers(objectId);
        delete this.sentObjects[objectId];

        this.sendMessage('droppedObject', { objectId: objectId });
      },

      removeObservers: function(objectId) {
        var observers = this.boundObservers[objectId],
            object = this.sentObjects[objectId];

        if (observers) {
          observers.forEach(function(observer) {
            Ember.removeObserver(object, observer.property, observer.handler);
          });
        }

        delete this.boundObservers[objectId];
      },

      mixinsForObject: function(object) {
        var mixins = Ember.Mixin.mixins(object),
            mixinDetails = [],
            self = this;

        var ownProps = propertiesForMixin({ mixins: [{ properties: object }] });
        mixinDetails.push({ name: "Own Properties", properties: ownProps, expand: true });

        mixins.forEach(function(mixin) {
          var name = mixin[Ember.NAME_KEY] || mixin.ownerConstructor;
          if (!name) {
            name = 'Unknown mixin';
          }
          mixinDetails.push({ name: name.toString(), properties: propertiesForMixin(mixin) });
        });

        fixMandatorySetters(mixinDetails);
        applyMixinOverrides(mixinDetails);

        var propertyInfo = null;
        var debugInfo = getDebugInfo(object);
        if (debugInfo) {
          propertyInfo = getDebugInfo(object).propertyInfo;
          mixinDetails = customizeProperties(mixinDetails, propertyInfo);
        }

        var expensiveProperties = null;
        if (propertyInfo) {
          expensiveProperties = propertyInfo.expensiveProperties;
        }
        calculateCPs(object, mixinDetails, expensiveProperties);

        var objectId = this.retainObject(object);

        this.bindProperties(objectId, mixinDetails);

        return { objectId: objectId, mixins: mixinDetails };
      },

      valueForObjectProperty: function(objectId, property, mixinIndex) {
        var object = this.sentObjects[objectId], value;

        if (object.isDestroying) {
          value = '<DESTROYED>';
        } else {
          value = object.get(property);
        }

        value = inspectValue(value);
        value.computed = true;

        return {
          objectId: objectId,
          property: property,
          value: value,
          mixinIndex: mixinIndex
        };
      },

      bindPropertyToDebugger: function(message) {
        var objectId = message.objectId,
            property = message.property,
            mixinIndex = message.mixinIndex,
            computed = message.computed,
            self = this;

        var object = this.sentObjects[objectId];

        function handler() {
          var value = get(object, property);
          value = inspectValue(value);
          value.computed = computed;

          self.sendMessage('updateProperty', {
            objectId: objectId,
            property: property,
            value: value,
            mixinIndex: mixinIndex
          });
        }

        Ember.addObserver(object, property, handler);
        this.boundObservers[objectId] = this.boundObservers[objectId] || [];
        this.boundObservers[objectId].push({ property: property, handler: handler });

      },

      bindProperties: function(objectId, mixinDetails) {
        var self = this;
        mixinDetails.forEach(function(mixin, mixinIndex) {
          mixin.properties.forEach(function(item) {
            if (item.overridden) {
              return true;
            }
            if (item.value.type !== 'type-descriptor' && item.value.type !== 'type-function') {
              var computed = !!item.value.computed;
              self.bindPropertyToDebugger({
                objectId: objectId,
                property: item.name,
                mixinIndex: mixinIndex,
                computed: computed
              });
            }
          });
        });
      },

      inspect: inspect,
      inspectValue: inspectValue
    });


    function propertiesForMixin(mixin) {
      var seen = {}, properties = [];

      mixin.mixins.forEach(function(mixin) {
        if (mixin.properties) {
          addProperties(properties, mixin.properties);
        }
      });

      return properties;
    }

    function addProperties(properties, hash) {
      for (var prop in hash) {
        if (!hash.hasOwnProperty(prop)) { continue; }
        if (prop.charAt(0) === '_') { continue; }

        // remove `fooBinding` type props
        if (prop.match(/Binding$/)) { continue; }

        // when mandatory setter is removed, an `undefined` value may be set
        if (hash[prop] === undefined) { continue; }
        var options = { isMandatorySetter: isMandatorySetter(hash, prop) };
        if (isComputed(hash[prop])) {
          options.readOnly = hash[prop]._readOnly;
        }
        replaceProperty(properties, prop, hash[prop], options);
      }
    }

    function replaceProperty(properties, name, value, options) {
      var found, type;

      for (var i=0, l=properties.length; i<l; i++) {
        if (properties[i].name === name) {
          found = i;
          break;
        }
      }

      if (found) { properties.splice(i, 1); }

      if (name) {
        type = name.PrototypeMixin ? 'ember-class' : 'ember-mixin';
      }
      var prop = { name: name, value: inspectValue(value) };
      prop.isMandatorySetter = options.isMandatorySetter;
      prop.readOnly = options.readOnly;
      properties.push(prop);
    }

    function fixMandatorySetters(mixinDetails) {
      var seen = {};
      var propertiesToRemove = [];

      mixinDetails.forEach(function(detail, detailIdx) {
        detail.properties.forEach(function(property, propertyIdx) {
          if(property.isMandatorySetter) {
            seen[property.name] = {
              name: property.name,
              value: property.value.inspect,
              detailIdx: detailIdx,
              property: property
            };
          } else if(seen.hasOwnProperty(property.name) && seen[property.name] === property.value.inspect) {
            propertiesToRemove.push(seen[property.name]);
            delete seen[property.name];
          }
        });
      });

      propertiesToRemove.forEach(function(prop) {
        var detail = mixinDetails[prop.detailIdx];
        var index = detail.properties.indexOf(prop.property);
        if (index !== -1) {
          detail.properties.splice(index, 1);
        }
      });

    }

    function applyMixinOverrides(mixinDetails) {
      var seen = {};
      mixinDetails.forEach(function(detail) {
        detail.properties.forEach(function(property) {
          if (Object.prototype.hasOwnProperty(property.name)) { return; }

          if (seen[property.name]) {
            property.overridden = seen[property.name];
            delete property.value.computed;
          }

          seen[property.name] = detail.name;

        });
      });
    }

    function isMandatorySetter(object, prop) {
      var descriptor = Object.getOwnPropertyDescriptor(object, prop);
      if (descriptor.set && descriptor.set === Ember.MANDATORY_SETTER_FUNCTION) {
        return true;
      }
      return false;
    }






    function calculateCPs(object, mixinDetails, expensiveProperties) {
      expensiveProperties = expensiveProperties || [];

      mixinDetails.forEach(function(mixin) {
        mixin.properties.forEach(function(item) {
          if (item.overridden) {
            return true;
          }
          if (item.value.computed) {
            var cache = Ember.cacheFor(object, item.name);
            if (cache !== undefined || expensiveProperties.indexOf(item.name) === -1) {
              item.value = inspectValue(get(object, item.name));
              item.value.computed = true;
            }
          }
        });
      });
    }

    /**
      Customizes an object's properties
      based on the property `propertyInfo` of
      the object's `_debugInfo` method.

      Possible options:
        - `groups` An array of groups that contains the properties for each group
          For example:
          ```javascript
          groups: [
            { name: 'Attributes', properties: ['firstName', 'lastName'] },
            { name: 'Belongs To', properties: ['country'] }
          ]
          ```
        - `includeOtherProperties` Boolean,
          - `true` to include other non-listed properties,
          - `false` to only include given properties
        - `skipProperties` Array containing list of properties *not* to include
        - `skipMixins` Array containing list of mixins *not* to include
        - `expensiveProperties` An array of computed properties that are too expensive.
           Adding a property to this array makes sure the CP is not calculated automatically.

      Example:
      ```javascript
      {
        propertyInfo: {
          includeOtherProperties: true,
          skipProperties: ['toString', 'send', 'withTransaction'],
          skipMixins: [ 'Ember.Evented'],
          calculate: ['firstName', 'lastName'],
          groups: [
            {
              name: 'Attributes',
              properties: [ 'id', 'firstName', 'lastName' ],
              expand: true // open by default
            },
            {
              name: 'Belongs To',
              properties: [ 'maritalStatus', 'avatar' ],
              expand: true
            },
            {
              name: 'Has Many',
              properties: [ 'phoneNumbers' ],
              expand: true
            },
            {
              name: 'Flags',
              properties: ['isLoaded', 'isLoading', 'isNew', 'isDirty']
            }
          ]
        }
      }
      ```
    */
    function customizeProperties(mixinDetails, propertyInfo) {
      var newMixinDetails = [],
          neededProperties = {},
          groups = propertyInfo.groups || [],
          skipProperties = propertyInfo.skipProperties || [],
          skipMixins = propertyInfo.skipMixins || [];

      if(groups.length) {
        mixinDetails[0].expand = false;
      }

      groups.forEach(function(group) {
        group.properties.forEach(function(prop) {
          neededProperties[prop] = true;
        });
      });

      mixinDetails.forEach(function(mixin) {
        var newProperties = [];
        mixin.properties.forEach(function(item) {
          if (skipProperties.indexOf(item.name) !== -1) {
            return true;
          }
          if (!item.overridden && neededProperties.hasOwnProperty(item.name) && neededProperties[item.name]) {
            neededProperties[item.name] = item;
          } else {
            newProperties.push(item);
          }
        });
        mixin.properties = newProperties;
        if (skipMixins.indexOf(mixin.name) === -1) {
          newMixinDetails.push(mixin);
        }
      });

      groups.slice().reverse().forEach(function(group) {
        var newMixin = { name: group.name, expand: group.expand, properties: [] };
        group.properties.forEach(function(prop) {
          // make sure it's not `true` which means property wasn't found
          if (neededProperties[prop] !== true) {
            newMixin.properties.push(neededProperties[prop]);
          }
        });
        newMixinDetails.unshift(newMixin);
      });

      return newMixinDetails;
    }


    function getDebugInfo(object) {
      var debugInfo = null;
      if (object._debugInfo && typeof object._debugInfo === 'function') {
        debugInfo = object._debugInfo();
      }
      debugInfo = debugInfo || {};
      var propertyInfo = debugInfo.propertyInfo || (debugInfo.propertyInfo = {});
      var skipProperties = propertyInfo.skipProperties = propertyInfo.skipProperties || (propertyInfo.skipProperties = []);

      skipProperties.push('isDestroyed', 'isDestroying', 'container');
      // 'currentState' and 'state' are un-observable private properties.
      // The rest are skipped to reduce noise in the inspector.
      if (object instanceof Ember.View) {
        skipProperties.push(
          'currentState',
          'state',
          'buffer',
          'outletSource',
          'lengthBeforeRender',
          'lengthAfterRender',
          'template',
          'layout',
          'templateData',
          'domManager',
          'states'
        );
      }


      for (var prop in object) {
        // remove methods
        if (typeof object[prop] === 'function') {
          skipProperties.push(prop);
        }

      }
      return debugInfo;
    }

    function isComputed(value) {
      return value instanceof ComputedProperty;
    }

    // Not used
    function inspectController(controller) {
      return controller.get('_debugContainerKey') || controller.toString();
    }

    __exports__["default"] = ObjectInspector;
  });
define("port", 
  ["exports"],
  function(__exports__) {
    "use strict";
    var oneWay = Ember.computed.oneWay;
    var guidFor = Ember.guidFor;

    __exports__["default"] = Ember.Object.extend(Ember.Evented, {
      adapter: oneWay('namespace.adapter').readOnly(),

      application: oneWay('namespace.application').readOnly(),

      uniqueId: Ember.computed(function() {
        return guidFor(this.get('application')) + '__' + window.location.href + '__' + Date.now();
      }).property(),

      init: function() {
        var self = this;
        this.get('adapter').onMessageReceived(function(message) {
          if(self.get('uniqueId') === message.applicationId || !message.applicationId) {
            self.trigger(message.type, message);
          }
        });
      },
      send: function(messageType, options) {
        options.type = messageType;
        options.from = 'inspectedWindow';
        options.applicationId = this.get('uniqueId');
        this.get('adapter').sendMessage(options);
      }
    });
  });
define("promise_debug", 
  ["mixins/port_mixin","libs/promise_assembler","exports"],
  function(__dependency1__, __dependency2__, __exports__) {
    "use strict";
    var PortMixin = __dependency1__["default"];
    var PromiseAssembler = __dependency2__["default"];

    var PromiseDebug = Ember.Object.extend(PortMixin, {
      namespace: null,
      port: Ember.computed.alias('namespace.port'),
      objectInspector: Ember.computed.alias('namespace.objectInspector'),
      adapter: Ember.computed.alias('namespace.adapter'),
      portNamespace: 'promise',


      existingEvents: Ember.computed.alias('namespace.existingEvents'),
      existingCallbacks: Ember.computed.alias('namespace.existingCallbacks'),

      // created on init
      promiseAssembler: null,

      releaseMethods: Ember.computed(function() { return Ember.A(); }),

      init: function() {
        this._super();
        if (PromiseAssembler.supported()) {
          this.set('promiseAssembler', PromiseAssembler.create());
          this.get('promiseAssembler').set('promiseDebug', this);
          this.get('promiseAssembler').start();
        }
      },

      delay: 100,

      willDestroy: function() {
        this.releaseAll();
        this.get('promiseAssembler').destroy();
        this.set('promiseAssembler', null);
        this._super();
      },

      messages: {
        getAndObservePromises: function() {
          this.getAndObservePromises();
        },

        supported: function() {
          this.sendMessage('supported', {
            supported: PromiseAssembler.supported()
          });
        },

        releasePromises: function() {
          this.releaseAll();
        },

        sendValueToConsole: function(message) {
          var promiseId = message.promiseId;
          var promise = this.get('promiseAssembler').find(promiseId);
          var value = promise.get('value');
          if (value === undefined) {
            value = promise.get('reason');
          }
          this.get('objectInspector').sendValueToConsole(value);
        },

        tracePromise: function(message) {
          var id = message.promiseId;
          var promise = this.get('promiseAssembler').find(id);
          // Remove first two lines and add label
          var stack = promise.get('stack');
          if (stack) {
            stack = stack.split("\n");
            stack.splice(0, 2, ['Ember Inspector (Promise Trace): ' + (promise.get('label') || '')]);
            this.get("adapter").log(stack.join("\n"));
          }
        },

        setInstrumentWithStack: function(message) {
          Ember.RSVP.configure('instrument-with-stack', message.instrumentWithStack);
        }
      },

      releaseAll: function() {
        this.get('releaseMethods').forEach(function(fn) {
          fn();
        });
        this.set('releaseMethods', Ember.A());
      },

      getAndObservePromises: function() {
        this.get('promiseAssembler').on('created', this, this.promiseUpdated);
        this.get('promiseAssembler').on('fulfilled', this, this.promiseUpdated);
        this.get('promiseAssembler').on('rejected', this, this.promiseUpdated);
        this.get('promiseAssembler').on('chained', this, this.promiseChained);

        this.get('releaseMethods').pushObject(function() {

          this.get('promiseAssembler').off('created', this, this.promiseUpdated);
          this.get('promiseAssembler').off('fulfilled', this, this.promiseUpdated);
          this.get('promiseAssembler').off('rejected', this, this.promiseUpdated);
          this.get('promiseAssembler').off('fulfilled', this, this.promiseChained);

        }.bind(this));

        this.promisesUpdated(this.get('promiseAssembler').find());
      },

      updatedPromises: Ember.computed(function() { return Ember.A(); }),

      promisesUpdated: function(uniquePromises) {
        if (!uniquePromises) {
          uniquePromises = Ember.A();
          this.get('updatedPromises').forEach(function(promise) {
            uniquePromises.addObject(promise);
          });
        }
        var serialized = this.serializeArray(uniquePromises);
        this.sendMessage('promisesUpdated', {
          promises: serialized
        });
        this.set('updatedPromises', Ember.A());
      },

      promiseUpdated: function(event) {
        this.get('updatedPromises').pushObject(event.promise);
        Ember.run.debounce(this, 'promisesUpdated', this.delay);
      },

      promiseChained: function(event) {
        this.get('updatedPromises').pushObject(event.promise);
        this.get('updatedPromises').pushObject(event.child);
        Ember.run.debounce(this, 'promisesUpdated', this.delay);
      },

      serializeArray: function(promises) {
        return promises.map(function(item) {
          return this.serialize(item);
        }.bind(this));
      },

      serialize: function(promise) {
        var serialized = {};
        serialized.guid = promise.get('guid');
        serialized.state = promise.get('state');
        serialized.label = promise.get('label');
        if (promise.get('children')) {
          serialized.children = this.promiseIds(promise.get('children'));
        }
        serialized.parent = promise.get('parent.guid');
        serialized.value = this.inspectValue(promise.get('value'));
        serialized.reason = this.inspectValue(promise.get('reason'));
        if (promise.get('createdAt')) {
          serialized.createdAt = promise.get('createdAt').getTime();
        }
        if (promise.get('settledAt')) {
          serialized.settledAt = promise.get('settledAt').getTime();
        }
        serialized.hasStack = !!promise.get('stack');
        return serialized;
      },

      promiseIds: function(promises) {
        return promises.map(function(promise) {
          return promise.get('guid');
        });
      },

      inspectValue: function(value) {
        var objectInspector = this.get('objectInspector'),
            inspected = objectInspector.inspectValue(value);

        if (inspected.type === 'type-ember-object' || inspected.type === "type-array") {
          inspected.objectId = objectInspector.retainObject(value);
          this.get('releaseMethods').pushObject(function() {
            objectInspector.releaseObject(inspected.objectId);
          });
        }
        return inspected;
      }

    });

    __exports__["default"] = PromiseDebug;
  });
define("render_debug", 
  ["mixins/port_mixin","models/profile_manager","exports"],
  function(__dependency1__, __dependency2__, __exports__) {
    "use strict";
    var PortMixin = __dependency1__["default"];
    var ProfileManager = __dependency2__["default"];

    var K = Ember.K;
    var addArrayObserver = Ember.addArrayObserver;
    var computed = Ember.computed;
    var oneWay = computed.oneWay;
    var later = Ember.run.later;

    var profileManager = new ProfileManager();

    var queue = [];

    function push(info) {
      var index = queue.push(info);
      if (1 === index) {
        later(flush, 50);
      }
      return index - 1;
    }

    function flush() {
      var entry, ended, i;
      for (i = 0; i < queue.length; i++) {
        entry = queue[i];
        if (entry.type === 'began') {
          queue[entry.endedIndex].profileNode = profileManager.began(entry.timestamp, entry.payload, entry.now);
        } else {
          profileManager.ended(entry.timestamp, entry.payload, entry.profileNode);
        }

      }
      queue.length = 0;
    }

    Ember.subscribe("render", {
      before: function(name, timestamp, payload) {
        var info = {
          type: 'began',
          timestamp: timestamp,
          payload: payload,
          now: Date.now()
        };
        return push(info);
      },

      after: function(name, timestamp, payload, beganIndex) {
        var endedInfo = {
          type: 'ended',
          timestamp: timestamp,
          payload: payload
        };

        var index = push(endedInfo);
        queue[beganIndex].endedIndex = index;
      }
    });

    __exports__["default"] = Ember.Object.extend(PortMixin, {
      namespace: null,
      port: oneWay('namespace.port').readOnly(),
      application: oneWay('namespace.application').readOnly(),
      viewDebug: oneWay('namespace.viewDebug').readOnly(),
      portNamespace: 'render',

      profileManager: profileManager,

      init: function() {
        this._super();
        this._subscribeForViewTrees();
      },

      willDestroy: function() {
        this._super();
        this.profileManager.offProfilesAdded(this, this.sendAdded);
        this.profileManager.offProfilesAdded(this, this._updateViewTree);
      },

      _subscribeForViewTrees: function() {
        this.profileManager.onProfilesAdded(this, this._updateViewTree);
      },

      _updateViewTree: function(profiles) {
        var viewDurations = {};
        this._flatten(profiles).forEach(function(node) {
          if (node.viewGuid) {
            viewDurations[node.viewGuid] = node.duration;
          }
        });
        this.get('viewDebug').updateDurations(viewDurations);
      },

      _flatten: function(profiles, array) {
        var self = this;
        array = array || [];
        profiles.forEach(function(profile) {
          array.push(profile);
          self._flatten(profile.children, array);
        });
        return array;
      },

      sendAdded: function(profiles) {
        this.sendMessage('profilesAdded', { profiles: profiles });
      },

      messages: {
        watchProfiles: function() {
          this.sendMessage('profilesAdded', { profiles: this.profileManager.profiles });
          this.profileManager.onProfilesAdded(this, this.sendAdded);
        },

        releaseProfiles: function() {
          this.profileManager.offProfilesAdded(this, this.sendAdded);
        },

        clear: function() {
          this.profileManager.clearProfiles();
          this.sendMessage('profilesUpdated', {profiles: []});
        }
      }
    });
  });
define("route_debug", 
  ["mixins/port_mixin","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var PortMixin = __dependency1__["default"];

    var classify = Ember.String.classify;
    var computed = Ember.computed;
    var oneWay = computed.oneWay;
    var observer = Ember.observer;
    var later = Ember.run.later;

    var RouteDebug = Ember.Object.extend(PortMixin, {
      namespace: null,
      port: oneWay('namespace.port').readOnly(),

      application: oneWay('namespace.application').readOnly(),

      router: computed(function() {
        return this.get('application.__container__').lookup('router:main');
      }).property('application'),

      applicationController: computed(function() {
        var container = this.get('application.__container__');
        return container.lookup('controller:application');
      }).property('application'),

      currentPath: oneWay('applicationController.currentPath').readOnly(),

      portNamespace: 'route',

      messages: {
        getTree: function() {
          this.sendTree();
        },
        getCurrentRoute: function() {
          this.sendCurrentRoute();
        }
      },

      sendCurrentRoute: observer(function() {
        var self = this;
        later(function() {
          self.sendMessage('currentRoute', { name: self.get('currentPath') });
        }, 50);
      }, 'currentPath'),

      routeTree: computed(function() {
        var routeNames = this.get('router.router.recognizer.names');
        var routeTree = {};

        for(var routeName in routeNames) {
          if (!routeNames.hasOwnProperty(routeName)) {
            continue;
          }
          var route = routeNames[routeName];
          var handlers = Ember.A(route.handlers);
          buildSubTree.call(this, routeTree, route);
        }

        return arrayizeChildren({  children: routeTree }).children[0];
      }).property('router'),

      sendTree: function() {
        var routeTree = this.get('routeTree');
        this.sendMessage('routeTree', { tree: routeTree });
      }
    });

    var buildSubTree = function(routeTree, route) {
      var handlers = route.handlers;
      var subTree = routeTree, item,
          routeClassName, routeHandler, controllerName,
          controllerClassName, container, templateName,
          controllerFactory;
      for (var i = 0; i < handlers.length; i++) {
        item = handlers[i];
        var handler = item.handler;
        if (subTree[handler] === undefined) {
          routeClassName = classify(handler.replace(/\./g, '_')) + 'Route';
          container = this.get('application.__container__');
          routeHandler = container.lookup('router:main').router.getHandler(handler);
          controllerName = routeHandler.get('controllerName') || routeHandler.get('routeName');
          controllerClassName = classify(controllerName.replace(/\./g, '_')) + 'Controller';
          controllerFactory = container.lookupFactory('controller:' + controllerName);
          templateName = handler.replace(/\./g, '/');

          subTree[handler] = {
            value: {
              name: handler,
              routeHandler: {
                className: routeClassName,
                name: handler
              },
              controller: {
                className: controllerClassName,
                name: controllerName,
                exists: controllerFactory ? true : false
              },
              template: {
                name: templateName
              }
            }
          };

          if (i === handlers.length - 1) {
            // it is a route, get url
            subTree[handler].value.url = getURL(container, route.segments);
            subTree[handler].value.type = 'route';
          } else {
            // it is a resource, set children object
            subTree[handler].children = {};
            subTree[handler].value.type = 'resource';
          }

        }
        subTree = subTree[handler].children;
      }
    };

    function arrayizeChildren(routeTree) {
      var obj = { value: routeTree.value };

      if (routeTree.children) {
        var childrenArray = [];
        for(var i in routeTree.children) {
          var route = routeTree.children[i];
          childrenArray.push(arrayizeChildren(route));
        }
        obj.children = childrenArray;
      }

      return obj;
    }

    function getURL(container, segments) {
      var locationImplementation = container.lookup('router:main').location;
      var url = [];
      for (var i = 0; i < segments.length; i++) {
        var name = null;

        try {
          name = segments[i].generate();
        } catch (e) {
          // is dynamic
          name = ':' + segments[i].name;
        }
        if (name) {
          url.push(name);
        }
      }

      url = url.join('/');

      if (url.match(/_unused_dummy_/)) {
        url = '';
      } else {
        url = '/' + url;
        url = locationImplementation.formatURL(url);
      }

      return url;
    }

    __exports__["default"] = RouteDebug;
  });
define("view_debug", 
  ["mixins/port_mixin","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var PortMixin = __dependency1__["default"];

    var layerDiv,
        previewDiv,
        highlightedElement,
        previewedElement,
        $ = Ember.$,
        later = Ember.run.later,
        computed = Ember.computed,
        oneWay = computed.oneWay;

    var ViewDebug = Ember.Object.extend(PortMixin, {

      namespace: null,

      application: oneWay('namespace.application').readOnly(),
      adapter: oneWay('namespace.adapter').readOnly(),
      port: oneWay('namespace.port').readOnly(),
      objectInspector: oneWay('namespace.objectInspector').readOnly(),

      retainedObjects: [],

      _durations: {},

      options: {},

      portNamespace: 'view',

      messages: {
        getTree: function() {
          this.sendTree();
        },
        hideLayer: function() {
          this.hideLayer();
        },
        showLayer: function(message) {
          this.showLayer(message.objectId);
        },
        previewLayer: function(message) {
          this.previewLayer(message.objectId);
        },
        hidePreview: function(message) {
          this.hidePreview(message.objectId);
        },
        inspectViews: function(message) {
          if (message.inspect) {
            this.startInspecting();
          } else {
            this.stopInspecting();
          }
        },
        inspectElement: function(message) {
          this.inspectElement(message.objectId);
        },
        setOptions: function(message) {
          this.set('options', message.options);
          this.sendTree();
        },
        sendModelToConsole: function(message) {
          var view = this.get('objectInspector').sentObjects[message.viewId];
          var model = this.modelForView(view);
          if (model) {
            this.get('objectInspector').sendValueToConsole(model);
          }
        }
      },

      init: function() {
        this._super();
        var self = this;

        this.viewListener();
        this.retainedObjects = [];
        this.options = {};

        layerDiv = $('<div>').appendTo('body').get(0);
        layerDiv.style.display = 'none';
        layerDiv.setAttribute('data-label', 'layer-div');

        previewDiv = $('<div>').appendTo('body').css('pointer-events', 'none').get(0);
        previewDiv.style.display = 'none';
        previewDiv.setAttribute('data-label', 'preview-div');

        $(window).on('resize.' + this.get('eventNamespace'), function() {
          if (highlightedElement) {
            self.highlightView(highlightedElement);
          }
        });
      },


      updateDurations: function(durations) {
        for (var guid in durations) {
          if (!durations.hasOwnProperty(guid)) {
            continue;
          }
          this._durations[guid] = durations[guid];
        }
        this.sendTree();
      },

      retainObject: function(object) {
        this.retainedObjects.push(object);
        return this.get('objectInspector').retainObject(object);
      },

      releaseCurrentObjects: function() {
        var self = this;
        this.retainedObjects.forEach(function(item) {
          self.get('objectInspector').releaseObject(Ember.guidFor(item));
        });
        this.retainedObjects = [];
      },

      eventNamespace: Ember.computed(function() {
        return 'view_debug_' + Ember.guidFor(this);
      }).property(),

      willDestroy: function() {
        this._super();
        $(window).off(this.get('eventNamespace'));
        $(layerDiv).remove();
        $(previewDiv).remove();
        Ember.View.removeMutationListener(this.viewTreeChanged);
        this.releaseCurrentObjects();
        this.stopInspecting();
      },

      inspectElement: function(objectId) {
        var view = this.get('objectInspector').sentObjects[objectId];
        if (view && view.get('element')) {
          this.get('adapter').inspectElement(view.get('element'));
        }
      },

      sendTree: function() {
        Ember.run.scheduleOnce('afterRender', this, this.scheduledSendTree);
      },

      startInspecting: function() {
        var self = this, viewElem = null;
        this.sendMessage('startInspecting', {});

        // we don't want the preview div to intercept the mousemove event
        $(previewDiv).css('pointer-events', 'none');

        $('body').on('mousemove.inspect-' + this.get('eventNamespace'), function(e) {
          var originalTarget = $(e.target), oldViewElem = viewElem;
          viewElem = self.findNearestView(originalTarget);
          if (viewElem) {
            self.highlightView(viewElem, true);
          }
        })
        .on('mousedown.inspect-' + this.get('eventNamespace'), function() {
          // prevent app-defined clicks from being fired
          $(previewDiv).css('pointer-events', '')
          .one('mouseup', function() {
            // chrome
            return pinView();
          });
        })
        .on('mouseup.inspect-' + this.get('eventNamespace'), function() {
          // firefox
          return pinView();
        })
        .css('cursor', '-webkit-zoom-in');

        function pinView() {
          if (viewElem) {
            self.highlightView(viewElem);
            var view = self.get('objectInspector').sentObjects[viewElem.id];
            if (view instanceof Ember.Component) {
              self.get('objectInspector').sendObject(view);
            }
          }
          self.stopInspecting();
          return false;
        }
      },

      findNearestView: function(elem) {
        var viewElem, view;
        if (!elem || elem.length === 0) { return null; }
        if (elem.hasClass('ember-view')) {
          viewElem = elem.get(0);
          view = this.get('objectInspector').sentObjects[viewElem.id];
          if (view && this.shouldShowView(view)) {
            return viewElem;
          }
        }
        return this.findNearestView($(elem).parents('.ember-view:first'));
      },

      stopInspecting: function() {
        $('body')
        .off('mousemove.inspect-' + this.get('eventNamespace'))
        .off('mousedown.inspect-' + this.get('eventNamespace'))
        .off('mouseup.inspect-' + this.get('eventNamespace'))
        .off('click.inspect-' + this.get('eventNamespace'))
        .css('cursor', '');

        this.hidePreview();
        this.sendMessage('stopInspecting', {});
      },

      scheduledSendTree: function() {
        var self = this;
        // Send out of band
        later(function() {
          if (self.isDestroying) {
            return;
          }
          self.releaseCurrentObjects();
          var tree = self.viewTree();
          if (tree) {
            self.sendMessage('viewTree', {
              tree: tree
            });
          }
        }, 50);
      },

      viewListener: function() {
        var self = this;

        this.viewTreeChanged = function() {
          self.sendTree();
          self.hideLayer();
        };

        Ember.View.addMutationListener(this.viewTreeChanged);
      },

      viewTree: function() {
        var emberApp = this.get('application');
        if (!emberApp) {
          return false;
        }

        var applicationViewId = $(emberApp.rootElement).find('> .ember-view').attr('id');
        var rootView = Ember.View.views[applicationViewId];
        // In case of App.reset view is destroyed
        if (!rootView) {
          return false;
        }
        var retained = [];

        var children = [];
        var treeId = this.retainObject(retained);

        var tree = { value: this.inspectView(rootView, retained), children: children, treeId: treeId };

        this.appendChildren(rootView, children, retained);

        return tree;
      },

      modelForView: function(view) {
        var controller = view.get('controller');
        var model = controller.get('model');
        if (view.get('context') !== controller) {
          model = view.get('context');
        }
        return model;
      },

      inspectView: function(view, retained) {
        var templateName = view.get('templateName') || view.get('_debugTemplateName'),
            viewClass = shortViewName(view), name;

        var tagName = view.get('tagName');
        if (tagName === '') {
          tagName = '(virtual)';
        }

        tagName = tagName || 'div';

        var controller = view.get('controller');

        name = viewDescription(view);


        var viewId = this.retainObject(view);
        retained.push(viewId);

        var timeToRender = this._durations[viewId];

        var value = {
          viewClass: viewClass,
          completeViewClass: viewName(view),
          objectId: viewId,
          duration: timeToRender,
          name: name,
          template: templateName || '(inline)',
          tagName: tagName,
          isVirtual: view.get('isVirtual'),
          isComponent: (view instanceof Ember.Component)
        };

        if (controller && !(view instanceof Ember.Component)) {
          value.controller = {
            name: shortControllerName(controller),
            completeName: controllerName(controller),
            objectId: this.retainObject(controller)
          };

          var model = this.modelForView(view);
          if (model) {
            if(Ember.Object.detectInstance(model) || Ember.typeOf(model) === 'array') {
              value.model = {
                name: shortModelName(model),
                completeName: modelName(model),
                objectId: this.retainObject(model),
                type: 'type-ember-object'
              };
            } else {
              value.model = {
                name: this.get('objectInspector').inspect(model),
                type: 'type-' + Ember.typeOf(model)
              };
            }
          }
        }

        return value;
      },

      appendChildren: function(view, children, retained) {
        var self = this;
        var childViews = view.get('_childViews'),
            controller = view.get('controller');

        childViews.forEach(function(childView) {
          if (!(childView instanceof Ember.Object)) { return; }

          if (self.shouldShowView(childView)) {
            var grandChildren = [];
            children.push({ value: self.inspectView(childView, retained), children: grandChildren });
            self.appendChildren(childView, grandChildren, retained);
          } else {
            self.appendChildren(childView, children, retained);
          }
        });
      },

      shouldShowView: function(view) {
        return (this.options.allViews || this.hasOwnController(view) || this.hasOwnContext(view)) &&
            (this.options.components || !(view instanceof Ember.Component)) &&
            (!view.get('isVirtual') || this.hasOwnController(view) || this.hasOwnContext(view));
      },

      hasOwnController: function(view) {
        return view.get('controller') !== view.get('_parentView.controller') &&
        ((view instanceof Ember.Component) || !(view.get('_parentView.controller') instanceof Ember.Component));
      },

      hasOwnContext: function(view) {
        return view.get('context') !== view.get('_parentView.context') && !(view.get('_parentView') instanceof Ember.Component);
      },

      highlightView: function(element, preview) {
        var self = this;
        var range, view, rect, div;

        if (!element) { return; }

        if (preview) {
          previewedElement = element;
          div = previewDiv;
        } else {
          this.hideLayer();
          highlightedElement = element;
          div = layerDiv;
          this.hidePreview();
        }

        if (element instanceof Ember.View && element.get('isVirtual')) {
          view = element;
          if (view.get('isVirtual')) {
            range = virtualRange(view);
            rect = range.getBoundingClientRect();
          }
        } else if (element instanceof Ember.View) {
          view = element;
          element = view.get('element');
          if (!element) { return; }
          rect = element.getBoundingClientRect();
        } else {
          view = Ember.View.views[element.id];
          rect = element.getBoundingClientRect();
        }

        // take into account the scrolling position as mentioned in docs
        // https://developer.mozilla.org/en-US/docs/Web/API/element.getBoundingClientRect
        rect = $().extend({}, rect);
        rect.top = rect.top + window.scrollY;
        rect.left = rect.left + window.scrollX;

        var templateName = view.get('templateName') || view.get('_debugTemplateName'),
            controller = view.get('controller'),
            model = controller && controller.get('model');

        $(div).css(rect);
        $(div).css({
          display: "block",
          position: "absolute",
          backgroundColor: "rgba(255, 255, 255, 0.7)",
          border: "2px solid rgb(102, 102, 102)",
          padding: "0",
          right: "auto",
          direction: "ltr",
          boxSizing: "border-box",
          color: "rgb(51, 51, 255)",
          fontFamily: "Menlo, sans-serif",
          minHeight: 63,
          zIndex: 10000
        });

        var output = "";

        if (!preview) {
          output = "<span class='close' data-label='layer-close'>&times;</span>";
        }

        if (templateName) {
          output += "<p class='template'><span>template</span>=<span data-label='layer-template'>" + escapeHTML(templateName) + "</span></p>";
        }

        if (!(view instanceof Ember.Component)) {
          if (controller) {
            output += "<p class='controller'><span>controller</span>=<span data-label='layer-controller'>" + escapeHTML(controllerName(controller)) + "</span></p>";
          }
          output += "<p class='view'><span>view</span>=<span data-label='layer-view'>" + escapeHTML(viewName(view)) + "</span></p>";
        } else {
          output += "<p class='component'><span>component</span>=<span data-label='layer-component'>" + escapeHTML(viewName(view)) + "</span></p>";
        }

        if (model) {
          var modelName = this.get('objectInspector').inspect(model);
          output += "<p class='model'><span>model</span>=<span data-label='layer-model'>" + escapeHTML(modelName) + "</span></p>";
        }

        $(div).html(output);

        $('p', div).css({ float: 'left', margin: 0, backgroundColor: 'rgba(255, 255, 255, 0.9)', padding: '5px', color: 'rgb(0, 0, 153)' });
        $('p.model', div).css({ clear: 'left' });
        $('p span:first-child', div).css({ color: 'rgb(153, 153, 0)' });
        $('p span:last-child', div).css({ color: 'rgb(153, 0, 153)' });

        if (!preview) {
          $('span.close', div).css({
            float: 'right',
            margin: '5px',
            background: '#666',
            color: '#eee',
            fontFamily: 'helvetica, sans-serif',
            fontSize: '12px',
            width: 16,
            height: 16,
            lineHeight: '14px',
            borderRadius: 16,
            textAlign: 'center',
            cursor: 'pointer'
          }).on('click', function() {
            self.hideLayer();
            return false;
          }).on('mouseup mousedown', function() {
            // prevent re-pinning
            return false;
          });
        }

        $('p.view span:last-child', div).css({ cursor: 'pointer' }).click(function() {
          self.get('objectInspector').sendObject(view);
        });

        $('p.controller span:last-child', div).css({ cursor: 'pointer' }).click(function() {
          self.get('objectInspector').sendObject(controller);
        });

        $('p.component span:last-child', div).css({ cursor: 'pointer' }).click(function() {
          self.get('objectInspector').sendObject(view);
        });

        $('p.template span:last-child', div).css({ cursor: 'pointer' }).click(function() {
          self.inspectElement(Ember.guidFor(view));
        });

        if (model && ((model instanceof Ember.Object) || Ember.typeOf(model) === 'array')) {
          $('p.model span:last-child', div).css({ cursor: 'pointer' }).click(function() {
            self.get('objectInspector').sendObject(controller.get('model'));
          });
        }

        if (!preview) {
          this.sendMessage('pinView', { objectId: Ember.guidFor(view) });
        }
      },

      showLayer: function(objectId) {
        this.highlightView(this.get('objectInspector').sentObjects[objectId]);
      },

      previewLayer: function(objectId) {
        this.highlightView(this.get('objectInspector').sentObjects[objectId], true);
      },

      hideLayer: function() {
        this.sendMessage('unpinView', {});
        layerDiv.style.display = 'none';
        highlightedElement = null;
      },

      hidePreview: function() {
        previewDiv.style.display = 'none';
        previewedElement = null;
      }
    });

    function viewName(view) {
      var name = view.constructor.toString(), match;
      if (name.match(/\._/)) {
        name = "virtual";
      } else if (match = name.match(/\(subclass of (.*)\)/)) {
        name = match[1];
      }
      return name;
    }

    function shortViewName(view) {
      var name = viewName(view);
      // jj-abrams-resolver adds `app@view:` and `app@component:`
      return name.replace(/.+(view|component):/, '').replace(/:$/, '');
    }

    function modelName(model) {
      var name = '<Unknown model>';
      if (model.toString) {
        name = model.toString();
      }


      if (name.length > 50) {
        name = name.substr(0, 50) + '...';
      }
      return name;
    }

    function shortModelName(model) {
      var name = modelName(model);
      // jj-abrams-resolver adds `app@model:`
      return name.replace(/<[^>]+@model:/g, '<');
    }

    function controllerName(controller) {
      var key = controller.get('_debugContainerKey'),
          className = controller.constructor.toString(),
          name, match;

      if (match = className.match(/^\(subclass of (.*)\)/)) {
        className = match[1];
      }

      return className;
    }

    function shortControllerName(controller) {
      var name = controllerName(controller);
      // jj-abrams-resolver adds `app@controller:` at the begining and `:` at the end
      return name.replace(/^.+@controller:/, '').replace(/:$/, '');
    }

    function escapeHTML(string) {
      var div = document.createElement('div');
      div.appendChild(document.createTextNode(string));
      return div.innerHTML;
    }

    function virtualRange(view) {
      var start, end;
      var morph = view.get('morph');

      if (morph) {
        start = $('#' + morph.start)[0];
        end = $('#' + morph.end)[0];
      } else {
        // Support for metal-views
        morph = view.get('_morph');
        start = morph.start;
        end = morph.end;
      }

      var range = document.createRange();
      range.setStartAfter(start);
      range.setEndBefore(end);

      return range;
    }

    function viewDescription(view) {
      var templateName = view.get('templateName') || view.get('_debugTemplateName'),
          name, viewClass = shortViewName(view), controller = view.get('controller'),
          parentClassName;

      if (templateName) {
          name = templateName;
        } else if (view instanceof Ember.LinkView) {
          name = 'link';
        } else if (view.get('_parentView.controller') === controller || view instanceof Ember.Component) {
            var viewClassName = view.get('_debugContainerKey');
            if (viewClassName) {
              viewClassName = viewClassName.match(/\:(.*)/);
              if (viewClassName) {
                viewClassName = viewClassName[1];
              }
            }
            if (!viewClassName && viewClass) {
              viewClassName = viewClass.match(/\.(.*)/);
              if (viewClassName) {
                viewClassName = viewClassName[1];
              } else {
                viewClassName = viewClass;
              }

              var shortName = viewClassName.match(/(.*)(View|Component)$/);
              if (shortName) {
                viewClassName = shortName[1];
              }
            }
            if (viewClassName) {
              name = Ember.String.camelize(viewClassName);
            }
        } else if (view.get('_parentView.controller') !== controller) {
          var key = controller.get('_debugContainerKey'),
          className = controller.constructor.toString();

          if (key) {
            name = key.split(':')[1];
          }  else {
            if (parentClassName = className.match(/^\(subclass of (.*)\)/)) {
              className = parentClassName[1];
            }
            name = className.split('.').pop();
            name = Ember.String.camelize(name);
          }
        }

        if (!name) {
          name = '(inline view)';
        }
        return name;
    }

    __exports__["default"] = ViewDebug;
  });

}("chrome"))