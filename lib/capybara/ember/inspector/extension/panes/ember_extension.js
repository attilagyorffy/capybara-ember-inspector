define("adapters/basic", 
  ["exports"],
  function(__exports__) {
    "use strict";
    /**
      The adapter stores logic specific to
      each environment.
      Extend this object with env specific
      code (such as chrome/firefox/test), then
      set the `adapter` property to the name
      of this adapter.

      example:

      ```javascript
      var EmberExtension = App.create({
        adapter: 'chrome'
      })
      ```
    **/
    var K = Ember.K;
    __exports__["default"] = Ember.Object.extend({
      name: 'basic',
      /**
        Used to send messages to EmberDebug

        @param type {Object} the message to the send
      **/
      sendMessage: function(options) {},

      /**
        Register functions to be called
        when a message from EmberDebug is received
      **/
      onMessageReceived: function(callback) {
        this.get('_messageCallbacks').pushObject(callback);
      },

      _messageCallbacks: function() { return []; }.property(),

      _messageReceived: function(message) {
        this.get('_messageCallbacks').forEach(function(callback) {
          callback.call(null, message);
        });
      },

      // Called when the "Reload" is clicked by the user
      willReload: K
    });
  });
define("adapters/bookmarklet", 
  ["adapters/basic","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var BasicAdapter = __dependency1__["default"];

    var emberDebug = null;

    __exports__["default"] = BasicAdapter.extend({
      name: 'bookmarklet',

      inspectedWindow: function() {
        return window.opener || window.parent;
      }.property(),

      inspectedWindowURL: function() {
        return loadPageVar('inspectedWindowURL');
      }.property(),

      sendMessage: function(options) {
        options = options || {};
        this.get('inspectedWindow').postMessage(options, this.get('inspectedWindowURL'));
      },

      _connect: function() {
        var self = this;

        window.addEventListener('message', function(e) {
          var message = e.data;
          if (e.origin !== self.get('inspectedWindowURL')) {
            return;
          }
          // close inspector if inspected window is unloading
          if (message && message.unloading) {
            window.close();
          }
          if (message.from === 'inspectedWindow') {
            self._messageReceived(message);
          }
        });
      }.on('init'),
    });

    function loadPageVar (sVar) {
      return decodeURI(window.location.search.replace(new RegExp("^(?:.*[&\\?]" + encodeURI(sVar).replace(/[\.\+\*]/g, "\\$&") + "(?:\\=([^&]*))?)?.*$", "i"), "$1"));
    }
  });
define("adapters/chrome", 
  ["adapters/basic","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var BasicAdapter = __dependency1__["default"];

    var emberDebug = null;

    __exports__["default"] = BasicAdapter.extend({
      name: 'chrome',

      sendMessage: function(options) {
        options = options || {};
        this.get('_chromePort').postMessage(options);
      },

      _chromePort: function() {
        return chrome.extension.connect();
      }.property(),

      _connect: function() {
        var self = this;
        var chromePort = this.get('_chromePort');
        chromePort.postMessage({ appId: chrome.devtools.inspectedWindow.tabId });

        chromePort.onMessage.addListener(function(message) {
          if (typeof message.type === 'string' && message.type === 'iframes') {
            sendIframes(message.urls);
          }
          self._messageReceived(message);
        });
      }.on('init'),

      _handleReload: function() {
        var self = this;
        chrome.devtools.network.onNavigated.addListener(function() {
          self._injectDebugger();
          location.reload(true);
        });
      }.on('init'),

      _injectDebugger: function() {
        loadEmberDebug();
        chrome.devtools.inspectedWindow.eval(emberDebug);
        var urls = [];
        chrome.devtools.inspectedWindow.onResourceAdded.addListener(function(opts) {
          if (opts.type === 'document') {
            sendIframes([opts.url]);
          }
        });
      }.on('init'),

      willReload: function() {
        this._injectDebugger();
      }
    });

    function sendIframes(urls) {
      loadEmberDebug();
      urls.forEach(function(url) {
        chrome.devtools.inspectedWindow.eval(emberDebug, { frameURL: url });
      });
    }

    function loadEmberDebug() {
      var xhr;
      if (!emberDebug) {
        xhr = new XMLHttpRequest();
        xhr.open("GET", chrome.extension.getURL('/ember_debug/ember_debug.js'), false);
        xhr.send();
        emberDebug = xhr.responseText;
      }
    }
  });
define("adapters/firefox", 
  ["adapters/basic","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var BasicAdapter = __dependency1__["default"];

    __exports__["default"] = BasicAdapter.extend({
      name: 'firefox',

      sendMessage: function(options) {
        options = options || {};
        window.parent.postMessage(options, "*");
      },

      _connect: function() {
        // NOTE: chrome adapter sends a appId message on connect (not needed on firefox)
        //this.sendMessage({ appId: "test" });
        this._onMessage = this._onMessage.bind(this);
        window.addEventListener("message", this._onMessage, false);

      }.on('init'),

      _onMessage: function (evt) {
        if (this.isDestroyed || this.isDestroying) {
          window.removeEventListener("message", this._onMessage, false);
          return;
        }

        var message = evt.data;
        // check if the event is originated by our privileged ember inspector code
        if (evt.isTrusted) {
          if (typeof message.type === 'string' && message.type === 'iframes') {
            this._sendIframes(message.urls);
          } else {
            // We clone the object so that Ember prototype extensions
            // are applied.
            this._messageReceived(Ember.$.extend(true, {}, message));
          }
        } else {
          console.log("EMBER INSPECTOR: ignored post message", evt);
        }
      },

      _sendIframes: function (urls) {
         var self = this;
         urls.forEach(function(url) {
           self.sendMessage({ type: "injectEmberDebug", frameURL: url });
         });
      }
    });
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
define("app", 
  ["resolver","port","libs/promise_assembler","helpers/ms_to_time","exports"],
  function(__dependency1__, __dependency2__, __dependency3__, __dependency4__, __exports__) {
    "use strict";
    var Resolver = __dependency1__["default"];
    var Port = __dependency2__["default"];
    var PromiseAssembler = __dependency3__["default"];
    var msToTime = __dependency4__["default"];

    var version = '1.6.2';

    var App = Ember.Application.extend({
      modulePrefix: '',
      Resolver: Resolver,
      adapter: 'basic'
    });

    var config = {
      VERSION: version
    };

    // Register Helpers
    Ember.Handlebars.helper('ms-to-time', msToTime);

    // Inject adapter
    App.initializer({
      name: "extension-init",

      initialize: function(container, app) {
        // register and inject adapter
        var Adapter;
        if (Ember.typeOf(app.adapter) === 'string') {
          Adapter = container.resolve('adapter:' + app.adapter);
        } else {
          Adapter = app.adapter;
        }
        container.register('adapter:main', Adapter);
        container.typeInjection('port', 'adapter', 'adapter:main');
        container.injection('route:application', 'adapter', 'adapter:main');

        // register config
        container.register('config:main', config, { instantiate: false });
        container.typeInjection('route', 'config', 'config:main');

        // inject port
        container.register('port:main', app.Port || Port);
        container.typeInjection('controller', 'port', 'port:main');
        container.typeInjection('route', 'port', 'port:main');
        container.typeInjection('promise-assembler', 'port', 'port:main');

        // register and inject promise assembler
        container.register('promise-assembler:main', PromiseAssembler);
        container.injection('route:promiseTree', 'assembler', 'promise-assembler:main');
      }
    });

    __exports__["default"] = App;
  });
define("components/clear_button", 
  ["components/icon_button","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var IconButton = __dependency1__["default"];

    __exports__["default"] = IconButton.extend({
      title: 'Clear'
    });
  });
define("components/drag_handle", 
  ["exports"],
  function(__exports__) {
    "use strict";
    __exports__["default"] = Ember.Component.extend({
      classNames: ['drag-handle'],
      classNameBindings: ['isLeft:drag-handle--left', 'isRight:drag-handle--right'],
      attributeBindings: ['style'],
      position: 0,
      side: '',
      isRight: Ember.computed.equal('side', 'right'),
      isLeft: Ember.computed.equal('side', 'left'),
      minWidth: 60,

      startDragging: function() {
        var self = this,
            $container = this.$().parent(),
            $containerOffsetLeft = $container.offset().left,
            $containerOffsetRight = $containerOffsetLeft + $container.width(),
            namespace = 'drag-' + this.get('elementId');

        this.sendAction('action', true);

        Ember.$('body').on('mousemove.' + namespace, function(e){
          var position = self.get('isLeft') ?
                           e.pageX - $containerOffsetLeft :
                           $containerOffsetRight - e.pageX;

          if (position >= self.get('minWidth')) {
            self.set('position', position);
          }
        })
        .on('mouseup.' + namespace + ' mouseleave.' + namespace, function(){
          self.stopDragging();
        });
      },

      stopDragging: function() {
        this.sendAction('action', false);
        Ember.$('body').off('.drag-' + this.get('elementId'));
      },

      willDestroyElement: function() {
        this._super();
        this.stopDragging();
      },

      mouseDown: function() {
        this.startDragging();
        return false;
      },

      style: function () {
        if (this.get('side')) {
          return this.get('side') + ':' + this.get('position') + 'px';
        }
        else {
          return '';
        }
      }.property('side', 'position')
    });
  });
define("components/draggable_column", 
  ["exports"],
  function(__exports__) {
    "use strict";
    // DraggableColumn
    // ===============
    // A wrapper for a resizable-column and a drag-handle component
    var Component = Ember.Component;

    __exports__["default"] = Component.extend({
      tagName: '', // Prevent wrapping in a div
      side: 'left',
      minWidth: 60,
      setIsDragging: 'setIsDragging',
      actions: {
        setIsDragging: function(isDragging) {
          this.sendAction('setIsDragging', isDragging);
        }
      }
    });
  });
define("components/icon_button", 
  ["exports"],
  function(__exports__) {
    "use strict";
    var Component = Ember.Component;
    __exports__["default"] = Component.extend({
      attributeBindings: ['dataLabel:data-label', 'title'],

      tagName: 'button',

      title: null,

      click: function () {
        this.sendAction();
      }
    });
  });
define("components/property_field", 
  ["exports"],
  function(__exports__) {
    "use strict";
    __exports__["default"] = Ember.TextField.extend({
      attributeBindings: ['label:data-label'],

      saveProperty: 'saveProperty',
      finishedEditing: 'finishedEditing',

      didInsertElement: function() {
        this._super();
        this.$().select();
      },

      insertNewline: function() {
        this.sendAction('saveProperty');
        this.sendAction('finishedEditing');
      },

      cancel: function() {
        this.sendAction('finishedEditing');
      },

      focusOut: function() {
        this.sendAction('finishedEditing');
      }
    });
  });
define("components/reload_button", 
  ["components/icon_button","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var IconButton = __dependency1__["default"];

    __exports__["default"] = IconButton.extend({
      title: 'Reload'
    });
  });
define("components/resizable_column", 
  ["exports"],
  function(__exports__) {
    "use strict";
    __exports__["default"] = Ember.Component.extend({
      width: null,

      attributeBindings: ['style'],

      style: function () {
        return '-webkit-flex: none; flex: none; width:' + this.get('width') + 'px;';
      }.property('width'),

      didInsertElement: function () {
        if (!this.get('width')) {
          this.set('width', this.$().width());
        }
      }
    });
  });
define("components/send_to_console", 
  ["exports"],
  function(__exports__) {
    "use strict";
    __exports__["default"] = Ember.Component.extend({
      tagName: 'button',
      classNames: ['send-to-console'],
      attributeBindings: ['dataLabel:data-label'],
      dataLabel: 'send-to-console-btn',
      action: 'sendValueToConsole',
      click: function() {
        this.sendAction('action', this.get('param'));
      }
    });
  });
define("components/sidebar_toggle", 
  ["exports"],
  function(__exports__) {
    "use strict";
    __exports__["default"] = Ember.Component.extend({

      tagName: 'button',

      side: 'right',

      isExpanded: false,

      isRight: Em.computed.equal('side', 'right'),

      classNames: 'sidebar-toggle',

      classNameBindings: 'isRight:sidebar-toggle--right:sidebar-toggle--left',

      click: function () {
        this.sendAction();
      }

    });
  });
define("computed/custom_filter", 
  ["exports"],
  function(__exports__) {
    "use strict";
    __exports__["default"] = function filterComputed() {
      var dependentKeys, callback;

      if (arguments.length > 1) {
        var slice = [].slice;
        dependentKeys = slice.call(arguments, 0, -1);
        callback = slice.call(arguments, -1)[0];
      }
      var options = {
        initialize: function (array, changeMeta, instanceMeta) {
          instanceMeta.filteredArrayIndexes = new Ember.SubArray();
        },

        addedItem: function(array, item, changeMeta, instanceMeta) {
          var match = !!callback.call(this, item),
              filterIndex = instanceMeta.filteredArrayIndexes.addItem(changeMeta.index, match);

          if (match) {
            array.insertAt(filterIndex, item);
          }

          return array;
        },

        removedItem: function(array, item, changeMeta, instanceMeta) {
          var filterIndex = instanceMeta.filteredArrayIndexes.removeItem(changeMeta.index);

          if (filterIndex > -1) {
            array.removeAt(filterIndex);
          }

          return array;
        }
      };
      var args = dependentKeys;
      args.push(options);

      /*jshint validthis:true */
      return Ember.arrayComputed.apply(this, args);
    };
  });
define("computed/debounce", 
  ["exports"],
  function(__exports__) {
    "use strict";
    var debounce = Ember.run.debounce;

    // Use this if you want a property to debounce
    // another property with a certain delay.
    // This means that every time this prop changes,
    // the other prop will change to the same val after [delay]
    __exports__["default"] = function(prop, delay, callback) {
      var value;

      var updateVal = function() {
        this.set(prop, value);
        if (callback) {
          callback.call(this);
        }
      };

      return function(key, val) {
        if (arguments.length > 1) {
          value = val;
          debounce(this, updateVal, delay);
          return val;
        }
      }.property();

    };
  });
define("controllers/application", 
  ["exports"],
  function(__exports__) {
    "use strict";
    var oneWay = Ember.computed.oneWay,
        equal = Ember.computed.equal;

    __exports__["default"] = Ember.Controller.extend({
      needs: ['mixin-stack', 'mixin-details'],

      emberApplication: false,
      navWidth: 180,
      inspectorWidth: 360,
      mixinStack: oneWay('controllers.mixin-stack').readOnly(),
      mixinDetails: oneWay('controllers.mixin-details').readOnly(),
      isChrome: equal('port.adapter.name', 'chrome'),

      // Indicates that the extension window is focused,
      active: true,

      inspectorExpanded: false,

      pushMixinDetails: function(name, property, objectId, details) {
        details = {
          name: name,
          property: property,
          objectId: objectId,
          mixins: details
        };

        this.get('mixinStack').pushObject(details);
        this.set('mixinDetails.model', details);
      },

      popMixinDetails: function() {
        var mixinStack = this.get('controllers.mixin-stack');
        var item = mixinStack.popObject();
        this.set('mixinDetails.model', mixinStack.get('lastObject'));
        this.get('port').send('objectInspector:releaseObject', { objectId: item.objectId });
      },

      activateMixinDetails: function(name, details, objectId) {
        var self = this;
        var objects = this.get('mixinStack').forEach(function(item) {
          self.get('port').send('objectInspector:releaseObject', { objectId: item.objectId });
        });

        this.set('mixinStack.model', []);
        this.pushMixinDetails(name, undefined, objectId, details);
      },

      droppedObject: function(objectId) {
        var mixinStack = this.get('mixinStack.model');
        var obj = mixinStack.findProperty('objectId', objectId);
        if (obj) {
          var index = mixinStack.indexOf(obj);
          var objectsToRemove = [];
          for(var i = index; i >= 0; i--) {
            objectsToRemove.pushObject(mixinStack.objectAt(i));
          }
          objectsToRemove.forEach(function(item) {
            mixinStack.removeObject(item);
          });
        }
        if (mixinStack.get('length') > 0) {
          this.set('mixinDetails.model', mixinStack.get('lastObject'));
        } else {
          this.set('mixinDetails.model', null);
        }

      }
    });
  });
define("controllers/container_type", 
  ["computed/debounce","utils/search_match","exports"],
  function(__dependency1__, __dependency2__, __exports__) {
    "use strict";
    var debounceComputed = __dependency1__["default"];
    var searchMatch = __dependency2__["default"];
    var ArrayController = Ember.ArrayController;
    var computed = Ember.computed;
    var filter = computed.filter;
    var get = Ember.get;

    __exports__["default"] = ArrayController.extend({
      needs: ['application'],
      sortProperties: ['name'],

      searchVal: debounceComputed('search', 300),

      search: null,

      arrangedContent: filter('model', function(item) {
        return searchMatch(get(item, 'name'), this.get('search'));
      }).property('model.@each.name', 'search')
    });
  });
define("controllers/container_types", 
  ["exports"],
  function(__exports__) {
    "use strict";
    var ArrayController = Ember.ArrayController;

    __exports__["default"] = ArrayController.extend({
      sortProperties: ['name']
    });
  });
define("controllers/iframes", 
  ["exports"],
  function(__exports__) {
    "use strict";
    var ArrayController = Ember.ArrayController;
    var alias = Ember.computed.alias;
    var mapComputed = Ember.computed.map;
    var run = Ember.run;

    __exports__["default"] = ArrayController.extend({
      model: mapComputed('port.detectedApplications', function(item) {
        var name = item.split('__');
        return {
          name: name[1],
          val: item
        };
      }),

      selectedApp: alias('port.applicationId'),

      selectedDidChange: function() {
        // Change iframe being debugged
        var url = '/';
        var applicationId = this.get('selectedApp');
        var app = this.container.lookup('application:main');
        var list = this.get('port').get('detectedApplications');

        run(app, app.reset);
        var router = app.__container__.lookup('router:main');
        var port = app.__container__.lookup('port:main');
        port.set('applicationId', applicationId);
        port.set('detectedApplications', list);

        // start
        router.location.setURL(url);
        run(app, app.handleURL, url);

      }.observes('selectedApp')
    });
  });
define("controllers/mixin_detail", 
  ["exports"],
  function(__exports__) {
    "use strict";
    var oneWay = Ember.computed.oneWay;

    __exports__["default"] = Ember.ObjectController.extend({
      needs: ['mixin-details'],

      mixinDetails: oneWay('controllers.mixin-details').readOnly(),
      objectId: oneWay('mixinDetails.objectId').readOnly(),

      isExpanded: function() {
        return this.get('model.expand') && this.get('model.properties.length') > 0;
      }.property('model.expand', 'model.properties.length'),

      actions: {
        calculate: function(property) {
          var objectId = this.get('objectId');
          var mixinIndex = this.get('mixinDetails.mixins').indexOf(this.get('model'));

          this.get('port').send('objectInspector:calculate', {
            objectId: objectId,
            property: property.name,
            mixinIndex: mixinIndex
          });
        },

        sendToConsole: function(property) {
          var objectId = this.get('objectId');

          this.get('port').send('objectInspector:sendToConsole', {
            objectId: objectId,
            property: property.name
          });
        },

        toggleExpanded: function() {
          this.toggleProperty('isExpanded');
        },

        digDeeper: function(property) {
          var objectId = this.get('objectId');

          this.get('port').send('objectInspector:digDeeper', {
            objectId: objectId,
            property: property.name
          });
        },

        saveProperty: function(prop, val) {
          var mixinIndex = this.get('mixinDetails.mixins').indexOf(this.get('model'));

          this.get('port').send('objectInspector:saveProperty', {
            objectId: this.get('objectId'),
            property: prop,
            value: val,
            mixinIndex: mixinIndex
          });
        }
      }
    });
  });
define("controllers/mixin_details", 
  ["exports"],
  function(__exports__) {
    "use strict";
    __exports__["default"] = Ember.ObjectController.extend();
  });
define("controllers/mixin_property", 
  ["exports"],
  function(__exports__) {
    "use strict";
    var equal = Ember.computed.equal;
    var alias = Ember.computed.alias;

    __exports__["default"] = Ember.ObjectController.extend({
      isEdit: false,

      // Bound to editing textbox
      txtValue: null,

      isCalculated: function() {
        return this.get('value.type') !== 'type-descriptor';
      }.property('value.type'),

      isEmberObject: equal('value.type', 'type-ember-object'),

      isComputedProperty: alias('value.computed'),

      isFunction: equal('value.type', 'type-function'),

      isArray: equal('value.type', 'type-array'),

      isDate: equal('value.type', 'type-date'),

      actions: {
        valueClick: function() {
          if (this.get('isEmberObject') || this.get('isArray')) {
            this.get('target').send('digDeeper', this.get('model'));
            return;
          }

          if (this.get('isComputedProperty') && !this.get('isCalculated')) {
            this.get('target').send('calculate', this.get('model'));
            return;
          }

          if (this.get('isFunction') || this.get('overridden') || this.get('isDate') || this.get('readOnly')) {
            return;
          }

          var value = this.get('value.inspect');
          var type = this.get('value.type');
          if (type === 'type-string') {
            value = '"' + value + '"';
          }
          this.set('txtValue', value);
          this.set('isEdit', true);

        },

        saveProperty: function() {
          var txtValue = this.get('txtValue');
          var realValue;
          try {
            realValue = JSON.parse(txtValue);
          } catch(e) {
            // if surrounded by quotes, remove quotes
            var match = txtValue.match(/^"(.*)"$/);
            if (match && match.length > 1) {
              realValue = match[1];
            } else {
              realValue = txtValue;
            }
          }
          this.get('target').send('saveProperty', this.get('name'), realValue);
        },

        finishedEditing: function() {
          this.set('isEdit', false);
        }
      }
    });
  });
define("controllers/mixin_stack", 
  ["exports"],
  function(__exports__) {
    "use strict";
    __exports__["default"] = Ember.ArrayController.extend({
      needs: ['application'],

      trail: function() {
        var nested = this.slice(1);
        if (nested.length === 0) { return ""; }
        return "." + nested.mapProperty('property').join(".");
      }.property('[]'),

      isNested: function() {
        return this.get('length') > 1;
      }.property('[]'),


      actions: {
        popStack: function() {
          if(this.get('isNested')) {
            this.get('controllers.application').popMixinDetails();
          }
        },

        sendObjectToConsole: function(obj) {
          var objectId = Ember.get(obj, 'objectId');
          this.get('port').send('objectInspector:sendToConsole', {
            objectId: objectId
          });
        }
      }
    });
  });
define("controllers/model_type_item", 
  ["exports"],
  function(__exports__) {
    "use strict";
    var oneWay = Ember.computed.oneWay;

    __exports__["default"] = Ember.ObjectController.extend({
      needs: ['model-types'],

      modelTypes: oneWay('controllers.model-types').readOnly(),

      selected: function() {
        return this.get('model') === this.get('modelTypes.selected');
      }.property('modelTypes.selected')
    });
  });
define("controllers/model_types", 
  ["exports"],
  function(__exports__) {
    "use strict";
    __exports__["default"] = Ember.ArrayController.extend({
      navWidth: 180,
      sortProperties: ['name']
    });
  });
define("controllers/promise_item", 
  ["exports"],
  function(__exports__) {
    "use strict";
    var COLOR_MAP = {
      red: '#ff2717',
      blue: '#174fff',
      green: '#006400'
    };

    var alias = Ember.computed.alias;
    var notEmpty = Ember.computed.notEmpty;
    var gt = Ember.computed.gt;
    var empty = Ember.computed.empty;
    var and = Ember.computed.and;
    var computedEqual = Ember.computed.equal;

    __exports__["default"] = Ember.ObjectProxy.extend({
      promiseTreeController: function() {
        return this.container.lookup('controller:promiseTree');
      }.property(),

      filter: alias('promiseTreeController.filter'),
      effectiveSearch: alias('promiseTreeController.effectiveSearch'),

      model: alias('content'),

      isError: computedEqual('reason.type', 'type-error'),

      style: function() {
        var color = '';
        if (this.get('isFulfilled')) {
          color = 'green';
        } else if (this.get('isRejected')) {
          color = 'red';
        } else {
          color = 'blue';
        }
        return 'background-color:' + COLOR_MAP[color] + ';color:white;';
      }.property('model.state'),


      nodeStyle: function() {
        var relevant;
        switch(this.get('filter')) {
          case 'pending':
            relevant = this.get('isPending');
            break;
          case 'rejected':
            relevant = this.get('isRejected');
            break;
          case 'fulfilled':
            relevant = this.get('isFulfilled');
            break;
          default:
            relevant = true;
        }
        if (relevant && !Ember.isEmpty(this.get('effectiveSearch'))) {
          relevant = this.get('model').matchesExactly(this.get('effectiveSearch'));
        }
        if (!relevant) {
          return 'opacity: 0.3';
        }
      }.property('state', 'filter', 'effectiveSearch'),

      labelStyle: function() {
        return 'padding-left: ' + ((+this.get('level') * 20) + 5) + "px";
      }.property('level'),

      expandedClass: function() {
        if (!this.get('hasChildren')) { return; }

        if (this.get('isExpanded')) {
          return 'row_arrow_expanded';
        } else {
          return 'row_arrow_collapsed';
        }
      }.property('hasChildren', 'isExpanded'),

      hasChildren: gt('children.length', 0),

      isTopNode: empty('parent'),

      settledValue: function() {
        if (this.get('isFulfilled')) {
          return this.get('value');
        } else if (this.get('isRejected')) {
          return this.get('reason');
        } else {
          return '--';
        }
      }.property('value'),

      isValueInspectable: notEmpty('settledValue.objectId'),

      hasValue: function() {
        return this.get('isSettled') && this.get('settledValue.type') !== 'type-undefined';
      }.property('settledValue', 'isSettled'),

      label: function() {
        return this.get('model.label') || (!!this.get('model.parent') && 'Then') || '<Unknown Promise>';
      }.property('model.label'),

      state: function() {
        var state = this.get('model.state');
        if (this.get('isFulfilled')) {
          return 'Fulfilled';
        } else if (this.get('isRejected')) {
          return 'Rejected';
        } else if (this.get('parent') && !this.get('parent.isSettled')) {
          return 'Waiting for parent';
        } else {
          return 'Pending';
        }

      }.property('model.state'),


      timeToSettle: function() {
      if (!this.get('createdAt') || !this.get('settledAt')) {
            return ' -- ';
          }
        var startedAt = this.get('parent.settledAt') || this.get('createdAt');
        var remaining = this.get('settledAt').getTime() - startedAt.getTime();
        return remaining;
      }.property('createdAt', 'settledAt', 'parent.settledAt')
    });
  });
define("controllers/promise_tree", 
  ["computed/custom_filter","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var filterComputed = __dependency1__["default"];

    // Manual implementation of item controllers
    function itemProxyComputed(dependentKey, itemProxy) {
      var options = {
        addedItem: function(array, item, changeMeta, instanceMeta) {
          var proxy = itemProxy.create({ content: item });
          array.insertAt(changeMeta.index, proxy);
          return array;
        },
        removedItem: function(array, item, changeMeta, instanceMeta) {
          var proxy = array.objectAt(changeMeta.index);
          array.removeAt(changeMeta.index, 1);
          proxy.destroy();
          return array;
        }
      };

      return Ember.arrayComputed(dependentKey, options);
    }

    var equal = Ember.computed.equal;
    var bool = Ember.computed.bool;
    var and = Ember.computed.and;
    var not = Ember.computed.not;

    __exports__["default"] = Ember.ArrayController.extend({
      needs: ['application'],

      createdAfter: null,

      // below used to show the "refresh" message
      isEmpty: equal('model.length', 0),
      wasCleared: bool('createdAfter'),
      neverCleared: not('wasCleared'),
      shouldRefresh: and('isEmpty', 'neverCleared'),

      // Keep track of promise stack traces.
      // It is opt-in due to performance reasons.
      instrumentWithStack: false,

      stackChanged: function() {
        this.port.send('promise:setInstrumentWithStack', { instrumentWithStack: this.get('instrumentWithStack') });
      }.observes('instrumentWithStack').on('init'),

      init: function() {
        // List-view does not support item controllers
        this.reopen({
          items: itemProxyComputed('filtered', this.get('promiseItemController'))
        });
      },

      promiseItemController: function() {
        return this.container.lookupFactory('controller:promise-item');
      }.property(),

      // TODO: This filter can be further optimized
      filtered: filterComputed(
          'model.@each.createdAt',
          'model.@each.fulfilledBranch',
          'model.@each.rejectedBranch',
          'model.@each.pendingBranch',
          'model.@each.isVisible', function(item) {

        // exclude cleared promises
        if (this.get('createdAfter') && item.get('createdAt') < this.get('createdAfter')) {
          return false;
        }

        if (!item.get('isVisible')) {
          return false;
        }

        // Exclude non-filter complying promises
        // If at least one of their children passes the filter,
        // then they pass
        var include = true;
        if (this.get('filter') === 'pending') {
          include = item.get('pendingBranch');
        } else if (this.get('filter') === 'rejected') {
          include = item.get('rejectedBranch');
        } else if (this.get('filter') === 'fulfilled') {
          include = item.get('fulfilledBranch');
        }
        if (!include) {
          return false;
        }

        // Search filter
        // If they or at least one of their children
        // match the search, then include them
        var search = this.get('effectiveSearch');
        if (!Ember.isEmpty(search)) {
          return item.matches(search);
        }
        return true;

      }),

      filter: 'all',

      noFilter: equal('filter', 'all'),
      isRejectedFilter: equal('filter', 'rejected'),
      isPendingFilter: equal('filter', 'pending'),
      isFulfilledFilter: equal('filter', 'fulfilled'),

      search: null,
      effectiveSearch: null,

      searchChanged: function() {
        Ember.run.debounce(this, this.notifyChange, 500);
      }.observes('search'),

      notifyChange: function() {
        var self = this;
        this.set('effectiveSearch', this.get('search'));
        Ember.run.next(function() {
          self.notifyPropertyChange('model');
        });
      },

      actions: {
        setFilter: function(filter) {
          var self = this;
          this.set('filter', filter);
          Ember.run.next(function() {
            self.notifyPropertyChange('filtered');
          });
        },
        clear: function() {
          this.set('createdAfter', new Date());
          Ember.run.once(this, this.notifyChange);
        },
        tracePromise: function(promise) {
          this.get('port').send('promise:tracePromise', { promiseId: promise.get('guid') });
        }
      }
    });
  });
define("controllers/record_filter", 
  ["exports"],
  function(__exports__) {
    "use strict";
    __exports__["default"] = Ember.ObjectController.extend({
      needs: ['records'],

      checked: function() {
        return this.get('controllers.records.filterValue') === this.get('name');
      }.property('controllers.records.filterValue')
    });
  });
define("controllers/record_item", 
  ["exports"],
  function(__exports__) {
    "use strict";
    var COLOR_MAP = {
      red: '#ff2717',
      blue: '#174fff',
      green: '#006400'
    };

    __exports__["default"] = Ember.ObjectController.extend({
      needs: ['records'],

      modelTypeColumns: Ember.computed.alias('controllers.records.columns'),

      // TODO: Color record based on `color` property.
      style: function() {
        if (!Ember.isEmpty(this.get('color'))) {
          var color = COLOR_MAP[this.get('color')];
          if (color) {
            return 'color:' + color + ';';
          }
        }
        return '';
      }.property('color'),

      columns: function() {
        var self = this;
        return this.get('modelTypeColumns').map(function(col) {
          return { name: col.name, value: self.get('columnValues.' + col.name) };
        });
      }.property('modelTypeColumns.@each', 'model.columnValues')
    });
  });
define("controllers/records", 
  ["utils/escape_reg_exp","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var escapeRegExp = __dependency1__["default"];
    var alias = Ember.computed.alias;
    var none = Ember.computed.none;

    __exports__["default"] = Ember.ArrayController.extend({
      init: function() {
        this._super();
        this.set('filters', []);
        this.set('filterValues', {});
      },
      needs: ['application'],

      columns: alias('modelType.columns'),

      search: '',
      filters: undefined,
      filterValue: undefined,

      noFilterValue: none('filterValue'),

      actions: {
        setFilter: function(val) {
          val = val || null;
          this.set('filterValue', val);
        }
      },

      modelChanged: function() {
        this.setProperties({
          filterValue: null,
          search: ''
        });
      }.observes('model'),

      recordToString: function(record) {
        var search = '';
        var searchKeywords = Ember.get(record, 'searchKeywords');
        if (searchKeywords) {
          search = Ember.get(record, 'searchKeywords').join(' ');
        }
        return search.toLowerCase();
      },

      filtered: function() {
        var self = this, search = this.get('search'), filter = this.get('filterValue');
        var content = this.get('model').filter(function(item) {
          // check filters
          if (filter && !Ember.get(item, 'filterValues.' + filter)) {
            return false;
          }

          // check search
          if (!Ember.isEmpty(search)) {
            var searchString = self.recordToString(item);
            return !!searchString.match(new RegExp('.*' + escapeRegExp(search.toLowerCase()) + '.*'));
          }
          return true;
        });

        var Controller = this.container.lookupFactory('controller:array', { singleton: false});
        var controller = Controller.create({model: content, itemController: 'recordItem'});
        return controller;
      }.property('search', 'model.@each.columnValues', 'model.@each.filterValues', 'filterValue')
    });
  });
define("controllers/render_item", 
  ["utils/escape_reg_exp","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var escapeRegExp = __dependency1__["default"];
    var ObjectController = Ember.ObjectController;
    var gt = Ember.computed.gt;
    var oneWay = Ember.computed.oneWay;
    var isEmpty = Ember.isEmpty;
    var runOnce = Ember.run.once;

    __exports__["default"] = ObjectController.extend({
      needs: ['render-tree'],

      search: oneWay('controllers.render-tree.search').readOnly(),

      isExpanded: false,

      expand: function() {
        this.set('isExpanded', true);
      },

      searchChanged: function() {
        var search = this.get('search');
        if (!isEmpty(search)) {
          runOnce(this, 'expand');
        }
      }.observes('search').on('init'),

      searchMatch: function() {
        var search = this.get('search');
        if (isEmpty(search)) {
          return true;
        }
        var name = this.get('name');
        var regExp = new RegExp(escapeRegExp(search.toLowerCase()));
        return !!name.toLowerCase().match(regExp);
      }.property('search', 'name'),

      nodeStyle: function() {
        if (!this.get('searchMatch')) {
            return 'opacity: 0.5';
        }
      }.property('searchMatch'),

      level: function() {
        var parentLevel = this.get('target.level');
        if (parentLevel === undefined) {
          parentLevel = -1;
        }
        return parentLevel + 1;
      }.property('target.level'),

      nameStyle: function() {
        return 'padding-left: ' + ((+this.get('level') * 20) + 5) + "px";
      }.property('level'),

      hasChildren: gt('children.length', 0),

      expandedClass: function() {
        if (!this.get('hasChildren')) { return; }

        if (this.get('isExpanded')) {
          return 'row_arrow_expanded';
        } else {
          return 'row_arrow_collapsed';
        }
      }.property('hasChildren', 'isExpanded'),

      readableTime: function() {
        var d = new Date(this.get('timestamp')),
            ms = d.getMilliseconds(),
            seconds = d.getSeconds(),
            minutes = d.getMinutes().toString().length === 1 ? '0' + d.getMinutes() : d.getMinutes(),
            hours = d.getHours().toString().length === 1 ? '0' + d.getHours() : d.getHours();

        return hours + ':' + minutes + ':' + seconds + ':' + ms;
      }.property('timestamp'),

      actions: {
        toggleExpand: function() {
          this.toggleProperty('isExpanded');
        }
      }

    });
  });
define("controllers/render_tree", 
  ["utils/escape_reg_exp","computed/debounce","exports"],
  function(__dependency1__, __dependency2__, __exports__) {
    "use strict";
    var escapeRegExp = __dependency1__["default"];
    var debounceComputed = __dependency2__["default"];
    var get = Ember.get;
    var isEmpty = Ember.isEmpty;
    var and = Ember.computed.and;
    var equal = Ember.computed.equal;
    var filter = Ember.computed.filter;

    __exports__["default"] = Ember.ArrayController.extend({
      needs: ['application'],

      initialEmpty: false,
      modelEmpty: equal('model.length', 0),
      showEmpty: and('initialEmpty', 'modelEmpty'),

      // bound to the input field, updates the `search` property
      // 300ms after changing
      searchField: debounceComputed('search', 300, function() {
        this.notifyPropertyChange('model');
      }),

      // model filtered based on this value
      search: '',

      escapedSearch: function() {
        return escapeRegExp(this.get('search').toLowerCase());
      }.property('search'),

      arrangedContent: filter('model', function(item) {
        var search = this.get('escapedSearch');
        if (isEmpty(search)) {
          return true;
        }
        var regExp = new RegExp(search);
        return !!recursiveMatch(item, regExp);
      })
    });

    function recursiveMatch(item, regExp) {
      var children, child;
      var name = get(item, 'name');
      if (name.toLowerCase().match(regExp)) {
        return true;
      }
      children = get(item, 'children');
      for (var i = 0; i < children.length; i++) {
        child = children[i];
        if (recursiveMatch(child, regExp)) {
          return true;
        }
      }
      return false;
    }
  });
define("controllers/route_item", 
  ["utils/check_current_route","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var checkCurrentRoute = __dependency1__["default"];

    var get = Ember.get;

    __exports__["default"] = Ember.ObjectController.extend({
      needs: 'routeTree',

      details: null,

      withDetails: false,

      hasChildren: Ember.computed.gt('children.length', 0),

      labelStyle: function() {
        return 'padding-left: ' + ((+this.get('model.parentCount') * 20) + 5) + "px";
      }.property('parentCount'),

      currentRoute: Ember.computed.alias('controllers.routeTree.currentRoute'),

      isCurrent: function() {
        var currentRoute = this.get('currentRoute');
        if (!currentRoute) {
          return false;
        }

        return checkCurrentRoute( currentRoute, this.get('value.name') );
      }.property('currentRoute', 'value.name')
    });
  });
define("controllers/route_tree", 
  ["utils/check_current_route","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var checkCurrentRoute = __dependency1__["default"];

    var filter = Ember.computed.filter;

    __exports__["default"] = Ember.ArrayController.extend({
      needs: ['application'],
      itemController: 'routeItem',
      currentRoute: null,
      options: {
        hideRoutes: false
      },

      arrangedContent: filter('content', function(routeItem) {
        var currentRoute = this.get('currentRoute'),
            hideRoutes = this.get('options.hideRoutes');

        if( hideRoutes && currentRoute ) {
          return checkCurrentRoute( currentRoute, routeItem.value.name );
        } else {
          return true;
        }
      }).property('content', 'options.hideRoutes'),

      currentRouteChanged: function() {
        if (this.get('options.hideRoutes')) {
          this.propertyDidChange('content');
        }
      }.observes('currentRoute')
    });
  });
define("controllers/view_item", 
  ["exports"],
  function(__exports__) {
    "use strict";
    var not = Ember.computed.not;
    var oneWay = Ember.computed.oneWay;
    var bool = Ember.computed.bool;

    __exports__["default"] = Ember.ObjectController.extend({
      needs: ['view-tree'],
      viewTree: oneWay('controllers.view-tree').readOnly(),

      hasView: not('model.value.isVirtual'),
      hasElement: not('model.value.isVirtual'),

      isCurrent: function() {
        return this.get('viewTree.pinnedObjectId') === this.get('model.value.objectId');
      }.property('viewTree.pinnedObjectId', 'model.value.objectId'),

      hasController: bool('model.value.controller'),

      hasModel: bool('model.value.model'),

      modelInspectable: function() {
        return this.get('hasModel') && this.get('value.model.type') === 'type-ember-object';
      }.property('hasModel', 'value.model.type'),

      labelStyle: function() {
        return 'padding-left: ' + ((+this.get('model.parentCount') * 20) + 5) + "px";
      }.property('model.parentCount'),

      actions: {
        inspectView: function() {
          if (this.get('hasView')) {
            this.get('target').send('inspect', this.get('value.objectId'));
          }
        },
        inspectElement: function(objectId) {
          if (!objectId && this.get('hasElement')) {
            objectId = this.get('value.objectId');
          }

          if (objectId) {
            this.get('target').send('inspectElement', objectId);
          }
        },
        inspectModel: function(objectId) {
          if (this.get('modelInspectable')) {
            this.get('target').send('inspect', objectId);
          }
        }
      }

    });
  });
define("controllers/view_tree", 
  ["exports"],
  function(__exports__) {
    "use strict";
    __exports__["default"] = Ember.ArrayController.extend({
      needs: ['application'],
      itemController: 'view-item',
      pinnedObjectId: null,
      inspectingViews: false,
      options: {
        components: false,
        allViews: false
      },

      optionsChanged: function() {
        this.port.send('view:setOptions', { options: this.get('options') });
      }.observes('options.components', 'options.allViews').on('init'),

      actions: {
        previewLayer: function(node) {
          if (node !== this.get('pinnedNode')) {
            this.get('port').send('view:previewLayer', { objectId: node.value.objectId });
          }
        },

        hidePreview: function(node) {
          this.get('port').send('view:hidePreview', { objectId: node.value.objectId });
        },

        toggleViewInspection: function() {
          this.get('port').send('view:inspectViews', { inspect: !this.get('inspectingViews') });
        },

        sendModelToConsole: function(viewId) {
          // do not use `sendObjectToConsole` because models don't have to be ember objects
          this.get('port').send('view:sendModelToConsole', { viewId: viewId });
        },

        sendObjectToConsole: function(objectId) {
          this.get('port').send('objectInspector:sendToConsole', { objectId: objectId });
        }
      }
    });
  });
define("helpers/ms_to_time", 
  ["exports"],
  function(__exports__) {
    "use strict";
    var isEmpty = Ember.isEmpty;
    var pow = Math.pow;
    var round = Math.round;

    __exports__["default"] = function(time) {
      if (time && !isNaN(+time)) {
        var formatted = time.toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,');
        return formatted + 'ms';
      }

    };
  });
define("libs/promise_assembler", 
  ["models/promise","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var Promise = __dependency1__["default"];

    var EventedMixin = Ember.Evented;

    var arrayComputed = Ember.computed(function(){
      return [];
    });

    var objectComputed = Ember.computed(function(){
      return {};
    });

    __exports__["default"] = Ember.Object.extend(EventedMixin, {
      all: arrayComputed,
      topSort: arrayComputed,
      topSortMeta: objectComputed,
      promiseIndex: objectComputed,

      // Used to track whether current message received
      // is the first in the request
      // Mainly helps in triggering 'firstMessageReceived' event
      firstMessageReceived: false,

      start: function() {
        this.get('port').on('promise:promisesUpdated', this, this.addOrUpdatePromises);
        this.get('port').send('promise:getAndObservePromises');
      },

      stop: function() {
        this.get('port').off('promise:promisesUpdated', this, this.addOrUpdatePromises);
        this.get('port').send('promise:releasePromises');
        this.reset();
      },

      reset: function() {
        this.set('topSortMeta', {});
        this.set('promiseIndex', {});
        this.get('topSort').clear();

        this.set('firstMessageReceived', false);
        var all = this.get('all');
        // Lazily destroy promises
        // Allows for a smooth transition on deactivate,
        // and thus providing the illusion of better perf
        Ember.run.later(this, function() {
         this.destroyPromises(all);
        }, 500);
        this.set('all', []);
      },

      destroyPromises: function(promises) {
        promises.forEach(function(item) {
          item.destroy();
        });
      },

      addOrUpdatePromises: function(message) {
        this.rebuildPromises(message.promises);

        if (!this.get('firstMessageReceived')) {
          this.set('firstMessageReceived', true);
          this.trigger('firstMessageReceived');
        }
      },

      rebuildPromises: function(promises) {
        promises.forEach(function(props) {
          props = Ember.copy(props);
          var childrenIds = props.children;
          var parentId = props.parent;
          delete props.children;
          delete props.parent;
          if (parentId && parentId !== props.guid) {
            props.parent = this.updateOrCreate({ guid: parentId });
          }
          var promise = this.updateOrCreate(props);
          if (childrenIds) {
            childrenIds.forEach(function(childId){
              // avoid infinite recursion
              if (childId === props.guid) {
                return;
              }
              var child = this.updateOrCreate({ guid: childId, parent: promise });
              promise.get('children').pushObject(child);
            }.bind(this));
          }
        }.bind(this));
      },

      updateTopSort: function(promise) {
        var topSortMeta = this.get('topSortMeta'),
            guid = promise.get('guid'),
            meta = topSortMeta[guid],
            isNew = !meta,
            hadParent = false,
            hasParent = !!promise.get('parent'),
            topSort = this.get('topSort'),
            parentChanged = isNew;

        if (isNew) {
          meta = topSortMeta[guid] = {};
        } else {
          hadParent = meta.hasParent;
        }
        if (!isNew && hasParent !== hadParent) {
          // todo: implement recursion to reposition children
          topSort.removeObject(promise);
          parentChanged = true;
        }
        meta.hasParent = hasParent;
        if (parentChanged) {
          this.insertInTopSort(promise);
        }
      },

      insertInTopSort: function(promise) {
        var topSort = this.get('topSort');
        if (promise.get('parent')) {
          var parentIndex = topSort.indexOf(promise.get('parent'));
          topSort.insertAt(parentIndex + 1, promise);
        } else {
          topSort.pushObject(promise);
        }
        promise.get('children').forEach(function(child) {
          topSort.removeObject(child);
          this.insertInTopSort(child);
        }.bind(this));
      },

      updateOrCreate: function(props) {
        var guid = props.guid;
        var parentChanged = true;
        var promise = this.findOrCreate(guid);

        promise.setProperties(props);

        this.updateTopSort(promise);

        return promise;
      },

      createPromise: function(props) {
        var promise = Promise.create(props),
            index = this.get('all.length');

        this.get('all').pushObject(promise);
        this.get('promiseIndex')[promise.get('guid')] = index;
        return promise;
      },

      find: function(guid) {
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
        if (!guid) {
          Ember.assert('You have tried to findOrCreate without a guid');
        }
        return this.find(guid) || this.createPromise({
          guid: guid
        });
      }
    });
  });
define("mixins/fake_table", 
  ["exports"],
  function(__exports__) {
    "use strict";
    /* list-view comes with its own scrollbar
     * The header columns however are not inside list-view.  The scrollbar will
     * cause flexbox to fail to match header and content.
     * This is a hack to allow account for scrollbar width (if any)
     */

    function accountForScrollbar() {
      /*jshint validthis:true */
      var outside = this.$('.list-tree').innerWidth();
      var inside = this.$('.ember-list-container').innerWidth();
      this.$('.spacer').width(outside - inside);
    }

    __exports__["default"] = Ember.Mixin.create({
      _accountForScrollbar: function() {
        Ember.run.scheduleOnce('afterRender', this, accountForScrollbar);
      }.on('didInsertElement')
    });
  });
define("models/promise", 
  ["utils/escape_reg_exp","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var escapeRegExp = __dependency1__["default"];
    var typeOf = Ember.typeOf;
    var computed = Ember.computed;
    var or = computed.or;
    var equal = computed.equal;
    var not = computed.not;

    var dateComputed = function() {
      return Ember.computed(
        function(key, date) {
          if (date !== undefined) {
            if (typeOf(date) === 'date') {
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

      parent: null,

      level: function() {
        var parent = this.get('parent');
        if (!parent) {
          return 0;
        }
        return parent.get('level') + 1;
      }.property('parent.level'),

      isSettled: or('isFulfilled', 'isRejected'),

      isFulfilled: equal('state', 'fulfilled'),

      isRejected: equal('state', 'rejected'),

      isPending: not('isSettled'),

      children: function() {
        return [];
      }.property(),

      pendingBranch: function() {
        return this.recursiveState('isPending', 'pendingBranch');
      }.property('isPending', 'children.@each.pendingBranch'),

      rejectedBranch: function() {
        return this.recursiveState('isRejected', 'rejectedBranch');
      }.property('isRejected', 'children.@each.rejectedBranch'),

      fulfilledBranch: function() {
        return this.recursiveState('isFulfilled', 'fulfilledBranch');
      }.property('isFulfilled', 'children.@each.fulfilledBranch'),

      recursiveState: function(prop, cp) {
        if (this.get(prop)) {
          return true;
        }
        for (var i = 0; i < this.get('children.length'); i++) {
          if (this.get('children').objectAt(i).get(cp)) {
            return true;
          }
        }
        return false;
      },

      // Need this observer because CP dependent keys do not support nested arrays
      // TODO: This can be so much better
      stateChanged: function() {
        if (!this.get('parent')) {
          return;
        }
        if (this.get('pendingBranch') && !this.get('parent.pendingBranch')) {
          this.get('parent').notifyPropertyChange('fulfilledBranch');
          this.get('parent').notifyPropertyChange('rejectedBranch');
          this.get('parent').notifyPropertyChange('pendingBranch');
        } else if (this.get('fulfilledBranch') && !this.get('parent.fulfilledBranch')) {
          this.get('parent').notifyPropertyChange('fulfilledBranch');
          this.get('parent').notifyPropertyChange('rejectedBranch');
          this.get('parent').notifyPropertyChange('pendingBranch');
        } else if (this.get('rejectedBranch') && !this.get('parent.rejectedBranch')) {
          this.get('parent').notifyPropertyChange('fulfilledBranch');
          this.get('parent').notifyPropertyChange('rejectedBranch');
          this.get('parent').notifyPropertyChange('pendingBranch');
        }

      }.observes('pendingBranch', 'fulfilledBranch', 'rejectedBranch'),

      updateParentLabel: function() {
        this.addBranchLabel(this.get('label'), true);
      }.observes('label', 'parent'),

      addBranchLabel: function(label, replace) {
        if (Ember.isEmpty(label)) {
          return;
        }
        if (replace) {
          this.set('branchLabel', label);
        } else {
          this.set('branchLabel', this.get('branchLabel') + ' ' + label);
        }

        var parent = this.get('parent');
        if (parent) {
          parent.addBranchLabel(label);
        }
      },

      branchLabel: '',

      matches: function(val) {
        return !!this.get('branchLabel').toLowerCase().match(new RegExp('.*' + escapeRegExp(val.toLowerCase()) + '.*'));
      },

      matchesExactly: function(val) {
        return !!((this.get('label') || '').toLowerCase().match(new RegExp('.*' + escapeRegExp(val.toLowerCase()) + '.*')));
      },



      // EXPANDED / COLLAPSED PROMISES

      isExpanded: false,

      isManuallyExpanded: undefined,

      stateOrParentChanged: function() {
        var parent = this.get('parent');
        if (parent) {
          Ember.run.once(parent, 'recalculateExpanded');
        }
      }.observes('isPending', 'isFulfilled', 'isRejected', 'parent'),

      _findTopParent: function() {
        var parent = this.get('parent');
        if(!parent) {
          return this;
        } else {
          return parent._findTopParent();
        }
      },

      recalculateExpanded: function() {
        var isExpanded = false;
        if (this.get('isManuallyExpanded') !== undefined) {
          isExpanded = this.get('isManuallyExpanded');
        } else {
          var children  = this._allChildren();
          for (var i = 0, l = children.length; i < l; i++) {
            var child = children[i];
            if (child.get('isRejected')) {
              isExpanded = true;
            }
            if (child.get('isPending') && !child.get('parent.isPending')) {
              isExpanded = true;
            }
            if (isExpanded) {
              break;
            }
          }
          var parents = this._allParents();
          if (isExpanded) {
            parents.forEach(function(parent) {
              parent.set('isExpanded', true);
            });
          } else if(this.get('parent.isExpanded')) {
            this.get('parent').recalculateExpanded();
          }
        }
        this.set('isExpanded', isExpanded);
        return isExpanded;
      },

      isVisible: function() {
        if (this.get('parent')) {
          return this.get('parent.isExpanded') && this.get('parent.isVisible');
        }
        return true;
      }.property('parent.isExpanded', 'parent', 'parent.isVisible'),

      _allChildren: function() {
        var children = Ember.$.extend([], this.get('children'));
        children.forEach(function(item) {
          children = Ember.$.merge(children, item._allChildren());
        });
        return children;
      },

      _allParents: function() {
        var parent = this.get('parent');
        if (parent) {
          return Ember.$.merge([parent], parent._allParents());
        } else {
          return [];
        }
      }
    });
  });
define("port", 
  ["exports"],
  function(__exports__) {
    "use strict";
    __exports__["default"] = Ember.Object.extend(Ember.Evented, {
      applicationId: undefined,

      detectedApplications: function() {
        return [];
      }.property(),

      init: function() {
        var detectedApplications = this.get('detectedApplications');
        this.get('adapter').onMessageReceived(function(message) {
          if (!message.applicationId) {
            return;
          }
          if (!this.get('applicationId')) {
            this.set('applicationId', message.applicationId);
          }
          // save list of application ids
          if (detectedApplications.indexOf(message.applicationId) === -1) {
            detectedApplications.pushObject(message.applicationId);
          }

          var applicationId = this.get('applicationId');
          if (applicationId === message.applicationId) {
            this.trigger(message.type, message, applicationId);
          }
        }.bind(this));
      },
      send: function(type, message) {
        message = message || {};
        message.type = type;
        message.from = 'devtools';
        message.applicationId = this.get('applicationId');
        this.get('adapter').sendMessage(message);
      }
    });
  });
define("router", 
  ["exports"],
  function(__exports__) {
    "use strict";
    var Router = Ember.Router.extend({
      location: 'none'
    });

    Router.map(function() {
      this.resource('view-tree', { path: '/' });
      this.resource('route-tree');

      this.resource('data', function() {
        this.resource('model-types', function() {
          this.resource('model-type', { path: '/:type_id'}, function() {
            this.resource('records');
          });
        });
      });

      this.resource('promises', function() {
        this.resource('promise-tree');
      });

      this.resource('info');
      this.resource('render-tree');
      this.resource('container-types', function() {
        this.resource('container-type', { path: '/:type_id' });
      });
    });

    __exports__["default"] = Router;
  });
define("routes/application", 
  ["exports"],
  function(__exports__) {
    "use strict";
    __exports__["default"] = Ember.Route.extend({
      setupController: function(controller, model) {
        this.controllerFor('mixinStack').set('model', []);

        this.get('port').on('objectInspector:updateObject', this, this.updateObject);
        this.get('port').on('objectInspector:updateProperty', this, this.updateProperty);
        this.get('port').on('objectInspector:droppedObject', this, this.droppedObject);

        this.get('port').one('general:applicationBooted', this, function(message) {
          controller.set('emberApplication', message.booted);
        });
        this.get('port').send('general:applicationBooted');
        this._super(controller, model);
      },

      deactivate: function() {
        this.get('port').off('objectInspector:updateObject', this, this.updateObject);
        this.get('port').off('objectInspector:updateProperty', this, this.updateProperty);
        this.get('port').off('objectInspector:droppedObject', this, this.droppedObject);

      },

      updateObject: function(options) {
        var details = options.details,
          name = options.name,
          property = options.property,
          objectId = options.objectId;

        Ember.NativeArray.apply(details);
        details.forEach(arrayize);

        var controller = this.get('controller');

        if (options.parentObject) {
          controller.pushMixinDetails(name, property, objectId, details);
        } else {
          controller.activateMixinDetails(name, details, objectId);
        }

        this.send('expandInspector');
      },

      updateProperty: function(options) {
        var detail = this.controllerFor('mixinDetails').get('mixins').objectAt(options.mixinIndex);
        var property = Ember.get(detail, 'properties').findProperty('name', options.property);
        Ember.set(property, 'value', options.value);
      },

      droppedObject: function(message) {
        var controller = this.get('controller');
        controller.droppedObject(message.objectId);
      },

      actions: {
        expandInspector: function() {
          this.set("controller.inspectorExpanded", true);
        },
        toggleInspector: function() {
          this.toggleProperty("controller.inspectorExpanded");
        },
        inspectObject: function(objectId) {
          if (objectId) {
            this.get('port').send('objectInspector:inspectById', { objectId: objectId });
          }
        },
        setIsDragging: function (isDragging) {
          this.set('controller.isDragging', isDragging);
        },
        refreshPage: function() {
          this.get('port').send('general:refresh');
          // inject ember_debug as quickly as possible in chrome
          // so that promises created on dom ready are caught
          this.get('adapter').willReload();
        }
      }
    });

    function arrayize(mixin) {
      Ember.NativeArray.apply(mixin.properties);
    }
  });
define("routes/container_type", 
  ["routes/tab","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var TabRoute = __dependency1__["default"];
    var get = Ember.get;
    var Promise = Ember.RSVP.Promise;

    __exports__["default"] = TabRoute.extend({
      setupController: function(controller) {
        controller.setProperties({
          search: '',
          searchVal: ''
        });
        this._super.apply(this, arguments);
      },
      model: function(params) {
        var type = params.type_id;
        var port = this.get('port');
        return new Promise(function(resolve) {
          port.one('container:instances', function(message) {
            resolve(message.instances);
          });
          port.send('container:getInstances', { containerType: type });
        });
      },

      actions: {
        inspectInstance: function(obj) {
          if (!get(obj, 'inspectable')) {
            return;
          }
          this.get('port').send('objectInspector:inspectByContainerLookup', { name: get(obj, 'fullName') });
        },
        sendInstanceToConsole: function(obj) {
          this.get('port').send('container:sendInstanceToConsole', { name: get(obj, 'fullName') });
        }
      }
    });
  });
define("routes/container_types", 
  ["exports"],
  function(__exports__) {
    "use strict";
    var Route = Ember.Route;
    var Promise = Ember.RSVP.Promise;

    __exports__["default"] = Route.extend({
      model: function() {
        var port = this.get('port');
        return new Promise(function(resolve) {
          port.one('container:types', function(message) {
            resolve(message.types);
          });
          port.send('container:getTypes');
        });
      },
      actions: {
        reload: function() {
          this.refresh();
        }
      }
    });
  });
define("routes/container_types/index", 
  ["routes/tab","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var TabRoute = __dependency1__["default"];
    __exports__["default"] = TabRoute;
  });
define("routes/data/index", 
  ["exports"],
  function(__exports__) {
    "use strict";
    var Promise = Ember.RSVP.Promise;

    __exports__["default"] = Ember.Route.extend({
      model: function() {
        var route = this;
        return new Promise(function(resolve) {
          route.get('port').one('data:hasAdapter', function(message) {
            resolve(message.hasAdapter);
          });
          route.get('port').send('data:checkAdapter');
        });
      },
      afterModel: function(model) {
        if (model) {
          this.transitionTo('model-types');
        }
      }
    });
  });
define("routes/info", 
  ["routes/tab","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var TabRoute = __dependency1__["default"];

    var Promise = Ember.RSVP.Promise;
    var oneWay = Ember.computed.oneWay;

    __exports__["default"] = TabRoute.extend({
      version: oneWay('config.VERSION').readOnly(),

      model: function() {
        var version = this.get('version');
        var port = this.get('port');
        return new Promise(function(resolve) {
          port.one('general:libraries', function(message) {
            message.libraries.insertAt(0, {
              name: 'Ember Inspector',
              version: version
            });
            resolve(message.libraries);
          });
          port.send('general:getLibraries');
        });
      }
    });
  });
define("routes/model_type", 
  ["exports"],
  function(__exports__) {
    "use strict";
    __exports__["default"] = Ember.Route.extend({
      setupController: function(controller, model) {
        this._super(controller, model);
        this.controllerFor('model-types').set('selected', model);
      },

      deactivate: function() {
        this.controllerFor('model-types').set('selected', null);
      },

      serialize: function (model) {
        return { type_id: Ember.get(model, 'name') };
      }
    });
  });
define("routes/model_types", 
  ["exports"],
  function(__exports__) {
    "use strict";
    var Promise = Ember.RSVP.Promise;

    __exports__["default"] = Ember.Route.extend({
      setupController: function(controller, model) {
        this._super(controller, model);
        this.get('port').on('data:modelTypesAdded', this, this.addModelTypes);
        this.get('port').on('data:modelTypesUpdated', this, this.updateModelTypes);
        this.get('port').send('data:getModelTypes');
      },

      model: function() {
        return [];
      },

      deactivate: function() {
        this.get('port').off('data:modelTypesAdded', this, this.addModelTypes);
        this.get('port').off('data:modelTypesUpdated', this, this.updateModelTypes);
        this.get('port').send('data:releaseModelTypes');
      },

      addModelTypes: function(message) {
        this.get('currentModel').pushObjects(message.modelTypes);
      },

      updateModelTypes: function(message) {
        var route = this;
        message.modelTypes.forEach(function(modelType) {
          var currentType = route.get('currentModel').findProperty('objectId', modelType.objectId);
          Ember.set(currentType, 'count', modelType.count);
        });
      }
    });
  });
define("routes/promise_tree", 
  ["routes/tab","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var TabRoute = __dependency1__["default"];

    var Promise = Ember.RSVP.Promise;

    __exports__["default"] = TabRoute.extend({
      model: function() {
        // block rendering until first batch arrives
        // Helps prevent flashing of "please refresh the page"
        var route = this;
        return new Promise(function(resolve) {
          route.get('assembler').one('firstMessageReceived', function() {
            resolve(route.get('assembler.topSort'));
          });
          route.get('assembler').start();
        });

      },

      deactivate: function() {
        this.get('assembler').stop();
      },

      actions: {
        sendValueToConsole: function(promise) {
          this.get('port').send('promise:sendValueToConsole', { promiseId: promise.get('guid') });
        },

        toggleExpand: function(promise) {
          var isExpanded = !promise.get('isExpanded');
          promise.set('isManuallyExpanded', isExpanded);
          promise.recalculateExpanded();
          var children = promise._allChildren();
          if (isExpanded) {
            children.forEach(function(child) {
              var isManuallyExpanded = child.get('isManuallyExpanded');
              if (isManuallyExpanded === undefined) {
                child.set('isManuallyExpanded', isExpanded);
                child.recalculateExpanded();
              }
            });
          }

        }
      }
    });
  });
define("routes/promises/index", 
  ["exports"],
  function(__exports__) {
    "use strict";
    var Promise = Ember.RSVP.Promise;

    __exports__["default"] = Ember.Route.extend({
      beforeModel: function() {
        var route = this;
        return new Promise(function(resolve) {
          route.get('port').one('promise:supported', this, function(message) {
            if (message.supported) {
              route.transitionTo('promise-tree');
            } else {
              resolve();
            }
          });
          route.get('port').send('promise:supported');
        });
      },

      renderTemplate: function() {
        this.render('promises.error');
      }
    });
  });
define("routes/records", 
  ["routes/tab","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var TabRoute = __dependency1__["default"];

    var Promise = Ember.RSVP.Promise, set = Ember.set;

    __exports__["default"] = TabRoute.extend({
      setupController: function(controller, model) {
        this._super(controller, model);

        var type = this.modelFor('model_type');

        controller.set('modelType', this.modelFor('model_type'));

        this.get('port').on('data:recordsAdded', this, this.addRecords);
        this.get('port').on('data:recordsUpdated', this, this.updateRecords);
        this.get('port').on('data:recordsRemoved', this, this.removeRecords);
        this.get('port').one('data:filters', this, function(message) {
          this.set('controller.filters', message.filters);
        });
        this.get('port').send('data:getFilters');
        this.get('port').send('data:getRecords', { objectId: type.objectId });
      },

      model: function() {
        return [];
      },

      deactivate: function() {
        this.get('port').off('data:recordsAdded', this, this.addRecords);
        this.get('port').off('data:recordsUpdated', this, this.updateRecords);
        this.get('port').off('data:recordsRemoved', this, this.removeRecords);
        this.get('port').send('data:releaseRecords');
      },

      updateRecords: function(message) {
        var route = this;
        message.records.forEach(function(record) {
          var currentRecord = route.get('currentModel').findProperty('objectId', record.objectId);
          if (currentRecord) {
            set(currentRecord, 'columnValues', record.columnValues);
            set(currentRecord, 'filterValues', record.filterValues);
            set(currentRecord, 'searchIndex', record.searchIndex);
            set(currentRecord, 'color', record.color);
          }
        });

      },

      addRecords: function(message) {
        this.get('currentModel').pushObjects(message.records);
      },

      removeRecords: function(message) {
        this.get('currentModel').removeAt(message.index, message.count);
      },

      actions: {
        inspectModel: function(model) {
          this.get('port').send('data:inspectModel', { objectId: Ember.get(model, 'objectId') });
        }
      }
    });
  });
define("routes/render_tree", 
  ["routes/tab","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var TabRoute = __dependency1__["default"];

    var Promise = Ember.RSVP.Promise;

    __exports__["default"] = TabRoute.extend({
      model: function() {
        var route = this, port = this.get('port');
        return new Promise(function(resolve) {
          port.one('render:profilesAdded', function(message) {
            resolve(message.profiles);
          });
          port.send('render:watchProfiles');
        });
      },

      setupController: function(controller, model) {
        this._super.apply(this, arguments);
        if (model.length === 0) {
          controller.set('initialEmpty', true);
        }
        var port = this.get('port');
        port.on('render:profilesUpdated', this, this.profilesUpdated);
        port.on('render:profilesAdded', this, this.profilesAdded);
      },

      deactivate: function() {
        var port = this.get('port');
        port.off('render:profilesUpdated', this, this.profilesUpdated);
        port.off('render:profilesAdded', this, this.profilesAdded);
        port.send('render:releaseProfiles');
      },

      profilesUpdated: function(message) {
        this.set('controller.model', message.profiles);
      },

      profilesAdded: function(message) {
        var model = this.get('controller.model');
        var profiles = message.profiles;

        model.pushObjects(profiles);
      },

      actions: {
        clearProfiles: function() {
          this.get('port').send('render:clear');
        }
      }

    });
  });
define("routes/route_tree", 
  ["routes/tab","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var TabRoute = __dependency1__["default"];

    __exports__["default"] = TabRoute.extend({
      setupController: function(controller, model) {
        this._super(controller, model);
        this.get('port').on('route:currentRoute', this, this.setCurrentRoute);
        this.get('port').send('route:getCurrentRoute');
        this.get('port').on('route:routeTree', this, this.setTree);
        this.get('port').send('route:getTree');
      },

      deactivate: function() {
        this.get('port').off('route:currentRoute');
        this.get('port').off('route:routeTree', this, this.setTree);
      },

      setCurrentRoute: function(message) {
        this.get('controller').set('currentRoute', message.name);
      },

      setTree: function(options) {
        var routeArray = topSort(options.tree);
        this.set('controller.model', routeArray);
      },

      actions: {
        inspectRoute: function(name) {
          this.get('port').send('objectInspector:inspectRoute', { name: name } );
        },

        inspectController: function(controller) {
          if (!controller.exists) {
            return;
          }
          this.get('port').send('objectInspector:inspectController', { name: controller.name } );
        },

        sendControllerToConsole: function(controllerName) {
          this.get('port').send('objectInspector:sendControllerToConsole', { name: controllerName });
        },

        sendRouteHandlerToConsole: function(routeName) {
          this.get('port').send('objectInspector:sendRouteHandlerToConsole', { name: routeName });
        }
      }
    });


    function topSort(tree, list) {
      list = list || [];
      var view = $.extend({}, tree);
      view.parentCount = view.parentCount || 0;
      delete view.children;
      list.push(view);
      tree.children = tree.children || [];
      tree.children.forEach(function(child) {
        child.parentCount = view.parentCount + 1;
        topSort(child, list);
      });
      return list;
    }
  });
define("routes/tab", 
  ["exports"],
  function(__exports__) {
    "use strict";
    __exports__["default"] = Ember.Route.extend({
      renderTemplate: function () {
        this.render();
        try {
          this.render(this.get('routeName').replace(/\./g, '/') + '_toolbar', {
            into: 'application',
            outlet: 'toolbar'
          });
        } catch (e) {}
      }
    });
  });
define("routes/view_tree", 
  ["routes/tab","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var TabRoute = __dependency1__["default"];

    __exports__["default"] = TabRoute.extend({
      setupController: function() {
        this.get('port').on('view:viewTree', this, this.setViewTree);
        this.get('port').on('view:stopInspecting', this, this.stopInspecting);
        this.get('port').on('view:startInspecting', this, this.startInspecting);
        this.get('port').on('view:pinView', this, this.pinView);
        this.get('port').on('view:unpinView', this, this.unpinView);
        this.get('port').send('view:getTree');
      },

      deactivate: function() {
        this.get('port').off('view:viewTree', this, this.setViewTree);
        this.get('port').off('view:stopInspecting', this, this.stopInspecting);
        this.get('port').off('view:startInspecting', this, this.startInspecting);
        this.get('port').off('view:pinView', this, this.pinView);
        this.get('port').off('view:unpinView', this, this.unpinView);
      },

      setViewTree: function(options) {
        var viewArray = topSort(options.tree);
        this.set('controller.model', viewArray);
      },

      startInspecting: function() {
        this.set('controller.inspectingViews', true);
      },

      stopInspecting: function() {
        this.set('controller.inspectingViews', false);
      },

      pinView: function(message) {
        this.set('controller.pinnedObjectId', message.objectId);
      },

      unpinView: function() {
        this.set('controller.pinnedObjectId', null);
      },

      actions: {
        inspect: function(objectId) {
          if (objectId) {
            this.get('port').send('objectInspector:inspectById', { objectId: objectId });
          }
        },
        inspectElement: function(objectId) {
          this.get('port').send('view:inspectElement', { objectId: objectId });
        }
      }

    });

    function topSort(tree, list) {
      list = list || [];
      var view = $.extend({}, tree);
      view.parentCount = view.parentCount || 0;
      delete view.children;
      list.push(view);
      tree.children.forEach(function(child) {
        child.parentCount = view.parentCount + 1;
        topSort(child, list);
      });
      return list;
    }

    function arrayizeTree(tree) {
      Ember.NativeArray.apply(tree.children);
      tree.children.forEach(arrayizeTree);
      return tree;
    }
  });
define('templates/application', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  var buffer = '', stack1, helperMissing=helpers.helperMissing, escapeExpression=this.escapeExpression, self=this;

function program1(depth0,data) {
  
  var buffer = '', stack1, helper, options;
  data.buffer.push("\n  <div class=\"split\">\n    <div class=\"split__panel\">\n      ");
  data.buffer.push(escapeExpression((helper = helpers.partial || (depth0 && depth0.partial),options={hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["STRING"],data:data},helper ? helper.call(depth0, "main", options) : helperMissing.call(depth0, "partial", "main", options))));
  data.buffer.push("\n    </div>\n\n    ");
  stack1 = helpers['if'].call(depth0, "inspectorExpanded", {hash:{},hashTypes:{},hashContexts:{},inverse:self.noop,fn:self.program(2, program2, data),contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n  </div>\n\n");
  return buffer;
  }
function program2(depth0,data) {
  
  var buffer = '', stack1, helper, options;
  data.buffer.push("\n      ");
  stack1 = (helper = helpers['draggable-column'] || (depth0 && depth0['draggable-column']),options={hash:{
    'side': ("right"),
    'width': ("inspectorWidth"),
    'classNames': ("split__panel")
  },hashTypes:{'side': "STRING",'width': "ID",'classNames': "STRING"},hashContexts:{'side': depth0,'width': depth0,'classNames': depth0},inverse:self.noop,fn:self.program(3, program3, data),contexts:[],types:[],data:data},helper ? helper.call(depth0, options) : helperMissing.call(depth0, "draggable-column", options));
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n    ");
  return buffer;
  }
function program3(depth0,data) {
  
  var buffer = '', helper, options;
  data.buffer.push("\n        ");
  data.buffer.push(escapeExpression((helper = helpers.render || (depth0 && depth0.render),options={hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["STRING"],data:data},helper ? helper.call(depth0, "mixinStack", options) : helperMissing.call(depth0, "render", "mixinStack", options))));
  data.buffer.push("\n      ");
  return buffer;
  }

function program5(depth0,data) {
  
  var buffer = '', stack1, helper, options;
  data.buffer.push("\n  ");
  stack1 = (helper = helpers['not-detected'] || (depth0 && depth0['not-detected']),options={hash:{
    'description': ("Ember application")
  },hashTypes:{'description': "STRING"},hashContexts:{'description': depth0},inverse:self.noop,fn:self.program(6, program6, data),contexts:[],types:[],data:data},helper ? helper.call(depth0, options) : helperMissing.call(depth0, "not-detected", options));
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n");
  return buffer;
  }
function program6(depth0,data) {
  
  var buffer = '', stack1;
  data.buffer.push("\n  <li>This is not an Ember application.</li>\n  <li>You are using an old version of Ember (&lt; rc5).</li>\n  ");
  stack1 = helpers['if'].call(depth0, "isChrome", {hash:{},hashTypes:{},hashContexts:{},inverse:self.noop,fn:self.program(7, program7, data),contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n  ");
  return buffer;
  }
function program7(depth0,data) {
  
  
  data.buffer.push("\n    <li>You are using the file:// protocol (instead of http://), in which case:\n      <ul>\n        <li>Visit the URL: chrome://extensions.</li>\n        <li>Find the Ember Inspector.</li>\n        <li>Make sure \"Allow access to file URLs\" is checked.</li>\n      </ul>\n    </li>\n  ");
  }

  stack1 = helpers['if'].call(depth0, "emberApplication", {hash:{},hashTypes:{},hashContexts:{},inverse:self.program(5, program5, data),fn:self.program(1, program1, data),contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n");
  return buffer;
  
}); });

define('templates/components/clear-button', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  


  data.buffer.push("<svg width=\"16px\" height=\"16px\" viewBox=\"0 0 16 16\" version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\">\n  <g class=\"svg-stroke\" transform=\"translate(3.000000, 3.7500000)\" stroke=\"#000000\" stroke-width=\"2\" fill=\"none\" fill-rule=\"evenodd\">\n    <circle cx=\"5.5\" cy=\"5.5\" r=\"5.5\"></circle>\n    <path d=\"M1.98253524,1.98253524 L9,9\" id=\"Line\" stroke-linecap=\"square\"></path>\n  </g>\n</svg>\n");
  
}); });

define('templates/components/drag-handle', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  


  data.buffer.push("<div class=\"drag-handle__border\"></div>\n");
  
}); });

define('templates/components/draggable-column', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  var buffer = '', stack1, helper, options, self=this, helperMissing=helpers.helperMissing, escapeExpression=this.escapeExpression;

function program1(depth0,data) {
  
  var buffer = '', stack1;
  data.buffer.push("\n  ");
  stack1 = helpers._triageMustache.call(depth0, "yield", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n");
  return buffer;
  }

  stack1 = (helper = helpers['resizable-column'] || (depth0 && depth0['resizable-column']),options={hash:{
    'width': ("width"),
    'classNames': ("classNames")
  },hashTypes:{'width': "ID",'classNames': "ID"},hashContexts:{'width': depth0,'classNames': depth0},inverse:self.noop,fn:self.program(1, program1, data),contexts:[],types:[],data:data},helper ? helper.call(depth0, options) : helperMissing.call(depth0, "resizable-column", options));
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n\n");
  data.buffer.push(escapeExpression((helper = helpers['drag-handle'] || (depth0 && depth0['drag-handle']),options={hash:{
    'side': ("side"),
    'position': ("width"),
    'minWidth': ("minWidth"),
    'action': ("setIsDragging")
  },hashTypes:{'side': "ID",'position': "ID",'minWidth': "ID",'action': "STRING"},hashContexts:{'side': depth0,'position': depth0,'minWidth': depth0,'action': depth0},contexts:[],types:[],data:data},helper ? helper.call(depth0, options) : helperMissing.call(depth0, "drag-handle", options))));
  data.buffer.push("\n");
  return buffer;
  
}); });

define('templates/components/expandable-render', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  var buffer = '', stack1, escapeExpression=this.escapeExpression, self=this;

function program1(depth0,data) {
  
  var buffer = '', stack1;
  data.buffer.push("\n<a href='#' ");
  data.buffer.push(escapeExpression(helpers.action.call(depth0, "expand", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["STRING"],data:data})));
  data.buffer.push(" class='title'>\n  <span class='expander'>");
  stack1 = helpers['if'].call(depth0, "expanded", {hash:{},hashTypes:{},hashContexts:{},inverse:self.program(4, program4, data),fn:self.program(2, program2, data),contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("</span>\n  ");
  data.buffer.push(escapeExpression(helpers.unbound.call(depth0, "node.name", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data})));
  data.buffer.push(" <span class='duration'>");
  data.buffer.push(escapeExpression(helpers.unbound.call(depth0, "node.duration", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data})));
  data.buffer.push("</span></a>\n");
  return buffer;
  }
function program2(depth0,data) {
  
  
  data.buffer.push("-");
  }

function program4(depth0,data) {
  
  
  data.buffer.push("+");
  }

function program6(depth0,data) {
  
  var buffer = '';
  data.buffer.push("\n  <div class='title'>");
  data.buffer.push(escapeExpression(helpers.unbound.call(depth0, "node.name", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data})));
  data.buffer.push(" <span class='duration'>");
  data.buffer.push(escapeExpression(helpers.unbound.call(depth0, "node.duration", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data})));
  data.buffer.push("</span></div>\n");
  return buffer;
  }

  stack1 = helpers['if'].call(depth0, "node.children", {hash:{},hashTypes:{},hashContexts:{},inverse:self.program(6, program6, data),fn:self.program(1, program1, data),contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n");
  return buffer;
  
}); });

define('templates/components/not-detected', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  var buffer = '', stack1, self=this;

function program1(depth0,data) {
  
  var buffer = '', stack1;
  data.buffer.push("\n          ");
  stack1 = helpers._triageMustache.call(depth0, "reasonsTitle", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n        ");
  return buffer;
  }

function program3(depth0,data) {
  
  
  data.buffer.push("\n          Here are some common reasons this happens:\n        ");
  }

  data.buffer.push("<div class=\"error-page\" data-label=\"error-page\">\n\n  <div class=\"error-page__content\">\n\n    <div class=\"error-page__header\">\n      <div class=\"error-page__title\" data-label=\"error-page-title\">");
  stack1 = helpers._triageMustache.call(depth0, "description", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push(" not detected!</div>\n    </div>\n\n    <div class=\"error-page__reasons\">\n\n      <div class=\"error-page__reasons-title\">\n        ");
  stack1 = helpers['if'].call(depth0, "reasonsTitle", {hash:{},hashTypes:{},hashContexts:{},inverse:self.program(3, program3, data),fn:self.program(1, program1, data),contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n      </div>\n\n      <ul class=\"error-page__list\">\n        ");
  stack1 = helpers._triageMustache.call(depth0, "yield", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n      </ul>\n\n      If you're still having trouble, please file an issue on the Ember Inspector's\n      <a href=\"https://github.com/tildeio/ember-extension\" target=\"_blank\">GitHub page.</a>\n    </div>\n\n  </div>\n\n</div>\n");
  return buffer;
  
}); });

define('templates/components/property-field', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  var buffer = '';


  return buffer;
  
}); });

define('templates/components/reload-button', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  


  data.buffer.push("<svg version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" x=\"0px\" y=\"0px\"\r\n   width=\"14px\" height=\"14px\" viewBox=\"0 0 54.203 55.142\" enable-background=\"new 0 0 54.203 55.142\" xml:space=\"preserve\">\r\n<path fill=\"#797979\" d=\"M54.203,21.472l-0.101-1.042h0.101c-0.042-0.159-0.101-0.311-0.146-0.468l-1.82-18.786l-6.056,6.055\r\n  C41.277,2.741,34.745,0,27.571,0C12.344,0,0,12.344,0,27.571s12.344,27.571,27.571,27.571c12.757,0,23.485-8.666,26.632-20.431\r\n  h-8.512c-2.851,7.228-9.881,12.349-18.12,12.349c-10.764,0-19.49-8.726-19.49-19.489s8.727-19.489,19.49-19.489\r\n  c4.942,0,9.441,1.853,12.873,4.887l-6.536,6.536L54.203,21.472z\"/>\r\n</svg>\r\n");
  
}); });

define('templates/components/send-to-console', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  


  data.buffer.push("<img src=\"../images/send.png\" title=\"Send to console\">\n");
  
}); });

define('templates/components/sidebar-toggle', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  var stack1, self=this;

function program1(depth0,data) {
  
  var buffer = '', stack1;
  data.buffer.push("\n  ");
  stack1 = helpers['if'].call(depth0, "isExpanded", {hash:{},hashTypes:{},hashContexts:{},inverse:self.program(4, program4, data),fn:self.program(2, program2, data),contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n");
  return buffer;
  }
function program2(depth0,data) {
  
  
  data.buffer.push("\n    <svg width=\"16px\" height=\"14px\" viewBox=\"0 0 16 14\" version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\">\n      <title>Collapse Right Sidebar</title>\n      <g id=\"expand-sidebar-left\" stroke=\"none\" fill=\"none\" transform=\"translate(0,1)\">\n        <rect class=\"svg-stroke\" stroke=\"#000000\" x=\"0.5\" y=\"0.5\" width=\"14\" height=\"12\"></rect>\n        <path class=\"svg-stroke\" shape-rendering=\"crispEdges\" d=\"M10.75,0 L10.75,12\" stroke=\"#000000\"></path>\n        <path class=\"svg-fill\" d=\"M6.25,4 L9.25,9.5 L3.25,9.5 L6.25,4 Z\" fill=\"#000\" transform=\"translate(6.250000, 6.500000) scale(-1, 1) rotate(-90.000000) translate(-6.250000, -6.500000) \"></path>\n      </g>\n    </svg>\n  ");
  }

function program4(depth0,data) {
  
  
  data.buffer.push("\n    <svg width=\"16px\" height=\"14px\" viewBox=\"0 0 16 14\" version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\">\n      <title>Expand Right Sidebar</title>\n      <g id=\"expand-sidebar-left\" stroke=\"none\" fill=\"none\" transform=\"translate(0,1)\">\n        <rect class=\"svg-stroke\" stroke=\"#000000\" x=\"0.5\" y=\"0.5\" width=\"14\" height=\"12\"></rect>\n        <path class=\"svg-stroke\" shape-rendering=\"crispEdges\" d=\"M10.75,0 L10.75,12\" stroke=\"#000000\"></path>\n        <path class=\"svg-fill\" d=\"M5.25,4 L8.25,9.25 L2.25,9.25 L5.25,4 L5.25,4 Z\" fill=\"#000000\" transform=\"translate(5.250000, 6.500000) rotate(-90.000000) translate(-5.250000, -6.500000)\"></path>\n      </g>\n    </svg>\n  ");
  }

function program6(depth0,data) {
  
  var buffer = '', stack1;
  data.buffer.push("\n  ");
  stack1 = helpers['if'].call(depth0, "isExpanded", {hash:{},hashTypes:{},hashContexts:{},inverse:self.program(9, program9, data),fn:self.program(7, program7, data),contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n");
  return buffer;
  }
function program7(depth0,data) {
  
  
  data.buffer.push("\n    <svg width=\"16px\" height=\"14px\" viewBox=\"0 0 16 14\" version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\">\n      <title>Collapse Left Sidebar</title>\n      <g id=\"expand-sidebar-left\" stroke=\"none\" fill=\"none\" transform=\"translate(8.000000, 8.000000) scale(-1, 1) translate(-8.000000, -7.000000)\">\n        <rect class=\"svg-stroke\" stroke=\"#000000\" x=\"0.5\" y=\"0.5\" width=\"14\" height=\"12\"></rect>\n        <path class=\"svg-stroke\" shape-rendering=\"crispEdges\" d=\"M10.5,0 L10.5,12\" stroke=\"#000000\"></path>\n        <path class=\"svg-fill\" d=\"M6.25,4 L9.25,9.5 L3.25,9.5 L6.25,4 Z\" fill=\"#000\" transform=\"translate(6.250000, 6.500000) scale(-1, 1) rotate(-90.000000) translate(-6.250000, -6.500000) \"></path>\n      </g>\n    </svg>\n  ");
  }

function program9(depth0,data) {
  
  
  data.buffer.push("\n    <svg width=\"16px\" height=\"14px\" viewBox=\"0 0 16 14\" version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\">\n      <title>Expand Left Sidebar</title>\n      <g id=\"expand-sidebar-left\" stroke=\"none\" fill=\"none\" transform=\"translate(8.000000, 8.000000) scale(-1, 1) translate(-8.000000, -7.000000)\">\n        <rect class=\"svg-stroke\" stroke=\"#000000\" x=\"0.5\" y=\"0.5\" width=\"14\" height=\"12\"></rect>\n        <path class=\"svg-stroke\" shape-rendering=\"crispEdges\" d=\"M10.5,0 L10.5,12\" stroke=\"#000000\"></path>\n        <path class=\"svg-fill\" d=\"M5.25,4 L8.25,9.25 L2.25,9.25 L5.25,4 L5.25,4 Z\" fill=\"#000000\" transform=\"translate(5.250000, 6.500000) rotate(-90.000000) translate(-5.250000, -6.500000)\"></path>\n      </g>\n    </svg>\n  ");
  }

  stack1 = helpers['if'].call(depth0, "isRight", {hash:{},hashTypes:{},hashContexts:{},inverse:self.program(6, program6, data),fn:self.program(1, program1, data),contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  else { data.buffer.push(''); }
  
}); });

define('templates/container_type', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  var buffer = '', escapeExpression=this.escapeExpression;


  data.buffer.push("<div class=\"list-view\">\n  <div class=\"list-view__header row\">\n    <div class=\"cell cell_type_header\" data-label=\"column-title\">Name</div>\n\n    <!-- Account for scrollbar width :'(  -->\n    <div class=\"cell cell_type_header spacer\"></div>\n  </div>\n\n  <div class=\"list-view__list-container\">\n    ");
  data.buffer.push(escapeExpression(helpers.view.call(depth0, "instanceList", {hash:{
    'content': ("")
  },hashTypes:{'content': "ID"},hashContexts:{'content': depth0},contexts:[depth0],types:["STRING"],data:data})));
  data.buffer.push("\n  </div>\n</div>\n");
  return buffer;
  
}); });

define('templates/container_type_toolbar', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  var buffer = '', helper, options, helperMissing=helpers.helperMissing, escapeExpression=this.escapeExpression;


  data.buffer.push("<div class=\"toolbar\">\n  ");
  data.buffer.push(escapeExpression((helper = helpers['reload-button'] || (depth0 && depth0['reload-button']),options={hash:{
    'action': ("reload"),
    'classNames': ("toolbar__icon-button"),
    'dataLabel': ("reload-container-btn")
  },hashTypes:{'action': "STRING",'classNames': "STRING",'dataLabel': "STRING"},hashContexts:{'action': depth0,'classNames': depth0,'dataLabel': depth0},contexts:[],types:[],data:data},helper ? helper.call(depth0, options) : helperMissing.call(depth0, "reload-button", options))));
  data.buffer.push("\n\n  <div class=\"toolbar__search toolbar__search--small\" data-label=\"container-instance-search\">\n    ");
  data.buffer.push(escapeExpression((helper = helpers.input || (depth0 && depth0.input),options={hash:{
    'value': ("searchVal"),
    'placeholder': ("Search")
  },hashTypes:{'value': "ID",'placeholder': "STRING"},hashContexts:{'value': depth0,'placeholder': depth0},contexts:[],types:[],data:data},helper ? helper.call(depth0, options) : helperMissing.call(depth0, "input", options))));
  data.buffer.push("\n  </div>\n</div>\n");
  return buffer;
  
}); });

define('templates/container_types', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  var buffer = '', stack1, helper, options, self=this, helperMissing=helpers.helperMissing;

function program1(depth0,data) {
  
  var buffer = '', stack1;
  data.buffer.push("\n\n    <div class=\"split__panel__bd\">\n      <div class=\"nav__title\">\n        <h3>Types</h3>\n      </div>\n\n      <ul>\n        ");
  stack1 = helpers.each.call(depth0, {hash:{},hashTypes:{},hashContexts:{},inverse:self.noop,fn:self.program(2, program2, data),contexts:[],types:[],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n      </ul>\n    </div>\n  ");
  return buffer;
  }
function program2(depth0,data) {
  
  var buffer = '', stack1, helper, options;
  data.buffer.push("\n          <li data-label=\"container-type\">\n            ");
  stack1 = (helper = helpers['link-to'] || (depth0 && depth0['link-to']),options={hash:{},hashTypes:{},hashContexts:{},inverse:self.noop,fn:self.program(3, program3, data),contexts:[depth0,depth0],types:["STRING","ID"],data:data},helper ? helper.call(depth0, "container-type", "name", options) : helperMissing.call(depth0, "link-to", "container-type", "name", options));
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n          </li>\n        ");
  return buffer;
  }
function program3(depth0,data) {
  
  var buffer = '', stack1;
  data.buffer.push("\n              <span data-label=\"container-type-name\">");
  stack1 = helpers._triageMustache.call(depth0, "name", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("</span>\n              (<span data-label=\"container-type-count\">");
  stack1 = helpers._triageMustache.call(depth0, "count", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("</span>)\n            ");
  return buffer;
  }

  data.buffer.push("<div class=\"split\">\n  ");
  stack1 = (helper = helpers['draggable-column'] || (depth0 && depth0['draggable-column']),options={hash:{
    'width': (180),
    'classNames': ("split__panel split__panel--sidebar-2 nav")
  },hashTypes:{'width': "INTEGER",'classNames': "STRING"},hashContexts:{'width': depth0,'classNames': depth0},inverse:self.noop,fn:self.program(1, program1, data),contexts:[],types:[],data:data},helper ? helper.call(depth0, options) : helperMissing.call(depth0, "draggable-column", options));
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n\n  <div class=\"split__panel\">\n    <div class=\"split__panel__bd\">\n      ");
  stack1 = helpers._triageMustache.call(depth0, "outlet", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n    </div>\n  </div>\n</div>\n");
  return buffer;
  
}); });

define('templates/container_types/index_toolbar', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  var buffer = '', helper, options, helperMissing=helpers.helperMissing, escapeExpression=this.escapeExpression;


  data.buffer.push("<div class=\"toolbar\">\n  ");
  data.buffer.push(escapeExpression((helper = helpers['reload-button'] || (depth0 && depth0['reload-button']),options={hash:{
    'action': ("reload"),
    'classNames': ("toolbar__icon-button"),
    'dataLabel': ("reload-container-btn")
  },hashTypes:{'action': "STRING",'classNames': "STRING",'dataLabel': "STRING"},hashContexts:{'action': depth0,'classNames': depth0,'dataLabel': depth0},contexts:[],types:[],data:data},helper ? helper.call(depth0, options) : helperMissing.call(depth0, "reload-button", options))));
  data.buffer.push("\n</div>\n");
  return buffer;
  
}); });

define('templates/data', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  var buffer = '', stack1;


  stack1 = helpers._triageMustache.call(depth0, "outlet", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n");
  return buffer;
  
}); });

define('templates/data/index', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  var buffer = '', stack1, helper, options, self=this, helperMissing=helpers.helperMissing;

function program1(depth0,data) {
  
  
  data.buffer.push("\n  <li>You are using an old version of Ember (&lt; rc7).</li>\n  <li>You are using an old version of Ember Data (&lt; 0.14).</li>\n  <li>You are using another persistence library, in which case:\n    <ul>\n      <li>Make sure the library has a data adapter.</li>\n    </ul>\n  </li>\n  ");
  }

  data.buffer.push("<div class=\"data-error-page-container\">\n  ");
  stack1 = (helper = helpers['not-detected'] || (depth0 && depth0['not-detected']),options={hash:{
    'description': ("Data adapter")
  },hashTypes:{'description': "STRING"},hashContexts:{'description': depth0},inverse:self.noop,fn:self.program(1, program1, data),contexts:[],types:[],data:data},helper ? helper.call(depth0, options) : helperMissing.call(depth0, "not-detected", options));
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n</div>\n");
  return buffer;
  
}); });

define('templates/iframes', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  var buffer = '', escapeExpression=this.escapeExpression;


  data.buffer.push("<div class=\"dropdown\">\n  ");
  data.buffer.push(escapeExpression(helpers.view.call(depth0, "Ember.Select", {hash:{
    'content': ("model"),
    'value': ("selectedApp"),
    'optionValuePath': ("content.val"),
    'optionLabelPath': ("content.name"),
    'class': ("dropdown__select")
  },hashTypes:{'content': "ID",'value': "ID",'optionValuePath': "STRING",'optionLabelPath': "STRING",'class': "STRING"},hashContexts:{'content': depth0,'value': depth0,'optionValuePath': depth0,'optionLabelPath': depth0,'class': depth0},contexts:[depth0],types:["ID"],data:data})));
  data.buffer.push("\n  <div class=\"dropdown__arrow\"></div>\n</div>\n");
  return buffer;
  
}); });

define('templates/info', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  var buffer = '', stack1, escapeExpression=this.escapeExpression, self=this;

function program1(depth0,data) {
  
  var buffer = '';
  data.buffer.push("\n        <div data-label=\"library-row\" class=\"list-tree__item-wrapper row-wrapper\">\n          <div class=\"list-tree__item row\">\n            <div class=\"cell_type_main cell cell_size_large\">\n                <span data-label=\"lib-name\">");
  data.buffer.push(escapeExpression(helpers.unbound.call(depth0, "name", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data})));
  data.buffer.push("</span>\n            </div>\n            <div class=\"cell\">\n                <span data-label=\"lib-version\">");
  data.buffer.push(escapeExpression(helpers.unbound.call(depth0, "version", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data})));
  data.buffer.push("</span>\n            </div>\n          </div>\n        </div>\n      ");
  return buffer;
  }

  data.buffer.push("<div class=\"list-view\">\n  <div class=\"list-view__header row\">\n    <div class=\"cell cell_type_header cell_size_large\">\n      Library\n    </div>\n    <div class=\"cell cell_type_header\">\n      Version\n    </div>\n    <!-- Account for scrollbar width :'(  -->\n    <div class=\"cell cell_type_header spacer\"></div>\n  </div>\n\n  <div class=\"list-view__list-container\">\n    <div class=\"list-tree\">\n      <div class=\"ember-list-container\">\n      ");
  stack1 = helpers.each.call(depth0, {hash:{},hashTypes:{},hashContexts:{},inverse:self.noop,fn:self.program(1, program1, data),contexts:[],types:[],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n    </div>\n  </div>\n\n</div>\n");
  return buffer;
  
}); });

define('templates/instance_item', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  var buffer = '', stack1, escapeExpression=this.escapeExpression;


  data.buffer.push("<div class=\"list-tree__item row\" data-label=\"instance-row\" ");
  data.buffer.push(escapeExpression(helpers.action.call(depth0, "inspectInstance", "", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0,depth0],types:["STRING","ID"],data:data})));
  data.buffer.push(">\n  <div ");
  data.buffer.push(escapeExpression(helpers['bind-attr'].call(depth0, {hash:{
    'class': (":cell inspectable:cell_clickable")
  },hashTypes:{'class': "STRING"},hashContexts:{'class': depth0},contexts:[],types:[],data:data})));
  data.buffer.push(" >\n    ");
  stack1 = helpers._triageMustache.call(depth0, "name", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n  </div>\n</div>\n");
  return buffer;
  
}); });

define('templates/main', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  var buffer = '', stack1, helper, options, helperMissing=helpers.helperMissing, escapeExpression=this.escapeExpression, self=this;

function program1(depth0,data) {
  
  var buffer = '', helper, options;
  data.buffer.push("\n    <div class=\"split__panel__hd\">\n      ");
  data.buffer.push(escapeExpression((helper = helpers.render || (depth0 && depth0.render),options={hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["STRING"],data:data},helper ? helper.call(depth0, "iframes", options) : helperMissing.call(depth0, "render", "iframes", options))));
  data.buffer.push("\n    </div>\n    <div class=\"split__panel__bd\">\n      ");
  data.buffer.push(escapeExpression((helper = helpers.partial || (depth0 && depth0.partial),options={hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["STRING"],data:data},helper ? helper.call(depth0, "nav", options) : helperMissing.call(depth0, "partial", "nav", options))));
  data.buffer.push("\n    </div>\n    <div class=\"split__panel__ft\">\n      <a target=\"_blank\" href=\"https://github.com/emberjs/ember-inspector/issues\">\n        Submit an Issue\n      </a>\n    </div>\n  ");
  return buffer;
  }

function program3(depth0,data) {
  
  var buffer = '', stack1;
  data.buffer.push("\n      ");
  stack1 = helpers._triageMustache.call(depth0, "outlet", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n    ");
  return buffer;
  }

  data.buffer.push("<div class=\"split split--main\">\n  ");
  stack1 = (helper = helpers['draggable-column'] || (depth0 && depth0['draggable-column']),options={hash:{
    'width': ("navWidth"),
    'classNames': ("split__panel split__panel--sidebar-1")
  },hashTypes:{'width': "ID",'classNames': "STRING"},hashContexts:{'width': depth0,'classNames': depth0},inverse:self.noop,fn:self.program(1, program1, data),contexts:[],types:[],data:data},helper ? helper.call(depth0, options) : helperMissing.call(depth0, "draggable-column", options));
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n\n  <div class=\"split__panel\">\n    <div class=\"split__panel__hd\">\n      ");
  data.buffer.push(escapeExpression((helper = helpers.outlet || (depth0 && depth0.outlet),options={hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["STRING"],data:data},helper ? helper.call(depth0, "toolbar", options) : helperMissing.call(depth0, "outlet", "toolbar", options))));
  data.buffer.push("\n      ");
  data.buffer.push(escapeExpression((helper = helpers['sidebar-toggle'] || (depth0 && depth0['sidebar-toggle']),options={hash:{
    'action': ("toggleInspector"),
    'side': ("right"),
    'isExpanded': ("inspectorExpanded"),
    'classNames': ("toolbar__icon-button")
  },hashTypes:{'action': "STRING",'side': "STRING",'isExpanded': "ID",'classNames': "STRING"},hashContexts:{'action': depth0,'side': depth0,'isExpanded': depth0,'classNames': depth0},contexts:[],types:[],data:data},helper ? helper.call(depth0, options) : helperMissing.call(depth0, "sidebar-toggle", options))));
  data.buffer.push("\n    </div>\n\n    ");
  stack1 = helpers.view.call(depth0, "mainContent", {hash:{
    'classNames': ("split__panel__bd")
  },hashTypes:{'classNames': "STRING"},hashContexts:{'classNames': depth0},inverse:self.noop,fn:self.program(3, program3, data),contexts:[depth0],types:["STRING"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n  </div>\n</div>\n");
  return buffer;
  
}); });

define('templates/mixin_details', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  var buffer = '', stack1, escapeExpression=this.escapeExpression, helperMissing=helpers.helperMissing, self=this;

function program1(depth0,data) {
  
  var buffer = '', stack1;
  data.buffer.push("\n<div ");
  data.buffer.push(escapeExpression(helpers['bind-attr'].call(depth0, {hash:{
    'class': (":mixin mixin.type mixin.isExpanded:mixin_state_expanded mixin.properties.length:mixin_props_yes:mixin_props_no")
  },hashTypes:{'class': "STRING"},hashContexts:{'class': depth0},contexts:[],types:[],data:data})));
  data.buffer.push(" data-label=\"object-detail\" >\n  ");
  stack1 = helpers['if'].call(depth0, "mixin.properties.length", {hash:{},hashTypes:{},hashContexts:{},inverse:self.program(4, program4, data),fn:self.program(2, program2, data),contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n  ");
  stack1 = helpers['if'].call(depth0, "mixin.isExpanded", {hash:{},hashTypes:{},hashContexts:{},inverse:self.noop,fn:self.program(6, program6, data),contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n</div>\n");
  return buffer;
  }
function program2(depth0,data) {
  
  var buffer = '', stack1;
  data.buffer.push("\n    <h2 class=\"mixin__name\" ");
  data.buffer.push(escapeExpression(helpers.action.call(depth0, "toggleExpanded", {hash:{
    'target': ("mixin")
  },hashTypes:{'target': "STRING"},hashContexts:{'target': depth0},contexts:[depth0],types:["STRING"],data:data})));
  data.buffer.push(" data-label=\"object-detail-name\">");
  stack1 = helpers._triageMustache.call(depth0, "mixin.name", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("</h2>\n  ");
  return buffer;
  }

function program4(depth0,data) {
  
  var buffer = '', stack1;
  data.buffer.push("\n    <h2 class=\"mixin__name\" data-label=\"object-detail-name\">");
  stack1 = helpers._triageMustache.call(depth0, "mixin.name", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("</h2>\n  ");
  return buffer;
  }

function program6(depth0,data) {
  
  var buffer = '', stack1;
  data.buffer.push("\n  <ul class=\"mixin__properties\">\n    ");
  stack1 = helpers.each.call(depth0, "mixin.properties", {hash:{
    'itemController': ("mixinProperty")
  },hashTypes:{'itemController': "STRING"},hashContexts:{'itemController': depth0},inverse:self.program(16, program16, data),fn:self.program(7, program7, data),contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n  </ul>\n  ");
  return buffer;
  }
function program7(depth0,data) {
  
  var buffer = '', stack1;
  data.buffer.push("\n    <li ");
  data.buffer.push(escapeExpression(helpers['bind-attr'].call(depth0, {hash:{
    'class': ("overridden:mixin__property_state_overridden :mixin__property")
  },hashTypes:{'class': "STRING"},hashContexts:{'class': depth0},contexts:[],types:[],data:data})));
  data.buffer.push(" data-label=\"object-property\">\n      ");
  stack1 = helpers['if'].call(depth0, "value.computed", {hash:{},hashTypes:{},hashContexts:{},inverse:self.program(10, program10, data),fn:self.program(8, program8, data),contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n      <span class='mixin__property-name' data-label=\"object-property-name\">");
  stack1 = helpers._triageMustache.call(depth0, "name", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("</span><span class='mixin__property-value-separator'>: </span>\n      ");
  stack1 = helpers.unless.call(depth0, "isEdit", {hash:{},hashTypes:{},hashContexts:{},inverse:self.program(14, program14, data),fn:self.program(12, program12, data),contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n      <span class='mixin__property-overridden-by'>(Overridden by ");
  stack1 = helpers._triageMustache.call(depth0, "overridden", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push(")</span>\n      <button class=\"mixin__send-btn\" ");
  data.buffer.push(escapeExpression(helpers.action.call(depth0, "sendToConsole", "model", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0,depth0],types:["STRING","ID"],data:data})));
  data.buffer.push(" data-label=\"send-to-console-btn\"><img src=\"../images/send.png\" title=\"Send to console\"></button>\n    </li>\n    ");
  return buffer;
  }
function program8(depth0,data) {
  
  var buffer = '';
  data.buffer.push("\n        <button ");
  data.buffer.push(escapeExpression(helpers['bind-attr'].call(depth0, {hash:{
    'class': (":mixin__calc-btn isCalculated:mixin__calc-btn_calculated")
  },hashTypes:{'class': "STRING"},hashContexts:{'class': depth0},contexts:[],types:[],data:data})));
  data.buffer.push(" ");
  data.buffer.push(escapeExpression(helpers.action.call(depth0, "calculate", "model", {hash:{
    'bubbles': (false)
  },hashTypes:{'bubbles': "BOOLEAN"},hashContexts:{'bubbles': depth0},contexts:[depth0,depth0],types:["STRING","ID"],data:data})));
  data.buffer.push(" data-label=\"calculate\"><img src=\"../images/calculate.svg\"></button>\n      ");
  return buffer;
  }

function program10(depth0,data) {
  
  
  data.buffer.push("\n        <span class='pad'></span>\n      ");
  }

function program12(depth0,data) {
  
  var buffer = '', stack1;
  data.buffer.push("\n        <span  ");
  data.buffer.push(escapeExpression(helpers.action.call(depth0, "valueClick", "model", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0,depth0],types:["STRING","ID"],data:data})));
  data.buffer.push(" ");
  data.buffer.push(escapeExpression(helpers['bind-attr'].call(depth0, {hash:{
    'class': ("value.type :mixin__property-value")
  },hashTypes:{'class': "STRING"},hashContexts:{'class': depth0},contexts:[],types:[],data:data})));
  data.buffer.push(" data-label=\"object-property-value\">");
  stack1 = helpers._triageMustache.call(depth0, "value.inspect", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("</span>\n      ");
  return buffer;
  }

function program14(depth0,data) {
  
  var buffer = '', helper, options;
  data.buffer.push("\n        ");
  data.buffer.push(escapeExpression((helper = helpers['property-field'] || (depth0 && depth0['property-field']),options={hash:{
    'class': ("mixin__property-value-txt"),
    'value': ("txtValue"),
    'label': ("object-property-value-txt")
  },hashTypes:{'class': "STRING",'value': "ID",'label': "STRING"},hashContexts:{'class': depth0,'value': depth0,'label': depth0},contexts:[],types:[],data:data},helper ? helper.call(depth0, options) : helperMissing.call(depth0, "property-field", options))));
  data.buffer.push("\n      ");
  return buffer;
  }

function program16(depth0,data) {
  
  
  data.buffer.push("\n    <li class=\"mixin__property\">No Properties</li>\n    ");
  }

  stack1 = helpers.each.call(depth0, "mixin", "in", "mixins", {hash:{
    'itemController': ("mixinDetail")
  },hashTypes:{'itemController': "STRING"},hashContexts:{'itemController': depth0},inverse:self.noop,fn:self.program(1, program1, data),contexts:[depth0,depth0,depth0],types:["ID","ID","ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n");
  return buffer;
  
}); });

define('templates/mixin_stack', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  var buffer = '', stack1, helper, options, escapeExpression=this.escapeExpression, self=this, helperMissing=helpers.helperMissing;

function program1(depth0,data) {
  
  var buffer = '', stack1;
  data.buffer.push("\n<div class=\"split__panel__hd\">\n  <div class=\"toolbar\">\n    <button ");
  data.buffer.push(escapeExpression(helpers.action.call(depth0, "popStack", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["STRING"],data:data})));
  data.buffer.push(" data-label=\"object-inspector-back\" ");
  data.buffer.push(escapeExpression(helpers['bind-attr'].call(depth0, {hash:{
    'class': (":toolbar__icon-button isNested:enabled:disabled")
  },hashTypes:{'class': "STRING"},hashContexts:{'class': depth0},contexts:[],types:[],data:data})));
  data.buffer.push(">\n      <svg width=\"9px\" height=\"9px\" viewBox=\"0 0 9 9\" version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\">\n        <g stroke=\"none\" stroke-width=\"1\" fill=\"none\" fill-rule=\"evenodd\">\n          <polygon class=\"svg-fill\" fill=\"#000000\" transform=\"translate(4.500000, 4.500000) rotate(-90.000000) translate(-4.500000, -4.500000) \" points=\"4.5 0 9 9 0 9 \"></polygon>\n        </g>\n      </svg>\n    </button>\n\n    <div class=\"divider\"></div>\n\n    <code data-label=\"object-name\" class=\"toolbar__title\">");
  stack1 = helpers._triageMustache.call(depth0, "firstObject.name", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("</code>\n\n    <button class=\"send-to-console\" ");
  data.buffer.push(escapeExpression(helpers.action.call(depth0, "sendObjectToConsole", "firstObject", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0,depth0],types:["STRING","ID"],data:data})));
  data.buffer.push(" data-label=\"send-object-to-console-btn\">\n      <img src=\"../images/send.png\" title=\"Send object to console\">\n    </button>\n  </div>\n\n  ");
  stack1 = helpers['if'].call(depth0, "trail", {hash:{},hashTypes:{},hashContexts:{},inverse:self.noop,fn:self.program(2, program2, data),contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n</div>\n");
  return buffer;
  }
function program2(depth0,data) {
  
  var buffer = '', stack1;
  data.buffer.push("\n    <code class=\"object-trail\" data-label=\"object-trail\">");
  stack1 = helpers._triageMustache.call(depth0, "trail", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("</code>\n  ");
  return buffer;
  }

  stack1 = helpers['if'].call(depth0, "length", {hash:{},hashTypes:{},hashContexts:{},inverse:self.noop,fn:self.program(1, program1, data),contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n\n<div class=\"split__panel__bd\">\n  ");
  data.buffer.push(escapeExpression((helper = helpers.render || (depth0 && depth0.render),options={hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["STRING"],data:data},helper ? helper.call(depth0, "mixinDetails", options) : helperMissing.call(depth0, "render", "mixinDetails", options))));
  data.buffer.push("\n</div>\n");
  return buffer;
  
}); });

define('templates/model_types', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  var buffer = '', stack1, helper, options, self=this, helperMissing=helpers.helperMissing;

function program1(depth0,data) {
  
  var buffer = '', stack1;
  data.buffer.push("\n    <div class=\"split__panel__bd\">\n      <div class=\"nav__title\"><h3>Model Types</h3></div>\n      <ul>\n        ");
  stack1 = helpers.each.call(depth0, {hash:{},hashTypes:{},hashContexts:{},inverse:self.noop,fn:self.program(2, program2, data),contexts:[],types:[],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n      </ul>\n    </div>\n  ");
  return buffer;
  }
function program2(depth0,data) {
  
  var buffer = '', stack1, helper, options;
  data.buffer.push("\n          <li data-label=\"model-type\">\n            ");
  stack1 = (helper = helpers['link-to'] || (depth0 && depth0['link-to']),options={hash:{},hashTypes:{},hashContexts:{},inverse:self.noop,fn:self.program(3, program3, data),contexts:[depth0,depth0],types:["STRING","ID"],data:data},helper ? helper.call(depth0, "records", "", options) : helperMissing.call(depth0, "link-to", "records", "", options));
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n          </li>\n        ");
  return buffer;
  }
function program3(depth0,data) {
  
  var buffer = '', stack1;
  data.buffer.push("\n              <span data-label=\"model-type-name\">");
  stack1 = helpers._triageMustache.call(depth0, "name", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("</span>\n              (<span data-label=\"model-type-count\">");
  stack1 = helpers._triageMustache.call(depth0, "count", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("</span>)\n            ");
  return buffer;
  }

  data.buffer.push("<div class=\"split\">\n  ");
  stack1 = (helper = helpers['draggable-column'] || (depth0 && depth0['draggable-column']),options={hash:{
    'width': ("navWidth"),
    'classNames': ("split__panel split__panel--sidebar-2 nav")
  },hashTypes:{'width': "ID",'classNames': "STRING"},hashContexts:{'width': depth0,'classNames': depth0},inverse:self.noop,fn:self.program(1, program1, data),contexts:[],types:[],data:data},helper ? helper.call(depth0, options) : helperMissing.call(depth0, "draggable-column", options));
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n\n  <div class=\"split__panel\">\n    <div class=\"split__panel__bd\">\n      ");
  stack1 = helpers._triageMustache.call(depth0, "outlet", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n    </div>\n  </div>\n</div>\n");
  return buffer;
  
}); });

define('templates/nav', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  var buffer = '', stack1, helper, options, self=this, helperMissing=helpers.helperMissing;

function program1(depth0,data) {
  
  
  data.buffer.push("\n        View Tree\n        <svg version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" x=\"0px\" y=\"0px\" width=\"19px\" height=\"19px\" viewBox=\"0 0 19 19\" enable-background=\"new 0 0 19 19\" xml:space=\"preserve\">\n          <path fill=\"#454545\" d=\"M0,0v19h19V0H0z M6,17h-4V5h4V17z M17,17H7V5h10v12H17z M17,4H2V2h15V1z\"/>\n        </svg>\n      ");
  }

function program3(depth0,data) {
  
  
  data.buffer.push("\n        Routes\n        <svg version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" x=\"0px\" y=\"0px\" width=\"19px\" height=\"19px\" viewBox=\"0 0 19 19\" enable-background=\"new 0 0 19 19\" xml:space=\"preserve\">\n          <polygon fill=\"#454545\" points=\"0.591,17.012 2.36,17.012 6.841,2.086 5.07,2.086\"/>\n          <path fill=\"#454545\" d=\"M18.117,8.495l0.292-1.494h-2.242l0.874-3.507h-1.544l-0.874,3.507h-1.88l0.874-3.507h-1.536l-0.883,3.507 H8.668L8.375,8.495h2.449l-0.616,2.474H7.875l-0.292,1.495h2.252l-0.883,3.515h1.544l0.874-3.515h1.888l-0.883,3.515h1.544 l0.874-3.515h2.53l0.303-1.495h-2.459l0.625-2.474H18.117z M14.249,8.495l-0.617,2.474h-1.888l0.625-2.474H14.249z\"/>\n        </svg>\n      ");
  }

function program5(depth0,data) {
  
  
  data.buffer.push("\n        Data\n        <svg version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" x=\"0px\" y=\"0px\" width=\"19px\" height=\"19px\" viewBox=\"0 0 19 19\" enable-background=\"new 0 0 19 19\" xml:space=\"preserve\">\n          <path d=\"M9.5,0.001C3.907,0.001,0,1.507,0,3.663v11.675C0,17.494,3.907,19,9.5,19c5.594,0,9.5-1.506,9.5-3.662V3.663 C19,1.507,15.094,0.001,9.5,0.001z M9.5,5.669c-4.768,0-7.81-1.318-7.81-2.007c0-0.689,3.042-2.008,7.81-2.008 c4.769,0,7.81,1.318,7.81,2.008C17.31,4.352,14.269,5.669,9.5,5.669z M17.31,15.338c0,0.689-3.041,2.007-7.81,2.007 c-4.768,0-7.81-1.317-7.81-2.007V5.852C3.39,6.77,6.282,7.324,9.5,7.324c3.217,0,6.108-0.554,7.81-1.472V15.338z\"/>\n        </svg>\n      ");
  }

function program7(depth0,data) {
  
  
  data.buffer.push("\n      Info\n      <svg width=\"19\" height=\"19\" xmlns=\"http://www.w3.org/2000/svg\">\n        <rect id=\"svg_3\" height=\"6.815\" width=\"3.33\" fill=\"#454545\" y=\"7.8805\" x=\"7.737\"/>\n        <circle id=\"svg_4\" r=\"1.753\" cy=\"5.3775\" cx=\"9.451\" fill=\"#454545\"/>\n        <path id=\"svg_6\" d=\"m9.5,19c-5.238,0 -9.5,-4.262 -9.5,-9.5c0,-5.238 4.262,-9.5 9.5,-9.5s9.5,4.262 9.5,9.5c0,5.238 -4.262,9.5 -9.5,9.5zm0,-17.434c-4.375,0 -7.933,3.559 -7.933,7.933c0,4.374 3.559,7.932 7.933,7.932c4.374,0 7.933,-3.559 7.933,-7.932c0,-4.374 -3.559,-7.933 -7.933,-7.933z\" fill=\"#454545\"/>\n      </svg>\n      ");
  }

function program9(depth0,data) {
  
  
  data.buffer.push("\n        Promises\n        <svg version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" x=\"0px\" y=\"0px\" width=\"23px\" height=\"23px\" viewBox=\"0 0 23 23\" enable-background=\"new 0 0 23 23\" xml:space=\"preserve\">\n          <path d=\"M19,0 L19,19 L-0,19 L-0,0 z M2,2 L2,17 L17,17 L17,2.832 L6.807,12.912 L5.12,12.923 L5.12,2 z M7,2 L7.12,9.863 L15.953,2 z\" />\n          <path d=\"M6.066,13.643 C4.488,13.643 3.208,12.363 3.208,10.784 C3.208,9.206 4.488,7.926 6.066,7.926 C7.645,7.926 8.925,9.206 8.925,10.784 C8.925,12.363 7.645,13.643 6.066,13.643 z\" />\n        </svg>\n      ");
  }

function program11(depth0,data) {
  
  
  data.buffer.push("\n      Container\n\n      <svg version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" x=\"0px\" y=\"0px\"\n         width=\"19px\" height=\"19px\" viewBox=\"0 0 43 42.191\" enable-background=\"new 0 0 43 42.191\" xml:space=\"preserve\">\n      <g>\n        <path d=\"M20.038,42.092L18,40.691V15.687l1.07-1.437l22-6.585L43,9.102v23.138l-0.962,1.4L20.038,42.092z M21,16.804v21.704\n          l19-7.299V11.116L21,16.804z\"/>\n        <path d=\"M19.647,42.191c-0.224,0-0.452-0.05-0.666-0.156L0.833,33.028L0,31.685V8.01l2.075-1.386l18.507,7.677\n          c0.765,0.317,1.128,1.195,0.811,1.961c-0.318,0.765-1.195,1.129-1.96,0.811L3,10.256v20.499l17.315,8.593\n          c0.742,0.368,1.045,1.269,0.677,2.011C20.73,41.886,20.199,42.191,19.647,42.191z\"/>\n        <path d=\"M41.414,10.602c-0.193,0-0.391-0.037-0.58-0.116L23.047,3.027L2.096,9.444C1.303,9.688,0.465,9.24,0.223,8.449\n          C-0.02,7.657,0.425,6.818,1.217,6.575L22.687,0l1.02,0.051l18.288,7.667c0.764,0.32,1.124,1.2,0.804,1.964\n          C42.557,10.256,42,10.602,41.414,10.602z\"/>\n      </g>\n      </svg>\n\n      ");
  }

function program13(depth0,data) {
  
  
  data.buffer.push("\n      Render Performance\n      <svg version=\"1.1\" id=\"Layer_1\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" x=\"0px\" y=\"0px\"\n width=\"18.979px\" height=\"18.979px\" viewBox=\"0.021 -0.018 18.979 18.979\" enable-background=\"new 0.021 -0.018 18.979 18.979\"\n xml:space=\"preserve\">\n      <g>\n        <path d=\"M8.358,11.589c0.291,0.299,0.674,0.45,1.053,0.45c0.347,0,0.69-0.126,0.955-0.384c0.553-0.535,5.625-7.474,5.625-7.474\n          s-7.089,4.864-7.641,5.4C7.798,10.12,7.803,11.017,8.358,11.589z\"/>\n        <g>\n          <path d=\"M16.057,2.615c-1.702-1.627-4.005-2.633-6.546-2.633c-5.237,0-9.482,4.246-9.482,9.482c0,2.816,1.233,5.336,3.182,7.073\n            c-1.22-1.439-1.959-3.299-1.959-5.333c0-4.561,3.698-8.259,8.26-8.259c1.577,0,3.045,0.45,4.298,1.216\n            c0.561-0.386,1.067-0.734,1.472-1.011L16.057,2.615z\"/>\n          <path d=\"M17.005,4.923c-0.26,0.354-0.582,0.794-0.936,1.275c1.062,1.39,1.7,3.121,1.7,5.005c0,2.037-0.741,3.898-1.963,5.338\n            c1.951-1.736,3.187-4.259,3.187-7.078c0-1.905-0.568-3.676-1.535-5.162L17.005,4.923z\"/>\n        </g>\n      </g>\n      </svg>\n      ");
  }

  data.buffer.push("<nav class=\"nav nav--main\">\n  <ul>\n    <li>\n      ");
  stack1 = (helper = helpers['link-to'] || (depth0 && depth0['link-to']),options={hash:{},hashTypes:{},hashContexts:{},inverse:self.noop,fn:self.program(1, program1, data),contexts:[depth0],types:["STRING"],data:data},helper ? helper.call(depth0, "view-tree", options) : helperMissing.call(depth0, "link-to", "view-tree", options));
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n    </li>\n    <li>\n      ");
  stack1 = (helper = helpers['link-to'] || (depth0 && depth0['link-to']),options={hash:{},hashTypes:{},hashContexts:{},inverse:self.noop,fn:self.program(3, program3, data),contexts:[depth0],types:["STRING"],data:data},helper ? helper.call(depth0, "route-tree", options) : helperMissing.call(depth0, "link-to", "route-tree", options));
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n    </li>\n    <li>\n      ");
  stack1 = (helper = helpers['link-to'] || (depth0 && depth0['link-to']),options={hash:{},hashTypes:{},hashContexts:{},inverse:self.noop,fn:self.program(5, program5, data),contexts:[depth0],types:["STRING"],data:data},helper ? helper.call(depth0, "data", options) : helperMissing.call(depth0, "link-to", "data", options));
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n    </li>\n    <li>\n      ");
  stack1 = (helper = helpers['link-to'] || (depth0 && depth0['link-to']),options={hash:{},hashTypes:{},hashContexts:{},inverse:self.noop,fn:self.program(7, program7, data),contexts:[depth0],types:["STRING"],data:data},helper ? helper.call(depth0, "info", options) : helperMissing.call(depth0, "link-to", "info", options));
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n    </li>\n  </ul>\n  <div class=\"nav__title nav__title--middle\">\n    <h3>Advanced</h3>\n  </div>\n  <ul>\n    <li>\n      ");
  stack1 = (helper = helpers['link-to'] || (depth0 && depth0['link-to']),options={hash:{},hashTypes:{},hashContexts:{},inverse:self.noop,fn:self.program(9, program9, data),contexts:[depth0],types:["STRING"],data:data},helper ? helper.call(depth0, "promises", options) : helperMissing.call(depth0, "link-to", "promises", options));
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n    </li>\n    <li>\n      ");
  stack1 = (helper = helpers['link-to'] || (depth0 && depth0['link-to']),options={hash:{},hashTypes:{},hashContexts:{},inverse:self.noop,fn:self.program(11, program11, data),contexts:[depth0],types:["STRING"],data:data},helper ? helper.call(depth0, "container-types", options) : helperMissing.call(depth0, "link-to", "container-types", options));
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n    </li>\n    <li>\n      ");
  stack1 = (helper = helpers['link-to'] || (depth0 && depth0['link-to']),options={hash:{},hashTypes:{},hashContexts:{},inverse:self.noop,fn:self.program(13, program13, data),contexts:[depth0],types:["STRING"],data:data},helper ? helper.call(depth0, "render-tree", options) : helperMissing.call(depth0, "link-to", "render-tree", options));
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n    </li>\n  </ul>\n</nav>\n");
  return buffer;
  
}); });

define('templates/page_refresh', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  var buffer = '', escapeExpression=this.escapeExpression;


  data.buffer.push("<div class=\"notice\" data-label=\"page-refresh\">\n  <p>Reload the page to see promises created before you opened the inspector.</p>\n  <button data-label=\"page-refresh-btn\" ");
  data.buffer.push(escapeExpression(helpers.action.call(depth0, "refreshPage", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["STRING"],data:data})));
  data.buffer.push(">Reload</button>\n</div>\n");
  return buffer;
  
}); });

define('templates/promise_item', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  var buffer = '', stack1, helper, options, escapeExpression=this.escapeExpression, helperMissing=helpers.helperMissing, self=this;

function program1(depth0,data) {
  
  var buffer = '';
  data.buffer.push("\n        <div class=\"send-trace-to-console\" ");
  data.buffer.push(escapeExpression(helpers.action.call(depth0, "tracePromise", "model", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0,depth0],types:["STRING","ID"],data:data})));
  data.buffer.push(" title=\"Trace promise in console\" data-label=\"trace-promise-btn\">\n          Trace\n        </div>\n      ");
  return buffer;
  }

function program3(depth0,data) {
  
  var buffer = '', stack1;
  data.buffer.push("\n        <div class=\"list-tree__limited  list-tree__limited_helper_very-large\" ");
  data.buffer.push(escapeExpression(helpers['bind-attr'].call(depth0, {hash:{
    'title': ("settledValue.inspect")
  },hashTypes:{'title': "STRING"},hashContexts:{'title': depth0},contexts:[],types:[],data:data})));
  data.buffer.push(">\n          ");
  stack1 = helpers['if'].call(depth0, "isValueInspectable", {hash:{},hashTypes:{},hashContexts:{},inverse:self.program(6, program6, data),fn:self.program(4, program4, data),contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n        </div>\n        <div class=\"list-tree__right-helper\">\n          ");
  stack1 = helpers['if'].call(depth0, "isError", {hash:{},hashTypes:{},hashContexts:{},inverse:self.program(10, program10, data),fn:self.program(8, program8, data),contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n\n        </div>\n    ");
  return buffer;
  }
function program4(depth0,data) {
  
  var buffer = '', stack1;
  data.buffer.push("\n\n            <span class=\"cell_clickable\" ");
  data.buffer.push(escapeExpression(helpers.action.call(depth0, "inspectObject", "settledValue.objectId", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0,depth0],types:["STRING","ID"],data:data})));
  data.buffer.push(" data-label=\"promise-object-value\">");
  stack1 = helpers._triageMustache.call(depth0, "settledValue.inspect", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("</span>\n          ");
  return buffer;
  }

function program6(depth0,data) {
  
  var buffer = '', stack1;
  data.buffer.push("\n            ");
  stack1 = helpers._triageMustache.call(depth0, "settledValue.inspect", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n          ");
  return buffer;
  }

function program8(depth0,data) {
  
  var buffer = '';
  data.buffer.push("\n          <div class=\"send-trace-to-console\" ");
  data.buffer.push(escapeExpression(helpers.action.call(depth0, "sendValueToConsole", "model", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0,depth0],types:["STRING","ID"],data:data})));
  data.buffer.push(" data-label=\"send-to-console-btn\" title=\"Send stack trace to the console\">\n            Stack trace\n          </div>\n          ");
  return buffer;
  }

function program10(depth0,data) {
  
  var buffer = '', helper, options;
  data.buffer.push("\n            ");
  data.buffer.push(escapeExpression((helper = helpers['send-to-console'] || (depth0 && depth0['send-to-console']),options={hash:{
    'action': ("sendValueToConsole"),
    'param': ("model")
  },hashTypes:{'action': "STRING",'param': "ID"},hashContexts:{'action': depth0,'param': depth0},contexts:[],types:[],data:data},helper ? helper.call(depth0, options) : helperMissing.call(depth0, "send-to-console", options))));
  data.buffer.push("\n          ");
  return buffer;
  }

function program12(depth0,data) {
  
  
  data.buffer.push("\n    --\n    ");
  }

  data.buffer.push("<div ");
  data.buffer.push(escapeExpression(helpers['bind-attr'].call(depth0, {hash:{
    'style': ("nodeStyle"),
    'class': (":list-tree__item :row expandedClass")
  },hashTypes:{'style': "STRING",'class': "STRING"},hashContexts:{'style': depth0,'class': depth0},contexts:[],types:[],data:data})));
  data.buffer.push("  data-label=\"promise-item\">\n  <div class=\"cell_type_main cell\" ");
  data.buffer.push(escapeExpression(helpers.action.call(depth0, "toggleExpand", "model", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0,depth0],types:["STRING","ID"],data:data})));
  data.buffer.push(" ");
  data.buffer.push(escapeExpression(helpers['bind-attr'].call(depth0, {hash:{
    'style': ("labelStyle")
  },hashTypes:{'style': "STRING"},hashContexts:{'style': depth0},contexts:[],types:[],data:data})));
  data.buffer.push(">\n    <div class=\"list-tree__limited list-tree__limited_helper_large\">\n      <span ");
  data.buffer.push(escapeExpression(helpers['bind-attr'].call(depth0, {hash:{
    'title': ("label")
  },hashTypes:{'title': "STRING"},hashContexts:{'title': depth0},contexts:[],types:[],data:data})));
  data.buffer.push(" data-label=\"promise-label\">\n        <span class=\"cell__arrow\"></span>\n        ");
  stack1 = helpers._triageMustache.call(depth0, "label", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n      </span>\n    </div>\n    <div class=\"list-tree__right-helper\">\n      ");
  stack1 = helpers['if'].call(depth0, "hasStack", {hash:{},hashTypes:{},hashContexts:{},inverse:self.noop,fn:self.program(1, program1, data),contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n    </div>\n  </div>\n  <div class=\"cell cell_size_medium\">\n    <div class=\"pill pill_text_clear\" ");
  data.buffer.push(escapeExpression(helpers['bind-attr'].call(depth0, {hash:{
    'style': ("style")
  },hashTypes:{'style': "STRING"},hashContexts:{'style': depth0},contexts:[],types:[],data:data})));
  data.buffer.push(" data-label=\"promise-state\">");
  stack1 = helpers._triageMustache.call(depth0, "state", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("</div>\n  </div>\n  <div class=\"cell cell_size_large\" data-label=\"promise-value\">\n    ");
  stack1 = helpers['if'].call(depth0, "hasValue", {hash:{},hashTypes:{},hashContexts:{},inverse:self.program(12, program12, data),fn:self.program(3, program3, data),contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n  </div>\n  <div class=\"cell cell_size_medium cell_value_numeric\" data-label=\"promise-time\">");
  data.buffer.push(escapeExpression((helper = helpers['ms-to-time'] || (depth0 && depth0['ms-to-time']),options={hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data},helper ? helper.call(depth0, "timeToSettle", options) : helperMissing.call(depth0, "ms-to-time", "timeToSettle", options))));
  data.buffer.push("</div>\n</div>\n");
  return buffer;
  
}); });

define('templates/promise_tree', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  var buffer = '', stack1, helperMissing=helpers.helperMissing, escapeExpression=this.escapeExpression, self=this;

function program1(depth0,data) {
  
  var buffer = '', helper, options;
  data.buffer.push("\n  ");
  data.buffer.push(escapeExpression((helper = helpers.partial || (depth0 && depth0.partial),options={hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["STRING"],data:data},helper ? helper.call(depth0, "page_refresh", options) : helperMissing.call(depth0, "partial", "page_refresh", options))));
  data.buffer.push("\n");
  return buffer;
  }

function program3(depth0,data) {
  
  var buffer = '';
  data.buffer.push("\n<div class=\"list-view\" data-label=\"promise-tree\">\n  <div class=\"list-view__header row\">\n    <div class=\"cell cell_type_header\">\n      Label\n    </div>\n    <div class=\"cell cell_size_medium cell_type_header\">\n      State\n    </div>\n    <div class=\"cell cell_size_large cell_type_header\">\n      Fulfillment / Rejection value\n    </div>\n    <div class=\"cell cell_size_medium cell_value_numeric cell_type_header\">\n      Time to settle\n    </div>\n    <!-- Account for scrollbar width :'(  -->\n    <div class=\"cell cell_type_header spacer\"></div>\n  </div>\n\n  <div class=\"list-view__list-container\">\n    ");
  data.buffer.push(escapeExpression(helpers.view.call(depth0, "promiseList", {hash:{
    'content': ("items")
  },hashTypes:{'content': "ID"},hashContexts:{'content': depth0},contexts:[depth0],types:["STRING"],data:data})));
  data.buffer.push("\n  </div>\n</div>\n");
  return buffer;
  }

  stack1 = helpers['if'].call(depth0, "shouldRefresh", {hash:{},hashTypes:{},hashContexts:{},inverse:self.program(3, program3, data),fn:self.program(1, program1, data),contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n");
  return buffer;
  
}); });

define('templates/promise_tree_toolbar', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  var buffer = '', helper, options, helperMissing=helpers.helperMissing, escapeExpression=this.escapeExpression;


  data.buffer.push("<div class=\"toolbar\">\n  ");
  data.buffer.push(escapeExpression((helper = helpers['clear-button'] || (depth0 && depth0['clear-button']),options={hash:{
    'action': ("clear"),
    'classNames': ("toolbar__icon-button"),
    'dataLabel': ("clear-promises-btn")
  },hashTypes:{'action': "STRING",'classNames': "STRING",'dataLabel': "STRING"},hashContexts:{'action': depth0,'classNames': depth0,'dataLabel': depth0},contexts:[],types:[],data:data},helper ? helper.call(depth0, options) : helperMissing.call(depth0, "clear-button", options))));
  data.buffer.push("\n\n  <div class=\"toolbar__search\" data-label=\"promise-search\">\n    ");
  data.buffer.push(escapeExpression((helper = helpers.input || (depth0 && depth0.input),options={hash:{
    'value': ("search"),
    'placeholder': ("Search")
  },hashTypes:{'value': "ID",'placeholder': "STRING"},hashContexts:{'value': depth0,'placeholder': depth0},contexts:[],types:[],data:data},helper ? helper.call(depth0, options) : helperMissing.call(depth0, "input", options))));
  data.buffer.push("\n  </div>\n\n  <button data-label=\"filter\" ");
  data.buffer.push(escapeExpression(helpers['bind-attr'].call(depth0, {hash:{
    'class': ("noFilter:active :toolbar__radio")
  },hashTypes:{'class': "STRING"},hashContexts:{'class': depth0},contexts:[],types:[],data:data})));
  data.buffer.push(" ");
  data.buffer.push(escapeExpression(helpers.action.call(depth0, "setFilter", "all", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0,depth0],types:["STRING","STRING"],data:data})));
  data.buffer.push(">\n    All\n  </button>\n\n  <div class=\"divider\"></div>\n\n  <button data-label=\"filter\" ");
  data.buffer.push(escapeExpression(helpers['bind-attr'].call(depth0, {hash:{
    'class': ("isRejectedFilter:active :toolbar__radio")
  },hashTypes:{'class': "STRING"},hashContexts:{'class': depth0},contexts:[],types:[],data:data})));
  data.buffer.push(" ");
  data.buffer.push(escapeExpression(helpers.action.call(depth0, "setFilter", "rejected", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0,depth0],types:["STRING","STRING"],data:data})));
  data.buffer.push(" >Rejected</button>\n  <button data-label=\"filter\" ");
  data.buffer.push(escapeExpression(helpers['bind-attr'].call(depth0, {hash:{
    'class': ("isPendingFilter:active :toolbar__radio")
  },hashTypes:{'class': "STRING"},hashContexts:{'class': depth0},contexts:[],types:[],data:data})));
  data.buffer.push(" ");
  data.buffer.push(escapeExpression(helpers.action.call(depth0, "setFilter", "pending", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0,depth0],types:["STRING","STRING"],data:data})));
  data.buffer.push(" >Pending</button>\n  <button data-label=\"filter\" ");
  data.buffer.push(escapeExpression(helpers['bind-attr'].call(depth0, {hash:{
    'class': ("isFulfilledFilter:active :toolbar__radio")
  },hashTypes:{'class': "STRING"},hashContexts:{'class': depth0},contexts:[],types:[],data:data})));
  data.buffer.push(" ");
  data.buffer.push(escapeExpression(helpers.action.call(depth0, "setFilter", "fulfilled", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0,depth0],types:["STRING","STRING"],data:data})));
  data.buffer.push(" >Fulfilled</button>\n\n\n  <div class=\"toolbar__checkbox\" data-label=\"with-stack\">\n    ");
  data.buffer.push(escapeExpression((helper = helpers.input || (depth0 && depth0.input),options={hash:{
    'type': ("checkbox"),
    'checked': ("instrumentWithStack"),
    'id': ("instrument-with-stack")
  },hashTypes:{'type': "STRING",'checked': "ID",'id': "STRING"},hashContexts:{'type': depth0,'checked': depth0,'id': depth0},contexts:[],types:[],data:data},helper ? helper.call(depth0, options) : helperMissing.call(depth0, "input", options))));
  data.buffer.push(" <label for=\"instrument-with-stack\">Trace promises</label>\n  </div>\n</div>\n");
  return buffer;
  
}); });

define('templates/promises/error', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  var buffer = '', stack1, helper, options, self=this, helperMissing=helpers.helperMissing;

function program1(depth0,data) {
  
  
  data.buffer.push("\n  <li>You are using a version of Ember &lt; 1.3.</li>\n  ");
  }

  data.buffer.push("<div class=\"data-error-page-container\">\n  ");
  stack1 = (helper = helpers['not-detected'] || (depth0 && depth0['not-detected']),options={hash:{
    'description': ("Promises"),
    'reasonsTitle': ("This usually happens because:")
  },hashTypes:{'description': "STRING",'reasonsTitle': "STRING"},hashContexts:{'description': depth0,'reasonsTitle': depth0},inverse:self.noop,fn:self.program(1, program1, data),contexts:[],types:[],data:data},helper ? helper.call(depth0, options) : helperMissing.call(depth0, "not-detected", options));
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n</div>\n");
  return buffer;
  
}); });

define('templates/record_item', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  var buffer = '', stack1, escapeExpression=this.escapeExpression, self=this;

function program1(depth0,data) {
  
  var buffer = '', stack1;
  data.buffer.push("\n    <div class=\"cell cell_clickable\" data-label=\"record-column\" ");
  data.buffer.push(escapeExpression(helpers['bind-attr'].call(depth0, {hash:{
    'style': ("controller.style")
  },hashTypes:{'style': "STRING"},hashContexts:{'style': depth0},contexts:[],types:[],data:data})));
  data.buffer.push(">\n      ");
  stack1 = helpers._triageMustache.call(depth0, "value", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n    </div>\n  ");
  return buffer;
  }

  data.buffer.push("<div ");
  data.buffer.push(escapeExpression(helpers['bind-attr'].call(depth0, {hash:{
    'class': (":list-tree__item :row isCurrent:row_highlight")
  },hashTypes:{'class': "STRING"},hashContexts:{'class': depth0},contexts:[],types:[],data:data})));
  data.buffer.push(" data-label=\"record-row\" ");
  data.buffer.push(escapeExpression(helpers.action.call(depth0, "inspectModel", "model", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0,depth0],types:["STRING","ID"],data:data})));
  data.buffer.push(">\n  ");
  stack1 = helpers.each.call(depth0, "columns", {hash:{},hashTypes:{},hashContexts:{},inverse:self.noop,fn:self.program(1, program1, data),contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n</div>\n");
  return buffer;
  
}); });

define('templates/records', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  var buffer = '', stack1, self=this, escapeExpression=this.escapeExpression;

function program1(depth0,data) {
  
  var buffer = '', stack1;
  data.buffer.push("\n      <div class=\"cell cell_type_header\" data-label=\"column-title\">");
  stack1 = helpers._triageMustache.call(depth0, "desc", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("</div>\n    ");
  return buffer;
  }

  data.buffer.push("<div class=\"list-view\">\n  <div class=\"list-view__header row\">\n    ");
  stack1 = helpers.each.call(depth0, "columns", {hash:{},hashTypes:{},hashContexts:{},inverse:self.noop,fn:self.program(1, program1, data),contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n\n    <!-- Account for scrollbar width :'(  -->\n    <div class=\"cell cell_type_header spacer\"></div>\n  </div>\n\n  <div class=\"list-view__list-container\">\n    ");
  data.buffer.push(escapeExpression(helpers.view.call(depth0, "recordList", {hash:{
    'content': ("filtered")
  },hashTypes:{'content': "ID"},hashContexts:{'content': depth0},contexts:[depth0],types:["STRING"],data:data})));
  data.buffer.push("\n  </div>\n</div>\n");
  return buffer;
  
}); });

define('templates/records_toolbar', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  var buffer = '', stack1, helper, options, escapeExpression=this.escapeExpression, helperMissing=helpers.helperMissing, self=this;

function program1(depth0,data) {
  
  var buffer = '', stack1;
  data.buffer.push("\n    <button data-label=\"filter\" ");
  data.buffer.push(escapeExpression(helpers['bind-attr'].call(depth0, {hash:{
    'class': ("checked:active :toolbar__radio")
  },hashTypes:{'class': "STRING"},hashContexts:{'class': depth0},contexts:[],types:[],data:data})));
  data.buffer.push(" ");
  data.buffer.push(escapeExpression(helpers.action.call(depth0, "setFilter", "name", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0,depth0],types:["STRING","ID"],data:data})));
  data.buffer.push(" >");
  stack1 = helpers._triageMustache.call(depth0, "desc", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("</button>\n  ");
  return buffer;
  }

  data.buffer.push("<div class=\"toolbar\">\n  <div class=\"toolbar__search\" data-label=\"records-search\">\n    ");
  data.buffer.push(escapeExpression((helper = helpers.input || (depth0 && depth0.input),options={hash:{
    'value': ("search"),
    'placeholder': ("Search")
  },hashTypes:{'value': "ID",'placeholder': "STRING"},hashContexts:{'value': depth0,'placeholder': depth0},contexts:[],types:[],data:data},helper ? helper.call(depth0, options) : helperMissing.call(depth0, "input", options))));
  data.buffer.push("\n  </div>\n\n  <button data-label=\"filter\" ");
  data.buffer.push(escapeExpression(helpers['bind-attr'].call(depth0, {hash:{
    'class': ("noFilterValue:active :toolbar__radio")
  },hashTypes:{'class': "STRING"},hashContexts:{'class': depth0},contexts:[],types:[],data:data})));
  data.buffer.push(" ");
  data.buffer.push(escapeExpression(helpers.action.call(depth0, "setFilter", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["STRING"],data:data})));
  data.buffer.push(">\n    All\n  </button>\n\n  <div class=\"divider\"></div>\n\n  ");
  stack1 = helpers.each.call(depth0, "filters", {hash:{
    'itemController': ("recordFilter")
  },hashTypes:{'itemController': "STRING"},hashContexts:{'itemController': depth0},inverse:self.noop,fn:self.program(1, program1, data),contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n</div>");
  return buffer;
  
}); });

define('templates/render_item', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  var buffer = '', stack1, helper, options, helperMissing=helpers.helperMissing, escapeExpression=this.escapeExpression, self=this;

function program1(depth0,data) {
  
  var buffer = '', stack1;
  data.buffer.push("\n  ");
  stack1 = helpers.each.call(depth0, "children", {hash:{},hashTypes:{},hashContexts:{},inverse:self.noop,fn:self.program(2, program2, data),contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n");
  return buffer;
  }
function program2(depth0,data) {
  
  var buffer = '', helper, options;
  data.buffer.push("\n    ");
  data.buffer.push(escapeExpression((helper = helpers.render || (depth0 && depth0.render),options={hash:{},hashTypes:{},hashContexts:{},contexts:[depth0,depth0],types:["STRING","ID"],data:data},helper ? helper.call(depth0, "render_item", "", options) : helperMissing.call(depth0, "render", "render_item", "", options))));
  data.buffer.push("\n  ");
  return buffer;
  }

  data.buffer.push("<div data-label=\"render-profile-row\" class=\"list-tree__item-wrapper row-wrapper\">\n  <div ");
  data.buffer.push(escapeExpression(helpers['bind-attr'].call(depth0, {hash:{
    'style': ("nodeStyle"),
    'class': (":list-tree__item :row expandedClass")
  },hashTypes:{'style': "STRING",'class': "STRING"},hashContexts:{'style': depth0,'class': depth0},contexts:[],types:[],data:data})));
  data.buffer.push("  data-label=\"render-profile-item\">\n    <div class=\"cell_type_main cell\" ");
  data.buffer.push(escapeExpression(helpers.action.call(depth0, "toggleExpand", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["STRING"],data:data})));
  data.buffer.push(" ");
  data.buffer.push(escapeExpression(helpers['bind-attr'].call(depth0, {hash:{
    'style': ("nameStyle")
  },hashTypes:{'style': "STRING"},hashContexts:{'style': depth0},contexts:[],types:[],data:data})));
  data.buffer.push(" data-label=\"render-main-cell\">\n\n      <span ");
  data.buffer.push(escapeExpression(helpers['bind-attr'].call(depth0, {hash:{
    'title': ("name")
  },hashTypes:{'title': "STRING"},hashContexts:{'title': depth0},contexts:[],types:[],data:data})));
  data.buffer.push(">\n        <span class=\"cell__arrow\"></span>\n        <span data-label=\"render-profile-name\">");
  stack1 = helpers._triageMustache.call(depth0, "name", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("</span>\n        <span class=\"pill pill_not-clickable\" data-label=\"render-profile-duration\">");
  data.buffer.push(escapeExpression((helper = helpers['ms-to-time'] || (depth0 && depth0['ms-to-time']),options={hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data},helper ? helper.call(depth0, "duration", options) : helperMissing.call(depth0, "ms-to-time", "duration", options))));
  data.buffer.push("</span>\n      </span>\n    </div>\n    <div class=\"cell cell_value_numeric\"  data-label=\"render-profile-timestamp\">\n      ");
  stack1 = helpers._triageMustache.call(depth0, "readableTime", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n    </div>\n  </div>\n</div>\n");
  stack1 = helpers['if'].call(depth0, "isExpanded", {hash:{},hashTypes:{},hashContexts:{},inverse:self.noop,fn:self.program(1, program1, data),contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n");
  return buffer;
  
}); });

define('templates/render_tree', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  var buffer = '', stack1, helperMissing=helpers.helperMissing, escapeExpression=this.escapeExpression, self=this;

function program1(depth0,data) {
  
  var buffer = '', stack1;
  data.buffer.push("\n<div class=\"list-view\" data-label=\"render-tree\">\n  <div class=\"list-view__header row\">\n    <div class=\"cell cell_type_header\">\n      Name\n    </div>\n    <div class=\"cell cell_type_header cell_value_numeric\">\n      Timestamp\n    </div>\n    <!-- Account for scrollbar width :'(  -->\n    <div class=\"cell cell_type_header spacer\"></div>\n  </div>\n\n  <div class=\"ember-list-container\">\n    ");
  stack1 = helpers.view.call(depth0, "render_list", {hash:{},hashTypes:{},hashContexts:{},inverse:self.noop,fn:self.program(2, program2, data),contexts:[depth0],types:["STRING"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n  </div>\n</div>\n");
  return buffer;
  }
function program2(depth0,data) {
  
  var buffer = '', stack1;
  data.buffer.push("\n      ");
  stack1 = helpers.each.call(depth0, {hash:{},hashTypes:{},hashContexts:{},inverse:self.noop,fn:self.program(3, program3, data),contexts:[],types:[],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n    ");
  return buffer;
  }
function program3(depth0,data) {
  
  var buffer = '', helper, options;
  data.buffer.push("\n        ");
  data.buffer.push(escapeExpression((helper = helpers.render || (depth0 && depth0.render),options={hash:{},hashTypes:{},hashContexts:{},contexts:[depth0,depth0],types:["STRING","ID"],data:data},helper ? helper.call(depth0, "render_item", "", options) : helperMissing.call(depth0, "render", "render_item", "", options))));
  data.buffer.push("\n      ");
  return buffer;
  }

function program5(depth0,data) {
  
  
  data.buffer.push("\n  <div class=\"notice\" data-label=\"render-tree-empty\">\n    <p>No rendering metrics have been collected. Try navigating around your application.</p>\n    <p><strong>Note:</strong> Very fast rendering times (&lt;1ms) are excluded.</p>\n  </div>\n");
  }

  stack1 = helpers.unless.call(depth0, "showEmpty", {hash:{},hashTypes:{},hashContexts:{},inverse:self.program(5, program5, data),fn:self.program(1, program1, data),contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n");
  return buffer;
  
}); });

define('templates/render_tree_toolbar', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  var buffer = '', helper, options, helperMissing=helpers.helperMissing, escapeExpression=this.escapeExpression;


  data.buffer.push("<div class=\"toolbar\">\n  ");
  data.buffer.push(escapeExpression((helper = helpers['clear-button'] || (depth0 && depth0['clear-button']),options={hash:{
    'action': ("clearProfiles"),
    'classNames': ("toolbar__icon-button")
  },hashTypes:{'action': "STRING",'classNames': "STRING"},hashContexts:{'action': depth0,'classNames': depth0},contexts:[],types:[],data:data},helper ? helper.call(depth0, options) : helperMissing.call(depth0, "clear-button", options))));
  data.buffer.push("\n  <div class=\"toolbar__search\" data-label=\"render-profiles-search\">\n    ");
  data.buffer.push(escapeExpression((helper = helpers.input || (depth0 && depth0.input),options={hash:{
    'value': ("searchField"),
    'placeholder': ("Search")
  },hashTypes:{'value': "ID",'placeholder': "STRING"},hashContexts:{'value': depth0,'placeholder': depth0},contexts:[],types:[],data:data},helper ? helper.call(depth0, options) : helperMissing.call(depth0, "input", options))));
  data.buffer.push("\n  </div>\n  <div class=\"filter-bar__pills\"></div>\n</div>");
  return buffer;
  
}); });

define('templates/route_item', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  var buffer = '', stack1, helper, options, escapeExpression=this.escapeExpression, helperMissing=helpers.helperMissing, self=this;

function program1(depth0,data) {
  
  var buffer = '', stack1, helper, options;
  data.buffer.push("\n      <div class=\"list-tree__limited cell_clickable\" ");
  data.buffer.push(escapeExpression(helpers.action.call(depth0, "inspectController", "value.controller", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0,depth0],types:["STRING","ID"],data:data})));
  data.buffer.push(" data-label=\"route-controller\">\n        <span title=\"");
  data.buffer.push(escapeExpression(helpers.unbound.call(depth0, "value.controller.className", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data})));
  data.buffer.push("\">");
  stack1 = helpers._triageMustache.call(depth0, "value.controller.className", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("</span>\n      </div>\n      <div class=\"list-tree__right-helper\">\n        ");
  data.buffer.push(escapeExpression((helper = helpers['send-to-console'] || (depth0 && depth0['send-to-console']),options={hash:{
    'action': ("sendControllerToConsole"),
    'param': ("value.controller.name")
  },hashTypes:{'action': "STRING",'param': "ID"},hashContexts:{'action': depth0,'param': depth0},contexts:[],types:[],data:data},helper ? helper.call(depth0, options) : helperMissing.call(depth0, "send-to-console", options))));
  data.buffer.push("\n      </div>\n\n    ");
  return buffer;
  }

function program3(depth0,data) {
  
  var buffer = '', stack1;
  data.buffer.push("\n      <div data-label=\"route-controller\">\n        <span title=\"");
  data.buffer.push(escapeExpression(helpers.unbound.call(depth0, "value.controller.className", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data})));
  data.buffer.push("\">");
  stack1 = helpers._triageMustache.call(depth0, "value.controller.className", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("</span>\n      </div>\n    ");
  return buffer;
  }

  data.buffer.push("<div ");
  data.buffer.push(escapeExpression(helpers['bind-attr'].call(depth0, {hash:{
    'class': (":list-tree__item :row isCurrent:row_highlight")
  },hashTypes:{'class': "STRING"},hashContexts:{'class': depth0},contexts:[],types:[],data:data})));
  data.buffer.push(" data-label=\"route-node\">\n  <div class=\"cell_type_main cell\" data-label=\"route-name\">\n    <div ");
  data.buffer.push(escapeExpression(helpers['bind-attr'].call(depth0, {hash:{
    'style': ("labelStyle")
  },hashTypes:{'style': "STRING"},hashContexts:{'style': depth0},contexts:[],types:[],data:data})));
  data.buffer.push(">\n      <span title=\"");
  data.buffer.push(escapeExpression(helpers.unbound.call(depth0, "value.name", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data})));
  data.buffer.push("\" data-label=\"view-name\">");
  stack1 = helpers._triageMustache.call(depth0, "value.name", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("</span>\n    </div>\n  </div>\n  <div class=\"cell\">\n    <div class=\"list-tree__limited cell_clickable\" ");
  data.buffer.push(escapeExpression(helpers.action.call(depth0, "inspectRoute", "value.routeHandler.name", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0,depth0],types:["STRING","ID"],data:data})));
  data.buffer.push(" data-label=\"route-handler\">\n      <span title=\"");
  data.buffer.push(escapeExpression(helpers.unbound.call(depth0, "value.routeHandler.className", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data})));
  data.buffer.push("\">");
  stack1 = helpers._triageMustache.call(depth0, "value.routeHandler.className", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("</span>\n    </div>\n    <div class=\"list-tree__right-helper\">\n      ");
  data.buffer.push(escapeExpression((helper = helpers['send-to-console'] || (depth0 && depth0['send-to-console']),options={hash:{
    'action': ("sendRouteHandlerToConsole"),
    'param': ("value.routeHandler.name")
  },hashTypes:{'action': "STRING",'param': "ID"},hashContexts:{'action': depth0,'param': depth0},contexts:[],types:[],data:data},helper ? helper.call(depth0, options) : helperMissing.call(depth0, "send-to-console", options))));
  data.buffer.push("\n    </div>\n  </div>\n  <div class=\"cell\">\n    ");
  stack1 = helpers['if'].call(depth0, "value.controller.exists", {hash:{},hashTypes:{},hashContexts:{},inverse:self.program(3, program3, data),fn:self.program(1, program1, data),contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n  </div>\n  <div class=\"cell\" data-label=\"route-template\">\n    <span title=\"");
  data.buffer.push(escapeExpression(helpers.unbound.call(depth0, "value.template.name", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data})));
  data.buffer.push("\">");
  stack1 = helpers._triageMustache.call(depth0, "value.template.name", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("</span>\n  </div>\n  <div class=\"cell cell_size_large\" data-label=\"route-url\">\n    <span title=\"");
  data.buffer.push(escapeExpression(helpers.unbound.call(depth0, "value.url", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data})));
  data.buffer.push("\">");
  stack1 = helpers._triageMustache.call(depth0, "value.url", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("</span>\n  </div>\n\n</div>\n");
  return buffer;
  
}); });

define('templates/route_tree', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  var buffer = '', escapeExpression=this.escapeExpression;


  data.buffer.push("<div class=\"list-view\">\n  <div class=\"list-view__header row\">\n    <div class=\"cell cell_type_header\">\n      Route Name\n    </div>\n    <div class=\"cell cell_type_header\">\n      Route\n    </div>\n    <div class=\"cell cell_type_header\">\n      Controller\n    </div>\n    <div class=\"cell cell_type_header\">\n      Template\n    </div>\n    <div class=\"cell cell_type_header cell_size_large\">\n      URL\n    </div>\n    <!-- Account for scrollbar width :'(  -->\n    <div class=\"cell cell_type_header spacer\"></div>\n  </div>\n\n  <div class=\"list-view__list-container\">\n    ");
  data.buffer.push(escapeExpression(helpers.view.call(depth0, "routeList", {hash:{
    'content': ("")
  },hashTypes:{'content': "ID"},hashContexts:{'content': depth0},contexts:[depth0],types:["STRING"],data:data})));
  data.buffer.push("\n  </div>\n</div>\n");
  return buffer;
  
}); });

define('templates/route_tree_toolbar', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  var buffer = '', helper, options, helperMissing=helpers.helperMissing, escapeExpression=this.escapeExpression;


  data.buffer.push("<div class=\"toolbar\">\n  <div class=\"toolbar__checkbox\" data-label=\"filter-hide-routes\">\n    ");
  data.buffer.push(escapeExpression((helper = helpers.input || (depth0 && depth0.input),options={hash:{
    'type': ("checkbox"),
    'checked': ("options.hideRoutes"),
    'id': ("options-hideRoutes")
  },hashTypes:{'type': "STRING",'checked': "ID",'id': "STRING"},hashContexts:{'type': depth0,'checked': depth0,'id': depth0},contexts:[],types:[],data:data},helper ? helper.call(depth0, options) : helperMissing.call(depth0, "input", options))));
  data.buffer.push(" <label for=\"options-hideRoutes\">Current Route only</label>\n  </div>\n</div>");
  return buffer;
  
}); });

define('templates/view_item', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  var buffer = '', stack1, helper, options, escapeExpression=this.escapeExpression, helperMissing=helpers.helperMissing, self=this;

function program1(depth0,data) {
  
  var buffer = '', helper, options;
  data.buffer.push("\n      <div ");
  data.buffer.push(escapeExpression(helpers['bind-attr'].call(depth0, {hash:{
    'class': (":list-tree__limited modelInspectable:cell_clickable")
  },hashTypes:{'class': "STRING"},hashContexts:{'class': depth0},contexts:[],types:[],data:data})));
  data.buffer.push(" ");
  data.buffer.push(escapeExpression(helpers.action.call(depth0, "inspectModel", "value.model.objectId", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0,depth0],types:["STRING","ID"],data:data})));
  data.buffer.push(">\n        <span title=\"");
  data.buffer.push(escapeExpression(helpers.unbound.call(depth0, "value.model.completeName", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data})));
  data.buffer.push("\">");
  data.buffer.push(escapeExpression(helpers.unbound.call(depth0, "value.model.name", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data})));
  data.buffer.push("</span>\n      </div>\n      <div class=\"list-tree__right-helper\">\n        ");
  data.buffer.push(escapeExpression((helper = helpers['send-to-console'] || (depth0 && depth0['send-to-console']),options={hash:{
    'action': ("sendModelToConsole"),
    'param': ("value.objectId")
  },hashTypes:{'action': "STRING",'param': "ID"},hashContexts:{'action': depth0,'param': depth0},contexts:[],types:[],data:data},helper ? helper.call(depth0, options) : helperMissing.call(depth0, "send-to-console", options))));
  data.buffer.push("\n      </div>\n    ");
  return buffer;
  }

function program3(depth0,data) {
  
  
  data.buffer.push("\n      --\n    ");
  }

function program5(depth0,data) {
  
  var buffer = '', helper, options;
  data.buffer.push("\n      <div ");
  data.buffer.push(escapeExpression(helpers['bind-attr'].call(depth0, {hash:{
    'class': (":list-tree__limited hasController:cell_clickable")
  },hashTypes:{'class': "STRING"},hashContexts:{'class': depth0},contexts:[],types:[],data:data})));
  data.buffer.push(" ");
  data.buffer.push(escapeExpression(helpers.action.call(depth0, "inspect", "value.controller.objectId", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0,depth0],types:["STRING","ID"],data:data})));
  data.buffer.push(" >\n        <span title=\"");
  data.buffer.push(escapeExpression(helpers.unbound.call(depth0, "value.controller.completeName", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data})));
  data.buffer.push("\">");
  data.buffer.push(escapeExpression(helpers.unbound.call(depth0, "value.controller.name", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data})));
  data.buffer.push("</span>\n      </div>\n      <div class=\"list-tree__right-helper\">\n        ");
  data.buffer.push(escapeExpression((helper = helpers['send-to-console'] || (depth0 && depth0['send-to-console']),options={hash:{
    'action': ("sendObjectToConsole"),
    'param': ("value.controller.objectId")
  },hashTypes:{'action': "STRING",'param': "ID"},hashContexts:{'action': depth0,'param': depth0},contexts:[],types:[],data:data},helper ? helper.call(depth0, options) : helperMissing.call(depth0, "send-to-console", options))));
  data.buffer.push("\n      </div>\n    ");
  return buffer;
  }

function program7(depth0,data) {
  
  var buffer = '', helper, options;
  data.buffer.push("\n      <div ");
  data.buffer.push(escapeExpression(helpers['bind-attr'].call(depth0, {hash:{
    'class': (":list-tree__limited hasView:cell_clickable")
  },hashTypes:{'class': "STRING"},hashContexts:{'class': depth0},contexts:[],types:[],data:data})));
  data.buffer.push(" ");
  data.buffer.push(escapeExpression(helpers.action.call(depth0, "inspectView", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["STRING"],data:data})));
  data.buffer.push(" >\n        <span title=\"");
  data.buffer.push(escapeExpression(helpers.unbound.call(depth0, "value.completeViewClass", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data})));
  data.buffer.push("\">");
  data.buffer.push(escapeExpression(helpers.unbound.call(depth0, "value.viewClass", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data})));
  data.buffer.push("</span>\n      </div>\n      <div class=\"list-tree__right-helper\">\n        ");
  data.buffer.push(escapeExpression((helper = helpers['send-to-console'] || (depth0 && depth0['send-to-console']),options={hash:{
    'action': ("sendObjectToConsole"),
    'param': ("value.objectId")
  },hashTypes:{'action': "STRING",'param': "ID"},hashContexts:{'action': depth0,'param': depth0},contexts:[],types:[],data:data},helper ? helper.call(depth0, options) : helperMissing.call(depth0, "send-to-console", options))));
  data.buffer.push("\n      </div>\n    ");
  return buffer;
  }

  data.buffer.push("<div ");
  data.buffer.push(escapeExpression(helpers['bind-attr'].call(depth0, {hash:{
    'class': (":list-tree__item :row isCurrent:row_highlight")
  },hashTypes:{'class': "STRING"},hashContexts:{'class': depth0},contexts:[],types:[],data:data})));
  data.buffer.push(" >\n  <div class=\"cell_type_main cell\" >\n    <div ");
  data.buffer.push(escapeExpression(helpers['bind-attr'].call(depth0, {hash:{
    'style': ("labelStyle")
  },hashTypes:{'style': "STRING"},hashContexts:{'style': depth0},contexts:[],types:[],data:data})));
  data.buffer.push(">\n      <span ");
  data.buffer.push(escapeExpression(helpers['bind-attr'].call(depth0, {hash:{
    'title': ("value.name")
  },hashTypes:{'title': "STRING"},hashContexts:{'title': depth0},contexts:[],types:[],data:data})));
  data.buffer.push(" data-label=\"view-name\">");
  data.buffer.push(escapeExpression(helpers.unbound.call(depth0, "value.name", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data})));
  data.buffer.push("</span>\n    </div>\n  </div>\n\n  <div ");
  data.buffer.push(escapeExpression(helpers['bind-attr'].call(depth0, {hash:{
    'class': (":cell hasElement:cell_clickable")
  },hashTypes:{'class': "STRING"},hashContexts:{'class': depth0},contexts:[],types:[],data:data})));
  data.buffer.push(" ");
  data.buffer.push(escapeExpression(helpers.action.call(depth0, "inspectElement", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["STRING"],data:data})));
  data.buffer.push(" data-label=\"view-template\">\n    <span title=\"");
  data.buffer.push(escapeExpression(helpers.unbound.call(depth0, "value.template", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data})));
  data.buffer.push("\">");
  data.buffer.push(escapeExpression(helpers.unbound.call(depth0, "value.template", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data})));
  data.buffer.push("</span>\n  </div>\n  <div ");
  data.buffer.push(escapeExpression(helpers['bind-attr'].call(depth0, {hash:{
    'class': (":cell")
  },hashTypes:{'class': "STRING"},hashContexts:{'class': depth0},contexts:[],types:[],data:data})));
  data.buffer.push(" data-label=\"view-model\">\n    ");
  stack1 = helpers['if'].call(depth0, "hasModel", {hash:{},hashTypes:{},hashContexts:{},inverse:self.program(3, program3, data),fn:self.program(1, program1, data),contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n  </div>\n  <div ");
  data.buffer.push(escapeExpression(helpers['bind-attr'].call(depth0, {hash:{
    'class': (":cell")
  },hashTypes:{'class': "STRING"},hashContexts:{'class': depth0},contexts:[],types:[],data:data})));
  data.buffer.push(" data-label=\"view-controller\">\n    ");
  stack1 = helpers['if'].call(depth0, "hasController", {hash:{},hashTypes:{},hashContexts:{},inverse:self.noop,fn:self.program(5, program5, data),contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n  </div>\n  <div ");
  data.buffer.push(escapeExpression(helpers['bind-attr'].call(depth0, {hash:{
    'class': (":cell")
  },hashTypes:{'class': "STRING"},hashContexts:{'class': depth0},contexts:[],types:[],data:data})));
  data.buffer.push(" data-label=\"view-class\">\n    ");
  stack1 = helpers['if'].call(depth0, "hasView", {hash:{},hashTypes:{},hashContexts:{},inverse:self.program(3, program3, data),fn:self.program(7, program7, data),contexts:[depth0],types:["ID"],data:data});
  if(stack1 || stack1 === 0) { data.buffer.push(stack1); }
  data.buffer.push("\n  </div>\n\n  <div class=\"cell cell_size_small cell_value_numeric\" >\n    <span class=\"pill pill_not-clickable pill_size_small\" data-label=\"view-duration\">");
  data.buffer.push(escapeExpression((helper = helpers['ms-to-time'] || (depth0 && depth0['ms-to-time']),options={hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["ID"],data:data},helper ? helper.call(depth0, "value.duration", options) : helperMissing.call(depth0, "ms-to-time", "value.duration", options))));
  data.buffer.push("</span>\n  </div>\n</div>\n");
  return buffer;
  
}); });

define('templates/view_tree', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  var buffer = '', escapeExpression=this.escapeExpression;


  data.buffer.push("<div class=\"list-view\">\n  <div class=\"list-view__header row\">\n    <div class=\"cell cell_type_header\">\n      Name\n    </div>\n    <div class=\"cell cell_type_header\">\n      Template\n    </div>\n    <div class=\"cell cell_type_header\">\n      Model\n    </div>\n    <div class=\"cell cell_type_header\">\n      Controller\n    </div>\n    <div class=\"cell cell_type_header\">\n      View / Component\n    </div>\n    <div class=\"cell cell_size_small cell_value_numeric cell_type_header\">\n      Duration\n    </div>\n    <!-- Account for scrollbar width :'(  -->\n    <div class=\"cell cell_type_header spacer\"></div>\n  </div>\n\n  <div class=\"list-view__list-container\">\n    ");
  data.buffer.push(escapeExpression(helpers.view.call(depth0, "viewList", {hash:{
    'content': ("")
  },hashTypes:{'content': "ID"},hashContexts:{'content': depth0},contexts:[depth0],types:["STRING"],data:data})));
  data.buffer.push("\n  </div>\n</div>\n");
  return buffer;
  
}); });

define('templates/view_tree_toolbar', ['exports'], function(__exports__){ __exports__['default'] = Ember.Handlebars.template(function anonymous(Handlebars,depth0,helpers,partials,data) {
this.compilerInfo = [4,'>= 1.0.0'];
helpers = this.merge(helpers, Ember.Handlebars.helpers); data = data || {};
  var buffer = '', helper, options, escapeExpression=this.escapeExpression, helperMissing=helpers.helperMissing;


  data.buffer.push("<div class=\"toolbar\">\n  <button ");
  data.buffer.push(escapeExpression(helpers['bind-attr'].call(depth0, {hash:{
    'class': ("inspectingViews:active :toolbar__icon-button")
  },hashTypes:{'class': "STRING"},hashContexts:{'class': depth0},contexts:[],types:[],data:data})));
  data.buffer.push(" ");
  data.buffer.push(escapeExpression(helpers.action.call(depth0, "toggleViewInspection", {hash:{},hashTypes:{},hashContexts:{},contexts:[depth0],types:["STRING"],data:data})));
  data.buffer.push(" data-label=\"inspect-views\">\n    <svg width=\"16px\" height=\"16px\" viewBox=\"0 0 16 16\" version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\">\n      <g class=\"svg-stroke\" transform=\"translate(3.000000, 4.000000)\" stroke=\"#000000\" stroke-width=\"2\" fill=\"none\"  fill-rule=\"evenodd\">\n        <path d=\"M7.5,7.5 L10.5,10.5\" stroke-linecap=\"square\"></path>\n        <circle cx=\"4\" cy=\"4\" r=\"4\"></circle>\n      </g>\n    </svg>\n  </button>\n\n  <div class=\"divider\"></div>\n\n  <div class=\"toolbar__checkbox\" data-label=\"filter-components\">\n    ");
  data.buffer.push(escapeExpression((helper = helpers.input || (depth0 && depth0.input),options={hash:{
    'type': ("checkbox"),
    'checked': ("options.components"),
    'id': ("options-components")
  },hashTypes:{'type': "STRING",'checked': "ID",'id': "STRING"},hashContexts:{'type': depth0,'checked': depth0,'id': depth0},contexts:[],types:[],data:data},helper ? helper.call(depth0, options) : helperMissing.call(depth0, "input", options))));
  data.buffer.push(" <label for=\"options-components\">Components</label>\n  </div>\n\n  <div class=\"toolbar__checkbox\" data-label=\"filter-all-views\">\n    ");
  data.buffer.push(escapeExpression((helper = helpers.input || (depth0 && depth0.input),options={hash:{
    'type': ("checkbox"),
    'checked': ("options.allViews"),
    'id': ("options-allViews")
  },hashTypes:{'type': "STRING",'checked': "ID",'id': "STRING"},hashContexts:{'type': depth0,'checked': depth0,'id': depth0},contexts:[],types:[],data:data},helper ? helper.call(depth0, options) : helperMissing.call(depth0, "input", options))));
  data.buffer.push(" <label for=\"options-allViews\">All Views</label>\n  </div>\n</div>\n");
  return buffer;
  
}); });
define("utils/check_current_route", 
  ["exports"],
  function(__exports__) {
    "use strict";
    __exports__["default"] = function(currentRouteName, routeName) {
      var regName, match;

      if (routeName === 'application') {
        return true;
      }

      regName = routeName.replace('.', '\\.');
      match = currentRouteName.match(new RegExp('(^|\\.)' + regName + '(\\.|$)'));
      if (match && match[0].match(/^\.[^.]+$/)) {
        match = false;
      }
      return !!match;
    };
  });
define("utils/escape_reg_exp", 
  ["exports"],
  function(__exports__) {
    "use strict";
    __exports__["default"] = function(str) {
      return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
    };
  });
define("utils/search_match", 
  ["utils/escape_reg_exp","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var escapeRegExp = __dependency1__["default"];
    var isEmpty = Ember.isEmpty;

    __exports__["default"] = function(text, searchQuery) {
      if (isEmpty(searchQuery)) {
        return true;
      }
      var regExp = new RegExp(escapeRegExp(searchQuery.toLowerCase()));
      return !!text.toLowerCase().match(regExp);
    };
  });
define("views/application", 
  ["exports"],
  function(__exports__) {
    "use strict";
    __exports__["default"] = Ember.View.extend({
      classNames: ['app'],

      classNameBindings: [
        'inactive',
        'controller.isDragging'
      ],

      inactive: Ember.computed.not('controller.active'),

      attributeBindings: ['tabindex'],
      tabindex: 1,

      height: Ember.computed.alias('controller.height'),

      didInsertElement: function() {
        this._super();

        Ember.$(window).on('resize.application-view-' + this.get('elementId'), function() {
          Ember.run.debounce(this, 'updateHeight', 200);
        }.bind(this));
        this.updateHeight();
      },

      updateHeight: function() {
        // could be destroyed but with debounce pending
        if (this.$()) {
          this.set('height', this.$().height());
        }
      },

      willDestroyElement: function() {
        Ember.$(window).off('.application-view-' + this.get('elementId'));
      },

      focusIn: function() {
        if (!this.get('controller.active')) {
          this.set('controller.active', true);
        }
      },

      focusOut: function() {
        if (this.get('controller.active')) {
          this.set('controller.active', false);
        }
      }
    });
  });
define("views/container_type", 
  ["mixins/fake_table","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var FakeTableMixin = __dependency1__["default"];

    __exports__["default"] = Ember.View.extend(FakeTableMixin);
  });
define("views/instance_list", 
  ["views/list","views/list_item","exports"],
  function(__dependency1__, __dependency2__, __exports__) {
    "use strict";
    var ListView = __dependency1__["default"];
    var ListItemView = __dependency2__["default"];

    __exports__["default"] = ListView.extend({
      itemViewClass:  ListItemView.extend({
        templateName: "instance_item"
      })

    });
  });
define("views/list", 
  ["views/list_item","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var ListItemView = __dependency1__["default"];

    __exports__["default"] = Ember.ListView.extend({
      classNames: ["list-tree"],

      contentHeight: Ember.computed.alias('controller.controllers.application.contentHeight'),

      height: function() {
        var headerHeight = 31,
            contentHeight = this.get('contentHeight');

        // In testing list-view is created before `contentHeight` is set
        // which will trigger an exception
        if (!contentHeight) {
          return 1;
        }
        return contentHeight  - headerHeight;
      }.property('contentHeight'),
      rowHeight: 30,
      itemViewClass: ListItemView
    });
  });
define("views/list_item", 
  ["exports"],
  function(__exports__) {
    "use strict";
    __exports__["default"] = Ember.ListItemView.extend({
      classNames: ["list-tree__item-wrapper", "row-wrapper"]
    });
  });
define("views/main_content", 
  ["exports"],
  function(__exports__) {
    "use strict";
    // Currently used to determine the height of list-views
    __exports__["default"] = Ember.View.extend({
      height: Ember.computed.alias('controller.contentHeight'),

      didInsertElement: function() {
        this._super();

        Ember.$(window).on('resize.view-' + this.get('elementId'), function() {
          Ember.run.debounce(this, 'updateHeight', 200);
        }.bind(this));
        this.updateHeight();
      },

      updateHeight: function() {
        // could be destroyed but with debounce pending
        if (this.$()) {
          this.set('height', this.$().height());
        }
      },

      willDestroyElement: function() {
        Ember.$(window).off('.view-' + this.get('elementId'));
      },
    });
  });
define("views/promise_list", 
  ["views/list","views/list_item","exports"],
  function(__dependency1__, __dependency2__, __exports__) {
    "use strict";
    var ListView = __dependency1__["default"];
    var ListItemView = __dependency2__["default"];

    __exports__["default"] = ListView.extend({
      itemViewClass:  ListItemView.extend({
        templateName: "promise_item"
      })

    });
  });
define("views/promise_tree", 
  ["mixins/fake_table","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var FakeTableMixin = __dependency1__["default"];

    __exports__["default"] = Ember.View.extend(FakeTableMixin);
  });
define("views/record_list", 
  ["views/list","views/list_item","exports"],
  function(__dependency1__, __dependency2__, __exports__) {
    "use strict";
    var ListView = __dependency1__["default"];
    var ListItemView = __dependency2__["default"];

    __exports__["default"] = ListView.extend({
      itemViewClass:  ListItemView.extend({
        templateName: "record_item"
      })

    });
  });
define("views/records", 
  ["mixins/fake_table","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var FakeTableMixin = __dependency1__["default"];

    __exports__["default"] = Ember.View.extend(FakeTableMixin);
  });
define("views/render_list", 
  ["exports"],
  function(__exports__) {
    "use strict";
    var View = Ember.View;
    __exports__["default"] = View.extend({
      attributeBindings: ['style'],

      classNames: ["list-tree", "list-tree_scrollable"],

      style: function() {
        return 'height:' + this.get('height') + 'px';
      }.property('height'),

      contentHeight: Ember.computed.alias('controller.controllers.application.contentHeight'),

      filterHeight: 22,

      height: function() {
        var filterHeight = this.get('filterHeight'),
            headerHeight = 30,
            contentHeight = this.get('contentHeight');

        // In testing list-view is created before `contentHeight` is set
        // which will trigger an exception
        if (!contentHeight) {
          return 1;
        }
        return contentHeight - filterHeight - headerHeight;
      }.property('contentHeight')
    });
  });
define("views/render_tree", 
  ["mixins/fake_table","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var FakeTableMixin = __dependency1__["default"];

    __exports__["default"] = Ember.View.extend(FakeTableMixin);
  });
define("views/route_list", 
  ["views/list","views/list_item","exports"],
  function(__dependency1__, __dependency2__, __exports__) {
    "use strict";
    var ListView = __dependency1__["default"];
    var ListItemView = __dependency2__["default"];

    __exports__["default"] = ListView.extend({
      itemViewClass:  ListItemView.extend({
        templateName: "route_item"
      })
    });
  });
define("views/route_tree", 
  ["mixins/fake_table","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var FakeTableMixin = __dependency1__["default"];

    __exports__["default"] = Ember.View.extend(FakeTableMixin);
  });
define("views/view_list", 
  ["views/list","views/list_item","exports"],
  function(__dependency1__, __dependency2__, __exports__) {
    "use strict";
    var ListView = __dependency1__["default"];
    var ListItemView = __dependency2__["default"];

    __exports__["default"] = ListView.extend({
      itemViewClass: ListItemView.extend({
        templateName: "view_item",
        classNameBindings: 'isPinned',
        node: Ember.computed.alias('controller.model'),
        // for testing
        attributeBindings: ['data-label:label'],
        label: 'tree-node',

        isPinned: function() {
          return this.get('node') === this.get('controller.pinnedNode');
        }.property('node', 'controller.pinnedNode'),

        mouseEnter: function(e) {
          this.get('controller').send('previewLayer', this.get('node'));
          e.stopPropagation();
        },

        mouseLeave: function(e) {
          this.get('controller').send('hidePreview', this.get('node'));
          e.stopPropagation();
        }
      })
    });
  });
define("views/view_tree", 
  ["mixins/fake_table","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var FakeTableMixin = __dependency1__["default"];

    __exports__["default"] = Ember.View.extend(FakeTableMixin);
  });