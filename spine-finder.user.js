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

var drawToolsLayerToJson = function(layer) {
  if (layer._mRadius !== undefined) {
    return {
      type: "circle",
      latLng: layer._latlng,
      radius: layer._mRadius,
      color: layer.options.color
    }
  }
  else if (layer._latlngs.length == 2) {
    return {
      type: "polyline", 
      latLngs: layer._latlngs,
      color: layer.options.color
    }
  }
  else if (layer._latlngs.length > 2) {
    return {
      type: "polygon",
      latLngs: layer._latlngs,
      color: layer.options.color
    }
  }
  return layer
}

/*
https://stackoverflow.com/questions/31790344/determine-if-a-point-reside-inside-a-leaflet-polygon
*/
function isMarkerInsidePolygon(marker, poly) {
    var polyPoints = poly.getLatLngs();       
    var x = marker.getLatLng().lat, y = marker.getLatLng().lng;

    var inside = false;
    for (var i = 0, j = polyPoints.length - 1; i < polyPoints.length; j = i++) {
        var xi = polyPoints[i].lat, yi = polyPoints[i].lng;
        var xj = polyPoints[j].lat, yj = polyPoints[j].lng;

        var intersect = ((yi > y) != (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }

    return inside;
};

function flattenDeep(array) {
  var flattend = [];
  (function flat(array) {
    array.forEach(function(el) {
      if (Array.isArray(el)) flat(el);
      else flattend.push(el);
    });
  })(array);
  return flattend;
}

function doLinksCross(existingLinks, newLinks) {
    return existingLinks.map(e => 
      newLinks.map(n => window.plugin.crossLinks.testPolyLine(e, n))
    ).flat().filter(_ => _ === true).length > 0
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



class Spine {
  constructor(layer) {
    this.layer = layer
  }

  get label() {
    var src = SpineFinderPlugin.portalNameByLl(this.layer.latLngs[0])
    var dest = SpineFinderPlugin.portalNameByLl(this.layer.latLngs[1])
    return `${src} <-> ${dest}`
  }

  get portals() {
    if (window.portals) {
      return this.layer.latLngs.map(ll => SpineFinderPlugin.portalByLl(ll))
    } else return []
  }

  get polyline() {
    return L.polyline(this.layer.latLngs)
  }
}

class SearchArea {
  constructor(circle) {
    this.region = circle
  }

  get areaInKm() {
    return (Math.PI * Math.pow(this.region.radius, 2)) / 1000 / 1000
  }

  get label() {
    return `${this.portals.length} Portals ${this.areaInKm.toFixed(1)}km @${llstring(this.region.latLng)}`
  }

  get portals() {
    if (window.portals) {
      return Object.getOwnPropertyNames(window.portals).map(guid => {
        var portal = window.portals[guid];
        var distance = portal._latlng.distanceTo(this.region.latLng)
        if (distance < this.region.radius) {
          return portal
        } else return undefined
      }).filter(_ => _ !== undefined)
    }
    else return []
  }
}

class TreeNode {
  constructor(options) {
    this.spine = options.spine
    this.parent = options.parent
    this.portal = options.portal
    this.children = options.children || []
  }

  getParentLinks() {
    return (this.parent ? this.parent.getParentLinks() : []).concat(this.getLinks())
  }
  getPlanPortals() {
    return (this.parent ? this.parent.getPlanPortals() : []).concat(this.portal ? [this.portal] : [])
  }

  getLinks() {
    return this.portal ? [
      L.geodesicPolyline([this.spine.portals[0]._latlng, this.portal._latlng]),
      L.geodesicPolyline([this.spine.portals[1]._latlng, this.portal._latlng]),
    ] : []
  }

  getPlans() {
    var results = this.findLeafNodes()
    var plans = results.map(r => r.getPlanPortals())
    return plans.sort((a,b) => b.length - a.length) // sort by number of fields
  }

  findLeafNodes(results) {
    var results = results || []
    if (this.children && this.children.length > 0) {
      this.children.forEach(c => c.findLeafNodes(results))
    } else {
      results.push(this)
    }
    return results
  }

  static create(spine, portals, parent, portal) {
    var node = new TreeNode({spine: spine, parent: parent, portal: portal})
    node.children = portals.map(p => {
      var newLinks = [
        L.geodesicPolyline([spine.portals[0]._latlng, p._latlng]),
        L.geodesicPolyline([spine.portals[1]._latlng, p._latlng]),
      ]
      if (!doLinksCross(node.getParentLinks(), newLinks)) {
        var poly = L.geodesicPolygon([
          spine.portals[0]._latlng,
          spine.portals[1]._latlng,
          p._latlng
        ])
        var possiblePortals = portals.filter(x => 
          isMarkerInsidePolygon(x, poly)
        )
        return TreeNode.create(spine, possiblePortals, node, p)
      } else return undefined
    }).filter(_ => _ !== undefined)
    return node
  }
}

/*
 * SpineFinderPlugin 
 *    
 */

class SpineFinderPlugin extends UIComponent {
  constructor(props) {
    super(props)

    SpineFinderPlugin.portalsLl = {};
    window.addHook('portalAdded', this.handlePortalAdded.bind(this));
    window.pluginCreateHook('pluginDrawTools'); // initialize hook if needed first
    window.addHook('pluginDrawTools', this.handleDrawTools.bind(this));

    this.loadDrawTools();

    this.setupDesktop();
    this.setupMobile();
  }

  static initialState() {
    return {
      spines: [],
      searchAreas: [],
      resultsTree: undefined,
      selectedSpine: undefined,
      selectedArea: undefined,
      selectedPlan: undefined
    }
  }

  static portalByLl(latlng) {
    return SpineFinderPlugin.portalsLl[llstring(latlng)]
  }
  static portalNameByLl(latlng) {
    var ll = llstring(latlng)
    var portal = SpineFinderPlugin.portalsLl[ll]
    return portal ? portal.options.data.title : ll
  }


  setupDesktop() {
    var a = $('<a tabindex="0">Spine Finder</a>').click(this.showDialog.bind(this));
    $('#toolbox').append(a);
  }

  handlePortalAdded(data) {
    var portal = data.portal;
    var ll = llstring( portal._latlng );
    SpineFinderPlugin.portalsLl[ll] = portal
    this.setState({});  // TODO: only rerender if needs updating
  }

  handleDrawTools(payload) {
    // console.log("SPINE handleDrawTools", payload)
    if (!payload) {
      return;
    }
    if (payload.event === "layerCreated") {
      this.addDrawToolsLayer(drawToolsLayerToJson(payload.layer))
    }
  }

  loadDrawTools(drawToolsItems) {
    drawToolsItems = drawToolsItems || JSON.parse(localStorage['plugin-draw-tools-layer'] || "[]")
    drawToolsItems.forEach(l => this.addDrawToolsLayer(l))
  }
  addDrawToolsLayer(layer) {
    // console.log("SPINE addLayer", layer)

    if (layer.type === "polyline") {
      this.setState({
        spines: this.state.spines.concat([new Spine(layer)])
      })
    } else if (layer.type == "circle") {
      this.setState({
        searchAreas: this.state.searchAreas.concat([new SearchArea(layer)])
      })
    }
  }

  runSearch() {
    var area = this.state.searchAreas[this.state.selectedArea]
    var spine = this.state.spines[this.state.selectedSpine]
    console.log("SPINE runSearch", spine.portals, area.portals)

    var tree = TreeNode.create(spine, area.portals)
    console.log("SPINE tree", tree)

    console.log("SPINE plans", tree.getPlans())

    this.setState({
      resultsTree: tree
    })
  }

  drawSelectedPlan() {
    var plan = this.state.resultsTree.getPlans()[this.state.selectedPlan]
    var spine = this.state.resultsTree.spine
    console.log("SPINE drawSelected", spine, plan)

    var linkOpts = linkOpts || L.extend({},window.plugin.drawTools.lineOptions)
    var layers = plan.map(p => 
      L.geodesicPolyline([
        spine.portals[0]._latlng, 
        p._latlng,
        spine.portals[1]._latlng
      ], linkOpts)
    )

    layers.forEach(l => {
      window.plugin.drawTools.drawnItems.addLayer(l)
    })
    // window.plugin.drawTools.save();
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
      width: '600px',
      closeCallback: () => this.closeDialog()
    }).dialog('option', 'buttons', {
      'OK': function() { $(this).dialog('close') },
    });

  }

  closeDialog() {
    this.dialog = undefined
    this.setState({
      resultsTree: undefined,
      selectedSpine: undefined,
      selectedArea: undefined,
      selectedPlan: undefined
    })
  }

  render() {
    var ret = $('<div class="spine-finder"></div>');

    ret.append('<h4>Spines</h4>')
    var spines_select = $('<select class="spines" size="5"></select>')
    this.state.spines.forEach((spine,idx) => {
      var selected = idx == this.state.selectedSpine ? 'selected="selected"' : ''
      spines_select.append(`<option value="${idx}" ${selected}>${spine.label}</option>`)
    })
    spines_select.change(() => this.setState({'selectedSpine': spines_select.val()}))
    ret.append(spines_select)

    ret.append('<h4>Search Areas</h4>')
    var areas_select = $('<select class="areas" size="5"></select>')
    this.state.searchAreas.forEach((area,idx) => {
      var selected = idx == this.state.selectedArea ? 'selected="selected"' : ''
      areas_select.append(`<option value="${idx}" ${selected}>${area.label}</option>`)
    })
    areas_select.change(() => this.setState({'selectedArea': areas_select.val()}))
    ret.append(areas_select)

    if (this.state.selectedSpine !== undefined && this.state.selectedArea !== undefined) {
      var button = $('<button>Search</button>')
      button.click(() => this.runSearch())
      ret.append(button)
    }

    if (this.state.resultsTree !== undefined) {
      ret.append('<h4>Results</h4>')
      var results_select = $('<select class="results" size="10"></select>')
      this.state.resultsTree.getPlans().forEach((plan, idx) => {
        var selected = idx == this.state.selectedPlan ? 'selected="selected"' : ''
        var names = plan.map(p => p.options.data.title).join(", ")
        results_select.append(`<option value="${idx}" ${selected}>${plan.length} layers: ${names}</option>`)
      })
      results_select.change(() => this.setState({'selectedPlan': results_select.val()}))
      ret.append(results_select)

      if (this.state.selectedPlan !== undefined) {
        var button = $('<button>Draw</button>')
        button.click(() => this.drawSelectedPlan())
        ret.append(button)
      }
    }

    return ret[0]
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
