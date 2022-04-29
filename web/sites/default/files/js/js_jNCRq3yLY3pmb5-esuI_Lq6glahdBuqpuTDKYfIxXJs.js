/**
 * Attach functionality for modifying map markers.
 */
(function ($, Drupal, drupalSettings) {
  Drupal.behaviors.leaflet_widget = {
    attach: function (context, settings) {
      $.each(settings.leaflet_widget, function (map_id, widgetSettings) {
        $('#' + map_id, context).each(function () {
          let map = $(this);
          // If the attached context contains any leaflet maps with widgets, make sure we have a
          // Drupal.leaflet_widget object.
          if (map.data('leaflet_widget') === undefined) {
            let lMap = drupalSettings.leaflet[map_id].lMap;
            map.data('leaflet_widget', new Drupal.leaflet_widget(map, lMap, widgetSettings));
          }
          else {
            // If we already had a widget, update map to make sure that WKT and map are synchronized.
            map.data('leaflet_widget').update_map();
            map.data('leaflet_widget').update_input_state();
          }
        });
      });
    }
  };

  Drupal.leaflet_widget = function (map_container, lMap, widgetSettings) {

    // A FeatureGroup is required to store editable layers
    this.drawnItems = new L.LayerGroup();
    this.settings = widgetSettings;
    this.settings.path_style = this.settings.path ? JSON.parse(this.settings.path) : {};

    this.container = $(map_container).parent();
    this.json_selector = this.settings.jsonElement;
    this.layers = [];

    if (widgetSettings['langcode']) {
      lMap.pm.setLang(widgetSettings['langcode']);
    }

    this.map = undefined;
    this.set_leaflet_map(lMap);

    // If map is initialised (or re-initialised) then use the new instance.
    this.container.on('leafletMapInit', $.proxy(function (event, _m, lMap) {
      this.set_leaflet_map(lMap);
    }, this));

    // Update map whenever the input field is changed.
    this.container.on('change', this.json_selector, $.proxy(this.update_map, this));

    // Show, hide, mark read-only.
    this.update_input_state();
  };

  /**
   * Set the leaflet map object.
   */
  Drupal.leaflet_widget.prototype.set_leaflet_map = function (map) {
    if (map !== undefined) {
      this.map = map;
      map.addLayer(this.drawnItems);

      if (this.settings.scrollZoomEnabled) {
        map.on('focus', function () {
          map.scrollWheelZoom.enable();
        });
        map.on('blur', function () {
          map.scrollWheelZoom.disable();
        });
      }

      // Adjust toolbar to show defaultMarker or circleMarker.
      this.settings.toolbarSettings.drawMarker = false;
      this.settings.toolbarSettings.drawCircleMarker = false;
      if (this.settings.toolbarSettings.marker === "defaultMarker") {
        this.settings.toolbarSettings.drawMarker = 1;
      } else if (this.settings.toolbarSettings.marker === "circleMarker") {
        this.settings.toolbarSettings.drawCircleMarker = 1;
      }
      map.pm.addControls(this.settings.toolbarSettings);

      map.on('pm:create', function(event){
        let layer = event.layer;
        this.drawnItems.addLayer(layer);
        layer.pm.enable({ allowSelfIntersection: false });
        this.update_text();
        // Listen to changes on the new layer
        this.add_layer_listeners(layer);
      }, this);
      this.update_map();
    }
  };

  /**
   * Update the WKT text input field.disableGlobalEditMode()
   */
  Drupal.leaflet_widget.prototype.update_text = function () {
    if (this.drawnItems.getLayers().length === 0) {
      $(this.json_selector, this.container).val('');
    }
    else {
      let json_string = JSON.stringify(this.drawnItems.toGeoJSON());
      $(this.json_selector, this.container).val(json_string);
    }
    this.container.trigger("change");
  };

  /**
   * Set visibility and readonly attribute of the input element.
   */
  Drupal.leaflet_widget.prototype.update_input_state = function () {
    $('.form-item.form-type-textarea, .form-item.form-type--textarea', this.container).toggle(!this.settings.inputHidden);
    $(this.json_selector, this.container).prop('readonly', this.settings.inputReadonly);
  };

  /**
   * Add/Set Listeners to the Drawn Map Layers.
   */
  Drupal.leaflet_widget.prototype.add_layer_listeners = function (layer) {

    // Listen to changes on the layer.
    layer.on('pm:edit', function(event) {
      this.update_text();
    }, this);

    // Listen to changes on the layer.
    layer.on('pm:update', function(event) {
      this.update_text();
    }, this);

    // Listen to drag events on the layer.
    layer.on('pm:dragend', function(event) {
      this.update_text();
    }, this);

    // Listen to cut events on the layer.
    layer.on('pm:cut', function(event) {
      this.drawnItems.removeLayer(event.originalLayer);
      this.drawnItems.addLayer(event.layer);
      this.update_text();
    }, this);

    // Listen to remove events on the layer.
    layer.on('pm:remove', function(event) {
      this.drawnItems.removeLayer(event.layer);
      this.update_text();
    }, this);

  };

  /**
   * Update the leaflet map from text.
   */
  Drupal.leaflet_widget.prototype.update_map = function () {
    let self = this;
    let value = $(this.json_selector, this.container).val();

    // Always clear the layers in drawnItems on map updates.
    this.drawnItems.clearLayers();

    // Nothing to do if we don't have any data.
    if (value.length === 0) {

      // If no layer available, locate the user position.
      if (this.settings.locate && !this.settings.map_position.force) {
        this.map.locate({setView: true, maxZoom: 18});
      }

      return;
    }

    try {
      let layerOpts = {
        style: function (feature) {
          return self.settings.path_style;
        }
      };
      // Use circleMarkers if specified.
      if (self.settings.toolbarSettings.marker === "circleMarker") {
        layerOpts.pointToLayer = function (feature, latlng) {
          return L.circleMarker(latlng);
        };
      }
      // Apply styles to pm drawn items.
      this.map.pm.setGlobalOptions({
        pathOptions: self.settings.path_style
      });
      let obj = L.geoJson(JSON.parse(value), layerOpts);
      // See https://github.com/Leaflet/Leaflet.draw/issues/398
      obj.eachLayer(function(layer) {
        if (typeof layer.getLayers === "function") {
          let subLayers = layer.getLayers();
          for (let i = 0; i < subLayers.length; i++) {
            this.drawnItems.addLayer(subLayers[i]);
            this.add_layer_listeners(subLayers[i]);
          }
        }
        else {
          this.drawnItems.addLayer(layer);
          this.add_layer_listeners(layer);
        }

      }, this);

      // Pan the map to the feature
      if (this.settings.autoCenter) {
        let start_zoom;
        let start_center;
        if (obj.getBounds !== undefined && typeof obj.getBounds === 'function') {
          // For objects that have defined bounds or a way to get them
          let bounds = obj.getBounds();
          this.map.fitBounds(bounds);
          // Update the map start zoom and center, for correct working of Map Reset control.
          start_zoom = this.map.getBoundsZoom(bounds);
          start_center = bounds.getCenter();

          // In case of Map Zoom Forced, use the custom Map Zoom set.
          if (this.settings.map_position.force && this.settings.map_position.zoom) {
            start_zoom = this.settings.map_position.zoom;
            this.map.setZoom(start_zoom );
          }

        } else if (obj.getLatLng !== undefined && typeof obj.getLatLng === 'function') {
          this.map.panTo(obj.getLatLng());
          // Update the map start center, for correct working of Map Reset control.
          start_center = this.map.getCenter();
          start_zoom = this.map.getZoom();
        }

        // In case of map initial position not forced, and zooFiner not null/neutral,
        // adapt the Map Zoom and the Start Zoom accordingly.
        if (!this.settings.map_position.force && this.settings.map_position.hasOwnProperty('zoomFiner') && parseInt(this.settings.map_position['zoomFiner']) !== 0) {
          start_zoom += parseFloat(this.settings.map_position['zoomFiner']);
          this.map.setView(start_center, start_zoom);
        }

        Drupal.Leaflet[this.settings.map_id].start_zoom = start_zoom;
        Drupal.Leaflet[this.settings.map_id].start_center = start_center;

      }
    } catch (error) {
      if (window.console) console.error(error.message);
    }
  };

})(jQuery, Drupal, drupalSettings);
;
/**
* DO NOT EDIT THIS FILE.
* See the following change record for more information,
* https://www.drupal.org/node/2815083
* @preserve
**/

(function ($, Drupal) {
  Drupal.behaviors.filterGuidelines = {
    attach: function attach(context) {
      function updateFilterGuidelines(event) {
        var $this = $(event.target);
        var value = $this.val();
        $this.closest('.js-filter-wrapper').find('[data-drupal-format-id]').hide().filter("[data-drupal-format-id=\"".concat(value, "\"]")).show();
      }

      $(once('filter-guidelines', '.js-filter-guidelines', context)).find(':header').hide().closest('.js-filter-wrapper').find('select.js-filter-list').on('change.filterGuidelines', updateFilterGuidelines).trigger('change.filterGuidelines');
    }
  };
})(jQuery, Drupal);;
/**
* DO NOT EDIT THIS FILE.
* See the following change record for more information,
* https://www.drupal.org/node/2815083
* @preserve
**/

(function ($, Drupal, debounce) {
  var offsets = {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0
  };

  function getRawOffset(el, edge) {
    var $el = $(el);
    var documentElement = document.documentElement;
    var displacement = 0;
    var horizontal = edge === 'left' || edge === 'right';
    var placement = $el.offset()[horizontal ? 'left' : 'top'];
    placement -= window["scroll".concat(horizontal ? 'X' : 'Y')] || document.documentElement["scroll".concat(horizontal ? 'Left' : 'Top')] || 0;

    switch (edge) {
      case 'top':
        displacement = placement + $el.outerHeight();
        break;

      case 'left':
        displacement = placement + $el.outerWidth();
        break;

      case 'bottom':
        displacement = documentElement.clientHeight - placement;
        break;

      case 'right':
        displacement = documentElement.clientWidth - placement;
        break;

      default:
        displacement = 0;
    }

    return displacement;
  }

  function calculateOffset(edge) {
    var edgeOffset = 0;
    var displacingElements = document.querySelectorAll("[data-offset-".concat(edge, "]"));
    var n = displacingElements.length;

    for (var i = 0; i < n; i++) {
      var el = displacingElements[i];

      if (el.style.display === 'none') {
        continue;
      }

      var displacement = parseInt(el.getAttribute("data-offset-".concat(edge)), 10);

      if (isNaN(displacement)) {
        displacement = getRawOffset(el, edge);
      }

      edgeOffset = Math.max(edgeOffset, displacement);
    }

    return edgeOffset;
  }

  function calculateOffsets() {
    return {
      top: calculateOffset('top'),
      right: calculateOffset('right'),
      bottom: calculateOffset('bottom'),
      left: calculateOffset('left')
    };
  }

  function displace(broadcast) {
    offsets = calculateOffsets();
    Drupal.displace.offsets = offsets;

    if (typeof broadcast === 'undefined' || broadcast) {
      $(document).trigger('drupalViewportOffsetChange', offsets);
    }

    return offsets;
  }

  Drupal.behaviors.drupalDisplace = {
    attach: function attach() {
      if (this.displaceProcessed) {
        return;
      }

      this.displaceProcessed = true;
      $(window).on('resize.drupalDisplace', debounce(displace, 200));
    }
  };
  Drupal.displace = displace;
  $.extend(Drupal.displace, {
    offsets: offsets,
    calculateOffset: calculateOffset
  });
})(jQuery, Drupal, Drupal.debounce);;
/**
* DO NOT EDIT THIS FILE.
* See the following change record for more information,
* https://www.drupal.org/node/2815083
* @preserve
**/

(function ($, Drupal, drupalSettings) {
  drupalSettings.dialog = {
    autoOpen: true,
    dialogClass: '',
    buttonClass: 'button',
    buttonPrimaryClass: 'button--primary',
    close: function close(event) {
      Drupal.dialog(event.target).close();
      Drupal.detachBehaviors(event.target, null, 'unload');
    }
  };

  Drupal.dialog = function (element, options) {
    var undef;
    var $element = $(element);
    var dialog = {
      open: false,
      returnValue: undef
    };

    function openDialog(settings) {
      settings = $.extend({}, drupalSettings.dialog, options, settings);
      $(window).trigger('dialog:beforecreate', [dialog, $element, settings]);
      $element.dialog(settings);
      dialog.open = true;
      $(window).trigger('dialog:aftercreate', [dialog, $element, settings]);
    }

    function closeDialog(value) {
      $(window).trigger('dialog:beforeclose', [dialog, $element]);
      $element.dialog('close');
      dialog.returnValue = value;
      dialog.open = false;
      $(window).trigger('dialog:afterclose', [dialog, $element]);
    }

    dialog.show = function () {
      openDialog({
        modal: false
      });
    };

    dialog.showModal = function () {
      openDialog({
        modal: true
      });
    };

    dialog.close = closeDialog;
    return dialog;
  };
})(jQuery, Drupal, drupalSettings);;
/**
* DO NOT EDIT THIS FILE.
* See the following change record for more information,
* https://www.drupal.org/node/2815083
* @preserve
**/

(function ($, Drupal, drupalSettings, debounce, displace) {
  drupalSettings.dialog = $.extend({
    autoResize: true,
    maxHeight: '95%'
  }, drupalSettings.dialog);

  function resetPosition(options) {
    var offsets = displace.offsets;
    var left = offsets.left - offsets.right;
    var top = offsets.top - offsets.bottom;
    var leftString = "".concat((left > 0 ? '+' : '-') + Math.abs(Math.round(left / 2)), "px");
    var topString = "".concat((top > 0 ? '+' : '-') + Math.abs(Math.round(top / 2)), "px");
    options.position = {
      my: "center".concat(left !== 0 ? leftString : '', " center").concat(top !== 0 ? topString : ''),
      of: window
    };
    return options;
  }

  function resetSize(event) {
    var positionOptions = ['width', 'height', 'minWidth', 'minHeight', 'maxHeight', 'maxWidth', 'position'];
    var adjustedOptions = {};
    var windowHeight = $(window).height();
    var option;
    var optionValue;
    var adjustedValue;

    for (var n = 0; n < positionOptions.length; n++) {
      option = positionOptions[n];
      optionValue = event.data.settings[option];

      if (optionValue) {
        if (typeof optionValue === 'string' && /%$/.test(optionValue) && /height/i.test(option)) {
          windowHeight -= displace.offsets.top + displace.offsets.bottom;
          adjustedValue = parseInt(0.01 * parseInt(optionValue, 10) * windowHeight, 10);

          if (option === 'height' && event.data.$element.parent().outerHeight() < adjustedValue) {
            adjustedValue = 'auto';
          }

          adjustedOptions[option] = adjustedValue;
        }
      }
    }

    if (!event.data.settings.modal) {
      adjustedOptions = resetPosition(adjustedOptions);
    }

    event.data.$element.dialog('option', adjustedOptions).trigger('dialogContentResize');
  }

  $(window).on({
    'dialog:aftercreate': function dialogAftercreate(event, dialog, $element, settings) {
      var autoResize = debounce(resetSize, 20);
      var eventData = {
        settings: settings,
        $element: $element
      };

      if (settings.autoResize === true || settings.autoResize === 'true') {
        $element.dialog('option', {
          resizable: false,
          draggable: false
        }).dialog('widget').css('position', 'fixed');
        $(window).on('resize.dialogResize scroll.dialogResize', eventData, autoResize).trigger('resize.dialogResize');
        $(document).on('drupalViewportOffsetChange.dialogResize', eventData, autoResize);
      }
    },
    'dialog:beforeclose': function dialogBeforeclose(event, dialog, $element) {
      $(window).off('.dialogResize');
      $(document).off('.dialogResize');
    }
  });
})(jQuery, Drupal, drupalSettings, Drupal.debounce, Drupal.displace);;
/**
* DO NOT EDIT THIS FILE.
* See the following change record for more information,
* https://www.drupal.org/node/2815083
* @preserve
**/

(function ($, _ref) {
  var tabbable = _ref.tabbable,
      isTabbable = _ref.isTabbable;
  $.widget('ui.dialog', $.ui.dialog, {
    options: {
      buttonClass: 'button',
      buttonPrimaryClass: 'button--primary'
    },
    _createButtons: function _createButtons() {
      var opts = this.options;
      var primaryIndex;
      var index;
      var il = opts.buttons.length;

      for (index = 0; index < il; index++) {
        if (opts.buttons[index].primary && opts.buttons[index].primary === true) {
          primaryIndex = index;
          delete opts.buttons[index].primary;
          break;
        }
      }

      this._super();

      var $buttons = this.uiButtonSet.children().addClass(opts.buttonClass);

      if (typeof primaryIndex !== 'undefined') {
        $buttons.eq(index).addClass(opts.buttonPrimaryClass);
      }
    },
    _focusTabbable: function _focusTabbable() {
      var hasFocus = this._focusedElement ? this._focusedElement.get(0) : null;

      if (!hasFocus) {
        hasFocus = this.element.find('[autofocus]').get(0);
      }

      if (!hasFocus) {
        var $elements = [this.element, this.uiDialogButtonPane];

        for (var i = 0; i < $elements.length; i++) {
          var element = $elements[i].get(0);

          if (element) {
            var elementTabbable = tabbable(element);
            hasFocus = elementTabbable.length ? elementTabbable[0] : null;
          }

          if (hasFocus) {
            break;
          }
        }
      }

      if (!hasFocus) {
        var closeBtn = this.uiDialogTitlebarClose.get(0);
        hasFocus = closeBtn && isTabbable(closeBtn) ? closeBtn : null;
      }

      if (!hasFocus) {
        hasFocus = this.uiDialog.get(0);
      }

      $(hasFocus).eq(0).trigger('focus');
    }
  });
})(jQuery, window.tabbable);;
/**
* DO NOT EDIT THIS FILE.
* See the following change record for more information,
* https://www.drupal.org/node/2815083
* @preserve
**/

(function ($, Drupal, drupalSettings) {
  function findFieldForFormatSelector($formatSelector) {
    var fieldId = $formatSelector.attr('data-editor-for');
    return $("#".concat(fieldId)).get(0);
  }

  function filterXssWhenSwitching(field, format, originalFormatID, callback) {
    if (format.editor.isXssSafe) {
      callback(field, format);
    } else {
      $.ajax({
        url: Drupal.url("editor/filter_xss/".concat(format.format)),
        type: 'POST',
        data: {
          value: field.value,
          original_format_id: originalFormatID
        },
        dataType: 'json',
        success: function success(xssFilteredValue) {
          if (xssFilteredValue !== false) {
            field.value = xssFilteredValue;
          }

          callback(field, format);
        }
      });
    }
  }

  function changeTextEditor(field, newFormatID) {
    var previousFormatID = field.getAttribute('data-editor-active-text-format');

    if (drupalSettings.editor.formats[previousFormatID]) {
      Drupal.editorDetach(field, drupalSettings.editor.formats[previousFormatID]);
    } else {
      $(field).off('.editor');
    }

    if (drupalSettings.editor.formats[newFormatID]) {
      var format = drupalSettings.editor.formats[newFormatID];
      filterXssWhenSwitching(field, format, previousFormatID, Drupal.editorAttach);
    }

    field.setAttribute('data-editor-active-text-format', newFormatID);
  }

  function onTextFormatChange(event) {
    var $select = $(event.target);
    var field = event.data.field;
    var activeFormatID = field.getAttribute('data-editor-active-text-format');
    var newFormatID = $select.val();

    if (newFormatID === activeFormatID) {
      return;
    }

    var supportContentFiltering = drupalSettings.editor.formats[newFormatID] && drupalSettings.editor.formats[newFormatID].editorSupportsContentFiltering;
    var hasContent = field.value !== '';

    if (hasContent && supportContentFiltering) {
      var message = Drupal.t('Changing the text format to %text_format will permanently remove content that is not allowed in that text format.<br><br>Save your changes before switching the text format to avoid losing data.', {
        '%text_format': $select.find('option:selected').text()
      });
      var confirmationDialog = Drupal.dialog("<div>".concat(message, "</div>"), {
        title: Drupal.t('Change text format?'),
        dialogClass: 'editor-change-text-format-modal',
        resizable: false,
        buttons: [{
          text: Drupal.t('Continue'),
          class: 'button button--primary',
          click: function click() {
            changeTextEditor(field, newFormatID);
            confirmationDialog.close();
          }
        }, {
          text: Drupal.t('Cancel'),
          class: 'button',
          click: function click() {
            $select.val(activeFormatID);
            confirmationDialog.close();
          }
        }],
        closeOnEscape: false,
        create: function create() {
          $(this).parent().find('.ui-dialog-titlebar-close').remove();
        },
        beforeClose: false,
        close: function close(event) {
          $(event.target).remove();
        }
      });
      confirmationDialog.showModal();
    } else {
      changeTextEditor(field, newFormatID);
    }
  }

  Drupal.editors = {};
  Drupal.behaviors.editor = {
    attach: function attach(context, settings) {
      if (!settings.editor) {
        return;
      }

      once('editor', '[data-editor-for]', context).forEach(function (editor) {
        var $this = $(editor);
        var field = findFieldForFormatSelector($this);

        if (!field) {
          return;
        }

        var activeFormatID = $this.val();
        field.setAttribute('data-editor-active-text-format', activeFormatID);

        if (settings.editor.formats[activeFormatID]) {
          Drupal.editorAttach(field, settings.editor.formats[activeFormatID]);
        }

        $(field).on('change.editor keypress.editor', function () {
          field.setAttribute('data-editor-value-is-changed', 'true');
          $(field).off('.editor');
        });

        if ($this.is('select')) {
          $this.on('change.editorAttach', {
            field: field
          }, onTextFormatChange);
        }

        $this.parents('form').on('submit', function (event) {
          if (event.isDefaultPrevented()) {
            return;
          }

          if (settings.editor.formats[activeFormatID]) {
            Drupal.editorDetach(field, settings.editor.formats[activeFormatID], 'serialize');
          }
        });
      });
    },
    detach: function detach(context, settings, trigger) {
      var editors;

      if (trigger === 'serialize') {
        editors = once.filter('editor', '[data-editor-for]', context);
      } else {
        editors = once.remove('editor', '[data-editor-for]', context);
      }

      editors.forEach(function (editor) {
        var $this = $(editor);
        var activeFormatID = $this.val();
        var field = findFieldForFormatSelector($this);

        if (field && activeFormatID in settings.editor.formats) {
          Drupal.editorDetach(field, settings.editor.formats[activeFormatID], trigger);
        }
      });
    }
  };

  Drupal.editorAttach = function (field, format) {
    if (format.editor) {
      Drupal.editors[format.editor].attach(field, format);
      Drupal.editors[format.editor].onChange(field, function () {
        $(field).trigger('formUpdated');
        field.setAttribute('data-editor-value-is-changed', 'true');
      });
    }
  };

  Drupal.editorDetach = function (field, format, trigger) {
    if (format.editor) {
      Drupal.editors[format.editor].detach(field, format, trigger);

      if (field.getAttribute('data-editor-value-is-changed') === 'false') {
        field.value = field.getAttribute('data-editor-value-original');
      }
    }
  };
})(jQuery, Drupal, drupalSettings);;
