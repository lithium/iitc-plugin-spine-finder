// ==UserScript==
// @id             iitc-plugin-spiner-finder@nobody889
// @name           IITC plugin: Spine Finder
// @category       Info
// @version        0.1.0
// @namespace      https://github.com/lithium/iitc-plugin-spine-finder
// @updateURL      @@UPDATEURL@@
// @downloadURL    @@DOWNLOADURL@@
// @description    [@@BUILDNAME@@-@@BUILDDATE@@] Find maximum possible layers from a baseline 
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

  setState(newState, callback) {
    Object.assign(this.state, newState)
    this.update()
    if (callback) {
      callback()
    }
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
    var src = SpineFinderPlugin.portalNameByLl(this.layer.getLatLngs()[0])
    var dest = SpineFinderPlugin.portalNameByLl(this.layer.getLatLngs()[1])
    return `${src} <-> ${dest}`
  }

  get portals() {
    if (window.portals) {
      var portals = this.layer.getLatLngs().map(ll => SpineFinderPlugin.portalByLl(ll))
      if (portals.filter(_ => _ !== undefined).length == 2) {
        return portals 
      } 
    }
    return this.layer.getLatLngs().map(ll => L.marker(ll))
  }

}

class SearchArea {
  constructor(layer) {
    this.layer = layer
  }

  get areaInKm() {
    return (Math.PI * Math.pow(this.layer._mRadius, 2)) / 1000 / 1000
  }

  get label() {
    return `${this.portals.length} Portals ${this.areaInKm.toFixed(1)}km @${llstring(this.layer.getLatLng())}`
  }

  get portals() {
    if (window.portals) {
      return Object.getOwnPropertyNames(window.portals).map(guid => {
        var portal = window.portals[guid];
        var distance = portal._latlng.distanceTo(this.layer.getLatLng())
        if (distance < this.layer._mRadius) {
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

    this._links = this.getLinks();
  }

  getParentLinks() {
    return (this.parent ? this.parent.getParentLinks() : []).concat(this._links)
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

  static create(spine, portals, avoidLinks, parent, portal) {
    return new Promise(async (resolve, reject) => {
      await sleep(10)

      var node = new TreeNode({spine: spine, parent: parent, portal: portal})
      var spine_portals = spine.portals
      var avoid = avoidLinks ? Object.values(window.links) : []
      var childPromises = portals.map(p => {
        var newLinks = [
          L.geodesicPolyline([spine_portals[0]._latlng, p._latlng]),
          L.geodesicPolyline([spine_portals[1]._latlng, p._latlng]),
        ]
        if (!doLinksCross(avoid.concat(node.getParentLinks()), newLinks)) {
          var poly = L.geodesicPolygon([
            spine_portals[0]._latlng,
            spine_portals[1]._latlng,
            p._latlng
          ])
          var possiblePortals = portals.filter(x => 
            x.options.guid != p.options.guid && isMarkerInsidePolygon(x, poly)
          )
          return TreeNode.create(spine, possiblePortals, avoidLinks, node, p)
        } else return undefined
      }).filter(_ => _ !== undefined)
      // console.log("SPINE await")
      node.children = await Promise.all(childPromises)
      // console.log("SPINE done")
      return resolve(node)

    })
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

    this.previewLineOptions = {
      stroke: true,
      color: "red",
      weight: 2,
      opacity: 0.3,
      fill: false,
      clickable: true
    };

  }

  static initialState() {
    return {
      spines: [],
      searchAreas: [],
      plans: [],
      maxResults: 25,
      avoidLinks: false, 
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
    return (portal && portal.options.data.title) ? portal.options.data.title : ll
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
      this.addDrawToolsLayer(payload.layer)
    }
    else if (payload.event === "layersDeleted" || 
             payload.event === "import" || 
             payload.event === "layersEdited" || 
             payload.event === "clear" || 
             payload.event === "layersSnappedToPortals") {
      this.resetDrawTools();
    }
  }

  resetDrawTools() {
    this.setState({
      searchAreas: [],
      spines: [],
    })
    this.loadDrawTools()
  }
  loadDrawTools() {
    var layers = window.plugin.drawTools.drawnItems.getLayers()
    layers.forEach(l => this.addDrawToolsLayer(l))
  }
  addDrawToolsLayer(layer) {
    console.log("SPINE addLayer", layer)

    if (layer._mRadius !== undefined) {
      this.setState({
        searchAreas: this.state.searchAreas.concat([new SearchArea(layer)])
      })
    } else if (layer.getLatLngs().length == 2) {
      this.setState({
        spines: this.state.spines.concat([new Spine(layer)])
      })
    }
  }

  runSearch() {
    var area = this.getSelectedArea()
    var spine = this.getSelectedSpine()
    console.log("SPINE runSearch", spine.portals, area.portals)

    this.setState({
      'loading': true
    }, () => {

      setTimeout(() => {

        var tree = TreeNode.create(spine, area.portals, this.state.avoidLinks)
        console.log("SPINE tree", tree)

        tree.then((val) => {
          var plans = val.getPlans()
          console.log("SPINE plans total count", plans.length)

          this.setState({
            loading: false,
            totalResults: plans.length,
            plans: plans.slice(0, this.state.maxResults || 25)
          })

        })

      }, 100)


    })
  }

  getSelectedArea() {
    return this.state.selectedArea !== undefined ? this.state.searchAreas[this.state.selectedArea] : undefined
  }
  getSelectedSpine() {
    return this.state.selectedSpine !== undefined ? this.state.spines[this.state.selectedSpine] : undefined
  }
  getSelectedPlan() {
    return this.state.selectedPlan !== undefined ? this.state.plans[this.state.selectedPlan] : undefined
  }

  saveSelectedPlan() {
    var linkOpts = L.extend({},window.plugin.drawTools.lineOptions)
    this.drawnLayers.forEach(l => {
      l.setStyle(linkOpts)
      runHooks('pluginDrawTools',{event:'layerCreated',layer:l});
    })
    this.drawnLayers = undefined

    window.plugin.drawTools.save();
    $(this.dialog).dialog('close');
  }
  drawSelectedPlan() {

    this.clearPlanPreview();

    var plan = this.getSelectedPlan()
    var spine = this.getSelectedSpine()

    var linkOpts = this.previewLineOptions
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
    this.drawnLayers = layers
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

    this.setState({})

    this.dialog = dialog({
      title: "Spine Finder",
      html: this.element,
      height: 'auto',
      width: '750px',
      closeCallback: () => this.closeDialog()
    }).dialog('option', 'buttons', {
      'OK': function() { $(this).dialog('close') },
    });

  }

  closeDialog() {
    this.dialog = undefined
    this.setState({
      plans: [],
      selectedSpine: undefined,
      selectedArea: undefined,
      selectedPlan: undefined
    })
    this.clearPlanPreview()
  }

  renderInputs() {
    var ret = $('<div class="spine-inputs"></div>');

    ret.append('<h4>Spines</h4>')
    var spines_select = $('<div class="list spines"></div>')
    this.state.spines.forEach((spine,idx) => {
      var selected = idx == this.state.selectedSpine ? 'selected' : ''
      var row = $(`<div data-value="${idx}" class="row ${selected}">${spine.label}</div>`)
      row.click(() => this.setState({'selectedSpine': idx}) )
      spines_select.append(row)
    })
    ret.append(spines_select)

    ret.append('<h4>Search Areas</h4>')
    var areas_select = $('<div class="list areas"></div>')
    this.state.searchAreas.forEach((area,idx) => {
      var selected = idx == this.state.selectedArea ? 'selected' : ''
      var row = $(`<div data-value="${idx}" class="row ${selected}">${area.label}</div>`)
      row.click(() => this.setState({'selectedArea': idx}) )
      areas_select.append(row)
    })
    ret.append(areas_select)


    if (this.state.selectedSpine !== undefined && this.state.selectedArea !== undefined) {
      var container = $('<div class="container"></div>')

      var div = $('<div class="left searchactions"></div>')

      var checked = this.state.avoidLinks ? 'checked="checked"' : ""
      var check = $(`<input id="spine-finder-avoid" type="checkbox" ${checked}><label for="spine-finder-avoid">Avoid Existing Links</label>`)
      check.change(() => this.setState({'avoidLinks': check.is(':checked')}))
      div.append($('<div></div>').append(check))

      var input = $(`<input id="spine-finder-maxresults" size="2" type="number" value="${this.state.maxResults}"></input><label>max results</label>`)
      input.change(() => this.setState({'maxResults': input.val()}))
      div.append($('<div></div>').append(input))
      container.append(div)

      var button = $('<button class="submit">Search</button>')
      button.click(() => this.runSearch())
      container.append(button)

      ret.append(container)
    }

    return ret
  }

  selectPlan(idx) {
    // avoid a setState to not rerender the scrolling results container
    if (this.state.selectedPlan !== undefined) {
      $(`.results .row[data-value="${this.state.selectedPlan}"]`).removeClass('selected')
    }
    this.state.selectedPlan = idx
    $(`.results .row[data-value="${idx}"]`).addClass('selected')
    this.drawSelectedPlan()
    this.updateDetails()
  }

  clearPlanPreview() {
    console.log("SPINE clearPlanPreview", this.drawnLayers)
    if (this.drawnLayers) {
      this.drawnLayers.forEach(l => window.plugin.drawTools.drawnItems.removeLayer(l))
    }
  }

  renderResults() {
    var ret = $('<div class="spine-results"></div>');

    if (this.state.loading) {
      ret.append('<div class="lds-hourglass"></div>')
    } 
    else
    if (this.state.plans.length > 0) {
      ret.append(`<h4>Results (${this.state.plans.length} of ${this.state.totalResults})</h4>`)
      var results_select = $('<div class="list results"></div>')
      this.state.plans.forEach((plan, idx) => {
        var selected = idx == this.state.selectedPlan ? 'selected' : ''
        var names = plan.map(p => p.options.data.title).join(", ")
        var row = $(`<div data-value="${idx}" class="row ${selected}">${idx+1}. ${plan.length} layers</div>`)
        row.click(() => this.selectPlan(idx))
        results_select.append(row)
      })
      ret.append(results_select)

      this.planDetails = $('<div></div>')
      ret.append(this.planDetails)
      this.updateDetails()

      
    }
 
    return ret
  }

  updateDetails() {
    var div = this.planDetails
    if (!div) return;

    div.empty()

    var plan = this.getSelectedPlan()
    if (plan !== undefined) {
      div.append('<h4>Plan Details</h4>')
      var container = $('<div class="container"></div>')

      var list = $('<ol class="portals"></ol>')
      plan.forEach((p, idx) => {
        list.append(`<li>${p.options.data.title}</li>`)
      })
      container.append(list)

      var button = $('<button class="submit">Save</button>')
      button.click(() => this.saveSelectedPlan())
      container.append(button)

      div.append(container)
    }

  }

  render() {
    var ret = $('<div class="spine-finder"></div>');

    ret.append(this.renderInputs())
    ret.append(this.renderResults())

    return ret[0]
  }


}

// plugin boot - called by iitc
SpineFinderPlugin.boot = function() {

  var css = `

    .spine-finder .list.results {
      height: 10em;
      overflow-y: scroll;
    }

    .spine-finder .row {
      height: 1em;
      margin: 4px;
      padding: 2px;
      cursor: pointer;
      width: 23em;
      overflow: hidden;
    }
    .spine-finder .row.selected {
      background-color: red;
    }

    .spine-finder h4 { 
      font-size: 20px; 
      margin-bottom: .6em;
    }
    .spine-finder .spine-inputs {
      float: left;
      margin-right: 1em;
    }
    .spine-finder .spine-results {
      float: left;
    }

    .spine-finder select {
      width: 20em;
    } 
    .spine-finder input#spine-finder-maxresults {
      width: 4em;
    }
    .spine-finder button.submit {
      padding: 0.6em;
      margin: 0.5em;
      font-size: 20px;
    }
    .spine-finder .searchactions div {
      margin-bottom: 0.5em;
    }
    .spine-finder .container {
      padding: 0.3em;
    }
    .spine-finder .left {
      float: left;
    }

    .spine-finder ol.portals {
      width: 20em;
      margin: 0;
      padding: 0 0 0 .6em;
    }


    .lds-hourglass {
      display: inline-block;
      position: relative;
      width: 64px;
      height: 64px;
    }
    .lds-hourglass:after {
      content: " ";
      display: block;
      border-radius: 50%;
      width: 0;
      height: 0;
      margin: 6px;
      box-sizing: border-box;
      border: 26px solid #fff;
      border-color: #fff transparent #fff transparent;
      animation: lds-hourglass 1.2s infinite;
    }
    @keyframes lds-hourglass {
      0% {
        transform: rotate(0);
        animation-timing-function: cubic-bezier(0.55, 0.055, 0.675, 0.19);
      }
      50% {
        transform: rotate(900deg);
        animation-timing-function: cubic-bezier(0.215, 0.61, 0.355, 1);
      }
      100% {
        transform: rotate(1800deg);
      }
    }

  `;
  var style = document.createElement('style')
  style.appendChild(document.createTextNode(css))
  document.head.appendChild(style)


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
