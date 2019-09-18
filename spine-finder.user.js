// ==UserScript==
// @id             iitc-plugin-spiner-finder@nobody889
// @name           IITC plugin: Spine Finder
// @category       Info
// @version        0.1.0
// @namespace      https://github.com/lithium/iitc-plugin-spine-finder
// @updateURL      @@UPDATEURL@@
// @downloadURL    @@DOWNLOADURL@@
// @description    [@@BUILDNAME@@-@@BUILDDATE@@] Build plans with drawtools
// @include        https://*.ingress.com/intel*
// @include        http://*.ingress.com/intel*
// @match          https://*.ingress.com/intel*
// @match          http://*.ingress.com/intel*
// @include        https://*.ingress.com/mission/*
// @include        http://*.ingress.com/mission/*
// @match          https://*.ingress.com/mission/*
// @match          http://*.ingress.com/mission/*
// @grant          none
// ==/UserScript==


function wrapper(plugin_info) {
// ensure plugin framework is there, even if iitc is not yet loaded
if(typeof window.plugin !== 'function') window.plugin = function() {};
// PLUGIN START ////////////////////////////////////////////////////////


/*
 * global utility functions
 */

var llstring = function(latlng) {
  if (typeof latlng.lat != 'undefined' && typeof latlng.lng != 'undefined')
  {
      return latlng.lat.toFixed(6) + ',' + latlng.lng.toFixed(6);
  }
}


/*
 * abstract class UIComponent
      react-esque render() and setState()
      this.render() should be pure (no side effects) and return a Node
      this.state should be considered immutable except via setState()
 */
class UIComponent {
  constructor(properties) {
    this.props = Object.assign(this.constructor.defaultProps(), properties)
    this.state = this.constructor.initialState()
    this.mount();
  }

  static initialState() {
    return {}
  }

  static defaultProps() {
    return {}
  }

  mount(el) {
    this.element = el || document.createElement('div') 
    this.update()
  }

  setState(newState) {
    Object.assign(this.state, newState)
    this.update()
  }

  update() {
    this.element.innerHTML = "";
    this.element.appendChild(this.render());
  }
}


/*
 * SpineFinderPlugin 
 *    
 */

class SpineFinderPlugin extends UIComponent {
  constructor(props) {
    super(props)

    this.setupDesktop();
    this.setupMobile();
  }

  setupDesktop() {
    var a = $('<a tabindex="0">Spine Finder</a>').click(this.showDialog.bind(this));
    $('#toolbox').append(a);
  }


  setupMobile() {
    if (window.useAndroidPanes()) {
      this.mobilePane = document.createElement('div');
      this.mobilePane.className = 'plugin-spinefinder-pane';
      this.mobilePane.appendChild(this.element)

      var button = this.mobilePane.appendChild(document.createElement('button'));
      button.textContext = 'Spine Finder';
      button.addEventListener('click', function(){ this.showDialog(); }.bind(this), false);

      this.tabs = this.mobilePane.appendChild(document.createElement('div'));
      this.tabBar = this.tabs.appendChild(document.createElement('ul'));
      this.tabHeaders = {};
      this.tabMarkers = {};
      
      $(this.tabs)
        .tabs({
          activate: function(event, ui) {
            if(!ui.newTab) return;
            
            var header = $(ui.newTab)[0];
            var id = header.dataset['plan_id'];
          }.bind(this),
        })
        .find('.ui-tabs-nav').sortable({
          axis: 'x',
          stop: function() {
            $(this.tabs).tabs('refresh');
          },
        });
      
      android.addPane('plugin-spinefinder', 'Spine Finder', 'ic_spinefinder');
      addHook('paneChanged', this.handlePaneChanged.bind(this));
    }
  }

  handlePaneChanged(pane) {
    if(pane == 'plugin-spinefinder') {
      document.body.appendChild(this.mobilePane);
    } else if(this.mobilePane.parentNode) {
      this.mobilePane.parentNode.removeChild(this.mobilePane);
    }
  }

  showDialog() {
    if (this.dialog) {
      return;
    }

    this.dialog = dialog({
      title: "Spine Finder",
      html: this.element,
      height: 'auto',
      width: '400px',
      closeCallback: () => this.dialog = undefined
    }).dialog('option', 'buttons', {
      'OK': function() { $(this).dialog('close') },
    });

  }

  render() {
    var ret = document.createElement('div')

    ret.innerHTML = "spine finder..."

    return ret
  }


}

// plugin boot - called by iitc
SpineFinderPlugin.boot = function() {
  window.plugin.spinefinder = new SpineFinderPlugin()
}



// PLUGIN END //////////////////////////////////////////////////////////
var setup = SpineFinderPlugin.boot;

setup.info = plugin_info; //add the script info data to the function as a property
if(!window.bootPlugins) window.bootPlugins = [];
window.bootPlugins.push(setup);
// if IITC has already booted, immediately run the 'setup' function
if(window.iitcLoaded && typeof setup === 'function') setup();
} // wrapper end
// inject code into site context
var script = document.createElement('script');
var info = {};
if (typeof GM_info !== 'undefined' && GM_info && GM_info.script) info.script = { version: GM_info.script.version, name: GM_info.script.name, description: GM_info.script.description };
script.appendChild(document.createTextNode('('+ wrapper +')('+JSON.stringify(info)+');'));
(document.body || document.head || document.documentElement).appendChild(script);
